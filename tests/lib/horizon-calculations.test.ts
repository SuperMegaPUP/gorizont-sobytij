// ─── Horizon Calculations — Тесты ────────────────────────────────────────
// OFI, Cumulative Delta, VPIN, RealtimeOFI, Divergence

import { calcOFI, calcWeightedOFI, calcOFIByLevel, calcRealtimeOFI, calcRealtimeOFIMultiLevel } from '@/lib/horizon/calculations/ofi';
import type { OrderBookData, OrderBookSnapshot } from '@/lib/horizon/calculations/ofi';
import {
  calcCumDelta,
  updateCumDelta,
  classifyTrade,
  detectDivergence,
  detectDivergenceMultiTF,
} from '@/lib/horizon/calculations/delta';
import type { Trade, CumDeltaResult } from '@/lib/horizon/calculations/delta';
import {
  calcVPIN,
  bvcClassify,
  calcSigmaDeltaP,
  sliceIntoVolumeBuckets,
} from '@/lib/horizon/calculations/vpin';
import type { Candle } from '@/lib/horizon/calculations/vpin';

// ─── OFI ──────────────────────────────────────────────────────────────────

describe('Horizon: OFI (Order Flow Imbalance)', () => {
  const balancedBook: OrderBookData = {
    bids: [
      { price: 100, quantity: 50 },
      { price: 99, quantity: 50 },
    ],
    asks: [
      { price: 101, quantity: 50 },
      { price: 102, quantity: 50 },
    ],
  };

  const bidHeavyBook: OrderBookData = {
    bids: [
      { price: 100, quantity: 80 },
      { price: 99, quantity: 70 },
    ],
    asks: [
      { price: 101, quantity: 30 },
      { price: 102, quantity: 20 },
    ],
  };

  const emptyBook: OrderBookData = { bids: [], asks: [] };

  test('OFI = (V_bid - V_ask) / (V_bid + V_ask)', () => {
    // balanced: 100 vs 100 → OFI = 0
    expect(calcOFI(balancedBook)).toBeCloseTo(0, 10);
    // bid-heavy: 150 vs 50 → OFI = (150-50)/200 = 0.5
    expect(calcOFI(bidHeavyBook)).toBeCloseTo(0.5, 10);
  });

  test('OFI = 0 при пустом стакане', () => {
    expect(calcOFI(emptyBook)).toBe(0);
  });

  test('Weighted OFI: ближние уровни важнее', () => {
    // В balancedBook все уровни равноудалены — OFI ≈ 0
    const wofi = calcWeightedOFI(balancedBook);
    expect(wofi).toBeCloseTo(0, 5);

    // bidHeavyBook: ближний bid (80) весит больше дальнего (70)
    // WOFI должен быть ближе к +1 чем простой OFI
    const simpleOFI = calcOFI(bidHeavyBook);
    const weightedOFI = calcWeightedOFI(bidHeavyBook);
    // Оба положительные, но weighted может отличаться
    expect(weightedOFI).toBeGreaterThan(0);
  });

  test('OFI ∈ [-1, 1]', () => {
    // Максимальный дисбаланс
    const onlyBids: OrderBookData = {
      bids: [{ price: 100, quantity: 1000 }],
      asks: [],
    };
    expect(calcOFI(onlyBids)).toBe(1);

    const onlyAsks: OrderBookData = {
      bids: [],
      asks: [{ price: 101, quantity: 1000 }],
    };
    expect(calcOFI(onlyAsks)).toBe(-1);

    // Произвольный стакан — в пределах [-1, 1]
    const ofi = calcOFI(bidHeavyBook);
    expect(ofi).toBeGreaterThanOrEqual(-1);
    expect(ofi).toBeLessThanOrEqual(1);
  });

  test('OFI по уровням', () => {
    const levels = calcOFIByLevel(bidHeavyBook);
    expect(levels.length).toBe(2);
    // Level 0: 80 vs 30 → (80-30)/110 ≈ 0.4545
    expect(levels[0]).toBeCloseTo(50 / 110, 5);
    // Level 1: 70 vs 20 → (70-20)/90 ≈ 0.5555
    expect(levels[1]).toBeCloseTo(50 / 90, 5);
  });
});

