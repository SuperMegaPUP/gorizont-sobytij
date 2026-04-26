// ─── /api/horizon/signals — GET: Активные сигналы + история ─────────────────
// Возвращает активные сигналы из Redis и историю из PostgreSQL.
// Опционально запускает генерацию новых сигналов из последнего скана.

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';
import prisma from '@/lib/db';

// ─── GET: Получить сигналы ───────────────────────────────────────────────────

const SIGNALS_REDIS_KEY = 'horizon:signals:active';
const SIGNALS_REDIS_TTL = 14400; // 4 часа (максимум TTL)

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const mode = url.searchParams.get('mode'); // 'active' | 'history'
    const ticker = url.searchParams.get('ticker');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    if (mode === 'history' || ticker) {
      // История сигналов из PostgreSQL
      return await getSignalHistory(ticker, limit);
    }

    // Активные сигналы из Redis
    return await getActiveSignals();
  } catch (error: any) {
    console.error('[/api/horizon/signals] Error:', error);
    return NextResponse.json(
      { error: error.message, ts: Date.now() },
      { status: 500 },
    );
  }
}

/**
 * Получить активные сигналы из Redis.
 */
async function getActiveSignals() {
  let activeSignals: any[] = [];

  try {
    const cached = await redis.get(SIGNALS_REDIS_KEY);
    if (cached) {
      activeSignals = JSON.parse(cached);
    }
  } catch (e: any) {
    console.warn('[/api/horizon/signals] Redis read failed:', e.message);
  }

  // Фильтруем протухшие сигналы
  const now = Date.now();
  activeSignals = activeSignals.filter(s => {
    const expiresAt = new Date(s.expiresAt).getTime();
    return expiresAt > now && s.state === 'ACTIVE';
  });

  // Считаем статистику
  const stats = {
    total: activeSignals.length,
    longs: activeSignals.filter(s => s.type === 'LONG').length,
    shorts: activeSignals.filter(s => s.type === 'SHORT').length,
    awaits: activeSignals.filter(s => s.type === 'AWAIT').length,
    breakouts: activeSignals.filter(s => s.type === 'BREAKOUT').length,
    avgConfidence: activeSignals.length > 0
      ? activeSignals.reduce((sum, s) => sum + s.confidence, 0) / activeSignals.length
      : 0,
  };

  return NextResponse.json({
    active: activeSignals,
    stats,
    ts: Date.now(),
  });
}

/**
 * Получить историю сигналов из PostgreSQL.
 */
async function getSignalHistory(ticker: string | null, limit: number) {
  // Пока таблицы signals нет в Prisma — возвращаем пустой результат
  // TODO: Добавить модель Signal в Prisma schema

  return NextResponse.json({
    history: [],
    count: 0,
    ticker: ticker || 'all',
    ts: Date.now(),
  });
}

// ─── POST: Обновить/сохранить сигналы ───────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { signals } = body as { signals: any[] };

    if (!signals || !Array.isArray(signals)) {
      return NextResponse.json(
        { error: 'signals array required' },
        { status: 400 },
      );
    }

    // Сохраняем в Redis (заменяя все активные сигналы)
    try {
      await redis.setex(
        SIGNALS_REDIS_KEY,
        SIGNALS_REDIS_TTL,
        JSON.stringify(signals),
      );
    } catch (e: any) {
      console.warn('[/api/horizon/signals] Redis write failed:', e.message);
    }

    return NextResponse.json({
      success: true,
      count: signals.length,
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/signals] POST Error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }
}
