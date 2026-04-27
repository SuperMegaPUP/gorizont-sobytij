// ─── ATTRACTOR — Аттрактор v5.1 (П2 — Takens + volume_profile + stickiness) ─
// Цена кластеризуется вокруг определённого уровня — как аттрактор
// в динамических системах.
//
// v5.1 П2 Правка (согласно спецификации v4):
// 1) takens_convergence (с авто τ и Silverman bandwidth):
//    - d=3 фиксированный, τ — автоматический
//    - Авто τ: τ = findFirstZeroACF(price_series) || 5
//    - KDE: h = 1.06 × σ × N^(-1/5) (правило Сильвермана)
//    - takens_convergence = концентрация плотности вокруг аттрактора
//
// 2) volume_profile_attractor:
//    - POC = уровень с максимальным объёмом
//    - Если |price-POC| < 2 ticks > 60% времени → зона аттрактора
//
// 3) price_stickiness:
//    - sticky = |price[t] - price[t-1]| < 0.5 × current_spread (НЕ по tick!)
//    - stickiness_ratio = sticky_time / window_length
//
// 4) attractor_score = 0.4 × takens + 0.3 × volume_profile + 0.3 × stickiness

import type { DetectorInput, DetectorResult } from './types';
import { clampScore, stalePenalty } from './guards';

const EPS = 1e-6;

// ─── Sigmoid centered normalization ─────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Sigmoid-centered normalization with smooth falloff.
 * center: точка аномальности (значение при котором norm = 0)
 * width: ширина перехода (sigmoid steepness)
 * 
 * sigmoidCentered(0.5, 0.7, 0.15) ≈ 0.00  — ниже центра = ноль
 * sigmoidCentered(0.7, 0.7, 0.15) = 0.00  — в центре = ноль (отсечение нормы)
 * sigmoidCentered(0.85, 0.7, 0.15) ≈ 0.76 — выше центра = растёт
 * sigmoidCentered(1.0, 0.7, 0.15) ≈ 1.00  — далеко выше = максимум
 */
function sigmoidCentered(x: number, center: number, width: number): number {
  return Math.max(0, 2 * sigmoid((x - center) / width) - 1);
}

// ─── Auto τ via ACF ──────────────────────────────────────────────────────

/**
 * Find first zero crossing of autocorrelation function.
 * This gives the optimal time delay τ for Takens embedding.
 * Falls back to 5 if no zero crossing found.
 * Range: [2, 20]
 */
function findFirstZeroACF(series: number[]): number {
  const n = series.length;
  if (n < 10) return 5;

  const mean = series.reduce((s, v) => s + v, 0) / n;
  const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  if (variance < EPS) return 5;

  // Compute ACF for lags 1..20
  const maxLag = Math.min(20, Math.floor(n / 3));

  for (let lag = 1; lag <= maxLag; lag++) {
    let autoCov = 0;
    for (let i = lag; i < n; i++) {
      autoCov += (series[i] - mean) * (series[i - lag] - mean);
    }
    const acf = autoCov / (n * variance);

    // First zero crossing
    if (acf <= 0) {
      return Math.max(2, Math.min(20, lag));
    }
  }

  // No zero crossing found — use first lag where ACF < 0.3
  for (let lag = 1; lag <= maxLag; lag++) {
    let autoCov = 0;
    for (let i = lag; i < n; i++) {
      autoCov += (series[i] - mean) * (series[i - lag] - mean);
    }
    const acf = autoCov / (n * variance);
    if (acf < 0.3) {
      return Math.max(2, Math.min(20, lag));
    }
  }

  return 5; // default
}

// ─── Takens Embedding + KDE ───────────────────────────────────────────────

/**
 * Takens embedding: maps 1D time series to d-dimensional phase space
 * point[i] = [series[i], series[i+τ], series[i+2τ], ...]
 */
function takensEmbedding(series: number[], d: number, tau: number): number[][] {
  const points: number[][] = [];
  for (let i = 0; i <= series.length - d * tau; i++) {
    const point: number[] = [];
    for (let j = 0; j < d; j++) {
      point.push(series[i + j * tau]);
    }
    points.push(point);
  }
  return points;
}

