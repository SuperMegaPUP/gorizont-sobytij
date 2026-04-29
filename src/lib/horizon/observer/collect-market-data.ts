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
import type { OrderBookData, OrderBookSnapshot } from '../calculations/ofi';
import type { Trade, CumDeltaResult } from '../calculations/delta';
import type { Candle, VPINResult } from '../calculations/vpin';
import { calcOFI, calcWeightedOFI, calcRealtimeOFIMultiLevel, calcTradeOFI } from '../calculations/ofi';
import type { TradeOFIResult } from '../calculations/ofi';
import { calcCumDelta } from '../calculations/delta';
import { calcVPIN, sliceIntoVolumeBuckets } from '../calculations/vpin';
import redis from '@/lib/redis';

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
    // ISS вернул HTML или ошибку — логируем для диагностики
    console.log(`[moexFetch] ISS non-JSON: ${res.status} ${ct} for ${path.slice(0, 80)}`);
  } catch (e: any) {
    console.log(`[moexFetch] ISS error: ${e.message} for ${path.slice(0, 80)}`);
  }

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
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`APIM ${res.status} for ${path.slice(0, 80)}: ${body.slice(0, 200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    const body = await res.text().catch(() => '');
    throw new Error(`APIM non-JSON: ${ct} for ${path.slice(0, 80)}: ${body.slice(0, 200)}`);
  }
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

/** Кеш RVI (одинаков для всех тикеров, обновляем раз в минуту) */
let rviCache: { value: RVIResult | null; ts: number } = { value: null, ts: 0 };
const RVI_CACHE_TTL = 60000; // 1 минута

/** Кеш FuturesOI (одинаков для всех тикеров, обновляем раз в минуту) */
let futuresOICache: { value: FuturesOIResult[]; ts: number } = { value: [], ts: 0 };
const FUTURES_OI_CACHE_TTL = 60000; // 1 минута

// ─── Dynamic TOP-100 by Turnover ────────────────────────────────────────────

export interface TopTickerEntry {
  ticker: string;
  name: string;
  turnover: number;
}

/** Кеш ТОП-100 тикеров по обороту (обновляем раз в 30 минут) */
let top100Cache: { value: TopTickerEntry[]; ts: number } = { value: [], ts: 0 };
const TOP100_CACHE_TTL = 1800000; // 30 минут

/**
 * Получает топ-100 акций MOEX (TQBR) по обороту за сегодня.
 * Использует ISS endpoint securities с сортировкой по VALTODAY.
 * Кеширует на 30 минут.
 */
export async function fetchTop100Tickers(): Promise<TopTickerEntry[]> {
  // Return cached if fresh
  if (top100Cache.value.length > 0 && Date.now() - top100Cache.ts < TOP100_CACHE_TTL) {
    return top100Cache.value;
  }

  try {
    const path = '/iss/engines/stock/markets/shares/boards/TQBR/securities.json?sort_column=VALTODAY&sort_order=desc&first=100&securities.columns=SECCODE,SHORTNAME,VALTODAY';
    const data = await moexFetch(path);
    const rows = parseIssGrid(data.securities);

    const result: TopTickerEntry[] = rows
      .filter((r) => r.SECCODE && r.VALTODAY && Number(r.VALTODAY) > 0)
      .map((r) => ({
        ticker: String(r.SECCODE),
        name: String(r.SHORTNAME || r.SECCODE),
        turnover: Number(r.VALTODAY || 0),
      }))
      .slice(0, 100);

    // Вернуть даже если < 20 тикеров — главное хоть что-то есть
    if (result.length >= 1) {
      top100Cache = { value: result, ts: Date.now() };
      console.log(`[fetchTop100Tickers] Got ${result.length} tickers from MOEX (top: ${result[0]?.ticker} ${result[0]?.turnover})`);
      return result;
    }

    // If no results with VALTODAY, try without securities.columns (full response)
    console.warn(`[fetchTop100Tickers] No tickers with VALTODAY, retrying with full response...`);

    const path2 = '/iss/engines/stock/markets/shares/boards/TQBR/securities.json?sort_column=VALTODAY&sort_order=desc&first=100';
    const data2 = await moexFetch(path2);
    const rows2 = parseIssGrid(data2.securities);

    const result2: TopTickerEntry[] = rows2
      .filter((r) => r.SECCODE && r.VALTODAY && Number(r.VALTODAY) > 0)
      .map((r) => ({
        ticker: String(r.SECCODE),
        name: String(r.SHORTNAME || r.SECCODE),
        turnover: Number(r.VALTODAY || 0),
      }))
      .slice(0, 100);

    // Вернуть даже если всего 1 тикер
    if (result2.length >= 1) {
      top100Cache = { value: result2, ts: Date.now() };
      console.log(`[fetchTop100Tickers] Retry got ${result2.length} tickers`);
      return result2;
    }

    // Fallback: return stale cache (даже пустой)
    console.warn(`[fetchTop100Tickers] No tickers from MOEX, returning empty`);
    return [];
  } catch (e: any) {
    console.warn(`[fetchTop100Tickers] Error: ${e.message}`);
    return []; // Return empty on error
  }
}

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

/** Стакан 50 уровней — board-aware
 *  MOEX ISS возвращает orderbook.bid и orderbook.ask (ЕДИНСТВЕННОЕ число!)
 *  НЕ bids/asks — это был баг, давший OFI=0.0 у всех тикеров
 */
async function fetchOrderboard(config: TickerConfig): Promise<OrderbookResult | null> {
  try {
    const path = `/iss/engines/${config.engine}/markets/${config.market}/boards/${config.board}/securities/${config.moexTicker}/orderbook.json?iss.meta=off&iss.only=orderbook&depth=50`;
    const data = await moexFetch(path);

    // MOEX ISS orderbook: bid/ask (SINGULAR), каждый уровень = [price, quantity, orders?]
    const bids = (data.orderbook?.bid || []).map((b: any[]) => ({
      price: Number(b[0]), quantity: Number(b[1]),
    }));
    const asks = (data.orderbook?.ask || []).map((a: any[]) => ({
      price: Number(a[0]), quantity: Number(a[1]),
    }));

    if (bids.length === 0 && asks.length === 0) {
      console.warn(`[collect-market-data] EMPTY orderbook for ${config.moexTicker} — API returned 0 levels`);
      // Diagnostic: log raw response structure
      const obKeys = data.orderbook ? Object.keys(data.orderbook) : 'no orderbook key';
      console.warn(`[collect-market-data] orderbook keys: ${JSON.stringify(obKeys)}`);
    }

    return { bids, asks };
  } catch (e: any) {
    console.warn(`[collect-market-data] orderbook error for ${config.moexTicker}:`, e.message);
    return null;
  }
}

/** Сделки с BUYSELL — board-aware
 *  MOEX ISS с reversed=1 возвращает сделки от новых к старым.
 *  Мы РЕВЕРСИРУЕМ массив → хронологический порядок (старые → новые).
 *  Это критично для: time-decay weightedOFI, nearTermOFI, recentTrades.
 */
async function fetchTrades(config: TickerConfig, limit: number = 200): Promise<TradesResult> {
  const empty: TradesResult = { trades: [], recentTrades: [] };
  try {
    const path = `/iss/engines/${config.engine}/markets/${config.market}/boards/${config.board}/securities/${config.moexTicker}/trades.json?limit=${limit}&reversed=1`;
    const data = await moexFetch(path);
    const rows = parseIssGrid(data.trades);
    // reversed=1 → MOEX возвращает newest-first → реверсируем в хронологический порядок
    const trades: Trade[] = rows.reverse().map((t) => {
      const buysell = String(t.BUYSELL || '');
      const systime = t.SYSTIME ? String(t.SYSTIME) : '';
      return {
        price: Number(t.PRICE || 0),
        quantity: Number(t.QUANTITY || 0),
        direction: buysell,
        side: buysell === 'B' ? 'BUY' : buysell === 'S' ? 'SELL' : buysell,
        time: systime,
        timestamp: systime ? new Date(systime).getTime() : Date.now(),
      };
    });
    return {
      trades,
      recentTrades: trades.slice(-50), // ПОСЛЕДНИЕ 50 (самые свежие) — теперь правильно!
    };
  } catch (e: any) {
    console.warn(`[collect-market-data] trades error for ${config.moexTicker}:`, e.message);
    return empty;
  }
}

/** RVI — Russian Volatility Index (with caching) */
async function fetchRVI(): Promise<RVIResult | null> {
  // Return cached if fresh
  if (rviCache.value !== null && Date.now() - rviCache.ts < RVI_CACHE_TTL) {
    return rviCache.value;
  }
  if (rviCache.value === null && Date.now() - rviCache.ts < RVI_CACHE_TTL) {
    return null; // Still in cooldown after a failed attempt
  }
  try {
    const path = '/iss/statistics/engines/stock/volatility/RVI.json';
    const data = await moexFetch(path);
    const rows = parseIssGrid(data.rvi);
    if (rows.length === 0) { rviCache.ts = Date.now(); return null; }
    const last = rows[rows.length - 1];
    const result: RVIResult = {
      value: Number(last.RVI || last.VALUE || 0),
      change: Number(last.CHANGE || 0),
    };
    rviCache = { value: result, ts: Date.now() };
    return result;
  } catch (e: any) {
    console.warn('[collect-market-data] RVI error:', e.message);
    rviCache = { value: null, ts: Date.now() }; // Cache failure to avoid hammering
    return null;
  }
}

/** OI фьючерсов для кросс-тикерного анализа (with caching) */
async function fetchFuturesOI(): Promise<FuturesOIResult[]> {
  // Return cached if fresh
  if (futuresOICache.value.length > 0 && Date.now() - futuresOICache.ts < FUTURES_OI_CACHE_TTL) {
    return futuresOICache.value;
  }
  try {
    const path = '/iss/engines/futures/markets/forts/securities.json';
    const data = await moexFetch(path);
    const rows = parseIssGrid(data.securities);
    const targets = ['MX', 'Si', 'RI', 'BR', 'GZ', 'GK', 'SR', 'LK', 'RN'];
    const result = rows
      .filter((r) => targets.some((t) => String(r.SECCODE || '').startsWith(t)))
      .map((r) => ({
        ticker: String(r.SECCODE || ''),
        oi: Number(r.OPENPOSITIONS || r.NUMTRADES || 0),
        change: Number(r.CHANGE || 0),
      }));
    futuresOICache = { value: result, ts: Date.now() };
    return result;
  } catch (e: any) {
    console.warn('[collect-market-data] futures OI error:', e.message);
    return futuresOICache.value; // Return stale cache on error
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
  fastMode: boolean = false,
): Promise<MarketDataResult> {
  if (!fastMode) {
    console.log(`[collect-market-data] Starting for ${ticker}`);
  }

  // 0. Резолвация тикера → правильный борд MOEX
  const config = await resolveTicker(ticker);
  if (!fastMode) {
    console.log(`[collect-market-data] Resolved: ${ticker} → ${config.moexTicker} on ${config.board} (${config.type})`);
  }

  // 1. Параллельный сбор данных
  // fastMode: skip RVI and futuresOI (they're shared across all tickers and cached)
  const fetchPromises: Promise<any>[] = [
    fetchOrderboard(config),
    fetchTrades(config, 200),
  ];
  if (!fastMode) {
    fetchPromises.push(fetchRVI(), fetchFuturesOI());
  }

  const results = await Promise.allSettled(fetchPromises);

  // 2. Стакан
  const orderbook: OrderBookData = results[0].status === 'fulfilled' && results[0].value
    ? results[0].value
    : { bids: [], asks: [] };

  // 3. Сделки
  const { trades, recentTrades } = results[1].status === 'fulfilled'
    ? results[1].value
    : { trades: [], recentTrades: [] };

  // 3.5 Предыдущий снапшот стакана из Redis (для Real-time OFI)
  let orderbookPrev: OrderBookSnapshot | undefined;
  const obSnapshotKey = `horizon:ob-snapshot:${ticker}`;

  try {
    const prevJson = await redis.get(obSnapshotKey);
    if (prevJson) {
      orderbookPrev = JSON.parse(prevJson) as OrderBookSnapshot;
    }
  } catch { /* ignore Redis errors */ }

  // 3.7 Проверка свежести данных — ДО расчёта OFI! (Sprint 5B)
  // Если самая свежая сделка старше 30 минут — данные stale (рынок закрыт / перерыв)
  let staleData = false;
  let staleMinutes = 0;
  const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 минут

  if (trades.length > 0) {
    const newestTradeTs = Math.max(...trades.map(t => t.timestamp || 0));
    if (newestTradeTs > 0) {
      const ageMs = Date.now() - newestTradeTs;
      staleMinutes = Math.round(ageMs / 60000);
      if (ageMs > STALE_THRESHOLD_MS) {
        staleData = true;
        console.log(`[collect-market-data] ${ticker}: STALE DATA — newest trade ${staleMinutes} min ago`);
      }
    }
  } else {
    staleData = true;
    staleMinutes = 999;
    console.log(`[collect-market-data] ${ticker}: STALE DATA — no trades at all`);
  }

  // Пустой стакан: НЕ автоматически stale!
  if (orderbook.bids.length === 0 && orderbook.asks.length === 0) {
    if (staleData) {
      console.log(`[collect-market-data] ${ticker}: STALE DATA — empty orderbook + stale trades`);
    } else {
      console.log(`[collect-market-data] ${ticker}: Empty orderbook but trades fresh — API limitation (ДСВД?), NOT stale`);
    }
  }

  // 4. Индикаторы
  const ofiFromOB = calcOFI(orderbook);
  const weightedOFIFromOB = calcWeightedOFI(orderbook);

  // 4.1 Trade-based OFI — работает БЕЗ стакана (ДСВД, выходные)
  const tradeOFI: TradeOFIResult = calcTradeOFI(trades, 50);

  // 4.2 Умная логика подмены OB-OFI → Trade-OFI (Sprint 5B)
  // Приоритет: tradeOFI используется когда:
  //   а) стакан пустой (bids=asks=0) — API не вернул данные
  //   б) стакан stale (нет свежих сделок) — стакан от прошлого дня/сессии
  //   в) |tradeOFI| > 0 но OB-OFI ≈ 0 — сделки показывают дисбаланс, а стакан нет
  const obIsEmpty = orderbook.bids.length === 0 && orderbook.asks.length === 0;
  const tradesHaveDirection = tradeOFI.buyCount > 0 || tradeOFI.sellCount > 0;
  const tradeOFIHasSignal = Math.abs(tradeOFI.ofi) > 0.001;
  const useTradeOFI = obIsEmpty
    || (staleData && tradesHaveDirection)
    || (tradesHaveDirection && tradeOFIHasSignal && Math.abs(ofiFromOB) < 0.001 && trades.length >= 10);

  const ofi = useTradeOFI ? tradeOFI.ofi : ofiFromOB;
  const weightedOFI = useTradeOFI ? tradeOFI.weightedOFI : weightedOFIFromOB;

  // 4.3 Real-time OFI (Sprint 5B)
  let effectiveRtOFI: number | undefined;

  // 4.3a OB-rtOFI: Cont et al. 2014 — multi-level по 10 уровням (из стакана)
  if (orderbookPrev && orderbook.bids.length > 0 && orderbook.asks.length > 0 && !staleData) {
    const currentSnapshot: OrderBookSnapshot = {
      bids: orderbook.bids.map(l => ({ price: l.price, volume: l.quantity })),
      asks: orderbook.asks.map(l => ({ price: l.price, volume: l.quantity })),
      timestamp: Date.now(),
    };
    effectiveRtOFI = calcRealtimeOFIMultiLevel(currentSnapshot, orderbookPrev, 10);
  } else if (trades.length >= 20) {
    // 4.3b Trade-based rtOFI — из двух окон сделок
    // Разбиваем сделки на «предыдущее» и «текущее» окна
    // rtOFI = Δ(tradeOFI) — изменение дисбаланса между окнами
    const halfIdx = Math.floor(trades.length / 2);
    const prevWindowTrades = trades.slice(0, halfIdx);
    const curWindowTrades = trades.slice(halfIdx);

    const prevTradeOFI = calcTradeOFI(prevWindowTrades, Math.min(25, prevWindowTrades.length));
    const curTradeOFI = calcTradeOFI(curWindowTrades, Math.min(25, curWindowTrades.length));

    if (prevTradeOFI.buyCount + prevTradeOFI.sellCount > 0
        && curTradeOFI.buyCount + curTradeOFI.sellCount > 0) {
      effectiveRtOFI = curTradeOFI.weightedOFI - prevTradeOFI.weightedOFI;
    }
  }

  // Сохраняем текущий снапшот стакана в Redis (только если стакан актуален)
  if (orderbook.bids.length > 0 && orderbook.asks.length > 0 && !staleData) {
    try {
      const currentSnapshot: OrderBookSnapshot = {
        bids: orderbook.bids.map(l => ({ price: l.price, volume: l.quantity })),
        asks: orderbook.asks.map(l => ({ price: l.price, volume: l.quantity })),
        timestamp: Date.now(),
      };
      await redis.setex(obSnapshotKey, 300, JSON.stringify(currentSnapshot));
    } catch { /* ignore Redis errors */ }
  }
  const cumDelta: CumDeltaResult = calcCumDelta(trades);

  // 5. VPIN (через candles из trades)
  const candles = tradesToCandles(trades);
  const vpin: VPINResult = calcVPIN(candles);

  // 6. Ценовой ряд (последние 50 цен из trades)
  const prices = trades.slice(-50).map(t => t.price);
  const volumes = trades.slice(-50).map(t => t.quantity);

  // 7. RVI (only in full mode)
  let rvi: number | null = null;
  let oi: FuturesOIResult[] = [];

  if (!fastMode) {
    rvi = results[2]?.status === 'fulfilled' && results[2]?.value
      ? results[2].value.value : null;
    oi = results[3]?.status === 'fulfilled' ? results[3].value : [];
  }

  // 8. Кросс-тикерные данные (ENTANGLE)
  const defaultCrossTickers = crossTickers || ['GAZP', 'LKOH', 'GMKN', 'ROSN', 'NVTK'];
  const crossTickerData: Record<string, { priceChange: number; ofi: number }> = {};

  for (const f of oi.slice(0, 5)) {
    crossTickerData[f.ticker] = {
      priceChange: f.change,
      ofi: 0,
    };
  }

  for (const ct of defaultCrossTickers) {
    if (!crossTickerData[ct]) {
      crossTickerData[ct] = { priceChange: 0, ofi: 0 };
    }
  }

  // 9. П2-9: Z-score нормализация (для CIPHER, HAWKING, ACCRETOR)
  function zScoreNormalize(values: number[]): number[] {
    const n = values.length;
    if (n < 2) return values.map(() => 0);
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    if (std < 1e-6) return values.map(() => 0);
    return values.map(v => (v - mean) / std);
  }

  const zScorePrices = zScoreNormalize(prices);
  const zScoreVolumes = zScoreNormalize(volumes);

  // Интервалы между сделками (для CIPHER)
  const tradeIntervals: number[] = [];
  for (let i = 1; i < trades.length; i++) {
    const dt = (trades[i].timestamp || 0) - (trades[i - 1].timestamp || 0);
    if (dt > 0) tradeIntervals.push(dt);
  }
  const zScoreIntervals = zScoreNormalize(tradeIntervals);

  // 10. Формируем DetectorInput
  const detectorInput: DetectorInput = {
    ticker,
    orderbook,
    orderbookPrev,
    trades,
    recentTrades,
    ofi,
    weightedOFI,
    realtimeOFI: effectiveRtOFI,
    tradeOFI,
    ofiSource: useTradeOFI ? 'trades' : 'orderbook',
    cumDelta,
    vpin,
    prices,
    volumes,
    candles,
    crossTickers: Object.keys(crossTickerData).length > 0 ? crossTickerData : undefined,
    rvi: rvi ?? undefined,
    zScorePrices,
    zScoreVolumes,
    zScoreIntervals: zScoreIntervals.length > 0 ? zScoreIntervals : undefined,
    staleData: staleData || undefined,
    staleMinutes: staleData ? staleMinutes : undefined,
  };

  // DATA-DEBUG: диагностика (Sprint 5B — добавлен ofiSource)
  if (staleData || trades.length === 0 || (orderbook.bids.length === 0 && orderbook.asks.length === 0) || useTradeOFI) {
    console.warn(`[DATA-DEBUG] ${ticker} (${config.board}/${config.type}): stale=${staleData}, trades=${trades.length}, ob_bids=${orderbook.bids.length}, ob_asks=${orderbook.asks.length}, ofiSource=${useTradeOFI ? 'trades' : 'orderbook'}, obOFI=${ofiFromOB.toFixed(3)}, tradeOFI=${tradeOFI.ofi.toFixed(3)}, effectiveOFI=${ofi.toFixed(3)}, rtOFI=${effectiveRtOFI?.toFixed(3) || 'N/A'}`);
  }

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

  console.log(`[collect-market-data] Done: ${trades.length} trades, ${orderbook.bids.length} bids, ${orderbook.asks.length} asks, VPIN=${vpin.vpin.toFixed(3)}, OFI=${ofi.toFixed(3)} (${useTradeOFI ? 'trades' : 'OB'}), rtOFI=${effectiveRtOFI?.toFixed(3) || 'N/A'}, tradeOFI=${tradeOFI.ofi.toFixed(3)}`);

  return { detectorInput, marketSnapshot, tickerConfig: config };
}
