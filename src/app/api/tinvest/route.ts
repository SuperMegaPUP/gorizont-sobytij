import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TINVEST_API = 'https://invest-public-api.tinkoff.ru/rest';
const TOKEN = process.env.TINVEST_TOKEN || '';

async function tinkoffFetch(path: string, body?: object): Promise<any> {
  if (!TOKEN) {
    throw new Error('TINVEST_TOKEN not configured');
  }
  const res = await fetch(`${TINVEST_API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`T-Invest API error ${res.status}: ${text}`);
    throw new Error(`T-Invest API: ${res.status} - ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data;
}

// GET /api/tinvest?action=shares|candles|orderbook|trades&...
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'shares';

  try {
    switch (action) {
      case 'shares': {
        const data = await tinkoffFetch('/tinkoff.public.invest.api.contract.v1.InstrumentsService/Shares', {
          instrumentStatus: 'INSTRUMENT_STATUS_BASE',
        });
        const instruments = (data?.instruments || [])
          .filter((i: any) => i.classCode === 'TQBR')
          .map((i: any) => ({
            figi: i.figi,
            ticker: i.ticker,
            name: i.name,
            lot: i.lot,
            classCode: i.classCode,
            currency: i.currency,
            countryOfRisk: i.countryOfRisk,
            sector: i.sector,
          }));
        return NextResponse.json({ instruments, total: instruments.length });
      }

      case 'candles': {
        const figi = searchParams.get('figi');
        const from = searchParams.get('from');
        const to = searchParams.get('to');
        if (!figi) return NextResponse.json({ error: 'figi is required' }, { status: 400 });
        const data = await tinkoffFetch('/tinkoff.public.invest.api.contract.v1.MarketDataService/GetCandles', {
          figi,
          from: from || new Date(Date.now() - 86400000).toISOString(),
          to: to || new Date().toISOString(),
          interval: 'CANDLE_INTERVAL_DAY',
        });
        const candles = (data?.candles || []).map((c: any) => ({
          time: c.time,
          open: Number(c.open?.units || 0) + Number(c.open?.nano || 0) / 1e9,
          high: Number(c.high?.units || 0) + Number(c.high?.nano || 0) / 1e9,
          low: Number(c.low?.units || 0) + Number(c.low?.nano || 0) / 1e9,
          close: Number(c.close?.units || 0) + Number(c.close?.nano || 0) / 1e9,
          volume: Number(c.volume || 0),
        }));
        return NextResponse.json({ candles });
      }

      case 'orderbook': {
        const figi = searchParams.get('figi');
        const depth = parseInt(searchParams.get('depth') || '10');
        if (!figi) return NextResponse.json({ error: 'figi is required' }, { status: 400 });
        const data = await tinkoffFetch('/tinkoff.public.invest.api.contract.v1.MarketDataService/GetOrderBook', {
          figi,
          depth,
        });
        const bids = (data?.bids || []).map((b: any) => ({
          price: Number(b.price?.units || 0) + Number(b.price?.nano || 0) / 1e9,
          lots: Number(b.quantity || 0),
        }));
        const asks = (data?.asks || []).map((a: any) => ({
          price: Number(a.price?.units || 0) + Number(a.price?.nano || 0) / 1e9,
          lots: Number(a.quantity || 0),
        }));
        return NextResponse.json({ bids, asks, figi, depth });
      }

      case 'last_prices': {
        const figiParam = searchParams.get('figi');
        if (!figiParam) return NextResponse.json({ error: 'figi is required (comma-separated)' }, { status: 400 });
        const figis = figiParam.split(',').map(f => ({ figi: f.trim() }));
        const data = await tinkoffFetch('/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices', {
          figis,
        });
        const prices = (data?.lastPrices || []).map((p: any) => ({
          figi: p.figi,
          price: Number(p.price?.units || 0) + Number(p.price?.nano || 0) / 1e9,
          time: p.time,
        }));
        return NextResponse.json({ prices });
      }

      case 'trades': {
        const figi = searchParams.get('figi');
        const from = searchParams.get('from');
        const to = searchParams.get('to');
        if (!figi) return NextResponse.json({ error: 'figi is required' }, { status: 400 });
        const data = await tinkoffFetch('/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastTrades', {
          figi,
          from: from || new Date(Date.now() - 3600000).toISOString(),
          to: to || new Date().toISOString(),
        });
        const trades = (data?.trades || []).map((t: any) => ({
          figi: t.figi,
          time: t.time,
          price: Number(t.price?.units || 0) + Number(t.price?.nano || 0) / 1e9,
          lots: Number(t.quantity || 0),
          direction: t.direction,
        }));
        return NextResponse.json({ trades });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('T-Invest API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
