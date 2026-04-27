// ─── PREDATOR — Хищник v4.2 ────────────────────────────────────────────────
// 5-фазный автомат обнаружения stop-hunting:
//   IDLE → STALK → HERDING → ATTACK → [CONSUME | FALSE_BREAKOUT → AWAIT → IDLE]
//
// v4.2 Формула:
//   STALK:  |price - stop_level| < 1.5 × ATR(14)         // К1: БЕЗ /100!
//   HERDING: n_small/n_total > 0.6 AND avg_size < 0.3 × median_value
//   ATTACK: aggression_ratio > 2.0 AND |Δprice| > 2×ATR AND cumDelta_accel > 0
//   CONSUME: reversion ≥ threshold AND delta_flip
//   FALSE_BREAKOUT: reversion < threshold OR !delta_flip
//
//   aggression_ratio = aggressive_volume / total_volume
//   delta_flip через FLOW z-scored (|zDelta| > 1.5)
//   reversion_threshold = max(0.3, min(0.7, 0.5×(1 - ATR_pct/0.05)))
//   window_confirm = [2, 10] мин

import type { DetectorInput, DetectorResult } from './types';
import { clampScore, stalePenalty, safeDivide } from './guards';

const EPS = 1e-6;

// ─── Фазы ───────────────────────────────────────────────────────────────────
enum PredatorPhase {
  IDLE           = 'IDLE',
  STALK          = 'STALK',
  HERDING        = 'HERDING',
  ATTACK         = 'ATTACK',
  CONSUME        = 'CONSUME',
  FALSE_BREAKOUT = 'FALSE_BREAKOUT',
  AWAIT          = 'AWAIT',
}

// ─── Таймауты ───────────────────────────────────────────────────────────────
const STALK_TIMEOUT_MS   = 30 * 60 * 1000;
const HERDING_TIMEOUT_MS = 15 * 60 * 1000;
const ATTACK_TIMEOUT_MS  =  5 * 60 * 1000;
const AWAIT_TIMEOUT_MS   = 10 * 60 * 1000;

// ─── Пороги ─────────────────────────────────────────────────────────────────
const MIN_TRADES_FOR_FLOW = 20;
const FLOW_Z_THRESHOLD    = 1.5;
const HERDING_SMALL_RATIO = 0.6;
const HERDING_SIZE_RATIO  = 0.3;
const AGGRESSION_THRESHOLD = 2.0;
const STALK_ATR_MULT      = 1.5;
const ATTACK_ATR_MULT     = 2.0;

// ─── Состояние per ticker ───────────────────────────────────────────────────
interface PredatorState {
  phase: PredatorPhase;
  phaseEntryTime: number;
  attackExtreme: number;
  attackDirection: 'LONG' | 'SHORT' | null;
  preAttackPrice: number;
  cumDeltaAtAttack: number;
  attackStartTime: number;
  priceAtPhaseEntry: number;
  prevCumDelta: number;
  prevCumDeltaVelocity: number;
}

const stateCache = new Map<string, PredatorState>();

function getState(ticker: string): PredatorState {
  if (!stateCache.has(ticker)) {
    stateCache.set(ticker, {
      phase: PredatorPhase.IDLE,
      phaseEntryTime: 0,
      attackExtreme: 0,
      attackDirection: null,
      preAttackPrice: 0,
      cumDeltaAtAttack: 0,
      attackStartTime: 0,
      priceAtPhaseEntry: 0,
      prevCumDelta: 0,
      prevCumDeltaVelocity: 0,
    });
  }
  return stateCache.get(ticker)!;
}

function transitionTo(state: PredatorState, phase: PredatorPhase, now: number): void {
  state.phase = phase;
  state.phaseEntryTime = now;
}

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

// ─── Оценка стоп-уровней ────────────────────────────────────────────────────

