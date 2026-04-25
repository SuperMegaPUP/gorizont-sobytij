// ─── ta-context.ts ──────────────────────────────────────────────────────────
// Контекстный слой техиндикаторов — НЕ входит в BSCI!
// 5 индикаторов из OHLCV для сравнения с детекторами:
//   RSI(14), CMF(20), CRSI(3), ATR(14), VWAP
//
// Логика: сравнение детекторов с ТА → конвергенция/дивергенция
// Дивергенция = самый ценный сигнал (кит виден, ТА нет → скрытая активность)

import type { Candle } from '../calculations/vpin';
import type { Trade } from '../calculations/delta';
import type { OrderBookData } from '../calculations/ofi';

// ─── TA Indicator Results ───────────────────────────────────────────────────

export interface TAIndicators {
  /** RSI(14) — Relative Strength Index: 0-100 */
  rsi: number;
  /** RSI zone: OVERSOLD <30 | NEUTRAL 30-70 | OVERBOUGHT >70 */
  rsiZone: 'OVERSOLD' | 'NEUTRAL' | 'OVERBOUGHT';
  /** CMF(20) — Chaikin Money Flow: -1..+1 */
  cmf: number;
  /** CMF zone: POSITIVE >0 | NEUTRAL ~0 | NEGATIVE <0 */
  cmfZone: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  /** CRSI(3) — Connors RSI (short-term): 0-100 */
  crsi: number;
  /** CRSI zone: OVERSOLD <20 | NEUTRAL 20-80 | OVERBOUGHT >80 */
  crsiZone: 'OVERSOLD' | 'NEUTRAL' | 'OVERBOUGHT';
  /** ATR(14) — Average True Range (normalized to price: 0-1) */
  atr: number;
  /** ATR percentile in historical range: 0-1 */
  atrPercentile: number;
  /** ATR zone: COMPRESSED <0.2 | NORMAL 0.2-0.8 | EXPANDED >0.8 */
  atrZone: 'COMPRESSED' | 'NORMAL' | 'EXPANDED';
  /** VWAP — Volume Weighted Average Price */
  vwap: number;
  /** Price position relative to VWAP: -1..+1 (below/above) */
  vwapDeviation: number;
  /** VWAP zone: BELOW <-0.01 | AT_VWAP ~0 | ABOVE >+0.01 */
  vwapZone: 'BELOW' | 'AT_VWAP' | 'ABOVE';
}

// ─── Signal Convergence Model ───────────────────────────────────────────────

export type ConvergenceSignal =
  | 'STRONG_BULL'    // BSCI бычий + ТА бычий → уверенный бычий
  | 'BULL'           // BSCI бычий или ТА бычий → умеренный бычий
  | 'NEUTRAL'        // Нет согласованности
  | 'BEAR'           // BSCI медвежий или ТА медвежий → умеренный медвежий
  | 'STRONG_BEAR';   // BSCI медвежий + ТА медвежий → уверенный медвежий

export interface SignalConvergence {
  /** Итоговый сигнал конвергенции */
  signal: ConvergenceSignal;
  /** Есть дивергенция между детекторами и ТА */
  divergence: boolean;
  /** Описание дивергенции (для UI) */
  divergenceNote: string;
  /** Направление BSCI (из детекторов) */
  bsciDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  /** Направление ТА (из индикаторов) */
  taDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  /** Сила конвергенции: 0 = полное расхождение, 1 = полное совпадение */
  convergenceStrength: number;
  /** TA индикаторы (детали) */
  indicators: TAIndicators;
}

// ─── RSI(14) ────────────────────────────────────────────────────────────────

