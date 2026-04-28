// ─── Detector Registry — все 10 Black Star детекторов ─────────────────────

import type { IDetector, DetectorInput, DetectorResult, DetectorName } from './types';
import { BSCI_ALERT_THRESHOLD, MIN_TRADES_FOR_SESSION_QUALITY, SPREAD_PENALTY_THRESHOLD, SPREAD_PENALTY_MAX } from '../constants';
import { detectGraviton } from './graviton';
import { detectDarkmatter } from './darkmatter';
import { detectAccretor } from './accretor';
import { detectDecoherence } from './decoherence';
import { detectHawking } from './hawking';
import { detectPredator } from './predator';
import { detectCipher } from './cipher';
import { detectEntangle } from './entangle';
import { detectWavefunction } from './wavefunction';
import { detectAttractor } from './attractor';

/** Все 10 детекторов в массиве */
export const ALL_DETECTORS: Array<{ name: DetectorName; detect: (input: DetectorInput) => DetectorResult }> = [
  { name: 'GRAVITON',     detect: detectGraviton },
  { name: 'DARKMATTER',   detect: detectDarkmatter },
  { name: 'ACCRETOR',     detect: detectAccretor },
  { name: 'DECOHERENCE',  detect: detectDecoherence },
  { name: 'HAWKING',      detect: detectHawking },
  { name: 'PREDATOR',     detect: detectPredator },
  { name: 'CIPHER',       detect: detectCipher },
  { name: 'ENTANGLE',     detect: detectEntangle },
  { name: 'WAVEFUNCTION', detect: detectWavefunction },
  { name: 'ATTRACTOR',    detect: detectAttractor },
];

/** Запустить все детекторы на одном входе */
export function runAllDetectors(input: DetectorInput): DetectorResult[] {
  return ALL_DETECTORS.map(d => {
    try {
      return d.detect(input);
    } catch (e: any) {
      console.warn(`[runAllDetectors] ${d.name} failed:`, e.message);
      return {
        detector: d.name,
        description: `ERROR: ${e.message}`,
        score: 0,
        confidence: 0,
        signal: 'NEUTRAL',
        metadata: { error: e.message, insufficientData: true },
      };
    }
  });
}

/** Запустить конкретный детектор по имени */
export function runDetector(name: DetectorName, input: DetectorInput): DetectorResult {
  const det = ALL_DETECTORS.find(d => d.name === name);
  if (!det) throw new Error(`Unknown detector: ${name}`);
  return det.detect(input);
}

// ─── BSCI Composite Index ──────────────────────────────────────────────────
// BSCI = Σ(w_i × score_i × multicoll_penalty_i) / Σ(w_i × multicoll_penalty_i)
// Веса адаптивные, сумма = 1, минимальный 0.04 (v4.1)
// v4.2: Multicollinearity penalty — коррелированные детекторы штрафуются

export interface BSCIResult {
  bsci: number;                          // 0..1
  alertLevel: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  topDetector: string;                   // детектор с макс score
  scores: DetectorResult[];              // все 10 результатов
  weights: Record<string, number>;       // текущие веса
  /** v4.2: Multicollinearity penalties per detector */
  multicollPenalties?: Record<string, number>;
}

/**
 * v4.2: Multicollinearity penalty
 *
 * Когда два детектора дают похожие сигналы (оба BULLISH с высоким score),
 * они НЕ несут независимую информацию — штрафуем чтобы избежать
 * двойного счёта.
 *
 * Группы детекторов, склонные к мультиколлинеарности:
 *   [GRAVITON, DARKMATTER] — оба завязаны на orderbook
 *   [DECOHERENCE, HAWKING] — оба детектят алгоритмическую торговлю
 *   [CIPHER, WAVEFUNCTION] — оба ищут циклы
 *   [ACCRETOR, ATTRACTOR]  — оба про «прилипание» цены
 *
 * Штраф: если оба детектора в группе активны (score > 0.3) и
 * направлены одинаково → каждый получает penalty = 0.75
 * (вместо 1.0), что снижает их суммарный вклад.
 *
 * Если только один активен — penalty = 1.0 (нет штрафа).
 */
const MULTICOLL_GROUPS: string[][] = [
  ['GRAVITON', 'DARKMATTER'],
  ['DECOHERENCE', 'HAWKING'],
  ['CIPHER', 'WAVEFUNCTION'],
  ['ACCRETOR', 'ATTRACTOR'],
];

function computeMulticollinearityPenalties(
  scores: DetectorResult[],
): Record<string, number> {
  const penalties: Record<string, number> = {};
  const scoreMap = new Map<string, DetectorResult>();
  for (const s of scores) scoreMap.set(s.detector, s);

  // Инициализируем все penalty = 1.0
  for (const s of scores) penalties[s.detector] = 1.0;

  // Проверяем каждую группу
  for (const group of MULTICOLL_GROUPS) {
    const active = group.filter(d => {
      const s = scoreMap.get(d);
      return s && s.score > 0.3 && !s.metadata?.insufficientData;
    });

    // Если 2+ детектора в группе активны и направлены одинаково → штраф
    if (active.length >= 2) {
      const results = active.map(d => scoreMap.get(d)!);
      const allBullish = results.every(r => r.signal === 'BULLISH');
      const allBearish = results.every(r => r.signal === 'BEARISH');

      if (allBullish || allBearish) {
        // Оба активны и однонаправлены → штраф 0.75
        for (const d of active) {
          penalties[d] = 0.75;
        }
      } else {
        // Активны но разнонаправлены → мягкий штраф 0.9
        for (const d of active) {
          penalties[d] = Math.min(penalties[d], 0.9);
        }
      }
    }
  }

  return penalties;
}

