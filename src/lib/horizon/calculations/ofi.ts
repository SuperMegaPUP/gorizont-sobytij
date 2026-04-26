// ─── OFI (Order Flow Imbalance) ──────────────────────────────────────────
// Формула: OFI = (V_bid - V_ask) / (V_bid + V_ask)
// Взвешенный: Weighted_OFI = Σ(w_i × (V_bid_i - V_ask_i)) / Σ(w_i × (V_bid_i + V_ask_i))
// w_i = 1 / (1 + distance_i) — ближние уровни важнее
// Real-time OFI (Cont, Kukanov, Stoikov 2014) — учитывает движение ценовых уровней
// Trade-based OFI — считает OFI из сделок (BUY/SELL direction), работает без стакана

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

/**
 * Снапшот стакана для Real-time OFI (Cont et al. 2014)
 * Каждый уровень содержит price + volume (вместо quantity — для совместимости с API)
 */
export interface OrderBookSnapshot {
  bids: Array<{ price: number; volume: number }>;
  asks: Array<{ price: number; volume: number }>;
  timestamp: number;
}

/**
 * Простой OFI — дисбаланс объёмов в стакане
 * OFI ∈ [-1, 1]: -1 = все продажи, +1 = все покупки
 */
export function calcOFI(data: OrderBookData): number {
  const vBid = data.bids.reduce((s, l) => s + l.quantity, 0);
  const vAsk = data.asks.reduce((s, l) => s + l.quantity, 0);
  const total = vBid + vAsk;
  if (total === 0) return 0;
  return (vBid - vAsk) / total;
}

/**
 * Взвешенный OFI — ближние уровни важнее
 * weight_i = 1 / (1 + distance_from_mid)
 */
export function calcWeightedOFI(data: OrderBookData): number {
  if (data.bids.length === 0 && data.asks.length === 0) return 0;

  // Вычисляем mid price
  const bestBid = data.bids.length > 0 ? data.bids[0].price : 0;
  const bestAsk = data.asks.length > 0 ? data.asks[0].price : 0;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 0;

  if (mid === 0) return 0;

  let num = 0;
  let den = 0;

  for (const level of data.bids) {
    const dist = Math.abs(level.price - mid);
    const w = 1 / (1 + dist);
    num += w * level.quantity;
    den += w * level.quantity;
  }

  for (const level of data.asks) {
    const dist = Math.abs(level.price - mid);
    const w = 1 / (1 + dist);
    num -= w * level.quantity;
    den += w * level.quantity;
  }

  if (den === 0) return 0;
  return num / den;
}

/**
 * OFI по уровням — массив дисбалансов для каждого уровня стакана
 */
export function calcOFIByLevel(data: OrderBookData): number[] {
  const maxLevels = Math.max(data.bids.length, data.asks.length);
  const result: number[] = [];

  for (let i = 0; i < maxLevels; i++) {
    const bidVol = i < data.bids.length ? data.bids[i].quantity : 0;
    const askVol = i < data.asks.length ? data.asks[i].quantity : 0;
    const total = bidVol + askVol;
    result.push(total === 0 ? 0 : (bidVol - askVol) / total);
  }

  return result;
}

// ─── Real-time OFI (Cont, Kukanov, Stoikov 2014) ─────────────────────────
// Учитывает движение ЦЕНОВЫХ УРОВНЕЙ, а не только объёмов.
// Ключевое отличие от Simple/Weighted: если бид-уровень сдвинулся ВВЕРХ
// и объём вырос — это бычье давление, даже если объём на лучшем биде упал.

/**
 * Real-time OFI — один уровень (best bid/ask)
 * Положительный = бычье давление, отрицательный = медвежье
 */
