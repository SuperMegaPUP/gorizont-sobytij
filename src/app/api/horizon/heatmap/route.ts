// ─── /api/horizon/heatmap — GET: BSCI Heatmap Data ────────────────────────
// Returns hourly aggregated BSCI data for the heatmap visualization
// Params: hours (default 8), ticker (optional filter)

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

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

    // Query bsci_log for the specified time range
    const logs = await prisma.bsciLog.findMany({
      where: {
        timestamp: { gte: since },
        ...(ticker ? { ticker } : {}),
      },
      orderBy: { timestamp: 'asc' },
    });

    // Aggregate by ticker + hour
    const buckets: Record<string, {
      ticker: string;
      hour: number;
      bsciSum: number;
      maxBsci: number;
      alertLevels: Record<string, number>;
      count: number;
    }> = {};

    for (const log of logs) {
      // Convert to Moscow time (UTC+3)
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

    // Build result array
    const heatmap: HeatmapCell[] = Object.values(buckets).map((b) => {
      // Find dominant alert level
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

    return NextResponse.json({
      success: true,
      hours,
      count: heatmap.length,
      data: heatmap,
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
