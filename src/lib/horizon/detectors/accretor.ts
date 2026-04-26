// ─── ACCRETOR — Аккреция v5.1 (П2 — DBSCAN + ATR нормализация) ─────────────
// Крупный игрок методично набирает позицию, не двигая цену.
// Мелкие сделки кластеризуются во времени и цене → «аккреционный диск»
//
// v5.1 П2 Правка (согласно спецификации v4):
// 1) Фильтруем сделки: volume < 0.3 × avg_lot_size (мелкие = скрытые)
// 2) DBSCAN к множеству {(time, price)} мелких сделок:
//    - eps_time = 60 секунд
//    - eps_price = 1 tick (оцениваем через ATR)
//    - min_samples = 5
//    - Окно: 200 последних сделок
// 3) accretor_score = (n_clustered / n_small) × cluster_concentration
//    - concentration = avg_cluster_size / (ATR(14) / (tick_size + ε))
//    - ATR-нормализация делает метрику сравнимой между тикерами
// 4) >60% мелких сделок кластеризовано → крупный игрок дробит заявку
//
// НЕ дублирует DECOHERENCE:
//   DECOHERENCE = символьный поток (частоты символов)
//   ACCRETOR = spatial clustering (время+цена → DBSCAN)

import type { DetectorInput, DetectorResult } from './types';

const EPS = 1e-6;

// ─── DBSCAN Implementation ────────────────────────────────────────────────

interface DBSCANPoint {
  time: number;    // milliseconds
  price: number;
  volume: number;
  index: number;
}

interface DBSCANCluster {
  points: DBSCANPoint[];
  avgSize: number;
  timeSpan: number;
  priceSpan: number;
}

/**
 * DBSCAN clustering algorithm
 * @param points — array of data points
 * @param epsTime — max time distance (ms) for neighbors
 * @param epsPrice — max price distance for neighbors
 * @param minSamples — minimum points to form a cluster
 */
function dbscan(
  points: DBSCANPoint[],
  epsTime: number,
  epsPrice: number,
  minSamples: number = 5,
): DBSCANCluster[] {
  const n = points.length;
  if (n < minSamples) return [];

  // Pre-compute neighbor lists
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dt = Math.abs(points[i].time - points[j].time);
      const dp = Math.abs(points[i].price - points[j].price);
      if (dt <= epsTime && dp <= epsPrice) {
        neighbors[i].push(j);
        neighbors[j].push(i);
      }
    }
  }

  // DBSCAN core algorithm
  const labels: number[] = new Array(n).fill(-1); // -1 = unvisited, -2 = noise
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) continue; // already visited

    if (neighbors[i].length < minSamples - 1) {
      labels[i] = -2; // noise
      continue;
    }

    // Start new cluster
    labels[i] = clusterId;
    const queue = [...neighbors[i]];
    let qi = 0;

    while (qi < queue.length) {
      const j = queue[qi++];
      if (labels[j] === -2) {
        labels[j] = clusterId; // change noise to border point
      }
      if (labels[j] !== -1) continue; // already assigned

      labels[j] = clusterId;

      if (neighbors[j].length >= minSamples - 1) {
        // j is a core point — expand cluster
        for (const k of neighbors[j]) {
          if (labels[k] === -1 || labels[k] === -2) {
            queue.push(k);
          }
        }
      }
    }

    clusterId++;
  }

  // Group into clusters
  const clusters: Map<number, DBSCANPoint[]> = new Map();
  for (let i = 0; i < n; i++) {
    const label = labels[i];
    if (label < 0) continue; // noise
    if (!clusters.has(label)) clusters.set(label, []);
    clusters.get(label)!.push(points[i]);
  }

  // Build cluster info
  return Array.from(clusters.values()).map(pts => {
    const times = pts.map(p => p.time);
    const prices = pts.map(p => p.price);
    const avgSize = pts.reduce((s, p) => s + p.volume, 0) / pts.length;
    return {
      points: pts,
      avgSize,
      timeSpan: Math.max(...times) - Math.min(...times),
      priceSpan: Math.max(...prices) - Math.min(...prices),
    };
  });
}

// ─── ATR Calculation ──────────────────────────────────────────────────────

/**
 * Average True Range (Wilder's smoothing)
 * ATR(14) for normalizing cluster sizes across tickers
 */
function calcATR(candles: Array<{ high: number; low: number; close: number }>, period: number = 14): number {
  if (candles.length < 2) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length === 0) return 0;

  // Wilder's smoothing
  let atr = trueRanges.slice(0, Math.min(period, trueRanges.length))
    .reduce((s, v) => s + v, 0) / Math.min(period, trueRanges.length);

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

// ─── Main Detector ────────────────────────────────────────────────────────

