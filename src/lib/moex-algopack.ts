// ─── MOEX AlgoPack Library ──────────────────────────────────────────────────
// Парсеры и SCORE формулы для СТАКАН-СКАНЕР + ЛОКАТОР КРУПНЯКА
//
// Источник: https://apim.moex.com/iss/datashop/algopack/
// Авторизация: Authorization: Bearer {MOEX_JWT.trim()}
// Частота обновления: каждые 5 минут
//
// Ключевой инсайт: AlgoPack возвращает ВСЕ тикеры за 1 запрос!
// obstats.json?date=TODAY&latest=1    → ~250 тикеров
// tradestats.json?date=TODAY&latest=1  → ~250 тикеров
// orderstats.json?date=TODAY&latest=1  → ~250 тикеров

const MOEX_APIM = 'https://apim.moex.com/iss';
const MOEX_ALGOPACK = 'https://apim.moex.com/iss/datashop/algopack';
const MOEX_ISS = 'https://iss.moex.com/iss';

// Корректная медиана (для чётных — среднее двух центральных)
function medianOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ─── JWT Token (with trimming!) ──────────────────────────────────────────
function getJWT(): string {
  const raw = process.env.MOEX_JWT || '';
  // Vercel может добавлять \n в конец env var — ОБЯЗАТЕЛЬНО trim!
  return raw.trim();
}

function authHeaders(): Record<string, string> {
  const jwt = getJWT();
  return jwt
    ? { Authorization: `Bearer ${jwt}`, 'User-Agent': 'robot-detector-terminal/1.0' }
    : {};
}

// ─── Интерфейсы ──────────────────────────────────────────────────────────

export interface ObstatsEntry {
  secid: string;
  tradetime: string;
  spread_bbo: number;
  spread_lv10: number;
  spread_1mio: number;
  levels_b: number;
  levels_s: number;
  vol_b: number;
  vol_s: number;
  val_b: number;
  val_s: number;
  imbalance_vol_bbo: number;
  imbalance_val_bbo: number;
  imbalance_vol: number;
  imbalance_val: number;
  vwap_b: number;
  vwap_s: number;
  vwap_b_1mio: number;
  vwap_s_1mio: number;
}

export interface TradestatsEntry {
  secid: string;
  tradetime: string;
  pr_open: number;
  pr_high: number;
  pr_low: number;
  pr_close: number;
  vol: number;
  val: number;
  trades: number;
  pr_vwap: number;
  pr_change: number;
  vol_b: number;
  vol_s: number;
  val_b: number;
  val_s: number;
  trades_b: number;
  trades_s: number;
  disb: number;
  pr_vwap_b: number;
  pr_vwap_s: number;
}

export interface OrderstatsEntry {
  secid: string;
  tradetime: string;
  put_orders_b: number;
  put_orders_s: number;
  put_val_b: number;
  put_val_s: number;
  put_vol_b: number;
  put_vol_s: number;
  put_vwap_b: number;
  put_vwap_s: number;
  put_vol: number;
  put_val: number;
  put_orders: number;
  cancel_orders_b: number;
  cancel_orders_s: number;
  cancel_val_b: number;
  cancel_val_s: number;
  cancel_vol_b: number;
  cancel_vol_s: number;
  cancel_vwap_b: number;
  cancel_vwap_s: number;
  cancel_vol: number;
  cancel_val: number;
  cancel_orders: number;
  cancelRatio: number;  // рассчитанный: (cancel_vol) / (put_vol)
}

export interface MarketdataEntry {
  secid: string;
  valToday: number;  // VALTODAY — оборот за день
  volToday: number;  // VOLTODAY — объём за день
  wapPrice: number;  // WAPRICE — средневзвешенная
  lastPrice: number; // LAST — последняя цена
}

// ─── Результаты SCORE ────────────────────────────────────────────────────

export type WallTag = 'ТИХО' | 'СРОЧНО';

export interface WallScoreResult {
  secid: string;
  wallScore: number;         // [0, 100] нормализованный
  imbalance_vol: number;     // сырой дисбаланс объёма
  imbalance_val: number;     // сырой дисбаланс стоимости
  imbalance_vol_bbo: number; // дисбаланс на BBO
  volDomination: 'BID' | 'ASK'; // где стена
  volTotal: number;          // общий объём стакана
  valTotal: number;          // общая стоимость стакана
  spread_bbo: number;        // спред на лучшей цене
  vwap_b: number;
  vwap_s: number;
  valToday: number;          // оборот дня (для контекста)
  tag: WallTag;              // ТИХО / СРОЧНО
  tradetime: string;
}

