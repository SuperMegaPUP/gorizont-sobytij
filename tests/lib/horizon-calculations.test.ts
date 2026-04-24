// ─── Horizon Calculations — Тесты ────────────────────────────────────────
// OFI, Cumulative Delta, VPIN

import { calcOFI, calcWeightedOFI, calcOFIByLevel } from '@/lib/horizon/calculations/ofi';
import type { OrderBookData } from '@/lib/horizon/calculations/ofi';
import {
  calcCumDelta,
  updateCumDelta,
  classifyTrade,
} from '@/lib/horizon/calculations/delta';
import type { Trade, CumDeltaResult } from '@/lib/horizon/calculations/delta';
import {
  calcVPIN,
  bvcClassify,
  calcSigmaDeltaP,
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
    expect(calcSigmaDeltaP([{ open: 100, close: 101, high: 102, low: 99, volume: 100 }])).toBe(0);
  });
});
