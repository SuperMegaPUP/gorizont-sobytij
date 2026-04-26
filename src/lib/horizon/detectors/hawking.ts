// ─── HAWKING — Излучение Хокинга (алгоритмическая периодичность) ──────────
// Обнаружение периодичности в потоке сделок → признак алгоритмической торговли.
// Аналогия: как излучение Хокинга предвещает испарение чёрной дыры,
// периодичность в потоке предвещает системную активность.
//
// v4.1 Формула:
// 1) trade_intervals = t[i] - t[i-1] для последних N сделок
// 2) N < 50 → hawking_score = 0 (недостаточно данных)
//    50 ≤ N < 100 → сырой FFT
//    N ≥ 100 → Welch's method (перекрывающиеся окна + усреднение PSD)
// 3) ACF lag 1..20 → периодичность = max(|ACF(k)|) для k=2..20
// 4) noise_ratio = 1 - (peak_power / (median_psd * bandwidth + ε))
// 5) hawking_score = периодичность * (1 - noise_ratio)
// 6) Частоты 0.5-5 Hz = зона алгоритмической торговли
//
// Убрать ВСЕ упоминания WVD из спецификации и комментариев.

import type { DetectorInput, DetectorResult } from './types';
import { clampScore, stalePenalty } from './guards';

const EPS = 1e-6;

// ─── Вспомогательные функции ────────────────────────────────────────────────

/**
 * Autocorrelation Function (ACF) для серии значений.
 * Возвращает массив ACF(k) для k = 0..maxLag
 */
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

/**
 * Простой FFT (Radix-2 Cooley-Tukey) для массива длины = степень 2.
 * Работает in-place на number[] массивах.
 */
function fft(re: number[], im: number[]): void {
  const n = re.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // FFT butterfly
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

/**
 * Power Spectral Density через Welch's method.
 * Разбивает серию на перекрывающиеся окна, считает FFT каждого,
 * усредняет PSD. Окно Hann, overlap = 50%.
 */
function welchPSD(series: number[], sampleRate: number): { freqs: number[]; psd: number[] } {
  const n = series.length;
  const segmentLength = Math.min(64, Math.floor(n / 2));
  const overlap = Math.floor(segmentLength / 2);
  const step = segmentLength - overlap;

  // Hann window
  const window = new Float64Array(segmentLength);
  let windowSumSq = 0;
  for (let i = 0; i < segmentLength; i++) {
    window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (segmentLength - 1)));
    windowSumSq += window[i] * window[i];
  }

  // Количество сегментов
  const nSegments = Math.max(1, Math.floor((n - segmentLength) / step) + 1);

  // Дополняем до степени 2 для FFT
  const fftSize = nextPow2(segmentLength);

  // Средний PSD
  const avgPSD = new Float64Array(fftSize / 2 + 1);

  for (let seg = 0; seg < nSegments; seg++) {
    const offset = seg * step;
    const re = new Array(fftSize).fill(0);
    const im = new Array(fftSize).fill(0);

    for (let i = 0; i < segmentLength; i++) {
      re[i] = (series[offset + i] || 0) * window[i];
    }

    fft(re, im);

    // PSD = |X(f)|^2 / (windowSumSq * sampleRate)
    for (let k = 0; k <= fftSize / 2; k++) {
      const mag2 = re[k] * re[k] + im[k] * im[k];
      avgPSD[k] += mag2 / (windowSumSq * sampleRate + EPS);
    }
  }

  // Усредняем по сегментам
  const psd: number[] = [];
  const freqs: number[] = [];
  for (let k = 0; k <= fftSize / 2; k++) {
    avgPSD[k] /= nSegments;
    psd.push(avgPSD[k]);
    freqs.push(k * sampleRate / fftSize);
  }

  return { freqs, psd };
}

/**
 * Простой PSD через FFT (для N < 100)
 */
