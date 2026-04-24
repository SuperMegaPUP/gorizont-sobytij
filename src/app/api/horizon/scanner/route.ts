// ─── /api/horizon/scanner — GET: Latest Scanner Data ─────────────────────
// Reads the latest scanner results from Redis key `horizon:scanner:latest`
// If not in Redis, returns empty array

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

export async function GET(_request: NextRequest) {
  try {
    const raw = await redis.get('horizon:scanner:latest');

    if (!raw) {
      return NextResponse.json({
        success: true,
        count: 0,
        data: [],
        ts: Date.now(),
      });
    }

    const data = JSON.parse(raw);

    return NextResponse.json({
      success: true,
      count: Array.isArray(data) ? data.length : 0,
      data,
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/scanner] GET error:', error);
    return NextResponse.json(
      { error: error.message, data: [], ts: Date.now() },
      { status: 500 },
    );
  }
}