function estimatedStops(
  trades: Array<{ price: number; quantity: number; direction: string; timestamp: number }>,
  midPrice: number, atr: number, tickSize: number,
): { bidStops: number[]; askStops: number[] } {
  if (trades.length < 5) return { bidStops: [], askStops: [] };

  const recent = trades.slice(-50);

  // 1. Volume cluster density (0.35)
  const priceMap = new Map<number, number>();
  for (const t of recent) {
    const p = Math.round(t.price / tickSize) * tickSize;
    priceMap.set(p, (priceMap.get(p) || 0) + t.quantity);
  }
  const sorted = [...priceMap.entries()].sort((a, b) => b[1] - a[1]);
  const clusters = sorted.slice(0, 5).map(([p, v]) => ({ price: p, score: 0.35 * safeDivide(v, sorted[0][1], 1) }));

  // 2. Round numbers (0.25)
  const roundLevels = new Set<number>();
  for (let p = Math.floor(midPrice / 5) * 5 - 20; p <= midPrice + 20; p += 5) {
    if (p > 0) roundLevels.add(p);
  }
  for (let p = Math.floor(midPrice / 10) * 10 - 50; p <= midPrice + 50; p += 10) {
    if (p > 0) roundLevels.add(p);
  }

  // 3. Recent breakouts (0.25)
  const breakouts: number[] = [];
  for (let i = 1; i < Math.min(recent.length, 20); i++) {
    const move = recent[i].price - recent[i - 1].price;
    if (Math.abs(move) > 1.5 * atr) breakouts.push(recent[i].price);
  }

  // 4. VWAP distance penalty (0.15)
  let vwapNum = 0, vwapDen = 0;
  for (const t of recent) { vwapNum += t.price * t.quantity; vwapDen += t.quantity; }
  const vwap = vwapDen > EPS ? vwapNum / vwapDen : midPrice;

  // Combine
  const candidates = new Map<number, number>();
  for (const c of clusters) candidates.set(c.price, (candidates.get(c.price) || 0) + c.score);
  for (const p of roundLevels) candidates.set(p, (candidates.get(p) || 0) + 0.25);
  for (const p of breakouts) candidates.set(Math.round(p / tickSize) * tickSize, (candidates.get(Math.round(p / tickSize) * tickSize) || 0) + 0.25);
  for (const [p, s] of candidates) {
    const dist = Math.abs(p - vwap);
    candidates.set(p, s + 0.15 * Math.max(0, 1 - dist / (3 * atr)));
  }

  const bidStops: number[] = [];
  const askStops: number[] = [];
  for (const [p, s] of candidates) {
    if (s < 0.3) continue;
    if (p < midPrice) bidStops.push(p);
    if (p > midPrice) askStops.push(p);
  }
  return { bidStops, askStops };
}

// ─── Триггеры фаз ───────────────────────────────────────────────────────────

function checkStalk(
  price: number, stops: { bidStops: number[]; askStops: number[] }, atr: number,
): { triggered: boolean; direction: 'LONG' | 'SHORT' | null } {
  for (const s of stops.bidStops) {
    if (price > s && (price - s) < STALK_ATR_MULT * atr) return { triggered: true, direction: 'LONG' };
  }
  for (const s of stops.askStops) {
    if (s > price && (s - price) < STALK_ATR_MULT * atr) return { triggered: true, direction: 'SHORT' };
  }
  return { triggered: false, direction: null };
}

function checkHerding(
  trades: Array<{ price: number; quantity: number; direction: string; timestamp: number }>,
  medianTradeValue: number,
): boolean {
  const recent = trades.slice(-30);
  if (recent.length < 10) return false;
  const values = recent.map(t => t.price * t.quantity);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const nSmall = values.filter(v => v < HERDING_SIZE_RATIO * medianTradeValue).length;
  return (nSmall / values.length > HERDING_SMALL_RATIO) && (avg < HERDING_SIZE_RATIO * medianTradeValue);
}

