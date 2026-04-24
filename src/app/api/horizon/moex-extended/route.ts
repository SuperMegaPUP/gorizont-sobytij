// ─── /api/horizon/moex-extended ───────────────────────────────────────────
// Расширенные данные MOEX ISS для Горизонта событий
// Стакан 50 уровней, сделки с BUYSELL, RVI, OI фьючерсов

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const ISS_BASE = 'https://iss.moex.com';

/** Проверка content-type — ISS может вернуть HTML вместо JSON */
async function issFetch(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'robot-detector-terminal/3.1' },
    cache: 'no-store' as RequestCache,
  });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    throw new Error(`ISS returned non-JSON: ${ct} for ${url}`);
  }
  return res.json();
}

/** Парсинг ISS формата { columns: [...], data: [[...], ...] } */
function parseIssGrid(raw: any): Record<string, any>[] {
  if (!raw?.columns || !raw?.data) return [];
  return raw.data.map((row: any[]) => {
    const obj: Record<string, any> = {};
    raw.columns.forEach((col: string, i: number) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

/** Стакан 50 уровней */
async function getOrderbook(ticker: string, depth: number = 50) {
  const url = `${ISS_BASE}/iss/engines/stock/markets/shares/boards/TQBR/securities/${ticker}/orderbook.json?depth=${depth}`;
  const data = await issFetch(url);

  const bids = (data.orderbook?.bids || []).map((b: any[]) => ({
    price: Number(b[0]),
    quantity: Number(b[1]),
  }));

  const asks = (data.orderbook?.asks || []).map((a: any[]) => ({
    price: Number(a[0]),
    quantity: Number(a[1]),
  }));

  return { bids, asks, ticker, depth, ts: Date.now() };
}

/** Сделки с BUYSELL */
async function getTrades(ticker: string, limit: number = 100) {
  const url = `${ISS_BASE}/iss/engines/stock/markets/shares/boards/TQBR/securities/${ticker}/trades.json?limit=${limit}`;
  const data = await issFetch(url);

  const rows = parseIssGrid(data.trades);
  return rows.map((t) => ({
    price: Number(t.PRICE || t.price || 0),
    quantity: Number(t.QUANTITY || t.quantity || 0),
    direction: String(t.BUYSELL || t.direction || ''),
    timestamp: Number(t.SYSTIME ? new Date(t.SYSTIME).getTime() : Date.now()),
  }));
}

/** RVI — Russian Volatility Index */
async function getRVI() {
  const url = `${ISS_BASE}/iss/statistics/engines/stock/volatility/RVI.json`;
  const data = await issFetch(url);
  const rows = parseIssGrid(data.rvi);
  return rows.length > 0 ? rows[rows.length - 1] : null;
}

/** OI фьючерсов */
async function getFuturesOI() {
  const url = `${ISS_BASE}/iss/engines/futures/markets/forts/securities.json`;
  const data = await issFetch(url);
  const rows = parseIssGrid(data.securities);
  // Фильтруем только основные фьючерсы
  const targets = ['MX', 'Si', 'RI', 'BR'];
  return rows.filter((r) =>
    targets.some((t) => String(r.SECCODE || '').startsWith(t))
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = request;
  const action = searchParams.get('action') || 'orderbook';
  const ticker = (searchParams.get('ticker') || 'SBER').toUpperCase();

  try {
    switch (action) {
      case 'orderbook': {
        const depth = Math.min(Number(searchParams.get('depth') || 50), 50);
        const ob = await getOrderbook(ticker, depth);
        return NextResponse.json(ob);
      }

      case 'trades': {
        const limit = Math.min(Number(searchParams.get('limit') || 100), 500);
        const trades = await getTrades(ticker, limit);
        return NextResponse.json({ ticker, trades, count: trades.length, ts: Date.now() });
      }

      case 'rvi': {
        const rvi = await getRVI();
        return NextResponse.json({ rvi, ts: Date.now() });
      }

      case 'futures-oi': {
        const oi = await getFuturesOI();
        return NextResponse.json({ futures: oi, count: oi.length, ts: Date.now() });
      }

      case 'all': {
        // Параллельный запрос всех данных для тикера
        const [ob, trades, rvi, futuresOI] = await Promise.allSettled([
          getOrderbook(ticker, 50),
          getTrades(ticker, 100),
          getRVI(),
          getFuturesOI(),
        ]);

        return NextResponse.json({
          ticker,
          orderbook: ob.status === 'fulfilled' ? ob.value : { error: ob.reason?.message },
          trades: trades.status === 'fulfilled' ? trades.value : { error: trades.reason?.message },
          rvi: rvi.status === 'fulfilled' ? rvi.value : { error: rvi.reason?.message },
          futuresOI: futuresOI.status === 'fulfilled' ? futuresOI.value : { error: futuresOI.reason?.message },
          ts: Date.now(),
        });
      }

      default:
        return NextResponse.json(
          { error: 'Unknown action', available: ['orderbook', 'trades', 'rvi', 'futures-oi', 'all'] },
          { status: 400 }
        );
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message, action, ticker, ts: Date.now() },
      { status: 502 }
    );
  }
}
