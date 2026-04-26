// ─── CIPHER — Шифр v5.2 (П2 — PCA→ICA + whitening + robust scaling) ────────────
// Алгоритмический бот оставляет «отпечаток» в виде:
// - Доминирующая главная компонента (PCA dominance_ratio > 0.6)
// - Негауссовы независимые компоненты (ICA kurtosis > 3)
//
// v5.2 П2 Правка (согласно спецификации v4.2):
//
// УРОВЕНЬ 1 (быстрый скрининг):
//   1) features = robustNormalize([volume, trade_size, interval], window=100)
//   2) PCA(n_components=3).fit(features, { whiten: true })
//      — ИЛИ PCA от корреляционной матрицы (не ковариационной!)
//      — После robust scaling (IQR) explained_variance_ratio_ искажается
//        если считать PCA от ковариационной матрицы. Whitening или
//        корреляционная матрица решает эту проблему.
//   3) dominance_ratio = explained_variance_ratio_[0]
//   4) Если dominance_ratio > 0.6 → алгоритм
//   5) cipher_quick = dominance_ratio
//
// УРОВЕНЬ 2 (глубокий анализ, только если cipher_quick > 0.5):
//   1) Проверяем condition number матрицы ковариации:
//      - cov_condition > 1000 → skip ICA → cipher_score = cipher_quick
//   2) ICA на том же normalized matrix, max_iterations=200
//   3) Если ICA не сошлась → cipher_score = cipher_quick
//   4) kurtosis = mean(|IC_i|^4) / mean(|IC_i|^2)^2
//   5) kurtosis > 3 → негауссово → несколько независимых алгоритмов
//   6) cipher_deep = (cipher_quick + kurtosis_normalized) / 2
//
// Финал: cipher_quick <= 0.5 → cipher_quick; иначе → cipher_deep; ICA fallback → cipher_quick
//
// Микро-уточнение #1: после robustNormalize() используем корреляционную матрицу

import type { DetectorInput, DetectorResult } from './types';
import { robustNormalize } from './cross-section-normalize';
import { clampScore, stalePenalty } from './guards';

const EPS = 1e-6;

// ─── Z-score normalization (legacy — используется внутри CIPHER для features) ──

function zScoreNormalize(values: number[]): number[] {
  const n = values.length;
  if (n < 2) return values.map(() => 0);

  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);

  if (std < EPS) return values.map(() => 0);
  return values.map(v => (v - mean) / std);
}

// ─── PCA (Power Iteration Method) ────────────────────────────────────────

interface PCAResult {
  components: number[][];     // principal components (eigenvectors)
  explainedVariance: number[]; // explained variance for each component
  dominanceRatio: number;      // first component's variance share
  projected: number[][];       // data projected onto components
  conditionNumber: number;     // condition number of covariance matrix
}

/**
 * PCA via power iteration + deflation
 * Returns top n_components
 */
