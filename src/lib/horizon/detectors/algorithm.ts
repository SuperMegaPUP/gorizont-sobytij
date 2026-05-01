// ─── ALGORITHM DETECTOR (Q-12) ───────────────────────────────────────────
// Detects algorithmic reset - robot volume drop followed by recovery
// Pattern: robotVol 77% → 30% (reset) → new cycle start
//
// Use cases:
//   - GAZP: robotVol 77%→30% indicates robot reset before new cycle
//   - Detects when algorithmic traders are reinitializing
//   - Predicts next robot wave
//
// Formula: score = dropScore × 0.5 + recoveryScore × 0.3 + timingScore × 0.2

import type { DetectorInput, DetectorResult } from './types';
import { clampScore, stalePenalty } from './guards';
import { createStateStore, IStateStore } from '../state/factory';

const ALGORITHM_MIN_TRADES = 15;
const ALGORITHM_ABSOLUTE_MIN = 8;
const RESET_THRESHOLD = 0.4; // 40% drop triggers reset detection
const RECOVERY_THRESHOLD = 0.5; // 50% recovery signals new cycle
const STATE_KEY_PREFIX = 'horizon:algo:robotvol:';

// ─── Calculate robot volume from trades ───────────────────────────────────
// Estimate robot volume percentage from trade patterns
function estimateRobotVolume(
  trades: Array<{ price: number; quantity: number; direction?: string; timestamp?: number }>
): { robotVol: number; totalVol: number; nTrades: number } {
  if (trades.length < 3) return { robotVol: 0, totalVol: 0, nTrades: 0 };

  // Heuristics for robot detection:
  // 1. Very regular intervals (same time between trades)
  // 2. Round lot sizes (exactly 1, 10, 100, 1000)
  // 3. Same direction pattern (all BUY or all SELL)
  // 4. No price variation despite volume

  let totalVolume = 0;
  let robotVolume = 0;
  const timestamps = trades.map(t => t.timestamp || 0).filter(t => t > 0);

  // Check time regularity
  let regularIntervals = 0;
  if (timestamps.length >= 3) {
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, d) => sum + Math.pow(d - avgInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    // Low std dev = regular intervals = likely robot
    if (avgInterval > 0 && stdDev / avgInterval < 0.2) {
      regularIntervals = 1;
    }
  }

  // Check lot sizes
  let roundLots = 0;
  for (const t of trades) {
    totalVolume += t.quantity;
    const q = t.quantity;
    // Round lots: 1, 10, 100, 1000, etc.
    if (q > 0 && Math.log10(q) % 1 === 0) {
      roundLots++;
      robotVolume += q;
    }
  }

  // Check direction consistency
  let buyCount = 0, sellCount = 0;
  for (const t of trades) {
    const dir = (t.direction || '').toUpperCase();
    if (dir.includes('BUY') || dir === 'B' || dir === '1') buyCount++;
    else if (dir.includes('SELL') || dir === 'S' || dir === '-1') sellCount++;
  }
  const directionConsistency = Math.max(buyCount, sellCount) / (buyCount + sellCount || 1);

  // Combined robot score
  const robotScore = (regularIntervals * 0.3) + (roundLots / trades.length * 0.4) + (directionConsistency * 0.3);
  const estimatedRobotVol = totalVolume * robotScore;

  return {
    robotVol: estimatedRobotVol,
    totalVol: totalVolume,
    nTrades: trades.length,
  };
}

// ─── Detect Reset Pattern ───────────────────────────────────────────────
// Detect drop in robot volume followed by potential recovery
function detectResetPattern(
  currentRobotVol: number,
  previousRobotVol: number
): { dropScore: number; isReset: boolean; dropPct: number } {
  if (previousRobotVol <= 0) return { dropScore: 0, isReset: false, dropPct: 0 };

  const dropPct = 1 - (currentRobotVol / previousRobotVol);

  // Reset detected when volume drops significantly
  const isReset = dropPct > RESET_THRESHOLD;
  const dropScore = isReset ? Math.min(1, dropPct) : 0;

  return { dropScore, isReset, dropPct };
}

// ─── Detect Recovery Pattern ─────────────────────────────────────────────
// Detect when robot volume starts recovering (new cycle start)
function detectRecovery(
  currentRobotVol: number,
  resetLevel: number
): { recoveryScore: number; isRecovering: boolean } {
  if (resetLevel <= 0) return { recoveryScore: 0, isRecovering: false };

  const recoveryPct = currentRobotVol / resetLevel;
  const isRecovering = recoveryPct > RECOVERY_THRESHOLD;
  const recoveryScore = isRecovering ? Math.min(1, recoveryPct) : 0;

  return { recoveryScore, isRecovering };
}

// ─── Main Detector ───────────────────────────────────────────────────────

