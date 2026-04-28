// ─── DECOHERENCE — Декогеренция v4.2 ───────────────────────────────────────
// Обнаружение алгоритмической торговли через анализ частотного распределения
// символьного потока, построенного из сделок.
//
// v4.2 Формула (П1):
// 1) Символьный поток:
//    - if (volume <= 0) → SKIP tick (guard от log2(0)=-Infinity)
//    - symbol = sign(dir) × min(round(log2(volume)), 10), clip [-10, +10]
//    - direction: ΔP>0 → +1, ΔP<0 → -1, ΔP=0 → tick_rule
//
// 2) Скользящее окно W=100
//
// 3) Guards:
//    - activeSymbols < 5 → score = 0, "insufficient_alphabet"
//    - price_change_count / W < 0.3 → score = 0, "low_activity"
//    - time_span_ms > 5 × 60 × 1000 → score = 0, "stale_window"
//
// 4) Miller-Madow коррекция:
//    H_MM = H_ML + (S_observed - 1) / (2 × W × ln(2))
//
// 5) H_max с floor:
//    effective_H_max = max(log2(activeSymbols), log2(7))
//    // Минимум 7 символов — ниже недостаточно данных
//
// 6) Score = 1 - (H_MM / effective_H_max)
//    return clampScore(score) ∈ [0, 1]

import type { DetectorInput, DetectorResult } from './types';
import { clampScore, stalePenalty } from './guards';
import { DECOHERENCE_MIN_ACTIVE_SYMBOLS } from '../constants';

const EPS = 1e-6;
const WINDOW_SIZE = 100;
// MIN_ACTIVE_SYMBOLS теперь импортируется из constants.ts
const MIN_ACTIVITY_RATIO = 0.3;
const MAX_WINDOW_SPAN_MS = 5 * 60 * 1000; // 5 минут
const LN2 = Math.log(2);

// ─── Вспомогательные функции ────────────────────────────────────────────────

/**
 * Преобразует сделку в символ.
 * volume <= 0 → null (SKIP tick)
 * symbol = sign(dir) × min(round(log2(volume)), 10)
 * Clip: [-10, +10]
 */
function tradeToSymbol(
  volume: number,
  priceChange: number,
  tickRuleDirection: number
): number | null {
  if (volume <= 0) return null;

  const logVol = Math.min(10, Math.max(0, Math.round(Math.log2(volume))));

  let direction: number;
  if (priceChange > 0) direction = 1;
  else if (priceChange < 0) direction = -1;
  else direction = tickRuleDirection;

  return Math.min(10, Math.max(-10, logVol * direction));
}

function getTickRuleDirection(cumDelta: number, ofi: number, tradeOFI?: { ofi: number }): number {
  if (Math.abs(cumDelta) > EPS) return Math.sign(cumDelta);
  if (Math.abs(ofi) > EPS) return Math.sign(ofi);
  if (tradeOFI && Math.abs(tradeOFI.ofi) > EPS) return Math.sign(tradeOFI.ofi);
  return 0;
}

/**
 * Shannon entropy (Maximum Likelihood estimate).
 * H_ML = -Σ(p_i × log2(p_i)) для p_i > 0
 */
