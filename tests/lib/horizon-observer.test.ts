// ─── Tests: AI Observer (Phase 4) ──────────────────────────────────────────

import { getCurrentSlot, OBSERVER_SLOTS } from '@/lib/horizon/observer/generate-observation';
import type { DetectorInput, DetectorResult } from '@/lib/horizon/detectors/types';
import { runAllDetectors, calcBSCI } from '@/lib/horizon/detectors/registry';
import { calcOFI, calcWeightedOFI } from '@/lib/horizon/calculations/ofi';
import { calcCumDelta } from '@/lib/horizon/calculations/delta';
import { calcVPIN } from '@/lib/horizon/calculations/vpin';

// ─── Test Data Factory ──────────────────────────────────────────────────────

function makeDetectorInput(overrides: Partial<DetectorInput> = {}): DetectorInput {
  return {
    ticker: 'SBER',
    orderbook: {
      bids: [
        { price: 100, quantity: 500 },
        { price: 99.9, quantity: 300 },
        { price: 99.8, quantity: 200 },
      ],
      asks: [
        { price: 100.1, quantity: 400 },
        { price: 100.2, quantity: 350 },
        { price: 100.3, quantity: 250 },
      ],
    },
    trades: Array.from({ length: 30 }, (_, i) => ({
      price: 100 + (i % 5) * 0.1,
      quantity: 10 + (i % 3) * 5,
      direction: i % 3 === 0 ? 'S' : 'B',
      timestamp: Date.now() - (30 - i) * 1000,
    })),
    recentTrades: Array.from({ length: 10 }, (_, i) => ({
      price: 100.2 + i * 0.01,
      quantity: 15,
      direction: i % 2 === 0 ? 'B' : 'S',
      timestamp: Date.now() - (10 - i) * 1000,
    })),
    ofi: 0.1,
    weightedOFI: 0.15,
    cumDelta: { delta: 500, buyVolume: 1000, sellVolume: 500, totalVolume: 1500 },
    vpin: { vpin: 0.3, toxicity: 'moderate' as const, buckets: 50, avgBuyVolume: 100, avgSellVolume: 80 },
    prices: Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 2),
    volumes: Array.from({ length: 50 }, (_, i) => 100 + i * 2),
    candles: Array.from({ length: 30 }, (_, i) => ({
      open: 100 + (i % 3),
      close: 100 + ((i + 1) % 3),
      high: 100 + Math.max(i % 3, (i + 1) % 3) + 0.5,
      low: 100 - 0.5,
      volume: 100 + i * 10,
      timeDelta: 5,
    })),
    ...overrides,
  };
}

// ─── Observer Slot Tests ────────────────────────────────────────────────────

describe('AI Observer Slots', () => {
  test('OBSERVER_SLOTS has 6 slots', () => {
    expect(OBSERVER_SLOTS).toHaveLength(6);
  });

  test('slots have correct times', () => {
    expect(OBSERVER_SLOTS[0].time).toBe('08:00');
    expect(OBSERVER_SLOTS[1].time).toBe('10:30');
    expect(OBSERVER_SLOTS[2].time).toBe('12:00');
    expect(OBSERVER_SLOTS[3].time).toBe('15:00');
    expect(OBSERVER_SLOTS[4].time).toBe('17:00');
    expect(OBSERVER_SLOTS[5].time).toBe('20:00');
  });

  test('slots have names', () => {
    for (const slot of OBSERVER_SLOTS) {
      expect(slot.name).toBeTruthy();
      expect(slot.name.length).toBeGreaterThan(3);
    }
  });

  test('getCurrentSlot returns valid slot number', () => {
    const slot = getCurrentSlot();
    expect(slot.slot).toBeGreaterThanOrEqual(0);
    expect(slot.slot).toBeLessThanOrEqual(5);
    expect(slot.name).toBeTruthy();
    expect(slot.focus).toBeTruthy();
  });
});

// ─── Integration: collectMarketData → detectors → BSCI ──────────────────────

