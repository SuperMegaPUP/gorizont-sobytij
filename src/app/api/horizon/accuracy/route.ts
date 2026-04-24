// ─── /api/horizon/accuracy ────────────────────────────────────────────────
// Точность наблюдений и адаптивных весов BSCI
// GET: статистика точности + обновление весов после верификации
// POST: верифицировать наблюдение (записать actualDirection)

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { updateWeightsAfterVerification } from '@/lib/horizon/bsci/save-observation';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ticker = searchParams.get('ticker')?.toUpperCase();

    // Общая статистика точности наблюдений
    const verifiedObs = await prisma.observation.findMany({
      where: {
        accuracyVerified: true,
        ...(ticker ? { ticker } : {}),
      },
      include: { detectorScores: true },
    });

    const total = verifiedObs.length;
    let correct = 0;
    const detectorStats: Record<string, { total: number; correct: number; accuracy: number }> = {};

    for (const obs of verifiedObs) {
      const obsCorrect = obs.direction === obs.actualDirection;
      if (obsCorrect) correct++;

      for (const ds of obs.detectorScores) {
        if (!detectorStats[ds.detector]) {
          detectorStats[ds.detector] = { total: 0, correct: 0, accuracy: 0 };
        }
        detectorStats[ds.detector].total++;
        if (ds.signal === obs.actualDirection) {
          detectorStats[ds.detector].correct++;
        }
      }
    }

    // Вычисляем accuracy для каждого детектора
    for (const key of Object.keys(detectorStats)) {
      const ds = detectorStats[key];
      ds.accuracy = ds.total > 0 ? ds.correct / ds.total : 0;
    }

    // Текущие веса BSCI
    const weights = await prisma.bsciWeight.findMany({
      orderBy: { weight: 'desc' },
    });

    return NextResponse.json({
      overall: {
        totalVerified: total,
        correct,
        accuracy: total > 0 ? correct / total : 0,
      },
      detectorStats,
      currentWeights: weights.map((w) => ({
        detector: w.detector,
        weight: w.weight,
        accuracy: w.accuracy,
        totalSignals: w.totalSignals,
        correctSignals: w.correctSignals,
      })),
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/accuracy] GET error:', error);
    return NextResponse.json(
      { error: error.message, ts: Date.now() },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.observationId || !body.actualDirection) {
      return NextResponse.json(
        { error: 'observationId and actualDirection are required' },
        { status: 400 }
      );
    }

    const validDirections = ['BULLISH', 'BEARISH', 'NEUTRAL'];
    if (!validDirections.includes(body.actualDirection)) {
      return NextResponse.json(
        { error: `actualDirection must be one of: ${validDirections.join(', ')}` },
        { status: 400 }
      );
    }

    // Обновляем веса BSCI на основе верификации
    const result = await updateWeightsAfterVerification(
      body.observationId,
      body.actualDirection
    );

    return NextResponse.json({
      success: true,
      observationId: body.observationId,
      actualDirection: body.actualDirection,
      weightsUpdated: result.updated,
      newWeights: result.weights,
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/accuracy] POST error:', error);
    return NextResponse.json(
      { error: error.message, ts: Date.now() },
      { status: 500 }
    );
  }
}