export type AccumTag = 'ТИХО' | 'СРОЧНО';

export interface AccumScoreResult {
  secid: string;
  accumulationScore: number;  // [0, 100] нормализованный
  direction: 'LONG' | 'SHORT';
  deltaVal: number;           // val_b - val_s (руб)
  deltaVol: number;           // vol_b - vol_s (лоты)
  avgTradeSizeB: number;      // val_b / trades_b
  avgTradeSizeS: number;      // val_s / trades_s
  disb: number;               // MOEX disb метрика
  cancelRatio: number;        // доля отменённых ордеров
  spoofing: boolean;          // cancelRatio > 0.5
  tag: AccumTag;
  valToday: number;
  tradetime: string;
}

export interface AlgoPackResult {
  walls: WallScoreResult[];      // ТОП по wall_score
  accumulations: AccumScoreResult[]; // ТОП по accumulation_score
  spoofingTickers: string[];     // тикеры со спуфингом
  totalTickers: number;
  source: string;
  tradetime: string;
  date: string;
}

// ─── Парсеры ответов AlgoPack ────────────────────────────────────────────

function parseColumns<T>(columns: string[], rows: any[][], mapFn: (obj: Record<string, any>) => T | null): T[] {
  const result: T[] = [];
  for (const row of rows) {
    const obj: Record<string, any> = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    const parsed = mapFn(obj);
    if (parsed) result.push(parsed);
  }
  return result;
}

export function parseObstats(data: any): ObstatsEntry[] {
  const columns: string[] = data?.data?.columns || [];
  const rows: any[][] = data?.data?.data || [];
  return parseColumns<ObstatsEntry>(columns, rows, (obj) => {
    if (!obj.secid) return null;
    return {
      secid: String(obj.secid),
      tradetime: String(obj.tradetime || ''),
      spread_bbo: Number(obj.spread_bbo) || 0,
      spread_lv10: Number(obj.spread_lv10) || 0,
      spread_1mio: Number(obj.spread_1mio) || 0,
      levels_b: Number(obj.levels_b) || 0,
      levels_s: Number(obj.levels_s) || 0,
      vol_b: Number(obj.vol_b) || 0,
      vol_s: Number(obj.vol_s) || 0,
      val_b: Number(obj.val_b) || 0,
      val_s: Number(obj.val_s) || 0,
      imbalance_vol_bbo: Number(obj.imbalance_vol_bbo) || 0,
      imbalance_val_bbo: Number(obj.imbalance_val_bbo) || 0,
      imbalance_vol: Number(obj.imbalance_vol) || 0,
      imbalance_val: Number(obj.imbalance_val) || 0,
      vwap_b: Number(obj.vwap_b) || 0,
      vwap_s: Number(obj.vwap_s) || 0,
      vwap_b_1mio: Number(obj.vwap_b_1mio) || 0,
      vwap_s_1mio: Number(obj.vwap_s_1mio) || 0,
    };
  });
}

export function parseTradestats(data: any): TradestatsEntry[] {
  const columns: string[] = data?.data?.columns || [];
  const rows: any[][] = data?.data?.data || [];
  return parseColumns<TradestatsEntry>(columns, rows, (obj) => {
    if (!obj.secid) return null;
    return {
      secid: String(obj.secid),
      tradetime: String(obj.tradetime || ''),
      pr_open: Number(obj.pr_open) || 0,
      pr_high: Number(obj.pr_high) || 0,
      pr_low: Number(obj.pr_low) || 0,
      pr_close: Number(obj.pr_close) || 0,
      vol: Number(obj.vol) || 0,
      val: Number(obj.val) || 0,
      trades: Number(obj.trades) || 0,
      pr_vwap: Number(obj.pr_vwap) || 0,
      pr_change: Number(obj.pr_change) || 0,
      vol_b: Number(obj.vol_b) || 0,
      vol_s: Number(obj.vol_s) || 0,
      val_b: Number(obj.val_b) || 0,
      val_s: Number(obj.val_s) || 0,
      trades_b: Number(obj.trades_b) || 0,
      trades_s: Number(obj.trades_s) || 0,
      disb: Number(obj.disb) || 0,
      pr_vwap_b: Number(obj.pr_vwap_b) || 0,
      pr_vwap_s: Number(obj.pr_vwap_s) || 0,
    };
  });
}

