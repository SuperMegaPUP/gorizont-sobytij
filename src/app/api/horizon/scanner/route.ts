// ─── /api/horizon/scanner — GET: Latest Scanner Data ─────────────────────
// Reads the latest scanner results from Redis key `horizon:scanner:latest`
// If not in Redis, auto-triggers a scan (POST to /api/horizon/scan) and returns results

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

export async function GET(_request: NextRequest) {
  try {
    const raw = await redis.get('horizon:scanner:latest');

    if (raw) {
      const data = JSON.parse(raw);
      return NextResponse.json({
        success: true,
        count: Array.isArray(data) ? data.length : 0,
        data,
        ts: Date.now(),
      });
    }

    // ─── Auto-trigger: no data in Redis → run scan ──────────────────────
    console.log('[/api/horizon/scanner] No cached data, auto-triggering scan...');

    try {
      const scanRes = await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/horizon/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (scanRes.ok) {
        const scanJson = await scanRes.json();
        return NextResponse.json({
          success: true,
          count: scanJson.count || 0,
          data: scanJson.data || [],
          ts: Date.now(),
          autoTriggered: true,
        });
      }
    } catch (scanErr: any) {
      console.warn('[/api/horizon/scanner] Auto-scan failed:', scanErr.message);
    }

    // Fallback: return empty
    return NextResponse.json({
      success: true,
      count: 0,
      data: [],
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
