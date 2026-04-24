// ─── /api/horizon/observations ────────────────────────────────────────────
// Запрос наблюдений с фильтрами и пагинацией
// GET: список наблюдений (с фильтрами по тикеру, уровню, дате)

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ticker = searchParams.get('ticker')?.toUpperCase();
    const alertLevel = searchParams.get('alertLevel')?.toUpperCase();
    const direction = searchParams.get('direction')?.toUpperCase();
    const verifiedOnly = searchParams.get('verified') === 'true';
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200);
    const offset = Number(searchParams.get('offset') || 0);
    const from = searchParams.get('from'); // ISO date string
    const to = searchParams.get('to');     // ISO date string

    const where: any = {};

    if (ticker) where.ticker = ticker;
    if (alertLevel) where.alertLevel = alertLevel;
    if (direction) where.direction = direction;
    if (verifiedOnly) where.accuracyVerified = true;

    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = new Date(from);
      if (to) where.timestamp.lte = new Date(to);
    }

    const [observations, total] = await Promise.all([
      prisma.observation.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
        include: { detectorScores: true },
      }),
      prisma.observation.count({ where }),
    ]);

    return NextResponse.json({
      observations,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/observations] GET error:', error);
    return NextResponse.json(
      { error: error.message, ts: Date.now() },
      { status: 500 }
    );
  }
}