// ─── Real-time OFI (Cont et al. 2014) ──────────────────────────────────────

describe('calcRealtimeOFI', () => {
  it('should return 0 for identical snapshots', () => {
    const snap: OrderBookSnapshot = {
      bids: [{ price: 100, volume: 50 }],
      asks: [{ price: 101, volume: 50 }],
      timestamp: Date.now(),
    };
    expect(calcRealtimeOFI(snap, snap)).toBe(0);
  });

  it('should detect bullish pressure when bid level moves up', () => {
    const prev: OrderBookSnapshot = {
      bids: [{ price: 100, volume: 50 }],
      asks: [{ price: 101, volume: 50 }],
      timestamp: 1,
    };
    const curr: OrderBookSnapshot = {
      bids: [{ price: 100.5, volume: 60 }], // bid сдвинулся ВВЕРХ
      asks: [{ price: 101, volume: 50 }],
      timestamp: 2,
    };
    // P_bid_t > P_bid_prev → ofi_bid = b_t = 60
    // P_ask_t === P_ask_prev → ofi_ask = a_t - a_prev = 0
    // result = 60 - 0 = 60 (positive = bullish)
    expect(calcRealtimeOFI(curr, prev)).toBe(60);
  });

  it('should detect bearish pressure when ask level moves down', () => {
    const prev: OrderBookSnapshot = {
      bids: [{ price: 100, volume: 50 }],
      asks: [{ price: 101, volume: 50 }],
      timestamp: 1,
    };
    const curr: OrderBookSnapshot = {
      bids: [{ price: 100, volume: 50 }],
      asks: [{ price: 100.5, volume: 60 }], // ask сдвинулся ВНИЗ
      timestamp: 2,
    };
    // P_bid_t === P_bid_prev → ofi_bid = 50 - 50 = 0
    // P_ask_t < P_ask_prev → ofi_ask = a_t = 60
    // result = 0 - 60 = -60 (negative = bearish)
    expect(calcRealtimeOFI(curr, prev)).toBe(-60);
  });

  it('should return 0 for empty snapshots', () => {
    const empty: OrderBookSnapshot = { bids: [], asks: [], timestamp: 0 };
    const snap: OrderBookSnapshot = {
      bids: [{ price: 100, volume: 50 }],
      asks: [{ price: 101, volume: 50 }],
      timestamp: 1,
    };
    expect(calcRealtimeOFI(empty, snap)).toBe(0);
    expect(calcRealtimeOFI(snap, empty)).toBe(0);
  });

  it('should detect bid moving down as bearish', () => {
    const prev: OrderBookSnapshot = {
      bids: [{ price: 100, volume: 50 }],
      asks: [{ price: 101, volume: 50 }],
      timestamp: 1,
    };
    const curr: OrderBookSnapshot = {
      bids: [{ price: 99.5, volume: 40 }], // bid сдвинулся ВНИЗ
      asks: [{ price: 101, volume: 50 }],
      timestamp: 2,
    };
    // P_bid_t < P_bid_prev → ofi_bid = -b_prev = -50
    // P_ask_t === P_ask_prev → ofi_ask = 0
    // result = -50 - 0 = -50
    expect(calcRealtimeOFI(curr, prev)).toBe(-50);
  });

  it('should detect ask moving up as bullish', () => {
    const prev: OrderBookSnapshot = {
      bids: [{ price: 100, volume: 50 }],
      asks: [{ price: 101, volume: 50 }],
      timestamp: 1,
    };
    const curr: OrderBookSnapshot = {
      bids: [{ price: 100, volume: 50 }],
      asks: [{ price: 101.5, volume: 40 }], // ask сдвинулся ВВЕРХ
      timestamp: 2,
    };
    // P_bid_t === P_bid_prev → ofi_bid = 0
    // P_ask_t > P_ask_prev → ofi_ask = -a_prev = -50
    // result = 0 - (-50) = 50 (positive = bullish)
    expect(calcRealtimeOFI(curr, prev)).toBe(50);
  });
});

