// ─── OFI (Order Flow Imbalance) ──────────────────────────────────────────
// Формула: OFI = (V_bid - V_ask) / (V_bid + V_ask)
// Взвешенный: Weighted_OFI = Σ(w_i × (V_bid_i - V_ask_i)) / Σ(w_i × (V_bid_i + V_ask_i))
// w_i = 1 / (1 + distance_i) — ближние уровни важнее
// Real-time OFI (Cont, Kukanov, Stoikov 2014) — учитывает движение ценовых уровней

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
