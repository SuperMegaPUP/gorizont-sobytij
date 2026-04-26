// ─── level-calculator.ts — Расчёт уровней для торгового сигнала ──────────────
// ATR(14) для stop/target расчёта
// Support/Resistance за 30 свечей
// estimated_stops: volume_cluster + round_number + breakout_freq + VWAP_dist
// Коэффициенты 0.35 / 0.25 / 0.25 / 0.15 (калибруются в Sprint 5)

import type { Candle } from '../calculations/vpin';
import type { Trade } from '../calculations/delta';
import type { OrderBookData } from '../calculations/ofi';

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface LevelResult {
  /** Цена входа (текущая) */
  entryPrice: number;
  /** Диапазон входа ±0.3 ATR */
  entryZone: [number, number];
  /** Стоп-лосс */
  stopLoss: number;
  /** Таргет 1: +2 ATR */
  T1: number;
  /** Таргет 2: +3.5 ATR */
  T2: number;
  /** Таргет 3: ближайший S/R */
  T3: number;
  /** Risk:Reward Ratio (T1 / stop-distance) */
  riskRewardRatio: number;
  /** ATR значение */
  atr: number;
  /** Найденные уровни поддержки */
  supports: number[];
  /** Найденные уровни сопротивления */
  resistances: number[];
  /** estimated_stops значение для стоп-уровня */
  stopStrength: number;
}

export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number; // 0-1 (объём + количество касаний)
  volume: number;
  touches: number;
}

// ─── Параметризованные коэффициенты ──────────────────────────────────────────

/** Коэффициенты estimated_stops (калибруются в Sprint 5) */
export const ESTIMATED_STOPS_WEIGHTS = {
  volumeClusterDensity: 0.35,
  roundNumberBonus: 0.25,
  breakoutFrequency: 0.25,
  vwapDistancePenalty: 0.15,
} as const;

// ─── ATR(14) ────────────────────────────────────────────────────────────────

/**
 * Вычисляет ATR(14) из массива свечей.
 * Использует Wilder smoothing для стабильности.
 */
export function calcATR(candles: Candle[], period: number = 14): number {
  if (candles.length < 2) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const highLow = candles[i].high - candles[i].low;
    const highClose = Math.abs(candles[i].high - candles[i - 1].close);
    const lowClose = Math.abs(candles[i].low - candles[i - 1].close);
    trueRanges.push(Math.max(highLow, highClose, lowClose));
  }

  if (trueRanges.length === 0) return 0;

  if (trueRanges.length <= period) {
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }

  // Wilder smoothing
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

// ─── Support/Resistance за 30 свечей ────────────────────────────────────────

/**
 * Находит уровни поддержки и сопротивления за последние N свечей.
 *
 * Алгоритм:
 * 1. Локальные экстремумы (high/low) с объёмом > 1.5× средний
 * 2. Группировка в кластеры ±0.5 ATR
 * 3. Сортировка по силе (объём + касания)
 */
export function findSupportResistance(
  candles: Candle[],
  atr: number,
  lookback: number = 30,
): SupportResistanceLevel[] {
  if (candles.length < 5 || atr <= 0) return [];

  const recent = candles.slice(-lookback);
  const avgVolume = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
  const volumeThreshold = avgVolume * 1.5;
  const clusterRadius = atr * 0.5;

  // Собираем локальные экстремумы
  const rawLevels: Array<{ price: number; type: 'support' | 'resistance'; volume: number }> = [];

  for (let i = 1; i < recent.length - 1; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    const next = recent[i + 1];

    // Локальный максимум (resistance)
    if (curr.high > prev.high && curr.high > next.high) {
      rawLevels.push({
        price: curr.high,
        type: 'resistance',
        volume: curr.volume,
      });
    }

    // Локальный минимум (support)
    if (curr.low < prev.low && curr.low < next.low) {
      rawLevels.push({
        price: curr.low,
        type: 'support',
        volume: curr.volume,
      });
    }
  }

  // Фильтруем по объёму (>1.5× средний — значимые уровни)
  const significantLevels = rawLevels.filter(l => l.volume >= volumeThreshold);

  // Если мало значимых — берём все экстремумы
  const levelsToCluster = significantLevels.length >= 3 ? significantLevels : rawLevels;

  // Группировка в кластеры ±0.5 ATR
  const clusters: SupportResistanceLevel[] = [];

  for (const level of levelsToCluster) {
    // Ищем существующий кластер рядом
    const nearbyCluster = clusters.find(
      c => Math.abs(c.price - level.price) <= clusterRadius && c.type === level.type,
    );

    if (nearbyCluster) {
      // Обновляем кластер: средневзвешенная цена, суммарный объём, +1 касание
      const totalVol = nearbyCluster.volume + level.volume;
      nearbyCluster.price = (nearbyCluster.price * nearbyCluster.volume + level.price * level.volume) / totalVol;
      nearbyCluster.volume = totalVol;
      nearbyCluster.touches += 1;
    } else {
      // Новый кластер
      clusters.push({
        price: level.price,
        type: level.type,
        strength: 0, // вычислим ниже
        volume: level.volume,
        touches: 1,
      });
    }
  }

  // Вычисляем strength: нормализованный объём + бонус за касания
  if (clusters.length > 0) {
    const maxVolume = Math.max(...clusters.map(c => c.volume));
    for (const c of clusters) {
      const volumeNorm = maxVolume > 0 ? c.volume / maxVolume : 0;
      const touchBonus = Math.min(c.touches / 5, 0.3); // максимум 0.3 за 5+ касаний
      c.strength = Math.min(1, volumeNorm * 0.7 + touchBonus);
    }
  }

  // Сортируем по силе (сильнейшие первыми)
  clusters.sort((a, b) => b.strength - a.strength);

  return clusters;
}

