// ─── WAVEFUNCTION — Волновая функция v5.1 (П2 — Particle Filter + log-weights) ─
// Обнаружение циклических паттернов через Particle Filter с 3 состояниями:
// ACCUMULATE, DISTRIBUTE, HOLD
//
// v5.1 П2 Правка (согласно спецификации v4):
// 1) Transition matrix фиксированная:
//    [0.7, 0.2, 0.1] ACCUMULATE
//    [0.2, 0.6, 0.2] DISTRIBUTE
//    [0.1, 0.2, 0.7] HOLD
//
// 2) Student-t likelihood + Laplace smoothing
//
// 3) ОБЯЗАТЕЛЬНО — Мониторинг вырождения + ресэмплинг:
//    - N_eff = 1 / (Σ(weights²) + ε)
//    - if (N_eff < 0.5 × n_particles) → systematicResample()
//
// 4) ОБЯЗАТЕЛЬНО — Логарифмирование весов:
//    - Все операции в лог-пространстве
//    - Нормализация через log-sum-exp
//    - Предотвращает underflow при длинных окнах

import type { DetectorInput, DetectorResult } from './types';
import { clampScore, stalePenalty } from './guards';

const DF_PRIMARY = 5;
const DF_ROLLOUT = 7;
const EPS = 1e-6;
const N_PARTICLES = 200; // v4.2: 200 fixed particles

// ─── Particle Filter Types ────────────────────────────────────────────────

enum State { ACCUMULATE = 0, DISTRIBUTE = 1, HOLD = 2 }

interface Particle {
  state: State;
  logWeight: number;
  params: number[]; // jittered observation model params
}

// Transition matrix (row = from, col = to)
const TRANSITION: number[][] = [
  [0.7, 0.2, 0.1],
  [0.2, 0.6, 0.2],
  [0.1, 0.2, 0.7],
];

// v4.2: Fixed Student-t observation model parameters
const STATE_MU: Record<State, number[]> = {
  [State.ACCUMULATE]: [+0.3, +0.2, +0.2],
  [State.DISTRIBUTE]: [-0.3, -0.2, -0.2],
  [State.HOLD]:       [ 0.0,  0.0,  0.0],
};

const BASE_NU: Record<State, number> = {
  [State.ACCUMULATE]: 5,
  [State.DISTRIBUTE]: 5,
  [State.HOLD]:       4,
};

// ─── Log-space utilities ──────────────────────────────────────────────────

/**
 * Log-sum-exp: computes log(Σ exp(x_i)) in a numerically stable way
 */
function logSumExp(values: number[]): number {
  if (values.length === 0) return -Infinity;
  const maxVal = Math.max(...values);
  if (maxVal === -Infinity) return -Infinity;
  return maxVal + Math.log(values.reduce((s, v) => s + Math.exp(v - maxVal), 0));
}

// ─── Student-t likelihood ────────────────────────────────────────────────

/**
 * Student-t log-likelihood for a price change observation
 * given a particular state.
 *
 * ACCUMULATE: expects positive cumulative delta (buy pressure)
 * DISTRIBUTE: expects negative cumulative delta (sell pressure)
 * HOLD: expects near-zero delta
 */
function studentTLogLikelihood(
  z: number[], // observation vector [cumDelta_norm, ofi_norm, trade_imbalance_norm]
  state: State,
  currentNu: Record<State, number>,
  sigma: number[] = [1, 1, 1], // diagonal covariance
): number {
  const mu = STATE_MU[state];
  const nu = currentNu[state];
  const d = z.length;

  let delta = 0;
  for (let i = 0; i < d; i++) {
    delta += Math.pow(z[i] - mu[i], 2) / Math.max(sigma[i], EPS);
  }
  delta /= nu;

  // Simplified Student-t log-likelihood (ignoring constants)
  return -(nu + d) / 2 * Math.log(1 + delta);
}

// ─── Systematic Resampling ────────────────────────────────────────────────

/**
 * Systematic resampling — redraws particles proportional to their weights.
 * Prevents particle degeneracy.
 */