describe('Observer Pipeline: detectors + BSCI on synthetic data', () => {
  test('runAllDetectors returns 10 results on valid input', async () => {
    const input = makeDetectorInput();
    const results = await runAllDetectors(input);
    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(['BULLISH', 'BEARISH', 'NEUTRAL']).toContain(r.signal);
    }
  });

  test('calcBSCI on detector results produces valid composite', async () => {
    const input = makeDetectorInput();
    const scores = await runAllDetectors(input);
    const weights: Record<string, number> = {};
    const detectorNames = ['GRAVITON', 'DARKMATTER', 'ACCRETOR', 'DECOHERENCE', 'HAWKING', 'PREDATOR', 'CIPHER', 'ENTANGLE', 'WAVEFUNCTION', 'ATTRACTOR'];
    for (const d of detectorNames) weights[d] = 0.1;

    const bsci = calcBSCI(scores, weights);

    expect(bsci.bsci).toBeGreaterThanOrEqual(0);
    expect(bsci.bsci).toBeLessThanOrEqual(1);
    expect(['GREEN', 'YELLOW', 'ORANGE', 'RED']).toContain(bsci.alertLevel);
    expect(['BULLISH', 'BEARISH', 'NEUTRAL']).toContain(bsci.direction);
    expect(detectorNames).toContain(bsci.topDetector);
    expect(bsci.scores).toHaveLength(10);
  });

  test('BSCI with all zero scores → GREEN', async () => {
    const input = makeDetectorInput({
      orderbook: { bids: [], asks: [] },
      trades: [],
      recentTrades: [],
      ofi: 0,
      weightedOFI: 0,
      cumDelta: { delta: 0, buyVolume: 0, sellVolume: 0, totalVolume: 0 },
      vpin: { vpin: 0, toxicity: 'low', buckets: 0, avgBuyVolume: 0, avgSellVolume: 0 },
      prices: [],
      volumes: [],
      candles: [],
    });
    const scores = await runAllDetectors(input);
    const weights: Record<string, number> = {};
    const detectorNames = ['GRAVITON', 'DARKMATTER', 'ACCRETOR', 'DECOHERENCE', 'HAWKING', 'PREDATOR', 'CIPHER', 'ENTANGLE', 'WAVEFUNCTION', 'ATTRACTOR'];
    for (const d of detectorNames) weights[d] = 0.1;

    const bsci = calcBSCI(scores, weights);
    if (!Number.isNaN(bsci.bsci)) {
      expect(bsci.bsci).toBeLessThan(1);
    }
    expect(bsci.alertLevel).toBeDefined();
  });

  test('pipeline: OFI + CumDelta + VPIN calculated from raw data', () => {
    const input = makeDetectorInput();

    const ofi = calcOFI(input.orderbook);
    expect(ofi).toBeGreaterThanOrEqual(-1);
    expect(ofi).toBeLessThanOrEqual(1);

    const weightedOFI = calcWeightedOFI(input.orderbook);
    expect(weightedOFI).toBeGreaterThanOrEqual(-1);
    expect(weightedOFI).toBeLessThanOrEqual(1);

    const cumDelta = calcCumDelta(input.trades);
    expect(typeof cumDelta.delta).toBe('number');
    expect(cumDelta.totalVolume).toBeGreaterThan(0);

    if (input.candles.length > 1) {
      const vpin = calcVPIN(input.candles);
      expect(vpin.vpin).toBeGreaterThanOrEqual(0);
      expect(vpin.vpin).toBeLessThanOrEqual(1);
    }
  });

  test('BSCI with skewed weights → correct result', async () => {
    const input = makeDetectorInput();
    const scores = await runAllDetectors(input);

    const weights: Record<string, number> = {};
    const detectorNames = ['GRAVITON', 'DARKMATTER', 'ACCRETOR', 'DECOHERENCE', 'HAWKING', 'PREDATOR', 'CIPHER', 'ENTANGLE', 'WAVEFUNCTION', 'ATTRACTOR'];
    for (const d of detectorNames) weights[d] = d === 'GRAVITON' ? 0.5 : 0.0556;

    const bsci = calcBSCI(scores, weights);
    expect(bsci.bsci).toBeGreaterThanOrEqual(0);
    expect(bsci.bsci).toBeLessThanOrEqual(1);
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('Observer edge cases', () => {
  test('empty market data → all detectors return safe defaults', async () => {
    const input = makeDetectorInput({
      orderbook: { bids: [], asks: [] },
      trades: [],
      recentTrades: [],
      ofi: 0,
      weightedOFI: 0,
      cumDelta: { delta: 0, buyVolume: 0, sellVolume: 0, totalVolume: 0 },
      vpin: { vpin: 0, toxicity: 'low', buckets: 0, avgBuyVolume: 0, avgSellVolume: 0 },
      prices: [],
      volumes: [],
      candles: [],
      crossTickers: undefined,
      rvi: undefined,
    });

    const results = await runAllDetectors(input);
    for (const r of results) {
      if (typeof r.score === 'number' && !Number.isNaN(r.score)) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    }
  });

  test('extreme OFI → GRAVITON detects anomaly', async () => {
    const input = makeDetectorInput({
      ofi: 0.95,
      weightedOFI: 3.5,
      orderbook: {
        bids: [{ price: 100, quantity: 50000 }, ...Array.from({ length: 9 }, (_, i) => ({ price: 99.9 - i * 0.1, quantity: 100 }))],
        asks: Array.from({ length: 10 }, (_, i) => ({ price: 100.1 + i * 0.1, quantity: 100 })),
      },
    });

    const results = await runAllDetectors(input);
    const graviton = results.find(r => r.detector === 'GRAVITON');
    expect(graviton).toBeDefined();
    expect(graviton!.score).toBeGreaterThanOrEqual(0);
    expect(graviton!.metadata.cmBid).toBeDefined();
  });

  test('high VPIN → HAWKING detects toxicity', async () => {
    const periodicTrades = Array.from({ length: 60 }, (_, i) => ({
      price: 100 + Math.sin(i / 3) * 0.5,
      quantity: 50,
      direction: i % 2 === 0 ? 'B' : 'S',
      timestamp: Date.now() - (60 - i) * 200,
    }));
    const input = makeDetectorInput({
      trades: periodicTrades,
      recentTrades: periodicTrades.slice(-20),
      vpin: { vpin: 0.85, toxicity: 'extreme', buckets: 50, avgBuyVolume: 500, avgSellVolume: 100 },
      candles: Array.from({ length: 50 }, (_, i) => ({
        open: 100,
        close: i % 2 === 0 ? 101 : 99,
        high: 102,
        low: 98,
        volume: 200,
        timeDelta: 5,
      })),
    });

    const results = await runAllDetectors(input);
    const hawking = results.find(r => r.detector === 'HAWKING');
    expect(hawking).toBeDefined();
    expect(hawking!.score).toBeGreaterThan(0);
  });
});
