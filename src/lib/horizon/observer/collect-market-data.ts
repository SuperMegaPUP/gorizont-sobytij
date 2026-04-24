// ─── collect-market-data.ts ─────────────────────────────────────────────────
// Сбор рыночных данных из MOEX / T-Invest → DetectorInput
// AI Observer вызывает эту функцию для подготовки данных к детекторам
//
// Источники:
// 1. Стакан 50 уровней — MOEX ISS/APIM (orderbook)
// 2. Сделки 200 шт — MOEX ISS/APIM (trades с BUYSELL)
// 3. RVI — Russian Volatility Index
// 4. OI фьючерсов — FORTS
// 5. Кросс-тикерные данные — для ENTANGLE
//
// v2: Добавлена поддержка разных бордов MOEX (TQBR для акций, FORTS для фьючерсов)
// v3: Добавлена резолвация тикеров + TOP-100 поддержка

import type { DetectorInput } from '../detectors/types';
import type { OrderBookData } from '../calculations/ofi';
import type { Trade, CumDeltaResult } from '../calculations/delta';
import type { Candle, VPINResult } from '../calculations/vpin';
import { calcOFI, calcWeightedOFI } from '../calculations/ofi';
import { calcCumDelta } from '../calculations/delta';
import { calcVPIN, sliceIntoVolumeBuckets } from '../calculations/vpin';

// ─── MOEX Fetch Helper ──────────────────────────────────────────────────────

const ISS_BASE = 'https://iss.moex.com';
const APIM_BASE = 'https://apim.moex.com';

function getJWT(): string {
  return (process.env.MOEX_JWT || '').trim();
}

