// ─── HAWKING — Излучение Хокинга v4.2 ──────────────────────────────────────
// Обнаружение периодичности в потоке сделок → признак алгоритмической торговли.
//
// v4.2 ПОЛНАЯ замена trade_intervals → activity series:
//   binMs = 100
//   bins  = group trades by floor(timestamp / binMs)
//   per bin: value = count(trades)  // activity series
//   Пустые бины = 0 — НОРМАЛЬНО
//
// Guards:
//   n_trades < 50 || duration_sec < 10 → score=0, "insufficient_data"
//   n_bins < 100                         → score=0, "insufficient_bins"
//
// Спектральный анализ:
//   n_bins < 500  → raw FFT на activity series (sampleRate = 10 Hz)
//   n_bins >= 500 → Welch's method на activity series
//
// ACF + периодичность:
//   ACF lags 2..20 на activity series
//   periodicity = max(|ACF(k)|) для k=2..20
//
// Адаптивная зона:
//   avg_freq  = n_trades / duration_sec  (Hz)
//   algo_zone = [0.1 × avg_freq, 3 × avg_freq]
//
// Noise ratio v1:
//   bandwidth = count(bins where freq ∈ algo_zone)
//   noise_ratio = 1 - peak_power / max(median_psd × bandwidth, ε)
//
// Score:
//   score = periodicity × (1 - noise_ratio)
//   return clampScore(score) ∈ [0, 1]

import type { DetectorInput, DetectorResult } from './types';
import { clampScore, stalePenalty } from './guards';

const EPS = 1e-6;
const BIN_MS = 100;                         // 100ms ресэмплинг
const SAMPLE_RATE_HZ = 10;                  // 1/bin = 10 Hz
const MIN_TRADES = 50;
const MIN_DURATION_SEC = 10;
const MIN_BINS = 100;
const MIN_NOISE_RATIO = 0.15;               // 15% — минимальная доля шумовой энергии
const FWHM_REFERENCE = 6;                   // эталонная ширина пика для нормализации

// ─── Вспомогательные функции ────────────────────────────────────────────────

/**
 * Full Width at Half Maximum — ширина пика на уровне половины его высоты.
 * Узкий пик (FWHM < 3 бинов) → не периодичность, а артефакт.
 * Широкий пик (FWHM ≥ 6 бинов) → реальная цикличность.
 */
function computeFWHM(psd: number[], peakIdx: number): number {
  if (peakIdx < 0 || peakIdx >= psd.length) return 0;
  const halfMax = psd[peakIdx] / 2;
  let left = peakIdx;
  while (left > 0 && psd[left] > halfMax) left--;
  let right = peakIdx;
  while (right < psd.length - 1 && psd[right] > halfMax) right++;
  return right - left;
}

function computeACF(series: number[], maxLag: number): number[] {
  const n = series.length;
  if (n < 2) return [1];
  const mean = series.reduce((s, v) => s + v, 0) / n;
  const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  if (variance < EPS) return Array(maxLag + 1).fill(0);
  const acf: number[] = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += (series[i] - mean) * (series[i + lag] - mean);
    }
    acf.push(sum / ((n - lag) * variance + EPS));
  }
  return acf;
}

function fft(re: number[], im: number[]): void {
  const n = re.length;
  if (n <= 1) return;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const newCurRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newCurRe;
      }
    }
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function welchPSD(series: number[], sampleRate: number): { freqs: number[]; psd: number[] } {
  const n = series.length;
  const segmentLength = Math.min(64, Math.floor(n / 2));
  const overlap = Math.floor(segmentLength / 2);
  const step = segmentLength - overlap;
  const window = new Float64Array(segmentLength);
  let windowSumSq = 0;
  for (let i = 0; i < segmentLength; i++) {
    window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (segmentLength - 1)));
    windowSumSq += window[i] * window[i];
  }
  const nSegments = Math.max(1, Math.floor((n - segmentLength) / step) + 1);
  const fftSize = nextPow2(segmentLength);
  const avgPSD = new Float64Array(fftSize / 2 + 1);
  for (let seg = 0; seg < nSegments; seg++) {
    const offset = seg * step;
    const re = new Array(fftSize).fill(0);
    const im = new Array(fftSize).fill(0);
    for (let i = 0; i < segmentLength; i++) {
      re[i] = (series[offset + i] || 0) * window[i];
    }
    fft(re, im);
    for (let k = 0; k <= fftSize / 2; k++) {
      const mag2 = re[k] * re[k] + im[k] * im[k];
      avgPSD[k] += mag2 / (windowSumSq * sampleRate + EPS);
    }
  }
  const psd: number[] = [];
  const freqs: number[] = [];
  for (let k = 0; k <= fftSize / 2; k++) {
    avgPSD[k] /= nSegments;
    psd.push(avgPSD[k]);
    freqs.push(k * sampleRate / fftSize);
  }
  return { freqs, psd };
}

