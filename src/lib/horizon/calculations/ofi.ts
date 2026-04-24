// ─── OFI (Order Flow Imbalance) ──────────────────────────────────────────
// Формула: OFI = (V_bid - V_ask) / (V_bid + V_ask)
// Взвешенный: Weighted_OFI = Σ(w_i × (V_bid_i - V_ask_i)) / Σ(w_i × (V_bid_i + V_ask_i))
// w_i = 1 / (1 + distance_i) — ближние уровни важнее

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
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
