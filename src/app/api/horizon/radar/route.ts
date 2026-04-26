// ─── /api/horizon/radar — GET: Radar Dot Data ─────────────────────────────
// Reads from BOTH horizon:scanner:latest (core 9) AND horizon:scanner:top100
// Combines, deduplicates by ticker, and calculates radar dot data
// Each ticker → dot with position (cumDelta, bsci), size (bsci-proportional), color (alertLevel)
//
// v3: Y-axis = BSCI, type field (FUTURE/STOCK), moexTurnover preserved

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

// BSCI пороги для квадрантов радара
export const BSCI_QUADRANT_THRESHOLD = [0.2, 0.4, 0.7] as const;

export interface RadarDot {
  ticker: string;
  bsci: number;
  alertLevel: string;
  direction: string;
  turnover: number;
  moexTurnover?: number;
  dotSize: number;
  cumDelta: number;
  vpin: number;
  type: 'FUTURE' | 'STOCK';
}

export async function GET(request: NextRequest) {
  try {
    // Read query param: source=all|core|top100
    const source = request.nextUrl.searchParams.get('source') || 'all';

    let combinedData: any[] = [];

    // 1. Read core scanner data (9 tickers)
    if (source === 'all' || source === 'core') {
      try {
        const coreRaw = await redis.get('horizon:scanner:latest');
        if (coreRaw) {
          const coreData = JSON.parse(coreRaw);
          if (Array.isArray(coreData)) combinedData.push(...coreData);
        }
      } catch (e: any) {
        console.warn('[/api/horizon/radar] Failed to read core data:', e.message);
      }
    }

    // 2. Read TOP-100 scanner data
    if (source === 'all' || source === 'top100') {
      try {
        const top100Raw = await redis.get('horizon:scanner:top100');
        if (top100Raw) {
          const top100Data = JSON.parse(top100Raw);
          if (Array.isArray(top100Data)) combinedData.push(...top100Data);
        }
      } catch (e: any) {
        console.warn('[/api/horizon/radar] Failed to read top100 data:', e.message);
      }
    }

    // 3. Deduplicate by ticker (resolve shortCode ↔ moexTicker duplicates)
    const SHORT_TO_MOEX: Record<string, string> = {
      'SR': 'SBER', 'GZ': 'GAZP', 'GK': 'GMKN', 'LK': 'LKOH',
      'RN': 'ROSN', 'MX': 'MOEX', 'Si': 'Si', 'RI': 'RI', 'BR': 'BR',
    };
    const MOEX_TO_SHORT: Record<string, string> = Object.fromEntries(
      Object.entries(SHORT_TO_MOEX).map(([k, v]) => [v, k]),
    );

    // Normalize ticker to MOEX code for dedup
    function normalizeTicker(t: string): string {
      return SHORT_TO_MOEX[t] || t;
    }

    const seen = new Map<string, any>();
    for (const d of combinedData) {
      if (!d.ticker) continue;
      const normKey = normalizeTicker(d.ticker);
      const existing = seen.get(normKey);
      // Keep the one with higher BSCI (more informative)
      if (!existing || (d.bsci || 0) > (existing.bsci || 0)) {
        seen.set(normKey, d);
      }
    }
    const deduped = Array.from(seen.values());

    if (deduped.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        data: [],
        ts: Date.now(),
        hint: 'No scanner data in Redis. Run POST /api/horizon/scan first.',
      });
    }

    // 4. Show ALL tickers on radar — do NOT filter by BSCI level!
    // Even on weekends when BSCI ≈ 0, users should see radar dots.
    // Core 9 futures are always visible (they may be GREEN = calm).
    // For very large datasets (>50), keep smart filtering by top-N + alerts.
    let radarInput: any[];
    if (deduped.length <= 50) {
      // Small dataset: show all
      radarInput = deduped;
    } else {
      // Large dataset: smart filter — alerts + futures + top-30 by BSCI
      const alertData = deduped.filter((d: any) => {
        const norm = normalizeTicker(d.ticker);
        const isFuture = d.type === 'FUTURE';
        return (d.bsci || 0) > 0.2 || isFuture || norm in MOEX_TO_SHORT;
      });
      const byBsci = [...deduped].sort((a: any, b: any) => (b.bsci || 0) - (a.bsci || 0));
      const top30 = byBsci.slice(0, 30);
      const radarSource = new Map<string, any>();
      for (const d of alertData) radarSource.set(d.ticker, d);
      for (const d of top30) {
        if (!radarSource.has(d.ticker)) radarSource.set(d.ticker, d);
      }
      radarInput = Array.from(radarSource.values());
    }

    // 5. Calculate radar dots (from filtered radarInput)
    const cumDeltas = radarInput.map((d: any) => d.cumDelta || 0);
    const bscis = radarInput.map((d: any) => d.bsci || 0);

    // Symmetric CumDelta scale: 0 is always at center
    const cumDeltaMax = Math.max(...cumDeltas.map(Math.abs), 1);
    // BSCI is already 0..1, no normalization needed — but we ensure range
    const bsciMax = Math.max(...bscis, 1);

    const radarData: RadarDot[] = radarInput.map((d: any) => {
      // Use MOEX ticker as display name (more recognizable: SBER vs SR)
      const displayTicker = MOEX_TO_SHORT[d.ticker] ? d.ticker : normalizeTicker(d.ticker);

      // Determine type: use d.type from scanner if available, otherwise check
      const tickerType: 'FUTURE' | 'STOCK' = d.type === 'FUTURE' ? 'FUTURE' : 'STOCK';

      return {
        ticker: displayTicker,
        bsci: d.bsci || 0,
        alertLevel: d.alertLevel || 'GREEN',
        direction: d.direction || 'NEUTRAL',
        turnover: d.turnover || 0,
        moexTurnover: d.moexTurnover,
        dotSize: Math.round((d.bsci || 0) * 1000) / 1000,
        cumDelta: Math.round(((d.cumDelta || 0) / cumDeltaMax) * 1000) / 1000,
        vpin: Math.round(((d.vpin || 0)) * 1000) / 1000,  // raw VPIN for tooltip
        type: tickerType,
      };
    });

    // Sort by BSCI descending for consistent rendering order
    radarData.sort((a, b) => b.bsci - a.bsci);

    return NextResponse.json({
      success: true,
      count: radarData.length,
      source,
      bsciThresholds: BSCI_QUADRANT_THRESHOLD,
      data: radarData,
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/radar] GET error:', error);
    return NextResponse.json(
      { error: error.message, data: [], ts: Date.now() },
      { status: 500 },
    );
  }
}
