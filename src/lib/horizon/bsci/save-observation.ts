// ─── saveObservation — двухуровневое сохранение наблюдения ─────────────────
// HOT: Redis/Vercel KV (24h TTL, быстрый доступ для UI)
// COLD: PostgreSQL/Neon (постоянное хранение, аналитика)

import prisma from '@/lib/db';

export interface ObservationInput {
  ticker: string;
  slot: number;          // 0-5 (08:00=0, 10:30=1, ...)
  slotName: string;      // "Предрыночный скан", "Утренний паттерн" и т.д.
  bsci: number;          // 0..1
  alertLevel: string;    // GREEN / YELLOW / ORANGE / RED
  direction: string;     // BULLISH / BEARISH / NEUTRAL
  confidence: number;    // 0..1
  aiComment?: string;
  aiTokensUsed?: number;
  marketSnapshot?: Record<string, unknown>;
  previousObsId?: string;
  detectorScores: Array<{
    detector: string;    // GRAVITON, DARKMATTER, ...
    score: number;       // 0..1
    confidence: number;
    signal?: string;     // BULLISH / BEARISH / NEUTRAL
    metadata?: Record<string, unknown>;
  }>;
}

export interface SaveResult {
  observationId: string;
  savedToPg: boolean;
  savedToRedis: boolean;
  error?: string;
}

/**
 * Сохраняет наблюдение в PostgreSQL (COLD) + опционально в Redis (HOT)
 */
export async function saveObservation(input: ObservationInput): Promise<SaveResult> {
  let savedToPg = false;
  let savedToRedis = false;
  let observationId = '';

  // ─── COLD: PostgreSQL ──────────────────────────────────────────────────
  try {
    const observation = await prisma.observation.create({
      data: {
        ticker: input.ticker,
        slot: input.slot,
        slotName: input.slotName,
        bsci: input.bsci,
        alertLevel: input.alertLevel,
        direction: input.direction,
        confidence: input.confidence,
        aiComment: input.aiComment,
        aiTokensUsed: input.aiTokensUsed,
        marketSnapshot: input.marketSnapshot as any ?? undefined,
        previousObsId: input.previousObsId,
        detectorScores: {
          create: input.detectorScores.map((ds) => ({
            detector: ds.detector,
            score: ds.score,
            confidence: ds.confidence,
            signal: ds.signal,
            metadata: ds.metadata as any ?? undefined,
          })),
        },
      },
      include: { detectorScores: true },
    });

    observationId = observation.id;
    savedToPg = true;

    // Логируем BSCI для таймсерии
    await prisma.bsciLog.create({
      data: {
        ticker: input.ticker,
        bsci: input.bsci,
        alertLevel: input.alertLevel,
        topDetector: input.detectorScores.length > 0
          ? input.detectorScores.reduce((top, ds) => ds.score > top.score ? ds : top).detector
          : null,
        direction: input.direction,
      },
    });
  } catch (pgError: any) {
    console.error('[saveObservation] PostgreSQL error:', pgError.message);
    return { observationId: '', savedToPg: false, savedToRedis: false, error: pgError.message };
  }

  // ─── HOT: Redis (опционально — может не быть REDIS_URL) ──────────────
  try {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const redisKey = `horizon:obs:${input.ticker}:latest`;
      const payload = JSON.stringify({
        id: observationId,
        ticker: input.ticker,
        bsci: input.bsci,
        alertLevel: input.alertLevel,
        direction: input.direction,
        confidence: input.confidence,
        ts: Date.now(),
      });

      // Простой HTTP-запрос к Redis (Upstash REST API compatible)
      // Или через ioredis если доступен
      const { default: Redis } = await import('ioredis');
      const redis = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 3000 });
      await redis.setex(redisKey, 86400, payload); // 24h TTL
      await redis.quit();
      savedToRedis = true;
    }
  } catch (redisError: any) {
    // Redis ошибка НЕ критична — PostgreSQL — источник истины
    console.warn('[saveObservation] Redis warning:', redisError.message);
  }

  return { observationId, savedToPg, savedToRedis };
}

/**
 * Адаптивное обновление весов BSCI после верификации
 * η = 0.03 (learning rate, снижено с 0.1 в v4.1 — медленнее адаптация, стабильнее)
 * Новое weight = weight + η × (1 - weight) если верный сигнал
 * Новое weight = weight - η × weight если неверный сигнал
 * Нормализация: сумма весов = 1, минимум 0.04 (повышено с 0.02 в v4.1 — быстрее восстановление «мёртвых» детекторов)
 */

