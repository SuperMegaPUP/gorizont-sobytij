// ─── /api/tickers — Tickers Data Endpoint ────────────────────────────────────
// Возвращает текущие данные по тикерам: цены, объёмы, изменения.
// Использует MOEX_JWT или TINVEST_TOKEN для получения данных.
//
// GET /api/tickers?tickers=SBER,GAZP,LKOH&source=moex|tinvest|auto

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MOEX_APIM = 'https://apim.moex.com/iss';
const MOEX_ISS = 'https://iss.moex.com/iss';
const TINVEST_API = 'https://invest-public-api.tinkoff.ru/rest';

function getJWT(): string {
  return (process.env.MOEX_JWT || '').trim();
}

function authHeaders(): Record<string, string> {
  const jwt = getJWT();
  return jwt ? { Authorization: `Bearer ${jwt}`, 'User-Agent': 'robot-detector-terminal/1.0' } : {};
}

// ─── Ticker Interfaces ───────────────────────────────────────────────────────

interface TickerData {
  ticker: string;
  name: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  volume: number;          // lots
  value: number;           // rub
  lastUpdate: string;
  source: string;
  board: string;
}

// ─── Default Ticker List ─────────────────────────────────────────────────────

const DEFAULT_TICKERS = [
  'SBER', 'GAZP', 'LKOH', 'GMKN', 'NVTK', 'ROSN', 'YNDX', 'PLZL',
  'MGNT', 'MTSS', 'TATN', 'ALRS', 'CHMF', 'NLMK', 'POLY', 'SNGS',
  'VTBR', 'RUAL', 'MOEX', 'OZON',
];

// ─── FIGI Mapping for T-Invest ───────────────────────────────────────────────

const FIGI_MAP: Record<string, string> = {
  SBER: 'BBG004730N88',
  GAZP: 'BBG004730RP0',
  LKOH: 'BBG004730N61',
  GMKN: 'BBG00475KKM8',
  NVTK: 'BBG00475KDY4',
  ROSN: 'BBG004730N88',
  YNDX: 'BBG006L8G4H1',
  PLZL: 'BBG004730B63',
  MGNT: 'BBG00475KHC1',
  MTSS: 'BBG004730N72',
  TATN: 'BBG004730N58',
  ALRS: 'BBG004730PP12',
  CHMF: 'BBG004730N54',
  NLMK: 'BBG004730N42',
  POLY: 'BBG00475KHY2',
  SNGS: 'BBG004730154',
  VTBR: 'BBG004730ZJ4',
  RUAL: 'BBG004730N78',
  MOEX: 'BBG004730N96',
  OZON: 'BBG004730N49',
};

// ─── MOEX Tickers Fetcher ────────────────────────────────────────────────────

async function fetchMoexTickers(tickers: string[]): Promise<TickerData[]> {
  const results: TickerData[] = [];

  try {
    const headers = authHeaders();
    const baseUrl = getJWT() ? MOEX_APIM : MOEX_ISS;

    // Request securities + marketdata in one call
    const res = await fetch(
      `${baseUrl}/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,LOTSIZE&marketdata.columns=SECID,VALTODAY,VOLTODAY,MARKETPRICE,OPEN,LOW,HIGH,LAST,WAPRICE&limit=200&sort_column=VALTODAY&sort_order=desc`,
      { headers, cache: 'no-store' as RequestCache }
    );

    // Fallback to ISS if APIM fails
    let data: any = null;
    if (res.ok) {
      data = await res.json();
    } else if (getJWT()) {
      const fbRes = await fetch(
        `${MOEX_ISS}/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,LOTSIZE&marketdata.columns=SECID,VALTODAY,VOLTODAY,MARKETPRICE,OPEN,LOW,HIGH,LAST,WAPRICE&limit=200&sort_column=VALTODAY&sort_order=desc`,
        { cache: 'no-store' as RequestCache }
      );
      if (fbRes.ok) data = await fbRes.json();
    }

    if (!data) return results;

    // Parse securities
    const secColumns: string[] = data?.securities?.columns || [];
    const secRows: any[][] = data?.securities?.data || [];
    const secMap = new Map<string, any>();
    for (const row of secRows) {
      const obj: any = {};
      secColumns.forEach((col, i) => { obj[col] = row[i]; });
      if (obj.SECID) secMap.set(obj.SECID, obj);
    }

    // Parse marketdata
    const mdColumns: string[] = data?.marketdata?.columns || [];
    const mdRows: any[][] = data?.marketdata?.data || [];
    const mdMap = new Map<string, any>();
    for (const row of mdRows) {
      const obj: any = {};
      mdColumns.forEach((col, i) => { obj[col] = row[i]; });
      if (obj.SECID) mdMap.set(obj.SECID, obj);
    }

    // Build ticker data
    const tickerSet = new Set(tickers);
    for (const [secid, md] of mdMap.entries()) {
      if (tickerSet.size > 0 && !tickerSet.has(secid)) continue;

      const sec = secMap.get(secid) || {};
      const lastPrice = Number(md.LAST) || Number(md.MARKETPRICE) || Number(md.WAPRICE) || 0;
      const openPrice = Number(md.OPEN) || 0;
      const change = openPrice > 0 ? lastPrice - openPrice : 0;
      const changePercent = openPrice > 0 ? (change / openPrice) * 100 : 0;

      if (lastPrice > 0 || Number(md.VALTODAY) > 0) {
        results.push({
          ticker: secid,
          name: sec.SHORTNAME || secid,
          price: lastPrice,
          open: openPrice,
          high: Number(md.HIGH) || 0,
          low: Number(md.LOW) || 0,
          close: lastPrice,
          change: Math.round(change * 100) / 100,
          changePercent: Math.round(changePercent * 100) / 100,
          volume: Number(md.VOLTODAY) || 0,
          value: Number(md.VALTODAY) || 0,
          lastUpdate: new Date().toISOString(),
          source: 'moex',
          board: 'TQBR',
        });
      }
    }
  } catch (err) {
    console.error('[TICKERS] MOEX fetch error:', err);
  }

  return results;
}