function checkAttack(
  cumDelta: { delta: number; buyVolume: number; sellVolume: number },
  atr: number, state: PredatorState, currPrice: number,
): boolean {
  // БАГ 1 FIX: aggression_ratio = max(buy,sell) / min(buy,sell)
  const minVol = Math.min(cumDelta.buyVolume, cumDelta.sellVolume);
  const aggRatio = minVol > EPS
    ? Math.max(cumDelta.buyVolume, cumDelta.sellVolume) / minVol
    : (cumDelta.buyVolume + cumDelta.sellVolume > 0 ? 100 : 0);
  if (aggRatio <= AGGRESSION_THRESHOLD) return false;

  // БАГ 4 FIX: price_change относительно входа в фазу, не 1 тик
  const priceChange = Math.abs(currPrice - state.priceAtPhaseEntry);
  if (priceChange <= ATTACK_ATR_MULT * atr) return false;

  // БАГ 2 FIX: cumDelta_accel > 0 (вторая производная)
  const cumDeltaVelocity = cumDelta.delta - state.prevCumDelta;
  const cumDeltaAccel = cumDeltaVelocity - state.prevCumDeltaVelocity;
  if (cumDeltaAccel <= 0) return false;

  // Update history for next tick
  state.prevCumDeltaVelocity = cumDeltaVelocity;
  state.prevCumDelta = cumDelta.delta;
  return true;
}

function checkDeltaFlip(
  trades: Array<{ price: number; quantity: number; direction: string; timestamp: number }>,
  attackStartTime: number,
  cumDeltaNow: number, cumDeltaAtAttack: number,
): { flipped: boolean; zDelta: number } {
  const flowDuring = cumDeltaNow - cumDeltaAtAttack;
  const afterTrades = trades.filter(t => t.timestamp >= attackStartTime);

  if (afterTrades.length < 2) {
    return { flipped: false, zDelta: 0 };
  }

  // БАГ 3 FIX: периодические flow-наблюдения (5-сек интервалы), не cumulative
  const FLOW_INTERVAL_MS = 5000;
  const intervalFlows = new Map<number, number>();
  for (const t of afterTrades) {
    const intervalIdx = Math.floor((t.timestamp - attackStartTime) / FLOW_INTERVAL_MS);
    const delta = t.direction === 'BUY' ? t.quantity : -t.quantity;
    intervalFlows.set(intervalIdx, (intervalFlows.get(intervalIdx) || 0) + delta);
  }

  const flowObservations = [...intervalFlows.values()];
  const lastInterval = Math.max(...intervalFlows.keys());
  const flowAfter = intervalFlows.get(lastInterval) || 0;

  if (flowObservations.length >= MIN_TRADES_FOR_FLOW) {
    const meanFlow = flowObservations.reduce((s, v) => s + v, 0) / flowObservations.length;
    const stdFlow = Math.sqrt(
      flowObservations.reduce((s, v) => s + (v - meanFlow) ** 2, 0) / flowObservations.length
    );
    const zDelta = stdFlow > EPS ? (flowAfter - meanFlow) / stdFlow : 0;
    const flipped = Math.abs(zDelta) > FLOW_Z_THRESHOLD
      && Math.sign(flowAfter) !== Math.sign(flowDuring)
      && Math.sign(flowDuring) !== 0;
    return { flipped, zDelta };
  }

  const flipped = Math.sign(flowAfter) !== Math.sign(flowDuring) && Math.sign(flowDuring) !== 0;
  return { flipped, zDelta: 0 };
}

function reversionThreshold(atrPct: number): number {
  return Math.max(0.3, Math.min(0.7, 0.5 * (1 - atrPct / 0.05)));
}

function windowConfirmMin(atr: number, price: number): number {
  return Math.max(2, Math.min(10, 3 * atr / Math.max(price * 0.001, EPS)));
}

// ─── Главный детектор ───────────────────────────────────────────────────────