async function moexFetch(path: string): Promise<any> {
  // 1. Пробуем ISS (публичный)
  try {
    const res = await fetch(`${ISS_BASE}${path}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'horizon-observer/3.2' },
      cache: 'no-store' as RequestCache,
      signal: AbortSignal.timeout(8000),
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('json')) return await res.json();
  } catch { /* fallback */ }

  // 2. APIM с авторизацией
  const jwt = getJWT();
  if (!jwt) throw new Error(`ISS failed and no MOEX_JWT for ${path}`);

  const res = await fetch(`${APIM_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/json',
      'User-Agent': 'horizon-observer/3.2',
    },
    cache: 'no-store' as RequestCache,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`APIM ${res.status} for ${path}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) throw new Error(`APIM non-JSON: ${ct}`);
  return res.json();
}

/** Парсинг ISS grid */
function parseIssGrid(raw: any): Record<string, any>[] {
  if (!raw?.columns || !raw?.data) return [];
  return raw.data.map((row: any[]) => {
    const obj: Record<string, any> = {};
    raw.columns.forEach((col: string, i: number) => { obj[col] = row[i]; });
    return obj;
  });
}

// ─── Ticker Resolution ──────────────────────────────────────────────────────

export interface TickerConfig {
  /** Короткий код (MX, Si, etc.) — для UI и ключей */
  shortCode: string;
  /** Полный тикер MOEX (MOEX, GAZP, Si-6.25, etc.) */
  moexTicker: string;
  /** Движок MOEX (stock, futures) */
  engine: string;
  /** Рынок MOEX (shares, forts) */
  market: string;
  /** Борд MOEX (TQBR, RFUD) */
  board: string;
  /** Тип инструмента */
  type: 'share' | 'futures';
  /** Отображаемое имя */
  name: string;
}

/** Маппинг коротких кодов → реальные тикеры MOEX */
const TICKER_MAP: Record<string, Omit<TickerConfig, 'shortCode'>> = {
  'MX':  { moexTicker: 'MOEX', engine: 'stock', market: 'shares', board: 'TQBR', type: 'share', name: 'Московская биржа' },
  'GZ':  { moexTicker: 'GAZP', engine: 'stock', market: 'shares', board: 'TQBR', type: 'share', name: 'Газпром' },
  'GK':  { moexTicker: 'GMKN', engine: 'stock', market: 'shares', board: 'TQBR', type: 'share', name: 'ГМК Норникель' },
  'SR':  { moexTicker: 'SBER', engine: 'stock', market: 'shares', board: 'TQBR', type: 'share', name: 'Сбербанк' },
  'LK':  { moexTicker: 'LKOH', engine: 'stock', market: 'shares', board: 'TQBR', type: 'share', name: 'ЛУКОЙЛ' },
  'RN':  { moexTicker: 'ROSN', engine: 'stock', market: 'shares', board: 'TQBR', type: 'share', name: 'Роснефть' },
  'Si':  { moexTicker: 'Si',   engine: 'futures', market: 'forts', board: 'RFUD', type: 'futures', name: 'Доллар/рубль' },
  'RI':  { moexTicker: 'RI',   engine: 'futures', market: 'forts', board: 'RFUD', type: 'futures', name: 'Индекс РТС' },
  'BR':  { moexTicker: 'BR',   engine: 'futures', market: 'forts', board: 'RFUD', type: 'futures', name: 'Нефть Brent' },
};

/** Кеш резолвации фьючерсных контрактов */
const futuresCache: Record<string, { seccode: string; ts: number }> = {};
const FUTURES_CACHE_TTL = 3600000; // 1 час

/**
 * Резолвит активный фьючерсный контракт для заданного префикса (Si, RI, BR)
 * Ищет ближайший неисполненный контракт на FORTS
 */
async function resolveActiveFuturesContract(prefix: string): Promise<string | null> {
  const cached = futuresCache[prefix];
  if (cached && Date.now() - cached.ts < FUTURES_CACHE_TTL) {
    return cached.seccode;
  }

  try {
    const data = await moexFetch('/iss/engines/futures/markets/forts/securities.json');
    const rows = parseIssGrid(data.securities);

    // Фильтруем контракты по префиксу
    const matching = rows
      .filter(r => String(r.SECCODE || '').startsWith(prefix))
      .sort((a, b) => {
        // Сортировка по дате исполнения (ближайший первый)
        const dateA = a.MATDATE ? new Date(a.MATDATE).getTime() : Infinity;
        const dateB = b.MATDATE ? new Date(b.MATDATE).getTime() : Infinity;
        return dateA - dateB;
      });

    // Берём ближайший активный (неисполненный)
    const now = Date.now();
    const active = matching.find(r => {
      const matDate = r.MATDATE ? new Date(r.MATDATE).getTime() : 0;
      return matDate > now;
    });

    const seccode = active?.SECCODE || matching[0]?.SECCODE || null;
    if (seccode) {
      futuresCache[prefix] = { seccode, ts: Date.now() };
    }
    return seccode;
  } catch (e: any) {
    console.warn(`[collect-market-data] Failed to resolve futures contract for ${prefix}:`, e.message);
    return null;
  }
}

/**
 * Резолвит тикер: короткий код → полная конфигурация MOEX
 * Если тикер неизвестен — предполагаем TQBR акцию (для TOP-100)
 */
export async function resolveTicker(shortCode: string): Promise<TickerConfig> {
  const mapped = TICKER_MAP[shortCode];
  if (mapped) {
    // Для фьючерсов резолвим активный контракт
    if (mapped.type === 'futures') {
      const activeContract = await resolveActiveFuturesContract(mapped.moexTicker);
      return {
        shortCode,
        ...mapped,
        moexTicker: activeContract || mapped.moexTicker,
      };
    }
    return { shortCode, ...mapped };
  }

  // Неизвестный тикер → считаем акцией на TQBR (для TOP-100)
  return {
    shortCode,
    moexTicker: shortCode,
    engine: 'stock',
    market: 'shares',
    board: 'TQBR',
    type: 'share',
    name: shortCode,
  };
}

// ─── Data Fetchers ──────────────────────────────────────────────────────────

interface OrderbookResult {
  bids: Array<{ price: number; quantity: number }>;
  asks: Array<{ price: number; quantity: number }>;
}

interface TradesResult {
  trades: Trade[];
  recentTrades: Trade[];
}

interface RVIResult {
  value: number;
  change: number;
}

interface FuturesOIResult {
  ticker: string;
  oi: number;
  change: number;
}

/** Стакан 50 уровней — board-aware */
async function fetchOrderboard(config: TickerConfig): Promise<OrderbookResult | null> {
  try {
    const path = `/iss/engines/${config.engine}/markets/${config.market}/boards/${config.board}/securities/${config.moexTicker}/orderbook.json?depth=50`;
    const data = await moexFetch(path);
    const bids = (data.orderbook?.bids || []).map((b: any[]) => ({
      price: Number(b[0]), quantity: Number(b[1]),
    }));
    const asks = (data.orderbook?.asks || []).map((a: any[]) => ({
      price: Number(a[0]), quantity: Number(a[1]),
    }));
    return { bids, asks };
  } catch (e: any) {
    console.warn(`[collect-market-data] orderbook error for ${config.moexTicker}:`, e.message);
    return null;
  }
}

/** Сделки с BUYSELL — board-aware */
async function fetchTrades(config: TickerConfig, limit: number = 200): Promise<TradesResult> {
  const empty: TradesResult = { trades: [], recentTrades: [] };
  try {
    const path = `/iss/engines/${config.engine}/markets/${config.market}/boards/${config.board}/securities/${config.moexTicker}/trades.json?limit=${limit}`;
    const data = await moexFetch(path);
    const rows = parseIssGrid(data.trades);
    const trades: Trade[] = rows.map((t) => ({
      price: Number(t.PRICE || 0),
      quantity: Number(t.QUANTITY || 0),
      direction: String(t.BUYSELL || ''),
      timestamp: t.SYSTIME ? new Date(t.SYSTIME).getTime() : Date.now(),
    }));
    return {
      trades,
      recentTrades: trades.slice(-50), // последние 50 для быстрых детекторов
    };
  } catch (e: any) {
    console.warn(`[collect-market-data] trades error for ${config.moexTicker}:`, e.message);
    return empty;
  }
}

/** RVI — Russian Volatility Index */
async function fetchRVI(): Promise<RVIResult | null> {
  try {
    const path = '/iss/statistics/engines/stock/volatility/RVI.json';
    const data = await moexFetch(path);
    const rows = parseIssGrid(data.rvi);
    if (rows.length === 0) return null;
    const last = rows[rows.length - 1];
    return {
      value: Number(last.RVI || last.VALUE || 0),
      change: Number(last.CHANGE || 0),
    };
  } catch (e: any) {
    console.warn('[collect-market-data] RVI error:', e.message);
    return null;
  }
}

/** OI фьючерсов для кросс-тикерного анализа */
async function fetchFuturesOI(): Promise<FuturesOIResult[]> {
  try {
    const path = '/iss/engines/futures/markets/forts/securities.json';
    const data = await moexFetch(path);
    const rows = parseIssGrid(data.securities);
    const targets = ['MX', 'Si', 'RI', 'BR', 'GZ', 'GK', 'SR', 'LK', 'RN'];
    return rows
      .filter((r) => targets.some((t) => String(r.SECCODE || '').startsWith(t)))
      .map((r) => ({
        ticker: String(r.SECCODE || ''),
        oi: Number(r.OPENPOSITIONS || r.NUMTRADES || 0),
        change: Number(r.CHANGE || 0),
      }));
  } catch (e: any) {
    console.warn('[collect-market-data] futures OI error:', e.message);
    return [];
  }
}

/** Свечи для VPIN (преобразуем сделки в candles через volume buckets) */
function tradesToCandles(trades: Trade[]): Candle[] {
  if (trades.length < 2) return [];

  const sorted = [...trades]
    .filter(t => t.timestamp && t.price > 0 && t.quantity > 0)
    .sort((a, b) => a.timestamp! - b.timestamp!);

  if (sorted.length < 2) return [];

  // Объём бакета = общий объём / 50 (стандартный VPIN)
  const totalVol = sorted.reduce((s, t) => s + t.quantity, 0);
  const bucketVol = Math.max(totalVol / 50, 1);

  return sliceIntoVolumeBuckets(
    sorted.map(t => ({ price: t.price, volume: t.quantity, timestamp: t.timestamp! })),
    bucketVol,
  );
}

// ─── Main Collector ─────────────────────────────────────────────────────────

export interface MarketDataResult {
  detectorInput: DetectorInput;
  marketSnapshot: {
    ticker: string;
    midPrice: number;
    spread: number;
    bidVolume: number;
    askVolume: number;
    tradeCount: number;
    rvi: number | null;
    futuresOI: FuturesOIResult[];
    ts: number;
  };
  /** Резолвленный конфиг тикера */
  tickerConfig: TickerConfig;
}

/**
 * Собирает все рыночные данные и формирует DetectorInput для 10 детекторов
 * Вызывается AI Observer'ом и сканнером перед запуском детекторов
 *
 * @param ticker — тикер для анализа (SBER, GAZP, Si, MX, etc.)
 * @param crossTickers — дополнительные тикеры для ENTANGLE (если нет — автоопределение)
 *
 * v2: Автоматическая резолвация тикера — поддержка TQBR (акции) и FORTS (фьючерсы)
 */
export async function collectMarketData(
  ticker: string = 'SBER',
  crossTickers?: string[],
): Promise<MarketDataResult> {
  console.log(`[collect-market-data] Starting for ${ticker}`);

  // 0. Резолвация тикера → правильный борд MOEX
  const config = await resolveTicker(ticker);
  console.log(`[collect-market-data] Resolved: ${ticker} → ${config.moexTicker} on ${config.board} (${config.type})`);

  // 1. Параллельный сбор данных
  const [obResult, tradesResult, rviResult, futuresOI] = await Promise.allSettled([
    fetchOrderboard(config),
    fetchTrades(config, 200),
    fetchRVI(),
    fetchFuturesOI(),
  ]);

  // 2. Стакан
  const orderbook: OrderBookData = obResult.status === 'fulfilled' && obResult.value
    ? obResult.value
    : { bids: [], asks: [] };

  // 3. Сделки
  const { trades, recentTrades } = tradesResult.status === 'fulfilled'
    ? tradesResult.value
    : { trades: [], recentTrades: [] };

  // 4. Индикаторы
  const ofi = calcOFI(orderbook);
  const weightedOFI = calcWeightedOFI(orderbook);
  const cumDelta: CumDeltaResult = calcCumDelta(trades);

  // 5. VPIN (через candles из trades)
  const candles = tradesToCandles(trades);
  const vpin: VPINResult = calcVPIN(candles);

  // 6. Ценовой ряд (последние 50 цен из trades)
  const prices = trades.slice(-50).map(t => t.price);
  const volumes = trades.slice(-50).map(t => t.quantity);

  // 7. RVI
  const rvi = rviResult.status === 'fulfilled' && rviResult.value
    ? rviResult.value.value : null;

  // 8. Кросс-тикерные данные (ENTANGLE)
  const defaultCrossTickers = crossTickers || ['GAZP', 'LKOH', 'GMKN', 'ROSN', 'NVTK'];
  const crossTickerData: Record<string, { priceChange: number; ofi: number }> = {};

  // Собираем кросс-данные из фьючерсов OI (если есть)
  const oi = futuresOI.status === 'fulfilled' ? futuresOI.value : [];
  for (const f of oi.slice(0, 5)) {
    crossTickerData[f.ticker] = {
      priceChange: f.change,
      ofi: 0, // OI не даёт OFI — заглушка
    };
  }

  // Для полноты добавляем оценки для defaultCrossTickers
  for (const ct of defaultCrossTickers) {
    if (!crossTickerData[ct]) {
      crossTickerData[ct] = {
        priceChange: 0,
        ofi: 0,
      };
    }
  }

  // 9. Формируем DetectorInput
  const detectorInput: DetectorInput = {
    ticker,
    orderbook,
    trades,
    recentTrades,
    ofi,
    weightedOFI,
    cumDelta,
    vpin,
    prices,
    volumes,
    candles,
    crossTickers: Object.keys(crossTickerData).length > 0 ? crossTickerData : undefined,
    rvi: rvi ?? undefined,
  };

  // 10. Market snapshot для AI
  const bestBid = orderbook.bids.length > 0 ? orderbook.bids[0].price : 0;
  const bestAsk = orderbook.asks.length > 0 ? orderbook.asks[0].price : 0;
  const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 0;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;

  const marketSnapshot = {
    ticker,
    midPrice,
    spread: Math.round(spread * 10000) / 10000,
    bidVolume: orderbook.bids.reduce((s, l) => s + l.quantity, 0),
    askVolume: orderbook.asks.reduce((s, l) => s + l.quantity, 0),
    tradeCount: trades.length,
    rvi,
    futuresOI: oi,
    ts: Date.now(),
  };

  console.log(`[collect-market-data] Done: ${trades.length} trades, ${orderbook.bids.length} bids, ${orderbook.asks.length} asks, VPIN=${vpin.vpin.toFixed(3)}, OFI=${ofi.toFixed(3)}`);

  return { detectorInput, marketSnapshot, tickerConfig: config };
}