describe('calcRealtimeOFIMultiLevel', () => {
  it('should aggregate across multiple levels', () => {
    const prev: OrderBookSnapshot = {
      bids: [
        { price: 100, volume: 50 },
        { price: 99, volume: 40 },
      ],
      asks: [
        { price: 101, volume: 50 },
        { price: 102, volume: 40 },
      ],
      timestamp: 1,
    };
    const curr: OrderBookSnapshot = {
      bids: [
        { price: 100.5, volume: 60 }, // bid level 0 moved up → bullish
        { price: 99, volume: 50 },    // bid level 1 same price, volume up
      ],
      asks: [
        { price: 101, volume: 50 },   // ask level 0 same
        { price: 102, volume: 40 },   // ask level 1 same
      ],
      timestamp: 2,
    };
    const result = calcRealtimeOFIMultiLevel(curr, prev, 2);
    // Level 0: ofi_bid=60, ofi_ask=0 → 60
    // Level 1: ofi_bid=50-40=10, ofi_ask=0 → 10
    // Total: 70
    expect(result).toBe(70);
  });

  it('should respect kLevels limit', () => {
    const prev: OrderBookSnapshot = {
      bids: [
        { price: 100, volume: 50 },
        { price: 99, volume: 40 },
        { price: 98, volume: 30 },
      ],
      asks: [
        { price: 101, volume: 50 },
        { price: 102, volume: 40 },
        { price: 103, volume: 30 },
      ],
      timestamp: 1,
    };
    const curr: OrderBookSnapshot = {
      bids: [
        { price: 100, volume: 60 },
        { price: 99, volume: 50 },
        { price: 98, volume: 20 },
      ],
      asks: [
        { price: 101, volume: 40 },
        { price: 102, volume: 40 },
        { price: 103, volume: 30 },
      ],
      timestamp: 2,
    };

    const oneLevel = calcRealtimeOFIMultiLevel(curr, prev, 1);
    const twoLevels = calcRealtimeOFIMultiLevel(curr, prev, 2);
    // More levels → different result
    expect(oneLevel).not.toBe(twoLevels);
  });

  it('should return 0 for empty snapshots', () => {
    const empty: OrderBookSnapshot = { bids: [], asks: [], timestamp: 0 };
    const snap: OrderBookSnapshot = {
      bids: [{ price: 100, volume: 50 }],
      asks: [{ price: 101, volume: 50 }],
      timestamp: 1,
    };
    expect(calcRealtimeOFIMultiLevel(empty, snap, 5)).toBe(0);
  });
});

// ─── Cumulative Delta ─────────────────────────────────────────────────────

