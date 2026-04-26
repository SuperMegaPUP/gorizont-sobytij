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
 * Silverman's rule for KDE bandwidth:
 * h = 1.06 × σ × N^(-1/5)
 */
function silvermanBandwidth(values: number[]): number {
  const n = values.length;
  if (n < 2) return 1;

  const mean = values.reduce((s, v) => s + v, 0) / n;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);

  return 1.06 * std * Math.pow(n, -0.2);
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

  if (prices.length < 12 || trades.length < 5) {
    return {
      detector: 'ATTRACTOR',
      description: 'Аттрактор — цена прилипает к уровню',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true },
    };
  }

  // ─── 1. Takens convergence ────────────────────────────────────────────
  const takens = takensConvergence(prices);
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

  // Volume profile score: attraction > 0.6 → strong attractor
  const volumeProfileScore = vProfile.attractionRatio > 0.7 ? 1
    : vProfile.attractionRatio > 0.5 ? 0.8
    : vProfile.attractionRatio > 0.35 ? 0.5
    : vProfile.attractionRatio > 0.2 ? 0.2 : 0;

  // ─── 3. Price stickiness ──────────────────────────────────────────────
  // sticky = |price[t] - price[t-1]| < 0.5 × current_spread
  // Use orderbook spread if available, else estimate from prices
  let spread = 0;
  if (orderbook.bids.length > 0 && orderbook.asks.length > 0) {
    spread = orderbook.asks[0].price - orderbook.bids[0].price;
  } else if (prices.length >= 2) {
    // Estimate spread from price differences
    const priceDiffs: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      priceDiffs.push(Math.abs(prices[i] - prices[i - 1]));
    }
    priceDiffs.sort((a, b) => a - b);
    // Spread ≈ median non-zero price difference
    const nonZero = priceDiffs.filter(d => d > EPS);
    spread = nonZero.length > 0 ? nonZero[Math.floor(nonZero.length / 2)] : 0.01;
  } else {
    spread = 0.01;
  }

  const stickyThreshold = 0.5 * spread;
  let stickyCount = 0;
  for (let i = 1; i < prices.length; i++) {
    if (Math.abs(prices[i] - prices[i - 1]) < stickyThreshold + EPS) {
      stickyCount++;
    }
  }
  const stickinessRatio = prices.length > 1 ? stickyCount / (prices.length - 1) : 0;
  metadata.spread = Math.round(spread * 10000) / 10000;
  metadata.stickyThreshold = Math.round(stickyThreshold * 10000) / 10000;
  metadata.stickinessRatio = Math.round(stickinessRatio * 1000) / 1000;
  metadata.stickyCount = stickyCount;

  // Stickiness score: high stickiness → strong attractor
  const stickinessScore = stickinessRatio > 0.7 ? 1
    : stickinessRatio > 0.5 ? 0.8
    : stickinessRatio > 0.3 ? 0.5
    : stickinessRatio > 0.15 ? 0.2 : 0;

  // ─── 4. Composite score ───────────────────────────────────────────────
  // attractor_score = 0.4 × takens + 0.3 × volume_profile + 0.3 × stickiness
  const rawScore = takens.convergence * 0.4 + volumeProfileScore * 0.3 + stickinessScore * 0.3;
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
  const components = [takens.convergence, volumeProfileScore, stickinessScore];
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
