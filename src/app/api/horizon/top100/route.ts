// ─── /api/horizon/top100 — GET: TOP-100 Scanner Data ──────────────────────
// Returns cached TOP-100 scanner results from Redis
// If not cached, auto-triggers a batch scan (POST /api/horizon/scan?mode=top100)
// POST: Manual trigger for TOP-100 scan
//
// v2: Dynamic tickers from MOEX by turnover (not hardcoded)

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for TOP-100 scan

import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { scanBatch, TOP100_TICKERS, type TickerScanResult } from '../scan/route';
import { fetchTop100Tickers } from '@/lib/horizon/observer/collect-market-data';

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

    // 1. Get dynamic top-100 tickers from MOEX by turnover
    let tickersToScan = await fetchTop100Tickers();

    // 2. Fallback to hardcoded list if dynamic fetch fails
    if (tickersToScan.length < 20) {
      console.warn(`[/api/horizon/top100] Dynamic list only ${tickersToScan.length}, using hardcoded fallback`);
      tickersToScan = [...TOP100_TICKERS].map(t => ({ ...t, turnover: 0 }));
    }

    console.log(`[/api/horizon/top100] Scanning ${tickersToScan.length} tickers (dynamic from MOEX)`);

    // 3. Scan in batches: 20 at a time, 300ms delay (~15-30s total)
    const scannerData = await scanBatch(tickersToScan, 20, 300);

    // 4. Filter out tickers with no real data (BSCI ~0.04 = only ENTANGLE, no orderbook)
    const realData = scannerData.filter((t) => {
      // Ticker has real data if: BSCI > 0.05 OR has multiple detector scores > 0
      const activeDetectors = Object.values(t.detectorScores).filter(s => s > 0.1).length;
      return t.bsci > 0.05 || activeDetectors >= 3;
    });

    // 5. Sort by BSCI descending
    const sorted = realData.sort((a, b) => b.bsci - a.bsci);

    // 6. Save to Redis (30 min TTL)
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
    console.log(`[/api/horizon/top100] Done in ${elapsed}ms: ${sorted.length}/${scannerData.length} tickers with real data`);

    return NextResponse.json({
      success: true,
      count: sorted.length,
      totalScanned: scannerData.length,
      source: tickersToScan[0]?.turnover > 0 ? 'moex-dynamic' : 'hardcoded',
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
