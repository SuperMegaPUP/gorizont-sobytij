// ─── ENTANGLE — Запутанность v5.1 (П2 — ADF-тест стационарности) ──────────
// Два актива движутся синхронно — как запутанные квантовые частицы.
// Это признак макро-события или координированного действия.
//
// v5.1 П2 Правка (согласно спецификации v4):
// 1) Перед расчётом ANY correlation/causality — проверить стационарность:
//    - augmentedDickeyFullerTest(series)
//    - pvalue < 0.05 → стационарно → используем series
//    - иначе → первые разности → повторный ADF
//    - даже разности нестационарны → entangle_score = 0, skip
//
// 2) Granger causality с лагом = 3 (фиксированный для v1)

import type { DetectorInput, DetectorResult } from './types';

const EPS = 1e-6;

// ─── Augmented Dickey-Fuller Test ─────────────────────────────────────────

/**
 * Augmented Dickey-Fuller test for stationarity
 *
 * H0: series has unit root (non-stationary)
 * H1: series is stationary
 *
 * Returns: { statistic, pvalueApprox }
 * statistic < critical value → reject H0 → stationary
 *
 * Critical values (approximation for n > 25):
 *   1%: -3.43, 5%: -2.86, 10%: -2.57
 *
 * We use a simplified ADF with lag order = 3 (fixed for v1)
 */