export function parseOrderstats(data: any): OrderstatsEntry[] {
  const columns: string[] = data?.data?.columns || [];
  const rows: any[][] = data?.data?.data || [];
  return parseColumns<OrderstatsEntry>(columns, rows, (obj) => {
    if (!obj.secid) return null;
    const putVol = (Number(obj.put_vol_b) || 0) + (Number(obj.put_vol_s) || 0);
    const cancelVol = (Number(obj.cancel_vol_b) || 0) + (Number(obj.cancel_vol_s) || 0);
    const cancelRatio = putVol > 0 ? cancelVol / putVol : 0;
    return {
      secid: String(obj.secid),
      tradetime: String(obj.tradetime || ''),
      put_orders_b: Number(obj.put_orders_b) || 0,
      put_orders_s: Number(obj.put_orders_s) || 0,
      put_val_b: Number(obj.put_val_b) || 0,
      put_val_s: Number(obj.put_val_s) || 0,
      put_vol_b: Number(obj.put_vol_b) || 0,
      put_vol_s: Number(obj.put_vol_s) || 0,
      put_vwap_b: Number(obj.put_vwap_b) || 0,
      put_vwap_s: Number(obj.put_vwap_s) || 0,
      put_vol: Number(obj.put_vol) || 0,
      put_val: Number(obj.put_val) || 0,
      put_orders: Number(obj.put_orders) || 0,
      cancel_orders_b: Number(obj.cancel_orders_b) || 0,
      cancel_orders_s: Number(obj.cancel_orders_s) || 0,
      cancel_val_b: Number(obj.cancel_val_b) || 0,
      cancel_val_s: Number(obj.cancel_val_s) || 0,
      cancel_vol_b: Number(obj.cancel_vol_b) || 0,
      cancel_vol_s: Number(obj.cancel_vol_s) || 0,
      cancel_vwap_b: Number(obj.cancel_vwap_b) || 0,
      cancel_vwap_s: Number(obj.cancel_vwap_s) || 0,
      cancel_vol: Number(obj.cancel_vol) || 0,
      cancel_val: Number(obj.cancel_val) || 0,
      cancel_orders: Number(obj.cancel_orders) || 0,
      cancelRatio,
    };
  });
}

export function parseMarketdata(data: any): Map<string, MarketdataEntry> {
  const result = new Map<string, MarketdataEntry>();
  const columns: string[] = data?.marketdata?.columns || [];
  const rows: any[][] = data?.marketdata?.data || [];

  // Ищем индексы нужных колонок
  const idxSecid = columns.indexOf('SECID');
  const idxValToday = columns.indexOf('VALTODAY');
  const idxVolToday = columns.indexOf('VOLTODAY');
  const idxWap = columns.indexOf('WAPRICE');
  const idxLast = columns.indexOf('LAST');

  if (idxSecid === -1) return result;

  for (const row of rows) {
    const secid = String(row[idxSecid] || '');
    if (!secid) continue;
    const valToday = idxValToday >= 0 ? Number(row[idxValToday]) || 0 : 0;
    if (valToday <= 0) continue; // пропускаем без оборота
    result.set(secid, {
      secid,
      valToday,
      volToday: idxVolToday >= 0 ? Number(row[idxVolToday]) || 0 : 0,
      wapPrice: idxWap >= 0 ? Number(row[idxWap]) || 0 : 0,
      lastPrice: idxLast >= 0 ? Number(row[idxLast]) || 0 : 0,
    });
  }
  return result;
}

// ─── SCORE формулы ──────────────────────────────────────────────────────

/**
 * СТАКАН-СКАНЕР: wall_score v2
 * 
 * wallScore = imbalanceStrength × bboProximity × volumeScale × (1 - spreadPenalty)
 * 
 * imbalanceStrength = |imbalance_vol|  (0-1) — сила дисбаланса стакана по объёму
 * bboProximity = 0.3 + 0.7 × |imbalance_vol_bbo|  (0.3-1.0) — близость стены к BBO
 *   Стена на лучшей цене = срочнее, но глубокие стены тоже важны (базовый вес 0.3)
 * volumeScale = log(1 + valTotal / medianValTotal) / log(11)  (0-1)
 *   Масштаб стен в рублях: гигантская стена в GAZP важнее маленькой в неликвиде
 * spreadPenalty = min(spread_bbo / 50, 0.8)  (0-0.8)
 *   Широкий спред = мёртвый тикер, штраф до 80%
 * 
 * Фильтры: valToday >= 50М, spread_bbo < 50, |imbalance_vol| >= 0.05
 * Шкала: абсолютная (rawScore × 200, cap 100), не нормализация к максимуму
 * 
 * ТИХО: |imbalance_vol_bbo| < 0.3 — стена «глубокая», не на лучшей цене
 * СРОЧНО: |imbalance_vol_bbo| >= 0.3 — стена прямо на BBO, давит цену
 */
