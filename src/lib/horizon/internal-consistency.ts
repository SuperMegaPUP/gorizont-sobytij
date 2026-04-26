// ─── internal-consistency.ts ─────────────────────────────────────────────────
// Уровень 0 калибровки: детектор vs сам себя (внутренняя консистентность)
//
// ПРОБЛЕМА:
//   Детектор может дать высокий score (0.7-0.9) на тикере с нулевым оборотом
//   или без подтверждающих данных. Пример: SGZH — ATTRACTOR 0.70 при нулевом
//   объёме. Это "галлюцинация" детектора на пустых данных.
//
// РЕШЕНИЕ:
//   Для каждого детектора с score ≥ threshold проверяем наличие подтверждающих
//   данных (cumDelta, VPIN, объём). Если подтверждения < 2/3 → понижаем вес.
//
// Это БЕСПЛАТНАЯ проверка — не требует внешних данных (роботы, результаты).

import type { DetectorResult } from './detectors/types';

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface ConsistencyCheck {
  /** Имя детектора */
  detector: string;
  /** Оригинальный score */
  rawScore: number;
  /** Подтверждающие данные */
  supportingData: {
    cumDeltaActive: boolean;   // CumDelta ≠ 0 (есть движение дельты)
    vpinActive: boolean;       // VPIN > порога (есть информированная торговля)
    volumeActive: boolean;     // Объём > среднего (есть активность)
  };
  /** Сколько из 3 поддержек выполнено */
  supportCount: number;        // 0-3
  /** Результат проверки */
  verdict: 'CONSISTENT' | 'SUSPICIOUS' | 'HALLUCINATION';
  /** Множитель веса для BSCI (1.0 = норма, 0.5 = понижен) */
  weightMultiplier: number;
  /** Человекочитаемое описание */
  note: string;
}

export interface InternalConsistencyResult {
  /** Проверки по каждому детектору */
  checks: ConsistencyCheck[];
  /** Детекторы-галлюцинации (score высокий, поддержки нет) */
  hallucinations: string[];
  /** Общий флаг: есть ли хоть одна галлюцинация */
  hasHallucination: boolean;
  /** Скорректированные веса (weight × multiplier) */
  adjustedWeights: Record<string, number>;
}

// ─── Пороги ──────────────────────────────────────────────────────────────────

/** Score детектора, выше которого проверяем консистентность */
const SCORE_THRESHOLD = 0.55;

/** VPIN порог: ниже этого — нет информированной торговли */
const VPIN_THRESHOLD = 0.05;

/** CumDelta порог: абсолютное значение ниже этого ≈ 0 */
const CUMDELTA_THRESHOLD = 50;  // зависит от тикера, но для приблизительной проверки

/** Объём: минимальный порог (в рублях), ниже которого считаем "мёртвым" */
const VOLUME_MIN_THRESHOLD = 100_000;  // 100K руб — минимальный объём для надёжного анализа

/** Сколько поддержек из 3 нужно для CONSISTENT */
const MIN_SUPPORT_CONSISTENT = 2;

/** Сколько поддержек из 3 нужно чтобы не быть HALLUCINATION */
const MIN_SUPPORT_NOT_HALLUCINATION = 1;

// ─── Главная функция ─────────────────────────────────────────────────────────

/**
 * Проверяет внутреннюю консистентность детекторных скоров.
 *
 * Для детекторов с score ≥ SCORE_THRESHOLD проверяет:
 * 1. CumDelta ≠ ≈0 → есть реальное движение дельты
 * 2. VPIN > порога → есть информированная торговля
 * 3. Объём > минимума → данные достаточны для анализа
 *
 * Если < 2/3 поддержек → детектор "галлюцинирует" → вес × 0.5
 *
 * @param detectorScores — результаты 10 детекторов
 * @param cumDelta — накопленная дельта
 * @param vpin — VPIN значение
 * @param volume — оборот в рублях
 * @param currentWeights — текущие веса BSCI
 */