function pca(data: number[][], nComponents: number = 3): PCAResult {
  const n = data.length;
  const m = data[0]?.length || 0;
  if (n < 3 || m < 1) {
    return {
      components: [],
      explainedVariance: [],
      dominanceRatio: 0,
      projected: [],
      conditionNumber: 1,
    };
  }

  const actualComponents = Math.min(nComponents, m, n);

  // v5.2: Compute CORRELATION matrix (not covariance) for PCA.
  // After robust scaling (IQR), covariance matrix has distorted
  // explained_variance_ratio_. Correlation matrix normalizes each variable
  // to unit variance, making PCA invariant to scale differences.
  // This is equivalent to PCA with whiten:true in scikit-learn.
  //
  // Correlation = standardized covariance: R[j][k] = cov[j][k] / (σ_j × σ_k)
  // For z-scored data, R ≈ cov. But after robust scaling, we need explicit
  // normalization.

  // First compute covariance
  const cov: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      for (let k = j; k < m; k++) {
        cov[j][k] += data[i][j] * data[i][k];
        if (j !== k) cov[k][j] = cov[j][k];
      }
    }
  }
  for (let j = 0; j < m; j++) {
    for (let k = 0; k < m; k++) {
      cov[j][k] /= n;
    }
  }

  // Convert covariance → correlation matrix
  // R[j][k] = cov[j][k] / sqrt(cov[j][j] × cov[k][k])
  const diagValues = cov.map((row, i) => row[i]).filter(v => v > EPS);
  const maxDiag = Math.max(...diagValues, EPS);
  const minDiag = Math.min(...diagValues, EPS);
  const conditionNumber = maxDiag / minDiag;

  const corr: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let j = 0; j < m; j++) {
    for (let k = 0; k < m; k++) {
      const sj = Math.sqrt(Math.max(cov[j][j], EPS));
      const sk = Math.sqrt(Math.max(cov[k][k], EPS));
      corr[j][k] = cov[j][k] / (sj * sk);
    }
  }
  // Ensure diagonal = 1 (numerical stability)
  for (let j = 0; j < m; j++) corr[j][j] = 1;

  // Power iteration for each component
  const components: number[][] = [];
  const eigenvalues: number[] = [];
  const maxIter = 200;

  // Work on a copy of CORRELATION matrix (not covariance!)
  // v5.2: PCA from correlation matrix — invariant to feature scale after robust scaling
  const covWork = corr.map(row => [...row]);

  for (let c = 0; c < actualComponents; c++) {
    // Random initial vector
    let v = Array.from({ length: m }, () => Math.random() - 0.5);
    const vNorm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    v = v.map(x => x / vNorm);

    let eigenvalue = 0;

    for (let iter = 0; iter < maxIter; iter++) {
      // v_new = cov * v
      const vNew = new Array(m).fill(0);
      for (let j = 0; j < m; j++) {
        for (let k = 0; k < m; k++) {
          vNew[j] += covWork[j][k] * v[k];
        }
      }

      // Eigenvalue = v^T * v_new
      eigenvalue = v.reduce((s, x, i) => s + x * vNew[i], 0);

      // Normalize
      const norm = Math.sqrt(vNew.reduce((s, x) => s + x * x, 0));
      if (norm < EPS) break;
      const vPrev = [...v];
      v = vNew.map(x => x / norm);

      // Check convergence
      const dot = Math.abs(v.reduce((s, x, i) => s + x * vPrev[i], 0));
      if (dot > 0.9999) break;
    }

    components.push(v);
    eigenvalues.push(Math.max(0, eigenvalue));

    // Deflate: cov = cov - eigenvalue * v * v^T
    for (let j = 0; j < m; j++) {
      for (let k = 0; k < m; k++) {
        covWork[j][k] -= eigenvalue * v[j] * v[k];
      }
    }
  }

  // Explained variance ratios
  const totalVariance = eigenvalues.reduce((s, v) => s + v, 0) || 1;
  const explainedVariance = eigenvalues.map(v => v / totalVariance);
  const dominanceRatio = explainedVariance[0] || 0;

  // Project data onto components
  const projected = data.map(row =>
    components.map(comp => comp.reduce((s, w, i) => s + w * (row[i] || 0), 0))
  );

  return {
    components,
    explainedVariance,
    dominanceRatio,
    projected,
    conditionNumber,
  };
}

// ─── ICA (FastICA approximation) ─────────────────────────────────────────

interface ICAResult {
  components: number[][];     // independent components
  converged: boolean;
  kurtosis: number;           // average kurtosis of components
}

/**
 * FastICA (simplified) — finds independent components via kurtosis maximization
 * Uses fixed-point iteration
 */
function fastICA(data: number[][], nComponents: number = 3, maxIter: number = 200): ICAResult {
  const n = data.length;
  const m = data[0]?.length || 0;
  if (n < 5 || m < 1) {
    return { components: [], converged: false, kurtosis: 0 };
  }

  const actualComponents = Math.min(nComponents, m);
  const components: number[][] = [];
  let converged = true;

  // Whiten data using PCA result (approximate)
  // Center data
  const means = Array.from({ length: m }, (_, j) =>
    data.reduce((s, row) => s + (row[j] || 0), 0) / n
  );
  const centered = data.map(row => row.map((v, j) => (v || 0) - means[j]));

  // For each component, use fixed-point ICA iteration
  for (let c = 0; c < actualComponents; c++) {
    // Random initial weight vector
    let w = Array.from({ length: m }, () => Math.random() - 0.5);
    const wNorm = Math.sqrt(w.reduce((s, x) => s + x * x, 0)) || 1;
    w = w.map(x => x / wNorm);

    let didConverge = false;

    for (let iter = 0; iter < maxIter; iter++) {
      // w_new = E{x * g(w^T * x)} - g'(w^T * x) * w
      // g(u) = tanh(u) (nonlinearity for super-Gaussian)
      // g'(u) = 1 - tanh(u)^2

      const wNew = new Array(m).fill(0);
      let gPrimeAvg = 0;

      for (let i = 0; i < n; i++) {
        const wTx = w.reduce((s, wj, j) => s + wj * centered[i][j], 0);
        const g = Math.tanh(wTx);
        const gPrime = 1 - g * g;

        for (let j = 0; j < m; j++) {
          wNew[j] += centered[i][j] * g;
        }
        gPrimeAvg += gPrime;
      }

      gPrimeAvg /= n;
      for (let j = 0; j < m; j++) {
        wNew[j] = wNew[j] / n - gPrimeAvg * w[j];
      }

      // Orthogonalize against previously found components
      for (let pc = 0; pc < components.length; pc++) {
        const dot = wNew.reduce((s, x, j) => s + x * components[pc][j], 0);
        for (let j = 0; j < m; j++) {
          wNew[j] -= dot * components[pc][j];
        }
      }

      // Normalize
      const norm = Math.sqrt(wNew.reduce((s, x) => s + x * x, 0));
      if (norm < EPS) {
        didConverge = false;
        break;
      }
      const wNewNorm = wNew.map(x => x / norm);

      // Check convergence
      const dot = Math.abs(wNewNorm.reduce((s, x, j) => s + x * w[j], 0));
      w = wNewNorm;

      if (dot > 0.999) {
        didConverge = true;
        break;
      }
    }

    if (!didConverge) converged = false;
    components.push(w);
  }

  // Compute kurtosis of IC projections
  // kurtosis = E[x^4] / E[x^2]^2 - 3 (excess kurtosis)
  // We use E[|x|^4] / E[|x|^2]^2 for robustness
  let totalKurtosis = 0;
  let validComponents = 0;

  for (const comp of components) {
    const projections = centered.map(row =>
      comp.reduce((s, w, j) => s + w * row[j], 0)
    );

    const e2 = projections.reduce((s, x) => s + x * x, 0) / n;
    const e4 = projections.reduce((s, x) => s + x * x * x * x, 0) / n;

    if (e2 > EPS) {
      const kurt = e4 / (e2 * e2);
      totalKurtosis += kurt;
      validComponents++;
    }
  }

  const kurtosis = validComponents > 0 ? totalKurtosis / validComponents : 0;

  return { components, converged, kurtosis };
}

