// ─── /api/horizon/bsci-history ────────────────────────────────────────────
// История BSCI (таймсерия) для графиков и аналитики
// GET: BSCI log с фильтрами

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ticker = searchParams.get('ticker')?.toUpperCase();
    const limit = Math.min(Number(searchParams.get('limit') || 100), 500);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const where: any = {};
    if (ticker) where.ticker = ticker;

    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = new Date(from);
      if (to) where.timestamp.lte = new Date(to);
    }

    const logs = await prisma.bsciLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    // Агрегация: средний BSCI по alertLevel
    const alertCounts: Record<string, number> = {};
    let avgBsci = 0;
    const detectorCounts: Record<string, number> = {};

    for (const log of logs) {
      alertCounts[log.alertLevel] = (alertCounts[log.alertLevel] || 0) + 1;
      avgBsci += log.bsci;
      if (log.topDetector) {
        detectorCounts[log.topDetector] = (detectorCounts[log.topDetector] || 0) + 1;
      }
    }

    if (logs.length > 0) avgBsci /= logs.length;

    // Текущие веса
    const weights = await prisma.bsciWeight.findMany({
      orderBy: { weight: 'desc' },
    });

    return NextResponse.json({
      logs,
      stats: {
        count: logs.length,
        avgBsci: Math.round(avgBsci * 1000) / 1000,
        alertCounts,
        topDetectors: Object.entries(detectorCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([detector, count]) => ({ detector, count })),
      },
      weights: weights.map((w) => ({
        detector: w.detector,
        weight: w.weight,
        accuracy: w.accuracy,
        totalSignals: w.totalSignals,
      })),
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/bsci-history] GET error:', error);
    return NextResponse.json(
      { error: error.message, ts: Date.now() },
      { status: 500 }
    );
  }
}
