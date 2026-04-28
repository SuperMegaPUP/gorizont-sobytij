// ─── PREDATOR — Хищник v4.2 STATELESS ────────────────────────────────────────
// Три параллельных детектора: ACCUMULATE, PUSH, ABSORPTION
// Никакого state machine — каждый вызов = полный анализ
//
// v4.2 Формула:
//   score = max(accumulate, push*1.2, absorption*0.8) × consensusBonus
//   consensusBonus = 1.2 если 2+ сигнала > 0.2 одновременно

import type { DetectorInput, DetectorResult } from './types';
import { clampScore, stalePenalty, safeDivide } from './guards';
import { 
  PREDATOR_MIN_TRADES, PREDATOR_ABSOLUTE_MIN_TRADES,
  PREDATOR_TICK_DOMINANCE, PREDATOR_VOLUME_SPIKE, PREDATOR_DELTA_DIVERGENCE 
} from '../constants';

const EPS = 1e-6;

// ─── Вспомогательные функции ────────────────────────────────────────────────

function getATR(input: DetectorInput): { atr: number; atrPct: number; midPrice: number } {
  const midPrice = input.orderbook && input.orderbook.bids.length > 0 && input.orderbook.asks.length > 0
    ? (input.orderbook.bids[0].price + input.orderbook.asks[0].price) / 2
    : input.trades.length > 0 ? input.trades[input.trades.length - 1].price : 100;

  let atr = 0.01 * midPrice;
  if (input.candles && input.candles.length >= 14) {
    const ranges = input.candles.slice(-14).map(c => c.high - c.low);
    atr = ranges.reduce((s, r) => s + r, 0) / 14;
    atr = Math.max(atr, 0.001 * midPrice);
  }
  return { atr, atrPct: safeDivide(atr, midPrice, 0.01), midPrice };
}

function estimateTickSize(price: number): number {
  if (price > 1000) return 0.1;
  if (price > 100) return 0.05;
  return 0.01;
}

// ─── ACCUMULATE — скрытое накопление позиции ────────────────────────────────

function detectAccumulate(
  allTrades: Array<{ price: number; quantity: number; direction: string; timestamp: number }>,
  cumDelta: { delta: number },
  midPrice: number, atr: number, windowSize: number = 50,
): number {
  const trades = allTrades.slice(-windowSize);
  if (trades.length < 10) return 0;

  // 1. Delta divergence: cumDelta растёт, но цена не двигается (normalized)
  const priceChanges: number[] = [];
  for (let i = 1; i < trades.length; i++) {
    priceChanges.push(Math.abs(trades[i].price - trades[i - 1].price));
  }
  const avgPriceChange = priceChanges.reduce((s, v) => s + v, 0) / priceChanges.length;
  const priceVolatility = avgPriceChange / atr; // normalized

  const cumDeltaAbs = Math.abs(cumDelta.delta);
  const totalVol = trades.reduce((s, t) => s + t.quantity, 0);
  const avgTradeSize = totalVol / trades.length;
  const normalizedDelta = avgTradeSize > 0 ? cumDeltaAbs / (avgTradeSize * 10) : 0;
  const deltaDivergence = normalizedDelta > PREDATOR_DELTA_DIVERGENCE 
    && priceVolatility < 0.5 
    ? Math.min(1, normalizedDelta / 3) 
    : 0;

  // 2. Volume clustering: объёмы концентрируются на 1-2 уровнях
  const tickSize = estimateTickSize(midPrice);
  const priceMap = new Map<number, number>();
  for (const t of trades) {
    const p = Math.round(t.price / tickSize) * tickSize;
    priceMap.set(p, (priceMap.get(p) || 0) + t.quantity);
  }
  const sortedLevels = [...priceMap.values()].sort((a, b) => b - a);
  const topVolumes = sortedLevels.slice(0, 2).reduce((s, v) => s + v, 0);
  const totalVolume = sortedLevels.reduce((s, v) => s + v, 0);
  const volumeClustering = totalVolume > 0 && topVolumes / totalVolume > 0.6 
    ? Math.min(1, (topVolumes / totalVolume - 0.4) / 0.3)
    : 0;

  // 3. Delta dominance (тикер в одну сторону) — only if strong AND combined with other signals
  const buyCount = trades.filter(t => t.direction === 'BUY').length;
  const tickDominance = buyCount / trades.length;
  const dominanceBias = tickDominance > PREDATOR_TICK_DOMINANCE 
    ? (tickDominance - 0.5) * 2 
    : 0;

  // Require at least 2 components with non-trivial values for any score
  const componentsPositive = [
    deltaDivergence > 0.1,
    volumeClustering > 0.3,
    dominanceBias > 0.2
  ].filter(Boolean).length;

  // Price stall factor: accumulation valid only when price stalls at high volume
  const priceRange = Math.max(...trades.map(t => t.price)) - Math.min(...trades.map(t => t.price));
  const priceStallFactor = Math.max(0, 1 - (priceRange / (0.5 * atr)));

  // Strict scoring: only count weighted sum if 2+ components present
  // deltaDivergence is most significant (0.5), volumeClustering (0.3), dominanceBias (0.2)
  const rawScore = componentsPositive >= 2
    ? (deltaDivergence * 0.5 + volumeClustering * 0.3 + dominanceBias * 0.2)
    : 0;
  
  const accumulateScore = rawScore * priceStallFactor;
  return Math.min(1, accumulateScore);
}

