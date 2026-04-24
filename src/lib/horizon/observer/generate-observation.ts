// ─── generate-observation.ts ────────────────────────────────────────────────
// Оркестратор AI Observer:
// 1. collectMarketData() → рыночные данные
// 2. runAllDetectors() → 10 scores
// 3. calcBSCI() → Composite Index
// 4. AI Commentary → z-ai-web-dev-sdk
// 5. saveObservation() → PostgreSQL + Redis
//
// Вызывается cron'ом 6 раз/день или вручную через API

import { collectMarketData } from './collect-market-data';
import { runAllDetectors, calcBSCI } from '../detectors/registry';
import type { BSCIResult } from '../detectors/registry';
import type { DetectorResult } from '../detectors/types';
import { saveObservation, type ObservationInput, type SaveResult } from '../bsci/save-observation';
import prisma from '@/lib/db';

// ─── Slot Definitions ───────────────────────────────────────────────────────

export const OBSERVER_SLOTS = [
  { slot: 0, time: '08:00', name: 'Предрыночный скан', focus: 'Аукцион, глобальный контекст' },
  { slot: 1, time: '10:30', name: 'Утренний паттерн', focus: 'Первые сигналы, настрой дня' },
  { slot: 2, time: '12:00', name: 'Полуденной обзор', focus: 'Проверка гипотез' },
  { slot: 3, time: '15:00', name: 'Предзакрытие', focus: 'Итоговые позиции' },
  { slot: 4, time: '17:00', name: 'Вечерняя сессия', focus: 'FORTS, клиринг, опционы' },
  { slot: 5, time: '20:00', name: 'Итоги дня', focus: 'Верификация, калибровка, summary' },
] as const;

/** Определяет текущий слот по московскому времени */
export function getCurrentSlot(): { slot: number; name: string; focus: string } {
  const now = new Date();
  // Московское время = UTC+3
  const mskHour = (now.getUTCHours() + 3) % 24;
  const mskMinute = now.getUTCMinutes();

  // Определяем слот по времени МСК
  if (mskHour < 8 || (mskHour === 8 && mskMinute < 30)) return OBSERVER_SLOTS[0];
  if (mskHour < 10 || (mskHour === 10 && mskMinute < 30)) return OBSERVER_SLOTS[1];
  if (mskHour < 12) return OBSERVER_SLOTS[2];
  if (mskHour < 15) return OBSERVER_SLOTS[3];
  if (mskHour < 17) return OBSERVER_SLOTS[4];
  return OBSERVER_SLOTS[5];
}

// ─── AI Commentary Generator ────────────────────────────────────────────────

const AI_SYSTEM_PROMPT = `Ты — AI Observer системы "Горизонт Событий".
Анализируешь скрытых крупных игроков ("чёрные звёзды") на рынке MOEX.

Твои данные:
- BSCI: {bsci_value} ({alert_level})
- Направление: {direction}, уверенность: {confidence}%
- Детекторы: {detector_scores_with_metadata}
- Рыночный контекст: {market_summary}

Задача:
1. Оцени общую ситуацию — есть ли признаки "чёрной звезды"
2. Укажи наиболее вероятный сценарий (бычий/медвежий/нейтральный)
3. Выдели ключевые сигналы от детекторов
4. Дай прогноз на ближайшие часы
5. Укажи уровень уверенности

Формат: краткий, технический, на русском, 3-5 предложений.`;

/**
 * Генерирует AI комментарий через z-ai-web-dev-sdk
 */
