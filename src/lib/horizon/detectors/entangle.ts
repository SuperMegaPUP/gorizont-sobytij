// ─── ENTANGLE — Запутанность (кросс-тикерная корреляция) ──────────────────
// Два актива движутся синхронно — как запутанные квантовые частицы.
// Это признак макро-события или координированного действия.
//
// Признаки:
// - Высокая корреляция ценовых изменений между тикерами
// - OFI корреляция (оба стакана в одну сторону)
// - Неожиданная синхронность (обычно не коррелируют)
//
// Score: priceCorrelation × ofiCorrelation × synchronicity

import type { DetectorInput, DetectorResult } from './types';

export function detectEntangle(input: DetectorInput): DetectorResult {
  const { ticker, ofi, prices, crossTickers } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // Без кросс-тикерных данных — детектор не работает
  if (!crossTickers || Object.keys(crossTickers).length === 0) {
    return {
      detector: 'ENTANGLE', description: 'Запутанность — кросс-тикерная корреляция',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { noCrossData: true },
    };
  }

  // v4.1.1: Если все кросс-тикеры имеют нулевые данные (рынок закрыт),
  // корреляция на нулях бессмысленна → НЕТ ДАННЫХ = НЕТ АНОМАЛИИ
  const allZeroChanges = Object.values(crossTickers).every(
    d => Math.abs(d.priceChange) < 0.01 && Math.abs(d.ofi) < 0.01
  );
  const currentPriceChange = prices.length >= 2
    ? (prices[prices.length - 1] - prices[0]) / (prices[0] || 1) * 100 : 0;

  if (allZeroChanges && Math.abs(currentPriceChange) < 0.01) {
    return {
      detector: 'ENTANGLE', description: 'Запутанность — нет рыночных данных',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true, allZeroChanges: true },
    };
  }
  metadata.currentPriceChange = Math.round(currentPriceChange * 100) / 100;

  let maxCorrelation = 0;
  let correlatedTicker = '';
  let sameDirectionCount = 0;
  let totalCrossTickers = 0;

  for (const [crossTicker, data] of Object.entries(crossTickers)) {
    totalCrossTickers++;
    // Simple correlation: same direction and similar magnitude
    const priceDiff = Math.abs(currentPriceChange - data.priceChange);
    const maxChange = Math.max(Math.abs(currentPriceChange), Math.abs(data.priceChange), 0.01);
    const correlation = maxChange > 0 ? 1 - priceDiff / (maxChange * 2) : 0;

    if (correlation > maxCorrelation) {
      maxCorrelation = correlation;
      correlatedTicker = crossTicker;
    }

    // Same direction?
    const sameDir = Math.sign(currentPriceChange) === Math.sign(data.priceChange) &&
      Math.abs(currentPriceChange) > 0.05;
    if (sameDir) sameDirectionCount++;
  }

  metadata.maxCorrelation = Math.round(maxCorrelation * 1000) / 1000;
  metadata.correlatedTicker = correlatedTicker;
  metadata.sameDirectionCount = sameDirectionCount;
  metadata.totalCrossTickers = totalCrossTickers;

  // 2. OFI correlation: синхронный OFI
  const ofiCorrelated = Object.values(crossTickers).filter(d =>
    Math.sign(d.ofi) === Math.sign(ofi) && Math.abs(ofi) > 0.1 && Math.abs(d.ofi) > 0.1
  ).length;
  const ofiCorrelationRatio = totalCrossTickers > 0 ? ofiCorrelated / totalCrossTickers : 0;
  metadata.ofiCorrelationRatio = Math.round(ofiCorrelationRatio * 1000) / 1000;

  // 3. Synchronicity: сколько тикеров в ту же сторону
  const synchronicity = totalCrossTickers > 0 ? sameDirectionCount / totalCrossTickers : 0;
  metadata.synchronicity = Math.round(synchronicity * 1000) / 1000;

  // Score
  const correlationScore = Math.min(1, Math.max(0, (maxCorrelation - 0.5) / 0.4));
  const ofiScore = Math.min(1, ofiCorrelationRatio * 2);
  const syncScore = synchronicity > 0.7 ? 1 : synchronicity > 0.5 ? 0.6 : synchronicity > 0.3 ? 0.3 : 0;

  const rawScore = correlationScore * 0.4 + ofiScore * 0.3 + syncScore * 0.3;
  const score = Math.min(1, Math.max(0, rawScore));

  // Signal: следуем за большинством
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2) {
    signal = currentPriceChange > 0.1 ? 'BULLISH'
      : currentPriceChange < -0.1 ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.2
    ? Math.min(1, (correlationScore + syncScore) / 1.5)
    : 0;

  return {
    detector: 'ENTANGLE',
    description: 'Запутанность — синхронное движение активов',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
