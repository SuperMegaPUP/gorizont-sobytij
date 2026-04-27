// ─── GRAVITON — Гравитационная линза v4.2 ──────────────────────────────────
// Обнаружение крупного игрока через центры масс + стены стакана.
//
// v4.2 Формула:
// 1) 80% cutoff (bid/ask отдельно):
//    cutoffLevel = min level where cumvol >= 0.8 × totalSideVolume
//    if cutoffLevel < 3 → use all levels (100%)
//    if bid_depth==0 || ask_depth==0 → score=0, "incomplete_ob"
//
// 2) Center of mass (COM):
//    cm_bid = Σ(vol_i × price_i) / max(Σ(vol_i), ε)
//    cm_ask = Σ(vol_i × price_i) / max(Σ(vol_i), ε)
//
// 3) ATR-нормализация:
//    separation = (cm_ask - cm_bid) / max(mid_price, ε)
//    ATR_pct = ATR(14) / mid_price
//    separation_norm = separation / max(ATR_pct, ε)
//
// 4) Asymmetry (безразмерная):
//    asymmetry_raw = (Σ bid_vol×dist_cm - Σ ask_vol×dist_cm) / max(total_vol, ε)
//    asymmetry_norm = asymmetry_raw / max(spread, 0.001 × mid_price)
//
// 5) Wall detection:
//    wall = level where vol > 3 × median_vol_per_level
//    wall_proximity = min(dist_to_wall) / max(spread, 0.001 × mid_price)
//    w_depth_k = exp(-depth_k / max(median_depth, ε))   // MEDIAN, не avg
//    wall_score = Σ(wall_vol × w_depth_k) / max(total_side_vol, ε)
//
// 6) Sigmoid scoring:
//    core_signal = 2.0 × separation_norm + 1.5 × |asymmetry_norm|
//    wall_signal = 0.5 × wall_score × wall_proximity
//    graviton_score = sigmoid(core_signal + wall_signal)
//
// 7) Fallback: нет стакана → tradeOFI

import type { DetectorInput, DetectorResult } from './types';
import { safeDivide, clampScore, stalePenalty } from './guards';

const EPS = 1e-6;
const ATR_PCT_FLOOR = 0.005;  // 0.5% — минимальная волатильность для нормализации

// ─── Вспомогательные функции ────────────────────────────────────────────────

interface TrimmedSide {
  levels: Array<{ price: number; quantity: number }>;
  totalVolume: number;
  cutoffIndex: number;
}

function trimToVolumeCutoff(
  levels: Array<{ price: number; quantity: number }>,
  ratio: number = 0.8,
): TrimmedSide {
  const totalVolume = levels.reduce((s, l) => s + l.quantity, 0);
  if (totalVolume < EPS) return { levels: [], totalVolume: 0, cutoffIndex: 0 };

  let cumVolume = 0;
  let cutoffIndex = levels.length - 1;

  for (let i = 0; i < levels.length; i++) {
    cumVolume += levels[i].quantity;
    if (cumVolume >= ratio * totalVolume) {
      cutoffIndex = i;
      break;
    }
  }

  const trimmed = levels.slice(0, cutoffIndex + 1);
  const trimmedVol = trimmed.reduce((s, l) => s + l.quantity, 0);
  return { levels: trimmed, totalVolume: trimmedVol, cutoffIndex };
}

function centerOfMass(levels: Array<{ price: number; quantity: number }>): number {
  let num = 0, den = 0;
  for (const l of levels) {
    num += l.quantity * l.price;
    den += l.quantity;
  }
  return den > EPS ? num / den : 0;
}

function volumeAsymmetry(levels: Array<{ price: number; quantity: number }>, cm: number): number {
  let num = 0, den = 0;
  for (const l of levels) {
    num += l.quantity * Math.abs(l.price - cm);
    den += l.quantity;
  }
  return den > EPS ? num / den : 0;
}