function augmentedDickeyFuller(
  series: number[],
  maxLags: number = 3,
): { statistic: number; pvalueApprox: number; isStationary: boolean } {
  const n = series.length;
  if (n < 15) {
    // Too few data points → assume non-stationary (conservative)
    return { statistic: 0, pvalueApprox: 1, isStationary: false };
  }

  // Δy_t = α + βt + γy_{t-1} + Σ(δ_i × Δy_{t-i}) + ε
  // We test H0: γ = 0 (non-stationary)

  // First differences
  const dy: number[] = [];
  for (let i = 1; i < n; i++) {
    dy.push(series[i] - series[i - 1]);
  }

  const lags = Math.min(maxLags, Math.floor(n / 4));
  const m = dy.length; // n-1

  // Build regression: dy[t] = γ × y[t-1] + Σ(δ_i × dy[t-i]) + const + ε
  // t runs from lags to m-1

  const y: number[] = []; // dependent variable: dy[t]
  const xRows: number[][] = []; // independent: [1, y[t-1], dy[t-1], dy[t-2], ...]

  for (let t = lags; t < m; t++) {
    y.push(dy[t]);
    const row = [1]; // constant
    row.push(series[t]); // y_{t-1} (level)
    for (let l = 1; l <= lags; l++) {
      row.push(dy[t - l]); // lagged differences
    }
    xRows.push(row);
  }

  const nObs = y.length;
  if (nObs < 5) {
    return { statistic: 0, pvalueApprox: 1, isStationary: false };
  }

  const k = xRows[0].length; // number of regressors

  // OLS: β = (X'X)^(-1) × X'y
  // We only need the coefficient on y[t-1] (index 1) and its SE

  // X'X
  const xtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const xty: number[] = new Array(k).fill(0);

  for (let i = 0; i < nObs; i++) {
    for (let j = 0; j < k; j++) {
      xty[j] += xRows[i][j] * y[i];
      for (let l = j; l < k; l++) {
        xtX[j][l] += xRows[i][j] * xRows[i][l];
        if (j !== l) xtX[l][j] = xtX[j][l];
      }
    }
  }

  // Solve using Gaussian elimination (small matrix)
  // Augment xtX with xty
  const aug: number[][] = xtX.map((row, i) => [...row, xty[i]]);

  for (let col = 0; col < k; col++) {
    // Pivot
    let maxVal = Math.abs(aug[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < k; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    if (Math.abs(aug[col][col]) < EPS) continue;

    // Eliminate below
    for (let row = col + 1; row < k; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= k; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const beta: number[] = new Array(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    beta[i] = aug[i][k];
    for (let j = i + 1; j < k; j++) {
      beta[i] -= aug[i][j] * beta[j];
    }
    if (Math.abs(aug[i][i]) > EPS) beta[i] /= aug[i][i];
  }

  // Residuals
  const residuals: number[] = [];
  for (let i = 0; i < nObs; i++) {
    let pred = 0;
    for (let j = 0; j < k; j++) {
      pred += beta[j] * xRows[i][j];
    }
    residuals.push(y[i] - pred);
  }

  // Residual sum of squares
  const rss = residuals.reduce((s, r) => s + r * r, 0);

  // Standard error of gamma (coefficient on y[t-1], index 1)
  // Need (X'X)^{-1}[1][1] × sigma^2
  // Simplified: use diagonal of (X'X)^{-1}
  // For small matrices, compute inverse directly

  // Variance of residuals
  const sigma2 = nObs > k ? rss / (nObs - k) : rss;

  // Approximate SE of gamma using (X'X)[1][1] as proxy
  // SE(gamma) ≈ sqrt(sigma2 / (X'X)[1][1])
  // This is a simplification — proper approach needs full inverse
  const seGamma = Math.abs(xtX[1][1]) > EPS
    ? Math.sqrt(sigma2 / xtX[1][1])
    : 999;

  // ADF statistic = gamma / SE(gamma)
  const adfStat = seGamma > EPS ? beta[1] / seGamma : 0;

  // Approximate p-value using Dickey-Fuller distribution
  // Critical values at 5% ≈ -2.86
  // We approximate: p < 0.05 when stat < -2.86
  // Linear interpolation approximation:
  let pvalueApprox: number;
  if (adfStat < -3.43) pvalueApprox = 0.01;
  else if (adfStat < -2.86) pvalueApprox = 0.05;
  else if (adfStat < -2.57) pvalueApprox = 0.10;
  else pvalueApprox = 0.15 + Math.min(0.85, Math.max(0, (adfStat + 2.57) / 5));

  const isStationary = pvalueApprox < 0.05;

  return { statistic: adfStat, pvalueApprox, isStationary };
}

/**
 * Ensure stationarity: apply ADF test, take first differences if needed.
 * Returns { series, isStationary, differenced }
 */
function ensureStationarity(series: number[]): {
  series: number[];
  isStationary: boolean;
  differenced: boolean;
} {
  if (series.length < 15) {
    return { series, isStationary: false, differenced: false };
  }

  // Test original series
  const adf1 = augmentedDickeyFuller(series);
  if (adf1.isStationary) {
    return { series, isStationary: true, differenced: false };
  }

  // Take first differences and re-test
  const diff: number[] = [];
  for (let i = 1; i < series.length; i++) {
    diff.push(series[i] - series[i - 1]);
  }

  const adf2 = augmentedDickeyFuller(diff);
  if (adf2.isStationary) {
    return { series: diff, isStationary: true, differenced: true };
  }

  // Even differences not stationary → skip
  return { series: diff, isStationary: false, differenced: true };
}

// ─── Granger Causality (simplified) ──────────────────────────────────────

/**
 * Granger causality test: does X Granger-cause Y?
 * Uses lag = 3 (fixed for v1)
 *
 * F-test comparing restricted model (Y_t = α + Σ(Y_{t-k})) vs
 * unrestricted model (Y_t = α + Σ(Y_{t-k}) + Σ(X_{t-k}))
 *
 * Returns F-statistic and significance
 */
function grangerCausality(
  x: number[], // potential cause
  y: number[], // effect
  lag: number = 3,
): { fStat: number; pValue: number; isSignificant: boolean } {
  const n = Math.min(x.length, y.length);
  if (n < lag + 5) return { fStat: 0, pValue: 1, isSignificant: false };

  // Restricted model: Y_t = α + Σ(β_k × Y_{t-k})
  // Unrestricted model: Y_t = α + Σ(β_k × Y_{t-k}) + Σ(γ_k × X_{t-k})

  // Build data arrays
  const yDep: number[] = [];
  const xRest: number[][] = []; // restricted regressors
  const xUnrest: number[][] = []; // unrestricted regressors

  for (let t = lag; t < n; t++) {
    yDep.push(y[t]);
    const restRow = [1]; // constant
    const unrestRow = [1];

    for (let k = 1; k <= lag; k++) {
      restRow.push(y[t - k]);
      unrestRow.push(y[t - k]);
    }
    for (let k = 1; k <= lag; k++) {
      unrestRow.push(x[t - k]);
    }

    xRest.push(restRow);
    xUnrest.push(unrestRow);
  }

  const nObs = yDep.length;
  if (nObs < 5) return { fStat: 0, pValue: 1, isSignificant: false };

  // OLS helper function
  function olsRss(dep: number[], indep: number[][]): number {
    const k = indep[0].length;
    const xtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
    const xty: number[] = new Array(k).fill(0);

    for (let i = 0; i < dep.length; i++) {
      for (let j = 0; j < k; j++) {
        xty[j] += indep[i][j] * dep[i];
        for (let l = j; l < k; l++) {
          xtX[j][l] += indep[i][j] * indep[i][l];
          if (j !== l) xtX[l][j] = xtX[j][l];
        }
      }
    }

    // Solve via Gaussian elimination
    const aug: number[][] = xtX.map((row, i) => [...row, xty[i]]);
    for (let col = 0; col < k; col++) {
      let maxRow = col;
      for (let row = col + 1; row < k; row++) {
        if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
      }
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
      if (Math.abs(aug[col][col]) < EPS) continue;
      for (let row = col + 1; row < k; row++) {
        const f = aug[row][col] / aug[col][col];
        for (let j = col; j <= k; j++) aug[row][j] -= f * aug[col][j];
      }
    }
    const beta: number[] = new Array(k).fill(0);
    for (let i = k - 1; i >= 0; i--) {
      beta[i] = aug[i][k];
      for (let j = i + 1; j < k; j++) beta[i] -= aug[i][j] * beta[j];
      if (Math.abs(aug[i][i]) > EPS) beta[i] /= aug[i][i];
    }

    let rss = 0;
    for (let i = 0; i < dep.length; i++) {
      let pred = 0;
      for (let j = 0; j < k; j++) pred += beta[j] * indep[i][j];
      rss += (dep[i] - pred) ** 2;
    }
    return rss;
  }

  const rssRest = olsRss(yDep, xRest);
  const rssUnrest = olsRss(yDep, xUnrest);

  const kRest = xRest[0].length;
  const kUnrest = xUnrest[0].length;
  const q = kUnrest - kRest; // number of restrictions (should = lag)

  // F-statistic
  const fStat = q > 0 && rssUnrest > EPS
    ? ((rssRest - rssUnrest) / q) / (rssUnrest / (nObs - kUnrest))
    : 0;

  // Approximate p-value using F-distribution
  // For F(q, n-k) with q=3: critical values at 5% ≈ 2.6-3.0
  const df1 = q;
  const df2 = nObs - kUnrest;
  const isSignificant = fStat > 3.0 && df2 > 0;

  // Simplified p-value approximation
  const pValue = fStat > 5 ? 0.01 : fStat > 3 ? 0.05 : fStat > 2 ? 0.15 : 0.5;

  return { fStat, pValue, isSignificant };
}

// ─── Main Detector ────────────────────────────────────────────────────────

export function detectEntangle(input: DetectorInput): DetectorResult {
  const { ticker, ofi, prices, crossTickers } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // v4.1.2: Stale data → нет аномалии
  if (input.staleData) {
    return {
      detector: 'ENTANGLE',
      description: 'Запутанность — кросс-тикерная корреляция (устаревшие данные)',
      score: 0, confidence: 0, signal: 'NEUTRAL',
      metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
    };
  }

  // Без кросс-тикерных данных — детектор не работает
  if (!crossTickers || Object.keys(crossTickers).length === 0) {
    return {
      detector: 'ENTANGLE',
      description: 'Запутанность — кросс-тикерная корреляция',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { noCrossData: true },
    };
  }

  // If all cross-tickers have zero data → skip
  const allZeroChanges = Object.values(crossTickers).every(
    d => Math.abs(d.priceChange) < 0.01 && Math.abs(d.ofi) < 0.01
  );
  const currentPriceChange = prices.length >= 2
    ? (prices[prices.length - 1] - prices[0]) / (prices[0] || 1) * 100 : 0;

  if (allZeroChanges && Math.abs(currentPriceChange) < 0.01) {
    return {
      detector: 'ENTANGLE',
      description: 'Запутанность — нет рыночных данных',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true, allZeroChanges: true },
    };
  }

  // ─── ADF stationarity check on own prices ─────────────────────────────
  const stationarity = ensureStationarity(prices);
  metadata.isStationary = stationarity.isStationary;
  metadata.wasDifferenced = stationarity.differenced;

  if (!stationarity.isStationary) {
    // Even after differencing, not stationary → can't compute meaningful correlations
    return {
      detector: 'ENTANGLE',
      description: 'Запутанность — ценовой ряд нестационарен (ADF не пройден)',
      score: 0, confidence: 0, signal: 'NEUTRAL',
      metadata: { ...metadata, adfFailed: true },
    };
  }

  // Use stationary version of prices for correlation
  const statPrices = stationarity.series;

  // ─── Correlation analysis ─────────────────────────────────────────────
  let maxCorrelation = 0;
  let correlatedTicker = '';
  let sameDirectionCount = 0;
  let totalCrossTickers = 0;
  let grangerSignificant = 0;

  for (const [crossTicker, data] of Object.entries(crossTickers)) {
    totalCrossTickers++;

    // Simple correlation based on price change direction
    const priceDiff = Math.abs(currentPriceChange - data.priceChange);
    const maxChange = Math.max(Math.abs(currentPriceChange), Math.abs(data.priceChange), 0.01);
    const correlation = maxChange > 0 ? 1 - priceDiff / (maxChange * 2) : 0;

    if (correlation > maxCorrelation) {
      maxCorrelation = correlation;
      correlatedTicker = crossTicker;
    }

    // Same direction check
    const sameDir = Math.sign(currentPriceChange) === Math.sign(data.priceChange) &&
      Math.abs(currentPriceChange) > 0.05;
    if (sameDir) sameDirectionCount++;
  }

  // ─── Granger causality (simplified — using price changes as proxy) ────
  // For v1: we check if the direction of cross-ticker price changes
  // "Granger-causes" our ticker's price changes
  // Since we don't have historical cross-ticker prices in DetectorInput,
  // we use the available crossTicker data + price change ratios
  // as a proxy for causality.

  // Build proxy cross-ticker series from available data
  if (prices.length >= 15 && totalCrossTickers > 0) {
    // Use price series for Granger test
    // Create synthetic cross-series from priceChange ratio
    const crossPriceChange = Object.values(crossTickers).reduce(
      (s, d) => s + d.priceChange, 0
    ) / totalCrossTickers;

    // Synthesize a cross-ticker price series based on average change
    const crossSeries = prices.map((p, i) => {
      const ratio = 1 + (crossPriceChange / 100) * (i / prices.length);
      return p * ratio;
    });

    // Granger test: does cross-series predict our series?
    const gc = grangerCausality(crossSeries, statPrices, 3);
    metadata.grangerFStat = Math.round(gc.fStat * 100) / 100;
    metadata.grangerPValue = gc.pValue;

    if (gc.isSignificant) {
      grangerSignificant++;
      metadata.grangerSignificant = true;
      metadata.grangerTicker = correlatedTicker;
    }
  }

  metadata.maxCorrelation = Math.round(maxCorrelation * 1000) / 1000;
  metadata.correlatedTicker = correlatedTicker;
  metadata.sameDirectionCount = sameDirectionCount;
  metadata.totalCrossTickers = totalCrossTickers;
  metadata.currentPriceChange = Math.round(currentPriceChange * 100) / 100;

  // ─── OFI correlation ──────────────────────────────────────────────────
  const ofiCorrelated = Object.values(crossTickers).filter(d =>
    Math.sign(d.ofi) === Math.sign(ofi) && Math.abs(ofi) > 0.1 && Math.abs(d.ofi) > 0.1
  ).length;
  const ofiCorrelationRatio = totalCrossTickers > 0 ? ofiCorrelated / totalCrossTickers : 0;
  metadata.ofiCorrelationRatio = Math.round(ofiCorrelationRatio * 1000) / 1000;

  // ─── Synchronicity ────────────────────────────────────────────────────
  const synchronicity = totalCrossTickers > 0 ? sameDirectionCount / totalCrossTickers : 0;
  metadata.synchronicity = Math.round(synchronicity * 1000) / 1000;

  // ─── Score ────────────────────────────────────────────────────────────
  const correlationScore = Math.min(1, Math.max(0, (maxCorrelation - 0.5) / 0.4));
  const ofiScore = Math.min(1, ofiCorrelationRatio * 2);
  const syncScore = synchronicity > 0.7 ? 1
    : synchronicity > 0.5 ? 0.6
    : synchronicity > 0.3 ? 0.3 : 0;
  const grangerScore = grangerSignificant > 0 ? 0.5 : 0;

  // ADF-passed bonus: correlations are more reliable
  const adfBonus = stationarity.isStationary ? 1.0 : 0.5;

  const rawScore = (correlationScore * 0.3 + ofiScore * 0.2 + syncScore * 0.25 + grangerScore * 0.25) * adfBonus;
  const score = Math.min(1, Math.max(0, rawScore));

  // ─── Signal direction ─────────────────────────────────────────────────
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2) {
    signal = currentPriceChange > 0.1 ? 'BULLISH'
      : currentPriceChange < -0.1 ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.2
    ? Math.min(1, (correlationScore + syncScore + grangerScore) / 2)
    : 0;

  return {
    detector: 'ENTANGLE',
    description: 'Запутанность — ADF + Granger + синхронность',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
