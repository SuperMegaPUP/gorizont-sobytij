// ─── /api/horizon/radar — GET: Radar Dot Data ─────────────────────────────
// Reads horizon:scanner:latest from Redis and calculates radar dot data
// Each ticker → dot with position (cumDelta, vpin), size (bsci * sqrt(turnover)), color (alertLevel)

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

    const scannerData = JSON.parse(raw);

    if (!Array.isArray(scannerData) || scannerData.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        data: [],
        ts: Date.now(),
      });
    }

    // Find max turnover for normalization
    const maxTurnover = Math.max(
      ...scannerData.map((d: any) => d.turnover || 0),
      1, // at least 1 to avoid division by zero
    );

    // Find ranges for cumDelta and vpin normalization
    const cumDeltas = scannerData.map((d: any) => d.cumDelta || 0);
    const vpins = scannerData.map((d: any) => d.vpin || 0);

    const cumDeltaMax = Math.max(...cumDeltas.map(Math.abs), 1);
    const vpinMax = Math.max(...vpins, 1);

    // Build radar dots
    const radarData: RadarDot[] = scannerData.map((d: any) => {
      // dotSize = bsci * Math.sqrt(turnover / maxTurnover)
      const turnoverRatio = (d.turnover || 0) / maxTurnover;
      const dotSize = (d.bsci || 0) * Math.sqrt(turnoverRatio);

      return {
        ticker: d.ticker,
        bsci: d.bsci || 0,
        alertLevel: d.alertLevel || 'GREEN',
        direction: d.direction || 'NEUTRAL',
        turnover: d.turnover || 0,
        dotSize: Math.round(dotSize * 1000) / 1000,
        cumDelta: Math.round(((d.cumDelta || 0) / cumDeltaMax) * 1000) / 1000, // normalized -1..1
        vpin: Math.round(((d.vpin || 0) / vpinMax) * 1000) / 1000, // normalized 0..1
      };
    });

    return NextResponse.json({
      success: true,
      count: radarData.length,
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