export async function detectAlgorithm(input: DetectorInput): Promise<DetectorResult> {
  const { ticker, trades, recentTrades, orderbook } = input;
  const metadata: Record<string, number | string | boolean> = {};

  const allTrades = trades && trades.length > 0 ? trades : (recentTrades || []);
  const nTrades = allTrades.length;

  const tradeWeight = nTrades >= ALGORITHM_ABSOLUTE_MIN
    ? Math.min(1, nTrades / ALGORITHM_MIN_TRADES)
    : 0;

  if (nTrades < ALGORITHM_ABSOLUTE_MIN) {
    metadata.insufficientData = true;
    metadata.guardTriggered = 'insufficient_trades';
  }
  metadata.nTrades = nTrades;

  // Stale weight
  let staleWeight = 1;
  if (input.staleData && input.staleMinutes) {
    staleWeight = stalePenalty(input.staleMinutes);
    if (input.staleMinutes > 240) {
      metadata.guardTriggered = 'stale_data';
    }
  }
  metadata.staleWeight = Math.round(staleWeight * 1000) / 1000;

  // Estimate current robot volume
  const { robotVol, totalVol } = estimateRobotVolume(allTrades);
  const currentRobotPct = totalVol > 0 ? robotVol / totalVol : 0;

  metadata.currentRobotVol = Math.round(robotVol);
  metadata.totalVolume = totalVol;
  metadata.robotVolPct = Math.round(currentRobotPct * 1000) / 1000;

  // Try to get previous robot volume from state store
  let stateStore: IStateStore | null = null;
  let previousRobotVol = 0;
  let resetLevel = 0;
  let isReset = false;
  let dropScore = 0;
  let dropPct = 0;
  let recoveryScore = 0;
  let isRecovering = false;

  try {
    stateStore = createStateStore();
    const stateKey = `${STATE_KEY_PREFIX}${ticker}`;

    // Get previous robot volume
    const prevData = await stateStore.get(stateKey);
    if (prevData) {
      const prevState = JSON.parse(prevData);
      previousRobotVol = prevState.robotVol || 0;
      resetLevel = prevState.resetLevel || 0;

      // Detect reset pattern
      const resetResult = detectResetPattern(currentRobotPct, previousRobotVol);
      dropScore = resetResult.dropScore;
      isReset = resetResult.isReset;
      dropPct = resetResult.dropPct;

      // Detect recovery
      const recoveryResult = detectRecovery(currentRobotPct, resetLevel);
      recoveryScore = recoveryResult.recoveryScore;
      isRecovering = recoveryResult.isRecovering;
    }

    // Save current state
    const newResetLevel = isReset ? currentRobotPct : (resetLevel > 0 ? resetLevel : currentRobotPct);
    await stateStore.set(stateKey, JSON.stringify({
      robotVol: currentRobotPct,
      resetLevel: newResetLevel,
      timestamp: Date.now(),
    }), 3600); // 1 hour TTL

  } catch (e) {
    // State store not available - cannot detect reset pattern
    metadata.stateStoreError = true;
  }

  // Timing score: recent reset is more relevant
  const timingScore = isReset ? 0.5 : (isRecovering ? 0.8 : 0);

  // Combined score
  const baseScore = dropScore * 0.5 + recoveryScore * 0.3 + timingScore * 0.2;

  // Confidence based on multiple factors
  const signals = [dropScore > 0.1, recoveryScore > 0.1, isReset].filter(Boolean).length;
  const confidence = signals >= 2 ? Math.min(0.8, baseScore * 1.5) : 0;

  const rawScore = baseScore * tradeWeight * staleWeight;
  const score = clampScore(rawScore);

  // Direction: recovering = same as original, reset = NEUTRAL
  let signalDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (isRecovering) {
    signalDirection = 'BULLISH'; // Robot activity returning = new cycle
  }

  // Metadata
  metadata.previousRobotVol = previousRobotVol;
  metadata.dropScore = Math.round(dropScore * 1000) / 1000;
  metadata.isReset = isReset;
  metadata.dropPct = Math.round(dropPct * 1000) / 1000;
  metadata.recoveryScore = Math.round(recoveryScore * 1000) / 1000;
  metadata.isRecovering = isRecovering;
  metadata.resetLevel = Math.round(resetLevel * 1000) / 1000;
  metadata.timingScore = Math.round(timingScore * 1000) / 1000;
  metadata.signals = signals;

  return {
    detector: 'ALGORITHM',
    description: score > 0.1
      ? isRecovering
        ? `Алгоритм — сброс найден ${(dropPct * 100).toFixed(0)}%, восстановление ${(currentRobotPct / resetLevel * 100).toFixed(0)}%`
        : `Алгоритм — сброс ${(dropPct * 100).toFixed(0)}%, ожидание восстановления`
      : 'Алгоритм — паттерн сброса не обнаружен',
    score,
    confidence,
    signal: signalDirection,
    metadata,
  };
}