function systematicResample(particles: Particle[]): Particle[] {
  const n = particles.length;
  const logWeights = particles.map(p => p.logWeight);
  const logNorm = logSumExp(logWeights);
  const weights = logWeights.map(lw => Math.exp(lw - logNorm));
  const cumSum: number[] = [weights[0]];
  for (let i = 1; i < n; i++) cumSum.push(cumSum[i - 1] + weights[i]);
  const u0 = Math.random() / n;
  const newParticles: Particle[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const u = u0 + i / n;
    while (j < n - 1 && cumSum[j] < u) j++;
    newParticles.push({
      state: particles[j].state,
      logWeight: -Math.log(n),
      params: [...particles[j].params],
    });
  }
  return newParticles;
}

// Jitter: σ_jitter = 0.05 × range / N^(1/d)
function applyJitter(particles: Particle[], zRange: number): void {
  const d = 3;
  const sigmaJitter = 0.05 * zRange / Math.pow(particles.length, 1 / d);
  for (const p of particles) {
    p.params = p.params.map(v => v + gaussianRandom(0, sigmaJitter));
  }
}

function gaussianRandom(mean: number, std: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z0 * std;
}

/**
 * Effective sample size: N_eff = 1 / (Σ(w_i²) + ε)
 * Computed from log-weights for numerical stability
 */
function effectiveSampleSize(particles: Particle[]): number {
  const logWeights = particles.map(p => p.logWeight);
  const logNorm = logSumExp(logWeights);
  const weights = logWeights.map(lw => Math.exp(lw - logNorm));
  const sumSq = weights.reduce((s, w) => s + w * w, 0);
  return 1 / (sumSq + EPS);
}

// ─── Autocorrelation-based period detection (supplementary) ─────────────

function findDominantPeriod(values: number[]): { period: number; strength: number } {
  const n = values.length;
  if (n < 8) return { period: 0, strength: 0 };

  const mean = values.reduce((s, v) => s + v, 0) / n;
  const detrended = values.map(v => v - mean);

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
    const variance = detrended.reduce((s, v) => s + v * v, 0) / n;
    const normalized = variance > 0 ? autocorr / variance : 0;

    if (normalized > bestStrength) {
      bestStrength = normalized;
      bestPeriod = lag;
    }
  }

  return { period: bestPeriod, strength: Math.min(1, Math.max(0, bestStrength)) };
}

// ─── Main Detector ────────────────────────────────────────────────────────