// ─── Main Detector ────────────────────────────────────────────────────────

export function detectCipher(input: DetectorInput): DetectorResult {
  const { recentTrades, trades } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // v4.2: Gradual stale penalty instead of binary stale→0
  if (input.staleData) {
    const staleFactor = stalePenalty(input.staleMinutes);
    if (staleFactor <= 0) {
      return {
        detector: 'CIPHER',
        description: 'Шифр — неестественная периодичность (устаревшие данные)',
        score: 0, confidence: 0, signal: 'NEUTRAL',
        metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
      };
    }
    // If stale but not completely dead, proceed with computation but apply penalty later
  }

  // Need at least 20 trades for meaningful PCA/ICA
  const allTrades = trades.length >= 20 ? trades : recentTrades;
  if (allTrades.length < 20) {
    return {
      detector: 'CIPHER',
      description: 'Шифр — неестественная периодичность',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true },
    };
  }

  // ─── Prepare features ─────────────────────────────────────────────────
  // Window: last 100 trades
  const windowTrades = allTrades.slice(-100);
  const n = windowTrades.length;

  // Feature 1: trade volume
  const volumes = windowTrades.map(t => t.quantity);

  // Feature 2: trade size category (volume / avg_volume — relative size)
  const avgVol = volumes.reduce((s, v) => s + v, 0) / n;
  const relSizes = volumes.map(v => avgVol > EPS ? v / avgVol : 1);

  // Feature 3: intervals between trades (ms)
  const sortedByTime = [...windowTrades]
    .filter(t => t.timestamp && t.timestamp > 0)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const intervals: number[] = [];
  for (let i = 1; i < sortedByTime.length; i++) {
    const dt = (sortedByTime[i].timestamp || 0) - (sortedByTime[i - 1].timestamp || 0);
    if (dt > 0) intervals.push(dt);
  }

  if (intervals.length < 10) {
    return {
      detector: 'CIPHER',
      description: 'Шифр — неестественная периодичность',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientIntervals: true },
    };
  }

  // Build feature matrix: each row = [volume, relative_size, interval]
  // Align: use the interval AFTER each trade (except last)
  const featureRows: number[][] = [];
  for (let i = 0; i < n - 1; i++) {
    const trade = windowTrades[i];
    const nextTrade = windowTrades[i + 1];
    const interval = (nextTrade.timestamp || 0) - (trade.timestamp || 0);
    if (interval <= 0) continue;
    featureRows.push([
      trade.quantity,
      avgVol > EPS ? trade.quantity / avgVol : 0,
      interval,
    ]);
  }

  if (featureRows.length < 10) {
    return {
      detector: 'CIPHER',
      description: 'Шифр — неестественная периодичность',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true },
    };
  }

  // ─── Robust normalize each feature ───────────────────────────────────
  // v5.2: Используем robustNormalize (median/IQR) вместо zScoreNormalize (mean/std)
  // Robust scaling устойчив к выбросам → PCA на корреляционной матрице
  // даст корректный explained_variance_ratio_
  const nFeatures = 3;
  const normalizedFeatures: number[][] = [];

  // Extract columns
  const cols: number[][] = Array.from({ length: nFeatures }, (_, j) =>
    featureRows.map(row => row[j])
  );

  // v5.2: Robust normalize each column (median/IQR — outlier resistant)
  const zCols = cols.map(col => robustNormalize(col));

  // Reconstruct normalized matrix
  for (let i = 0; i < featureRows.length; i++) {
    normalizedFeatures.push(zCols.map(col => col[i]));
  }

  metadata.featureCount = nFeatures;
  metadata.sampleCount = normalizedFeatures.length;
  metadata.scalingMethod = 'robust_iqr'; // v5.2: robust scaling вместо z-score

  // ─── LEVEL 1: PCA quick screening ─────────────────────────────────────
  const pcaResult = pca(normalizedFeatures, 3);

  metadata.pcaDominance = Math.round(pcaResult.dominanceRatio * 1000) / 1000;
  metadata.pcaConditionNumber = Math.round(pcaResult.conditionNumber * 100) / 100;
  metadata.pcaExplainedVariance = JSON.stringify(pcaResult.explainedVariance
    .map(v => Math.round(v * 1000) / 1000));

  const cipherQuick = pcaResult.dominanceRatio;
  metadata.cipherQuick = Math.round(cipherQuick * 1000) / 1000;

  // Also compute CV of intervals (old metric — keep for reference)
  const meanInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  const stdInterval = Math.sqrt(
    intervals.reduce((s, v) => s + (v - meanInterval) ** 2, 0) / intervals.length
  );
  const cv = meanInterval > 0 ? stdInterval / meanInterval : 999;
  metadata.cv = Math.round(cv * 1000) / 1000;

  // Volume uniformity (old metric — keep for reference)
  const volFreq: Record<number, number> = {};
  for (const v of volumes) volFreq[v] = (volFreq[v] || 0) + 1;
  const maxVolFreq = Math.max(...Object.values(volFreq));
  const volumeUniformity = maxVolFreq / volumes.length;
  metadata.volumeUniformity = Math.round(volumeUniformity * 1000) / 1000;

  // ─── LEVEL 2: ICA deep analysis (only if cipher_quick > 0.5) ──────────
  let cipherScore = cipherQuick;

  if (cipherQuick > 0.5) {
    // Check condition number before ICA
    if (pcaResult.conditionNumber > 1000) {
      // Ill-conditioned matrix → skip ICA
      metadata.icaSkipped = true;
      metadata.icaSkipReason = 'high_condition_number';
      cipherScore = cipherQuick;
    } else {
      // Run ICA
      const icaResult = fastICA(normalizedFeatures, 3, 200);
      metadata.icaConverged = icaResult.converged;
      metadata.icaKurtosis = Math.round(icaResult.kurtosis * 100) / 100;

      if (!icaResult.converged || icaResult.kurtosis < EPS) {
        // ICA failed → fallback to cipher_quick
        metadata.icaFallback = true;
        cipherScore = cipherQuick;
      } else {
        // Kurtosis > 3 → non-Gaussian → multiple independent algorithms
        // Normalize kurtosis: kurt=3 → 0.5, kurt=6 → 1.0
        const kurtosisNorm = Math.min(1, Math.max(0, (icaResult.kurtosis - 1) / 5));
        metadata.kurtosisNormalized = Math.round(kurtosisNorm * 1000) / 1000;

        cipherScore = (cipherQuick + kurtosisNorm) / 2;
      }
    }
  }

  const score = Math.min(1, Math.max(0, cipherScore));

  // ─── Signal direction ──────────────────────────────────────────────────
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2) {
    const buyCount = windowTrades.filter(t => {
      const d = t.direction.toUpperCase();
      return d === 'B' || d === 'BUY';
    }).length;
    const sellCount = windowTrades.length - buyCount;
    signal = buyCount > sellCount * 1.5 ? 'BULLISH'
      : sellCount > buyCount * 1.5 ? 'BEARISH' : 'NEUTRAL';
  }

  // ─── Confidence ────────────────────────────────────────────────────────
  const confidence = score > 0.2
    ? Math.min(1, (cipherQuick > 0.5 ? 0.5 : 0.2) + (score - 0.2) * 0.5)
    : 0;

  // Apply stale penalty (v4.2: gradual instead of binary)
  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
  const finalScore = clampScore(score * staleFactor);
  const finalConfidence = clampScore(confidence * staleFactor);
  metadata.staleFactor = staleFactor;

  return {
    detector: 'CIPHER',
    description: 'Шифр — PCA/ICA анализ алгоритмических паттернов',
    score: finalScore,
    confidence: finalConfidence,
    signal,
    metadata,
  };
}
