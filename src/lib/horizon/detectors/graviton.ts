// ─── GRAVITON — Гравитационная линза v5.1 (П2 — центры масс + стены) ────────
// Крупный игрок «стягивает» объём к себе — как чёрная дыра искривляет
// пространство.
//
// v5.1 П2 Правка (согласно спецификации v4):
// 1) Обрезка стакана до 80% объёма (отсекает фантомные стены ММ на периферии)
// 2) Центры масс bid/ask: CM = Σ(vol_i × price_i) / (Σ(vol_i) + ε)
// 3) separation = (CM_ask - CM_bid) / (mid_price + ε)
// 4) asymmetry = (Σ(bid_vol × dist_from_CM_bid) - Σ(ask_vol × dist_from_CM_ask)) / (total_vol + ε)
// 5) detect_walls(): wall = уровень где vol > 3×median, wall_score с depth-весом
// 6) graviton_score = f(separation, asymmetry, wall_score)
//
// Trade-based OFI fallback остаётся (Режим 1 — нет стакана)

import type { DetectorInput, DetectorResult } from './types';
import { safeDivide, clampScore, stalePenalty } from './guards';

const EPS = 1e-6;

// ─── Вспомогательные функции ────────────────────────────────────────────────

interface TrimmedSide {
  levels: Array<{ price: number; quantity: number }>;
  totalVolume: number;
  cutoffIndex: number;
}

/**
 * Обрезка стакана до 80% кумулятивного объёма.
 * Отсекает периферийные фантомные стены маркетмейкеров.
 * Все расчёты ТОЛЬКО на уровнях [0..cutoffLevel]
 */
