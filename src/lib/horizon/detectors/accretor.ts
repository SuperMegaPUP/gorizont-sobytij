// ─── ACCRETOR — Аккреция v4.2 ──────────────────────────────────────────────
// Обнаружение кластерного накопления через DBSCAN на нормированных признаках.
//
// v4.2 Формула:
// 1) Guard: n_trades < 30 → score = 0
// 2) Feature normalization (КРИТИЧЕСКИ — С8):
//    scaled = [(time-t0)/60000, (price-p0)/tickSize]
//    eps=1.0 — безразмерный! (1 минута × 1 тик)
// 3) DBSCAN: eps=1.0, minSamples=5
// 4) Trade value filter: trade_value = volume × price
//    small = trade_value < 0.3 × median_trade_value
// 5) Cluster concentration = totalVolume / area
//    area = max(priceRange/ATR, 0.001) × max(timeRangeSec/60, 0.1)
// 6) Score: sigmoid centered on best cluster concentration

import type { DetectorInput, DetectorResult } from './types';
import { safeDivide, clampScore, stalePenalty } from './guards';

const EPS = 1e-6;
const MIN_CLUSTER_SIZE = 8;
const MIN_CLUSTER_VOLUME_PCT = 0.05;

// ─── DBSCAN на нормированных 2D точках ──────────────────────────────────────

interface DBSCANPoint {
  x: number;  // нормированное время (мин)
  y: number;  // нормированная цена (тики)
  volume: number;
  price: number;
  time: number;
}

interface DBSCANCluster {
  points: DBSCANPoint[];
  totalVolume: number;
  timeRangeSec: number;
  priceRange: number;
  nTrades: number;
}