export function detectAccretor(input: DetectorInput): DetectorResult {
  const { cumDelta, prices, trades, candles } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // v4.1.2: Stale data → нет аномалии
  if (input.staleData) {
    return {
      detector: 'ACCRETOR',
      description: 'Аккреция — постепенное накопление (устаревшие данные)',
      score: 0, confidence: 0, signal: 'NEUTRAL',
      metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
    };
  }

  // Нужен минимум 20 сделок для DBSCAN
  if (trades.length < 20 || prices.length < 5) {
    return {
      detector: 'ACCRETOR',
      description: 'Аккреция — постепенное накопление',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true },
    };
  }

  // ─── 1. Filter small trades ────────────────────────────────────────────
  // volume < 0.3 × avg_lot_size → считаем «мелкими» (скрытыми)
  const avgLotSize = trades.reduce((s, t) => s + t.quantity, 0) / trades.length;
  const smallTradeThreshold = 0.3 * avgLotSize;
  const smallTrades = trades.filter(t => t.quantity <= smallTradeThreshold + EPS);
  const largeTrades = trades.filter(t => t.quantity > smallTradeThreshold);

  metadata.avgLotSize = Math.round(avgLotSize * 100) / 100;
  metadata.smallTradeThreshold = Math.round(smallTradeThreshold * 100) / 100;
  metadata.smallTradeCount = smallTrades.length;
  metadata.largeTradeCount = largeTrades.length;
  metadata.smallTradeRatio = trades.length > 0
    ? Math.round(smallTrades.length / trades.length * 1000) / 1000 : 0;

  // ─── 2. DBSCAN clustering on {(time, price)} ──────────────────────────
  // Окно: 200 последних сделок
  const windowTrades = trades.slice(-200);
  const windowSmallTrades = windowTrades.filter(t => t.quantity <= smallTradeThreshold + EPS);

  // eps_time = 60 секунд, eps_price = estimated tick size
  const epsTime = 60 * 1000; // 60 seconds in ms

  // Estimate tick size from price data
  const sortedPrices = [...new Set(windowTrades.map(t => t.price))].sort((a, b) => a - b);
  let tickSize = 0.01; // default
  if (sortedPrices.length >= 2) {
    const diffs: number[] = [];
    for (let i = 1; i < sortedPrices.length; i++) {
      const diff = sortedPrices[i] - sortedPrices[i - 1];
      if (diff > 0) diffs.push(diff);
    }
    if (diffs.length > 0) {
      diffs.sort((a, b) => a - b);
      tickSize = diffs[0]; // minimum price increment
    }
  }
  const epsPrice = Math.max(tickSize, 0.01); // at least 1 tick

  metadata.tickSize = Math.round(tickSize * 10000) / 10000;
  metadata.epsTime = 60000;
  metadata.epsPrice = Math.round(epsPrice * 10000) / 10000;

  // Prepare DBSCAN points
  const dbscanPoints: DBSCANPoint[] = windowSmallTrades
    .filter(t => t.timestamp && t.timestamp > 0 && t.price > 0)
    .map((t, idx) => ({
      time: t.timestamp!,
      price: t.price,
      volume: t.quantity,
      index: idx,
    }));

  metadata.dbscanInputPoints = dbscanPoints.length;

  const minSamples = Math.min(5, Math.max(3, Math.floor(dbscanPoints.length / 20)));
  const clusters = dbscan(dbscanPoints, epsTime, epsPrice, minSamples);

  metadata.clusterCount = clusters.length;
  metadata.clusteredPoints = clusters.reduce((s, c) => s + c.points.length, 0);
  metadata.minSamples = minSamples;

  // ─── 3. Cluster analysis ──────────────────────────────────────────────
  const nClustered = clusters.reduce((s, c) => s + c.points.length, 0);
  const nSmallTrades = dbscanPoints.length;

  // Cluster ratio: доля мелких сделок, попавших в кластеры
  const clusterRatio = nSmallTrades > 0 ? nClustered / nSmallTrades : 0;
  metadata.clusterRatio = Math.round(clusterRatio * 1000) / 1000;

  // Average cluster size
  const avgClusterSize = clusters.length > 0
    ? clusters.reduce((s, c) => s + c.points.length, 0) / clusters.length
    : 0;
  metadata.avgClusterSize = Math.round(avgClusterSize * 10) / 10;

  // ─── 4. ATR normalization ─────────────────────────────────────────────
  // concentration = avg_cluster_size / (ATR(14) / (tick_size + ε))
  // ATR-нормализация делает метрику сравнимой между тикерами
  let atr = 0;
  if (candles && candles.length >= 2) {
    atr = calcATR(candles as Array<{ high: number; low: number; close: number }>, 14);
  } else if (prices.length >= 5) {
    // Fallback: estimate ATR from price differences
    const diffs: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      diffs.push(Math.abs(prices[i] - prices[i - 1]));
    }
    atr = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  }

  metadata.atr = Math.round(atr * 10000) / 10000;

  const concentrationDenom = atr / (tickSize + EPS);
  const concentration = concentrationDenom > EPS
    ? avgClusterSize / concentrationDenom
    : 0;
  metadata.concentration = Math.round(concentration * 1000) / 1000;

  // ─── 5. Delta trend (старый компонент — сохраняем для контекста) ──────
  const runningDelta: number[] = [];
  let cumSum = 0;
  for (const t of trades) {
    const side = t.direction.toUpperCase().trim();
    if (side === 'B' || side === 'BUY') cumSum += t.quantity;
    else if (side === 'S' || side === 'SELL') cumSum -= t.quantity;
    runningDelta.push(cumSum);
  }

  // Simple linear regression for delta trend
  const n = runningDelta.length;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += runningDelta[i]; sxy += i * runningDelta[i]; sx2 += i * i;
  }
  const den = n * sx2 - sx * sx;
  const deltaSlope = den !== 0 ? (n * sxy - sx * sy) / den : 0;
  const deltaR2 = (() => {
    if (den === 0 || n < 3) return 0;
    const meanY = sy / n;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
      ssTot += (runningDelta[i] - meanY) ** 2;
      ssRes += (runningDelta[i] - (deltaSlope * i + (sy - deltaSlope * sx) / n)) ** 2;
    }
    return ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  })();

  metadata.deltaSlope = Math.round(deltaSlope * 100) / 100;
  metadata.deltaR2 = Math.round(deltaR2 * 1000) / 1000;

  // ─── 6. Score calculation ─────────────────────────────────────────────
  // accretor_score = (cluster_ratio) × (cluster_concentration)
  // + delta_trend_bonus (если R² > 0.5 и cluster_ratio > 0.3)

  // Cluster-based score (primary)
  const clusterScore = clusterRatio > 0.6 ? 1
    : clusterRatio > 0.4 ? 0.8
    : clusterRatio > 0.2 ? 0.5
    : clusterRatio > 0.1 ? 0.2 : 0;

  // Concentration boost: tight clusters (high concentration) → stronger signal
  const concentrationBoost = concentration > 5 ? 1.2
    : concentration > 2 ? 1.0
    : concentration > 1 ? 0.8
    : 0.5;

  const dbscanScore = Math.min(1, clusterScore * concentrationBoost);

  // Delta trend bonus: если кластеры + монотонная дельта → сильный сигнал
  const deltaTrendBonus = (deltaR2 > 0.5 && clusterRatio > 0.2)
    ? Math.min(0.3, deltaR2 * 0.3)
    : 0;

  // Final score
  const rawScore = dbscanScore * 0.75 + deltaTrendBonus * 0.25;
  const score = Math.min(1, Math.max(0, rawScore));

  // ─── 7. Signal direction ──────────────────────────────────────────────
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.15) {
    // Direction from delta trend + cluster buy/sell ratio
    const deltaDirection = deltaSlope > 0 ? 1 : deltaSlope < 0 ? -1 : 0;

    // Cluster buy/sell ratio
    let clusterBuyVol = 0, clusterSellVol = 0;
    for (const cl of clusters) {
      for (const pt of cl.points) {
        const trade = windowSmallTrades[pt.index];
        if (trade) {
          const d = trade.direction.toUpperCase().trim();
          if (d === 'B' || d === 'BUY') clusterBuyVol += pt.volume;
          else if (d === 'S' || d === 'SELL') clusterSellVol += pt.volume;
        }
      }
    }
    const clusterDirection = clusterBuyVol > clusterSellVol * 1.2 ? 1
      : clusterSellVol > clusterBuyVol * 1.2 ? -1 : 0;

    // Combined vote
    const vote = deltaDirection * 0.5 + clusterDirection * 0.5;
    signal = vote > 0.15 ? 'BULLISH' : vote < -0.15 ? 'BEARISH' : 'NEUTRAL';
  }

  // ─── 8. Confidence ────────────────────────────────────────────────────
  const hasClusters = clusters.length >= 2;
  const hasDeltaTrend = deltaR2 > 0.5;
  const confidence = score > 0.15
    ? Math.min(1, ((hasClusters ? 0.5 : 0) + (hasDeltaTrend ? 0.3 : 0) + clusterRatio * 0.2))
    : 0;

  return {
    detector: 'ACCRETOR',
    description: 'Аккреция — кластерное накопление (DBSCAN + ATR)',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