export function detectPredator(input: DetectorInput): DetectorResult {
  const { ticker, trades, cumDelta, ofi } = input;
  const metadata: Record<string, number | string | boolean> = {};

  const allTrades = trades && trades.length > 0 ? trades : [];
  if (allTrades.length < 20) {
    return zeroResult('недостаточно сделок', { n_trades: allTrades.length });
  }

  // Stale guard
  if (input.staleData) {
    const staleFactor = stalePenalty(input.staleMinutes);
    if (staleFactor <= 0) {
      return zeroResult('устаревшие данные', { staleData: true });
    }
  }

  const { atr, atrPct, midPrice } = getATR(input);
  const tickSize = estimateTickSize(midPrice);
  const currentPrice = allTrades[allTrades.length - 1].price;

  metadata.atr = Math.round(atr * 1000) / 1000;
  metadata.atrPct = Math.round(atrPct * 1000) / 1000;
  metadata.currentPrice = currentPrice;

  // Estimated stops
  const stops = estimatedStops(allTrades, midPrice, atr, tickSize);
  metadata.nBidStops = stops.bidStops.length;
  metadata.nAskStops = stops.askStops.length;

  // Herding context
  const values = allTrades.slice(-30).map(t => t.price * t.quantity);
  const medianValue = values.length > 0
    ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
    : 0;
  const herding = checkHerding(allTrades, medianValue);
  metadata.herding = herding;

  // State machine
  const state = getState(ticker);
  const now = Date.now();
  let predatorScore = 0;
  let signalDirection: 'LONG' | 'SHORT' | null = null;
  metadata.phase = state.phase;

  switch (state.phase) {
    case PredatorPhase.IDLE: {
      const stalk = checkStalk(currentPrice, stops, atr);
      if (stalk.triggered) {
        state.priceAtPhaseEntry = currentPrice;
        transitionTo(state, PredatorPhase.STALK, now);
        signalDirection = stalk.direction;
        metadata.phaseTransition = 'IDLE→STALK';
      }
      break;
    }

    case PredatorPhase.STALK: {
      if (now - state.phaseEntryTime > STALK_TIMEOUT_MS) {
        transitionTo(state, PredatorPhase.IDLE, now);
        metadata.phaseTransition = 'STALK→IDLE (timeout)';
        break;
      }
      if (herding) {
        state.priceAtPhaseEntry = currentPrice;
        transitionTo(state, PredatorPhase.HERDING, now);
        metadata.phaseTransition = 'STALK→HERDING';
        break;
      }
      // Прямой переход STALK → ATTACK (агрессия без предварительного HERDING)
      if (checkAttack(cumDelta, atr, state, currentPrice)) {
        enterAttack(state, now, state.priceAtPhaseEntry, cumDelta.delta, currentPrice);
        metadata.phaseTransition = 'STALK→ATTACK';
      }
      break;
    }

    case PredatorPhase.HERDING: {
      if (now - state.phaseEntryTime > HERDING_TIMEOUT_MS) {
        transitionTo(state, PredatorPhase.IDLE, now);
        metadata.phaseTransition = 'HERDING→IDLE (timeout)';
        break;
      }
      if (checkAttack(cumDelta, atr, state, currentPrice)) {
        enterAttack(state, now, state.priceAtPhaseEntry, cumDelta.delta, currentPrice);
        metadata.phaseTransition = 'HERDING→ATTACK';
      }
      break;
    }

    case PredatorPhase.ATTACK: {
      if (now - state.phaseEntryTime > ATTACK_TIMEOUT_MS) {
        transitionTo(state, PredatorPhase.FALSE_BREAKOUT, now);
        metadata.phaseTransition = 'ATTACK→FALSE_BREAKOUT (timeout)';
        break;
      }
      // Update extreme
      if (state.attackDirection === 'LONG' && currentPrice < state.attackExtreme) {
        state.attackExtreme = currentPrice;
      }
      if (state.attackDirection === 'SHORT' && currentPrice > state.attackExtreme) {
        state.attackExtreme = currentPrice;
      }

      // Check CONSUME conditions
      const revThreshold = reversionThreshold(atrPct);
      const winMin = windowConfirmMin(atr, midPrice);
      metadata.reversionThreshold = Math.round(revThreshold * 1000) / 1000;
      metadata.windowConfirmMin = Math.round(winMin * 100) / 100;

      const preAttack = state.preAttackPrice;
      const extreme = state.attackExtreme;
      const denom = Math.max(Math.abs(preAttack - extreme), 0.5 * tickSize);
      const reversion = Math.abs(currentPrice - extreme) / denom;
      metadata.priceReversion = Math.round(reversion * 1000) / 1000;

      const deltaFlip = checkDeltaFlip(allTrades, state.attackStartTime, cumDelta.delta, state.cumDeltaAtAttack);
      metadata.deltaFlip = deltaFlip.flipped;
      metadata.zDelta = Math.round(deltaFlip.zDelta * 100) / 100;

      if (reversion >= revThreshold && deltaFlip.flipped) {
        transitionTo(state, PredatorPhase.CONSUME, now);
        signalDirection = state.attackDirection;
        metadata.phaseTransition = 'ATTACK→CONSUME';
        predatorScore = 0.8 + 0.2 * Math.min(1, reversion);
      } else if (reversion < revThreshold || !deltaFlip.flipped) {
        // Check timeout or immediate false breakout
        const elapsedMin = (now - state.phaseEntryTime) / 60000;
        if (elapsedMin >= winMin) {
          transitionTo(state, PredatorPhase.FALSE_BREAKOUT, now);
          metadata.phaseTransition = 'ATTACK→FALSE_BREAKOUT';
        }
      }
      break;
    }

    case PredatorPhase.CONSUME: {
      predatorScore = 0.9;
      signalDirection = state.attackDirection;
      if (now - state.phaseEntryTime > 2 * 60 * 1000) {
        transitionTo(state, PredatorPhase.AWAIT, now);
        metadata.phaseTransition = 'CONSUME→AWAIT';
      }
      break;
    }

    case PredatorPhase.FALSE_BREAKOUT: {
      predatorScore = 0;
      if (now - state.phaseEntryTime > 5 * 60 * 1000) {
        transitionTo(state, PredatorPhase.AWAIT, now);
        metadata.phaseTransition = 'FALSE_BREAKOUT→AWAIT';
      }
      break;
    }

    case PredatorPhase.AWAIT: {
      predatorScore = 0;
      if (now - state.phaseEntryTime > AWAIT_TIMEOUT_MS) {
        transitionTo(state, PredatorPhase.IDLE, now);
        metadata.phaseTransition = 'AWAIT→IDLE';
      }
      break;
    }
  }

  const score = clampScore(predatorScore);
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (signalDirection === 'LONG' && score > 0.5) signal = 'BULLISH';
  else if (signalDirection === 'SHORT' && score > 0.5) signal = 'BEARISH';

  const confidence = score > 0.5 ? Math.min(1, score) : 0;
  const staleFactor = input.staleData ? stalePenalty(input.staleMinutes) : 1;

  return {
    detector: 'PREDATOR',
    description: `Хищник — stop-hunting (${state.phase} v4.2)`,
    score: clampScore(score * staleFactor),
    confidence: clampScore(confidence * staleFactor),
    signal,
    metadata: { ...metadata, staleFactor },
  };
}

function enterAttack(
  state: PredatorState, now: number,
  preAttackPrice: number, cumDeltaNow: number, currentPrice: number,
): void {
  state.preAttackPrice = preAttackPrice;
  state.cumDeltaAtAttack = cumDeltaNow;
  state.attackDirection = currentPrice < preAttackPrice ? 'LONG' : 'SHORT';
  state.attackExtreme = currentPrice;
  state.attackStartTime = now;
  transitionTo(state, PredatorPhase.ATTACK, now);
}

export function resetPredatorState(ticker?: string): void {
  if (ticker) stateCache.delete(ticker);
  else stateCache.clear();
}

function zeroResult(reason: string, extra: Record<string, unknown>): DetectorResult {
  return {
    detector: 'PREDATOR',
    description: `Хищник — stop-hunting (${reason})`,
    score: 0, confidence: 0, signal: 'NEUTRAL',
    metadata: { insufficientData: true, ...extra },
  };
}