export function detectWavefunction(input: DetectorInput): DetectorResult {
  const { prices, cumDelta, trades } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // v4.2: Gradual stale penalty instead of binary stale→0
  if (input.staleData) {
    const staleFactor = stalePenalty(input.staleMinutes);
    if (staleFactor <= 0) {
      return {
        detector: 'WAVEFUNCTION',
        description: 'Волновая функция — циклические паттерны (устаревшие данные)',
        score: 0, confidence: 0, signal: 'NEUTRAL',
        metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
      };
    }
    // If stale but not completely dead, proceed with computation but apply penalty later
  }

  if (prices.length < 12 || trades.length < 10) {
    return {
      detector: 'WAVEFUNCTION',
      description: 'Волновая функция — циклические паттерны',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true },
    };
  }

  // Local ν per call (resets each tick)
  let currentNu = { ...BASE_NU };

  // ─── 1. Prepare delta series for particle filter ──────────────────────
  // Running cumulative delta from trades
  const runningDelta: number[] = [];
  let cumSum = 0;
  for (const t of trades) {
    const side = t.direction.toUpperCase().trim();
    if (side === 'B' || side === 'BUY') cumSum += t.quantity;
    else if (side === 'S' || side === 'SELL') cumSum -= t.quantity;
    runningDelta.push(cumSum);
  }

  // Delta changes (differences) for PF observations
  const deltaChanges: number[] = [];
  for (let i = 1; i < runningDelta.length; i++) {
    deltaChanges.push(runningDelta[i] - runningDelta[i - 1]);
  }

  // Price changes
  const priceChanges: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    priceChanges.push(prices[i] - prices[i - 1]);
  }

  // ─── 2. Observation vector z ──────────────────────────────────────────
  // z = [cumDelta_norm, ofi_norm, trade_imbalance_norm]
  const ofiValues = trades.map((t, i) => {
    const side = t.direction.toUpperCase().trim();
    const s = side === 'B' || side === 'BUY' ? 1 : side === 'S' || side === 'SELL' ? -1 : 0;
    return s * t.quantity;
  });
  const imbalanceValues = trades.map(t => {
    const side = t.direction.toUpperCase().trim();
    return side === 'B' || side === 'BUY' ? 1 : 0;
  });

  // Robust normalize (median/IQR)
  function robustNormalizeSeries(values: number[]): number[] {
    const sorted = [...values].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1 || 1;
    return values.map(v => (v - med) / iqr);
  }

  const normCumDelta = robustNormalizeSeries(deltaChanges);
  const normOFI = robustNormalizeSeries(ofiValues.slice(1));
  const normImbalance = robustNormalizeSeries(imbalanceValues.slice(1));

  const pfLength = Math.min(normCumDelta.length, normOFI.length, normImbalance.length, 100);

  // ─── 3. Particle Filter ───────────────────────────────────────────────
  let particles: Particle[] = Array.from({ length: N_PARTICLES }, () => ({
    state: Math.floor(Math.random() * 3) as State,
    logWeight: -Math.log(N_PARTICLES),
    params: [0, 0, 0],
  }));

  let resampleCount = 0;

  for (let t = 0; t < pfLength; t++) {
    const z = [normCumDelta[t] || 0, normOFI[t] || 0, normImbalance[t] || 0];

    for (const p of particles) {
      const r = Math.random();
      const row = TRANSITION[p.state];
      let cumProb = 0;
      for (let s = 0; s < 3; s++) {
        cumProb += row[s];
        if (r < cumProb) { p.state = s as State; break; }
      }
      const logLik = studentTLogLikelihood(z, p.state, currentNu);
      p.logWeight += logLik;
    }

    const logNorm = logSumExp(particles.map(p => p.logWeight));
    for (const p of particles) p.logWeight -= logNorm;

    const nEff = effectiveSampleSize(particles);
    if (nEff < 0.5 * N_PARTICLES) {
      particles = systematicResample(particles);
      // Jitter after resampling (CRITICAL — prevents collapse)
      const zRange = Math.max(...z) - Math.min(...z);
      applyJitter(particles, zRange);
      resampleCount++;
    }
  }

  metadata.resampleCount = resampleCount;

  // ─── 4. Stale data guard (Л6) ─────────────────────────────────────────
  const lastTradeTs = trades[trades.length - 1]?.timestamp || 0;
  const now = Date.now();
  const staleThreshold = 30 * 1000; // 30 seconds
  const isStale = now - lastTradeTs > staleThreshold;
  metadata.isStale = isStale;

  if (isStale) {
    // Boost HOLD probability, increase ν
    for (const p of particles) {
      if (p.state === State.HOLD) p.logWeight += Math.log(1.5);
    }
    currentNu[State.ACCUMULATE] = Math.max(currentNu[State.ACCUMULATE], 7);
    currentNu[State.DISTRIBUTE] = Math.max(currentNu[State.DISTRIBUTE], 7);
    currentNu[State.HOLD] = Math.max(currentNu[State.HOLD], 7);
  }

  // ν expansion on large price change
  const priceChange = Math.abs(prices[prices.length - 1] - prices[prices.length - 2]) || 0;
  const atr = prices.length >= 14
    ? prices.slice(-14).reduce((s, p, i, arr) => s + (i > 0 ? Math.abs(p - arr[i-1]) : 0), 0) / 13
    : 0.01;
  if (priceChange > 0.3 * atr) {
    currentNu[State.ACCUMULATE] = Math.max(currentNu[State.ACCUMULATE], 7);
    currentNu[State.DISTRIBUTE] = Math.max(currentNu[State.DISTRIBUTE], 7);
    currentNu[State.HOLD] = Math.max(currentNu[State.HOLD], 7);
  }

  metadata.nuAccumulate = currentNu[State.ACCUMULATE];
  metadata.nuDistribute = currentNu[State.DISTRIBUTE];
  metadata.nuHold = currentNu[State.HOLD];

  // ─── 3. Compute state probabilities ──────────────────────────────────
  const logWeights = particles.map(p => p.logWeight);
  const logNorm = logSumExp(logWeights);
  const weights = logWeights.map(lw => Math.exp(lw - logNorm));

  let probAccumulate = 0;
  let probDistribute = 0;
  let probHold = 0;

  for (let i = 0; i < particles.length; i++) {
    switch (particles[i].state) {
      case State.ACCUMULATE: probAccumulate += weights[i]; break;
      case State.DISTRIBUTE: probDistribute += weights[i]; break;
      case State.HOLD: probHold += weights[i]; break;
    }
  }

  metadata.probAccumulate = Math.round(probAccumulate * 1000) / 1000;
  metadata.probDistribute = Math.round(probDistribute * 1000) / 1000;
  metadata.probHold = Math.round(probHold * 1000) / 1000;

  // Non-HOLD probability = "cycle detected"
  // HOLD guard: обнуляем если HOLD доминирует или не-HOLD не имеет足够 уверенности
  const maxNonHold = Math.max(probAccumulate, probDistribute);
  let cycleProbability = 0;
  if (probHold > maxNonHold) {
    // HOLD доминирует — рынок спокоен, скор = 0
    cycleProbability = 0;
  } else if (maxNonHold > probHold * 1.5 && maxNonHold > 0.4) {
    // Не-HOLD доминирует с запасом 1.5× над HOLD и уверенностью > 40%
    cycleProbability = 1 - probHold;
  } else {
    // Не-HOLD формально доминирует, но HOLD близко — неуверенный сигнал
    cycleProbability = 0;
  }
  metadata.cycleProbabilityGuard = cycleProbability;

  // ─── 4. Autocorrelation-based period detection (supplementary) ──────
  const { period, strength: autocorrStrength } = findDominantPeriod(prices);
  metadata.dominantPeriod = period;
  metadata.autocorrStrength = Math.round(autocorrStrength * 1000) / 1000;

  // Period reproducibility
  let reproducibility = 0;
  if (period > 0 && prices.length >= period * 2) {
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

  // Cycle count
  const cycleCount = period > 0 ? Math.floor(prices.length / period) : 0;
  metadata.cycleCount = cycleCount;

  // Trend filter (prevent false positives from monotonic trends)
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
    }
  }
  metadata.trendR2 = Math.round(trendR2 * 1000) / 1000;
  const trendPenalty = trendR2 > 0.9 ? 0.2 : trendR2 > 0.8 ? 0.5 : 1.0;

  // ─── 5. Composite score ───────────────────────────────────────────────
  // PF-based cycle probability + autocorrelation confirmation
  const pfScore = cycleProbability; // probability of non-HOLD state
  const acScore = autocorrStrength > 0.6 ? 1
    : autocorrStrength > 0.4 ? 0.7
    : autocorrStrength > 0.2 ? 0.3 : 0;
  const repScore = reproducibility > 0.6 ? 1
    : reproducibility > 0.4 ? 0.7
    : reproducibility > 0.2 ? 0.3 : 0;

  // Weighted: PF (40%) + autocorrelation (30%) + reproducibility (30%)
  const rawScore = (pfScore * 0.4 + acScore * 0.3 + repScore * 0.3) * trendPenalty;
  const score = Math.min(1, Math.max(0, rawScore));

  // ─── 6. Signal direction ──────────────────────────────────────────────
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2) {
    // Direction from PF state probabilities
    if (probAccumulate > probDistribute && probAccumulate > probHold) {
      signal = 'BULLISH'; // Accumulation phase → expect price rise
    } else if (probDistribute > probAccumulate && probDistribute > probHold) {
      signal = 'BEARISH'; // Distribution phase → expect price fall
    } else if (period > 0) {
      // Fallback: cycle phase
      const phasePosition = prices.length % period;
      const halfPeriod = period / 2;
      signal = phasePosition < halfPeriod ? 'BULLISH' : 'BEARISH';
    }
  }

  // ─── 7. Confidence ────────────────────────────────────────────────────
  const nEff = effectiveSampleSize(particles);
  metadata.nEff = Math.round(nEff * 10) / 10;

  const confidence = score > 0.2
    ? Math.min(1, (pfScore * 0.5 + acScore * 0.3 + repScore * 0.2) *
      Math.min(1, nEff / (N_PARTICLES * 0.3))) // penalize low N_eff
    : 0;

  // Apply stale penalty (v4.2: gradual instead of binary)
  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
  const finalScore = clampScore(score * staleFactor);
  const finalConfidence = clampScore(confidence * staleFactor);
  metadata.staleFactor = staleFactor;

  return {
    detector: 'WAVEFUNCTION',
    description: 'Волновая функция — Particle Filter + циклические паттерны',
    score: finalScore,
    confidence: finalConfidence,
    signal,
    metadata,
  };
}