function simplePSD(series: number[], sampleRate: number): { freqs: number[]; psd: number[] } {
  const fftSize = nextPow2(series.length);
  const re = new Array(fftSize).fill(0);
  const im = new Array(fftSize).fill(0);
  const mean = series.reduce((s, v) => s + v, 0) / series.length;
  for (let i = 0; i < series.length; i++) re[i] = series[i] - mean;
  fft(re, im);
  const psd: number[] = [];
  const freqs: number[] = [];
  for (let k = 0; k <= fftSize / 2; k++) {
    const mag2 = re[k] * re[k] + im[k] * im[k];
    psd.push(mag2 / (series.length * sampleRate + EPS));
    freqs.push(k * sampleRate / fftSize);
  }
  return { freqs, psd };
}

// ─── Главный детектор ──────────────────────────────────────────────────────

export function detectHawking(input: DetectorInput): DetectorResult {
  const { trades } = input;
  const metadata: Record<string, number | string | boolean> = {};

  const validTrades = trades && trades.length > 0 ? trades : [];
  const n = validTrades.length;
  metadata.n_trades = n;

  // ─── Stale guard ────────────────────────────────────────────────────────
  if (input.staleData) {
    const staleFactor = stalePenalty(input.staleMinutes);
    if (staleFactor <= 0) {
      return {
        detector: 'HAWKING',
        description: 'Излучение — периодичность алгоритмов (устаревшие данные)',
        score: 0,
        confidence: 0,
        signal: 'NEUTRAL',
        metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
      };
    }
  }

  // ─── Guard: недостаточно сделок или короткая длительность ───────────────
  if (n < MIN_TRADES) {
    metadata.insufficientData = true;
    metadata.guardTriggered = 'insufficient_data';
    return {
      detector: 'HAWKING',
      description: 'Излучение — периодичность алгоритмов (недостаточно данных)',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  const timestamps = validTrades.map(t => t.timestamp || 0).filter(ts => ts > 0);
  const durationSec = timestamps.length >= 2
    ? (Math.max(...timestamps) - Math.min(...timestamps)) / 1000
    : 0;
  metadata.durationSec = Math.round(durationSec * 100) / 100;

  if (durationSec < MIN_DURATION_SEC) {
    metadata.insufficientData = true;
    metadata.guardTriggered = 'insufficient_data';
    return {
      detector: 'HAWKING',
      description: 'Излучение — периодичность алгоритмов (короткая длительность)',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  // ─── 1. 100ms ресэмплинг → activity series ──────────────────────────────
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const nBins = Math.floor((maxTs - minTs) / BIN_MS) + 1;
  metadata.n_bins = nBins;

  if (nBins < MIN_BINS) {
    metadata.insufficientData = true;
    metadata.guardTriggered = 'insufficient_bins';
    return {
      detector: 'HAWKING',
      description: 'Излучение — периодичность алгоритмов (недостаточно бинов)',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  const activity: number[] = new Array(nBins).fill(0);
  for (const t of validTrades) {
    const ts = t.timestamp || 0;
    if (ts > 0) {
      const idx = Math.floor((ts - minTs) / BIN_MS);
      if (idx >= 0 && idx < nBins) activity[idx]++;
    }
  }
  metadata.avgActivity = Math.round((activity.reduce((s, v) => s + v, 0) / nBins) * 100) / 100;

  // ─── 2. ACF на activity series ──────────────────────────────────────────
  const maxLag = Math.min(20, Math.floor(activity.length / 3));
  const acf = computeACF(activity, maxLag);

  let periodicity = 0;
  let periodicLag = 0;
  for (let k = 2; k < acf.length; k++) {
    if (Math.abs(acf[k]) > periodicity) {
      periodicity = Math.abs(acf[k]);
      periodicLag = k;
    }
  }
  metadata.periodicity = Math.round(periodicity * 1000) / 1000;
  metadata.periodicLag = periodicLag;

  // ─── 3. PSD — спектральная плотность мощности ───────────────────────────
  let psdResult: { freqs: number[]; psd: number[] };
  if (nBins >= 500) {
    psdResult = welchPSD(activity, SAMPLE_RATE_HZ);
    metadata.psdMethod = 'welch';
  } else {
    psdResult = simplePSD(activity, SAMPLE_RATE_HZ);
    metadata.psdMethod = 'fft';
  }

  // ─── 4. Адаптивная algo_zone ────────────────────────────────────────────
  const avgFreq = n / durationSec;                       // средняя частота сделок, Hz
  const algoZoneMin = 0.1 * avgFreq;
  const algoZoneMax = Math.min(3.0 * avgFreq, SAMPLE_RATE_HZ / 2); // clip at Nyquist
  metadata.avgFreq = Math.round(avgFreq * 100) / 100;
  metadata.algoZoneMin = Math.round(algoZoneMin * 100) / 100;
  metadata.algoZoneMax = Math.round(algoZoneMax * 100) / 100;

  // ─── 5. Пик и bandwidth внутри algo_zone ────────────────────────────────
  let peakPower = 0;
  let peakFreq = 0;
  let bandwidth = 0;

  for (let k = 1; k < psdResult.freqs.length; k++) {
    const freq = psdResult.freqs[k];
    if (freq >= algoZoneMin && freq <= algoZoneMax) {
      bandwidth++;
      if (psdResult.psd[k] > peakPower) {
        peakPower = psdResult.psd[k];
        peakFreq = freq;
      }
    }
  }

  metadata.peakFreq = Math.round(peakFreq * 100) / 100;
  metadata.peakPower = Math.round(peakPower * 1000) / 1000;
  metadata.bandwidth = bandwidth;

  // ─── 6. noise_ratio ─────────────────────────────────────────────────────
  const sortedPSD = [...psdResult.psd].sort((a, b) => a - b);
  const medianPSD = sortedPSD[Math.floor(sortedPSD.length / 2)] || EPS;

  const noiseRatioRaw = 1 - (peakPower / (medianPSD * Math.max(bandwidth, 1) + EPS));
  const noiseRatio = Math.max(0, Math.min(1, noiseRatioRaw));
  const effectiveNoiseRatio = Math.max(noiseRatio, MIN_NOISE_RATIO);  // пол 15%
  metadata.noiseRatio = Math.round(noiseRatio * 1000) / 1000;
  metadata.effectiveNoiseRatio = Math.round(effectiveNoiseRatio * 1000) / 1000;
  metadata.medianPSD = Math.round(medianPSD * 1000) / 1000;

  // ─── 7. FWHM bandwidth и адаптивный periodicity cap ───────────────────
  // Находим индекс пика
  let peakIdx = 0;
  let maxPsd = 0;
  for (let k = 1; k < psdResult.psd.length; k++) {
    if (psdResult.psd[k] > maxPsd) {
      maxPsd = psdResult.psd[k];
      peakIdx = k;
    }
  }
  const fwhm = computeFWHM(psdResult.psd, peakIdx);
  const fwhmNorm = Math.min(fwhm / FWHM_REFERENCE, 1.0);
  const periodicityCap = fwhmNorm < 0.5 ? 0.3 : 0.7;
  const periodicityCapped = Math.min(periodicity, periodicityCap);

  metadata.fwhm = fwhm;
  metadata.fwhmNorm = Math.round(fwhmNorm * 1000) / 1000;
  metadata.periodicityCap = periodicityCap;
  metadata.periodicityCapped = Math.round(periodicityCapped * 1000) / 1000;

  // ─── 8. Hawking score ───────────────────────────────────────────────────
  // Формула: periodicityCapped * (1 - effectiveNoiseRatio) * fwhmNorm
  // Макс для реальной цикличности: 0.7 × 0.85 × 1.0 = 0.595
  // Шумовой артефакт: 0.3 × 0.85 × 0.17 ≈ 0.04
  const score = clampScore(periodicityCapped * (1 - effectiveNoiseRatio) * fwhmNorm);

  metadata.hawkingRawScore = Math.round(score * 1000) / 1000;
  metadata.algoZoneDetected = peakPower > medianPSD * 2;

  // ─── 8. Signal direction ────────────────────────────────────────────────
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2 && input.candles.length > 0) {
    const lastCandle = input.candles[input.candles.length - 1];
    signal = lastCandle.close > lastCandle.open ? 'BULLISH'
      : lastCandle.close < lastCandle.open ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.2
    ? Math.min(1, (periodicity + (1 - noiseRatio)) / 1.5)
    : 0;

  // ─── 9. Stale penalty ───────────────────────────────────────────────────
  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
  const finalScore = clampScore(score * staleFactor);
  const finalConfidence = clampScore(confidence * staleFactor);
  metadata.staleFactor = staleFactor;

  return {
    detector: 'HAWKING',
    description: 'Излучение — периодичность алгоритмов (activity series v4.2)',
    score: finalScore,
    confidence: finalConfidence,
    signal,
    metadata,
  };
}
