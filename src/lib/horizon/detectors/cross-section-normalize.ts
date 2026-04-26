// ─── cross-section-normalize.ts ─────────────────────────────────────────────
// Кросс-секционная нормализация детекторных скоров
// Robust z-score по батчу тикеров → растягивает BSCI до 0.05–0.75
//
// v4.2 (Sprint 5): Robust scaling — median/IQR вместо mean/std
//  _median_ и _IQR_ устойчивы к выбросам (outlier-robust).
//   Mean/std чувствительны к экстремальным значениям → искажали normalization.
//   Теперь: robust_z = (x - median) / (IQR / 1.35)
//   1.35 = масштабирующий коэффициент: IQR/1.35 ≈ σ для нормального распределения
//
//   robust_z = 0 (медиана) → normalized = 0.5
//   robust_z = +1.25 (выброс вверх) → normalized = 1.0
//   robust_z = -1.25 (выброс вниз) → normalized = 0.0
//
// ВНИМАНИЕ (микро-уточнение #1 — CIPHER PCA):
//   После robustNormalize() в пайплайне, внутри CIPHER используйте
//   PCA({ whiten: true }) или считайте PCA от корреляционной, а не
//   ковариационной матрицы. Иначе IQR-масштаб исказит explained_variance_ratio_.
//
// ВНИМАНИЕ (микро-уточнение #2 — BSCI distribution shift):
//   После внедрения guards и robust scaling, среднее BSCI гарантированно упадёт
//   (сейчас оно завышено шумом). Это не деградация, а очистка.

import type { DetectorResult } from './types';

/** Минимальный IQR, при котором нормализация имеет смысл.
 *  Если IQR < MIN_IQR — все скоры практически одинаковые →
 *  нормализация к 0.5 бессмысленна (НЕТ ДАННЫХ = НЕТ АНОМАЛИИ).
 *  Пример: рынок закрыт → все детекторы дают 0 → IQR=0 → не нормализуем.
 */
const MIN_IQR = 0.01; // ~σ 0.007 — ниже этого нет реальной разницы между тикерами

// ─── Robust Statistics Utilities ────────────────────────────────────────────

/**
 * Вычисляет медиану массива чисел.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Вычисляет квартили и IQR (Interquartile Range).
 * IQR = Q3 - Q1 — устойчивая мера разброса (robust to outliers).
 */
function computeIQR(values: number[]): {
  q1: number;
  q3: number;
  iqr: number;
  median: number;
} {
  if (values.length === 0) return { q1: 0, q3: 0, iqr: 0, median: 0 };

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const med = median(sorted);

  // Q1 = median of lower half, Q3 = median of upper half
  const lowerHalf = sorted.slice(0, Math.floor(n / 2));
  const upperHalf = sorted.slice(Math.ceil(n / 2));

  const q1 = median(lowerHalf);
  const q3 = median(upperHalf);
  const iqr = q3 - q1;

  return { q1, q3, iqr, median: med };
}

/**
 * Robust normalization: (x - median) / (IQR / 1.35)
 * IQR / 1.35 ≈ σ для нормального распределения (Gaussian consistent estimator)
 * Устойчива к выбросам — в отличие от (x - mean) / std
 *
 * @returns robust z-score
 */
export function robustZScore(value: number, medianVal: number, iqr: number): number {
  const robustScale = iqr / 1.35; // ≈ σ для нормального распределения
  if (robustScale < 1e-10) return 0; // IQR ≈ 0 → все значения одинаковые
  return (value - medianVal) / robustScale;
}

/**
 * Robust normalize array: применяет robust z-score к массиву.
 * Возвращает массив нормализованных значений.
 * Используется внутри CIPHER и других детекторов для нормализации признаков.
 *
 * ВАЖНО: Для CIPHER после robustNormalize() используйте PCA от корреляционной
 * матрицы (или whitening), чтобы IQR-масштаб не исказил explained_variance_ratio_.
 */
export function robustNormalize(values: number[]): number[] {
  if (values.length < 2) return values.map(() => 0);

  const { median: med, iqr } = computeIQR(values);

  if (iqr < MIN_IQR) return values.map(() => 0); // все одинаковые → 0

  return values.map(v => robustZScore(v, med, iqr));
}

/**
 * Robust stats для кэширования (используется в crossSectionNormalizeSingle)
 */
export interface RobustStats {
  median: number;
  iqr: number;
  q1: number;
  q3: number;
  /** Legacy: mean для обратной совместимости */
  mean: number;
  /** Legacy: std для обратной совместимости */
  std: number;
  /** Legacy: variance для проверки MIN_IQR fallback */
  variance: number;
  shouldNormalize: boolean;
}

/**
 * Вычисляет robust статистики для массива значений.
 */
export function computeRobustStats(values: number[]): RobustStats {
  const n = values.length;
  if (n === 0) {
    return { median: 0, iqr: 0, q1: 0, q3: 0, mean: 0, std: 0, variance: 0, shouldNormalize: false };
  }

  const { q1, q3, iqr, median: med } = computeIQR(values);

  // Legacy stats для обратной совместимости (кэш в Redis)
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance) || 0.01;

  const shouldNormalize = iqr >= MIN_IQR;

  return { median: med, iqr, q1, q3, mean, std, variance, shouldNormalize };
}

// ─── Cross-Section Normalization ───────────────────────────────────────────

