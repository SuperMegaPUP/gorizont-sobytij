// ─── Detector Registry — все 10 Black Star детекторов ─────────────────────

import type { IDetector, DetectorInput, DetectorResult, DetectorName } from './types';
import { detectGraviton } from './graviton';
import { detectDarkmatter } from './darkmatter';
import { detectAccretor } from './accretor';
import { detectDecoherence } from './decoherence';
import { detectHawking } from './hawking';
import { detectPredator } from './predator';
import { detectCipher } from './cipher';
import { detectEntangle } from './entangle';
import { detectWavefunction } from './wavefunction';
import { detectAttractor } from './attractor';

/** Все 10 детекторов в массиве */
export const ALL_DETECTORS: Array<{ name: DetectorName; detect: (input: DetectorInput) => DetectorResult }> = [
  { name: 'GRAVITON',     detect: detectGraviton },
  { name: 'DARKMATTER',   detect: detectDarkmatter },
  { name: 'ACCRETOR',     detect: detectAccretor },
  { name: 'DECOHERENCE',  detect: detectDecoherence },
  { name: 'HAWKING',      detect: detectHawking },
  { name: 'PREDATOR',     detect: detectPredator },
  { name: 'CIPHER',       detect: detectCipher },
  { name: 'ENTANGLE',     detect: detectEntangle },
  { name: 'WAVEFUNCTION', detect: detectWavefunction },
  { name: 'ATTRACTOR',    detect: detectAttractor },
];

/** Запустить все детекторы на одном входе */
export function runAllDetectors(input: DetectorInput): DetectorResult[] {
  return ALL_DETECTORS.map(d => d.detect(input));
}

/** Запустить конкретный детектор по имени */
export function runDetector(name: DetectorName, input: DetectorInput): DetectorResult {
  const det = ALL_DETECTORS.find(d => d.name === name);
  if (!det) throw new Error(`Unknown detector: ${name}`);
  return det.detect(input);
}

// ─── BSCI Composite Index ──────────────────────────────────────────────────
// BSCI = Σ(w_i × score_i) / Σ(w_i)
// Веса адаптивные, сумма = 1, минимальный 0.02

export interface BSCIResult {
  bsci: number;                          // 0..1
  alertLevel: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  topDetector: string;                   // детектор с макс score
  scores: DetectorResult[];              // все 10 результатов
  weights: Record<string, number>;       // текущие веса
}

/**
 * Вычислить BSCI Composite Index
 * @param scores — результаты 10 детекторов
 * @param weights — адаптивные веса из BsciWeight таблицы
 */
export function calcBSCI(
  scores: DetectorResult[],
  weights: Record<string, number>
): BSCIResult {
  // BSCI = Σ(w_i × score_i)
  let weightedSum = 0;
  let weightTotal = 0;
  let maxScore = 0;
  let topDetector = 'NONE';

  for (const result of scores) {
    const w = weights[result.detector] ?? 0.1; // default weight = 0.1
    weightedSum += w * result.score;
    weightTotal += w;
    if (result.score > maxScore) {
      maxScore = result.score;
      topDetector = result.detector;
    }
  }

  const bsci = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const clampedBsci = Math.min(1, Math.max(0, bsci));

  // Alert level
  let alertLevel: BSCIResult['alertLevel'] = 'GREEN';
  if (clampedBsci >= 0.7) alertLevel = 'RED';
  else if (clampedBsci >= 0.5) alertLevel = 'ORANGE';
  else if (clampedBsci >= 0.3) alertLevel = 'YELLOW';

  // Direction: взвешенное голосование детекторов
  let bullWeight = 0;
  let bearWeight = 0;
  for (const result of scores) {
    const w = weights[result.detector] ?? 0.1;
    if (result.signal === 'BULLISH') bullWeight += w * result.score;
    else if (result.signal === 'BEARISH') bearWeight += w * result.score;
  }
  const direction = bullWeight > bearWeight * 1.3 ? 'BULLISH'
    : bearWeight > bullWeight * 1.3 ? 'BEARISH' : 'NEUTRAL';

  return {
    bsci: Math.round(clampedBsci * 1000) / 1000,
    alertLevel,
    direction,
    topDetector,
    scores,
    weights,
  };
}
