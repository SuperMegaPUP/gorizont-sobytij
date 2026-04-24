// ─── ACCRETOR — Аккреция (постепенное накопление позиции) ──────────────────
// Крупный игрок методично набирает позицию, не двигая цену.
// CumDelta показывает устойчивый тренд, но цена стоит на месте.
//
// Признаки:
// - CumDelta монотонно растёт/падает (тренд дельты)
// - Цена при этом стабильна (low volatility)
// - Отношение |delta trend| / |price trend| > порога
//
// Score: deltaTrendStrength × priceStability × accumulationRatio

import type { DetectorInput, DetectorResult } from './types';

/** Линейная регрессия — возвращает slope и R² */
function regress(values: number[]): { slope: number; r2: number } {
  const n = values.length;
  if (n < 3) return { slope: 0, r2: 0 };
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += values[i]; sxy += i * values[i]; sx2 += i * i; sy2 += values[i] ** 2;
  }
  const den = n * sx2 - sx * sx;
  if (den === 0) return { slope: 0, r2: 0 };
  const slope = (n * sxy - sx * sy) / den;
  // R² — коэффициент детерминации
  const ssTot = n * sy2 - sy * sy;
  const ssRes = ssTot === 0 ? 0 : Math.max(0, 1 - (n * sy2 - sy * sy - slope * (n * sxy - sx * sy)) / ssTot);
  return { slope, r2: Math.min(1, Math.max(0, ssRes)) };
}

export function detectAccretor(input: DetectorInput): DetectorResult {
  const { cumDelta, prices, trades } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // Нужен минимум 10 сделок и 5 цен
  if (trades.length < 10 || prices.length < 5) {
    return {
      detector: 'ACCRETOR', description: 'Аккреция — постепенное накопление',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true },
    };
  }

  // 1. Delta trend: нарастающая кумулятивная дельта
  // Вычисляем running cumDelta из trades
  const runningDelta: number[] = [];
  let cumSum = 0;
  for (const t of trades) {
    const side = t.direction.toUpperCase().trim();
    if (side === 'B' || side === 'BUY') cumSum += t.quantity;
    else if (side === 'S' || side === 'SELL') cumSum -= t.quantity;
    runningDelta.push(cumSum);
  }
  const deltaReg = regress(runningDelta);
  const deltaTrendStrength = Math.min(1, Math.abs(deltaReg.slope) / (Math.abs(runningDelta[runningDelta.length - 1] || 1) + 1));
  metadata.deltaSlope = Math.round(deltaReg.slope * 100) / 100;
  metadata.deltaR2 = Math.round(deltaReg.r2 * 1000) / 1000;

  // 2. Price stability: насколько цена стоит на месте
  const priceReg = regress(prices);
  const priceMean = prices.reduce((s, p) => s + p, 0) / prices.length;
  const priceStdDev = Math.sqrt(prices.reduce((s, p) => s + (p - priceMean) ** 2, 0) / prices.length);
  const priceCV = priceMean > 0 ? priceStdDev / priceMean : 1; // coefficient of variation
  const priceStability = Math.max(0, 1 - priceCV * 100); // CV < 0.01 → стабильна
  metadata.priceCV = Math.round(priceCV * 10000) / 10000;
  metadata.priceStability = Math.round(priceStability * 1000) / 1000;

  // 3. Accumulation ratio: |delta trend| / |price trend|
  const deltaAbsSlope = Math.abs(deltaReg.slope);
  const priceAbsSlope = Math.abs(priceReg.slope);
  const accumulationRatio = priceAbsSlope > 0.001 ? deltaAbsSlope / priceAbsSlope : deltaAbsSlope > 0 ? 10 : 0;
  metadata.accumulationRatio = Math.round(Math.min(accumulationRatio, 100) * 100) / 100;

  // 4. CumDelta dominance: доля покупок/продаж
  const buyRatio = cumDelta.totalVolume > 0
    ? cumDelta.buyVolume / cumDelta.totalVolume : 0.5;
  metadata.buyRatio = Math.round(buyRatio * 1000) / 1000;

  // Score
  const r2Score = deltaReg.r2 > 0.8 ? 1 : deltaReg.r2 > 0.5 ? 0.6 : deltaReg.r2 > 0.3 ? 0.3 : 0;
  const accumScore = Math.min(1, accumulationRatio / 5);
  const rawScore = r2Score * 0.4 + priceStability * 0.3 + accumScore * 0.3;
  const score = Math.min(1, Math.max(0, rawScore));

  // Signal: направление дельты
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2) {
    signal = deltaReg.slope > 0 ? 'BULLISH' : deltaReg.slope < 0 ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.2
    ? Math.min(1, (r2Score + priceStability) / 2)
    : 0;

  return {
    detector: 'ACCRETOR',
    description: 'Аккреция — постепенное накопление позиции',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
