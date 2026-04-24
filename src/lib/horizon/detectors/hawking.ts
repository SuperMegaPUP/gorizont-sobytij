// ─── HAWKING — Излучение (VPIN spike) ─────────────────────────────────────
// Неожиданный всплеск токсичности потока — как излучение Хокинга
// предвещает испарение чёрной дыры, VPIN spike предвещает движение цены.
//
// Признаки:
// - VPIN > 0.6 (высокая токсичность)
// - VPIN резко вырос относительно недавних значений (spike)
// - VPIN toxicity = 'high' или 'extreme'
//
// Score: vpinLevel × spikeMagnitude × toxicityConfirmation

import type { DetectorInput, DetectorResult } from './types';

export function detectHawking(input: DetectorInput): DetectorResult {
  const { vpin, candles } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // 1. VPIN level
  metadata.vpin = Math.round(vpin.vpin * 1000) / 1000;
  metadata.toxicity = vpin.toxicity;
  metadata.buckets = vpin.buckets;

  // 2. VPIN spike: сравниваем с предыдущими значениями
  // Используем объёмные бакеты из свечей для оценки предыдущего VPIN
  let spikeMagnitude = 0;
  if (candles.length > 10) {
    // Простая эвристика: если VPIN текущий выше 75-го перцентиля recent candles
    // по абсолютному дисбалансу buy/sell
    const absImbalances = candles.slice(-20).map(c => Math.abs(c.close - c.open) / (c.high - c.low + 0.001));
    const currentImbalance = candles.length > 0
      ? Math.abs(candles[candles.length - 1].close - candles[candles.length - 1].open) /
        (candles[candles.length - 1].high - candles[candles.length - 1].low + 0.001)
      : 0;
    const sorted = [...absImbalances].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)] || 0;
    spikeMagnitude = p75 > 0 ? Math.max(0, (currentImbalance - p75) / (p75 + 0.01)) : 0;
  }
  metadata.spikeMagnitude = Math.round(spikeMagnitude * 100) / 100;

  // 3. Toxicity confirmation
  const toxicityScore = vpin.toxicity === 'extreme' ? 1
    : vpin.toxicity === 'high' ? 0.8
    : vpin.toxicity === 'moderate' ? 0.4 : 0.1;

  // 4. VPIN level score
  const vpinLevelScore = Math.min(1, vpin.vpin / 0.8); // 0.8 = extreme

  // 5. Bucket fill ratio — сколько корзин заполнено
  const bucketFillRatio = Math.min(1, vpin.buckets / 50);
  metadata.bucketFillRatio = Math.round(bucketFillRatio * 100) / 100;

  // Score
  const rawScore = vpinLevelScore * 0.45 + Math.min(1, spikeMagnitude) * 0.25 +
    toxicityScore * 0.2 + bucketFillRatio * 0.1;
  const score = Math.min(1, Math.max(0, rawScore));

  // Signal: VPIN spike → ожидаем движение в сторону дисбаланса
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2 && candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    signal = lastCandle.close > lastCandle.open ? 'BULLISH'
      : lastCandle.close < lastCandle.open ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.2
    ? Math.min(1, (vpinLevelScore + toxicityScore) / 1.5)
    : 0;

  return {
    detector: 'HAWKING',
    description: 'Излучение — всплеск VPIN (токсичность потока)',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
