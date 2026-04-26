// ─── DARKMATTER — Тёмная материя (скрытая ликвидность) ──────────────────────
// Обнаружение скрытых ордеров (айсбергов) через два механизма:
//
// v5.0: Trade-based fallback — когда orderbook пуст (ДСВД выходные),
// работаем только через iceberg detection из сделок + tradeOFI для направления
//
// v4.1 Формула:
// 1) expected_entropy:
//    - median_entropy_sessions (пересчитывается ежедневно)
//    - Альтернатива v1: expected_entropy = f(avg_depth, spread)
//
// 2) darkmatter_entropy_score:
//    - observed_entropy = Shannon_entropy(объёмы_по_уровням_стакана)
//    - ΔH_norm = (expected_entropy - observed_entropy) / (expected_entropy + ε)
//    - observed >= expected → score = 0 (нет аномалии)
//    - observed < expected → score = ΔH_norm, диапазон (0, 1]
//
// 3) iceberg_score:
//    - Группируем сделки по price_level
//    - Ищем consecutive runs одинакового объёма (подряд идущие!)
//    - Минимальная длина run: n_consecutive ≥ 3
//    - Минимальный объём: levelVolume >= 0.005 * dailyTurnover (0.5% дневного оборота)
//    - Если levelVolume < MIN_ICEBERG_VOLUME → iceberg_score_at_level = 0
//    - iceberg_score_at_level = n_consecutive_same_vol / n_total_at_level
//    - weight = 1 / (1 + distance_from_best)
//    - iceberg_score = weighted_average(iceberg_score_at_level)
//
// 4) darkmatter_score = 0.5 * darkmatter_entropy_score + 0.5 * iceberg_score

import type { DetectorInput, DetectorResult } from './types';
import { safeDivide, clampScore, stalePenalty } from './guards';

const EPS = 1e-6;
const MIN_ICEBERG_VOLUME_RATIO = 0.005; // 0.5% дневного оборота
const MIN_CONSECUTIVE_RUN = 3;           // Минимальная длина consecutive run

// ─── Вспомогательные функции ────────────────────────────────────────────────

/**
 * Shannon entropy для массива значений.
 * H = -sum(p_i * log2(p_i)) для всех p_i > 0
 */
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

/**
 * Оценка expected_entropy на основе параметров стакана.
 * Используем простую эвристику: чем больше уровней и чем равномернее объём,
// тем выше ожидаемая энтропия.
 * expected_entropy ≈ log2(n_levels) * uniformity_factor
 */
function estimateExpectedEntropy(levels: number[], volumes: number[]): number {
  if (levels.length === 0) return 0;

  // Maximum entropy = log2(n_levels) при равномерном распределении
  const maxEntropy = Math.log2(levels.length);

  // Реальная энтропия объёмов
  const actualEntropy = shannonEntropy(volumes);

  // Expected = среднее между max и actual (смещение к max — «нормальный» стакан
  // имеет относительно равномерное распределение)
  return maxEntropy * 0.7 + actualEntropy * 0.3;
}

/**
 * Подсчёт consecutive runs одинакового объёма.
 * Ищем подряд идущие сделки с одинаковым объёмом на одном ценовом уровне.
 * Возвращает максимальную длину consecutive run.
 */
function countConsecutiveRuns(tradeVolumes: number[]): number[] {
  if (tradeVolumes.length === 0) return [];

  const runs: number[] = [];
  let currentVol = tradeVolumes[0];
  let runLength = 1;

  for (let i = 1; i < tradeVolumes.length; i++) {
    // Округляем объём для сравнения (избегаем проблем с float)
    const volRound = Math.round(tradeVolumes[i] * 100);
    const curRound = Math.round(currentVol * 100);

    if (volRound === curRound) {
      runLength++;
    } else {
      if (runLength >= MIN_CONSECUTIVE_RUN) {
        runs.push(runLength);
      }
      currentVol = tradeVolumes[i];
      runLength = 1;
    }
  }

  // Последний run
  if (runLength >= MIN_CONSECUTIVE_RUN) {
    runs.push(runLength);
  }

  return runs;
}

// ─── Главный детектор ──────────────────────────────────────────────────────

