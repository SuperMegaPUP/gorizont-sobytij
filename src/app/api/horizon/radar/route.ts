// ─── /api/horizon/radar — GET: Radar Dot Data ─────────────────────────────
// Reads from BOTH horizon:scanner:latest (core 9) AND horizon:scanner:top100
// Combines, deduplicates by ticker, and calculates radar dot data
// Each ticker → dot with position (cumDelta, vpin), size (bsci * sqrt(turnover)), color (alertLevel)
//
// v2: Combined data source (core + top100), no auto-trigger scan on radar GET

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

export interface RadarDot {
  ticker: string;
  bsci: number;
  alertLevel: string;
  direction: string;
  turnover: number;
  dotSize: number;
  cumDelta: number;
  vpin: number;
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
    // Core scanner uses short codes (SR, GZ), TOP-100 uses MOEX codes (SBER, GAZP)
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

    // 4. Filter out tickers with no real data (BSCI near 0 = only ENTANGLE)
    const realData = deduped.filter((d: any) => {
      const activeDetectors = Object.values(d.detectorScores || {}).filter((s: any) => Number(s) > 0.1).length;
      return (d.bsci || 0) > 0.05 || activeDetectors >= 3;
    });

    // 4.5 Smart filtering for radar clarity
    // Always include: YELLOW+ alerts (BSCI > 0.2), core 9, top-15 by BSCI
    // This prevents the "80 dots mess" problem
    const coreSet = new Set(['MX', 'Si', 'RI', 'BR', 'GZ', 'GK', 'SR', 'LK', 'RN',
      'MOEX', 'SBER', 'GAZP', 'GMKN', 'LKOH', 'ROSN']); // + MOEX equivalents
    const alertData = realData.filter((d: any) => {
      const norm = normalizeTicker(d.ticker);
      return (d.bsci || 0) > 0.2 || coreSet.has(d.ticker) || coreSet.has(norm);
    });
    // Add top-15 by BSCI (in case they're not in alert/core sets)
    const byBsci = [...realData].sort((a: any, b: any) => (b.bsci || 0) - (a.bsci || 0));
    const top15 = byBsci.slice(0, 15);
    const radarSource = new Map<string, any>();
    for (const d of alertData) radarSource.set(d.ticker, d);
    for (const d of top15) {
      if (!radarSource.has(d.ticker)) radarSource.set(d.ticker, d);
    }
    const radarInput = Array.from(radarSource.values());

    // 5. Calculate radar dots (from filtered radarInput)
    const maxTurnover = Math.max(
      ...radarInput.map((d: any) => d.turnover || 0),
      1,
    );

    const cumDeltas = radarInput.map((d: any) => d.cumDelta || 0);
    const vpins = radarInput.map((d: any) => d.vpin || 0);

    const cumDeltaMax = Math.max(...cumDeltas.map(Math.abs), 1);
    const vpinMax = Math.max(...vpins, 1);

    const radarData: RadarDot[] = radarInput.map((d: any) => {
      const turnoverRatio = (d.turnover || 0) / maxTurnover;
      const dotSize = (d.bsci || 0) * Math.sqrt(turnoverRatio);

      // Use MOEX ticker as display name (more recognizable: SBER vs SR)
      const displayTicker = MOEX_TO_SHORT[d.ticker] ? d.ticker : normalizeTicker(d.ticker);

      return {
        ticker: displayTicker,
        bsci: d.bsci || 0,
        alertLevel: d.alertLevel || 'GREEN',
        direction: d.direction || 'NEUTRAL',
        turnover: d.turnover || 0,
        dotSize: Math.round(dotSize * 1000) / 1000,
        cumDelta: Math.round(((d.cumDelta || 0) / cumDeltaMax) * 1000) / 1000,
        vpin: Math.round(((d.vpin || 0) / vpinMax) * 1000) / 1000,
      };
    });

    // Sort by BSCI descending for consistent rendering order
    radarData.sort((a, b) => b.bsci - a.bsci);

    return NextResponse.json({
      success: true,
      count: radarData.length,
      source,
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