function calcRSI(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 50; // нейтральный при нехватке данных

  let gains = 0;
  let losses = 0;

  // Начальное среднее
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Сглаженное среднее (Wilder)
  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ─── CRSI(3) — Connors RSI ──────────────────────────────────────────────────
// CRSI = (RSI(3) + Streak RSI + Percent Rank) / 3

function calcCRSI(candles: Candle[], period: number = 3): number {
  if (candles.length < period + 1) return 50;

  // 1. RSI(3)
  const rsi3 = calcRSI(candles, period);

  // 2. Streak RSI — считаем серию подряд идущих up/down дней
  const streaks: number[] = [];
  let currentStreak = 0;
  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) {
      currentStreak = currentStreak > 0 ? currentStreak + 1 : 1;
    } else if (change < 0) {
      currentStreak = currentStreak < 0 ? currentStreak - 1 : -1;
    } else {
      currentStreak = 0;
    }
    streaks.push(currentStreak);
  }

  // RSI от streaks
  let streakRSI = 50;
  if (streaks.length >= period + 1) {
    let sg = 0, sl = 0;
    const recentStreaks = streaks.slice(-period - 1);
    for (let i = 1; i < recentStreaks.length; i++) {
      const diff = recentStreaks[i] - recentStreaks[i - 1];
      if (diff > 0) sg += diff;
      else sl += Math.abs(diff);
    }
    const sag = sg / period;
    const sal = sl / period;
    if (sal === 0) streakRSI = 100;
    else streakRSI = 100 - (100 / (1 + sag / sal));
  }

  // 3. Percent Rank — сколько % изменений были менее текущего
  const changes: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    changes.push(candles[i].close - candles[i - 1].close);
  }
  const lastChange = changes[changes.length - 1] || 0;
  const percentRank = changes.length > 0
    ? changes.filter(c => c < lastChange).length / changes.length * 100
    : 50;

  return (rsi3 + streakRSI + percentRank) / 3;
}

// ─── CMF(20) — Chaikin Money Flow ───────────────────────────────────────────

function calcCMF(candles: Candle[], period: number = 20): number {
  if (candles.length < 2) return 0;

  const recent = candles.slice(-Math.min(period, candles.length));

  let sumMFV = 0;
  let sumVol = 0;

  for (const c of recent) {
    const highLow = c.high - c.low;
    if (highLow === 0) continue;

    // Money Flow Multiplier
    const mfm = ((c.close - c.low) - (c.high - c.close)) / highLow;
    // Money Flow Volume
    const mfv = mfm * c.volume;

    sumMFV += mfv;
    sumVol += c.volume;
  }

  return sumVol > 0 ? sumMFV / sumVol : 0;
}

// ─── ATR(14) — Average True Range ───────────────────────────────────────────

function calcATR(candles: Candle[], period: number = 14): { atr: number; normalized: number } {
  if (candles.length < 2) return { atr: 0, normalized: 0 };

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const highLow = candles[i].high - candles[i].low;
    const highClose = Math.abs(candles[i].high - candles[i - 1].close);
    const lowClose = Math.abs(candles[i].low - candles[i - 1].close);
    trueRanges.push(Math.max(highLow, highClose, lowClose));
  }

  if (trueRanges.length === 0) return { atr: 0, normalized: 0 };

  // Простой ATR (для коротких серий)
  if (trueRanges.length <= period) {
    const atr = trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
    const lastClose = candles[candles.length - 1].close;
    return { atr, normalized: lastClose > 0 ? atr / lastClose : 0 };
  }

  // Wilder smoothing
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  const lastClose = candles[candles.length - 1].close;
  return { atr, normalized: lastClose > 0 ? atr / lastClose : 0 };
}

// ─── ATR Percentile (percentile of current ATR vs recent ATRs) ──────────────

function calcATRPercentile(candles: Candle[], period: number = 14, lookback: number = 50): number {
  if (candles.length < period + 1) return 0.5;

  // Считаем серию ATR значений
  const atrValues: number[] = [];
  for (let start = 0; start <= candles.length - period - 1; start++) {
    const slice = candles.slice(start, start + period + 1);
    const { normalized } = calcATR(slice, period);
    if (normalized > 0) atrValues.push(normalized);
  }

  if (atrValues.length < 3) return 0.5;

  const currentATR = atrValues[atrValues.length - 1];
  const recent = atrValues.slice(-lookback);

  // Процентиль текущего ATR
  const below = recent.filter(v => v < currentATR).length;
  return below / recent.length;
}

// ─── VWAP — Volume Weighted Average Price ───────────────────────────────────

