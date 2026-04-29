// ─── /api/horizon/robot-context ───────────────────────────────────────────────
// GET: Robot Context для конкретного тикера
// Возвращает данные о робот-активности: паттерны, объём, подтверждение детекторов
//
// GET /api/horizon/robot-context?ticker=SBER
// GET /api/horizon/robot-context?ticker=SBER&topDetector=PREDATOR

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { calculateRobotContext, findTopDetector } from '@/lib/horizon/robot-context';
import { collectMarketData } from '@/lib/horizon/observer/collect-market-data';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return NextResponse.json(
      { error: 'Missing required parameter: ticker' },
      { status: 400 },
    );
  }

  try {
    // 1. Собираем рыночные данные (сделки для burst detection)
    const { detectorInput } = await collectMarketData(ticker, undefined, false, false);

    // 2. Определяем top-детектор (если не передан)
    const topDetector = searchParams.get('topDetector') || 'NONE';

    // 3. Вычисляем RobotContext
    const totalVolume = detectorInput.trades.reduce(
      (sum, t) => sum + t.quantity, 0,
    );

    const robotContext = await calculateRobotContext(
      ticker,
      detectorInput.trades.map(t => ({
        price: t.price,
        quantity: t.quantity,
        side: (t.side || (t.direction === 'B' ? 'BUY' : t.direction === 'S' ? 'SELL' : t.direction)) as 'BUY' | 'SELL',
        time: t.time || t.timestamp || Date.now(),
      })),
      topDetector,
      totalVolume,
    );

    return NextResponse.json({
      success: true,
      ticker,
      robotContext,
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error(`[/api/horizon/robot-context] Error for ${ticker}:`, error);
    return NextResponse.json(
      { error: error.message, ticker, ts: Date.now() },
      { status: 500 },
    );
  }
}