function shannonEntropyML(frequencies: Map<number, number>, total: number): number {
  if (total < EPS) return 0;
  let entropy = 0;
  for (const count of frequencies.values()) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

// ─── Главный детектор ──────────────────────────────────────────────────────

export function detectDecoherence(input: DetectorInput): DetectorResult {
  const { ofi, cumDelta, trades, recentTrades, tradeOFI } = input;
  
  // Initialize all metadata with fallbacks
  const metadata: Record<string, number | string | boolean> = {
    insufficientData: false,
    staleData: false,
    guardTriggered: 'none',
    totalSymbols: 0,
    activeSymbols: 0,
    activityRatio: 0,
    H_ML: 0,
    H_MM: 0,
    effective_H_max: 0,
    rawScore: 0,
    staleFactor: 1,
  };

  // ─── Stale data guard ──────────────────────────────────────────────────
  if (input.staleData) {
    const staleFactor = stalePenalty(input.staleMinutes);
    if (staleFactor <= 0) {
      return {
        detector: 'DECOHERENCE',
        description: 'Декогеренция — символьный поток (устаревшие данные)',
        score: 0,
        confidence: 0,
        signal: 'NEUTRAL',
        metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
      };
    }
  }

  const allTrades = trades && trades.length > 0 ? trades : recentTrades;

  if (allTrades.length < 20) {
    metadata.insufficientData = true;
    return {
      detector: 'DECOHERENCE',
      description: 'Декогеренция — символьный поток (мало сделок)',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  // ─── 1. Скользящее окно W=100 (последние WINDOW_SIZE сделок) ───────────

  const tickRuleDir = getTickRuleDirection(cumDelta.delta, ofi, tradeOFI);
  const windowStartIdx = Math.max(0, allTrades.length - WINDOW_SIZE);
  const symbols: number[] = [];
  let priceChangeCount = 0;

  for (let i = windowStartIdx; i < allTrades.length; i++) {
    const priceChange = i > windowStartIdx ? (allTrades[i].price - allTrades[i - 1].price) : 0;
    if (priceChange !== 0) priceChangeCount++;

    const symbol = tradeToSymbol(allTrades[i].quantity, priceChange, tickRuleDir);
    if (symbol !== null) symbols.push(symbol);
  }

  metadata.totalSymbols = symbols.length;

  // ─── 2. Размер окна по фактическим символам ────────────────────────────

  const windowSymbols = symbols;
  const windowSize = windowSymbols.length;

  if (windowSize < 5) {
    metadata.insufficientData = true;
    return {
      detector: 'DECOHERENCE',
      description: 'Декогеренция — недостаточно символов в окне',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  // ─── 3. Time span guard (> 5 мин) ──────────────────────────────────────

  if (allTrades.length >= 2) {
    const windowStartIdx = Math.max(0, allTrades.length - WINDOW_SIZE);
    const firstTs = allTrades[windowStartIdx].timestamp || 0;
    const lastTs = allTrades[allTrades.length - 1].timestamp || 0;
    const timeSpanMs = lastTs - firstTs;
    metadata.timeSpanMs = timeSpanMs;

    if (timeSpanMs > MAX_WINDOW_SPAN_MS) {
      metadata.guardTriggered = 'time_span_5min';
      return {
        detector: 'DECOHERENCE',
        description: 'Декогеренция — окно слишком растянуто (>5 мин)',
        score: 0,
        confidence: 0,
        signal: 'NEUTRAL',
        metadata,
      };
    }
  }

  // ─── 4. Частотное распределение ────────────────────────────────────────

  const frequencies = new Map<number, number>();
  for (const sym of windowSymbols) {
    frequencies.set(sym, (frequencies.get(sym) || 0) + 1);
  }

  const activeSymbols = frequencies.size;
  metadata.activeSymbols = activeSymbols;
  metadata.freqUniqueCount = frequencies.size;  // для диагностики
  metadata.freqKeys = Array.from(frequencies.keys()).slice(0, 10).join(',');  // первые 10 символов

  // ─── 5. Alphabet guard — soft qualityWeight вместо hard cutoff ────────────
  
  // Soft weight: activeSymbols < 5 → плавное затухание вместо hard 0
  const qualityWeight = activeSymbols > 0 
    ? Math.min(1, activeSymbols / DECOHERENCE_MIN_ACTIVE_SYMBOLS) 
    : 0;
  
  metadata.qualityWeightInput = activeSymbols;  // для диагностики
  
  if (activeSymbols < DECOHERENCE_MIN_ACTIVE_SYMBOLS) {
    metadata.guardTriggered = 'alphabet_lt_5';
  }
  metadata.qualityWeight = Math.round(qualityWeight * 1000) / 1000;

  // ─── 6. Low activity guard (< 30% price changes) ───────────────────────

  const activityRatio = priceChangeCount / windowSize;
  metadata.activityRatio = Math.round(activityRatio * 1000) / 1000;

  if (activityRatio < MIN_ACTIVITY_RATIO) {
    metadata.guardTriggered = 'low_activity';
    return {
      detector: 'DECOHERENCE',
      description: 'Декогеренция — низкая активность (<30% price changes)',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  // ─── 7. Shannon entropy (Maximum Likelihood) ───────────────────────────

  const H_ML = shannonEntropyML(frequencies, windowSize);
  metadata.H_ML = Math.round(H_ML * 1000) / 1000;

  // ─── 8. Miller-Madow correction ────────────────────────────────────────

  const S_observed = activeSymbols;
  const H_MM = H_ML + (S_observed - 1) / (2 * windowSize * LN2);
  metadata.H_MM = Math.round(H_MM * 1000) / 1000;

  // ─── 9. H_max with floor ───────────────────────────────────────────────

  const effective_H_max = Math.max(Math.log2(activeSymbols), Math.log2(7));
  metadata.effective_H_max = Math.round(effective_H_max * 1000) / 1000;

  // ─── 10. Score = 1 - (H_MM / effective_H_max) ──────────────────────────

  let score = 0;
  if (effective_H_max > EPS) {
    score = 1 - (H_MM / effective_H_max);
  }
  score = clampScore(score);
  
  // Применяем soft qualityWeight (вместо hard cutoff)
  score = score * qualityWeight;
  
  metadata.rawScore = score;

  // ─── 11. Signal direction ──────────────────────────────────────────────

  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.15) {
    let dominantSymbol = 0;
    let dominantFreq = 0;
    for (const [sym, count] of frequencies) {
      if (count > dominantFreq) {
        dominantFreq = count;
        dominantSymbol = sym;
      }
    }
    if (dominantSymbol > 0) signal = 'BULLISH';
    else if (dominantSymbol < 0) signal = 'BEARISH';
    else signal = cumDelta.delta > 0 ? 'BULLISH' : cumDelta.delta < 0 ? 'BEARISH' : 'NEUTRAL';
    metadata.dominantSymbol = dominantSymbol;
  }

  const confidence = score > 0.15 ? Math.min(1, score * 1.2) : 0;

  // ─── 12. Stale penalty ─────────────────────────────────────────────────

  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
  const finalScore = clampScore(score * staleFactor);
  const finalConfidence = clampScore(confidence * staleFactor);
  metadata.staleFactor = staleFactor;

  return {
    detector: 'DECOHERENCE',
    description: 'Декогеренция — символьный поток (Miller-Madow v4.2)',
    score: finalScore,
    confidence: finalConfidence,
    signal,
    metadata,
  };
}