/**
 * Вычислить BSCI Composite Index
 * @param scores — результаты 10 детекторов
 * @param weights — адаптивные веса из BsciWeight таблицы
 *
 * v4.2: Multicollinearity penalty — коррелированные детекторы штрафуются
 * v4.1.2: insufficientData/staleData → вес снижается до min_w (0.04)
 */
/** Контекстные данные для расчёта BSCI */
export interface BSCIContext {
  tradeCount?: number;      // Количество трейдов за последние 5 мин
  spread?: number;          // Спред в процентах (bid-ask)/mid
  lastUpdated?: number;     // Timestamp последнего обновления
}

/** Контекстные фильтры BSCI — штрафуют низколиквидные/пустые сессии */
function applyContextFilters(bsci: number, context?: BSCIContext): number {
  if (!context) return bsci;
  
  let result = bsci;
  
  // 1. Session quality: <50 трейдов = низкая достоверность
  if (context.tradeCount !== undefined) {
    const sessionQuality = Math.min(1, context.tradeCount / MIN_TRADES_FOR_SESSION_QUALITY);
    result *= sessionQuality;
  }
  
  // 2. Spread penalty: >0.3% = низкая ликвидность
  if (context.spread !== undefined && context.spread > SPREAD_PENALTY_THRESHOLD) {
    const spreadPenalty = Math.max(SPREAD_PENALTY_MAX, 1 - (context.spread - SPREAD_PENALTY_THRESHOLD) * 100);
    result *= spreadPenalty;
  }
  
  return result;
}

export function calcBSCI(
  scores: DetectorResult[],
  weights: Record<string, number>,
  context?: BSCIContext
): BSCIResult {
  const MIN_WEIGHT = 0.04;

  // v4.2: Compute multicollinearity penalties
  const multicollPenalties = computeMulticollinearityPenalties(scores);

  // BSCI = Σ(w_i × score_i × multicoll_penalty_i)
  let weightedSum = 0;
  let weightTotal = 0;
  let maxScore = 0;
  let topDetector = 'NONE';

  for (const result of scores) {
    let w = weights[result.detector] ?? 0.1;

    // v4.1.2: Снижаем вес для детекторов без данных
    if (result.metadata?.insufficientData || result.metadata?.staleData) {
      w = MIN_WEIGHT;
    }

    // v4.2: Применяем multicollinearity penalty
    const penalty = multicollPenalties[result.detector] ?? 1.0;
    const effectiveWeight = w * penalty;

    weightedSum += effectiveWeight * result.score;
    weightTotal += effectiveWeight;
    if (result.score > maxScore) {
      maxScore = result.score;
      topDetector = result.detector;
    }
  }

  const bsciRaw = weightTotal > 0 ? weightedSum / weightTotal : 0;
  
  // === КОНТЕКСТНЫЕ ФИЛЬТРЫ ===
  // Штрафуем низколиквидные сессии и тикеры с малым количеством трейдов
  const bsciFiltered = applyContextFilters(bsciRaw, context);
  const clampedBsci = Math.min(1, Math.max(0, bsciFiltered));

  // nHighDetectors filter: минимум 2 детектора с score > 0.3 для ALERT
  const nHighDetectors = scores.filter(s => s.score > 0.3).length;
  const hasConsensus = nHighDetectors >= 2;

  // Alert level — синхронизировано с BSCI_ALERT_THRESHOLD=0.20
  let alertLevel: BSCIResult['alertLevel'] = 'GREEN';
  if (hasConsensus) {
    // Только при консенсусе 3+ детекторов даём ALERT
    if (clampedBsci >= 0.5) alertLevel = 'RED';
    else if (clampedBsci >= 0.3) alertLevel = 'ORANGE';
    else if (clampedBsci >= 0.2) alertLevel = 'YELLOW';
  }
  // else: GREEN — недостаточно консенсуса

  // Direction: взвешенное голосование детекторов (без insufficientData/staleData)
  let bullWeight = 0;
  let bearWeight = 0;
  for (const result of scores) {
    if (result.metadata?.insufficientData || result.metadata?.staleData) continue;
    const w = weights[result.detector] ?? 0.1;
    const penalty = multicollPenalties[result.detector] ?? 1.0;
    const effectiveWeight = w * penalty;
    if (result.signal === 'BULLISH') bullWeight += effectiveWeight * result.score;
    else if (result.signal === 'BEARISH') bearWeight += effectiveWeight * result.score;
  }
  const direction = bullWeight > bearWeight * 1.3 ? 'BULLISH'
    : bearWeight > bullWeight * 1.3 ? 'BEARISH' : 'NEUTRAL';

  return {
    bsci: Math.round(clampedBsci * 1000) / 1000,
    alertLevel,
    direction,
    topDetector,
    scores,
    weights,
    multicollPenalties,
  };
}
