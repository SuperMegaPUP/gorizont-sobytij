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
//   затем маппим в [0, 1]: normalized = clamp(0.5 + z * 0.4, 0, 1)
//
//   z = 0 (среднее) → normalized = 0.5
//   z = +1.25 (выброс вверх) → normalized = 1.0
//   z = -1.25 (выброс вниз) → normalized = 0.0
//
// ЭФФЕКТ: BSCI растянется до 0.05–0.75, появятся ORANGE тикеры
//
// v4.1.1 HOTFIX: Принцип «НЕТ ДАННЫХ = НЕТ АНОМАЛИИ»
//   Когда variance < MIN_VARIANCE (все скоры одинаковые, напр. все = 0),
//   НЕ нормализуем — оставляем raw score. Иначе рынок закрыт → все 0 → z=0 → 0.5 → ORANGE.
//   Также: если детектор вернул insufficientData, его score не должен быть поднят выше raw.

import type { DetectorResult } from './types';

/** Минимальная variance, при которой нормализация имеет смысл.
 *  Если variance < MIN_VARIANCE — все скоры практически одинаковые →
 *  нормализация к 0.5 бессмысленна (НЕТ ДАННЫХ = НЕТ АНОМАЛИИ).
 *  Пример: рынок закрыт → все детекторы дают 0 → variance=0 → не нормализуем.
 */
const MIN_VARIANCE = 0.002; // ~std 0.045 — ниже этого нет реальной разницы между тикерами

/**
 * Кросс-секционная нормализация: z-score по батчу тикеров
 *
 * v4.1.1: Если variance < MIN_VARIANCE — пропускаем нормализацию (оставляем raw score).
 * Если детектор вернул insufficientData — его score не поднимаем выше raw.
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
  // Также считаем сколько тикеров имеют insufficientData для каждого детектора
  const detectorInsufficientCount: Record<string, number> = {};
  for (const scores of allScores) {
    for (const s of scores) {
      if (!detectorValues[s.detector]) {
        detectorValues[s.detector] = [];
        detectorInsufficientCount[s.detector] = 0;
      }
      detectorValues[s.detector].push(s.score);
      if (s.metadata?.insufficientData || s.metadata?.insufficientTrades ||
          s.metadata?.noCrossData || s.metadata?.insufficientIntervals) {
        detectorInsufficientCount[s.detector]++;
      }
    }
  }

  // 2. Вычисляем mean и variance для каждого детектора
  const stats: Record<string, { mean: number; std: number; variance: number; shouldNormalize: boolean }> = {};
  for (const [det, vals] of Object.entries(detectorValues)) {
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance) || 0.01;

    // v4.1.1: НЕ нормализуем если variance слишком мала
    // Все скоры одинаковые (или почти) → z-score бессмысленный → оставляем raw
    // Также НЕ нормализуем если большинство тикеров имеют insufficientData
    const insufficientRatio = detectorInsufficientCount[det] / n;
    const shouldNormalize = variance >= MIN_VARIANCE && insufficientRatio < 0.5;

    stats[det] = { mean, std, variance, shouldNormalize };
  }

  // 3. Нормализуем каждый скор: z-score → [0, 1]
  // v4.1.1: Пропускаем детекторы с shouldNormalize=false
  return allScores.map(scores =>
    scores.map(s => {
      const stat = stats[s.detector] || { mean: 0, std: 0.01, variance: 0, shouldNormalize: false };

      // v4.1.1: Если недостаточно variance → оставляем raw score
      // Принцип: НЕТ ДАННЫХ = НЕТ АНОМАЛИИ = score должен остаться низким
      if (!stat.shouldNormalize) {
        return {
          ...s,
          metadata: {
            ...s.metadata,
            rawScore: s.score,
            zScore: 0,
            normalizationSkipped: true,
            skipReason: stat.variance < MIN_VARIANCE ? 'low_variance' : 'insufficient_data',
          },
        };
      }

      const z = (s.score - stat.mean) / stat.std;
      // Маппинг: z=0 → 0.5, z=+1.25 → 1.0, z=-1.25 → 0.0
      // FIX 4R-2: 0.25→0.4 — более сильная дискриминация (из спецификации v4)
      let normalized = Math.max(0, Math.min(1, 0.5 + z * 0.4));

      // v4.1.1: Если у этого конкретного тикера insufficientData,
      // не позволяем нормализации поднять score выше raw
      const hasInsufficient = s.metadata?.insufficientData || s.metadata?.insufficientTrades ||
        s.metadata?.noCrossData || s.metadata?.insufficientIntervals;
      if (hasInsufficient && normalized > s.score) {
        normalized = s.score; // сохраняем низкий raw score
      }

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
 * v4.1.1: Если insufficientData — не поднимаем score выше raw.
 * Если cachedStats показывает low variance (std < порог) — пропускаем нормализацию.
 *
 * @param scores - DetectorResult[] одного тикера
 * @param cachedStats - Record<detector, { mean, std, variance? }> из последнего батча
 * @returns нормализованные DetectorResult[]
 */
