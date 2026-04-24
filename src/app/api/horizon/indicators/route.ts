// ─── /api/horizon/indicators ──────────────────────────────────────────────
// Расчёт OFI, CumDelta, VPIN для тикера

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { calcOFI, calcWeightedOFI } from '@/lib/horizon/calculations/ofi';
import type { OrderBookData } from '@/lib/horizon/calculations/ofi';
import { calcCumDelta } from '@/lib/horizon/calculations/delta';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const ticker = (searchParams.get('ticker') || 'SBER').toUpperCase();

  try {
    // 1. Получаем стакан
    const obRes = await fetch(
      `http://${request.headers.get('host')}/api/horizon/moex-extended?action=orderbook&ticker=${ticker}&depth=50`,
      { cache: 'no-store' as RequestCache }
    );
    const obData = await obRes.json();

    const orderbook: OrderBookData = {
      bids: (obData.bids || []).map((b: any) => ({ price: b.price, quantity: b.quantity })),
      asks: (obData.asks || []).map((a: any) => ({ price: a.price, quantity: a.quantity })),
    };

    // 2. Получаем сделки
    const tradesRes = await fetch(
      `http://${request.headers.get('host')}/api/horizon/moex-extended?action=trades&ticker=${ticker}&limit=200`,
      { cache: 'no-store' as RequestCache }
    );
    const tradesData = await tradesRes.json();

    const trades = (tradesData.trades || []).map((t: any) => ({
      price: t.price,
      quantity: t.quantity,
      direction: t.direction,
      timestamp: t.timestamp,
    }));

    // 3. Рассчитываем индикаторы
    const ofi = calcOFI(orderbook);
    const weightedOFI = calcWeightedOFI(orderbook);
    const cumDelta = calcCumDelta(trades);

    return NextResponse.json({
      ticker,
      ofi,
      weightedOFI,
      cumDelta,
      orderbook: {
        bidLevels: orderbook.bids.length,
        askLevels: orderbook.asks.length,
        bidVolume: orderbook.bids.reduce((s, b) => s + b.quantity, 0),
        askVolume: orderbook.asks.reduce((s, a) => s + a.quantity, 0),
      },
      tradesCount: trades.length,
      ts: Date.now(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message, ticker, ts: Date.now() },
      { status: 502 }
    );
  }
}