export function calculateWallScores(
  obstats: ObstatsEntry[],
  marketdata: Map<string, MarketdataEntry>,
): WallScoreResult[] {
  // 1. Медианный объём стакана для volumeScale
  const valTotals = obstats
    .map(ob => ob.val_b + ob.val_s)
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  const medianValTotal = valTotals.length > 0 ? medianOf(valTotals) : 100_000_000;

  // 2. Считаем wall_score для каждого тикера
  const results: WallScoreResult[] = [];
  for (const ob of obstats) {
    const md = marketdata.get(ob.secid);
    const valToday = md?.valToday || 0;

    // Фильтр качества: минимум 50 млн руб оборота, спред < 50%
    if (valToday < 50_000_000) continue;
    if (ob.spread_bbo >= 50) continue;

    const imbalanceVol = Math.abs(ob.imbalance_vol);

    // Минимальный дисбаланс 5%
    if (imbalanceVol < 0.05) continue;

    // imbalanceStrength: сила дисбаланса (0-1)
    const imbalanceStrength = imbalanceVol;

    // bboProximity: близость к лучшей цене (0.3-1.0)
    // Стена на BBO = срочнее, но глубокие стены тоже значимы
    const bboProximity = 0.3 + 0.7 * Math.abs(ob.imbalance_vol_bbo);

    // volumeScale: масштаб стен в рублях (0-1)
    const valTotal = ob.val_b + ob.val_s;
    const volumeScale = medianValTotal > 0
      ? Math.log(1 + valTotal / medianValTotal) / Math.log(11)
      : 0;

    // spreadPenalty: штраф за широкий спред (0-0.8)
    const spreadPenalty = Math.min(ob.spread_bbo / 50, 0.8);

    // Итоговый score (сырой)
    const rawScore = imbalanceStrength * bboProximity * volumeScale * (1 - spreadPenalty);

    // Классификация: ТИХО / СРОЧНО
    const bboImbalance = Math.abs(ob.imbalance_vol_bbo);
    const tag: WallTag = bboImbalance >= 0.3 ? 'СРОЧНО' : 'ТИХО';

    // Направление: где стена
    const volDomination: 'BID' | 'ASK' = ob.imbalance_vol >= 0 ? 'BID' : 'ASK';

    results.push({
      secid: ob.secid,
      wallScore: rawScore,
      imbalance_vol: ob.imbalance_vol,
      imbalance_val: ob.imbalance_val,
      imbalance_vol_bbo: ob.imbalance_vol_bbo,
      volDomination,
      volTotal: ob.vol_b + ob.vol_s,
      valTotal: ob.val_b + ob.val_s,
      spread_bbo: ob.spread_bbo,
      vwap_b: ob.vwap_b,
      vwap_s: ob.vwap_s,
      valToday,
      tag,
      tradetime: ob.tradetime,
    });
  }

  // 3. Абсолютная шкала: rawScore × 200, cap 100
  // 90-100 = мощнейшая стена, 50-89 = значимая, 20-49 = умеренная, <20 = слабая
  for (const r of results) {
    r.wallScore = Math.min(Math.round(r.wallScore * 200 * 10) / 10, 100);
  }

  // 4. Сортируем по убыванию score
  results.sort((a, b) => b.wallScore - a.wallScore);

  return results;
}

/**
 * ЛОКАТОР КРУПНЯКА: accumulation_score
 * 
 * accumulation_score = direction × magnitude × liquidity_scarcity × (1 + spoof_penalty)
 * 
 * direction = (val_b - val_s) / (val_b + val_s)  → [-1, 1]
 * magnitude = log(1 + |val_b - val_s| / 100_000)  — пониженный порог для неликвидов
 * liquidity_scarcity = 1 / (1 + log10(val_today / median_val)²)  — квадратичная зависимость
 * spoof_penalty = 0.5 × cancelRatio (если cancelRatio > 0.5)
 * 
 * ТИХО: |direction| < 0.15 или |disb| ≤ 0.5
 * СРОЧНО: |direction| ≥ 0.15 и |disb| > 0.5
 */
