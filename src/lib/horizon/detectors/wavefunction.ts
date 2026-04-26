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

const EPS = 1e-6;

// ─── Particle Filter Types ────────────────────────────────────────────────

enum State { ACCUMULATE = 0, DISTRIBUTE = 1, HOLD = 2 }

interface Particle {
  state: State;
  logWeight: number;
}

// Transition matrix (row = from, col = to)
const TRANSITION: number[][] = [
  [0.7, 0.2, 0.1], // ACCUMULATE →
  [0.2, 0.6, 0.2], // DISTRIBUTE  →
  [0.1, 0.2, 0.7], // HOLD        →
];

const N_PARTICLES = 100;

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
  priceChange: number,
  deltaChange: number,
  state: State,
): number {
  const df = 3; // degrees of freedom (heavy tails)
  const observation = deltaChange; // primary signal

  let mu: number;
  let sigma: number;

  switch (state) {
    case State.ACCUMULATE:
      mu = 0.3;
      sigma = 1.0;
      break;
    case State.DISTRIBUTE:
      mu = -0.3;
      sigma = 1.0;
      break;
    case State.HOLD:
      mu = 0;
      sigma = 0.5;
      break;
  }

  // Student-t log PDF: log((1 + (x-μ)²/(σ²×df))^(-(df+1)/2) / (σ×B(df/2, 1/2)×√df))
  // Simplified (ignoring constant since we normalize):
  const z = (observation - mu) / (sigma + EPS);
  return -(df + 1) / 2 * Math.log(1 + z * z / df);
}

// ─── Systematic Resampling ────────────────────────────────────────────────

/**
 * Systematic resampling — redraws particles proportional to their weights.
 * Prevents particle degeneracy.
 */
function systematicResample(particles: Particle[]): Particle[] {
  const n = particles.length;

  // Normalize weights
  const logWeights = particles.map(p => p.logWeight);
  const logNorm = logSumExp(logWeights);
  const weights = logWeights.map(lw => Math.exp(lw - logNorm));

  // Cumulative sum
  const cumSum: number[] = [weights[0]];
  for (let i = 1; i < n; i++) {
    cumSum.push(cumSum[i - 1] + weights[i]);
  }

  // Systematic resampling
  const u0 = Math.random() / n;
  const newParticles: Particle[] = [];
  let j = 0;

  for (let i = 0; i < n; i++) {
    const u = u0 + i / n;
    while (j < n - 1 && cumSum[j] < u) j++;
    newParticles.push({
      state: particles[j].state,
      logWeight: -Math.log(n), // uniform log-weight after resampling
    });
  }

  return newParticles;
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

  // v4.1.2: Stale data → нет аномалии
  if (input.staleData) {
    return {
      detector: 'WAVEFUNCTION',
      description: 'Волновая функция — циклические паттерны (устаревшие данные)',
      score: 0, confidence: 0, signal: 'NEUTRAL',
      metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
    };
  }

  if (prices.length < 12 || trades.length < 10) {
    return {
      detector: 'WAVEFUNCTION',
      description: 'Волновая функция — циклические паттерны',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true },
    };
  }

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

  // ─── 2. Particle Filter ───────────────────────────────────────────────
  // Initialize particles with uniform weights
  let particles: Particle[] = Array.from({ length: N_PARTICLES }, () => ({
    state: Math.floor(Math.random() * 3) as State,
    logWeight: -Math.log(N_PARTICLES), // uniform in log-space
  }));

  let resampleCount = 0;
  const pfLength = Math.min(deltaChanges.length, priceChanges.length, 100);

  for (let t = 0; t < pfLength; t++) {
    const pc = priceChanges[t] || 0;
    const dc = deltaChanges[t] || 0;

    // Normalize observations
    const priceStd = Math.sqrt(priceChanges.reduce((s, v) => s + v * v, 0) / priceChanges.length) || 1;
    const deltaStd = Math.sqrt(deltaChanges.reduce((s, v) => s + v * v, 0) / deltaChanges.length) || 1;

    const normPrice = pc / priceStd;
    const normDelta = dc / deltaStd;

    // Update each particle
    for (const p of particles) {
      // Transition: sample new state from transition matrix
      const r = Math.random();
      const row = TRANSITION[p.state];
      let cumProb = 0;
      for (let s = 0; s < 3; s++) {
        cumProb += row[s];
        if (r < cumProb) {
          p.state = s as State;
          break;
        }
      }

      // Likelihood: how well does this observation match the state?
      const logLik = studentTLogLikelihood(normPrice, normDelta, p.state);

      // Update weight in log-space
      p.logWeight += logLik;
    }

    // Normalize weights in log-space
    const logNorm = logSumExp(particles.map(p => p.logWeight));
    for (const p of particles) {
      p.logWeight -= logNorm;
    }

    // Check effective sample size
    const nEff = effectiveSampleSize(particles);
    if (nEff < 0.5 * N_PARTICLES) {
      particles = systematicResample(particles);
      resampleCount++;
    }
  }

  metadata.resampleCount = resampleCount;

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
  const cycleProbability = 1 - probHold;

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

  return {
    detector: 'WAVEFUNCTION',
    description: 'Волновая функция — Particle Filter + циклические паттерны',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