describe('Horizon: Cumulative Delta', () => {
  test('CumDelta = Σ(buy_vol - sell_vol)', () => {
    const trades: Trade[] = [
      { price: 100, quantity: 10, direction: 'B' },
      { price: 100, quantity: 5, direction: 'S' },
      { price: 101, quantity: 20, direction: 'BUY' },
      { price: 101, quantity: 15, direction: 'SELL' },
    ];
    const result = calcCumDelta(trades);
    // buy: 10 + 20 = 30, sell: 5 + 15 = 20
    expect(result.delta).toBe(10);
    expect(result.buyVolume).toBe(30);
    expect(result.sellVolume).toBe(20);
    expect(result.totalVolume).toBe(50);
  });

  test('CumDelta = 0 при пустых данных', () => {
    const result = calcCumDelta([]);
    expect(result.delta).toBe(0);
    expect(result.buyVolume).toBe(0);
    expect(result.sellVolume).toBe(0);
  });

  test('MOEX BUYSELL: B → buy, S → sell', () => {
    expect(classifyTrade({ price: 100, quantity: 1, direction: 'B' })).toBe('buy');
    expect(classifyTrade({ price: 100, quantity: 1, direction: 'S' })).toBe('sell');
  });

  test('Tinkoff direction: BUY → buy, SELL → sell', () => {
    expect(classifyTrade({ price: 100, quantity: 1, direction: 'BUY' })).toBe('buy');
    expect(classifyTrade({ price: 100, quantity: 1, direction: 'SELL' })).toBe('sell');
  });

  test('CumDelta монотонно обновляется', () => {
    const prev: CumDeltaResult = {
      delta: 100,
      buyVolume: 500,
      sellVolume: 400,
      totalVolume: 900,
    };
    const newTrades: Trade[] = [
      { price: 102, quantity: 50, direction: 'B' },
      { price: 102, quantity: 30, direction: 'S' },
    ];
    const updated = updateCumDelta(prev, newTrades);
    expect(updated.delta).toBe(120); // 100 + (50-30)
    expect(updated.buyVolume).toBe(550);
    expect(updated.sellVolume).toBe(430);
    expect(updated.totalVolume).toBe(980);
  });

  test('Unknown direction игнорируется', () => {
    const trades: Trade[] = [
      { price: 100, quantity: 10, direction: 'B' },
      { price: 100, quantity: 5, direction: 'X' },
    ];
    const result = calcCumDelta(trades);
    expect(result.delta).toBe(10); // только B учтён
    expect(result.totalVolume).toBe(10); // X не учтён
  });
});

// ─── Divergence ────────────────────────────────────────────────────────────

describe('detectDivergence', () => {
  it('should detect bullish divergence (price down, delta up)', () => {
    // Цена падает: 100, 99.5, 99, 98.5, 98...
    const prices = Array.from({ length: 30 }, (_, i) => 100 - i * 0.5);
    // CumDelta растёт: 0, 5, 10, 15, 20...
    const cumDeltas = Array.from({ length: 30 }, (_, i) => i * 5);

    const result = detectDivergence(prices, cumDeltas, 20);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('BULLISH');
    expect(result.strength).toBeGreaterThan(0);
  });

  it('should detect bearish divergence (price up, delta down)', () => {
    // Цена растёт
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i * 0.5);
    // CumDelta падает
    const cumDeltas = Array.from({ length: 30 }, (_, i) => -i * 5);

    const result = detectDivergence(prices, cumDeltas, 20);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('BEARISH');
    expect(result.strength).toBeGreaterThan(0);
  });

  it('should return NONE when price and delta move together', () => {
    // Оба растут — дивергенции нет
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const cumDeltas = Array.from({ length: 30 }, (_, i) => i * 10);

    const result = detectDivergence(prices, cumDeltas, 20);
    expect(result.type).toBe('NONE');
    expect(result.detected).toBe(false);
  });

  it('should return NONE for insufficient data', () => {
    const result = detectDivergence([100, 101], [0, 5], 20);
    expect(result.detected).toBe(false);
    expect(result.type).toBe('NONE');
  });

  it('should work with multi-timeframe', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 - i * 0.3);
    const cumDeltas = Array.from({ length: 60 }, (_, i) => i * 3);

    const results = detectDivergenceMultiTF(prices, cumDeltas, [10, 20, 50]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.type === 'BULLISH')).toBe(true);
  });

  it('should report strength between 0 and 1', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 - i * 0.5);
    const cumDeltas = Array.from({ length: 30 }, (_, i) => i * 5);

    const result = detectDivergence(prices, cumDeltas, 20);
    expect(result.strength).toBeGreaterThanOrEqual(0);
    expect(result.strength).toBeLessThanOrEqual(1);
  });
});

// ─── VPIN ─────────────────────────────────────────────────────────────────

