// ─── ENTANGLE — Запутанность v4.2 ──────────────────────────────────────────
// Intra-ticker only: Granger causality между bid/ask volume flows.
//
// v4.2 Формула:
// 1) bid_flow = Δ(cumBidVolume), ask_flow = Δ(cumAskVolume) за интервалы
// 2) ADF-only stationarity (KPSS → П3)
// 3) Two Granger tests: bid→ask, ask→bid
// 4) Bonferroni: p_threshold = 0.05 / 2 = 0.025
// 5) Score:
//    both significant → strong cross-flow → score = min(p1,p2) / p_threshold
//    one significant  → weak → score = 0.5 × min(p1,p2) / p_threshold
//    neither          → no entanglement → score = 0

import type { DetectorInput, DetectorResult } from './types';
import { clampScore, stalePenalty } from './guards';

const EPS = 1e-6;
const MIN_OBSERVATIONS = 60;
const P_THRESHOLD = 0.025; // Bonferroni: 0.05 / 2

// ─── ADF Test (simplified) ────────────────────────────────────────────────

function adfTest(series: number[]): { pvalue: number; isStationary: boolean } {
  const n = series.length;
  if (n < 15) return { pvalue: 1, isStationary: false };

  const dy: number[] = [];
  for (let i = 1; i < n; i++) dy.push(series[i] - series[i - 1]);

  const lags = Math.min(3, Math.floor(n / 4));
  const m = dy.length;
  const y: number[] = [];
  const xRows: number[][] = [];

  for (let t = lags; t < m; t++) {
    y.push(dy[t]);
    const row = [1, series[t]];
    for (let l = 1; l <= lags; l++) row.push(dy[t - l]);
    xRows.push(row);
  }

  const nObs = y.length;
  if (nObs < 5) return { pvalue: 1, isStationary: false };

  const k = xRows[0].length;
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

  const residuals: number[] = [];
  for (let i = 0; i < nObs; i++) {
    let pred = 0;
    for (let j = 0; j < k; j++) pred += beta[j] * xRows[i][j];
    residuals.push(y[i] - pred);
  }

  const rss = residuals.reduce((s, r) => s + r * r, 0);
  const sigma2 = nObs > k ? rss / (nObs - k) : rss;
  const seGamma = Math.abs(xtX[1][1]) > EPS ? Math.sqrt(sigma2 / xtX[1][1]) : 999;
  const adfStat = seGamma > EPS ? beta[1] / seGamma : 0;

  let pvalue: number;
  if (adfStat < -3.43) pvalue = 0.01;
  else if (adfStat < -2.86) pvalue = 0.05;
  else if (adfStat < -2.57) pvalue = 0.10;
  else pvalue = 0.15 + Math.min(0.85, Math.max(0, (adfStat + 2.57) / 5));

  return { pvalue, isStationary: pvalue < 0.05 };
}

function ensureStationarity(series: number[]): number[] {
  const adf = adfTest(series);
  if (adf.isStationary) return series;
  const diffed = series.slice(1).map((v, i) => v - series[i]);
  const adfDiff = adfTest(diffed);
  if (adfDiff.isStationary) return diffed;
  return []; // failed
}

// ─── Granger Causality ────────────────────────────────────────────────────

function grangerTest(cause: number[], effect: number[], lag: number): { F: number; pValue: number } {
  const n = Math.min(cause.length, effect.length);
  if (n < lag + 5) return { F: 0, pValue: 1 };

  const yDep: number[] = [];
  const xRest: number[][] = [];
  const xUnrest: number[][] = [];

  for (let t = lag; t < n; t++) {
    yDep.push(effect[t]);
    const restRow = [1];
    const unrestRow = [1];
    for (let k = 1; k <= lag; k++) {
      restRow.push(effect[t - k]);
      unrestRow.push(effect[t - k]);
    }
    for (let k = 1; k <= lag; k++) unrestRow.push(cause[t - k]);
    xRest.push(restRow);
    xUnrest.push(unrestRow);
  }

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
  const q = xUnrest[0].length - xRest[0].length;
  const nObs = yDep.length;
  const df2 = nObs - xUnrest[0].length;
  const F = q > 0 && rssUnrest > EPS ? ((rssRest - rssUnrest) / q) / (rssUnrest / df2) : 0;
  const pValue = F > 5 ? 0.01 : F > 3 ? 0.05 : F > 2 ? 0.15 : 0.5;
  return { F, pValue };
}

// ─── Главный детектор ─────────────────────────────────────────────────────