function dbscan(points: DBSCANPoint[], eps: number, minSamples: number): DBSCANCluster[] {
  const n = points.length;
  if (n < minSamples) return [];

  // Pre-compute neighbors (Euclidean distance)
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= eps) {
        neighbors[i].push(j);
        neighbors[j].push(i);
      }
    }
  }

  const labels: number[] = new Array(n).fill(-1);
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) continue;
    if (neighbors[i].length < minSamples - 1) {
      labels[i] = -2;
      continue;
    }
    labels[i] = clusterId;
    const queue = [...neighbors[i]];
    let qi = 0;
    while (qi < queue.length) {
      const j = queue[qi++];
      if (labels[j] === -2) labels[j] = clusterId;
      if (labels[j] !== -1) continue;
      labels[j] = clusterId;
      if (neighbors[j].length >= minSamples - 1) {
        for (const k of neighbors[j]) {
          if (labels[k] === -1 || labels[k] === -2) queue.push(k);
        }
      }
    }
    clusterId++;
  }

  const groups = new Map<number, DBSCANPoint[]>();
  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) {
      if (!groups.has(labels[i])) groups.set(labels[i], []);
      groups.get(labels[i])!.push(points[i]);
    }
  }

  return Array.from(groups.values()).map(pts => {
    const times = pts.map(p => p.time);
    const prices = pts.map(p => p.price);
    return {
      points: pts,
      totalVolume: pts.reduce((s, p) => s + p.volume, 0),
      timeRangeSec: (Math.max(...times) - Math.min(...times)) / 1000,
      priceRange: Math.max(...prices) - Math.min(...prices),
      nTrades: pts.length,
    };
  });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function iqr(values: number[]): number {
  if (values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  return q3 - q1;
}

function robustNormalize(value: number, med: number, iqrVal: number): number {
  return (value - med) / Math.max(iqrVal, 1e-8);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function getTickSize(price: number): number {
  if (price > 1000) return 0.1;
  if (price > 100) return 0.05;
  return 0.01;
}

// ─── Главный детектор ───────────────────────────────────────────────────────

export function detectAccretor(input: DetectorInput): DetectorResult {
  const { trades, candles, prices } = input;
  const metadata: Record<string, number | string | boolean> = {};

  const allTrades = trades && trades.length > 0 ? trades : [];

  // Stale guard
  if (input.staleData) {
    const staleFactor = stalePenalty(input.staleMinutes);
    if (staleFactor <= 0) {
      return {
        detector: 'ACCRETOR',
        description: 'Аккреция — постепенное накопление (устаревшие данные)',
        score: 0, confidence: 0, signal: 'NEUTRAL',
        metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
      };
    }
  }

  // Guard: min 30 trades
  if (allTrades.length < 30) {
    metadata.insufficientData = true;
    return {
      detector: 'ACCRETOR',
      description: 'Аккреция — недостаточно сделок (<30)',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata,
    };
  }

  // ─── 1. Trade value filter ──────────────────────────────────────────────
  const tradeValues = allTrades.map(t => t.price * t.quantity);
  const medianTradeValue = median(tradeValues);
  const smallThreshold = 0.3 * medianTradeValue;
  const nSmallTrades = tradeValues.filter(v => v < smallThreshold).length;
  const nTotalTrades = allTrades.length;

  metadata.medianTradeValue = Math.round(medianTradeValue * 100) / 100;
  metadata.smallThreshold = Math.round(smallThreshold * 100) / 100;
  metadata.nSmallTrades = nSmallTrades;
  metadata.smallRatio = Math.round((nSmallTrades / nTotalTrades) * 1000) / 1000;

  // ─── 2. Feature normalization (КРИТИЧЕСКИ — С8) ─────────────────────────
  const windowTrades = allTrades.slice(-200);
  if (windowTrades.length === 0) {
    metadata.insufficientData = true;
    return { detector: 'ACCRETOR', description: 'Аккреция — пустое окно', score: 0, confidence: 0, signal: 'NEUTRAL', metadata };
  }

  const t0 = windowTrades[0].timestamp || 0;
  const p0 = windowTrades[0].price;
  const tickSize = getTickSize(p0);

  const scaled: DBSCANPoint[] = windowTrades
    .filter(t => t.timestamp && t.timestamp > 0 && t.price > 0)
    .map(t => ({
      x: ((t.timestamp || 0) - t0) / 60000,   // минуты
      y: (t.price - p0) / tickSize,             // тики
      volume: t.quantity,
      price: t.price,
      time: t.timestamp || 0,
    }));

  metadata.tickSize = tickSize;
  metadata.nScaledPoints = scaled.length;

  // ─── 3. DBSCAN ──────────────────────────────────────────────────────────
  const clusters = dbscan(scaled, 1.0, 5);
  metadata.nClusters = clusters.length;

  if (clusters.length === 0) {
    return {
      detector: 'ACCRETOR',
      description: 'Аккреция — кластеры не найдены',
      score: 0, confidence: 0, signal: 'NEUTRAL',
      metadata: { ...metadata, reason: 'no_clusters' },
    };
  }

  // ─── 4. ATR ─────────────────────────────────────────────────────────────
  let atr = 0.01 * p0;
  if (candles && candles.length >= 14) {
    const ranges = candles.slice(-14).map(c => c.high - c.low);
    atr = ranges.reduce((s, r) => s + r, 0) / 14;
  } else if (prices.length >= 5) {
    const diffs: number[] = [];
    for (let i = 1; i < prices.length; i++) diffs.push(Math.abs(prices[i] - prices[i - 1]));
    atr = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  }
  metadata.atr = Math.round(atr * 10000) / 10000;

  // ─── 5. Cluster analysis — concentration ────────────────────────────────
  const totalVolume = clusters.reduce((s, c) => s + c.totalVolume, 0);
  const validClusters = clusters.filter(cluster => {
    if (cluster.nTrades < MIN_CLUSTER_SIZE) return false;
    const volumePct = totalVolume > 0 ? cluster.totalVolume / totalVolume : 0;
    return volumePct >= MIN_CLUSTER_VOLUME_PCT;
  });

  if (validClusters.length === 0) {
    return {
      detector: 'ACCRETOR',
      description: 'Аккреция — кластеры слишком малы',
      score: 0, confidence: 0, signal: 'NEUTRAL',
      metadata: { ...metadata, reason: 'clusters_too_small', nClusters: clusters.length },
    };
  }

  for (const cluster of validClusters) {
    const area = Math.max(cluster.priceRange / atr, 0.001) * Math.max(cluster.timeRangeSec / 60, 0.1);
    (cluster as any).concentration = cluster.totalVolume / area;
    (cluster as any).avgTradeValue = cluster.totalVolume * cluster.priceRange / cluster.nTrades;
  }

  const concentrations = validClusters.map(c => (c as any).concentration as number);
  const bestCluster = validClusters.reduce((a, b) =>
    ((a as any).concentration > (b as any).concentration ? a : b)
  );

  const medConc = median(concentrations);
  const iqrConc = iqr(concentrations);
  const concNorm = robustNormalize((bestCluster as any).concentration, medConc, iqrConc);

  metadata.bestConcentration = Math.round((bestCluster as any).concentration * 100) / 100;
  metadata.medConcentration = Math.round(medConc * 100) / 100;
  metadata.iqrConcentration = Math.round(iqrConc * 100) / 100;

  // ─── 6. Score ───────────────────────────────────────────────────────────
  const rawSigmoid = sigmoid(concNorm);
  const score = clampScore(Math.max(0, 2 * rawSigmoid - 1));

  metadata.concNorm = Math.round(concNorm * 1000) / 1000;

  // ─── 7. Signal direction ────────────────────────────────────────────────
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.15) {
    const buyVol = bestCluster.points.filter(p => p.price >= p0).reduce((s, p) => s + p.volume, 0);
    const sellVol = bestCluster.points.filter(p => p.price < p0).reduce((s, p) => s + p.volume, 0);
    signal = buyVol > sellVol * 1.2 ? 'BULLISH' : sellVol > buyVol * 1.2 ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.15 ? Math.min(1, score * 1.2) : 0;
  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;

  return {
    detector: 'ACCRETOR',
    description: 'Аккреция — кластерное накопление (DBSCAN v4.2)',
    score: clampScore(score * staleFactor),
    confidence: clampScore(confidence * staleFactor),
    signal,
    metadata: { ...metadata, staleFactor, reason: score > 0 ? 'accumulation_detected' : 'no_accumulation' },
  };
}