// ─── estimated_stops ─────────────────────────────────────────────────────────

/**
 * Вычисляет estimated_stops(level) — силу стоп-уровня.
 * Формула из PREDATOR v4 / SIGNALS spec.
 *
 * estimated_stops(level) =
 *   0.35 × volume_cluster_density +
 *   0.25 × round_number_bonus +
 *   0.25 × recent_breakout_frequency +
 *   0.15 × vwap_distance_penalty
 */
export function estimatedStops(
  level: number,
  trades: Trade[],
  candles: Candle[],
  vwap: number,
): number {
  const w = ESTIMATED_STOPS_WEIGHTS;

  // 1) volume_cluster_density(level) = sum(volume within ±2 ticks) / (avg_volume_per_tick_range + ε)
  const tickSize = trades.length >= 2
    ? Math.min(
        ...trades.slice(0, 50).filter((t, i) => i > 0 && t.price !== trades[i - 1]?.price)
          .map((t, i, arr) => {
            const prev = trades.find(pt => pt.price < t.price);
            return prev ? t.price - prev.price : t.price;
          })
          .filter(d => d > 0)
          .slice(0, 10)
      ) || 0.01
    : 0.01;

  const nearTrades = trades.filter(t => Math.abs(t.price - level) <= tickSize * 2);
  const volumeNearLevel = nearTrades.reduce((s, t) => s + t.quantity, 0);
  const avgVolumePerTickRange = trades.length > 0
    ? trades.reduce((s, t) => s + t.quantity, 0) / trades.length
    : 1;
  const volumeClusterDensity = volumeNearLevel / (avgVolumePerTickRange + 0.001);

  // 2) round_number_bonus(level) = 1 если level кратен 5/10 пунктам, иначе 0
  const roundNumberBonus = (level % 5 === 0 || level % 10 === 0) ? 1 : 0;

  // 3) recent_breakout_frequency(level) = count(breakouts) / (N + ε)
  let breakoutCount = 0;
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const currClose = candles[i].close;
    // Пробой уровня: цена пересекла level
    if ((prevClose < level && currClose >= level) || (prevClose > level && currClose <= level)) {
      breakoutCount++;
    }
  }
  const breakoutFrequency = breakoutCount / (candles.length + 0.001);

  // 4) vwap_distance_penalty(level) = 1 - min(|level - VWAP|, max_dist) / (max_dist + ε)
  const maxDist = vwap > 0 ? vwap * 0.05 : 100; // 5% от VWAP или 100
  const vwapDistance = Math.abs(level - vwap);
  const vwapDistancePenalty = 1 - Math.min(vwapDistance, maxDist) / (maxDist + 0.001);

  // Итоговая формула
  const result =
    w.volumeClusterDensity * Math.min(volumeClusterDensity, 1) +
    w.roundNumberBonus * roundNumberBonus +
    w.breakoutFrequency * Math.min(breakoutFrequency * 5, 1) +  // масштабируем: 20% пробоев = 1
    w.vwapDistancePenalty * vwapDistancePenalty;

  return Math.min(1, Math.max(0, result));
}

// ─── Главная функция ─────────────────────────────────────────────────────────