function detectWalls(
  levels: Array<{ price: number; quantity: number }>,
  totalSideVolume: number,
  medianDepth: number,
  spread: number,
): {
  wallScore: number;
  wallCount: number;
  wallProximity: number;
  maxWallVolume: number;
  walls: Array<{ depth: number; volume: number }>;
} {
  if (levels.length < 2) {
    return { wallScore: 0, wallCount: 0, wallProximity: 999, maxWallVolume: 0, walls: [] };
  }

  const sortedVols = levels.map(l => l.quantity).sort((a, b) => a - b);
  const medianVol = sortedVols[Math.floor(sortedVols.length / 2)];
  const wallThreshold = 3 * medianVol;

  let wallScoreNum = 0;
  const walls: Array<{ depth: number; volume: number }> = [];
  let minDepth = Infinity;

  for (let i = 0; i < levels.length; i++) {
    if (levels[i].quantity > wallThreshold) {
      const depth = i;
      const wDepth = Math.exp(-depth / Math.max(medianDepth, EPS));
      wallScoreNum += levels[i].quantity * wDepth;
      walls.push({ depth, volume: levels[i].quantity });
      if (depth < minDepth) minDepth = depth;
    }
  }

  const wallScore = totalSideVolume > EPS ? wallScoreNum / totalSideVolume : 0;
  const wallProximityRaw = minDepth === Infinity ? 999 : minDepth;
  // wall_proximity нормирован на spread (в тиках)
  const wallProximity = spread > EPS ? wallProximityRaw * spread / Math.max(spread, 0.001) : wallProximityRaw;

  return {
    wallScore: Math.min(1, wallScore),
    wallCount: walls.length,
    wallProximity,
    maxWallVolume: walls.length > 0 ? Math.max(...walls.map(w => w.volume)) : 0,
    walls,
  };
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ─── Главный детектор ──────────────────────────────────────────────────────

export function detectGraviton(input: DetectorInput): DetectorResult {
  const { orderbook, ofi, weightedOFI, tradeOFI, candles } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // Stale guard
  if (input.staleData) {
    const staleFactor = stalePenalty(input.staleMinutes);
    if (staleFactor <= 0) {
      return {
        detector: 'GRAVITON',
        description: 'Гравитационная линза (устаревшие данные)',
        score: 0, confidence: 0, signal: 'NEUTRAL',
        metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
      };
    }
  }

  const obIsEmpty = !orderbook || (orderbook.bids.length === 0 && orderbook.asks.length === 0);

  // ─── Режим 1: Нет стакана — tradeOFI fallback ───────────────────────────
  if (obIsEmpty) {
    if (!tradeOFI || (tradeOFI.buyCount + tradeOFI.sellCount) < 5) {
      metadata.insufficientData = true;
      metadata.tradeOFI = true;
      return {
        detector: 'GRAVITON',
        description: 'Гравитационная линза — нет стакана и мало сделок для tradeOFI',
        score: 0, confidence: 0, signal: 'NEUTRAL', metadata,
      };
    }

    const tradeOfiSimple = tradeOFI.ofi;
    const tradeOfiWeighted = tradeOFI.weightedOFI;
    const lensingRatio = Math.abs(tradeOfiWeighted) / (Math.abs(tradeOfiSimple) + 0.01);
    metadata.lensingRatio = Math.round(lensingRatio * 100) / 100;
    metadata.ofiSource = 'trades';

    const nearTermConcentration = Math.abs(tradeOFI.nearTermOFI);
    metadata.nearTermConcentration = Math.round(nearTermConcentration * 1000) / 1000;

    const totalTrades = tradeOFI.buyCount + tradeOFI.sellCount;
    const tradeImbalance = totalTrades > 0
      ? Math.abs(tradeOFI.buyCount - tradeOFI.sellCount) / totalTrades
      : 0;
    metadata.tradeImbalance = Math.round(tradeImbalance * 1000) / 1000;

    const lensingScore = Math.min(1, Math.max(0, (lensingRatio - 1) / 3));
    const concentrationScore = Math.min(1, Math.max(0, (nearTermConcentration - 0.15) / 0.5));
    const imbalanceScore = Math.min(1, Math.max(0, (tradeImbalance - 0.1) / 0.5));
    const rawScore = lensingScore * 0.4 + concentrationScore * 0.35 + imbalanceScore * 0.25;
    const score = clampScore(rawScore);

    const agreement = [lensingScore, concentrationScore, imbalanceScore].filter(s => s > 0.3).length / 3;
    const confidence = score > 0.2 ? Math.min(0.8, agreement * 1.2) : 0;

    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (score > 0.2) {
      signal = tradeOfiSimple > 0.1 ? 'BULLISH' : tradeOfiSimple < -0.1 ? 'BEARISH' : 'NEUTRAL';
    }

    const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
    return {
      detector: 'GRAVITON',
      description: 'Гравитационная линза — крупный игрок (trade-based OFI, нет стакана)',
      score: clampScore(score * staleFactor),
      confidence: clampScore(confidence * staleFactor),
      signal,
      metadata,
    };
  }

  // ─── Guard: пустая сторона ──────────────────────────────────────────────
  if (orderbook.bids.length === 0 || orderbook.asks.length === 0) {
    metadata.incompleteOB = true;
    return {
      detector: 'GRAVITON',
      description: 'Гравитационная линза — неполный стакан (одна сторона пуста)',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata,
    };
  }

  // ─── Guard: min 1 level per side (cutoff < 3 handled below) ────────────
  // v4.2: cutoff < 3 → use all levels; empty side → already handled above

  // ─── 1. 80% cutoff ──────────────────────────────────────────────────────
  const bidTrimmed = trimToVolumeCutoff(orderbook.bids, 0.8);
  const askTrimmed = trimToVolumeCutoff(orderbook.asks, 0.8);

  // Guard: cutoff < 3 → use all levels
  const useBidAll = bidTrimmed.cutoffIndex + 1 < 3;
  const useAskAll = askTrimmed.cutoffIndex + 1 < 3;
  const bidLevels = useBidAll ? orderbook.bids : bidTrimmed.levels;
  const askLevels = useAskAll ? orderbook.asks : askTrimmed.levels;

  metadata.bidCutoffLevel = useBidAll ? orderbook.bids.length : bidTrimmed.cutoffIndex + 1;
  metadata.askCutoffLevel = useAskAll ? orderbook.asks.length : askTrimmed.cutoffIndex + 1;
  metadata.usedFullBid = useBidAll;
  metadata.usedFullAsk = useAskAll;

  // ─── 2. Centers of mass ─────────────────────────────────────────────────
  const cmBid = centerOfMass(bidLevels);
  const cmAsk = centerOfMass(askLevels);

  const bestBid = orderbook.bids[0].price;
  const bestAsk = orderbook.asks[0].price;
  const midPrice = (bestBid + bestAsk) / 2;
  const spread = bestAsk - bestBid;

  metadata.cmBid = Math.round(cmBid * 1000) / 1000;
  metadata.cmAsk = Math.round(cmAsk * 1000) / 1000;
  metadata.midPrice = Math.round(midPrice * 1000) / 1000;

  // ─── 3. ATR-normalized separation ───────────────────────────────────────
  // ATR fallback: если нет candles → 0.01 × midPrice
  let atr = 0.01 * midPrice;
  if (candles && candles.length >= 14) {
    const ranges = candles.slice(-14).map(c => c.high - c.low);
    atr = ranges.reduce((s, r) => s + r, 0) / 14;
  }
  const atrPct = safeDivide(atr, midPrice, 0.01);

  const separation = safeDivide(cmAsk - cmBid, midPrice, 0.001);
  const effectiveAtrPct = Math.max(atrPct, ATR_PCT_FLOOR);  // семантический пол
  const separationNorm = Math.exp(-separation / effectiveAtrPct);
  metadata.separationNorm = Math.round(separationNorm * 1000) / 1000;
  metadata.atrPct = Math.round(atrPct * 1000) / 1000;
  metadata.effectiveAtrPct = Math.round(effectiveAtrPct * 1000) / 1000;

  // ─── 4. Asymmetry (dimensionless) ───────────────────────────────────────
  const bidAsymRaw = volumeAsymmetry(bidLevels, cmBid);
  const askAsymRaw = volumeAsymmetry(askLevels, cmAsk);
  const totalVol = bidTrimmed.totalVolume + askTrimmed.totalVolume;
  const asymmetryRaw = totalVol > EPS
    ? (bidAsymRaw - askAsymRaw) / totalVol
    : 0;
  // asymmetry_norm тоже использует ATR для консистентной нормировки
  const asymmetryNorm = safeDivide(asymmetryRaw, Math.max(spread, effectiveAtrPct * midPrice), 0);

  metadata.bidAsymmetry = Math.round(bidAsymRaw * 1000) / 1000;
  metadata.askAsymmetry = Math.round(askAsymRaw * 1000) / 1000;
  metadata.asymmetryNorm = Math.round(asymmetryNorm * 1000) / 1000;

  // ─── 5. Wall detection (на полном стакане) ──────────────────────────────
  const bidTotalVol = orderbook.bids.reduce((s, l) => s + l.quantity, 0);
  const askTotalVol = orderbook.asks.reduce((s, l) => s + l.quantity, 0);

  // median_depth = median количества уровней bid + ask
  const medianDepth = (bidLevels.length + askLevels.length) / 4;

  const bidWalls = detectWalls(orderbook.bids, bidTotalVol, medianDepth, spread);
  const askWalls = detectWalls(orderbook.asks, askTotalVol, medianDepth, spread);

  metadata.bidWallCount = bidWalls.wallCount;
  metadata.askWallCount = askWalls.wallCount;
  metadata.bidWallScore = Math.round(bidWalls.wallScore * 1000) / 1000;
  metadata.askWallScore = Math.round(askWalls.wallScore * 1000) / 1000;

  // wall_proximity: 1 на лучшем уровне, уменьшается с глубиной
  const bidMinWallDepth = bidWalls.walls.length > 0
    ? Math.min(...bidWalls.walls.map(w => w.depth)) : Infinity;
  const askMinWallDepth = askWalls.walls.length > 0
    ? Math.min(...askWalls.walls.map(w => w.depth)) : Infinity;
  const minWallDepth = Math.min(bidMinWallDepth, askMinWallDepth);
  const wallProximity = minWallDepth === Infinity ? 0 : 1 / (1 + minWallDepth);
  metadata.wallProximity = Math.round(wallProximity * 1000) / 1000;
  metadata.minWallDepth = minWallDepth === Infinity ? -1 : minWallDepth;

  const combinedWallScore = Math.max(bidWalls.wallScore, askWalls.wallScore);

  // ─── 6. Sigmoid scoring ─────────────────────────────────────────────────
  // core_signal = 2.0 × separation_norm + 1.5 × |asymmetry_norm|
  // wall_signal = 0.5 × wall_score × wall_proximity
  const coreSignal = 2.0 * separationNorm + 1.5 * Math.abs(asymmetryNorm);
  const wallSignal = 0.5 * combinedWallScore * (wallProximity < 999 ? wallProximity : 0);

  metadata.coreSignal = Math.round(coreSignal * 1000) / 1000;
  metadata.wallSignal = Math.round(wallSignal * 1000) / 1000;

  // Sigmoid centered at 0: sigmoid(0)=0.5 → score=0; sigmoid(2)=0.88 → score=0.76
  const rawSigmoid = sigmoid(coreSignal + wallSignal);
  const gravitonScore = Math.max(0, 2 * rawSigmoid - 1);
  const score = clampScore(gravitonScore);

  // ─── 7. Signal direction ────────────────────────────────────────────────
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.15) {
    const cmBidRelMid = midPrice > EPS ? (midPrice - cmBid) / (spread / 2 + EPS) : 0;
    const cmAskRelMid = midPrice > EPS ? (cmAsk - midPrice) / (spread / 2 + EPS) : 0;
    const cmDirection = cmBidRelMid - cmAskRelMid;
    const wallDirection = bidWalls.wallScore > askWalls.wallScore ? 1 : -1;
    const ofiDirection = ofi > 0.05 ? 1 : ofi < -0.05 ? -1 : 0;
    const directionVote = cmDirection * 0.4 + wallDirection * 0.35 + ofiDirection * 0.25;
    signal = directionVote > 0.15 ? 'BULLISH' : directionVote < -0.15 ? 'BEARISH' : 'NEUTRAL';
    metadata.cmDirection = Math.round(cmDirection * 100) / 100;
    metadata.wallDirection = wallDirection;
    metadata.directionVote = Math.round(directionVote * 100) / 100;
  }

  // ─── 8. Confidence ──────────────────────────────────────────────────────
  const metrics = [
    Math.min(1, Math.max(0, separationNorm)),
    Math.min(1, Math.max(0, Math.abs(asymmetryNorm))),
    combinedWallScore,
  ];
  const activeMetrics = metrics.filter(s => s > 0.2).length;
  const agreement = activeMetrics / 3;
  const confidence = score > 0.15
    ? Math.min(1, agreement * 1.5 * Math.max(score, 0.3))
    : 0;

  // Stale penalty
  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
  const finalScore = clampScore(score * staleFactor);
  const finalConfidence = clampScore(confidence * staleFactor);
  metadata.staleFactor = staleFactor;

  return {
    detector: 'GRAVITON',
    description: 'Гравитационная линза — COM + walls (sigmoid v4.2)',
    score: finalScore,
    confidence: finalConfidence,
    signal,
    metadata,
  };
}
