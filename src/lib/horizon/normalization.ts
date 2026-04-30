/**
 * Cross-sectional z-score normalization with tanh soft-clipping.
 * Deploy #5 — PREDATOR + DARKMATTER only.
 * Operates on non-zero population only — zeros remain zeros.
 * Formula: z = (s - mean_nz) / std_nz → normalized = max(0, tanh(z / k))
 * Master switch: Z_SCORE_ENABLED — set to false to disable without code removal.
 */

export const Z_SCORE_ENABLED = true;
export const Z_SCORE_DETECTORS = ['PREDATOR', 'DARKMATTER'] as const;
export const Z_SCORE_K = 2.0;
export const Z_SCORE_MIN_POPULATION = 5;

export function zScoreNormalize(
  scores: number[],
  k: number = Z_SCORE_K,
  minPopulation: number = Z_SCORE_MIN_POPULATION
): { normalized: number[]; nonZeroMean: number; nonZeroStd: number } {
  const nonZero = scores.filter(s => s > 0);
  if (nonZero.length < minPopulation) {
    return { normalized: [...scores], nonZeroMean: 0, nonZeroStd: 0 };
  }
  const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
  const variance = nonZero.reduce((sum, s) => sum + (s - mean) ** 2, 0) / (nonZero.length - 1);
  const std = Math.sqrt(variance);
  if (std < 1e-8) {
    return { normalized: [...scores], nonZeroMean: mean, nonZeroStd: 0 };
  }
  const normalized = scores.map(s => {
    if (s <= 0) return 0;
    const z = (s - mean) / std;
    return Math.max(0, Math.tanh(z / k));
  });
  return { normalized, nonZeroMean: mean, nonZeroStd: std };
}