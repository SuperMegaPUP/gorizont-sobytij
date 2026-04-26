// ─── WAVEFUNCTION — Волновая функция (циклические паттерны) ────────────────
// Цена движется циклично — есть периодичность в ценовом ряде.
// Обнаруживаем через автокорреляцию и спектральный анализ (упрощённый FFT).
//
// Признаки:
// - Автокорреляция ценового ряда с lag > 0 значима
// - Доминирующий период в ряде (FFT peak)
// - Цикл воспроизводится ≥ 2 раз
//
// Score: autocorrStrength × periodReproducibility × cycleCount

import type { DetectorInput, DetectorResult } from './types';

/** Упрощённый DFT — находим доминирующую частоту */
function findDominantPeriod(values: number[]): { period: number; strength: number } {
  const n = values.length;
  if (n < 8) return { period: 0, strength: 0 };

  // Убираем тренд (детрендинг)
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const detrended = values.map(v => v - mean);

  // Пробуем периоды от 3 до n/2
  let bestPeriod = 0;
  let bestStrength = 0;

  const maxLag = Math.floor(n / 2);
  for (let lag = 3; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = lag; i < n; i++) {
      sum += detrended[i] * detrended[i - lag];
      count++;
    }
    const autocorr = count > 0 ? sum / count : 0;
    // Нормализуем
    const variance = detrended.reduce((s, v) => s + v * v, 0) / n;
    const normalized = variance > 0 ? autocorr / variance : 0;

    if (normalized > bestStrength) {
      bestStrength = normalized;
      bestPeriod = lag;
    }
  }

  return { period: bestPeriod, strength: Math.min(1, Math.max(0, bestStrength)) };
}

export function detectWavefunction(input: DetectorInput): DetectorResult {
  const { prices } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // v4.1.2: Stale data → нет аномалии
  if (input.staleData) {
    return {
      detector: 'WAVEFUNCTION', description: 'Волновая функция — циклические паттерны (устаревшие данные)',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
    };
  }

  if (prices.length < 12) {
    return {
      detector: 'WAVEFUNCTION', description: 'Волновая функция — циклические паттерны',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true },
    };
  }

  // 1. Находим доминирующий период
  const { period, strength: autocorrStrength } = findDominantPeriod(prices);
  metadata.dominantPeriod = period;
  metadata.autocorrStrength = Math.round(autocorrStrength * 1000) / 1000;

  // 2. Period reproducibility: проверяем, повторяется ли цикл
  let reproducibility = 0;
  if (period > 0 && prices.length >= period * 2) {
    // Корреляция между первым и вторым циклом
    const cycle1 = prices.slice(0, period);
    const cycle2 = prices.slice(period, period * 2);
    const mean1 = cycle1.reduce((s, v) => s + v, 0) / period;
    const mean2 = cycle2.reduce((s, v) => s + v, 0) / period;
    let num = 0, den1 = 0, den2 = 0;
    for (let i = 0; i < period; i++) {
      const d1 = cycle1[i] - mean1;
      const d2 = cycle2[i] - mean2;
      num += d1 * d2;
      den1 += d1 * d1;
      den2 += d2 * d2;
    }
    const den = Math.sqrt(den1 * den2);
    reproducibility = den > 0 ? num / den : 0;
    reproducibility = Math.max(-1, Math.min(1, reproducibility));
  }
  metadata.reproducibility = Math.round(reproducibility * 1000) / 1000;

  // 3. Cycle count: сколько полных циклов помещается
  const cycleCount = period > 0 ? Math.floor(prices.length / period) : 0;
  metadata.cycleCount = cycleCount;

  // 4. Lag-1 autocorrelation (для доп. подтверждения)
  const priceMean = prices.reduce((s, v) => s + v, 0) / prices.length;
  let autoCov1 = 0;
  for (let i = 1; i < prices.length; i++) {
    autoCov1 += (prices[i] - priceMean) * (prices[i - 1] - priceMean);
  }
  const autoVar = prices.reduce((s, v) => s + (v - priceMean) ** 2, 0);
  const lag1Autocorr = autoVar > 0 ? autoCov1 / autoVar : 0;
  metadata.lag1Autocorr = Math.round(lag1Autocorr * 1000) / 1000;

  // 5. Trend filter: монотонный тренд — НЕ цикл
  // Считаем линейный тренд и его R²
  let trendR2 = 0;
  {
    const n = prices.length;
    let sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (let i = 0; i < n; i++) {
      sx += i; sy += prices[i]; sxy += i * prices[i]; sx2 += i * i;
    }
    const den = n * sx2 - sx * sx;
    if (den !== 0) {
      const slope = (n * sxy - sx * sy) / den;
      const intercept = (sy - slope * sx) / n;
      const meanY = sy / n;
      let ssTot = 0, ssRes = 0;
      for (let i = 0; i < n; i++) {
        ssTot += (prices[i] - meanY) ** 2;
        ssRes += (prices[i] - (slope * i + intercept)) ** 2;
      }
      trendR2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
      trendR2 = Math.max(0, Math.min(1, trendR2));
    }
  }
  metadata.trendR2 = Math.round(trendR2 * 1000) / 1000;
  // Если R² тренда > 0.85 → это тренд, не цикл → штраф
  const trendPenalty = trendR2 > 0.9 ? 0.2 : trendR2 > 0.8 ? 0.5 : 1.0;

  // Score
  const acScore = autocorrStrength > 0.6 ? 1 : autocorrStrength > 0.4 ? 0.7 : autocorrStrength > 0.2 ? 0.3 : 0;
  const repScore = reproducibility > 0.6 ? 1 : reproducibility > 0.4 ? 0.7 : reproducibility > 0.2 ? 0.3 : 0;
  const cycleScore = cycleCount >= 3 ? 1 : cycleCount >= 2 ? 0.7 : cycleCount >= 1 ? 0.3 : 0;

  const rawScore = (acScore * 0.4 + repScore * 0.35 + cycleScore * 0.25) * trendPenalty;
  const score = Math.min(1, Math.max(0, rawScore));

  // Signal: текущая фаза цикла (верхняя или нижняя половина)
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2 && period > 0) {
    const phasePosition = prices.length % period;
    const halfPeriod = period / 2;
    signal = phasePosition < halfPeriod ? 'BULLISH' : 'BEARISH';
  }

  const confidence = score > 0.2
    ? Math.min(1, (acScore + repScore) / 1.5)
    : 0;

  return {
    detector: 'WAVEFUNCTION',
    description: 'Волновая функция — циклические паттерны цены',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
