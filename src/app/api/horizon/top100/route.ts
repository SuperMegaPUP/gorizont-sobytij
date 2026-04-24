// ─── /api/horizon/top100 — GET: TOP-100 Scanner Data ──────────────────────
// Returns cached TOP-100 scanner results from Redis
// If not cached, auto-triggers a batch scan (POST /api/horizon/scan?mode=top100)
// POST: Manual trigger for TOP-100 scan

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for TOP-100 scan

import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { scanBatch, TOP100_TICKERS, type TickerScanResult } from '../scan/route';

export async function GET(_request: NextRequest) {
  try {
    // Try to read from Redis cache first
    const raw = await redis.get('horizon:scanner:top100');

    if (raw) {
      const data = JSON.parse(raw);
      // Sort by BSCI descending for TOP display
      const sorted = (data as TickerScanResult[]).sort((a: TickerScanResult, b: TickerScanResult) => b.bsci - a.bsci);
      return NextResponse.json({
        success: true,
        count: sorted.length,
        data: sorted,
        ts: Date.now(),
        cached: true,
      });
    }

    // No cached data — return empty, frontend should trigger POST
    return NextResponse.json({
      success: true,
      count: 0,
      data: [],
      ts: Date.now(),
      cached: false,
      hint: 'POST to /api/horizon/top100 to start scanning',
    });
  } catch (error: any) {
    console.error('[/api/horizon/top100] GET error:', error);
    return NextResponse.json(
      { error: error.message, data: [], ts: Date.now() },
      { status: 500 },
    );
  }
}

export async function POST(_request: NextRequest) {
  const startTime = Date.now();

  try {
    console.log('[/api/horizon/top100] Starting TOP-100 batch scan...');

    // Scan TOP 100 in batches: 20 at a time, 300ms delay (~15-30s total)
    const scannerData = await scanBatch(TOP100_TICKERS, 20, 300);

    // Sort by BSCI descending
    const sorted = scannerData.sort((a, b) => b.bsci - a.bsci);

    // Save to Redis (30 min TTL)
    try {
      await redis.setex(
        'horizon:scanner:top100',
        1800,
        JSON.stringify(sorted),
      );
    } catch (redisErr: any) {
      console.warn('[/api/horizon/top100] Redis save failed:', redisErr.message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[/api/horizon/top100] Done in ${elapsed}ms: ${sorted.length} tickers scanned`);

    return NextResponse.json({
      success: true,
      count: sorted.length,
      data: sorted,
      elapsed,
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/top100] POST error:', error);
    return NextResponse.json(
      { error: error.message, ts: Date.now() },
      { status: 500 },
    );
  }
}
