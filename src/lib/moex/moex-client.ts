import type { Trade } from '@/lib/horizon/detectors/types';

const TRADE_PRICE_IDX = 4;
const TRADE_QTY_IDX = 5;
const TRADE_SYSTIME_IDX = 9;
const TRADE_DIR_IDX = 10;

const MOEX_APIM = process.env.MOEX_APIM_API || 'https://apim.moex.com';
const MOEX_ISS = 'https://iss.moex.com';

async function safeJsonFetch(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json') || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export interface MoexTradesResult { trades: Trade[]; error?: string; }
export interface MoexOrderbookResult {
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
  error?: string;
}

export async function fetchMoexTrades(
  moexTicker: string, engine = 'stock', market = 'shares', board = 'TQBR', limit = 200
): Promise<MoexTradesResult> {
  const path = `/iss/engines/${engine}/markets/${market}/boards/${board}/securities/${moexTicker}/trades.json?iss.meta=off&limit=${limit}&reversed=1`;
  let data = await safeJsonFetch(`${MOEX_APIM}${path}`);
  if (!data) data = await safeJsonFetch(`${MOEX_ISS}${path}`);
  if (!data) return { trades: [], error: 'both_APIM_and_ISS_failed' };

  const rawRows = data?.trades?.data || [];
  if (rawRows.length === 0) return { trades: [] };

  const trades: Trade[] = rawRows.map((r: any[]) => {
    const dir = String(r[TRADE_DIR_IDX] || '');
    const time = r[TRADE_SYSTIME_IDX] ? String(r[TRADE_SYSTIME_IDX]) : '';
    return {
      price: Number(r[TRADE_PRICE_IDX] || 0),
      quantity: Number(r[TRADE_QTY_IDX] || 0),
      direction: dir,
      side: dir === 'B' ? 'BUY' : dir === 'S' ? 'SELL' : dir,
      time,
      timestamp: time ? new Date(time).getTime() : Date.now(),
    };
  }).filter((t: Trade) => t.price > 0 && t.quantity > 0);

  trades.reverse();
  return { trades };
}

export async function fetchMoexOrderbook(
  moexTicker: string, engine = 'stock', market = 'shares', board = 'TQBR', depth = 50
): Promise<MoexOrderbookResult> {
  const path = `/iss/engines/${engine}/markets/${market}/boards/${board}/securities/${moexTicker}/orderbook.json?iss.meta=off&iss.only=orderbook&depth=${depth}`;
  let data = await safeJsonFetch(`${MOEX_APIM}${path}`);
  if (!data) data = await safeJsonFetch(`${MOEX_ISS}${path}`);
  if (!data) return { bids: [], asks: [], error: 'both_APIM_and_ISS_failed' };

  const bids = (data?.orderbook?.bid || []).map((b: any[]) => ({
    price: Number(b[0] || 0), quantity: Number(b[1] || 0)
  })).filter((b: any) => b.price > 0);

  const asks = (data?.orderbook?.ask || []).map((a: any[]) => ({
    price: Number(a[0] || 0), quantity: Number(a[1] || 0)
  })).filter((a: any) => a.price > 0);

  return { bids, asks };
}

export { safeJsonFetch };