export function checkInternalConsistency(
  detectorScores: DetectorResult[],
  cumDelta: number,
  vpin: number,
  volume: number,
  currentWeights: Record<string, number>,
): InternalConsistencyResult {
  const checks: ConsistencyCheck[] = [];
  const hallucinations: string[] = [];

  // Проверяем подтверждающие данные (один раз для всех детекторов)
  const cumDeltaActive = Math.abs(cumDelta) > CUMDELTA_THRESHOLD;
  const vpinActive = vpin > VPIN_THRESHOLD;
  const volumeActive = volume > VOLUME_MIN_THRESHOLD;

  for (const result of detectorScores) {
    // Проверяем только детекторы с высоким score
    if (result.score < SCORE_THRESHOLD) {
      // Низкий score — нечего проверять, он и так не влияет сильно
      checks.push({
        detector: result.detector,
        rawScore: result.score,
        supportingData: { cumDeltaActive, vpinActive, volumeActive },
        supportCount: 0,
        verdict: 'CONSISTENT', // низкий score = не проблемный
        weightMultiplier: 1.0,
        note: 'Низкий score — проверка не требуется',
      });
      continue;
    }

    // Считаем поддержки
    const supports = [cumDeltaActive, vpinActive, volumeActive];
    const supportCount = supports.filter(Boolean).length;

    let verdict: ConsistencyCheck['verdict'];
    let weightMultiplier: number;
    let note: string;

    if (supportCount >= MIN_SUPPORT_CONSISTENT) {
      // ≥2 из 3 поддержек — детектор консистентен
      verdict = 'CONSISTENT';
      weightMultiplier = 1.0;
      note = `Score ${result.score.toFixed(2)} подтверждён ${supportCount}/3 данными`;
    } else if (supportCount >= MIN_SUPPORT_NOT_HALLUCINATION) {
      // 1 из 3 — подозрительно
      verdict = 'SUSPICIOUS';
      weightMultiplier = 0.75;
      note = `Score ${result.score.toFixed(2)} слабо подтверждён (${supportCount}/3) — возможно ложное срабатывание`;
    } else {
      // 0 из 3 — галлюцинация!
      verdict = 'HALLUCINATION';
      weightMultiplier = 0.5;
      hallucinations.push(result.detector);
      note = `Score ${result.score.toFixed(2)} БЕЗ подтверждения (0/3) — галлюцинация на пустых данных!`;
    }

    checks.push({
      detector: result.detector,
      rawScore: result.score,
      supportingData: { cumDeltaActive, vpinActive, volumeActive },
      supportCount,
      verdict,
      weightMultiplier,
      note,
    });
  }

  // Корректируем веса
  const adjustedWeights: Record<string, number> = { ...currentWeights };
  for (const check of checks) {
    if (check.weightMultiplier !== 1.0 && adjustedWeights[check.detector] !== undefined) {
      adjustedWeights[check.detector] = adjustedWeights[check.detector] * check.weightMultiplier;
      // Минимальный вес = 0.02 (не обнуляем полностью)
      adjustedWeights[check.detector] = Math.max(0.02, adjustedWeights[check.detector]);
    }
  }

  return {
    checks,
    hallucinations,
    hasHallucination: hallucinations.length > 0,
    adjustedWeights,
  };
}

/**
 * Быстрая проверка: есть ли галлюцинации у top-детектора?
 * Используется для условной логики в формуле confidence.
 */
export function topDetectorIsHallucination(
  topDetectorName: string,
  consistencyResult: InternalConsistencyResult,
): boolean {
  const check = consistencyResult.checks.find(c => c.detector === topDetectorName);
  return check?.verdict === 'HALLUCINATION';
}

/**
 * Возвращает множитель веса для конкретного детектора.
 * Если детектор не проверялся — возвращает 1.0.
 */
export function getWeightMultiplier(
  detectorName: string,
  consistencyResult: InternalConsistencyResult,
): number {
  const check = consistencyResult.checks.find(c => c.detector === detectorName);
  return check?.weightMultiplier ?? 1.0;
}