export function calcRealtimeOFI(
  current: OrderBookSnapshot,
  previous: OrderBookSnapshot
): number {
  if (
    !previous.bids.length ||
    !previous.asks.length ||
    !current.bids.length ||
    !current.asks.length
  ) {
    return 0;
  }

  const b_t = current.bids[0].volume;
  const b_prev = previous.bids[0].volume;
  const a_t = current.asks[0].volume;
  const a_prev = previous.asks[0].volume;

  const P_bid_t = current.bids[0].price;
  const P_bid_prev = previous.bids[0].price;
  const P_ask_t = current.asks[0].price;
  const P_ask_prev = previous.asks[0].price;

  // Bid side contribution
  let ofi_bid: number;
  if (P_bid_t > P_bid_prev) {
    // Бид сдвинулся ВВЕРХ → полностью бычье
    ofi_bid = b_t;
  } else if (P_bid_t === P_bid_prev) {
    // Бид на том же уровне → изменение объёма
    ofi_bid = b_t - b_prev;
  } else {
    // Бид сдвинулся ВНИЗ → полностью медвежье
    ofi_bid = -b_prev;
  }

  // Ask side contribution (зеркально)
  let ofi_ask: number;
  if (P_ask_t < P_ask_prev) {
    // Аск сдвинулся ВНИЗ → медвежье давление
    ofi_ask = a_t;
  } else if (P_ask_t === P_ask_prev) {
    // Аск на том же уровне → изменение объёма
    ofi_ask = a_t - a_prev;
  } else {
    // Аск сдвинулся ВВЕРХ → бычье (аск отдаляется)
    ofi_ask = -a_prev;
  }

  // Итого: положительный = бычье давление, отрицательный = медвежье
  return ofi_bid - ofi_ask;
}

/**
 * Multi-level Real-time OFI (сумма по K уровням)
 * kLevels = сколько уровней стакана анализировать (обычно 5-10)
 */
export function calcRealtimeOFIMultiLevel(
  current: OrderBookSnapshot,
  previous: OrderBookSnapshot,
  kLevels: number = 5
): number {
  let totalOfi = 0;
  const levels = Math.min(
    kLevels,
    current.bids.length,
    previous.bids.length,
    current.asks.length,
    previous.asks.length
  );

  for (let k = 0; k < levels; k++) {
    const curBid = current.bids[k];
    const prevBid = previous.bids[k];
    const curAsk = current.asks[k];
    const prevAsk = previous.asks[k];

    // Bid side
    let ofi_bid: number;
    if (curBid.price > prevBid.price) {
      ofi_bid = curBid.volume;
    } else if (curBid.price === prevBid.price) {
      ofi_bid = curBid.volume - prevBid.volume;
    } else {
      ofi_bid = -prevBid.volume;
    }

    // Ask side
    let ofi_ask: number;
    if (curAsk.price < prevAsk.price) {
      ofi_ask = curAsk.volume;
    } else if (curAsk.price === prevAsk.price) {
      ofi_ask = curAsk.volume - prevAsk.volume;
    } else {
      ofi_ask = -prevAsk.volume;
    }

    totalOfi += ofi_bid - ofi_ask;
  }

  return totalOfi;
}

// ─── Trade-based OFI ──────────────────────────────────────────────────────
// Считает OFI из сделок, используя направление BUY/SELL.
// Работает БЕЗ стакана — критически важно на выходных (ДСВД), когда
// ISS orderbook возвращает HTML, но trades доступны через reversed=1.
//
// Формула:
//   TradeOFI = (V_buy - V_sell) / (V_buy + V_sell)
//   Взвешенный: w_i = exp(-α × age_i), где age = время от самой свежей сделки
//
// Это даёт нормализованный OFI ∈ [-1, +1], аналогичный orderbook OFI,
// но основанный на РЕАЛЬНЫХ сделках, а не лимитных ордерах.

export interface TradeOFIResult {
  /** Простой trade-based OFI ∈ [-1, +1] */
  ofi: number;
  /** Взвешенный (time-decay) trade-based OFI ∈ [-1, +1] */
  weightedOFI: number;
  /** Общий объём покупок */
  buyVolume: number;
  /** Общий объём продаж */
  sellVolume: number;
  /** Количество сделок покупки */
  buyCount: number;
  /** Количество сделок продажи */
  sellCount: number;
  /** Дисбаланс по последним N сделкам (near-term) */
  nearTermOFI: number;
  /** Источник данных */
  source: 'trades';
}