export interface LevelCalculatorInput {
  candles: Candle[];
  trades: Trade[];
  orderbook?: OrderBookData;
  currentPrice: number;
  direction: 'LONG' | 'SHORT';
  vwap: number;
}

/**
 * Рассчитывает все уровни для сигнала: entry, stop, T1, T2, T3.
 *
 * Для ЛОНГ:
 *   entryZone = [currentPrice ± 0.3 × ATR]
 *   stopLoss = nearestSupport − 0.5 × ATR
 *   T1 = currentPrice + 2 × ATR
 *   T2 = currentPrice + 3.5 × ATR
 *   T3 = nearestResistance
 *
 * Для ШОРТ:
 *   entryZone = [currentPrice ± 0.3 × ATR]
 *   stopLoss = nearestResistance + 0.5 × ATR
 *   T1 = currentPrice − 2 × ATR
 *   T2 = currentPrice − 3.5 × ATR
 *   T3 = nearestSupport
 */
export function calculateLevels(input: LevelCalculatorInput): LevelResult {
  const { candles, trades, currentPrice, direction, vwap } = input;
  const atr = calcATR(candles, 14);

  // Fallback ATR: если данных мало, используем 0.5% от цены
  const effectiveATR = atr > 0 ? atr : currentPrice * 0.005;

  // S/R уровни за 30 свечей
  const srLevels = findSupportResistance(candles, effectiveATR, 30);
  const supports = srLevels.filter(l => l.type === 'support').map(l => l.price);
  const resistances = srLevels.filter(l => l.type === 'resistance').map(l => l.price);

  // entryZone ±0.3 ATR
  const entryZone: [number, number] = [
    currentPrice - 0.3 * effectiveATR,
    currentPrice + 0.3 * effectiveATR,
  ];

  let stopLoss: number;
  let T1: number;
  let T2: number;
  let T3: number;

  if (direction === 'LONG') {
    // Стоп: ближайшая поддержка − 0.5 ATR (или price − 1.5 ATR если поддержки нет)
    const nearestSupport = supports.length > 0
      ? supports.filter(s => s < currentPrice).sort((a, b) => b - a)[0]  // ближайшая ниже текущей
      : null;
    stopLoss = nearestSupport
      ? nearestSupport - 0.5 * effectiveATR
      : currentPrice - 1.5 * effectiveATR;

    T1 = currentPrice + 2 * effectiveATR;
    T2 = currentPrice + 3.5 * effectiveATR;

    // T3: ближайшее сопротивление выше (или T2 + ATR как fallback)
    const nearestResistance = resistances.length > 0
      ? resistances.filter(r => r > currentPrice).sort((a, b) => a - b)[0]
      : null;
    T3 = nearestResistance || (T2 + effectiveATR);
  } else {
    // SHORT
    // Стоп: ближайшее сопротивление + 0.5 ATR (или price + 1.5 ATR)
    const nearestResistance = resistances.length > 0
      ? resistances.filter(r => r > currentPrice).sort((a, b) => a - b)[0]
      : null;
    stopLoss = nearestResistance
      ? nearestResistance + 0.5 * effectiveATR
      : currentPrice + 1.5 * effectiveATR;

    T1 = currentPrice - 2 * effectiveATR;
    T2 = currentPrice - 3.5 * effectiveATR;

    // T3: ближайшая поддержка ниже
    const nearestSupport = supports.length > 0
      ? supports.filter(s => s < currentPrice).sort((a, b) => b - a)[0]
      : null;
    T3 = nearestSupport || (T2 - effectiveATR);
  }

  // Risk:Reward Ratio
  const stopDistance = Math.abs(currentPrice - stopLoss);
  const t1Distance = Math.abs(T1 - currentPrice);
  const riskRewardRatio = stopDistance > 0 ? t1Distance / stopDistance : 0;

  // estimated_stops для стоп-уровня
  const stopStrength = estimatedStops(stopLoss, trades, candles, vwap);

  return {
    entryPrice: currentPrice,
    entryZone,
    stopLoss: Math.round(stopLoss * 100) / 100,
    T1: Math.round(T1 * 100) / 100,
    T2: Math.round(T2 * 100) / 100,
    T3: Math.round(T3 * 100) / 100,
    riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
    atr: Math.round(effectiveATR * 100) / 100,
    supports: supports.map(p => Math.round(p * 100) / 100),
    resistances: resistances.map(p => Math.round(p * 100) / 100),
    stopStrength: Math.round(stopStrength * 1000) / 1000,
  };
}
