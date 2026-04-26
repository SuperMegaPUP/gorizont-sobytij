import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// /api/trades — Получение сделок из T-Invest + MOEX API
// v2: Динамический FIGI-резолвинг через T-Invest API вместо хардкода
// Поддерживает оба источника с fallback

const TINVEST_API = 'https://invest-public-api.tinkoff.ru/rest';
const MOEX_ISS = 'https://iss.moex.com/iss';
const MOEX_APIM = 'https://apim.moex.com/iss';
const TINVEST_TOKEN = process.env.TINVEST_TOKEN || '';
// КРИТИЧЕСКИ: MOEX_JWT (не MOEX_TOKEN!), с trim()
function getMoexJWT(): string {
  return (process.env.MOEX_JWT || '').trim();
}

function authHeaders(): Record<string, string> {
  const jwt = getMoexJWT();
  return jwt ? { Authorization: `Bearer ${jwt}`, 'User-Agent': 'robot-detector-terminal/1.0' } : {};
}

// In-memory cache (5s TTL для сделок)
const tradeCache = new Map<string, { ts: number; data: any }>();
const CACHE_TTL = 5000;

// ─── Динамический FIGI-резолвинг ─────────────────────────────────────────
// Кэш FIGI-маппинга (TTL 24 часа — FIGI редко меняются)
let figiMapCache: { ts: number; mapping: Record<string, string> } | null = null;
const FIGI_MAP_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа

/**
 * Загружает ВСЕ FIGI для TQBR акций через T-Invest Shares API
 * Один запрос = весь маппинг, кэшируется на 24 часа
 */
async function loadAllFigis(): Promise<Record<string, string>> {
  // Проверяем кэш
  if (figiMapCache && Date.now() - figiMapCache.ts < FIGI_MAP_CACHE_TTL) {
    return figiMapCache.mapping;
  }

  if (!TINVEST_TOKEN) return {};

  try {
    const res = await fetch(
      `${TINVEST_API}/tinkoff.public.invest.api.contract.v1.InstrumentsService/Shares`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TINVEST_TOKEN}`,
        },
        body: JSON.stringify({
          instrumentStatus: 'INSTRUMENT_STATUS_BASE',
        }),
      }
    );

    if (!res.ok) return {};

    const data = await res.json();
    const mapping: Record<string, string> = {};
    for (const inst of (data?.instruments || [])) {
      if (inst.classCode === 'TQBR' && inst.ticker && inst.figi) {
        mapping[inst.ticker] = inst.figi;
      }
    }

    figiMapCache = { ts: Date.now(), mapping };
    console.log(`[FIGI] Loaded ${Object.keys(mapping).length} FIGI mappings from T-Invest`);
    return mapping;
  } catch (e) {
    console.warn('[FIGI] Failed to load from T-Invest:', e);
    return {};
  }
}

/**
 * Резолвит FIGI по тикеру из загруженного маппинга
 */
async function resolveFigi(ticker: string): Promise<string> {
  const mapping = await loadAllFigis();
  return mapping[ticker] || '';
}

/**
 * Предзагрузка FIGI для списка тикеров
 */
async function resolveFigiBatch(tickers: string[]): Promise<Record<string, string>> {
  const mapping = await loadAllFigis();
  const result: Record<string, string> = {};
  for (const ticker of tickers) {
    result[ticker] = mapping[ticker] || '';
  }
  return result;
}

// ─── Получение сделок ────────────────────────────────────────────────────

async function fetchTinvestTrades(figi: string, ticker: string): Promise<any[] | null> {
  if (!TINVEST_TOKEN || !figi) return null;

  try {
    const now = new Date();
    const from = new Date(now.getTime() - 5 * 60 * 1000);

    const res = await fetch(
      `${TINVEST_API}/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastTrades`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TINVEST_TOKEN}`,
        },
        body: JSON.stringify({
          instrumentId: figi,
          from: from.toISOString(),
          to: now.toISOString(),
        }),
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    return (data.trades || [])
      .filter((t: any) => t.direction === 'TRADE_DIRECTION_BUY' || t.direction === 'TRADE_DIRECTION_SELL')
      .map((t: any) => ({
      figi: t.figi || figi,
      direction: t.direction === 'TRADE_DIRECTION_BUY' ? 'BUY' : 'SELL',
      price: Number(t.price?.units || 0) + Number(t.price?.nano || 0) / 1e9,
      lots: Number(t.quantity || 0),
      time: t.time,
      timestamp: new Date(t.time).getTime() / 1000 || 0,
    }));
  } catch {
    return null;
  }
}

