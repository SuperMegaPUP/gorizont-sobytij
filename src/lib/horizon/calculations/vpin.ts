// ─── VPIN (Volume-Synchronized Probability of Informed Trading) ──────────
// Easley, López de Prado, O'Hara (2012)
//
// Алгоритм:
// 1. Аккумулировать объём в корзины фиксированного размера V (1/50 дневного объёма)
// 2. Классифицировать объём через BVC: V_buy = V_total × Φ((close-open) / σ_ΔP)
// 3. VPIN = Σ|V_buy - V_sell| / Σ(V_buy + V_sell) по 50 корзинам
// 4. VPIN > 0.6 = высокая токсичность, > 0.8 = экстремальная

export interface Candle {
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface VPINResult {
  vpin: number;
  toxicity: 'low' | 'moderate' | 'high' | 'extreme';
  buckets: number;
  avgBuyVolume: number;
  avgSellVolume: number;
}

/**
 * Нормальное CDF (аппроксимация Abramowitz & Stegun)
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

/**
 * BVC (Bulk Volume Classification) — классификация объёма по свече
 * V_buy = V_total × Φ((close - open) / σ_ΔP)
 * V_sell = V_total - V_buy
 */
export function bvcClassify(
  candle: Candle,
  sigmaDeltaP: number
): { buyVolume: number; sellVolume: number } {
  if (sigmaDeltaP <= 0) {
    // Если σ=0, считаем 50/50
    return {
      buyVolume: candle.volume / 2,
      sellVolume: candle.volume / 2,
    };
  }

  const z = (candle.close - candle.open) / sigmaDeltaP;
  const buyFraction = normalCDF(z);

  return {
    buyVolume: candle.volume * buyFraction,
    sellVolume: candle.volume * (1 - buyFraction),
  };
}

/**
 * Вычисляет σ_ΔP (стандартное отклонение приращений цен)
 */
export function calcSigmaDeltaP(candles: Candle[]): number {
  if (candles.length < 2) return 0;

  const diffs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    diffs.push(candles[i].close - candles[i - 1].close);
  }

  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const variance =
    diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / diffs.length;

  return Math.sqrt(variance);
}

/**
 * VPIN — основной расчёт
 * @param candles — массив свечей (минимум 2 для σ)
 * @param numBuckets — количество корзин (обычно 50)
 */
export function calcVPIN(candles: Candle[], numBuckets: number = 50): VPINResult {
  if (candles.length === 0) {
    return {
      vpin: 0,
      toxicity: 'low',
      buckets: 0,
      avgBuyVolume: 0,
      avgSellVolume: 0,
    };
  }

  const sigma = calcSigmaDeltaP(candles);

  // BVC классификация каждой свечи
  const classified = candles.map((c) => bvcClassify(c, sigma));

  // Общий объём и размер корзины
  const totalVolume = classified.reduce(
    (s, c) => s + c.buyVolume + c.sellVolume,
    0
  );
  const bucketSize = totalVolume / numBuckets;

  if (bucketSize <= 0) {
    return {
      vpin: 0,
      toxicity: 'low',
      buckets: 0,
      avgBuyVolume: 0,
      avgSellVolume: 0,
    };
  }

  // Аккумулируем в корзины
  let accBuy = 0;
  let accSell = 0;
  let bucketBuy = 0;
  let bucketSell = 0;
  let bucketFill = 0;
  let numFilled = 0;
  let sumAbsDelta = 0;
  let sumTotal = 0;

  for (const c of classified) {
    let remaining = c.buyVolume + c.sellVolume;
    let buyShare = c.buyVolume / (c.buyVolume + c.sellVolume || 1);
    let sellShare = c.sellVolume / (c.buyVolume + c.sellVolume || 1);

    while (remaining > 0) {
      const space = bucketSize - bucketFill;
      const fill = Math.min(remaining, space);

      bucketBuy += fill * buyShare;
      bucketSell += fill * sellShare;
      bucketFill += fill;
      remaining -= fill;

      if (bucketFill >= bucketSize - 0.001) {
        // Корзина заполнена
        sumAbsDelta += Math.abs(bucketBuy - bucketSell);
        sumTotal += bucketBuy + bucketSell;
        numFilled++;
        bucketBuy = 0;
        bucketSell = 0;
        bucketFill = 0;
      }
    }
  }

  const vpin = sumTotal > 0 ? sumAbsDelta / sumTotal : 0;

  // Классификация токсичности
  let toxicity: VPINResult['toxicity'] = 'low';
  if (vpin >= 0.8) toxicity = 'extreme';
  else if (vpin >= 0.6) toxicity = 'high';
  else if (vpin >= 0.3) toxicity = 'moderate';

  return {
    vpin: Math.min(vpin, 1), // VPIN ∈ [0, 1]
    toxicity,
    buckets: numFilled,
    avgBuyVolume: numFilled > 0 ? sumTotal / numFilled / 2 : 0,
    avgSellVolume: numFilled > 0 ? sumTotal / numFilled / 2 : 0,
  };
}