function calcVWAP(trades: Trade[]): { vwap: number; deviation: number; lastPrice: number } {
  if (trades.length === 0) return { vwap: 0, deviation: 0, lastPrice: 0 };

  let sumPV = 0;
  let sumVol = 0;

  for (const t of trades) {
    if (t.price > 0 && t.quantity > 0) {
      sumPV += t.price * t.quantity;
      sumVol += t.quantity;
    }
  }

  const vwap = sumVol > 0 ? sumPV / sumVol : 0;
  const lastPrice = trades[trades.length - 1]?.price || 0;
  const deviation = vwap > 0 ? (lastPrice - vwap) / vwap : 0;

  return { vwap, deviation, lastPrice };
}

// ─── Main: Calculate All TA Indicators ───────────────────────────────────────

/**
 * Вычисляет 5 TA индикаторов из OHLCV данных
 *
 * @param candles - массив Candle (из DetectorInput.candles или tradesToCandles)
 * @param trades - массив Trade (для VWAP)
 * @param orderbook - стакан (для VWAP корректировки, опционально)
 */
export function calculateTAIndicators(
  candles: Candle[],
  trades: Trade[],
  orderbook?: OrderBookData,
): TAIndicators {
  // RSI(14)
  const rsi = calcRSI(candles, 14);
  const rsiZone = rsi < 30 ? 'OVERSOLD' as const
    : rsi > 70 ? 'OVERBOUGHT' as const
    : 'NEUTRAL' as const;

  // CMF(20)
  const cmf = calcCMF(candles, 20);
  const cmfZone = cmf > 0.05 ? 'POSITIVE' as const
    : cmf < -0.05 ? 'NEGATIVE' as const
    : 'NEUTRAL' as const;

  // CRSI(3)
  const crsi = calcCRSI(candles, 3);
  const crsiZone = crsi < 20 ? 'OVERSOLD' as const
    : crsi > 80 ? 'OVERBOUGHT' as const
    : 'NEUTRAL' as const;

  // ATR(14)
  const { atr, normalized: atrNorm } = calcATR(candles, 14);
  const atrPercentile = calcATRPercentile(candles, 14);
  const atrZone = atrPercentile < 0.2 ? 'COMPRESSED' as const
    : atrPercentile > 0.8 ? 'EXPANDED' as const
    : 'NORMAL' as const;

  // VWAP
  const { vwap, deviation: vwapDeviation } = calcVWAP(trades);
  const vwapZone = vwapDeviation < -0.001 ? 'BELOW' as const
    : vwapDeviation > 0.001 ? 'ABOVE' as const
    : 'AT_VWAP' as const;

  return {
    rsi: Math.round(rsi * 10) / 10,
    rsiZone,
    cmf: Math.round(cmf * 1000) / 1000,
    cmfZone,
    crsi: Math.round(crsi * 10) / 10,
    crsiZone,
    atr: Math.round(atr * 100) / 100,
    atrPercentile: Math.round(atrPercentile * 100) / 100,
    atrZone,
    vwap: Math.round(vwap * 100) / 100,
    vwapDeviation: Math.round(vwapDeviation * 10000) / 10000,
    vwapZone,
  };
}

// ─── Signal Convergence Logic ───────────────────────────────────────────────

/**
 * Определяет направление ТА индикаторов (буль/медведь/нейтраль)
 * на основе консенсуса 5 индикаторов
 */