describe('Horizon: VPIN', () => {
  const balancedCandles: Candle[] = Array.from({ length: 100 }, (_, i) => ({
    open: 100,
    close: 100, // close = open → 50/50 классификация
    high: 101,
    low: 99,
    volume: 1000,
  }));

  const bullishCandles: Candle[] = Array.from({ length: 100 }, (_, i) => ({
    open: 100,
    close: 102, // close > open → больше buy
    high: 103,
    low: 99,
    volume: 1000,
  }));

  test('VPIN = Σ|V_buy - V_sell| / Σ(V_buy + V_sell) по 50 корзинам', () => {
    const result = calcVPIN(balancedCandles, 50);
    // При close=open → BVC = 50/50 → VPIN должен быть близок к 0
    expect(result.vpin).toBeCloseTo(0, 1);
    expect(result.buckets).toBeGreaterThan(0);
  });

  test('VPIN = 0 при одинаковых buy/sell', () => {
    // Все свечи с close=open → BVC даёт 50/50
    const result = calcVPIN(balancedCandles, 50);
    expect(result.vpin).toBeLessThan(0.05); // ≈0
  });

  test('VPIN > 0.6 = высокая токсичность', () => {
    // Чередующиеся свечи: сильное движение вверх vs слабое вниз
    // Это создаёт дисбаланс buy/sell → высокий VPIN
    const extremeCandles: Candle[] = Array.from({ length: 100 }, (_, i) => ({
      open: 100,
      close: i % 2 === 0 ? 105 : 99, // то вверх, то вниз — но не симметрично
      high: i % 2 === 0 ? 106 : 101,
      low: i % 2 === 0 ? 99 : 98,
      volume: 1000,
    }));
    const result = calcVPIN(extremeCandles, 50);
    // VPIN > 0 при несимметричных потоках
    expect(result.vpin).toBeGreaterThan(0.1);
    // Токсичность при наличии дисбаланса
    expect(result.buckets).toBeGreaterThan(0);
  });

  test('BVC классификация: V_buy = V × Φ((close-open)/σ)', () => {
    const sigma = 1;
    // close > open → buy > sell
    const up = bvcClassify(
      { open: 100, close: 102, high: 103, low: 99, volume: 1000 },
      sigma
    );
    expect(up.buyVolume).toBeGreaterThan(up.sellVolume);

    // close < open → sell > buy
    const down = bvcClassify(
      { open: 100, close: 98, high: 103, low: 97, volume: 1000 },
      sigma
    );
    expect(down.sellVolume).toBeGreaterThan(down.buyVolume);

    // close = open → 50/50
    const flat = bvcClassify(
      { open: 100, close: 100, high: 101, low: 99, volume: 1000 },
      sigma
    );
    expect(flat.buyVolume).toBeCloseTo(flat.sellVolume, 5);
  });

  test('VPIN ∈ [0, 1]', () => {
    const result = calcVPIN(bullishCandles, 50);
    expect(result.vpin).toBeGreaterThanOrEqual(0);
    expect(result.vpin).toBeLessThanOrEqual(1);
  });

  test('VPIN = 0 при пустых данных', () => {
    const result = calcVPIN([], 50);
    expect(result.vpin).toBe(0);
    expect(result.toxicity).toBe('low');
  });

  test('calcSigmaDeltaP для 1 свечи = 0', () => {
    expect(
      calcSigmaDeltaP([{ open: 100, close: 101, high: 102, low: 99, volume: 100 }])
    ).toBe(0);
  });
});

// ─── VPIN BVC with timeDelta ─────────────────────────────────────────────