function simplePSD(series: number[], sampleRate: number): { freqs: number[]; psd: number[] } {
  const fftSize = nextPow2(series.length);
  const re = new Array(fftSize).fill(0);
  const im = new Array(fftSize).fill(0);

  // Убираем среднее (detrend)
  const mean = series.reduce((s, v) => s + v, 0) / series.length;
  for (let i = 0; i < series.length; i++) {
    re[i] = series[i] - mean;
  }

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

/** Следующая степень 2 */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// ─── Главный детектор ──────────────────────────────────────────────────────

export function detectHawking(input: DetectorInput): DetectorResult {
  const { trades, candles } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // Нужны сделки с таймстемпами
  const validTrades = trades && trades.length > 0 ? trades : [];
  const n = validTrades.length;

  metadata.n_trades = n;

  // v4.2: Gradual stale penalty instead of binary stale→0
  if (input.staleData) {
    const staleFactor = stalePenalty(input.staleMinutes);
    if (staleFactor <= 0) {
      metadata.insufficientData = true;
      metadata.staleData = true;
      metadata.staleMinutes = input.staleMinutes ?? 0;
      return {
        detector: 'HAWKING',
        description: 'Излучение — периодичность алгоритмов (устаревшие данные)',
        score: 0,
        confidence: 0,
        signal: 'NEUTRAL',
        metadata,
      };
    }
    // If stale but not completely dead, proceed with computation but apply penalty later
  }

  // ─── Минимум 50 сделок ─────────────────────────────────────────────────
  if (n < 50) {
    metadata.insufficientData = true;
    return {
      detector: 'HAWKING',
      description: 'Излучение — периодичность алгоритмов (недостаточно данных)',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  // ─── 1. Интервалы между сделками ────────────────────────────────────────
  const intervals: number[] = [];
  for (let i = 1; i < n; i++) {
    const dt = (validTrades[i].timestamp || 0)
      - (validTrades[i - 1].timestamp || 0);
    if (dt > 0) intervals.push(dt);
  }

  if (intervals.length < 10) {
    metadata.insufficientIntervals = true;
    return {
      detector: 'HAWKING',
      description: 'Излучение — периодичность алгоритмов (мало интервалов)',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  // Sample rate: средняя частота сделок (сделок/секунду)
  const totalTime = intervals.reduce((s, v) => s + v, 0);
  const sampleRate = intervals.length / (totalTime / 1000 + EPS); // сделки/сек

  metadata.sampleRate = Math.round(sampleRate * 100) / 100;

  // ─── 2. ACF — автокорреляционная функция ────────────────────────────────
  const maxLag = Math.min(20, Math.floor(intervals.length / 3));
  const acf = computeACF(intervals, maxLag);

  // Периодичность: max(|ACF(k)|) для k=2..20 (пропускаем lag 0 и 1)
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

  // ─── 3. PSD — спектральная плотность мощности ──────────────────────────
  let psdResult: { freqs: number[]; psd: number[] };

  if (n >= 100) {
    // Welch's method для N ≥ 100 (более устойчивый)
    psdResult = welchPSD(intervals, sampleRate);
    metadata.psdMethod = 'welch';
  } else {
    // Простой FFT для 50 ≤ N < 100
    psdResult = simplePSD(intervals, sampleRate);
    metadata.psdMethod = 'fft';
  }

  // ─── 4. Ищем пик в зоне алгоритмической торговли (0.5-5 Hz) ─────────────
  // Частота в Hz = freqs[k], но freqs — в циклах/сек (Hz)
  const algoZoneMin = 0.5;  // Hz
  const algoZoneMax = 5.0;  // Hz

  let peakPower = 0;
  let peakFreq = 0;
  let bandwidth = 0;

  for (let k = 1; k < psdResult.freqs.length; k++) {
    const freq = psdResult.freqs[k];
    if (freq >= algoZoneMin && freq <= algoZoneMax) {
      if (psdResult.psd[k] > peakPower) {
        peakPower = psdResult.psd[k];
        peakFreq = freq;
      }
    }
  }

  // Bandwidth: количество частотных бинов в зоне 0.5-5 Hz
  for (let k = 1; k < psdResult.freqs.length; k++) {
    if (psdResult.freqs[k] >= algoZoneMin && psdResult.freqs[k] <= algoZoneMax) {
      bandwidth++;
    }
  }

  metadata.peakFreq = Math.round(peakFreq * 100) / 100;
  metadata.peakPower = Math.round(peakPower * 1000) / 1000;
  metadata.bandwidth = bandwidth;

  // ─── 5. noise_ratio — сравнение пика с «фоном» (median PSD) ────────────
  // v4.1: Сравниваем пик с median_psd, не с общей мощностью — устойчивее к шуму
  const sortedPSD = [...psdResult.psd].sort((a, b) => a - b);
  const medianPSD = sortedPSD[Math.floor(sortedPSD.length / 2)] || EPS;

  const noiseRatio = 1 - (peakPower / (medianPSD * Math.max(bandwidth, 1) + EPS));
  const clampedNoiseRatio = Math.max(0, Math.min(1, noiseRatio));

  metadata.noiseRatio = Math.round(clampedNoiseRatio * 1000) / 1000;
  metadata.medianPSD = Math.round(medianPSD * 1000) / 1000;

  // ─── 6. Hawking score ──────────────────────────────────────────────────
  // periodicity * (1 - noise_ratio)
  // periodicity ∈ [0, 1], noise_ratio ∈ [0, 1]
  // Высокий periodicity + низкий noise_ratio = сильная периодичность над шумом
  const hawkingScore = Math.min(1, Math.max(0, periodicity * (1 - clampedNoiseRatio)));

  // ─── 7. VPIN context (дополнительно из input) ──────────────────────────
  const vpinScore = input.vpin ? Math.min(1, input.vpin.vpin / 0.8) : 0;
  metadata.vpinContext = Math.round(vpinScore * 100) / 100;

  // Итоговый скор — взвешенная комбинация
  // Основной вклад от периодичности, VPIN как контекст
  const score = Math.min(1, Math.max(0, hawkingScore * 0.85 + vpinScore * 0.15));

  metadata.hawkingRawScore = Math.round(hawkingScore * 1000) / 1000;
  metadata.algoZoneDetected = peakPower > medianPSD * 2;

  // ─── Signal direction ──────────────────────────────────────────────────
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2 && candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    signal = lastCandle.close > lastCandle.open ? 'BULLISH'
      : lastCandle.close < lastCandle.open ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.2
    ? Math.min(1, (periodicity + (1 - clampedNoiseRatio)) / 1.5)
    : 0;

  // Apply stale penalty (v4.2: gradual instead of binary)
  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
  const finalScore = clampScore(score * staleFactor);
  const finalConfidence = clampScore(confidence * staleFactor);
  metadata.staleFactor = staleFactor;

  return {
    detector: 'HAWKING',
    description: 'Излучение — периодичность алгоритмов (ACF + PSD)',
    score: finalScore,
    confidence: finalConfidence,
    signal,
    metadata,
  };
}
