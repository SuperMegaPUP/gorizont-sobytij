// ─── DECOHERENCE — Декогеренция (расхождение потоков) ──────────────────────
// OFI и CumDelta говорят в разные стороны → рынок «распадается».
// Это признак разворота: один поток доминирует, но другой уже ослаб.
//
// Признаки:
// - OFI > 0 но CumDelta < 0 (или наоборот) → расхождение
// - Дивергенция цена/дельта уже детектирована
// - Сила расхождения пропорциональна конфликту
//
// Score: flowDivergence × conflictMagnitude × divergenceStrength

import type { DetectorInput, DetectorResult } from './types';
import { detectDivergence } from '../calculations/delta';

export function detectDecoherence(input: DetectorInput): DetectorResult {
  const { ofi, cumDelta, prices } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // 1. Flow divergence: OFI direction ≠ CumDelta direction
  const ofiDir = Math.sign(ofi);
  const deltaDir = Math.sign(cumDelta.delta);
  const flowDivergence = ofiDir !== 0 && deltaDir !== 0 && ofiDir !== deltaDir;
  metadata.flowDivergence = flowDivergence;
  metadata.ofiDir = ofiDir;
  metadata.deltaDir = deltaDir;

  // 2. Conflict magnitude: |OFI - normalized delta direction|
  const normalizedDelta = cumDelta.totalVolume > 0
    ? cumDelta.delta / cumDelta.totalVolume : 0; // [-1, 1]
  const conflictMagnitude = Math.abs(ofi - normalizedDelta) / 2; // [0, 1]
  metadata.conflictMagnitude = Math.round(conflictMagnitude * 1000) / 1000;

  // 3. Price-delta divergence (using existing function)
  // Build a simple cumDelta series from the current delta
  const cumDeltaSeries = prices.length > 0
    ? prices.map((_, i) => normalizedDelta * (i + 1) * 10)
    : [cumDelta.delta];
  const divergence = detectDivergence(prices, cumDeltaSeries, Math.min(20, prices.length));
  metadata.divergenceDetected = divergence.detected;
  metadata.divergenceType = divergence.type;
  metadata.divergenceStrength = Math.round(divergence.strength * 1000) / 1000;

  // 4. OFI absolute strength
  const ofiStrength = Math.abs(ofi);
  const deltaStrength = Math.abs(normalizedDelta);

  // Score
  const divergenceScore = flowDivergence ? 0.7 : 0;
  const conflictScore = conflictMagnitude; // already [0, 1]
  const divergenceCalcScore = divergence.strength;
  const strengthScore = Math.min(1, (ofiStrength + deltaStrength));

  const rawScore = divergenceScore * 0.35 + conflictScore * 0.3 +
    divergenceCalcScore * 0.25 + strengthScore * 0.1;
  const score = Math.min(1, Math.max(0, rawScore));

  // Signal: кто "побеждает"?
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2) {
    // CumDelta — более «честный» индикатор (реальные сделки)
    signal = cumDelta.delta > 0 ? 'BULLISH' : cumDelta.delta < 0 ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.2
    ? Math.min(1, (conflictScore + divergenceCalcScore) / 1.5)
    : 0;

  return {
    detector: 'DECOHERENCE',
    description: 'Декогеренция — расхождение потоков OFI и CumDelta',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
