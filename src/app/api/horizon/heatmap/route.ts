// ─── /api/horizon/heatmap — GET: BSCI Heatmap Data ────────────────────────
// Returns hourly aggregated BSCI data for the heatmap visualization
// Fixed 48h range with date+hour slots (not just hour 0-23)
//
// v3: 48h slots with date keys, fallback to scanner cache

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import redis from '@/lib/redis';

export interface HeatmapCell {
  ticker: string;
  /** Hour of day 0-23 */
  hour: number;
  /** Slot key: "DD/MM HH" — unique per date+hour for 48h grid */
  slotKey: string;
  /** Slot index 0..47 — position in the 48h timeline */
  slotIndex: number;
  avgBsci: number;
  maxBsci: number;
  alertLevel: string;
  count: number;
}

/**
 * Generate 48 hourly slots going back from now (MSK time)
 * Returns array of { slotKey, slotIndex, hour, date }
 */
function generateSlots() {
  const now = new Date();
  const mskOffset = 3;
  const nowMSK = new Date(now.getTime() + (mskOffset * 60 + now.getTimezoneOffset()) * 60000);

  const slots: { slotKey: string; slotIndex: number; hour: number; date: Date }[] = [];

  for (let i = 47; i >= 0; i--) {
    const slotDate = new Date(nowMSK.getTime() - i * 3600000);
    const hour = slotDate.getHours();
    const day = slotDate.getDate().toString().padStart(2, '0');
    const month = (slotDate.getMonth() + 1).toString().padStart(2, '0');
    const slotKey = `${day}/${month} ${hour.toString().padStart(2, '0')}`;
    const slotIndex = 47 - i;

    slots.push({ slotKey, slotIndex, hour, date: slotDate });
  }

  return slots;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const ticker = params.get('ticker')?.toUpperCase() || undefined;
    const hours = 48; // Fixed 48h

    const since = new Date(Date.now() - hours * 3600000);
    const slots = generateSlots();

    // 1. Try bsci_log first (historical data)
    const logs = await prisma.bsciLog.findMany({
      where: {
        timestamp: { gte: since },
        ...(ticker ? { ticker } : {}),
      },
      orderBy: { timestamp: 'asc' },
    });

    let heatmap: HeatmapCell[];

    if (logs.length > 0) {
      // Aggregate bsci_log by ticker + slotKey (date+hour)
      const buckets: Record<string, {
        ticker: string;
        slotKey: string;
        slotIndex: number;
        hour: number;
        bsciSum: number;
        maxBsci: number;
        alertLevels: Record<string, number>;
        count: number;
      }> = {};

      for (const log of logs) {
        const mskTime = new Date(log.timestamp.getTime() + (3 * 60 + log.timestamp.getTimezoneOffset()) * 60000);
        const hour = mskTime.getHours();
        const day = mskTime.getDate().toString().padStart(2, '0');
        const month = (mskTime.getMonth() + 1).toString().padStart(2, '0');
        const slotKey = `${day}/${month} ${hour.toString().padStart(2, '0')}`;

        // Find matching slot index
        const slot = slots.find((s) => s.slotKey === slotKey);
        if (!slot) continue; // Outside 48h window

        const key = `${log.ticker}:${slotKey}`;

        if (!buckets[key]) {
          buckets[key] = {
            ticker: log.ticker,
            slotKey,
            slotIndex: slot.slotIndex,
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
          slotKey: b.slotKey,
          slotIndex: b.slotIndex,
          avgBsci: Math.round((b.bsciSum / b.count) * 1000) / 1000,
          maxBsci: Math.round(b.maxBsci * 1000) / 1000,
          alertLevel: dominantAlert,
          count: b.count,
        };
      });
    } else {
      // Fallback: build heatmap from current scanner cache
      heatmap = await buildFromScannerCache(ticker, slots);
    }

    return NextResponse.json({
      success: true,
      hours,
      slots: slots.map((s) => ({ slotKey: s.slotKey, slotIndex: s.slotIndex, hour: s.hour })),
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
async function buildFromScannerCache(tickerFilter?: string, slots?: { slotKey: string; slotIndex: number; hour: number }[]): Promise<HeatmapCell[]> {
  const now = new Date();
  const mskOffset = 3;
  const currentHour = (now.getUTCHours() + mskOffset) % 24;

  // Current slot = last in the 48-slot array
  const currentSlot = slots ? slots[slots.length - 1] : { slotKey: `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')} ${currentHour.toString().padStart(2,'0')}`, slotIndex: 47, hour: currentHour };

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
              hour: currentSlot.hour,
              slotKey: currentSlot.slotKey,
              slotIndex: currentSlot.slotIndex,
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
          if (d.bsci > 0.05) {
            cells.push({
              ticker: d.ticker,
              hour: currentSlot.hour,
              slotKey: currentSlot.slotKey,
              slotIndex: currentSlot.slotIndex,
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
