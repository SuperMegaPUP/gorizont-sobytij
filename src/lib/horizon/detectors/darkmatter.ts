// ─── DARKMATTER — Тёмная материя v4.2 ──────────────────────────────────────
// Обнаружение скрытых ордеров (айсбергов) через энтропию стакана + iceberg из сделок.
//
// v4.2 Формула:
// 1) 80% cutoff (bid / ask отдельно):
//    cutoffLevel = min level where cumvol >= 0.8 × totalSideVolume
//    if cutoffLevel < 3 → use all levels (100%)
//    Guard: cutoff_depth < 5 → entropy_score = 0
//
// 2) Miller-Madow коррекция:
//    H_MM = H_ML + (S - 1) / (2 × W × ln(2))
//    W = cutoff_depth, S = |уникальные объёмы в cutoff|
//
// 3) 5-session median baseline (v1 fallback):
//    expected ≈ log2(avg_cutoff_depth) × 0.85
//
// 4) Entropy score:
//    ΔH_norm = max(0, (expected - observed) / max(expected, ε))
//    observed >= expected → score = 0
//
// 5) Iceberg detection:
//    MIN_ICEBERG_VOLUME = max(0.005 × dailyTurnover, 10 × median_trade_size)
//    consecutive runs n≥3, tolerance: |vol_i - vol_j| / max(vol_i, ε) < 0.05
//    weight = exp(-dist / max(avg_depth, ε))
//    iceberg_score = weighted_average(per_level_score)
//
// 6) darkmatter_score = 0.5 × entropy_score + 0.5 × iceberg_score

import type { DetectorInput, DetectorResult } from './types';
import { safeDivide, clampScore, stalePenalty } from './guards';

const EPS = 1e-6;
const MIN_DELTA_H = 0.15;  // 15% — минимальное отклонение энтропии от ожидаемой
const LN2 = Math.log(2);
const MIN_ICEBERG_VOLUME_RATIO = 0.005; // 0.5% дневного оборота
const MIN_CONSECUTIVE_RUN = 3;
const ICEBERG_TOLERANCE = 0.05;           // 5% допуск

// ─── Вспомогательные функции ────────────────────────────────────────────────