export function calculateAccumulationScores(
  tradestats: TradestatsEntry[],
  orderstats: OrderstatsEntry[],
  marketdata: Map<string, MarketdataEntry>,
): AccumScoreResult[] {
  // 1. Медианный оборот
  const vals = Array.from(marketdata.values())
    .map(m => m.valToday)
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  const medianVal = vals.length > 0 ? medianOf(vals) : 1_000_000_000;

  // 2. Индекс orderstats по secid
  const ordersMap = new Map<string, OrderstatsEntry>();
  for (const os of orderstats) {
    ordersMap.set(os.secid, os);
  }

  // 3. Считаем accumulation_score для каждого тикера
  const results: AccumScoreResult[] = [];
  for (const ts of tradestats) {
    const md = marketdata.get(ts.secid);
    const valToday = md?.valToday || 0;
    if (valToday < 50_000_000 || ts.trades < 30) continue; // минимум 50 млн руб оборота и 30 сделок для статистической значимости

    const totalVal = ts.val_b + ts.val_s;
    if (totalVal <= 0) continue;

    // direction: направление потока
    const direction = (ts.val_b - ts.val_s) / totalVal;

    // Пропускаем незначительную активность
    if (Math.abs(direction) < 0.02) continue;

    // magnitude: логарифмическая шкала
    const magnitude = Math.log(1 + Math.abs(ts.val_b - ts.val_s) / 100_000); // снизил порог для неликвидов

    // liquidity_scarcity: квадратичная зависимость для усиления неликвидов
    const logRatio = Math.log10(Math.max(valToday, 1) / medianVal);
    const scarcity = 1 / (1 + logRatio * logRatio);

    // spoof_penalty
    const os = ordersMap.get(ts.secid);
    const cancelRatio = os?.cancelRatio || 0;
    const spoofPenalty = cancelRatio > 0.5 ? 0.5 * cancelRatio : 0;

    // Итоговый score (сырой)
    const rawScore = Math.abs(direction) * magnitude * scarcity * (1 - spoofPenalty);

    // Классификация ТИХО / СРОЧНО
    // СРОЧНО = агрессивный маркет-ордерный напор: высокий disb, сильная направленность
    // ТИХО = тихое накопление через лимитные ордера
    const absDir = Math.abs(direction);
    const tag: AccumTag = (absDir >= 0.15 && Math.abs(ts.disb) > 0.5)
      ? 'СРОЧНО'
      : 'ТИХО';

    // Направление
    const dir: 'LONG' | 'SHORT' = direction >= 0 ? 'LONG' : 'SHORT';

    // Средний размер сделки
    const avgTradeSizeB = ts.trades_b > 0 ? ts.val_b / ts.trades_b : 0;
    const avgTradeSizeS = ts.trades_s > 0 ? ts.val_s / ts.trades_s : 0;

    results.push({
      secid: ts.secid,
      accumulationScore: rawScore,
      direction: dir,
      deltaVal: ts.val_b - ts.val_s,
      deltaVol: ts.vol_b - ts.vol_s,
      avgTradeSizeB,
      avgTradeSizeS,
      disb: ts.disb,
      cancelRatio,
      spoofing: cancelRatio > 0.7,
      tag,
      valToday,
      tradetime: ts.tradetime,
    });
  }

  // 4. Абсолютная шкала: rawScore * 20, cap 100
  // Это предотвращает иллюзию силы: слабый сигнал не получит 80 только потому что сильных нет
  // Шкала: 90-100 = мощнейший институциональный поток, 50-89 = значимый, 20-49 = умеренный, <20 = слабый
  for (const r of results) {
    r.accumulationScore = Math.min(Math.round(r.accumulationScore * 20 * 10) / 10, 100);
  }

  // 5. Сортируем по убыванию
  results.sort((a, b) => b.accumulationScore - a.accumulationScore);

  return results;
}

// ─── Основная функция: fetchAlgoPack ─────────────────────────────────────

