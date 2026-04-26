import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MOEX_ISS_API = 'https://iss.moex.com/iss';
const MOEX_APIM_API = 'https://apim.moex.com/iss';
const MOEX_ALGOPACK_API = 'https://apim.moex.com/iss/datashop/algopack';

// КРИТИЧЕСКИ: MOEX_JWT (не MOEX_TOKEN!), с trim() — Vercel добавляет \n
function getJWT(): string {
  return (process.env.MOEX_JWT || '').trim();
}

function authHeaders(): Record<string, string> {
  const jwt = getJWT();
  return jwt ? { Authorization: `Bearer ${jwt}`, 'User-Agent': 'robot-detector-terminal/1.0' } : {};
}

interface MoexTrade {
  time: string;
  price: number;
  qty: number;
  direction: string;
  board: string;
  session: number;
}

// GET /api/moex?action=trades|candles|analyze|top|securities|orderbook&ticker=...
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'top';
  const ticker = searchParams.get('ticker') || 'SBER';

  try {
    switch (action) {
      case 'securities': {
        // Получить список акций Т+2 (Мосбиржа) — с авторизацией через APIM
        const res = await fetch(
          `${MOEX_APIM_API}/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,LOTSIZE,ISSUESIZE&marketdata.columns=SECID,VALTODAY,VOLTODAY,MARKETPRICE,OPEN,LOW,HIGH`,
          { headers: authHeaders(), cache: 'no-store' as RequestCache }
        );
        // Fallback на ISS без авторизации
        let data = !res.ok ? null : await res.json().catch(() => null);
        if (!data) {
          const fbRes = await fetch(
            `${MOEX_ISS_API}/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,LOTSIZE,ISSUESIZE&marketdata.columns=SECID,VALTODAY,VOLTODAY,MARKETPRICE,OPEN,LOW,HIGH`,
            { cache: 'no-store' as RequestCache }
          );
          data = await fbRes.json();
        }
        const securities = (data?.securities?.data || []).map((s: any) => ({
          ticker: s[0],
          name: s[1],
          lotSize: s[2],
          issueSize: s[3],
        }));
        const marketdata = (data?.marketdata?.data || []).map((m: any) => ({
          ticker: m[0],
          valueToday: m[1],
          volToday: m[2],
          marketPrice: m[3],
          open: m[4],
          low: m[5],
          high: m[6],
        }));
        // Merge
        const result = securities.map((sec: any) => {
          const md = marketdata.find((m: any) => m.ticker === sec.ticker) || {};
          return { ...sec, ...md };
        }).filter((s: any) => s.volToday > 0)
          .sort((a: any, b: any) => (b.valueToday || 0) - (a.valueToday || 0));

        return NextResponse.json({ securities: result, total: result.length });
      }

      case 'trades': {
        // Последние сделки по тикеру — APIM с авторизацией, fallback ISS
        const res = await fetch(
          `${MOEX_APIM_API}/engines/stock/markets/shares/boards/TQBR/securities/${ticker}/trades.json?iss.meta=off&iss.only=trades&trades.columns=TRADETIME,PRICE,QUANTITY,BUYSELL,BOARDID,TRADESESSION&limit=100&reversed=1`,
          { headers: authHeaders(), cache: 'no-store' as RequestCache }
        );
        let data = !res.ok ? null : await res.json().catch(() => null);
        if (!data) {
          const fbRes = await fetch(
            `${MOEX_ISS_API}/engines/stock/markets/shares/boards/TQBR/securities/${ticker}/trades.json?iss.meta=off&iss.only=trades&trades.columns=TRADETIME,PRICE,QUANTITY,BUYSELL,BOARDID,TRADESESSION&limit=100&reversed=1`,
            { cache: 'no-store' as RequestCache }
          );
          data = await fbRes.json();
        }
        const trades: MoexTrade[] = (data?.trades?.data || []).map((t: any) => ({
          time: t[0],
          price: t[1],
          qty: t[2],
          direction: t[3] === 'B' ? 'BUY' : t[3] === 'S' ? 'SELL' : 'MIXED',
          board: t[4],
          session: t[5],
        }));
        return NextResponse.json({ trades, ticker });
      }

      case 'candles': {
        // Super Candles через AlgoPack API (правильный endpoint!)
        const from = searchParams.get('from') || '';
        const till = searchParams.get('till') || '';
        let url = `${MOEX_ALGOPACK_API}/eq/tradestats/${ticker}.json?iss.meta=off&latest=1`;
        if (from) url += `&from=${from}`;
        if (till) url += `&till=${till}`;

        const res = await fetch(url, {
          headers: authHeaders(),
          cache: 'no-store' as RequestCache,
        });

        if (!res.ok) {
          // Fallback на обычные свечи ISS
          const interval = searchParams.get('interval') || '60';
          const fallbackRes = await fetch(
            `${MOEX_ISS_API}/engines/stock/markets/shares/boards/TQBR/securities/${ticker}/candles.json?iss.meta=off&iss.only=candles&candles.columns=begin,open,high,low,close,value,volume&interval=${interval}&limit=100`,
            { cache: 'no-store' as RequestCache }
          );
          const fbData = await fallbackRes.json();
          const candles = (fbData?.candles?.data || []).map((c: any) => ({
            time: c[0], open: c[1], high: c[2], low: c[3],
            close: c[4], value: c[5], volume: c[6],
          }));
          return NextResponse.json({ candles, ticker, source: 'iss' });
        }

        const data = await res.json();
        // AlgoPack tradestats — преобразуем в candles формат
        const columns: string[] = data?.data?.columns || [];
        const rows: any[][] = data?.data?.data || [];
        const candles = rows.map((row: any[]) => {
          const obj: any = {};
          columns.forEach((col, i) => { obj[col] = row[i]; });
          return {
            time: obj.tradetime || obj.tradedate,
            open: obj.pr_open, high: obj.pr_high, low: obj.pr_low,
            close: obj.pr_close, value: obj.val, volume: obj.vol,
          };
        });
        return NextResponse.json({ candles, ticker, source: 'algopack' });
      }

      case 'analyze': {
        // Анализ через AlgoPack tradestats для одного тикера
        const res = await fetch(
          `${MOEX_ALGOPACK_API}/eq/tradestats/${ticker}.json?iss.meta=off&latest=1`,
          { headers: authHeaders(), cache: 'no-store' as RequestCache }
        );

        if (!res.ok) {
          return NextResponse.json({
            ticker,
            robot_probability: 0.3,
            signals: [],
            iceberg_probability: 0.0,
            source: 'heuristic',
            note: 'MOEX AlgoPack API unavailable, using heuristic',
          });
        }

        const data = await res.json();
        const columns: string[] = data?.data?.columns || [];
        const rows: any[][] = data?.data?.data || [];

        if (rows.length === 0) {
          return NextResponse.json({
            ticker,
            robot_probability: 0,
            signals: [],
            iceberg_probability: 0,
            source: 'algopack_empty',
          });
        }

        // Анализируем последнюю 5-минутную свечу
        const latestRow = rows[rows.length - 1];
        const obj: any = {};
        columns.forEach((col, i) => { obj[col] = latestRow[i]; });

        const totalTrades = Number(obj.trades) || 0;
        const tradesB = Number(obj.trades_b) || 0;
        const tradesS = Number(obj.trades_s) || 0;
        const disb = Number(obj.disb) || 0;

        // Эвристика: высокий disb + ассиметрия trades = роботная активность
        const asymmetry = totalTrades > 0 ? Math.abs(tradesB - tradesS) / totalTrades : 0;
        const robotProbability = Math.min(1, (Math.abs(disb) + asymmetry) / 2);

        return NextResponse.json({
          ticker,
          robot_probability: Math.round(robotProbability * 100) / 100,
          signals: [],
          iceberg_probability: 0,
          source: 'algopack',
          disb,
          trades_b: tradesB,
          trades_s: tradesS,
        });
      }

      case 'top': {
        // Топ инструментов по обороту — APIM с авторизацией
        const res = await fetch(
          `${MOEX_APIM_API}/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,VALTODAY,VOLTODAY,MARKETPRICE,OPEN,LOW,HIGH&limit=100&sort_column=VALTODAY&sort_order=desc`,
          { headers: authHeaders(), cache: 'no-store' as RequestCache }
        );
        let data = !res.ok ? null : await res.json().catch(() => null);
        if (!data) {
          const fbRes = await fetch(
            `${MOEX_ISS_API}/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,VALTODAY,VOLTODAY,MARKETPRICE,OPEN,LOW,HIGH&limit=100&sort_column=VALTODAY&sort_order=desc`,
            { cache: 'no-store' as RequestCache }
          );
          data = await fbRes.json();
        }
        const top = (data?.marketdata?.data || []).map((m: any, i: number) => ({
          rank: i + 1,
          ticker: m[0],
          valueToday: m[1],
          volToday: m[2],
          marketPrice: m[3],
          open: m[4],
          low: m[5],
          high: m[6],
        }));
        return NextResponse.json({ top, total: top.length });
      }

      case 'orderbook': {
        // Стакан — APIM с авторизацией (реал-тайм), fallback ISS
        const depth = searchParams.get('depth') || '10';
        const res = await fetch(
          `${MOEX_APIM_API}/engines/stock/markets/shares/boards/TQBR/securities/${ticker}/orderbook.json?iss.meta=off&iss.only=orderbook&depth=${depth}`,
          { headers: authHeaders(), cache: 'no-store' as RequestCache }
        );
        let data = !res.ok ? null : await res.json().catch(() => null);
        if (!data) {
          const fbRes = await fetch(
            `${MOEX_ISS_API}/engines/stock/markets/shares/boards/TQBR/securities/${ticker}/orderbook.json?iss.meta=off&iss.only=orderbook&depth=${depth}`,
            { cache: 'no-store' as RequestCache }
          );
          data = await fbRes.json();
        }
        const bids = (data?.orderbook?.bid || []).map((b: any) => ({
          price: b[0], lots: b[1], orders: b[2],
        }));
        const asks = (data?.orderbook?.ask || []).map((a: any) => ({
          price: a[0], lots: a[1], orders: a[2],
        }));
        return NextResponse.json({ bids, asks, ticker });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('MOEX API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
