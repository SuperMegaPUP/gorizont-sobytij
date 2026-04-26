// ─── cross-section-normalize.ts ─────────────────────────────────────────────
// Кросс-секционная нормализация детекторных скоров
// Z-score по батчу тикеров → растягивает BSCI до 0.05–0.75
//
// ПРОБЛЕМА:
//   ACCRETOR: 0.8-0.99 у 90% тикеров (шум, не сигнал)
//   GRAVITON: 0.00 у 98% (мёртвый детектор)
//   → BSCI сжимается в 0.08-0.40, зона 0.4-1.0 мёртвая
//
// РЕШЕНИЕ:
//   Для каждого детектора вычисляем z-score по всему батчу тикеров,
//   затем маппим в [0, 1]: normalized = clamp(0.5 + z * 0.25, 0, 1)
//
//   z = 0 (среднее) → normalized = 0.5
//   z = +2 (выброс вверх) → normalized = 1.0
//   z = -2 (выброс вниз) → normalized = 0.0
//
// ЭФФЕКТ: BSCI растянется до 0.05–0.75, появятся ORANGE тикеры

import type { DetectorResult } from './types';

/**
 * Кросс-секционная нормализация: z-score по батчу тикеров
 *
 * @param allScores - массив DetectorResult[] для каждого тикера в батче
 * @returns нормализованные DetectorResult[][] (score заменены на нормализованные)
 */
export function crossSectionNormalize(
  allScores: DetectorResult[][],
): DetectorResult[][] {
  if (allScores.length <= 1) return allScores; // 0-1 тикеров — нечего нормализовать

  // 1. Собираем все скоры по каждому детектору
  const detectorValues: Record<string, number[]> = {};
  for (const scores of allScores) {
    for (const s of scores) {
      if (!detectorValues[s.detector]) detectorValues[s.detector] = [];
      detectorValues[s.detector].push(s.score);
    }
  }

  // 2. Вычисляем mean и std для каждого детектора
  const stats: Record<string, { mean: number; std: number }> = {};
  for (const [det, vals] of Object.entries(detectorValues)) {
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    // Минимальный std = 0.01 чтобы избежать деления на 0 и денормализации
    const std = Math.sqrt(variance) || 0.01;
    stats[det] = { mean, std };
  }

  // 3. Нормализуем каждый скор: z-score → [0, 1]
  return allScores.map(scores =>
    scores.map(s => {
      const { mean, std } = stats[s.detector] || { mean: 0, std: 0.01 };
      const z = (s.score - mean) / std;
      // Маппинг: z=0 → 0.5, z=+2 → 1.0, z=-2 → 0.0
      const normalized = Math.max(0, Math.min(1, 0.5 + z * 0.25));

      return {
        ...s,
        score: Math.round(normalized * 1000) / 1000,
        metadata: {
          ...s.metadata,
          rawScore: s.score,
          zScore: Math.round(z * 100) / 100,
        },
      };
    }),
  );
}

/**
 * Нормализация одного тикера против кэшированных статистик батча.
 * Используется в generate-observation.ts (одиночный вызов, нет батча).
 *
 * @param scores - DetectorResult[] одного тикера
 * @param cachedStats - Record<detector, { mean, std }> из последнего батча
 * @returns нормализованные DetectorResult[]
 */
export function crossSectionNormalizeSingle(
  scores: DetectorResult[],
  cachedStats: Record<string, { mean: number; std: number }>,
): DetectorResult[] {
  if (!cachedStats || Object.keys(cachedStats).length === 0) return scores;

  return scores.map(s => {
    const stat = cachedStats[s.detector];
    if (!stat) return s; // нет статистики — не нормализуем

    const z = (s.score - stat.mean) / stat.std;
    const normalized = Math.max(0, Math.min(1, 0.5 + z * 0.25));

    return {
      ...s,
      score: Math.round(normalized * 1000) / 1000,
      metadata: {
        ...s.metadata,
        rawScore: s.score,
        zScore: Math.round(z * 100) / 100,
      },
    };
  });
}

/**
 * Вычисляет статистику (mean, std) по детекторам из батча.
 * Можно сохранить в Redis для последующей нормализации одиночных тикеров.
 */
export function computeCrossSectionStats(
  allScores: DetectorResult[][],
): Record<string, { mean: number; std: number }> {
  const detectorValues: Record<string, number[]> = {};
  for (const scores of allScores) {
    for (const s of scores) {
      if (!detectorValues[s.detector]) detectorValues[s.detector] = [];
      detectorValues[s.detector].push(s.score);
    }
  }

  const stats: Record<string, { mean: number; std: number }> = {};
  for (const [det, vals] of Object.entries(detectorValues)) {
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance) || 0.01;
    stats[det] = { mean, std };
  }

  return stats;
}

/**
 * Версия для простых Record<string, number> (без полной DetectorResult)
 * Используется когда доступны только скоры без metadata
 */
export function crossSectionNormalizeScores(
  allScores: Record<string, number>[],
): Record<string, number>[] {
  if (allScores.length <= 1) return allScores;

  // Собираем ключи из первого элемента
  const keys = new Set<string>();
  for (const s of allScores) {
    for (const k of Object.keys(s)) keys.add(k);
  }

  // Собираем значения по каждому детектору
  const detectorValues: Record<string, number[]> = {};
  for (const k of keys) {
    detectorValues[k] = allScores.map(s => s[k] ?? 0);
  }

  // Вычисляем mean/std
  const stats: Record<string, { mean: number; std: number }> = {};
  for (const [det, vals] of Object.entries(detectorValues)) {
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance) || 0.01;
    stats[det] = { mean, std };
  }

  // Нормализуем
  return allScores.map(s => {
    const normalized: Record<string, number> = {};
    for (const k of Object.keys(s)) {
      const { mean, std } = stats[k] || { mean: 0, std: 0.01 };
      const z = (s[k] - mean) / std;
      normalized[k] = Math.round(Math.max(0, Math.min(1, 0.5 + z * 0.25)) * 1000) / 1000;
    }
    return normalized;
  });
}