export async function fetchAlgoPack(): Promise<AlgoPackResult> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Параллельно запрашиваем все 3 источника + marketdata
  const [obstatsRes, tradestatsRes, orderstatsRes, marketdataRes] = await Promise.allSettled([
    fetch(
      `${MOEX_ALGOPACK}/eq/obstats.json?date=${today}&latest=1&iss.meta=off`,
      { headers: authHeaders(), cache: 'no-store' as RequestCache }
    ),
    fetch(
      `${MOEX_ALGOPACK}/eq/tradestats.json?date=${today}&latest=1&iss.meta=off`,
      { headers: authHeaders(), cache: 'no-store' as RequestCache }
    ),
    fetch(
      `${MOEX_ALGOPACK}/eq/orderstats.json?date=${today}&latest=1&iss.meta=off`,
      { headers: authHeaders(), cache: 'no-store' as RequestCache }
    ),
    fetch(
      `${MOEX_APIM}/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,VALTODAY,VOLTODAY,WAPRICE,LAST`,
      { headers: authHeaders(), cache: 'no-store' as RequestCache }
    ),
  ]);

  // Парсим результаты
  let obstats: ObstatsEntry[] = [];
  let tradestats: TradestatsEntry[] = [];
  let orderstats: OrderstatsEntry[] = [];
  let marketdata = new Map<string, MarketdataEntry>();
  let source = 'algopack';
  let tradetime = '';

  // obstats
  if (obstatsRes.status === 'fulfilled' && obstatsRes.value.ok) {
    try {
      const data = await obstatsRes.value.json();
      obstats = parseObstats(data);
      if (obstats.length > 0) tradetime = obstats[0].tradetime;
    } catch (e) {
      console.warn('[ALGOPACK] obstats parse error:', e);
    }
  } else {
    console.warn('[ALGOPACK] obstats fetch failed:', obstatsRes.status === 'rejected' ? obstatsRes.reason : `HTTP ${obstatsRes.value?.status}`);
    source = 'partial';
  }

  // tradestats
  if (tradestatsRes.status === 'fulfilled' && tradestatsRes.value.ok) {
    try {
      const data = await tradestatsRes.value.json();
      tradestats = parseTradestats(data);
    } catch (e) {
      console.warn('[ALGOPACK] tradestats parse error:', e);
    }
  } else {
    console.warn('[ALGOPACK] tradestats fetch failed:', tradestatsRes.status === 'rejected' ? tradestatsRes.reason : `HTTP ${tradestatsRes.value?.status}`);
    source = 'partial';
  }

  // orderstats
  if (orderstatsRes.status === 'fulfilled' && orderstatsRes.value.ok) {
    try {
      const data = await orderstatsRes.value.json();
      orderstats = parseOrderstats(data);
    } catch (e) {
      console.warn('[ALGOPACK] orderstats parse error:', e);
    }
  } else {
    console.warn('[ALGOPACK] orderstats fetch failed:', orderstatsRes.status === 'rejected' ? orderstatsRes.reason : `HTTP ${orderstatsRes.value?.status}`);
    source = 'partial';
  }

  // marketdata
  if (marketdataRes.status === 'fulfilled' && marketdataRes.value.ok) {
    try {
      const data = await marketdataRes.value.json();
      marketdata = parseMarketdata(data);
    } catch (e) {
      console.warn('[ALGOPACK] marketdata parse error:', e);
    }
  } else {
    // Fallback на ISS без авторизации
    try {
      const fbRes = await fetch(
        `${MOEX_ISS}/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,VALTODAY,VOLTODAY,WAPRICE,LAST`,
        { cache: 'no-store' as RequestCache }
      );
      if (fbRes.ok) {
        const data = await fbRes.json();
        marketdata = parseMarketdata(data);
      }
    } catch (e) {
      console.warn('[ALGOPACK] marketdata fallback error:', e);
    }
  }

  // Считаем SCORE
  const walls = calculateWallScores(obstats, marketdata);
  const accumulations = calculateAccumulationScores(tradestats, orderstats, marketdata);

  // Спуфинг тикеры
  const spoofingTickers = orderstats
    .filter(os => os.cancelRatio > 0.7)
    .map(os => os.secid);

  if (obstats.length === 0 && tradestats.length === 0) {
    source = 'none';
  }

  return {
    walls,
    accumulations,
    spoofingTickers,
    totalTickers: Math.max(obstats.length, tradestats.length),
    source,
    tradetime,
    date: today,
  };
}
