// ─── PREDATOR — Хищник (охота за стопами) ─────────────────────────────────
// Крупный игрок целенаправленно двигает цену к уровню скопления стопов.
// Характеризуется: резкий ценовой бросок + аномальный объём + откат.
//
// Признаки:
// - Резкий ценовой бросок (price spike > 2σ)
// - Объём на движении аномально высок
// - Быстрый откат после пробоя (v-shape)
// - CumDelta подтверждает направление броска
//
// Score: spikeMagnitude × volumeAnomaly × reversalIndicator × deltaConfirmation

import type { DetectorInput, DetectorResult } from './types';

export function detectPredator(input: DetectorInput): DetectorResult {
  const { prices, volumes, cumDelta, recentTrades } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // v4.1.2: Stale data → нет аномалии
  if (input.staleData) {
    return {
      detector: 'PREDATOR', description: 'Хищник — охота за стопами (устаревшие данные)',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
    };
  }

  if (prices.length < 5) {
    return {
      detector: 'PREDATOR', description: 'Хищник — охота за стопами',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true },
    };
  }

  // 1. Price spike: последнее изменение цены vs σ
  const priceChanges: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    priceChanges.push(prices[i] - prices[i - 1]);
  }
  const meanChange = priceChanges.reduce((s, v) => s + v, 0) / priceChanges.length;
  const stdChange = Math.sqrt(
    priceChanges.reduce((s, v) => s + (v - meanChange) ** 2, 0) / priceChanges.length
  );
  const lastChange = priceChanges[priceChanges.length - 1] || 0;
  const spikeMagnitude = stdChange > 0 ? Math.abs(lastChange) / stdChange : 0;
  metadata.spikeSigma = Math.round(spikeMagnitude * 100) / 100;
  metadata.lastPriceChange = Math.round(lastChange * 1000) / 1000;

  // 2. Volume anomaly: последний объём vs средний
  const avgVolume = volumes.length > 0
    ? volumes.reduce((s, v) => s + v, 0) / volumes.length : 0;
  const lastVolume = volumes[volumes.length - 1] || 0;
  const volumeStdDev = Math.sqrt(
    volumes.reduce((s, v) => s + (v - avgVolume) ** 2, 0) / Math.max(1, volumes.length)
  );
  const volumeAnomaly = volumeStdDev > 0
    ? (lastVolume - avgVolume) / volumeStdDev : 0;
  metadata.volumeAnomalySigma = Math.round(volumeAnomaly * 100) / 100;

  // 3. Reversal indicator: V-shape (быстрый откат)
  let reversalIndicator = 0;
  if (prices.length >= 3) {
    const prevPrice = prices[prices.length - 3];
    const peakPrice = prices[prices.length - 2];
    const currPrice = prices[prices.length - 1];
    const move1 = peakPrice - prevPrice;
    const move2 = currPrice - peakPrice;
    // V-shape: move1 и move2 в разные стороны, и move2 частично отменяет move1
    if (move1 * move2 < 0) {
      reversalIndicator = Math.min(1, Math.abs(move2) / (Math.abs(move1) + 0.001));
    }
  }
  metadata.reversalIndicator = Math.round(reversalIndicator * 1000) / 1000;

  // 4. Delta confirmation: CumDelta согласуется с направлением броска
  const deltaConfirmation = cumDelta.totalVolume > 0
    ? Math.abs(cumDelta.delta) / cumDelta.totalVolume : 0;
  metadata.deltaConfirmation = Math.round(deltaConfirmation * 1000) / 1000;

  // Score
  const spikeScore = Math.min(1, Math.max(0, (spikeMagnitude - 1.5) / 3));
  const volScore = Math.min(1, Math.max(0, (volumeAnomaly - 1) / 3));
  const reversalScore = reversalIndicator > 0.3 ? 0.6 : reversalIndicator > 0.1 ? 0.3 : 0;
  const deltaScore = deltaConfirmation;

  const rawScore = spikeScore * 0.35 + volScore * 0.25 + reversalScore * 0.2 + deltaScore * 0.2;
  const score = Math.min(1, Math.max(0, rawScore));

  // Signal: направление броска
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2) {
    signal = lastChange > 0 ? 'BULLISH' : lastChange < 0 ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.2
    ? Math.min(1, (spikeScore + volScore + reversalScore) / 2)
    : 0;

  return {
    detector: 'PREDATOR',
    description: 'Хищник — охота за стопами',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
