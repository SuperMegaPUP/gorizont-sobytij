// ─── CONFIDENCE MULTIPLIER (P3) ──────────────────────────────────────────
// EffectiveSignal = BSCI × confidenceMultiplier
// Честная уверенность при HFT-войнах
//
// Формула: effectiveSignal = signal × multiplier
// где multiplier зависит от:
//   - Количество детекторов с ненулевым score
//   - Согласованность направлений (Bull/Bear)
//   - Сила top детектора
//   - Волатильность рынка (ATR)

import type { DetectorResult } from './types';

export interface ConfidenceMultiplierConfig {
  minDetectors: number;      // Минимум детекторов для boost
  consensusWeight: number;   // Вес согласованности
  strengthWeight: number;    // Вес силы top детектора
  volatilityWeight: number;  // Вес волатильности
}

export const CONF_DEFAULT_CONFIG: ConfidenceMultiplierConfig = {
  minDetectors: 3,           // Минимум 3 детектора должны сигналить
  consensusWeight: 0.4,      // 40% - согласованность направлений
  strengthWeight: 0.35,      // 35% - сила top детектора
  volatilityWeight: 0.25,    // 25% - волатильность
};

export interface ConfidenceResult {
  multiplier: number;
  effectiveBsci: number;
  detectorConsensus: number;      // 0-1: доля детекторов в одном направлении
  detectorStrength: number;       // 0-1: сила top детектора
  marketVolatility: number;       // 0-1: normalized ATR
  conditions: {
    hasMinDetectors: boolean;
    highConsensus: boolean;
    strongTop: boolean;
  };
}

/**
 * Вычислить confidence multiplier
 * @param detectorResults - массив результатов детекторов
 * @param rawBsci - сырой BSCI до модификации
 * @param atrPct - ATR процент (0-100) для волатильности
 * @param config - конфигурация
 */
export function calculateConfidenceMultiplier(
  detectorResults: DetectorResult[],
  rawBsci: number,
  atrPct: number = 50,
  config: ConfidenceMultiplierConfig = CONF_DEFAULT_CONFIG
): ConfidenceResult {
  // 1. Подсчитываем детекторы с ненулевым score
  const activeDetectors = detectorResults.filter(d => d.score > 0.01);
  const hasMinDetectors = activeDetectors.length >= config.minDetectors;

  // 2. Определяем согласованность направлений
  let bullCount = 0;
  let bearCount = 0;
  let neutralCount = 0;

  for (const d of activeDetectors) {
    if (d.signal === 'BULLISH') bullCount++;
    else if (d.signal === 'BEARISH') bearCount++;
    else neutralCount++;
  }

  const total = bullCount + bearCount + neutralCount;
  const consensus = total > 0
    ? Math.max(bullCount, bearCount, neutralCount) / total
    : 0;
  const highConsensus = consensus > 0.6;

  // 3. Сила top детектора
  const topDetector = activeDetectors
    .sort((a, b) => b.score - a.score)[0];
  const detectorStrength = topDetector
    ? Math.min(1, topDetector.score * 1.5)  // Normalize: 0.67 score → 1.0
    : 0;
  const strongTop = detectorStrength > 0.5;

  // 4. Волатильность (ATR normalized)
  const marketVolatility = Math.min(1, Math.max(0, atrPct / 100));

  // 5. Вычисляем multiplier
  let multiplier = 1.0;

  if (hasMinDetectors) {
    const consensusFactor = highConsensus ? (consensus - 0.5) * 2 : 0; // 0.5-1.0 → 0-1
    const strengthFactor = strongTop ? (detectorStrength - 0.5) * 2 : 0; // 0.5-1.0 → 0-1
    const volatilityFactor = marketVolatility < 0.5 ? (0.5 - marketVolatility) * 2 : 0; // Low vol = higher confidence

    multiplier = 1.0
      + config.consensusWeight * consensusFactor
      + config.strengthWeight * strengthFactor
      + config.volatilityWeight * volatilityFactor;
  }

  // Cap multiplier: 0.5 - 1.5
  multiplier = Math.max(0.5, Math.min(1.5, multiplier));

  // 6. Effective BSCI
  const effectiveBsci = Math.max(0, Math.min(1, rawBsci * multiplier));

  return {
    multiplier: Math.round(multiplier * 1000) / 1000,
    effectiveBsci: Math.round(effectiveBsci * 1000) / 1000,
    detectorConsensus: Math.round(consensus * 1000) / 1000,
    detectorStrength,
    marketVolatility,
    conditions: {
      hasMinDetectors,
      highConsensus,
      strongTop,
    },
  };
}

/**
 * Применить confidence multiplier к BSCI
 * Используется в слотном движке перед записью в результат
 */
export function applyConfidenceToBSCI(
  detectorResults: DetectorResult[],
  rawBsci: number,
  atrPct: number = 50
): { rawBsci: number; effectiveBsci: number; multiplier: number } {
  const conf = calculateConfidenceMultiplier(detectorResults, rawBsci, atrPct);

  return {
    rawBsci,
    effectiveBsci: conf.effectiveBsci,
    multiplier: conf.multiplier,
  };
}