async function fetchMoexTrades(ticker: string): Promise<any[] | null> {
  try {
    // 1. Сначала пробуем APIM с авторизацией (более надёжный)
    const jwt = getMoexJWT();
    if (jwt) {
      const apimRes = await fetch(
        `${MOEX_APIM}/engines/stock/markets/shares/boards/TQBR/securities/${ticker}/trades.json?iss.meta=off&iss.only=trades&trades.columns=TRADETIME,PRICE,QUANTITY,BUYSELL&limit=50&reversed=1`,
        { headers: authHeaders(), cache: 'no-store' as RequestCache }
      );
      if (apimRes.ok) {
        const data = await apimRes.json();
        const trades = (data?.trades?.data || []).map((t: any) => ({
          timestamp: new Date(t[0]).getTime() / 1000 || 0,
          price: t[1],
          lots: t[2],
          direction: t[3] === 'B' ? 'BUY' : t[3] === 'S' ? 'SELL' : 'MIXED',
          time: t[0],
          figi: '',
        }));
        if (trades.length > 0) return trades;
      }
    }

    // 2. Fallback на ISS без авторизации
    const res = await fetch(
      `${MOEX_ISS}/engines/stock/markets/shares/boards/TQBR/securities/${ticker}/trades.json?iss.meta=off&iss.only=trades&trades.columns=TRADETIME,PRICE,QUANTITY,BUYSELL&limit=50&reversed=1`,
      { cache: 'no-store' as RequestCache }
    );

    if (!res.ok) return null;

    const data = await res.json();
    return (data?.trades?.data || []).map((t: any) => ({
      timestamp: new Date(t[0]).getTime() / 1000 || 0,
      price: t[1],
      lots: t[2],
      direction: t[3] === 'B' ? 'BUY' : t[3] === 'S' ? 'SELL' : 'MIXED',
      time: t[0],
      figi: '',
    }));
  } catch {
    return null;
  }
}

// ─── API Route ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker') || 'SBER';
  const source = searchParams.get('source') || 'auto';

  // Check cache
  const cacheKey = `trades_${ticker}`;
  const cached = tradeCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  // Динамический FIGI-резолвинг
  const figi = await resolveFigi(ticker);

  let trades: any[] | null = null;
  let usedSource = 'none';

  // 1. Try T-Invest first (real-time)
  if ((source === 'auto' || source === 'tinvest') && figi && TINVEST_TOKEN) {
    trades = await fetchTinvestTrades(figi, ticker);
    if (trades && trades.length > 0) usedSource = 'tinvest';
  }

  // 2. Fallback to MOEX (APIM + ISS)
  if ((!trades || trades.length === 0) && (source === 'auto' || source === 'moex')) {
    trades = await fetchMoexTrades(ticker);
    if (trades && trades.length > 0) usedSource = 'moex';
  }

  // 3. No data available
  if (!trades || trades.length === 0) {
    const result = {
      source: usedSource,
      figi,
      ticker,
      count: 0,
      trades: [],
      message: 'Нет данных. Проверьте API токены или торговые часы.',
    };
    return NextResponse.json(result);
  }

  // Добавляем figi к сделкам
  for (const t of trades) {
    if (!t.figi) t.figi = figi;
  }

  const result = {
    source: usedSource,
    figi,
    ticker,
    count: trades.length,
    trades,
  };

  // Cache it
  tradeCache.set(cacheKey, { ts: Date.now(), data: result });

  return NextResponse.json(result);
}

// POST /api/trades — Предзагрузка FIGI для списка тикеров
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tickers } = body || {};
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: 'tickers array required' }, { status: 400 });
    }
    const mapping = await resolveFigiBatch(tickers);
    return NextResponse.json({ mapping, count: Object.keys(mapping).length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
