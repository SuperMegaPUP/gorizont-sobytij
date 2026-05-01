// ─── Detector Registry — все 17 Black Star детекторов ─────────────────────

import type { IDetector, DetectorInput, DetectorResult, DetectorName } from './types';
import { BSCI_ALERT_THRESHOLD, MIN_TRADES_FOR_SESSION_QUALITY, SPREAD_PENALTY_THRESHOLD, SPREAD_PENALTY_MAX, BSCI_WEIGHTS, MAX_DETECTOR_CONTRIBUTION, BSCI_SCALE_FACTOR } from '../constants';
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
import { detectRotation } from './rotation';
import { detectAlgorithm } from './algorithm';
import { detectSqueezeFromDetectorInput } from './squeeze-alert';
import { detectPreImpulseFromDetectorInput } from './pre-impulse';
import { detectIcebergFromInput } from './iceberg';
import { detectDistributionFromInput } from './distribution';
import { detectPhaseShiftFromInput } from './phase-shift';
import { detectSpoofFromInput } from './spoof';
import { getSessionQuality } from '../engine/session-filter';
import { createStateStore, IStateStore } from '../state/factory';

// Q-10: EMA smoothing alpha for PREDATOR
const PREDATOR_EMA_ALPHA = 0.3;

/** Все 10 детекторов в массиве. HAWKING теперь async. */
export const ALL_DETECTORS: Array<{ name: DetectorName; detect: (input: DetectorInput) => DetectorResult | Promise<DetectorResult> }> = [
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
  { name: 'ROTATION',     detect: detectRotation },
  { name: 'ALGORITHM',   detect: detectAlgorithm },
  { name: 'SQUEEZE',     detect: detectSqueezeFromDetectorInput },
  { name: 'PREIMPULSE',  detect: detectPreImpulseFromDetectorInput },
  { name: 'ICEBERG',     detect: detectIcebergFromInput },
  { name: 'DISTRIBUTION', detect: detectDistributionFromInput },
  { name: 'PHASE_SHIFT',  detect: detectPhaseShiftFromInput },
  { name: 'SPOOF',        detect: detectSpoofFromInput },
];

/** Запустить все детекторы на одном входе (async для HAWKING) */
export async function runAllDetectors(input: DetectorInput): Promise<DetectorResult[]> {
  // Q-10: Create state store for EMA smoothing
  let stateStore: IStateStore | null = null;
  try {
    stateStore = createStateStore();
  } catch (e) {
    console.warn('[runAllDetectors] StateStore not available, skipping EMA');
  }

  const results = await Promise.all(ALL_DETECTORS.map(async d => {
    try {
      let result = await d.detect(input);

      // Q-10: Apply EMA smoothing to PREDATOR
      if (d.name === 'PREDATOR' && stateStore && input.ticker) {
        const emaKey = `horizon:ema:predator:${input.ticker}`;
        const emaResult = await stateStore.calcEMA(emaKey, result.score, PREDATOR_EMA_ALPHA);

        // Use smoothed score, preserve original in metadata
        result = {
          ...result,
          score: emaResult.smoothed,
          metadata: {
            ...result.metadata,
            emaSmoothed: true,
            emaPrev: emaResult.prev,
            emaDelta: emaResult.delta,
            emaColdStart: emaResult.isColdStart,
          },
        };
      }

      return result;
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
  }));
  return results;
}

/** Q-0: Shadow Mode — запускает детекторы без влияния на алерты
 * Используется для валидации экспериментальных изменений
 * Результаты сохраняются в Redis для анализа, но НЕ влияют на production alerts
 */
export async function runShadowDetectors(input: DetectorInput): Promise<DetectorResult[]> {
  // Run all detectors WITHOUT EMA smoothing (raw scores for comparison)
  const results = await Promise.all(ALL_DETECTORS.map(async d => {
    try {
      const result = await d.detect(input);
      // Mark as shadow run in metadata
      return {
        ...result,
        metadata: {
          ...result.metadata,
          shadowMode: true,
          shadowTimestamp: new Date().toISOString(),
        },
      };
    } catch (e: any) {
      console.warn(`[runShadowDetectors] ${d.name} failed:`, e.message);
      return {
        detector: d.name,
        description: `SHADOW ERROR: ${e.message}`,
        score: 0,
        confidence: 0,
        signal: 'NEUTRAL',
        metadata: { error: e.message, insufficientData: true, shadowMode: true },
      };
    }
  }));
  return results;
}

/** Сравнить shadow и production результаты */
export function compareShadowResults(
  production: DetectorResult[],
  shadow: DetectorResult[]
): { drift: Record<string, number>; maxDrift: number; alerts: string[] } {
  const drift: Record<string, number> = {};
  let maxDrift = 0;
  const alerts: string[] = [];

  for (const prod of production) {
    const shad = shadow.find(s => s.detector === prod.detector);
    if (shad) {
      const diff = Math.abs(prod.score - shad.score);
      drift[prod.detector] = diff;
      if (diff > maxDrift) maxDrift = diff;
      if (diff > 0.1) {
        alerts.push(`${prod.detector}: ${prod.score.toFixed(3)} → ${shad.score.toFixed(3)} (Δ${diff.toFixed(3)})`);
      }
    }
  }

  return { drift, maxDrift, alerts };
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
  /** v4.2: BSCI raw before scale factor (for diagnostics) */
  rawBeforeScale?: number;
  /** v4.2: Session quality (0..1) for metadata only, not multiplied into BSCI */
  sessionQuality?: number;
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
    // result *= sessionQuality; ← REMOVED: sessionQuality now metadata-only
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

  // Soft cap function for continuous saturation
  const softCap = (x: number, limit: number): number => limit * Math.tanh(x / limit);

  // v4.2: Compute multicollinearity penalties
  const multicollPenalties = computeMulticollinearityPenalties(scores);

  // BSCI = Σ softCap(score × weight × penalty, MAX_DETECTOR_CONTRIBUTION)
  let rawBsci = 0;
  let weightTotal = 0;
  let maxScore = 0;
  let topDetector = 'NONE';

  for (const result of scores) {
    let w = weights[result.detector] ?? BSCI_WEIGHTS[result.detector] ?? 0.1;

    // v4.1.2: Снижаем вес для детекторов без данных
    if (result.metadata?.insufficientData || result.metadata?.staleData) {
      w = MIN_WEIGHT;
    }

    // v4.2: Применяем multicollinearity penalty
    const penalty = multicollPenalties[result.detector] ?? 1.0;
    const effectiveWeight = w * penalty;

    // Soft cap per detector contribution
    rawBsci += softCap(result.score * effectiveWeight, MAX_DETECTOR_CONTRIBUTION);
    weightTotal += effectiveWeight;

    if (result.score > maxScore) {
      maxScore = result.score;
      topDetector = result.detector;
    }
  }

  // Apply scale factor
  const bsciRaw = rawBsci * BSCI_SCALE_FACTOR;
  
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
     rawBeforeScale: Math.round(rawBsci * 1000) / 1000,
     sessionQuality: getSessionQuality(),
   };
}