// ─── PUSH — направленное давление ────────────────────────────────────────────

function detectPush(
  allTrades: Array<{ price: number; quantity: number; direction: string; timestamp: number }>,
  cumDelta: { delta: number },
  atr: number, windowSize: number = 50,
): number {
  const trades = allTrades.slice(-windowSize);
  if (trades.length < 10) return 0;

  // 1. Price acceleration: 2-я производная
  const priceChanges: number[] = [];
  for (let i = 1; i < trades.length; i++) {
    priceChanges.push(trades[i].price - trades[i - 1].price);
  }
  const halfLen = Math.floor(priceChanges.length / 2);
  const firstHalf = priceChanges.slice(0, halfLen);
  const secondHalf = priceChanges.slice(halfLen);
  const vel1 = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const vel2 = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  const acceleration = Math.abs(vel2) > EPS && Math.abs(vel1) > EPS 
    ? Math.min(1, Math.abs(vel2) / (Math.abs(vel1) + EPS)) 
    : 0;
  // Stricter: acceleration > 2.0 is real push, 1.5 is normal MOEX volatility
  const priceAccelScore = acceleration > 2.0 ? Math.min(1, (acceleration - 1.5) / 2.5) : 0;

  // 2. Tick rule dominance
  const buyCount = trades.filter(t => t.direction === 'BUY').length;
  const sellCount = trades.filter(t => t.direction === 'SELL').length;
  const tickDominance = Math.max(buyCount, sellCount) / (buyCount + sellCount);
  const tickScore = tickDominance > PREDATOR_TICK_DOMINANCE 
    ? (tickDominance - 0.5) * 2 
    : 0;

  // 3. Delta spike (normalized)
  const cumDeltaAbs = Math.abs(cumDelta.delta);
  const totalVol = trades.reduce((s, t) => s + t.quantity, 0);
  const avgTradeSize = totalVol / trades.length;
  const normalizedDelta = avgTradeSize > 0 ? cumDeltaAbs / (avgTradeSize * 10) : 0;
  const deltaSpikeScore = normalizedDelta > PREDATOR_DELTA_DIVERGENCE * 1.5 
    ? Math.min(1, normalizedDelta / 5) 
    : 0;

  const pushScore = (priceAccelScore * 0.3 + tickScore * 0.4 + deltaSpikeScore * 0.3);
  return Math.min(1, pushScore);
}

// ─── ABSORPTION — поглощение встречного потока ────────────────────────────────

function detectAbsorption(
  allTrades: Array<{ price: number; quantity: number; direction: string; timestamp: number }>,
  cumDelta: { delta: number },
  midPrice: number, atr: number, windowSize: number = 50,
): number {
  const trades = allTrades.slice(-windowSize);
  if (trades.length < 10) return 0;

  // 1. Volume spike no move: объём > 2× средний, но цена почти не меняется
  const avgVolume = trades.reduce((s, t) => s + t.quantity, 0) / trades.length;
  const maxVolume = Math.max(...trades.map(t => t.quantity));
  const volumeSpike = maxVolume > avgVolume * PREDATOR_VOLUME_SPIKE;

  const priceRange = Math.max(...trades.map(t => t.price)) - Math.min(...trades.map(t => t.price));
  const noMove = priceRange < 0.3 * atr;

  const volSpikeNoMoveScore = (volumeSpike && noMove) ? Math.min(1, maxVolume / (avgVolume * 5)) : 0;

  // 2. Direction flip (покупка→продажа или наоборот за последние 20% окна)
  const recentTrades = trades.slice(-Math.floor(trades.length * 0.2));
  const earlyTrades = trades.slice(0, Math.floor(trades.length * 0.8));
  const earlyBuy = earlyTrades.filter(t => t.direction === 'BUY').length;
  const earlySell = earlyTrades.filter(t => t.direction === 'SELL').length;
  const recentBuy = recentTrades.filter(t => t.direction === 'BUY').length;
  const recentSell = recentTrades.filter(t => t.direction === 'SELL').length;

  const earlyDir = earlyBuy > earlySell ? 1 : (earlySell > earlyBuy ? -1 : 0);
  const recentDir = recentBuy > recentSell ? 1 : (recentSell > recentBuy ? -1 : 0);
  
  const earlyDominance = Math.abs(earlyBuy - earlySell) / (earlyBuy + earlySell);
  const recentDominance = Math.abs(recentBuy - recentSell) / (recentBuy + recentSell);
  // Gradient deltaReversal: 0-1 proportional to dominance strength in each period
  const deltaReversal = earlyDominance > 0.2 && recentDominance > 0.2 
    && earlyDir !== 0 && recentDir !== 0 && earlyDir !== recentDir 
    ? Math.min(1, (earlyDominance + recentDominance) / 2) 
    : 0;

  // 3. Spread pattern (если есть orderbook — проверить спред)
  let spreadCollapse = 0;
  if (allTrades.length >= 2) {
    const recentPrice = allTrades[allTrades.length - 1].price;
    const prevPrice = allTrades[allTrades.length - 2].price;
    const priceChange = Math.abs(recentPrice - prevPrice);
    spreadCollapse = priceChange < 0.1 * atr ? 0.5 : 0;
  }

  const absorptionScore = (volSpikeNoMoveScore * 0.4 + deltaReversal * 0.4 + spreadCollapse * 0.2);
  return Math.min(1, absorptionScore);
}

