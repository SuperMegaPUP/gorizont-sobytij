// ─── CIPHER — Шифр (неестественная периодичность сделок) ──────────────────
// Алгоритмический бот оставляет «отпечаток» в виде равномерных интервалов
// между сделками. Человек так не торгует.
//
// Признаки:
// - Коэффициент вариации (CV) интервалов < 0.15 → периодический
// - Фиксированный объём сделок (>40% одинаковые)
// - Автокорреляция интервалов > 0.5 → алгоритмический паттерн
//
// Score: periodicityScore × volumeUniformity × autocorrScore

import type { DetectorInput, DetectorResult } from './types';

export function detectCipher(input: DetectorInput): DetectorResult {
  const { recentTrades } = input;
  const metadata: Record<string, number | string | boolean> = {};

  if (recentTrades.length < 8) {
    return {
      detector: 'CIPHER', description: 'Шифр — неестественная периодичность',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true },
    };
  }

  // 1. Интервалы между сделками
  const sorted = [...recentTrades]
    .filter(t => t.timestamp !== undefined)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const dt = (sorted[i].timestamp || 0) - (sorted[i - 1].timestamp || 0);
    if (dt > 0) intervals.push(dt);
  }

  if (intervals.length < 5) {
    return {
      detector: 'CIPHER', description: 'Шифр — неестественная периодичность',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientIntervals: true },
    };
  }

  // 2. CV интервалов
  const meanInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  const stdInterval = Math.sqrt(
    intervals.reduce((s, v) => s + (v - meanInterval) ** 2, 0) / intervals.length
  );
  const cv = meanInterval > 0 ? stdInterval / meanInterval : 999;
  metadata.cv = Math.round(cv * 1000) / 1000;
  metadata.meanIntervalMs = Math.round(meanInterval * 100) / 100;

  // 3. Периодичность (CV < 0.15 → очень периодичный)
  const periodicityScore = cv < 0.1 ? 1 : cv < 0.15 ? 0.8 : cv < 0.25 ? 0.5 : cv < 0.4 ? 0.2 : 0;

  // 4. Volume uniformity: доля одинаковых объёмов
  const volumes = sorted.map(t => t.quantity);
  const volFreq: Record<number, number> = {};
  for (const v of volumes) volFreq[v] = (volFreq[v] || 0) + 1;
  const maxVolFreq = Math.max(...Object.values(volFreq));
  const volumeUniformity = maxVolFreq / volumes.length;
  metadata.volumeUniformity = Math.round(volumeUniformity * 1000) / 1000;
  metadata.mostFreqVolumeCount = maxVolFreq;

  const volumeScore = volumeUniformity > 0.6 ? 1 : volumeUniformity > 0.4 ? 0.7 : volumeUniformity > 0.25 ? 0.3 : 0;

  // 5. Autocorrelation интервалов (lag-1)
  let autoCov = 0;
  for (let i = 1; i < intervals.length; i++) {
    autoCov += (intervals[i] - meanInterval) * (intervals[i - 1] - meanInterval);
  }
  const autoVar = intervals.reduce((s, v) => s + (v - meanInterval) ** 2, 0);
  const autocorr = autoVar > 0 ? autoCov / autoVar : 0;
  metadata.autocorr = Math.round(autocorr * 1000) / 1000;

  const autocorrScore = Math.abs(autocorr) > 0.5 ? 1
    : Math.abs(autocorr) > 0.3 ? 0.6
    : Math.abs(autocorr) > 0.15 ? 0.3 : 0;

  // Score
  const rawScore = periodicityScore * 0.45 + volumeScore * 0.3 + autocorrScore * 0.25;
  const score = Math.min(1, Math.max(0, rawScore));

  // Signal: направление преобладающих сделок
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2) {
    const buyCount = sorted.filter(t => {
      const d = t.direction.toUpperCase();
      return d === 'B' || d === 'BUY';
    }).length;
    const sellCount = sorted.length - buyCount;
    signal = buyCount > sellCount * 1.5 ? 'BULLISH'
      : sellCount > buyCount * 1.5 ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.2
    ? Math.min(1, (periodicityScore + volumeScore) / 1.5)
    : 0;

  return {
    detector: 'CIPHER',
    description: 'Шифр — неестественная периодичность сделок',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