export function crossSectionNormalizeSingle(
  scores: DetectorResult[],
  cachedStats: Record<string, { mean: number; std: number; variance?: number }>,
): DetectorResult[] {
  if (!cachedStats || Object.keys(cachedStats).length === 0) return scores;

  return scores.map(s => {
    const stat = cachedStats[s.detector];
    if (!stat) return s; // нет статистики — не нормализуем

    // v4.1.1: Если variance слишком мала — пропускаем нормализацию
    const variance = stat.variance ?? (stat.std * stat.std);
    if (variance < MIN_VARIANCE) {
      return {
        ...s,
        metadata: {
          ...s.metadata,
          rawScore: s.score,
          zScore: 0,
          normalizationSkipped: true,
          skipReason: 'low_variance',
        },
      };
    }

    const z = (s.score - stat.mean) / stat.std;
    // FIX 4R-2: 0.25→0.4 — более сильная дискриминация
    let normalized = Math.max(0, Math.min(1, 0.5 + z * 0.4));

    // v4.1.1: insufficientData — не поднимаем выше raw
    const hasInsufficient = s.metadata?.insufficientData || s.metadata?.insufficientTrades ||
      s.metadata?.noCrossData || s.metadata?.insufficientIntervals;
    if (hasInsufficient && normalized > s.score) {
      normalized = s.score;
    }

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
 * Вычисляет статистику (mean, std, variance) по детекторам из батча.
 * Можно сохранить в Redis для последующей нормализации одиночных тикеров.
 * v4.1.1: Добавлено поле variance для проверки MIN_VARIANCE.
 */
export function computeCrossSectionStats(
  allScores: DetectorResult[][],
): Record<string, { mean: number; std: number; variance: number }> {
  const detectorValues: Record<string, number[]> = {};
  for (const scores of allScores) {
    for (const s of scores) {
      if (!detectorValues[s.detector]) detectorValues[s.detector] = [];
      detectorValues[s.detector].push(s.score);
    }
  }

  const stats: Record<string, { mean: number; std: number; variance: number }> = {};
  for (const [det, vals] of Object.entries(detectorValues)) {
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance) || 0.01;
    stats[det] = { mean, std, variance };
  }

  return stats;
}

/**
 * Версия для простых Record<string, number> (без полной DetectorResult)
 * Используется когда доступны только скоры без metadata
 * v4.1.1: Пропускаем нормализацию если variance < MIN_VARIANCE
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

  // Вычисляем mean/std/variance
  const stats: Record<string, { mean: number; std: number; variance: number }> = {};
  for (const [det, vals] of Object.entries(detectorValues)) {
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance) || 0.01;
    stats[det] = { mean, std, variance };
  }

  // Нормализуем
  return allScores.map(s => {
    const normalized: Record<string, number> = {};
    for (const k of Object.keys(s)) {
      const stat = stats[k];
      // v4.1.1: Пропускаем если variance слишком мала
      if (!stat || stat.variance < MIN_VARIANCE) {
        normalized[k] = Math.round(s[k] * 1000) / 1000; // оставляем raw
        continue;
      }
      const z = (s[k] - stat.mean) / stat.std;
      // FIX 4R-2: 0.25→0.4 — более сильная дискриминация
      normalized[k] = Math.round(Math.max(0, Math.min(1, 0.5 + z * 0.4)) * 1000) / 1000;
    }
    return normalized;
  });
}