/**
 * Silverman's robust rule for KDE bandwidth:
 * h = 1.06 × min(σ, IQR/1.34) × N^(-1/5)
 */
function silvermanBandwidth(values: number[]): number {
  const n = values.length;
  if (n < 2) return 1;

  const mean = values.reduce((s, v) => s + v, 0) / n;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;

  return 1.06 * Math.min(std, iqr / 1.34) * Math.pow(n, -0.2);
}

/**
 * Kernel Density Estimation (Gaussian kernel)
 * Returns density at each data point
 */
function kde(values: number[], bandwidth: number): number[] {
  const n = values.length;
  if (n < 2 || bandwidth < EPS) return values.map(() => 1 / n);

  const densities: number[] = [];

  for (let i = 0; i < n; i++) {
    let density = 0;
    for (let j = 0; j < n; j++) {
      const u = (values[i] - values[j]) / bandwidth;
      density += Math.exp(-0.5 * u * u);
    }
    density /= (n * bandwidth * Math.sqrt(2 * Math.PI));
    densities.push(density);
  }

  return densities;
}

/**
 * Takens convergence: measures how concentrated the phase space
 * trajectory is around an attractor.
 *
 * Uses KDE on the distance of each point from the centroid.
 * High concentration = strong attractor.
 */
function takensConvergence(series: number[]): {
  convergence: number;
  tau: number;
  nPoints: number;
  bandwidth: number;
} {
  if (series.length < 15) {
    return { convergence: 0, tau: 5, nPoints: 0, bandwidth: 0 };
  }

  const d = 3; // fixed embedding dimension
  const tau = findFirstZeroACF(series);

  const points = takensEmbedding(series, d, tau);
  if (points.length < 5) {
    return { convergence: 0, tau, nPoints: points.length, bandwidth: 0 };
  }

  // Compute centroid
  const centroid: number[] = new Array(d).fill(0);
  for (const p of points) {
    for (let j = 0; j < d; j++) {
      centroid[j] += p[j];
    }
  }
  for (let j = 0; j < d; j++) {
    centroid[j] /= points.length;
  }

  // Compute distances from centroid
  const distances = points.map(p => {
    return Math.sqrt(p.reduce((s, v, j) => s + (v - centroid[j]) ** 2, 0));
  });

  // KDE on distances
  const bandwidth = silvermanBandwidth(distances);
  const densities = kde(distances, bandwidth);

  // Convergence = max density / mean density
  // High ratio → concentrated attractor
  const meanDensity = densities.reduce((s, d) => s + d, 0) / densities.length;
  const maxDensity = Math.max(...densities);

  const convergence = meanDensity > EPS
    ? Math.min(1, (maxDensity / meanDensity - 1) / 5) // normalize: ratio 1→0, 6→1
    : 0;

  return { convergence, tau, nPoints: points.length, bandwidth };
}

// ─── Volume Profile ──────────────────────────────────────────────────────

/**
 * Volume profile analysis: finds Point of Control (POC) and
 * measures how much time price spends near POC.
 */
function volumeProfile(
  trades: Array<{ price: number; quantity: number }>,
  tickSize: number,
): {
  poc: number;          // Point of Control (price with max volume)
  pocVolume: number;    // Volume at POC
  attractionRatio: number; // % of time price is within 2 ticks of POC
  profileEntropy: number;  // Entropy of volume distribution
} {
  if (trades.length < 5 || tickSize < EPS) {
    return { poc: 0, pocVolume: 0, attractionRatio: 0, profileEntropy: 0 };
  }

  // Group volume by price levels (rounded to tick)
  const levelVol = new Map<number, number>();
  for (const t of trades) {
    const level = Math.round(t.price / tickSize) * tickSize;
    levelVol.set(level, (levelVol.get(level) || 0) + t.quantity);
  }

  // Find POC
  let poc = 0;
  let pocVolume = 0;
  for (const [price, vol] of levelVol) {
    if (vol > pocVolume) {
      poc = price;
      pocVolume = vol;
    }
  }

  // Attraction ratio: % of trades within 2 ticks of POC
  const nearPoc = trades.filter(t => Math.abs(t.price - poc) <= 2 * tickSize).length;
  const attractionRatio = nearPoc / trades.length;

  // Profile entropy
  const totalVol = trades.reduce((s, t) => s + t.quantity, 0);
  let entropy = 0;
  for (const vol of levelVol.values()) {
    if (vol > 0 && totalVol > 0) {
      const p = vol / totalVol;
      entropy -= p * Math.log2(p);
    }
  }

  return { poc, pocVolume, attractionRatio, profileEntropy: entropy };
}