export function detectDarkmatter(input: DetectorInput): DetectorResult {
  const { orderbook, cumDelta, ofi, recentTrades, trades, tradeOFI } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // ─── 0. Проверка достаточности данных ────────────────────────────────────
  const allTrades = trades && trades.length > 0 ? trades : recentTrades;

  // v4.2: Gradual stale penalty instead of binary stale→0
  if (input.staleData) {
    const staleFactor = stalePenalty(input.staleMinutes);
    if (staleFactor <= 0) {
      metadata.insufficientData = true;
      metadata.staleData = true;
      metadata.staleMinutes = input.staleMinutes ?? 0;
      return {
        detector: 'DARKMATTER',
        description: 'Тёмная материя — скрытая ликвидность (устаревшие данные)',
        score: 0,
        confidence: 0,
        signal: 'NEUTRAL',
        metadata,
      };
    }
    // If stale but not completely dead, proceed with computation but apply penalty later
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

  const obIsEmpty = orderbook.bids.length === 0 && orderbook.asks.length === 0;

  // ─── Режим 1: Нет стакана — только iceberg detection из сделок ─────────
  if (obIsEmpty) {
    metadata.ofiSource = 'trades';

    // Entropy score = 0 (нет стакана — не можем считать энтропию уровней)
    const entropyScore = 0;
    metadata.entropyScore = 0;
    metadata.noOrderbook = true;

    // Iceberg score — полностью из сделок (тот же алгоритм, но mid из trades)
    const dailyTurnover = allTrades.reduce((s, t) => s + t.quantity * t.price, 0);
    const minIcebergVolume = dailyTurnover * MIN_ICEBERG_VOLUME_RATIO;
    metadata.dailyTurnover = Math.round(dailyTurnover);
    metadata.minIcebergVolume = Math.round(minIcebergVolume);

    // Группируем сделки по ценовым уровням
    const priceLevelTrades = new Map<number, number[]>();
    for (const t of allTrades) {
      const rounded = Math.round(t.price * 100) / 100;
      if (!priceLevelTrades.has(rounded)) {
        priceLevelTrades.set(rounded, []);
      }
      priceLevelTrades.get(rounded)!.push(t.quantity);
    }

    // Средняя цена как "mid" для расстояния
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

      const distance = avgPrice > 0 ? Math.abs(price - avgPrice) / (avgPrice + EPS) : 0;
      const weight = 1 / (1 + distance * 10);

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

    // Score: 0% entropy + 100% iceberg (нет стакана — энтропия невозможна)
    const darkmatterScore = icebergScore;
    const score = Math.min(1, Math.max(0, darkmatterScore));

    // Signal direction — используем tradeOFI если есть, иначе cumDelta
    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    const effectiveOFI = tradeOFI ? tradeOFI.ofi : ofi;

    const deltaSign = Math.sign(cumDelta.delta);
    const ofiSign = Math.sign(effectiveOFI);
    const deltaDiscrepancy = deltaSign !== 0 && ofiSign !== 0 && deltaSign !== ofiSign;

    if (score > 0.15) {
      if (deltaDiscrepancy) {
        signal = cumDelta.delta > 0 ? 'BULLISH' : 'BEARISH';
      } else {
        signal = effectiveOFI > 0.1 ? 'BULLISH' : effectiveOFI < -0.1 ? 'BEARISH' : 'NEUTRAL';
      }
    }

    // Confidence ниже без стакана (только iceberg, нет entropy)
    const confidence = score > 0.15
      ? Math.min(0.8, icebergScore / 1.0)
      : 0;

    metadata.deltaDiscrepancy = deltaDiscrepancy;

    // Apply stale penalty (v4.2: gradual instead of binary)
    const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
    const finalScore = clampScore(score * staleFactor);
    const finalConfidence = clampScore(confidence * staleFactor);
    metadata.staleFactor = staleFactor;

    return {
      detector: 'DARKMATTER',
      description: 'Тёмная материя — скрытая ликвидность (trade-based, нет стакана)',
      score: finalScore,
      confidence: finalConfidence,
      signal,
      metadata,
    };
  }

  // ─── Режим 2: Полноценный анализ с стаканом ────────────────────────────

  // ─── 1. ΔH_norm — Shannon entropy score ────────────────────────────────

  // Собираем объёмы по уровням стакана (bid + ask)
  const bidVolumes = orderbook.bids.map(l => l.quantity);
  const askVolumes = orderbook.asks.map(l => l.quantity);
  const allVolumes = [...bidVolumes, ...askVolumes];
  const allLevels = [
    ...orderbook.bids.map((_, i) => i),
    ...orderbook.asks.map((_, i) => i),
  ];

  // Наблюдаемая энтропия
  const observedEntropy = shannonEntropy(allVolumes);

  // Ожидаемая энтропия (оценка)
  const expectedEntropy = estimateExpectedEntropy(allLevels, allVolumes);

  // ΔH_norm = (expected - observed) / (expected + ε)
  let entropyScore = 0;
  if (expectedEntropy > EPS) {
    const deltaH = expectedEntropy - observedEntropy;
    if (deltaH > 0) {
      // observed < expected → аномалия (скрытая ликвидность)
      entropyScore = safeDivide(deltaH, expectedEntropy, 0.01);
    }
    // observed >= expected → нет аномалии, score = 0
  }

  entropyScore = Math.min(1, Math.max(0, entropyScore));

  metadata.observedEntropy = Math.round(observedEntropy * 1000) / 1000;
  metadata.expectedEntropy = Math.round(expectedEntropy * 1000) / 1000;
  metadata.deltaH_norm = Math.round(entropyScore * 1000) / 1000;

  // ─── 2. Iceberg score — consecutive runs одинакового объёма ────────────

  // Считаем дневной оборот из recentTrades
  const dailyTurnover = allTrades.reduce((s, t) => s + t.quantity * t.price, 0);
  const minIcebergVolume = dailyTurnover * MIN_ICEBERG_VOLUME_RATIO;

  metadata.dailyTurnover = Math.round(dailyTurnover);
  metadata.minIcebergVolume = Math.round(minIcebergVolume);

  // Группируем сделки по ценовым уровням
  const priceLevelTrades = new Map<number, number[]>();
  for (const t of allTrades) {
    const rounded = Math.round(t.price * 100) / 100;
    if (!priceLevelTrades.has(rounded)) {
      priceLevelTrades.set(rounded, []);
    }
    priceLevelTrades.get(rounded)!.push(t.quantity);
  }

  // Для каждого уровня: ищем consecutive runs и считаем iceberg score
  const midPrice = orderbook.bids.length > 0 && orderbook.asks.length > 0
    ? (orderbook.bids[0].price + orderbook.asks[0].price) / 2
    : 0;

  let icebergScoreWeightedSum = 0;
  let icebergScoreWeightTotal = 0;
  let levelsWithIceberg = 0;
  let totalConsecutiveRuns = 0;

  for (const [price, tradeVolumes] of priceLevelTrades) {
    const levelVolume = tradeVolumes.reduce((s, v) => s + v, 0);

    // Фильтр: уровень должен иметь минимум 0.5% дневного оборота
    if (levelVolume < minIcebergVolume) continue;

    // Ищем consecutive runs
    const runs = countConsecutiveRuns(tradeVolumes);
    totalConsecutiveRuns += runs.length;

    if (runs.length === 0) continue;

    // iceberg_score_at_level = max(run_length) / n_total_at_level
    const maxRun = Math.max(...runs);
    const icebergAtLevel = maxRun / (tradeVolumes.length + EPS);

    // Weight = 1 / (1 + distance_from_best)
    const distance = midPrice > 0 ? Math.abs(price - midPrice) / (midPrice + EPS) : 0;
    const weight = 1 / (1 + distance * 10); // 10 = масштабный коэффициент

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

  // ─── 3. Итоговый Darkmatter score ──────────────────────────────────────

  const darkmatterScore = 0.5 * entropyScore + 0.5 * icebergScore;
  const score = Math.min(1, Math.max(0, darkmatterScore));

  // ─── 4. Signal direction ───────────────────────────────────────────────

  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';

  // Delta-OFI discrepancy: CumDelta direction ≠ OFI direction
  const deltaSign = Math.sign(cumDelta.delta);
  const ofiSign = Math.sign(ofi);
  const deltaDiscrepancy = deltaSign !== 0 && ofiSign !== 0 && deltaSign !== ofiSign;

  if (score > 0.15) {
    if (deltaDiscrepancy) {
      // CumDelta — более «честный» (реальные сделки)
      signal = cumDelta.delta > 0 ? 'BULLISH' : 'BEARISH';
    } else {
      // Если нет расхождения — определяем по OFI
      signal = ofi > 0.1 ? 'BULLISH' : ofi < -0.1 ? 'BEARISH' : 'NEUTRAL';
    }
  }

  const confidence = score > 0.15
    ? Math.min(1, (entropyScore + icebergScore) / 1.2)
    : 0;

  metadata.deltaDiscrepancy = deltaDiscrepancy;

  // Apply stale penalty (v4.2: gradual instead of binary)
  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
  const finalScore = clampScore(score * staleFactor);
  const finalConfidence = clampScore(confidence * staleFactor);
  metadata.staleFactor = staleFactor;

  return {
    detector: 'DARKMATTER',
    description: 'Тёмная материя — скрытая ликвидность (ΔH_norm + iceberg)',
    score: finalScore,
    confidence: finalConfidence,
    signal,
    metadata,
  };
}