// ─── Главный детектор ────────────────────────────────────────────────────────

export function detectPredator(input: DetectorInput): DetectorResult {
  const { ticker, trades, recentTrades, cumDelta, ofi } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // Soft tradeWeight вместо hard cutoff
  const allTrades = trades && trades.length > 0 ? trades : (recentTrades || []);
  const nTrades = allTrades.length;
  const tradeWeight = nTrades >= PREDATOR_ABSOLUTE_MIN_TRADES
    ? Math.min(1, nTrades / PREDATOR_MIN_TRADES)
    : 0;
  
  if (nTrades < PREDATOR_ABSOLUTE_MIN_TRADES) {
    metadata.insufficientData = true;
    metadata.guardTriggered = 'insufficient_trades';
  }
  metadata.tradeWeight = Math.round(tradeWeight * 1000) / 1000;
  metadata.nTrades = nTrades;

  // ATR calculation
  const { atr, atrPct, midPrice } = getATR(input);
  metadata.atr = Math.round(atr * 1000) / 1000;
  metadata.atrPct = Math.round(atrPct * 1000) / 1000;
  metadata.currentPrice = allTrades.length > 0 ? allTrades[allTrades.length - 1].price : 0;

  // Stale weight
  let staleWeight = 1;
  if (input.staleData && input.staleMinutes) {
    staleWeight = stalePenalty(input.staleMinutes);
    if (input.staleMinutes > 240) {
      metadata.guardTriggered = 'stale_data';
    }
  }
  metadata.staleWeight = Math.round(staleWeight * 1000) / 1000;
  metadata.staleMinutes = input.staleMinutes ?? 0;

  // Calculate three signals
  const accumulateScore = detectAccumulate(allTrades, cumDelta, midPrice, atr);
  const pushScore = detectPush(allTrades, cumDelta, atr);
  const absorptionScore = detectAbsorption(allTrades, cumDelta, midPrice, atr);

  // ─── Финальная композиция ────────────────────────────────────────────
  // Weighted sum: хищник = сочетание сигналов, не любой один
  const baseScore = accumulateScore * 0.4 + pushScore * 0.35 + absorptionScore * 0.25;

  // Confluence: минимум 2 компонента для ненулевого score
  const concurrent = [
    accumulateScore > 0.05,
    pushScore > 0.05,
    absorptionScore > 0.05
  ].filter(Boolean).length;

  const confluenceFactor = concurrent >= 2 ? 1.0 : 0;

  let rawScore = baseScore * confluenceFactor * tradeWeight * staleWeight;

  // Soft floor (как HAWKING) — подавление микрошума без разрыва градиента
  const afterClamp = clampScore(rawScore);
  const score = afterClamp < 0.012 ? 0 : afterClamp;

  // Metadata
  metadata.accumulate = Math.round(accumulateScore * 1000) / 1000;
  metadata.push = Math.round(pushScore * 1000) / 1000;
  metadata.absorption = Math.round(absorptionScore * 1000) / 1000;
  metadata.concurrent = concurrent;
  metadata.confluenceFactor = confluenceFactor;
  metadata.rawScoreBeforeFloor = Math.round(rawScore * 1000) / 10000;

  // Диагностика priceStallFactor (пересчёт на окне для metadata, без изменения логики детектора)
  const diagPrices = allTrades.slice(-50).map(t => t.price);
  const diagRange = Math.max(...diagPrices) - Math.min(...diagPrices);
  const priceStallFactor = Math.max(0, 1 - (diagRange / (0.5 * atr)));
  metadata.priceStallFactor = Math.round(priceStallFactor * 100) / 100;
  metadata.concurrent = concurrent;
  metadata.rawScoreAfterMultiply = Math.round(rawScore * 1000) / 1000;

  // Signal direction
  let signalDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.3) {
    // Use cumDelta direction
    if (cumDelta.delta > 0) signalDirection = 'BULLISH';
    else if (cumDelta.delta < 0) signalDirection = 'BEARISH';
  }

  const confidence = score > 0.3 ? Math.min(1, score * 1.2) : 0;

  return {
    detector: 'PREDATOR',
    description: `Хищник — stateless v4.2 (ACCUMULATE ${accumulateScore.toFixed(2)}, PUSH ${pushScore.toFixed(2)}, ABSORPTION ${absorptionScore.toFixed(2)})`,
    score,
    confidence,
    signal: signalDirection,
    metadata,
  };
}

// ─── Reset function (no-op для compatibility) ────────────────────────────────

export function resetPredatorState(_ticker?: string): void {
  // Stateless — nothing to reset
}