// ─── /api/horizon/moex-extended ───────────────────────────────────────────
// Расширенные данные MOEX ISS для Горизонта событий
// Стакан 50 уровней, сделки с BUYSELL, RVI, OI фьючерсов
// Fallback: ISS (бесплатный) → APIM (с MOEX_JWT)

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const ISS_BASE = 'https://iss.moex.com';
const APIM_BASE = 'https://apim.moex.com';

function getJWT(): string {
  return (process.env.MOEX_JWT || '').trim();
}

/** Умный fetch — ISS (публичный) с fallback на APIM (авторизованный) */
async function moexFetch(path: string): Promise<any> {
  // 1. Пробуем публичный ISS
  try {
    const issUrl = `${ISS_BASE}${path}`;
    const res = await fetch(issUrl, {
      headers: {
        'User-Agent': 'robot-detector-terminal/3.1',
        'Accept': 'application/json',
      },
      cache: 'no-store' as RequestCache,
      signal: AbortSignal.timeout(8000),
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('json')) {
      return await res.json();
    }
    // ISS вернул HTML или ошибку — fallback на APIM
  } catch {
    // ISS timeout/error — fallback
  }

  // 2. APIM с авторизацией
  const jwt = getJWT();
  if (!jwt) {
    throw new Error(`ISS returned HTML and no MOEX_JWT for fallback. Path: ${path}`);
  }

  const apimUrl = `${APIM_BASE}${path}`;
  const res = await fetch(apimUrl, {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'User-Agent': 'robot-detector-terminal/3.1',
      'Accept': 'application/json',
    },
    cache: 'no-store' as RequestCache,
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`APIM ${res.status} for ${path}`);
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    throw new Error(`APIM returned non-JSON: ${ct} for ${path}`);
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

/** Стакан 50 уровней
 *  MOEX ISS: orderbook.bid/ask (ЕДИНСТВЕННОЕ число!)
 */
async function getOrderbook(ticker: string, depth: number = 50) {
  const path = `/iss/engines/stock/markets/shares/boards/TQBR/securities/${ticker}/orderbook.json?iss.meta=off&iss.only=orderbook&depth=${depth}`;
  const data = await moexFetch(path);

  // MOEX ISS orderbook: bid/ask (SINGULAR), каждый уровень = [price, quantity, orders?]
  const bids = (data.orderbook?.bid || []).map((b: any[]) => ({
    price: Number(b[0]),
    quantity: Number(b[1]),
  }));

  const asks = (data.orderbook?.ask || []).map((a: any[]) => ({
    price: Number(a[0]),
    quantity: Number(a[1]),
  }));

  return { bids, asks, ticker, depth, ts: Date.now() };
}

/** Сделки с BUYSELL */
async function getTrades(ticker: string, limit: number = 100) {
  const path = `/iss/engines/stock/markets/shares/boards/TQBR/securities/${ticker}/trades.json?limit=${limit}`;
  const data = await moexFetch(path);

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
  const path = '/iss/statistics/engines/stock/volatility/RVI.json';
  const data = await moexFetch(path);
  const rows = parseIssGrid(data.rvi);
  return rows.length > 0 ? rows[rows.length - 1] : null;
}

/** OI фьючерсов */
async function getFuturesOI() {
  const path = '/iss/engines/futures/markets/forts/securities.json';
  const data = await moexFetch(path);
  const rows = parseIssGrid(data.securities);
  const targets = ['MX', 'Si', 'RI', 'BR'];
  return rows.filter((r) =>
    targets.some((t) => String(r.SECCODE || '').startsWith(t))
  );
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action') || 'orderbook';
  const ticker = (searchParams.get('ticker') || 'SBER').toUpperCase();

  try {
    switch (action) {
      // DEBUG: raw MOEX API response — показывает что реально вернул APIM
      case 'debug-orderbook': {
        const path = `/iss/engines/stock/markets/shares/boards/TQBR/securities/${ticker}/orderbook.json?depth=10`;
        let source = 'none';
        let raw: any = null;
        let error: string | null = null;

        // 1. ISS public
        try {
          const res = await fetch(`${ISS_BASE}${path}`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'horizon-debug/1.0' },
            cache: 'no-store' as RequestCache,
            signal: AbortSignal.timeout(8000),
          });
          const ct = res.headers.get('content-type') || '';
          if (res.ok && ct.includes('json')) {
            raw = await res.json();
            source = 'ISS';
          } else {
            source = `ISS-${res.status}-${ct}`;
          }
        } catch (e: any) {
          source = `ISS-error: ${e.message}`;
        }

        // 2. APIM with JWT
        if (!raw) {
          const jwt = getJWT();
          if (jwt) {
            try {
              const res = await fetch(`${APIM_BASE}${path}`, {
                headers: {
                  'Authorization': `Bearer ${jwt}`,
                  'Accept': 'application/json',
                  'User-Agent': 'horizon-debug/1.0',
                },
                cache: 'no-store' as RequestCache,
                signal: AbortSignal.timeout(10000),
              });
              if (res.ok) {
                const ct = res.headers.get('content-type') || '';
                if (ct.includes('json')) {
                  raw = await res.json();
                  source = 'APIM';
                } else {
                  source = `APIM-non-JSON: ${ct}`;
                }
              } else {
                const body = await res.text().catch(() => '');
                error = `APIM ${res.status}: ${body.slice(0, 300)}`;
                source = 'APIM-error';
              }
            } catch (e: any) {
              error = e.message;
              source = 'APIM-exception';
            }
          } else {
            source = 'no-MOEX_JWT';
          }
        }

        // Analyze orderbook structure
        const analysis: Record<string, any> = {
          source,
          ticker,
          hasOrderbookKey: raw?.orderbook !== undefined,
          orderbookKeys: raw?.orderbook ? Object.keys(raw.orderbook) : [],
          bidCount: raw?.orderbook?.bid?.length ?? raw?.orderbook?.bids?.length ?? 'N/A',
          askCount: raw?.orderbook?.ask?.length ?? raw?.orderbook?.asks?.length ?? 'N/A',
          topKey: raw ? Object.keys(raw) : [],
          error,
        };

        return NextResponse.json({ analysis, raw: raw ? JSON.stringify(raw).slice(0, 2000) : null });
      }

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
        const [ob, trades, rvi, futuresOI] = await Promise.allSettled([
          getOrderbook(ticker, 50),
          getTrades(ticker, 100),
          getRVI(),
          getFuturesOI(),
        ]);

        return NextResponse.json({
          ticker,
          orderbook: ob.status === 'fulfilled' ? ob.value : { error: String(ob.reason?.message || ob.reason) },
          trades: trades.status === 'fulfilled' ? trades.value : { error: String(trades.reason?.message || trades.reason) },
          rvi: rvi.status === 'fulfilled' ? rvi.value : { error: String(rvi.reason?.message || rvi.reason) },
          futuresOI: futuresOI.status === 'fulfilled' ? futuresOI.value : { error: String(futuresOI.reason?.message || futuresOI.reason) },
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
