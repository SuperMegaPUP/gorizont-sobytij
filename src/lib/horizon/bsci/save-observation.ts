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
 * η = 0.1 (learning rate)
 * Новое weight = weight + η × (1 - weight) если верный сигнал
 * Новое weight = weight - η × weight если неверный сигнал
 * Нормализация: сумма весов = 1, минимум 0.02
 */
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

  const eta = 0.1; // learning rate
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
        weight: Math.max(0.02, newWeight), // минимальный вес 0.02
        accuracy,
        totalSignals,
        correctSignals,
      },
    });

    updatedWeights[score.detector] = Math.max(0.02, newWeight);
  }

  // Нормализация: сумма весов = 1
  const allWeights = await prisma.bsciWeight.findMany();
  const totalWeight = allWeights.reduce((sum, w) => sum + w.weight, 0);

  if (totalWeight > 0) {
    for (const w of allWeights) {
      const normalized = Math.max(0.02, w.weight / totalWeight);
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