async function generateAIComment(
  bsciResult: BSCIResult,
  marketSnapshot: Record<string, any>,
): Promise<{ comment: string; tokensUsed: number }> {
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    // Формируем детектор summary
    const detectorSummary = bsciResult.scores
      .sort((a, b) => b.score - a.score)
      .slice(0, 5) // top 5
      .map(s => `${s.detector}: ${s.score.toFixed(2)} (${s.signal})`)
      .join(', ');

    const marketSummary = `${marketSnapshot.ticker || 'SBER'}: mid=${marketSnapshot.midPrice}, spread=${marketSnapshot.spread}, trades=${marketSnapshot.tradeCount}, RVI=${marketSnapshot.rvi ?? 'N/A'}`;

    const systemPrompt = AI_SYSTEM_PROMPT
      .replace('{bsci_value}', bsciResult.bsci.toFixed(3))
      .replace('{alert_level}', bsciResult.alertLevel)
      .replace('{direction}', bsciResult.direction)
      .replace('{confidence}', Math.round(bsciResult.scores.reduce((max, s) => Math.max(max, s.confidence), 0) * 100).toString())
      .replace('{detector_scores_with_metadata}', detectorSummary)
      .replace('{market_summary}', marketSummary);

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Сделай наблюдение для слота. BSCI=${bsciResult.bsci.toFixed(3)}, уровень=${bsciResult.alertLevel}, направление=${bsciResult.direction}. Топ-детектор: ${bsciResult.topDetector}.` },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const comment = completion.choices?.[0]?.message?.content || '';
    const tokensUsed = completion.usage?.total_tokens || 0;

    return { comment, tokensUsed };
  } catch (error: any) {
    console.warn('[generate-observation] AI comment failed:', error.message);
    // Fallback: автогенерированный комментарий без AI
    return {
      comment: generateFallbackComment(bsciResult),
      tokensUsed: 0,
    };
  }
}

/** Fallback: автогенерированный комментарий без AI */
function generateFallbackComment(bsciResult: BSCIResult): string {
  const emoji = bsciResult.alertLevel === 'RED' ? '🔴'
    : bsciResult.alertLevel === 'ORANGE' ? '🟠'
    : bsciResult.alertLevel === 'YELLOW' ? '🟡' : '🟢';

  const topDet = bsciResult.scores.reduce((top, s) => s.score > top.score ? s : top, bsciResult.scores[0]);
  const activeDetectors = bsciResult.scores.filter(s => s.score > 0.3).length;

  return `${emoji} BSCI=${bsciResult.bsci.toFixed(2)} (${bsciResult.alertLevel}). Направление: ${bsciResult.direction}. Топ-детектор: ${topDet.detector} (${topDet.score.toFixed(2)}). Активных детекторов: ${activeDetectors}/10.`;
}

// ─── Main Orchestrator ──────────────────────────────────────────────────────

export interface GenerateObservationResult {
  success: boolean;
  observationId: string;
  bsci: number;
  alertLevel: string;
  direction: string;
  detectorScores: DetectorResult[];
  aiComment: string;
  aiTokensUsed: number;
  savedToPg: boolean;
  savedToRedis: boolean;
  error?: string;
}

/**
 * Полный цикл AI Observer:
 * 1. Собирает рыночные данные
 * 2. Запускает 10 детекторов
 * 3. Вычисляет BSCI
 * 4. Генерирует AI комментарий
 * 5. Сохраняет в PostgreSQL + Redis
 *
 * @param ticker — тикер для анализа
 * @param slot — номер слота (0-5), если не указан — автоопределение
 * @param skipAI — пропустить генерацию AI комментария (для тестов)
 */
export async function generateObservation(
  ticker: string = 'SBER',
  slot?: number,
  skipAI: boolean = false,
): Promise<GenerateObservationResult> {
  const startTime = Date.now();

  try {
    // 1. Определяем слот
    const currentSlot = getCurrentSlot();
    const activeSlot = slot ?? currentSlot.slot;
    const slotInfo = OBSERVER_SLOTS[activeSlot] || OBSERVER_SLOTS[0];

    console.log(`[generate-observation] Starting slot=${activeSlot} (${slotInfo.name}) for ${ticker}`);

    // 2. Собираем рыночные данные
    const { detectorInput, marketSnapshot } = await collectMarketData(ticker);

    // 3. Загружаем текущие веса BSCI из PostgreSQL
    const weightsRows = await prisma.bsciWeight.findMany();
    const weights: Record<string, number> = {};
    for (const w of weightsRows) {
      weights[w.detector] = w.weight;
    }
    // Если веса не найдены — используем равные 0.1
    if (Object.keys(weights).length === 0) {
      const detectorNames = ['GRAVITON', 'DARKMATTER', 'ACCRETOR', 'DECOHERENCE', 'HAWKING', 'PREDATOR', 'CIPHER', 'ENTANGLE', 'WAVEFUNCTION', 'ATTRACTOR'];
      for (const d of detectorNames) weights[d] = 0.1;
    }

    // 4. Запускаем все 10 детекторов
    const detectorScores = runAllDetectors(detectorInput);

    // 5. Вычисляем BSCI
    const bsciResult = calcBSCI(detectorScores, weights);

    console.log(`[generate-observation] BSCI=${bsciResult.bsci.toFixed(3)} (${bsciResult.alertLevel}) dir=${bsciResult.direction} top=${bsciResult.topDetector}`);

    // 6. AI комментарий
    let aiComment = '';
    let aiTokensUsed = 0;

    if (!skipAI) {
      const aiResult = await generateAIComment(bsciResult, marketSnapshot as Record<string, any>);
      aiComment = aiResult.comment;
      aiTokensUsed = aiResult.tokensUsed;
    } else {
      aiComment = generateFallbackComment(bsciResult);
    }

    // 7. Получаем ID предыдущего наблюдения (для связности)
    const lastObs = await prisma.observation.findFirst({
      where: { ticker },
      orderBy: { timestamp: 'desc' },
      select: { id: true },
    });

    // 8. Сохраняем наблюдение
    const input: ObservationInput = {
      ticker,
      slot: activeSlot,
      slotName: slotInfo.name,
      bsci: bsciResult.bsci,
      alertLevel: bsciResult.alertLevel,
      direction: bsciResult.direction,
      confidence: bsciResult.scores.reduce((max, s) => Math.max(max, s.confidence), 0),
      aiComment,
      aiTokensUsed,
      marketSnapshot: marketSnapshot as Record<string, unknown>,
      previousObsId: lastObs?.id,
      detectorScores: detectorScores.map(ds => ({
        detector: ds.detector,
        score: ds.score,
        confidence: ds.confidence,
        signal: ds.signal,
        metadata: ds.metadata as Record<string, unknown>,
      })),
    };

    const saveResult: SaveResult = await saveObservation(input);

    const elapsed = Date.now() - startTime;
    console.log(`[generate-observation] Done in ${elapsed}ms: id=${saveResult.observationId} pg=${saveResult.savedToPg} redis=${saveResult.savedToRedis}`);

    return {
      success: saveResult.savedToPg,
      observationId: saveResult.observationId,
      bsci: bsciResult.bsci,
      alertLevel: bsciResult.alertLevel,
      direction: bsciResult.direction,
      detectorScores,
      aiComment,
      aiTokensUsed,
      savedToPg: saveResult.savedToPg,
      savedToRedis: saveResult.savedToRedis,
      error: saveResult.error,
    };
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[generate-observation] Error after ${elapsed}ms:`, error.message);
    return {
      success: false,
      observationId: '',
      bsci: 0,
      alertLevel: 'GREEN',
      direction: 'NEUTRAL',
      detectorScores: [],
      aiComment: '',
      aiTokensUsed: 0,
      savedToPg: false,
      savedToRedis: false,
      error: error.message,
    };
  }
}
