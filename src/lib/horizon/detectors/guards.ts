// guards.ts — Trading phase filter + data quality guards (v4.2)
import type { DetectorResult } from './types';

const EPS = 1e-6;

/**
 * Data quality guards — applied before detector computation.
 * Returns modified DetectorResult if guard triggers, null if detector should proceed.
 *
 * v4.2 Guards:
 * - alphabet < 5 → DECOHERENCE score = 0 (insufficient symbol diversity)
 * - min_trades < 30 → most detectors → 0 (insufficient trade data)
 * - empty_ob → GRAVITON/DARKMATTER → 0 (unless tradeOFI fallback)
 *
 * These guards prevent detectors from hallucinating on sparse data.
 */

export interface GuardInput {
  detector: string;
  trades: Array<{ quantity: number; price: number; direction?: string }>;
  orderbook: { bids: Array<{ price: number; quantity: number }>; asks: Array<{ price: number; quantity: number }> };
  /** Number of unique symbols in DECOHERENCE's alphabet */
  alphabetSize?: number;
  /** Already computed by the detector? */
  skipTradesGuard?: boolean;
  /** Already computed by the detector? */
  skipOBGuard?: boolean;
}

/**
 * Check trading phase guards. Returns null if all guards pass (proceed with detection).
 * Returns a DetectorResult if a guard triggers (return this instead of computing).
 */
export function checkGuards(input: GuardInput): DetectorResult | null {
  const { detector, trades, orderbook, alphabetSize, skipTradesGuard, skipOBGuard } = input;

  // Guard 1: Minimum trades — most detectors need at least 30 trades for meaningful results
  if (!skipTradesGuard && trades.length < 30) {
    // Some detectors have lower thresholds (e.g. ACCRETOR needs 20, HAWKING needs 50)
    // But the general guard is 30 — individual detectors can override with skipTradesGuard
    if (!['ACCRETOR', 'HAWKING'].includes(detector)) {
      return {
        detector,
        description: `${detector} — недостаточно сделок (Trading Phase Filter)`,
        score: 0,
        confidence: 0,
        signal: 'NEUTRAL',
        metadata: { insufficientData: true, guardTriggered: 'min_trades_30', tradeCount: trades.length },
      };
    }
  }

  // Guard 2: DECOHERENCE alphabet size — less than 5 unique symbols = noise
  if (detector === 'DECOHERENCE' && alphabetSize !== undefined && alphabetSize < 5) {
    return {
      detector: 'DECOHERENCE',
      description: 'Декогеренция — недостаточно символов (alphabet < 5)',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata: { insufficientData: true, guardTriggered: 'alphabet_lt_5', alphabetSize },
    };
  }

  // Guard 3: Empty orderbook — GRAVITON/DARKMATTER need OB or tradeOFI
  // NOTE: This guard is already handled by trade-based OFI fallback in those detectors.
  // We don't add it here to avoid double-blocking. The detectors handle empty OB themselves.

  return null; // All guards passed — proceed with detection
}

/**
 * Gradual stale penalty — instead of binary stale→0, reduce score gradually.
 *
 * Logic:
 * - staleMinutes <= 0: no penalty (fresh data)
 * - staleMinutes <= 30: no penalty (acceptable staleness for most detectors)
 * - 30 < staleMinutes <= 60: mild penalty (factor 0.7)
 * - 60 < staleMinutes <= 120: moderate penalty (factor 0.4)
 * - 120 < staleMinutes <= 240: severe penalty (factor 0.15)
 * - staleMinutes > 240: kill (factor 0) — data is from previous session
 *
 * This preserves some signal even from slightly stale data,
 * while preventing hallucination on truly ancient data.
 */
export function stalePenalty(staleMinutes: number | undefined): number {
  if (!staleMinutes || staleMinutes <= 0) return 1;    // fresh
  if (staleMinutes <= 30) return 1;                     // acceptable
  if (staleMinutes <= 60) return 0.7;                   // mild
  if (staleMinutes <= 120) return 0.4;                  // moderate
  if (staleMinutes <= 240) return 0.15;                 // severe
  return 0;                                              // kill — previous session
}

/**
 * Safe division: x / max(y, floor)
 * Replaces the pattern x / (y + EPS) which can produce huge values when y ≈ 0.
 *
 * Example: 0.5 / (0 + 1e-6) = 500,000 ← WRONG
 *          0.5 / Math.max(0, 0.001) = 500 ← CORRECT
 *
 * @param numerator - числитель
 * @param denominator - знаменатель
 * @param floor - минимальное значение знаменателя (default: 0.001)
 * @returns numerator / max(denominator, floor)
 */
export function safeDivide(numerator: number, denominator: number, floor: number = 0.001): number {
  return numerator / Math.max(denominator, floor);
}

/**
 * Clamp score to [0, 1] range with rounding to 3 decimal places.
 * All detector scores MUST be in [0, 1] — this ensures it.
 */
export function clampScore(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000;
}