// ─── T-Invest Tickers Fetcher ────────────────────────────────────────────────

async function fetchTinvestTickers(tickers: string[]): Promise<TickerData[]> {
  const results: TickerData[] = [];
  const token = process.env.TINVEST_TOKEN;
  if (!token) return results;

  try {
    // Build figi list from requested tickers
    const figiEntries = tickers
      .filter(t => FIGI_MAP[t])
      .map(t => ({ ticker: t, figi: FIGI_MAP[t] }));

    if (figiEntries.length === 0) return results;

    // Get last prices
    const pricesRes = await fetch(`${TINVEST_API}/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ figis: figiEntries.map(e => ({ figi: e.figi })) }),
    });

    if (!pricesRes.ok) return results;

    const pricesData = await pricesRes.json();
    const priceMap = new Map<string, number>();
    for (const p of (pricesData?.lastPrices || [])) {
      const price = Number(p.price?.units || 0) + Number(p.price?.nano || 0) / 1e9;
      priceMap.set(p.figi, price);
    }

    // Build results
    for (const entry of figiEntries) {
      const price = priceMap.get(entry.figi) || 0;
      if (price > 0) {
        results.push({
          ticker: entry.ticker,
          name: entry.ticker,
          price,
          open: 0,
          high: 0,
          low: 0,
          close: price,
          change: 0,
          changePercent: 0,
          volume: 0,
          value: 0,
          lastUpdate: new Date().toISOString(),
          source: 'tinvest',
          board: 'TQBR',
        });
      }
    }
  } catch (err) {
    console.error('[TICKERS] T-Invest fetch error:', err);
  }

  return results;
}

// ─── GET Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tickersParam = searchParams.get('tickers') || '';
  const source = searchParams.get('source') || 'auto';

  const requestedTickers = tickersParam
    ? tickersParam.split(',').map(t => t.trim()).filter(Boolean)
    : DEFAULT_TICKERS;

  try {
    let tickers: TickerData[] = [];

    if (source === 'moex') {
      tickers = await fetchMoexTickers(requestedTickers);
    } else if (source === 'tinvest') {
      tickers = await fetchTinvestTickers(requestedTickers);
    } else {
      // Auto: try MOEX first, supplement with T-Invest for missing
      const moexTickers = await fetchMoexTickers(requestedTickers);
      const moexTickerSet = new Set(moexTickers.map(t => t.ticker));
      const missingTickers = requestedTickers.filter(t => !moexTickerSet.has(t));

      let tinvestTickers: TickerData[] = [];
      if (missingTickers.length > 0) {
        tinvestTickers = await fetchTinvestTickers(missingTickers);
      }

      tickers = [...moexTickers, ...tinvestTickers];
    }

    // Sort by value (turnover) descending
    tickers.sort((a, b) => b.value - a.value);

    return NextResponse.json({
      tickers,
      total: tickers.length,
      source: source,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[TICKERS] GET error:', err);
    return NextResponse.json({
      tickers: [],
      total: 0,
      error: err.message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