export function detectEntangle(input: DetectorInput): DetectorResult {
  const { trades, orderbook } = input;
  const metadata: Record<string, number | string | boolean> = {};

  if (input.staleData) {
    const staleFactor = stalePenalty(input.staleMinutes);
    if (staleFactor <= 0) {
      return {
        detector: 'ENTANGLE',
        description: 'Запутанность — кросс-потоковая связь (устаревшие данные)',
        score: 0, confidence: 0, signal: 'NEUTRAL',
        metadata: { insufficientData: true, staleData: true },
      };
    }
  }

  if (trades.length < MIN_OBSERVATIONS) {
    return {
      detector: 'ENTANGLE',
      description: 'Запутанность — недостаточно наблюдений',
      score: 0, confidence: 0, signal: 'NEUTRAL',
      metadata: { insufficientData: true },
    };
  }

  // Build bid/ask flow series from trades (1-second intervals)
  const intervalMs = 1000;
  const timestamps = trades.map(t => t.timestamp || 0).filter(ts => ts > 0);
  if (timestamps.length < MIN_OBSERVATIONS) {
    return {
      detector: 'ENTANGLE',
      description: 'Запутанность — недостаточно таймстемпов',
      score: 0, confidence: 0, signal: 'NEUTRAL',
      metadata: { insufficientData: true },
    };
  }

  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const nBins = Math.floor((maxTs - minTs) / intervalMs) + 1;

  const bidFlow: number[] = new Array(nBins).fill(0);
  const askFlow: number[] = new Array(nBins).fill(0);

  for (const t of trades) {
    const ts = t.timestamp || 0;
    if (ts > 0) {
      const idx = Math.floor((ts - minTs) / intervalMs);
      if (idx >= 0 && idx < nBins) {
        const side = t.direction.toUpperCase().trim();
        if (side === 'B' || side === 'BUY') bidFlow[idx] += t.quantity;
        else if (side === 'S' || side === 'SELL') askFlow[idx] += t.quantity;
      }
    }
  }

  // First differences (flows)
  const bidFlows = bidFlow.slice(1).map((v, i) => v - bidFlow[i]);
  const askFlows = askFlow.slice(1).map((v, i) => v - askFlow[i]);

  metadata.nObservations = bidFlows.length;

  // Stationarity
  const statBid = ensureStationarity(bidFlows);
  const statAsk = ensureStationarity(askFlows);

  if (statBid.length === 0 || statAsk.length === 0) {
    return {
      detector: 'ENTANGLE',
      description: 'Запутанность — ряды нестационарны',
      score: 0, confidence: 0, signal: 'NEUTRAL',
      metadata: { ...metadata, nonStationary: true },
    };
  }

  metadata.stationarityBid = statBid.length < bidFlows.length ? 'diff' : 'level';
  metadata.stationarityAsk = statAsk.length < askFlows.length ? 'diff' : 'level';

  // Lag order: Schwert criterion with cap=10
  const lagOrder = Math.min(Math.floor(12 * Math.pow(statBid.length / 100, 1 / 4)), 10);
  const minLag = Math.max(lagOrder, 2);
  metadata.lagOrder = minLag;

  // Two Granger tests
  const test1 = grangerTest(statBid, statAsk, minLag); // bid → ask
  const test2 = grangerTest(statAsk, statBid, minLag); // ask → bid

  metadata.bidToAskF = Math.round(test1.F * 100) / 100;
  metadata.bidToAskP = Math.round(test1.pValue * 1000) / 1000;
  metadata.askToBidF = Math.round(test2.F * 100) / 100;
  metadata.askToBidP = Math.round(test2.pValue * 1000) / 1000;

  const sig1 = test1.pValue < P_THRESHOLD;
  const sig2 = test2.pValue < P_THRESHOLD;

  metadata.sigBidToAsk = sig1;
  metadata.sigAskToBid = sig2;

  // Score
  let entangleScore = 0;
  let reason = 'no_entanglement';

  if (sig1 && sig2) {
    const minP = Math.min(test1.pValue, test2.pValue);
    // Меньший p-value = сильнее evidence → БОЛЬШИЙ score
    entangleScore = 1 - minP / P_THRESHOLD;
    reason = 'strong_cross_flow';
  } else if (sig1 || sig2) {
    const sigP = sig1 ? test1.pValue : test2.pValue;
    entangleScore = 0.5 * (1 - sigP / P_THRESHOLD);
    reason = 'weak_cross_flow';
  }

  const score = clampScore(entangleScore);

  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2) {
    // Direction from net flow imbalance
    const netBid = bidFlows.reduce((s, v) => s + v, 0);
    const netAsk = askFlows.reduce((s, v) => s + v, 0);
    signal = netBid > netAsk ? 'BULLISH' : netAsk > netBid ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.2 ? Math.min(1, score * 1.2) : 0;
  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;

  return {
    detector: 'ENTANGLE',
    description: 'Запутанность — Granger causality bid/ask flows (v4.2)',
    score: clampScore(score * staleFactor),
    confidence: clampScore(confidence * staleFactor),
    signal,
    metadata: { ...metadata, staleFactor, reason },
  };
}
