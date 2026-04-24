// ─── /api/algopack ─────────────────────────────────────────────────────────
// СТАКАН-СКАНЕР + ЛОКАТОР КРУПНЯКА
// Один endpoint — все данные AlgoPack (obstats + tradestats + orderstats)
//
// GET /api/algopack
// GET /api/algopack?action=walls     — ТОП стен стакана
// GET /api/algopack?action=accum     — ТОП институционального накопления
// GET /api/algopack?action=all       — Всё вместе (default)

import { NextRequest, NextResponse } from 'next/server';
import { fetchAlgoPack, type AlgoPackResult } from '@/lib/moex-algopack';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'all';
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 100);

  try {
    const result: AlgoPackResult = await fetchAlgoPack();

    switch (action) {
      case 'walls': {
        return NextResponse.json({
          walls: result.walls.slice(0, limit),
          totalTickers: result.totalTickers,
          source: result.source,
          tradetime: result.tradetime,
          date: result.date,
        });
      }

      case 'accum': {
        return NextResponse.json({
          accumulations: result.accumulations.slice(0, limit),
          spoofingTickers: result.spoofingTickers.slice(0, 5),
          totalTickers: result.totalTickers,
          source: result.source,
          tradetime: result.tradetime,
          date: result.date,
        });
      }

      case 'all':
      default: {
        return NextResponse.json({
          walls: result.walls.slice(0, limit),
          accumulations: result.accumulations.slice(0, limit),
          spoofingTickers: result.spoofingTickers.slice(0, 5),
          totalTickers: result.totalTickers,
          source: result.source,
          tradetime: result.tradetime,
          date: result.date,
        });
      }
    }
  } catch (err: any) {
    console.error('[ALGOPACK] API error:', err);
    return NextResponse.json({
      walls: [],
      accumulations: [],
      spoofingTickers: [],
      totalTickers: 0,
      source: 'error',
      tradetime: '',
      date: '',
      error: err.message,
    }, { status: 500 });
  }
}
