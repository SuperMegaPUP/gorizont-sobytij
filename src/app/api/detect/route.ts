import { NextRequest, NextResponse } from 'next/server';
import {
  detectBurstsMultiLevel,
  PATTERN_NAMES,
  DETECT_LEVELS,
  type TradeInput,
} from '@/lib/detect-engine';

// ─── Robot Detection Engine v2.0 — API Route ─────────────────────────────
// Вся логика детекции вынесена в src/lib/detect-engine.ts для тестирования
// Этот файл — только тонкий HTTP-слой

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { trades, ticker, figi, dailyVolume, dailyValue, source } = body || {};

    if (!trades || !Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json({ bursts: [], tradeCount: 0 });
    }

    const bursts = detectBurstsMultiLevel(
      trades as TradeInput[],
      ticker || 'UNKNOWN',
      figi || '',
      dailyVolume || 0,
      dailyValue || 0,
      source || 'api'
    );

    return NextResponse.json({
      bursts,
      tradeCount: trades.length,
      ticker: ticker || 'UNKNOWN',
      timestamp: Date.now() / 1000,
    });
  } catch (err: any) {
    console.error('Detect API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    patterns: Object.entries(PATTERN_NAMES).map(([k, v]) => ({ id: k, name: v })),
    levels: DETECT_LEVELS.map(l => ({
      name: l.name,
      labelRu: l.labelRu,
      windowSec: l.windowSec,
      minTrades: l.minTrades,
      maxAvgInterval: l.maxAvgInterval,
    })),
    burstConditions: {
      levels: DETECT_LEVELS.length,
      description: 'Multi-level: HFT(3s) + ALGO(10s) + STRUCTURAL(120s)',
    },
  });
}