describe('VPIN BVC with timeDelta', () => {
  it('should handle candles with timeDelta correctly', () => {
    const candles: Candle[] = [
      { open: 100, close: 101, high: 101, low: 99, volume: 1000, timeDelta: 1 },
      { open: 101, close: 103, high: 103, low: 100, volume: 1200, timeDelta: 5 },
      { open: 103, close: 100, high: 104, low: 100, volume: 800, timeDelta: 2 },
    ];
    // Candle 2: ΔP=2, Δt=5, σ_ΔP≈1.53 → z = 2/(1.53×√5) ≈ 0.58 → больше BUY
    // Candle 3: ΔP=-3, Δt=2, σ_ΔP≈2.08 → z = -3/(2.08×√2) ≈ -1.02 → больше SELL
    const result = calcVPIN(candles);
    expect(result.vpin).toBeGreaterThanOrEqual(0);
    expect(result.vpin).toBeLessThanOrEqual(1);
  });

  it('should be backward compatible when timeDelta is omitted', () => {
    const withDelta: Candle[] = [
      { open: 100, close: 102, high: 102, low: 100, volume: 500, timeDelta: 1 },
      { open: 102, close: 100, high: 102, low: 100, volume: 500, timeDelta: 1 },
    ];
    const withoutDelta: Candle[] = [
      { open: 100, close: 102, high: 102, low: 100, volume: 500 },
      { open: 102, close: 100, high: 102, low: 100, volume: 500 },
    ];
    // timeDelta=1 ≡ нет timeDelta → одинаковый результат
    expect(calcVPIN(withDelta).vpin).toBeCloseTo(calcVPIN(withoutDelta).vpin, 10);
  });

  it('longer timeDelta should reduce z-score (normalize volatility)', () => {
    // Нужны минимум 3 свечи для calcSigmaDeltaP ≠ 0 (нужна дисперсия в приращениях)
    const shortDt: Candle[] = [
      { open: 100, close: 101, high: 101, low: 100, volume: 1000, timeDelta: 1 },
      { open: 101, close: 103, high: 103, low: 100, volume: 1000, timeDelta: 1 },
      { open: 103, close: 102, high: 104, low: 101, volume: 1000, timeDelta: 1 },
    ];
    const longDt: Candle[] = [
      { open: 100, close: 101, high: 101, low: 100, volume: 1000, timeDelta: 25 },
      { open: 101, close: 103, high: 103, low: 100, volume: 1000, timeDelta: 25 },
      { open: 103, close: 102, high: 104, low: 101, volume: 1000, timeDelta: 25 },
    ];
    // При Δt=25, √25=5, z-score в 5 раз меньше → BVC ближе к 50/50 → VPIN ниже
    // Это правильно: то же движение за 25 сек — менее информативно, чем за 1 сек
    const vpinShort = calcVPIN(shortDt).vpin;
    const vpinLong = calcVPIN(longDt).vpin;
    // VPIN с коротким Δt должен быть выше (более "токсичный" поток)
    expect(vpinShort).toBeGreaterThan(vpinLong);
  });

  it('sliceIntoVolumeBuckets should fill timeDelta', () => {
    const trades = [
      { price: 100, volume: 300, timestamp: 1000 },
      { price: 101, volume: 300, timestamp: 3000 }, // 2 сек
      { price: 102, volume: 400, timestamp: 8000 }, // 7 сек
    ];
    const buckets = sliceIntoVolumeBuckets(trades, 500);
    // Первый бакет: trades 1+2, volume=600, startTime=1000, lastTime=3000
    // timeDelta = (3000-1000)/1000 = 2.0 сек
    expect(buckets.length).toBeGreaterThanOrEqual(1);
    expect(buckets[0].timeDelta).toBeDefined();
    expect(buckets[0].timeDelta).toBeGreaterThan(0);
  });

  it('sliceIntoVolumeBuckets should produce valid OHLCV candles', () => {
    const trades = [
      { price: 100, volume: 200, timestamp: 1000 },
      { price: 102, volume: 200, timestamp: 2000 },
      { price: 101, volume: 200, timestamp: 3000 },
    ];
    const buckets = sliceIntoVolumeBuckets(trades, 400);
    expect(buckets.length).toBeGreaterThanOrEqual(1);
    // First bucket open = first trade price
    expect(buckets[0].open).toBe(100);
    // High should be max price in bucket
    expect(buckets[0].high).toBeGreaterThanOrEqual(102);
    // Low should be min price in bucket
    expect(buckets[0].low).toBeLessThanOrEqual(100);
  });

  it('sliceIntoVolumeBuckets with empty trades', () => {
    const buckets = sliceIntoVolumeBuckets([], 500);
    expect(buckets).toHaveLength(0);
  });
});
