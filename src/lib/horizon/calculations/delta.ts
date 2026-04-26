// ─── Cumulative Delta ─────────────────────────────────────────────────────
// CumDelta(t) = Σ_{i=0}^{t} (V_buy_i - V_sell_i)
// Источники: MOEX ISS (BUYSELL: B/S), Tinkoff (direction: BUY/SELL)

export interface Trade {
  price: number;
  quantity: number;
  /** MOEX: 'B' | 'S' | '...'   Tinkoff: 'BUY' | 'SELL' | '...' */
  direction: string;
  /** Алиас для direction (BUY/SELL) — для совместимости с robotContext */
  side?: string;
  /** Алиас для timestamp (ISO string) — для совместимости с robotContext */
  time?: string;
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

// ─── Дивергенция цена/дельта ──────────────────────────────────────────────
// Бычья дивергенция: цена падает, но CumDelta растёт → скрытая покупка
// Медвежья дивергенция: цена растёт, но CumDelta падает → скрытая продажа

export interface DivergenceResult {
  detected: boolean;
  type: 'BULLISH' | 'BEARISH' | 'NONE';
  strength: number;        // 0..1, насколько сильная дивергенция
  priceTrend: number;      // наклон цены (normalized)
  deltaTrend: number;      // наклон CumDelta (normalized)
  windowSize: number;
}

/**
 * Простая линейная регрессия для расчёта наклона (тренда)
 */
function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

/**
 * Нормализация наклона к [-1, 1] через стандартное отклонение.
 * Стандартное отклонение лучше mean_abs для финансовых данных:
 * оно учитывает разброс, а не масштаб абсолютных значений.
 */
function normalizeSlope(values: number[], slope: number): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return Math.max(-1, Math.min(1, slope / stdDev));
}

/**
 * Детекция дивергенции цена/дельта
 * @param prices — массив цен закрытия
 * @param cumDeltas — массив кумулятивных дельт
 * @param window — размер окна (по умолчанию 20)
 */
export function detectDivergence(
  prices: number[],
  cumDeltas: number[],
  window: number = 20
): DivergenceResult {
  if (prices.length < window || cumDeltas.length < window) {
    return {
      detected: false,
      type: 'NONE',
      strength: 0,
      priceTrend: 0,
      deltaTrend: 0,
      windowSize: Math.min(prices.length, cumDeltas.length),
    };
  }

  // Берём последние window элементов
  const priceSlice = prices.slice(-window);
  const deltaSlice = cumDeltas.slice(-window);

  // Рассчитываем тренды
  const priceReg = linearRegression(priceSlice);
  const deltaReg = linearRegression(deltaSlice);

  // Нормализуем наклоны
  const priceTrend = normalizeSlope(priceSlice, priceReg.slope);
  const deltaTrend = normalizeSlope(deltaSlice, deltaReg.slope);

  // Дивергенция: тренды направлены в РАЗНЫЕ стороны
  const divergenceMagnitude = Math.abs(priceTrend - deltaTrend) / 2;

  // Тип дивергенции
  let type: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';

  // Порог 0.01: при нормализации slope/mean_abs большие абсолютные значения
  // данных сглаживают наклон; 0.01 фильтрует шум, но ловит реальные тренды
  if (priceTrend < -0.01 && deltaTrend > 0.01) {
    // Цена падает, CumDelta растёт → бычья (скрытая покупка)
    type = 'BULLISH';
  } else if (priceTrend > 0.01 && deltaTrend < -0.01) {
    // Цена растёт, CumDelta падает → медвежья (скрытая продажа)
    type = 'BEARISH';
  }

  // Strength: на сколько сильная дивергенция (0 = нет, 1 = максимальная)
  const strength =
    type !== 'NONE' ? Math.min(1, divergenceMagnitude * 2) : 0;

  return {
    detected: type !== 'NONE',
    type,
    strength,
    priceTrend,
    deltaTrend,
    windowSize: window,
  };
}

/**
 * Мульти-таймфрейм дивергенция (3 окна одновременно)
 */
export function detectDivergenceMultiTF(
  prices: number[],
  cumDeltas: number[],
  windows: number[] = [10, 20, 50]
): DivergenceResult[] {
  return windows.map((w) => detectDivergence(prices, cumDeltas, w));
}