function determineTADirection(indicators: TAIndicators): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  let bullScore = 0;
  let bearScore = 0;

  // RSI: oversold = potential reversal UP, overbought = potential reversal DOWN
  // Но для конвергенции: RSI oversold + BSCI bullish = конвергенция (оба ждут отскок)
  if (indicators.rsiZone === 'OVERSOLD') bullScore += 1;    // перепроданность → бычий разворот
  else if (indicators.rsiZone === 'OVERBOUGHT') bearScore += 1;

  // CMF: positive = money flowing in (bullish), negative = flowing out (bearish)
  if (indicators.cmfZone === 'POSITIVE') bullScore += 1.5;  // CMF — сильный индикатор
  else if (indicators.cmfZone === 'NEGATIVE') bearScore += 1.5;

  // CRSI: short-term oversold = bounce expected, overbought = pullback expected
  if (indicators.crsiZone === 'OVERSOLD') bullScore += 0.5;  // краткосрочный
  else if (indicators.crsiZone === 'OVERBOUGHT') bearScore += 0.5;

  // ATR: compressed = breakout imminent (direction from BSCI), expanded = momentum confirmed
  // ATR сам по себе не указывает направление, но подтверждает волатильность
  // НЕ добавляем к bull/bear — он контекстный

  // VWAP: above VWAP = bullish, below = bearish
  if (indicators.vwapZone === 'ABOVE') bullScore += 1;
  else if (indicators.vwapZone === 'BELOW') bearScore += 1;

  // Определяем направление
  if (bullScore >= 2 && bullScore > bearScore * 1.5) return 'BULLISH';
  if (bearScore >= 2 && bearScore > bullScore * 1.5) return 'BEARISH';
  return 'NEUTRAL';
}

/**
 * Вычисляет конвергенцию/дивергенцию между BSCI детекторами и ТА индикаторами
 *
 * @param bsciDirection - направление из детекторов (BSCI.direction)
 * @param bsciScore - значение BSCI (0..1)
 * @param indicators - вычисленные TA индикаторы
 */
export function calculateSignalConvergence(
  bsciDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  bsciScore: number,
  indicators: TAIndicators,
): SignalConvergence {
  const taDirection = determineTADirection(indicators);

  // Конвергенция: оба указывают в одну сторону
  const bothBullish = bsciDirection === 'BULLISH' && taDirection === 'BULLISH';
  const bothBearish = bsciDirection === 'BEARISH' && taDirection === 'BEARISH';

  // Дивергенция: детекторы указывают одно, ТА — другое
  const divergentBullDetBearTA = bsciDirection === 'BULLISH' && taDirection === 'BEARISH';
  const divergentBearDetBullTA = bsciDirection === 'BEARISH' && taDirection === 'BULLISH';

  // Скрытая активность: BSCI видит кита, ТА нет
  const hiddenActivity = (bsciScore > 0.4 && taDirection === 'NEUTRAL') ||
    divergentBullDetBearTA || divergentBearDetBullTA;

  // Сила конвергенции
  let convergenceStrength = 0;
  if (bothBullish || bothBearish) convergenceStrength = 1.0;
  else if (bsciDirection === 'NEUTRAL' || taDirection === 'NEUTRAL') convergenceStrength = 0.3;
  else convergenceStrength = 0; // дивергенция

  // Итоговый сигнал
  let signal: ConvergenceSignal = 'NEUTRAL';
  if (bothBullish && bsciScore > 0.5) signal = 'STRONG_BULL';
  else if (bothBullish) signal = 'BULL';
  else if (bothBearish && bsciScore > 0.5) signal = 'STRONG_BEAR';
  else if (bothBearish) signal = 'BEAR';
  else if (bsciDirection === 'BULLISH') signal = 'BULL';
  else if (bsciDirection === 'BEARISH') signal = 'BEAR';

  // Описание дивергенции
  let divergenceNote = '';
  if (divergentBullDetBearTA) {
    divergenceNote = 'Кит накапливает (BSCI+) но ТА медвежий — скрытая аккумуляция';
  } else if (divergentBearDetBullTA) {
    divergenceNote = 'Кит распределяет (BSCI-) но ТА бычий — скрытое распределение';
  } else if (bsciScore > 0.4 && taDirection === 'NEUTRAL') {
    divergenceNote = 'Детекторы видят аномалию, ТА нейтрален — скрытая активность кита';
  } else if (bothBullish) {
    divergenceNote = 'Детекторы и ТА совпадают: бычий сигнал';
  } else if (bothBearish) {
    divergenceNote = 'Детекторы и ТА совпадают: медвежий сигнал';
  }

  return {
    signal,
    divergence: hiddenActivity,
    divergenceNote,
    bsciDirection,
    taDirection,
    convergenceStrength,
    indicators,
  };
}