function shannonEntropy(values: number[]): number {
  const total = values.reduce((s, v) => s + v, 0);
  if (total < EPS) return 0;
  let entropy = 0;
  for (const v of values) {
    if (v > 0) {
      const p = v / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

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

function computeCutoffLevel(volumes: number[], targetRatio: number): number {
  const total = volumes.reduce((s, v) => s + v, 0);
  const target = total * targetRatio;
  let cum = 0;
  for (let i = 0; i < volumes.length; i++) {
    cum += volumes[i];
    if (cum >= target) return i + 1;
  }
  return volumes.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function countConsecutiveRuns(tradeVolumes: number[]): number[] {
  if (tradeVolumes.length === 0) return [];
  const runs: number[] = [];
  let currentVol = tradeVolumes[0];
  let runLength = 1;

  for (let i = 1; i < tradeVolumes.length; i++) {
    const relDiff = Math.abs(tradeVolumes[i] - currentVol) / Math.max(currentVol, EPS);
    if (relDiff < ICEBERG_TOLERANCE) {
      runLength++;
    } else {
      if (runLength >= MIN_CONSECUTIVE_RUN) runs.push(runLength);
      currentVol = tradeVolumes[i];
      runLength = 1;
    }
  }
  if (runLength >= MIN_CONSECUTIVE_RUN) runs.push(runLength);
  return runs;
}

// ─── Главный детектор ──────────────────────────────────────────────────────

export function detectDarkmatter(input: DetectorInput): DetectorResult {
  const { orderbook, cumDelta, ofi, recentTrades, trades, tradeOFI } = input;
  const metadata: Record<string, number | string | boolean> = {};

  const allTrades = trades && trades.length > 0 ? trades : recentTrades;

  // ─── Stale guard ────────────────────────────────────────────────────────
  if (input.staleData) {
    const staleFactor = stalePenalty(input.staleMinutes);
    if (staleFactor <= 0) {
      return {
        detector: 'DARKMATTER',
        description: 'Тёмная материя — скрытая ликвидность (устаревшие данные)',
        score: 0,
        confidence: 0,
        signal: 'NEUTRAL',
        metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
      };
    }
  }

  if (allTrades.length < 10) {
    metadata.insufficientData = true;
    return {
      detector: 'DARKMATTER',
      description: 'Тёмная материя — скрытая ликвидность (мало сделок)',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  const obIsEmpty = !orderbook || (orderbook.bids.length === 0 && orderbook.asks.length === 0);

  // ─── Режим 1: Нет стакана — только iceberg detection из сделок ─────────
  if (obIsEmpty) {
    metadata.ofiSource = 'trades';
    metadata.noOrderbook = true;

    const dailyTurnover = allTrades.reduce((s, t) => s + t.quantity * t.price, 0);
    const medianTradeSize = median(allTrades.map(t => t.quantity));
    const minIcebergVolume = Math.max(
      dailyTurnover * MIN_ICEBERG_VOLUME_RATIO,
      10 * medianTradeSize
    );
    metadata.dailyTurnover = Math.round(dailyTurnover);
    metadata.minIcebergVolume = Math.round(minIcebergVolume);

    const avgDepth = median(allTrades.map(t => t.price)); // placeholder для масштаба

    const priceLevelTrades = new Map<number, number[]>();
    for (const t of allTrades) {
      const rounded = Math.round(t.price * 100) / 100;
      if (!priceLevelTrades.has(rounded)) priceLevelTrades.set(rounded, []);
      priceLevelTrades.get(rounded)!.push(t.quantity);
    }

    const prices = allTrades.map(t => t.price).filter(p => p > 0);
    const avgPrice = prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0;

    let icebergScoreWeightedSum = 0;
    let icebergScoreWeightTotal = 0;
    let levelsWithIceberg = 0;
    let totalConsecutiveRuns = 0;

    for (const [price, tradeVolumes] of priceLevelTrades) {
      const levelVolume = tradeVolumes.reduce((s, v) => s + v, 0);
      if (levelVolume < minIcebergVolume) continue;

      const runs = countConsecutiveRuns(tradeVolumes);
      totalConsecutiveRuns += runs.length;
      if (runs.length === 0) continue;

      const maxRun = Math.max(...runs);
      const icebergAtLevel = maxRun / (tradeVolumes.length + EPS);

      const dist = avgPrice > 0 ? Math.abs(price - avgPrice) : 0;
      const weight = Math.exp(-dist / Math.max(avgDepth, EPS));

      icebergScoreWeightedSum += icebergAtLevel * weight;
      icebergScoreWeightTotal += weight;
      levelsWithIceberg++;
    }

    const icebergScore = icebergScoreWeightTotal > EPS
      ? icebergScoreWeightedSum / icebergScoreWeightTotal
      : 0;

    metadata.icebergScore = Math.round(icebergScore * 1000) / 1000;
    metadata.levelsWithIceberg = levelsWithIceberg;
    metadata.totalConsecutiveRuns = totalConsecutiveRuns;

    const score = clampScore(icebergScore);
    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    const effectiveOFI = tradeOFI ? tradeOFI.ofi : ofi;
    if (score > 0.15) {
      signal = effectiveOFI > 0.1 ? 'BULLISH' : effectiveOFI < -0.1 ? 'BEARISH' : 'NEUTRAL';
    }
    const confidence = score > 0.15 ? Math.min(0.8, icebergScore) : 0;

    const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
    return {
      detector: 'DARKMATTER',
      description: 'Тёмная материя — скрытая ликвидность (trade-based, нет стакана)',
      score: clampScore(score * staleFactor),
      confidence: clampScore(confidence * staleFactor),
      signal,
      metadata,
    };
  }

  // ─── Режим 2: Полноценный анализ со стаканом ───────────────────────────

  const bidVolumes = orderbook.bids.map(l => l.quantity);
  const askVolumes = orderbook.asks.map(l => l.quantity);

  // 80% cutoff (bid / ask отдельно)
  const bidCutoff = computeCutoffLevel(bidVolumes, 0.8);
  const askCutoff = computeCutoffLevel(askVolumes, 0.8);
  const cutoffDepth = Math.min(bidCutoff, askCutoff);

  // Guard: cutoff < 3 → use all levels
  const useBidCutoff = bidCutoff >= 3 ? bidCutoff : bidVolumes.length;
  const useAskCutoff = askCutoff >= 3 ? askCutoff : askVolumes.length;

  const cutBidVolumes = bidVolumes.slice(0, useBidCutoff);
  const cutAskVolumes = askVolumes.slice(0, useAskCutoff);
  const allVolumes = [...cutBidVolumes, ...cutAskVolumes];

  metadata.bidCutoff = bidCutoff;
  metadata.askCutoff = askCutoff;
  metadata.cutoffDepth = cutoffDepth;

  // Guard: cutoff_depth < 5 → entropy_score = 0
  if (cutoffDepth < 5) {
    metadata.guardTriggered = 'cutoff_depth_lt_5';
  }

  // ─── 1. Shannon entropy (Maximum Likelihood) ────────────────────────────
  const H_ML = shannonEntropy(allVolumes);

  // Уникальные объёмы в cutoff (для Miller-Madow)
  const uniqueVolumes = new Set(allVolumes.filter(v => v > 0));
  const S_observed = uniqueVolumes.size;
  const W = allVolumes.length;

  // Miller-Madow correction
  const H_MM = H_ML + (S_observed - 1) / (2 * W * LN2);

  metadata.H_ML = Math.round(H_ML * 1000) / 1000;
  metadata.H_MM = Math.round(H_MM * 1000) / 1000;
  metadata.S_observed = S_observed;

  // ─── 2. Expected entropy (v1 fallback) ──────────────────────────────────
  const avgCutoffDepth = (useBidCutoff + useAskCutoff) / 2;
  const expectedEntropy = Math.log2(Math.max(avgCutoffDepth, 1)) * 0.85;
  metadata.expectedEntropy = Math.round(expectedEntropy * 1000) / 1000;

  // ─── 3. Entropy score ───────────────────────────────────────────────────
  let entropyScore = 0;
  if (expectedEntropy > EPS) {
    const deltaH = expectedEntropy - H_MM;
    const deltaHRatio = deltaH > 0 ? deltaH / expectedEntropy : 0;
    // MIN_DELTA_H порог: отклонение < 15% — шум, не сигнал
    // Линейное масштабирование: ΔH=0.15→0, ΔH=0.5→0.41, ΔH=1.0→1.0
    entropyScore = deltaHRatio >= MIN_DELTA_H
      ? (deltaHRatio - MIN_DELTA_H) / (1 - MIN_DELTA_H)
      : 0;
  }
  entropyScore = cutoffDepth < 5 ? 0 : Math.min(1, Math.max(0, entropyScore));
  metadata.deltaH_norm = Math.round(entropyScore * 1000) / 1000;

  // Data quality penalty: если мало данных — энтропия ненадёжна
  const DATA_MIN_POINTS = 100;
  const dataPoints = allTrades ? allTrades.length : cutoffDepth;
  if (dataPoints < DATA_MIN_POINTS) {
    const penalty = dataPoints / DATA_MIN_POINTS;
    entropyScore *= penalty;
    metadata.dataQualityPenalty = 1 - penalty;
  } else {
    metadata.dataQualityPenalty = 0;
  }
  metadata.dataPoints = dataPoints;

  // ─── 4. Iceberg score ───────────────────────────────────────────────────
  const dailyTurnover = allTrades.reduce((s, t) => s + t.quantity * t.price, 0);
  const medianTradeSize = median(allTrades.map(t => t.quantity));
  const minIcebergVolume = Math.max(
    dailyTurnover * MIN_ICEBERG_VOLUME_RATIO,
    10 * medianTradeSize
  );
  metadata.dailyTurnover = Math.round(dailyTurnover);
  metadata.minIcebergVolume = Math.round(minIcebergVolume);

  // Средний спред как масштаб для weight
  const bestBid = orderbook.bids.length > 0 ? orderbook.bids[0].price : 0;
  const bestAsk = orderbook.asks.length > 0 ? orderbook.asks[0].price : 0;
  const spread = bestAsk - bestBid;
  const avgDepth = spread > 0 ? spread : 0.001; // fallback 0.001 если спред нулевой

  const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;

  const priceLevelTrades = new Map<number, number[]>();
  for (const t of allTrades) {
    const rounded = Math.round(t.price * 100) / 100;
    if (!priceLevelTrades.has(rounded)) priceLevelTrades.set(rounded, []);
    priceLevelTrades.get(rounded)!.push(t.quantity);
  }

  let icebergScoreWeightedSum = 0;
  let icebergScoreWeightTotal = 0;
  let levelsWithIceberg = 0;
  let totalConsecutiveRuns = 0;

  for (const [price, tradeVolumes] of priceLevelTrades) {
    const levelVolume = tradeVolumes.reduce((s, v) => s + v, 0);
    if (levelVolume < minIcebergVolume) continue;

    const runs = countConsecutiveRuns(tradeVolumes);
    totalConsecutiveRuns += runs.length;
    if (runs.length === 0) continue;

    const maxRun = Math.max(...runs);
    const icebergAtLevel = maxRun / (tradeVolumes.length + EPS);

    const dist = midPrice > 0 ? Math.abs(price - midPrice) : 0;
    const weight = Math.exp(-dist / Math.max(avgDepth, EPS));

    icebergScoreWeightedSum += icebergAtLevel * weight;
    icebergScoreWeightTotal += weight;
    levelsWithIceberg++;
  }

  const icebergScore = icebergScoreWeightTotal > EPS
    ? icebergScoreWeightedSum / icebergScoreWeightTotal
    : 0;

  metadata.icebergScore = Math.round(icebergScore * 1000) / 1000;
  metadata.levelsWithIceberg = levelsWithIceberg;
  metadata.totalConsecutiveRuns = totalConsecutiveRuns;

  // ─── 5. Итоговый Darkmatter score ───────────────────────────────────────
  const darkmatterScore = 0.5 * entropyScore + 0.5 * icebergScore;
  const score = clampScore(darkmatterScore);

  // ─── 6. Signal direction ────────────────────────────────────────────────
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  const deltaSign = Math.sign(cumDelta.delta);
  const ofiSign = Math.sign(ofi);
  const deltaDiscrepancy = deltaSign !== 0 && ofiSign !== 0 && deltaSign !== ofiSign;

  if (score > 0.15) {
    if (deltaDiscrepancy) {
      signal = cumDelta.delta > 0 ? 'BULLISH' : 'BEARISH';
    } else {
      signal = ofi > 0.1 ? 'BULLISH' : ofi < -0.1 ? 'BEARISH' : 'NEUTRAL';
    }
  }

  const confidence = score > 0.15
    ? Math.min(1, (entropyScore + icebergScore) / 1.2)
    : 0;

  metadata.deltaDiscrepancy = deltaDiscrepancy;

  // Apply stale penalty
  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
  const finalScore = clampScore(score * staleFactor);
  const finalConfidence = clampScore(confidence * staleFactor);
  metadata.staleFactor = staleFactor;

  return {
    detector: 'DARKMATTER',
    description: 'Тёмная материя — скрытая ликвидность (ΔH_norm + iceberg v4.2)',
    score: finalScore,
    confidence: finalConfidence,
    signal,
    metadata,
  };
}