// ─── Main Detector ────────────────────────────────────────────────────────

export function detectAttractor(input: DetectorInput): DetectorResult {
  const { prices, recentTrades, trades, orderbook } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // v4.2: Gradual stale penalty instead of binary stale→0
  if (input.staleData) {
    const staleFactor = stalePenalty(input.staleMinutes);
    if (staleFactor <= 0) {
      return {
        detector: 'ATTRACTOR',
        description: 'Аттрактор — цена прилипает к уровню (устаревшие данные)',
        score: 0, confidence: 0, signal: 'NEUTRAL',
        metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
      };
    }
    // If stale but not completely dead, proceed with computation but apply penalty later
  }

  if (prices.length < 20 || trades.length < 5) {
    return {
      detector: 'ATTRACTOR',
      description: 'Аттрактор — цена прилипает к уровню',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true },
    };
  }

  // ─── 0. Detrended prices (CRITICAL — raw prices = random walk artifact) ─
  const sma20: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    const start = Math.max(0, i - 19);
    const window = prices.slice(start, i + 1);
    sma20.push(window.reduce((s, v) => s + v, 0) / window.length);
  }
  const detrended = prices.map((p, i) => p - sma20[i]);

  // ─── 1. Takens convergence ────────────────────────────────────────────
  const takens = takensConvergence(detrended);
  metadata.takensConvergence = Math.round(takens.convergence * 1000) / 1000;
  metadata.takensTau = takens.tau;
  metadata.takensPoints = takens.nPoints;
  metadata.takensBandwidth = Math.round(takens.bandwidth * 10000) / 10000;

  // ─── 2. Volume profile ────────────────────────────────────────────────
  // Estimate tick size from trades
  const sortedPrices = [...new Set(trades.map(t => t.price))].sort((a, b) => a - b);
  let tickSize = 0.01; // default
  if (sortedPrices.length >= 2) {
    const diffs: number[] = [];
    for (let i = 1; i < sortedPrices.length; i++) {
      const diff = sortedPrices[i] - sortedPrices[i - 1];
      if (diff > 0) diffs.push(diff);
    }
    if (diffs.length > 0) {
      diffs.sort((a, b) => a - b);
      tickSize = diffs[0];
    }
  }

  const vProfile = volumeProfile(trades, tickSize);
  metadata.poc = Math.round(vProfile.poc * 100) / 100;
  metadata.pocVolume = Math.round(vProfile.pocVolume);
  metadata.attractionRatio = Math.round(vProfile.attractionRatio * 1000) / 1000;
  metadata.profileEntropy = Math.round(vProfile.profileEntropy * 100) / 100;

  // ─── 3. Price stickiness ──────────────────────────────────────────────
  // sticky = |price[t] - price[t-1]| < 0.5 × EMA(spread, 10)
  // Use EMA(spread, 10) — adapts to spread widening
  const priceDiffs: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    priceDiffs.push(Math.abs(prices[i] - prices[i - 1]));
  }
  const sortedDiffs = [...priceDiffs].sort((a, b) => a - b);
  const nonZero = sortedDiffs.filter(d => d > EPS);
  const medianSpread = nonZero.length > 0 ? nonZero[Math.floor(nonZero.length / 2)] : 0.01;

  // EMA(spread, 10)
  let emaSpread = medianSpread;
  const alpha = 2 / (10 + 1);
  for (const diff of priceDiffs) {
    emaSpread = alpha * diff + (1 - alpha) * emaSpread;
  }

  const stickyThreshold = 0.5 * emaSpread;
  let stickyCount = 0;
  for (let i = 1; i < prices.length; i++) {
    if (Math.abs(prices[i] - prices[i - 1]) < stickyThreshold + EPS) {
      stickyCount++;
    }
  }
  const stickinessRatio = prices.length > 1 ? stickyCount / (prices.length - 1) : 0;
  metadata.emaSpread = Math.round(emaSpread * 10000) / 10000;
  metadata.stickyThreshold = Math.round(stickyThreshold * 10000) / 10000;
  metadata.stickinessRatio = Math.round(stickinessRatio * 1000) / 1000;
  metadata.stickyCount = stickyCount;

  // Stickiness score: sigmoid-centered (центр 0.7)
  const stickinessNorm = sigmoidCentered(stickinessRatio, 0.7, 0.15);
  metadata.stickinessNorm = Math.round(stickinessNorm * 1000) / 1000;

  // ─── 3.5. POC distance guard (smooth decay) ───────────────────────────
  const currentPrice = prices[prices.length - 1];
  // ATR(14) для нормировки POC distance (С7)
  let atr = 0.01;
  if (input.candles && input.candles.length >= 14) {
    const ranges = input.candles.slice(-14).map(c => c.high - c.low);
    atr = ranges.reduce((s, r) => s + r, 0) / 14;
  } else if (prices.length >= 14) {
    const diffs = [];
    for (let i = 1; i < prices.length; i++) diffs.push(Math.abs(prices[i] - prices[i - 1]));
    atr = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  }
  const pocDistance = vProfile.poc > 0 ? Math.abs(vProfile.poc - currentPrice) / Math.max(atr, EPS) : 0;
  metadata.pocDistance = Math.round(pocDistance * 1000) / 1000;

  // Volume profile score: sigmoid-centered (центр 0.7)
  const volProfileNorm = sigmoidCentered(vProfile.attractionRatio, 0.7, 0.15);
  // Smooth decay for far POC (С7): distance > 0.5 ATR → gradual decay
  const volProfileScore = pocDistance > 0.5
    ? volProfileNorm * Math.max(0, 1 - (pocDistance - 0.5) / 1.5)
    : volProfileNorm;
  metadata.volProfileNorm = Math.round(volProfileNorm * 1000) / 1000;

  // Takens convergence: sigmoid-centered (центр 0.6)
  const takensNorm = sigmoidCentered(takens.convergence, 0.6, 0.15);
  metadata.takensNorm = Math.round(takensNorm * 1000) / 1000;

  // ─── 4. Composite score ───────────────────────────────────────────────
  // attractor_score = 0.4 × takens + 0.3 × vol_profile + 0.3 × stickiness
  const rawScore = 0.4 * takensNorm + 0.3 * volProfileScore + 0.3 * stickinessNorm;
  const score = Math.min(1, Math.max(0, rawScore));

  // ─── 5. Signal direction ──────────────────────────────────────────────
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.15) {
    const currentPrice = prices[prices.length - 1];

    // Use POC as attractor level if available
    const attractorPrice = vProfile.poc > 0 ? vProfile.poc : prices.reduce((s, p) => s + p, 0) / prices.length;

    const diff = currentPrice - attractorPrice;
    // Price below attractor → expected reversion up (BULLISH)
    // Price above → expected reversion down (BEARISH)
    const range = Math.max(...prices) - Math.min(...prices);
    signal = diff < -range * 0.1 ? 'BULLISH'
      : diff > range * 0.1 ? 'BEARISH' : 'NEUTRAL';
  }

  // ─── 6. Confidence ────────────────────────────────────────────────────
  // Higher when multiple components agree
  const components = [takensNorm, volProfileNorm, stickinessNorm];
  const activeComponents = components.filter(s => s > 0.2).length;
  const agreement = activeComponents / 3;
  const confidence = score > 0.15
    ? Math.min(1, agreement * 1.2 * Math.max(score, 0.3))
    : 0;

  // Apply stale penalty (v4.2: gradual instead of binary)
  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
  const finalScore = clampScore(score * staleFactor);
  const finalConfidence = clampScore(confidence * staleFactor);
  metadata.staleFactor = staleFactor;

  return {
    detector: 'ATTRACTOR',
    description: 'Аттрактор — Takens + профиль объёма + прилипание',
    score: finalScore,
    confidence: finalConfidence,
    signal,
    metadata,
  };
}
