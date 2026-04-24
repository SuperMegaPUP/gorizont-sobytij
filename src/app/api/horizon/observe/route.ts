// ─── /api/horizon/observe ─────────────────────────────────────────────────
// POST: ручное сохранение наблюдения
// GET:  — список наблюдений по тикеру
//       — auto=1 → полный цикл AI Observer (cron mode)

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { saveObservation, type ObservationInput } from '@/lib/horizon/bsci/save-observation';
import { generateObservation } from '@/lib/horizon/observer/generate-observation';

// ─── POST: ручное создание наблюдения ──────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Валидация обязательных полей
    const required = ['ticker', 'slot', 'slotName', 'bsci', 'alertLevel', 'direction', 'detectorScores'];
    for (const field of required) {
      if (body[field] === undefined) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Валидация диапазонов
    if (body.bsci < 0 || body.bsci > 1) {
      return NextResponse.json({ error: 'bsci must be in [0, 1]' }, { status: 400 });
    }

    const validAlertLevels = ['GREEN', 'YELLOW', 'ORANGE', 'RED'];
    if (!validAlertLevels.includes(body.alertLevel)) {
      return NextResponse.json(
        { error: `alertLevel must be one of: ${validAlertLevels.join(', ')}` },
        { status: 400 }
      );
    }

    const validDirections = ['BULLISH', 'BEARISH', 'NEUTRAL'];
    if (!validDirections.includes(body.direction)) {
      return NextResponse.json(
        { error: `direction must be one of: ${validDirections.join(', ')}` },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.detectorScores) || body.detectorScores.length === 0) {
      return NextResponse.json(
        { error: 'detectorScores must be a non-empty array' },
        { status: 400 }
      );
    }

    const input: ObservationInput = {
      ticker: String(body.ticker).toUpperCase(),
      slot: Number(body.slot),
      slotName: String(body.slotName),
      bsci: Number(body.bsci),
      alertLevel: String(body.alertLevel),
      direction: String(body.direction),
      confidence: Number(body.confidence || 0),
      aiComment: body.aiComment ? String(body.aiComment) : undefined,
      aiTokensUsed: body.aiTokensUsed ? Number(body.aiTokensUsed) : undefined,
      marketSnapshot: body.marketSnapshot,
      previousObsId: body.previousObsId,
      detectorScores: body.detectorScores.map((ds: any) => ({
        detector: String(ds.detector),
        score: Number(ds.score),
        confidence: Number(ds.confidence || 0),
        signal: ds.signal ? String(ds.signal) : undefined,
        metadata: ds.metadata,
      })),
    };

    const result = await saveObservation(input);

    if (!result.savedToPg) {
      return NextResponse.json(
        { error: 'Failed to save to PostgreSQL', details: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      observationId: result.observationId,
      savedToPg: result.savedToPg,
      savedToRedis: result.savedToRedis,
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/observe] POST error:', error);
    return NextResponse.json(
      { error: error.message, ts: Date.now() },
      { status: 500 }
    );
  }
}

// ─── GET: список наблюдений или auto-наблюдение (cron) ──────────────────────

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const auto = params.get('auto');
    const ticker = (params.get('ticker') || 'SBER').toUpperCase();
    const limit = Math.min(Number(params.get('limit') || 10), 100);

    // ── Cron mode: auto=1 → полный цикл AI Observer ──
    if (auto === '1') {
      const slot = params.get('slot') ? Number(params.get('slot')) : undefined;
      const skipAI = params.get('skipAI') === '1';

      console.log(`[/api/horizon/observe] AUTO mode: ticker=${ticker} slot=${slot} skipAI=${skipAI}`);

      const result = await generateObservation(ticker, slot, skipAI);

      if (!result.success) {
        return NextResponse.json(
          {
            success: false,
            error: result.error,
            bsci: result.bsci,
            alertLevel: result.alertLevel,
            ts: Date.now(),
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        observationId: result.observationId,
        bsci: result.bsci,
        alertLevel: result.alertLevel,
        direction: result.direction,
        topDetector: result.detectorScores.length > 0
          ? result.detectorScores.reduce((top, ds) => ds.score > top.score ? ds : top, result.detectorScores[0]).detector
          : 'NONE',
        aiComment: result.aiComment,
        aiTokensUsed: result.aiTokensUsed,
        detectorCount: result.detectorScores.length,
        savedToPg: result.savedToPg,
        savedToRedis: result.savedToRedis,
        ts: Date.now(),
      });
    }

    // ── Normal mode: список наблюдений ──
    const observations = await prisma.observation.findMany({
      where: { ticker },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: { detectorScores: true },
    });

    return NextResponse.json({
      ticker,
      count: observations.length,
      observations,
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/observe] GET error:', error);
    return NextResponse.json(
      { error: error.message, ts: Date.now() },
      { status: 500 }
    );
  }
}