function trimToVolumeCutoff(
  levels: Array<{ price: number; quantity: number }>,
  ratio: number = 0.8,
): TrimmedSide {
  const totalVolume = levels.reduce((s, l) => s + l.quantity, 0);
  if (totalVolume < EPS) return { levels: [], totalVolume: 0, cutoffIndex: 0 };

  let cumVolume = 0;
  let cutoffIndex = levels.length - 1; // default: all levels

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

/**
 * Центр масс: CM = Σ(vol_i × price_i) / (Σ(vol_i) + ε)
 */
function centerOfMass(
  levels: Array<{ price: number; quantity: number }>,
): number {
  let num = 0;
  let den = 0;
  for (const l of levels) {
    num += l.quantity * l.price;
    den += l.quantity;
  }
  return den > EPS ? num / den : 0;
}

/**
 * Взвешенная асимметрия объёма относительно центра масс.
 * asymmetry = Σ(vol × |price - CM| × sign(price - CM)) / (Σ(vol) + ε)
 * Положительная → объём сконцентрирован ДАЛЬШЕ от CM на дальней стороне
 */
function volumeAsymmetry(
  levels: Array<{ price: number; quantity: number }>,
  cm: number,
): number {
  let num = 0;
  let den = 0;
  for (const l of levels) {
    const dist = l.price - cm;
    num += l.quantity * dist; // sign сохранён через dist
    den += l.quantity;
  }
  return den > EPS ? num / den : 0;
}

/**
 * Обнаружение «стен» — уровней с аномально большим объёмом.
 * wall = уровень где volume > 3 × median_volume_per_level
 *
 * wall_score = Σ(wall_volume × w_depth_k) / (total_side_volume + ε)
 * w_depth_k = exp(-depth_k / (avg_depth + ε))
 */
function detectWalls(
  levels: Array<{ price: number; quantity: number }>,
  totalSideVolume: number,
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

  // Median volume per level
  const sortedVols = levels.map(l => l.quantity).sort((a, b) => a - b);
  const medianVol = sortedVols[Math.floor(sortedVols.length / 2)];

  // Threshold for wall detection
  const wallThreshold = 3 * medianVol;

  // Average depth (number of levels)
  const avgDepth = levels.length;

  let wallScoreNum = 0;
  const walls: Array<{ depth: number; volume: number }> = [];
  let minDepth = Infinity;

  for (let i = 0; i < levels.length; i++) {
    if (levels[i].quantity > wallThreshold) {
      const depth = i; // 0-based depth from best price
      const wDepth = Math.exp(-depth / (avgDepth + EPS));
      wallScoreNum += levels[i].quantity * wDepth;
      walls.push({ depth, volume: levels[i].quantity });
      if (depth < minDepth) minDepth = depth;
    }
  }

  const wallScore = totalSideVolume > EPS
    ? wallScoreNum / totalSideVolume
    : 0;
  const wallProximity = minDepth === Infinity ? 999 : minDepth;

  return {
    wallScore: Math.min(1, wallScore),
    wallCount: walls.length,
    wallProximity,
    maxWallVolume: walls.length > 0 ? Math.max(...walls.map(w => w.volume)) : 0,
    walls,
  };
}

// ─── Главный детектор ──────────────────────────────────────────────────────

export function detectGraviton(input: DetectorInput): DetectorResult {
  const { orderbook, ofi, weightedOFI, tradeOFI } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // v4.2: Gradual stale penalty instead of binary stale→0
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
    // If stale but not completely dead, proceed with computation but apply penalty later
  }

  const obIsEmpty = orderbook.bids.length === 0 && orderbook.asks.length === 0;

  // ─── Режим 1: Нет стакана — используем Trade-based OFI ────────────────
  // На выходных (ДСВД) ISS возвращает HTML для orderbook, но trades свежие.
  // tradeOFI даёт direction + weighted direction → можем считать lensing ratio
  if (obIsEmpty) {
    // Нужны сделки для расчёта
    if (!tradeOFI || (tradeOFI.buyCount + tradeOFI.sellCount) < 5) {
      metadata.insufficientData = true;
      metadata.tradeOFI = true;
      return {
        detector: 'GRAVITON',
        description: 'Гравитационная линза — нет стакана и мало сделок для tradeOFI',
        score: 0,
        confidence: 0,
        signal: 'NEUTRAL',
        metadata,
      };
    }

    // Lensing ratio: weightedTradeOFI / (|tradeOFI| + ε)
    const tradeOfiSimple = tradeOFI.ofi;
    const tradeOfiWeighted = tradeOFI.weightedOFI;
    const lensingRatio = Math.abs(tradeOfiWeighted) / (Math.abs(tradeOfiSimple) + 0.01);
    metadata.lensingRatio = Math.round(lensingRatio * 100) / 100;
    metadata.ofiSource = 'trades';

    // Concentration: доля покупок/продаж среди недавних сделок
    const nearTermConcentration = Math.abs(tradeOFI.nearTermOFI);
    metadata.nearTermConcentration = Math.round(nearTermConcentration * 1000) / 1000;

    // Trade intensity ratio
    const totalTrades = tradeOFI.buyCount + tradeOFI.sellCount;
    const tradeImbalance = totalTrades > 0
      ? Math.abs(tradeOFI.buyCount - tradeOFI.sellCount) / totalTrades
      : 0;
    metadata.tradeImbalance = Math.round(tradeImbalance * 1000) / 1000;

    // Score calculation (упрощённый для trade-based режима)
    const lensingScore = Math.min(1, Math.max(0, (lensingRatio - 1) / 3));
    const concentrationScore = Math.min(1, Math.max(0, (nearTermConcentration - 0.15) / 0.5));
    const imbalanceScore = Math.min(1, Math.max(0, (tradeImbalance - 0.1) / 0.5));

    const rawScore = lensingScore * 0.4 + concentrationScore * 0.35 + imbalanceScore * 0.25;
    const score = Math.min(1, Math.max(0, rawScore));

    // Confidence ниже в trade-based режиме
    const agreement = [lensingScore, concentrationScore, imbalanceScore]
      .filter(s => s > 0.3).length / 3;
    const confidence = score > 0.2 ? Math.min(0.8, agreement * 1.2) : 0;

    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (score > 0.2) {
      signal = tradeOfiSimple > 0.1 ? 'BULLISH' : tradeOfiSimple < -0.1 ? 'BEARISH' : 'NEUTRAL';
    }

    // Apply stale penalty (v4.2: gradual instead of binary)
    const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
    const finalScore = clampScore(score * staleFactor);
    const finalConfidence = clampScore(confidence * staleFactor);
    metadata.staleFactor = staleFactor;

    return {
      detector: 'GRAVITON',
      description: 'Гравитационная линза — крупный игрок (trade-based OFI, нет стакана)',
      score: finalScore,
      confidence: finalConfidence,
      signal,
      metadata,
    };
  }

  // ─── Режим 2: Стакан доступен — полноценный анализ v5.1 ────────────────

  if (orderbook.bids.length < 2 || orderbook.asks.length < 2) {
    metadata.insufficientData = true;
    return {
      detector: 'GRAVITON',
      description: 'Гравитационная линза — мало уровней стакана',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  // ─── 1. Обрезка до 80% объёма ──────────────────────────────────────────
  const bidTrimmed = trimToVolumeCutoff(orderbook.bids, 0.8);
  const askTrimmed = trimToVolumeCutoff(orderbook.asks, 0.8);

  metadata.bidCutoffLevel = bidTrimmed.cutoffIndex + 1;
  metadata.askCutoffLevel = askTrimmed.cutoffIndex + 1;
  metadata.bidLevelsBefore = orderbook.bids.length;
  metadata.askLevelsBefore = orderbook.asks.length;

  if (bidTrimmed.levels.length < 1 || askTrimmed.levels.length < 1) {
    metadata.insufficientData = true;
    return {
      detector: 'GRAVITON',
      description: 'Гравитационная линза — стакан пуст после обрезки',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  // ─── 2. Центры масс ────────────────────────────────────────────────────
  const cmBid = centerOfMass(bidTrimmed.levels);
  const cmAsk = centerOfMass(askTrimmed.levels);

  const bestBid = orderbook.bids[0].price;
  const bestAsk = orderbook.asks[0].price;
  const midPrice = (bestBid + bestAsk) / 2;

  metadata.cmBid = Math.round(cmBid * 1000) / 1000;
  metadata.cmAsk = Math.round(cmAsk * 1000) / 1000;
  metadata.midPrice = Math.round(midPrice * 1000) / 1000;

  // ─── 3. Separation ────────────────────────────────────────────────────
  // separation = (CM_ask - CM_bid) / (mid_price + ε)
  // Нормальный стакан: CM_bid < mid < CM_ask, separation ≈ spread / mid
  // Аномалия: CM_bid сдвинут к mid → бычье давление (крупный бид-стену держат рядом)
  //           CM_ask сдвинут к mid → медвежье давление
  const separation = safeDivide(cmAsk - cmBid, midPrice, 0.001);
  metadata.separation = Math.round(separation * 10000) / 10000;

  // Ожидаемый separation ≈ spread/mid — нормируем
  const spread = bestAsk - bestBid;
  const expectedSep = safeDivide(spread, midPrice, 0.001);

  // Separation score: насколько separation меньше ожидаемого
  // Сжатие → один центр масс ближе к mid → крупный игрок
  // separation < expected → CM_bid/CM_ask ближе друг к другу чем обычно
  const separationRatio = expectedSep > EPS ? separation / expectedSep : 1;
  metadata.separationRatio = Math.round(separationRatio * 1000) / 1000;

  // Score: сжатие separation → высокий скор
  // separationRatio < 0.5 → очень сжат → сильный сигнал
  // separationRatio ~ 1 → нормально
  // separationRatio > 1 → разведены (нормальный стакан)
  const separationScore = Math.min(1, Math.max(0, (1 - separationRatio) / 0.5));

  // ─── 4. Asymmetry ──────────────────────────────────────────────────────
  // asymmetry_bid = Σ(bid_vol × dist_from_CM_bid) / (Σ(bid_vol) + ε)
  // positive = объём дальше от CM (размазан), negative = объём ближе к CM (концентрирован)
  const bidAsymmetry = volumeAsymmetry(bidTrimmed.levels, cmBid);
  const askAsymmetry = volumeAsymmetry(askTrimmed.levels, cmAsk);

  // Общая асимметрия: разница между bid/ask side concentration
  const totalVol = bidTrimmed.totalVolume + askTrimmed.totalVolume;
  const asymmetry = totalVol > EPS
    ? (Math.abs(bidAsymmetry) - Math.abs(askAsymmetry)) / totalVol
    : 0;

  metadata.bidAsymmetry = Math.round(bidAsymmetry * 1000) / 1000;
  metadata.askAsymmetry = Math.round(askAsymmetry * 1000) / 1000;
  metadata.asymmetry = Math.round(asymmetry * 10000) / 10000;

  // Asymmetry score: высокий → одна сторона сильнее сконцентрирована → крупный игрок
  const maxAbsAsym = Math.max(Math.abs(bidAsymmetry), Math.abs(askAsymmetry));
  // Нормируем на mid_price для сравнимости между тикерами
  const normAsymmetry = midPrice > EPS ? maxAbsAsym / midPrice : 0;
  // normAsymmetry > 0.005 → значительная асимметрия
  const asymmetryScore = Math.min(1, Math.max(0, (normAsymmetry - 0.001) / 0.01));
  metadata.normAsymmetry = Math.round(normAsymmetry * 10000) / 10000;

  // ─── 5. Wall detection (на ПОЛНОМ стакане, не обрезанном!) ───────────
  // Стены ищем на полном стакане — 80% cutoff нужен для CM/separation,
  // но стены могут быть на любом уровне, даже за 80% порогом
  const bidTotalVol = orderbook.bids.reduce((s, l) => s + l.quantity, 0);
  const askTotalVol = orderbook.asks.reduce((s, l) => s + l.quantity, 0);
  const bidWalls = detectWalls(orderbook.bids, bidTotalVol);
  const askWalls = detectWalls(orderbook.asks, askTotalVol);

  metadata.bidWallCount = bidWalls.wallCount;
  metadata.askWallCount = askWalls.wallCount;
  metadata.bidWallScore = Math.round(bidWalls.wallScore * 1000) / 1000;
  metadata.askWallScore = Math.round(askWalls.wallScore * 1000) / 1000;
  metadata.bidWallProximity = bidWalls.wallProximity;
  metadata.askWallProximity = askWalls.wallProximity;

  // Wall proximity score: стена рядом с best price → сильнее
  // wall_proximity нормируется на spread
  const bidProxScore = bidWalls.wallProximity < 999
    ? Math.min(1, 1 / (1 + bidWalls.wallProximity))
    : 0;
  const askProxScore = askWalls.wallProximity < 999
    ? Math.min(1, 1 / (1 + askWalls.wallProximity))
    : 0;
  const maxProxScore = Math.max(bidProxScore, askProxScore);

  // Combined wall score: weighted combination of wall presence + proximity
  const combinedWallScore = Math.max(bidWalls.wallScore, askWalls.wallScore);
  const wallScore = 0.6 * combinedWallScore + 0.4 * maxProxScore;

  // ─── 6. Итоговый score ────────────────────────────────────────────────
  // Веса: separation (0.30) + asymmetry (0.25) + walls (0.45)
  // Стены — самый надёжный индикатор крупного игрока
  const rawScore = separationScore * 0.30 + asymmetryScore * 0.25 + wallScore * 0.45;
  let score = Math.min(1, Math.max(0, rawScore));

  // ─── 7. Signal direction ──────────────────────────────────────────────
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.15) {
    // Direction из нескольких источников:
    // 1) CM relative position: если CM_bid ближе к mid → бычье давление
    // 2) Wall side: какая сторона имеет больше/ближе стены
    // 3) OFI direction
    const cmBidRelMid = midPrice > EPS ? (midPrice - cmBid) / (spread / 2 + EPS) : 0;
    const cmAskRelMid = midPrice > EPS ? (cmAsk - midPrice) / (spread / 2 + EPS) : 0;
    const cmDirection = cmBidRelMid - cmAskRelMid; // positive → CM_bid близко → BULLISH

    const wallDirection = bidWalls.wallScore > askWalls.wallScore ? 1 : -1; // bid wall → BULLISH
    const ofiDirection = ofi > 0.05 ? 1 : ofi < -0.05 ? -1 : 0;

    // Weighted vote: CM (40%) + walls (35%) + OFI (25%)
    const directionVote = cmDirection * 0.4 + wallDirection * 0.35 + ofiDirection * 0.25;

    signal = directionVote > 0.15 ? 'BULLISH'
      : directionVote < -0.15 ? 'BEARISH' : 'NEUTRAL';

    metadata.cmDirection = Math.round(cmDirection * 100) / 100;
    metadata.wallDirection = wallDirection;
    metadata.directionVote = Math.round(directionVote * 100) / 100;
  }

  // ─── 8. Confidence ────────────────────────────────────────────────────
  // Выше при согласии нескольких метрик
  const metrics = [separationScore, asymmetryScore, wallScore];
  const activeMetrics = metrics.filter(s => s > 0.2).length;
  const agreement = activeMetrics / 3;
  const confidence = score > 0.15
    ? Math.min(1, agreement * 1.5 * Math.max(score, 0.3))
    : 0;

  // Apply stale penalty (v4.2: gradual instead of binary)
  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;
  score = clampScore(score * staleFactor);
  const finalConfidence = clampScore(confidence * staleFactor);

  metadata.separationScore = Math.round(separationScore * 1000) / 1000;
  metadata.asymmetryScore = Math.round(asymmetryScore * 1000) / 1000;
  metadata.wallScoreCombined = Math.round(wallScore * 1000) / 1000;
  metadata.ofiSource = 'orderbook';
  metadata.staleFactor = staleFactor;

  return {
    detector: 'GRAVITON',
    description: 'Гравитационная линза — центры масс + стены стакана',
    score,
    confidence: finalConfidence,
    signal,
    metadata,
  };
}