/**
 * Кросс-секционная нормализация: robust z-score по батчу тикеров
 *
 * v4.2: Использует median/IQR вместо mean/std для устойчивости к выбросам
 * v4.1.1: Если IQR < MIN_IQR — пропускаем нормализацию (оставляем raw score).
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

  // 2. Вычисляем robust статистики (median, IQR) для каждого детектора
  const stats: Record<string, RobustStats & { insufficientRatio: number }> = {};
  for (const [det, vals] of Object.entries(detectorValues)) {
    const robustStats = computeRobustStats(vals);
    const insufficientRatio = detectorInsufficientCount[det] / vals.length;

    // Не нормализуем если IQR слишком мал ИЛИ большинство тикеров insufficientData
    const shouldNormalize = robustStats.shouldNormalize && insufficientRatio < 0.5;

    stats[det] = { ...robustStats, insufficientRatio, shouldNormalize };
  }

  // 3. Нормализуем каждый скор: robust z-score → [0, 1]
  return allScores.map(scores =>
    scores.map(s => {
      const stat = stats[s.detector];
      if (!stat || !stat.shouldNormalize) {
        // IQR слишком мал или insufficient → оставляем raw score
        return {
          ...s,
          metadata: {
            ...s.metadata,
            rawScore: s.score,
            zScore: 0,
            normalizationSkipped: true,
            skipReason: !stat ? 'no_stats' :
              stat.iqr < MIN_IQR ? 'low_iqr' : 'insufficient_data',
          },
        };
      }

      // Robust z-score: (x - median) / (IQR / 1.35)
      const z = robustZScore(s.score, stat.median, stat.iqr);

      // Маппинг: z=0 → 0.5, z=+1.25 → 1.0, z=-1.25 → 0.0
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
          robustMedian: Math.round(stat.median * 1000) / 1000,
          robustIQR: Math.round(stat.iqr * 1000) / 1000,
        },
      };
    }),
  );
}

/**
 * Нормализация одного тикера против кэшированных статистик батча.
 * Используется в generate-observation.ts (одиночный вызов, нет батча).
 *
 * v4.2: Поддерживает как старый формат (mean/std), так и новый (median/iqr).
 * Если в cachedStats есть median/iqr — используем robust scaling.
 * Иначе — fallback на legacy mean/std.
 */
export function crossSectionNormalizeSingle(
  scores: DetectorResult[],
  cachedStats: Record<string, { mean: number; std: number; variance?: number; median?: number; iqr?: number }>,
): DetectorResult[] {
  if (!cachedStats || Object.keys(cachedStats).length === 0) return scores;

  return scores.map(s => {
    const stat = cachedStats[s.detector];
    if (!stat) return s;

    // v4.2: Используем robust scaling если есть median/iqr
    const hasRobust = stat.median !== undefined && stat.iqr !== undefined;
    const iqr = hasRobust ? stat.iqr! : 0;

    // Если IQR слишком мал — пропускаем
    if (hasRobust && iqr < MIN_IQR) {
      return {
        ...s,
        metadata: {
          ...s.metadata,
          rawScore: s.score,
          zScore: 0,
          normalizationSkipped: true,
          skipReason: 'low_iqr',
        },
      };
    }

    // Fallback на legacy если нет robust stats
    if (!hasRobust) {
      const variance = stat.variance ?? (stat.std * stat.std);
      if (variance < 0.002) { // legacy MIN_VARIANCE
        return {
          ...s,
          metadata: { ...s.metadata, rawScore: s.score, zScore: 0, normalizationSkipped: true, skipReason: 'low_variance' },
        };
      }
    }

    // Compute z-score
    let z: number;
    if (hasRobust) {
      z = robustZScore(s.score, stat.median!, iqr);
    } else {
      z = (s.score - stat.mean) / stat.std;
    }

    let normalized = Math.max(0, Math.min(1, 0.5 + z * 0.4));

    // insufficientData — не поднимаем выше raw
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
        ...(hasRobust ? {
          robustMedian: Math.round(stat.median! * 1000) / 1000,
          robustIQR: Math.round(iqr * 1000) / 1000,
        } : {}),
      },
    };
  });
}

/**
 * Вычисляет статистику (robust + legacy) по детекторам из батча.
 * Можно сохранить в Redis для последующей нормализации одиночных тикеров.
 * v4.2: Добавлены median и iqr для robust scaling.
 */
export function computeCrossSectionStats(
  allScores: DetectorResult[][],
): Record<string, { mean: number; std: number; variance: number; median: number; iqr: number }> {
  const detectorValues: Record<string, number[]> = {};
  for (const scores of allScores) {
    for (const s of scores) {
      if (!detectorValues[s.detector]) detectorValues[s.detector] = [];
      detectorValues[s.detector].push(s.score);
    }
  }

  const stats: Record<string, { mean: number; std: number; variance: number; median: number; iqr: number }> = {};
  for (const [det, vals] of Object.entries(detectorValues)) {
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance) || 0.01;

    const { median: med, iqr } = computeIQR(vals);

    stats[det] = { mean, std, variance, median: med, iqr };
  }

  return stats;
}

/**
 * Версия для простых Record<string, number> (без полной DetectorResult)
 * v4.2: Использует robust scaling (median/IQR)
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

  // Вычисляем robust статистики
  const stats: Record<string, { median: number; iqr: number }> = {};
  for (const [det, vals] of Object.entries(detectorValues)) {
    const { median: med, iqr } = computeIQR(vals);
    stats[det] = { median: med, iqr };
  }

  // Нормализуем
  return allScores.map(s => {
    const normalized: Record<string, number> = {};
    for (const k of Object.keys(s)) {
      const stat = stats[k];
      if (!stat || stat.iqr < MIN_IQR) {
        normalized[k] = Math.round(s[k] * 1000) / 1000; // оставляем raw
        continue;
      }
      const z = robustZScore(s[k], stat.median, stat.iqr);
      normalized[k] = Math.round(Math.max(0, Math.min(1, 0.5 + z * 0.4)) * 1000) / 1000;
    }
    return normalized;
  });
}
