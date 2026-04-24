// ─── /api/horizon/heatmap — GET: BSCI Heatmap Data ────────────────────────
// Returns hourly aggregated BSCI data for the heatmap visualization
// Params: hours (default 8), ticker (optional filter)
//
// v2: Fallback to scanner cache if bsci_log is empty (live data)

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import redis from '@/lib/redis';

export interface HeatmapCell {
  ticker: string;
  hour: number;
  avgBsci: number;
  maxBsci: number;
  alertLevel: string;
  count: number;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const hours = Math.min(Number(params.get('hours') || 8), 72);
    const ticker = params.get('ticker')?.toUpperCase() || undefined;

    const since = new Date(Date.now() - hours * 3600000);

    // 1. Try bsci_log first (historical data)
    const logs = await prisma.bsciLog.findMany({
      where: {
        timestamp: { gte: since },
        ...(ticker ? { ticker } : {}),
      },
      orderBy: { timestamp: 'asc' },
    });

    // 2. If no logs, fall back to scanner cache (current snapshot)
    let heatmap: HeatmapCell[];

    if (logs.length > 0) {
      // Aggregate bsci_log by ticker + hour
      const buckets: Record<string, {
        ticker: string;
        hour: number;
        bsciSum: number;
        maxBsci: number;
        alertLevels: Record<string, number>;
        count: number;
      }> = {};

      for (const log of logs) {
        const mskTime = new Date(log.timestamp.getTime() + (3 * 60 + log.timestamp.getTimezoneOffset()) * 60000);
        const hour = mskTime.getHours();
        const key = `${log.ticker}:${hour}`;

        if (!buckets[key]) {
          buckets[key] = {
            ticker: log.ticker,
            hour,
            bsciSum: 0,
            maxBsci: 0,
            alertLevels: {},
            count: 0,
          };
        }

        const bucket = buckets[key];
        bucket.bsciSum += log.bsci;
        bucket.maxBsci = Math.max(bucket.maxBsci, log.bsci);
        bucket.count += 1;

        const al = log.alertLevel || 'GREEN';
        bucket.alertLevels[al] = (bucket.alertLevels[al] || 0) + 1;
      }

      heatmap = Object.values(buckets).map((b) => {
        const dominantAlert = Object.entries(b.alertLevels).reduce(
          (top, [level, count]) => (count > (b.alertLevels[top] || 0) ? level : top),
          'GREEN',
        );

        return {
          ticker: b.ticker,
          hour: b.hour,
          avgBsci: Math.round((b.bsciSum / b.count) * 1000) / 1000,
          maxBsci: Math.round(b.maxBsci * 1000) / 1000,
          alertLevel: dominantAlert,
          count: b.count,
        };
      });
    } else {
      // Fallback: build heatmap from current scanner cache
      heatmap = await buildFromScannerCache(ticker);
    }

    return NextResponse.json({
      success: true,
      hours,
      count: heatmap.length,
      data: heatmap,
      source: logs.length > 0 ? 'bsci_log' : 'scanner_cache',
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/heatmap] GET error:', error);
    return NextResponse.json(
      { error: error.message, data: [], ts: Date.now() },
      { status: 500 },
    );
  }
}

/**
 * Build heatmap cells from scanner cache in Redis
 * Uses current scanner snapshot as "now" data point
 */
async function buildFromScannerCache(tickerFilter?: string): Promise<HeatmapCell[]> {
  const now = new Date();
  const mskOffset = 3;
  const currentHour = (now.getUTCHours() + mskOffset) % 24;

  const cells: HeatmapCell[] = [];

  // Read core scanner data
  try {
    const coreRaw = await redis.get('horizon:scanner:latest');
    if (coreRaw) {
      const coreData = JSON.parse(coreRaw);
      if (Array.isArray(coreData)) {
        for (const d of coreData) {
          if (tickerFilter && d.ticker !== tickerFilter) continue;
          if (d.bsci > 0) {
            cells.push({
              ticker: d.ticker,
              hour: currentHour,
              avgBsci: Math.round(d.bsci * 1000) / 1000,
              maxBsci: Math.round(d.bsci * 1000) / 1000,
              alertLevel: d.alertLevel || 'GREEN',
              count: 1,
            });
          }
        }
      }
    }
  } catch (e: any) {
    console.warn('[/api/horizon/heatmap] Core cache read failed:', e.message);
  }

  // Read top100 scanner data
  try {
    const top100Raw = await redis.get('horizon:scanner:top100');
    if (top100Raw) {
      const top100Data = JSON.parse(top100Raw);
      if (Array.isArray(top100Data)) {
        for (const d of top100Data) {
          if (tickerFilter && d.ticker !== tickerFilter) continue;
          // Only include tickers with significant BSCI (not fakes)
          if (d.bsci > 0.05) {
            cells.push({
              ticker: d.ticker,
              hour: currentHour,
              avgBsci: Math.round(d.bsci * 1000) / 1000,
              maxBsci: Math.round(d.bsci * 1000) / 1000,
              alertLevel: d.alertLevel || 'GREEN',
              count: 1,
            });
          }
        }
      }
    }
  } catch (e: any) {
    console.warn('[/api/horizon/heatmap] Top100 cache read failed:', e.message);
  }

  return cells;
}
