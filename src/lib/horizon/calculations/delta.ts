// ─── Cumulative Delta ─────────────────────────────────────────────────────
// CumDelta(t) = Σ_{i=0}^{t} (V_buy_i - V_sell_i)
// Источники: MOEX ISS (BUYSELL: B/S), Tinkoff (direction: BUY/SELL)

export interface Trade {
  price: number;
  quantity: number;
  /** MOEX: 'B' | 'S' | '...'   Tinkoff: 'BUY' | 'SELL' | '...' */
  direction: string;
  timestamp?: number;
}

export interface CumDeltaResult {
  delta: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
}

/**
 * Классифицирует сделку: buy или sell
 * MOEX: BUYSELL = 'B' → buy, 'S' → sell
 * Tinkoff: direction = 'BUY' → buy, 'SELL' → sell
 */
export function classifyTrade(trade: Trade): 'buy' | 'sell' | 'unknown' {
  const d = trade.direction.toUpperCase().trim();
  if (d === 'B' || d === 'BUY') return 'buy';
  if (d === 'S' || d === 'SELL') return 'sell';
  return 'unknown';
}

/**
 * Вычисляет кумулятивную дельту по массиву сделок
 */
export function calcCumDelta(trades: Trade[]): CumDeltaResult {
  let buyVol = 0;
  let sellVol = 0;

  for (const trade of trades) {
    const side = classifyTrade(trade);
    if (side === 'buy') {
      buyVol += trade.quantity;
    } else if (side === 'sell') {
      sellVol += trade.quantity;
    }
    // unknown — игнорируем
  }

  return {
    delta: buyVol - sellVol,
    buyVolume: buyVol,
    sellVolume: sellVol,
    totalVolume: buyVol + sellVol,
  };
}

/**
 * Инкрементальное обновление дельты (для real-time)
 */
export function updateCumDelta(
  prev: CumDeltaResult,
  newTrades: Trade[]
): CumDeltaResult {
  const inc = calcCumDelta(newTrades);
  return {
    delta: prev.delta + inc.delta,
    buyVolume: prev.buyVolume + inc.buyVolume,
    sellVolume: prev.sellVolume + inc.sellVolume,
    totalVolume: prev.totalVolume + inc.totalVolume,
  };
}

/**
 * Дельта по временным корзинам (для графика)
 */
export function calcDeltaBuckets(
  trades: Trade[],
  bucketMs: number
): CumDeltaResult[] {
  if (trades.length === 0) return [];

  // Сортируем по времени
  const sorted = [...trades].sort(
    (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
  );

  const startTs = sorted[0].timestamp || 0;
  const buckets: Trade[][] = [];

  for (const trade of sorted) {
    const ts = trade.timestamp || startTs;
    const idx = Math.floor((ts - startTs) / bucketMs);
    while (buckets.length <= idx) buckets.push([]);
    buckets[idx].push(trade);
  }

  return buckets.map((bucket) => calcCumDelta(bucket));
}