/**
 * Классифицирует сделку: buy или sell
 * MOEX ISS: BUYSELL = 'B' → buy, 'S' → sell
 */
function classifyTradeDirection(direction: string): 'buy' | 'sell' | 'unknown' {
  const d = direction.toUpperCase().trim();
  if (d === 'B' || d === 'BUY') return 'buy';
  if (d === 'S' || d === 'SELL') return 'sell';
  return 'unknown';
}

/**
 * Trade-based OFI — простой дисбаланс объёмов покупок/продаж
 * ofi = (V_buy - V_sell) / (V_buy + V_sell) ∈ [-1, +1]
 *
 * @param trades — массив сделок с направлением (BUYSELL)
 * @param recentCount — сколько последних сделок использовать для near-term (default 50)
 */
export function calcTradeOFI(
  trades: Array<{ quantity: number; direction: string; timestamp?: number }>,
  recentCount: number = 50
): TradeOFIResult {
  const empty: TradeOFIResult = {
    ofi: 0, weightedOFI: 0,
    buyVolume: 0, sellVolume: 0,
    buyCount: 0, sellCount: 0,
    nearTermOFI: 0, source: 'trades',
  };

  if (!trades || trades.length === 0) return empty;

  let buyVol = 0, sellVol = 0;
  let buyCnt = 0, sellCnt = 0;

  // Считаем общий OFI по всем сделкам
  for (const t of trades) {
    const side = classifyTradeDirection(t.direction);
    if (side === 'buy') {
      buyVol += t.quantity;
      buyCnt++;
    } else if (side === 'sell') {
      sellVol += t.quantity;
      sellCnt++;
    }
  }

  const totalVol = buyVol + sellVol;
  const ofi = totalVol > 0 ? (buyVol - sellVol) / totalVol : 0;

  // Near-term OFI — по последним N сделкам (более чувствителен к текущему моменту)
  const recentTrades = trades.slice(-recentCount);
  let recentBuyVol = 0, recentSellVol = 0;
  for (const t of recentTrades) {
    const side = classifyTradeDirection(t.direction);
    if (side === 'buy') recentBuyVol += t.quantity;
    else if (side === 'sell') recentSellVol += t.quantity;
  }
  const recentTotalVol = recentBuyVol + recentSellVol;
  const nearTermOFI = recentTotalVol > 0
    ? (recentBuyVol - recentSellVol) / recentTotalVol
    : 0;

  // Weighted OFI с time-decay (экспоненциальное затухание по возрасту сделки)
  // w_i = exp(-α × age_seconds / 600)  — период полураспада ≈ 10 минут
  const ALPHA = 0.001; // per second, ~10 min half-life: ln(2)/600 ≈ 0.00116
  const newestTs = Math.max(...trades.map(t => t.timestamp || 0));

  let wNum = 0, wDen = 0;
  for (const t of trades) {
    const side = classifyTradeDirection(t.direction);
    if (side === 'unknown') continue;

    const ageSec = newestTs > 0 ? Math.max(0, (newestTs - (t.timestamp || 0)) / 1000) : 0;
    const weight = Math.exp(-ALPHA * ageSec);
    const vol = t.quantity;

    if (side === 'buy') {
      wNum += weight * vol;
      wDen += weight * vol;
    } else {
      wNum -= weight * vol;
      wDen += weight * vol;
    }
  }

  const weightedOFI = wDen > 0 ? wNum / wDen : 0;

  return {
    ofi: Math.round(ofi * 10000) / 10000,
    weightedOFI: Math.round(weightedOFI * 10000) / 10000,
    buyVolume: buyVol,
    sellVolume: sellVol,
    buyCount: buyCnt,
    sellCount: sellCnt,
    nearTermOFI: Math.round(nearTermOFI * 10000) / 10000,
    source: 'trades',
  };
}
