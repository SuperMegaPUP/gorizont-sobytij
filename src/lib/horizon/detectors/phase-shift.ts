// ─── PHASE SHIFT v2 (Q-3) ────────────────────────────────────────────────
// Интеграция PREDATOR + Cancel% для определения перехода фазы
//
// v2: Использует PREDATOR score + Cancel% для определения phase transitions
// Формула: phaseShift = PREDATOR_delta × Cancel%_delta
//   - PREDATOR растёт + Cancel% падает → фаза накопления
//   - PREDATOR падает + Cancel% растёт → фаза распределения

import type { DetectorInput, DetectorResult } from './types';

export interface PhaseShiftConfig {
  predatorWeight: number;
  cancelWeight: number;
  threshold: number;
}

export const PHASE_SHIFT_DEFAULT_CONFIG: PhaseShiftConfig = {
  predatorWeight: 0.6,
  cancelWeight: 0.4,
  threshold: 0.15,
};

export interface PhaseShiftResult {
  phaseShiftActive: boolean;
  phase: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
  shiftScore: number;
  predatorDelta: number;
  cancelDelta: number;
}

/**
 * Q-3: Detect phase shift using PREDATOR + Cancel%
 * @param predatorScore - текущий PREDATOR score
 * @param prevPredatorScore - PREDATOR score на предыдущем слоте
 * @param cancelPct - текущий Cancel%
 * @param prevCancelPct - Cancel% на предыдущем слоте
 */
export function detectPhaseShift(
  predatorScore: number,
  prevPredatorScore: number,
  cancelPct: number,
  prevCancelPct: number,
  config: PhaseShiftConfig = PHASE_SHIFT_DEFAULT_CONFIG
): PhaseShiftResult {
  // Calculate deltas
  const predatorDelta = predatorScore - prevPredatorScore;
  const cancelDelta = cancelPct - prevCancelPct;

  // Phase shift score: combining both indicators
  // Positive = accumulation (predator up, cancel down)
  // Negative = distribution (predator down, cancel up)
  const shiftScore = config.predatorWeight * predatorDelta + config.cancelWeight * cancelDelta;

  // Determine phase
  let phase: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL' = 'NEUTRAL';
  let phaseShiftActive = false;

  if (Math.abs(shiftScore) > config.threshold) {
    phaseShiftActive = true;
    phase = shiftScore > 0 ? 'ACCUMULATION' : 'DISTRIBUTION';
  }

  return {
    phaseShiftActive,
    phase,
    shiftScore: Math.round(shiftScore * 1000) / 1000,
    predatorDelta: Math.round(predatorDelta * 1000) / 1000,
    cancelDelta: Math.round(cancelDelta * 1000) / 1000,
  };
}

/**
 * Detect PHASE_SHIFT from DetectorInput
 * Uses metadata from previous calls (in real flow, state is stored externally)
 */
export function detectPhaseShiftFromInput(
  input: DetectorInput,
  prevPredatorScore: number = 0,
  prevCancelPct: number = 0.9
): DetectorResult {
  // Get PREDATOR score from metadata if available
  const predatorScore = (input as any).predatorScore || 0;

  // For Cancel%, we'd need it from orderbook analysis
  // Using placeholder - in real integration, get from state manager
  const cancelPct = 0.9;

  const result = detectPhaseShift(predatorScore, prevPredatorScore, cancelPct, prevCancelPct);

  return {
    detector: 'PHASE_SHIFT',
    description: result.phaseShiftActive
      ? `PHASE_SHIFT ${result.phase} — predΔ=${result.predatorDelta.toFixed(2)}, cancelΔ=${result.cancelDelta.toFixed(2)}`
      : 'PHASE_SHIFT — нейтрально',
    score: result.phaseShiftActive ? Math.abs(result.shiftScore) : 0,
    confidence: result.phaseShiftActive ? 0.6 : 0,
    signal: result.phase === 'ACCUMULATION' ? 'BULLISH' : result.phase === 'DISTRIBUTION' ? 'BEARISH' : 'NEUTRAL',
    metadata: {
      shiftScore: result.shiftScore,
      phase: result.phase,
      predatorDelta: result.predatorDelta,
      cancelDelta: result.cancelDelta,
    },
  };
}