/**
 * П2: Мягкий daily weight decay (Sprint 5B)
 * w_k = 0.99 × w_k + 0.01 × (1/K)
 * 1% в день к равновесию → за 100 дней → 63% сдвиг
 * Решает «дрейф весов при длительном флете»
 *
 * Вызывать один раз в день (при первом наблюдении сессии)
 */
export async function applyDailyWeightDecay(): Promise<void> {
  const DECAY_FACTOR = 0.99;
  const EQUAL_WEIGHT = 1 / 10; // 1/K = 1/10

  try {
    const allWeights = await prisma.bsciWeight.findMany();
    if (allWeights.length === 0) return;

    // Check if already applied today (use Redis flag)
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        const { default: Redis } = await import('ioredis');
        const redis = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 3000 });
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const flagKey = `horizon:weight-decay:${today}`;
        const alreadyApplied = await redis.get(flagKey);
        if (alreadyApplied) {
          await redis.quit();
          return; // Already applied today
        }
        await redis.setex(flagKey, 86400, '1'); // 24h TTL
        await redis.quit();
      } catch {
        // Redis error — proceed anyway (idempotent operation)
      }
    }

    // Apply decay
    for (const w of allWeights) {
      const newWeight = DECAY_FACTOR * w.weight + (1 - DECAY_FACTOR) * EQUAL_WEIGHT;
      await prisma.bsciWeight.update({
        where: { detector: w.detector },
        data: { weight: Math.max(0.04, newWeight) },
      });
    }

    // Renormalize
    const updated = await prisma.bsciWeight.findMany();
    const total = updated.reduce((sum, w) => sum + w.weight, 0);
    if (total > 0) {
      for (const w of updated) {
        await prisma.bsciWeight.update({
          where: { detector: w.detector },
          data: { weight: Math.max(0.04, w.weight / total) },
        });
      }
    }

    console.log(`[BSCI] Daily weight decay applied (factor=${DECAY_FACTOR})`);
  } catch (e: any) {
    console.warn('[BSCI] Daily weight decay failed:', e.message);
  }
}
export async function updateWeightsAfterVerification(
  observationId: string,
  actualDirection: string
): Promise<{ updated: number; weights: Record<string, number> }> {
  // Получаем наблюдение с детекторами
  const observation = await prisma.observation.findUnique({
    where: { id: observationId },
    include: { detectorScores: true },
  });

  if (!observation) {
    throw new Error(`Observation ${observationId} not found`);
  }

  const eta = 0.03; // learning rate (v4.1: снижено с 0.1 для стабильности)
  const updatedWeights: Record<string, number> = {};

  for (const score of observation.detectorScores) {
    const weightRow = await prisma.bsciWeight.findUnique({
      where: { detector: score.detector },
    });

    if (!weightRow) continue;

    // Верный ли сигнал?
    const isCorrect = score.signal === actualDirection;
    const isNeutral = score.signal === 'NEUTRAL' || !score.signal;

    let newWeight = weightRow.weight;

    if (!isNeutral) {
      if (isCorrect) {
        // Поощряем: weight растёт
        newWeight = weightRow.weight + eta * (1 - weightRow.weight);
      } else {
        // Штрафуем: weight падает
        newWeight = weightRow.weight - eta * weightRow.weight;
      }
    }

    // Обновляем точность
    const totalSignals = weightRow.totalSignals + (isNeutral ? 0 : 1);
    const correctSignals = weightRow.correctSignals + (isCorrect && !isNeutral ? 1 : 0);
    const accuracy = totalSignals > 0 ? correctSignals / totalSignals : weightRow.accuracy;

    await prisma.bsciWeight.update({
      where: { detector: score.detector },
      data: {
        weight: Math.max(0.04, newWeight), // минимальный вес 0.04 (v4.1: повышено с 0.02)
        accuracy,
        totalSignals,
        correctSignals,
      },
    });

    updatedWeights[score.detector] = Math.max(0.04, newWeight);
  }

  // Нормализация: сумма весов = 1
  const allWeights = await prisma.bsciWeight.findMany();
  const totalWeight = allWeights.reduce((sum, w) => sum + w.weight, 0);

  if (totalWeight > 0) {
    for (const w of allWeights) {
      const normalized = Math.max(0.04, w.weight / totalWeight);
      await prisma.bsciWeight.update({
        where: { detector: w.detector },
        data: { weight: normalized },
      });
      updatedWeights[w.detector] = normalized;
    }
  }

  // Помечаем наблюдение как верифицированное
  await prisma.observation.update({
    where: { id: observationId },
    data: {
      accuracyVerified: true,
      actualDirection,
    },
  });

  return { updated: observation.detectorScores.length, weights: updatedWeights };
}
