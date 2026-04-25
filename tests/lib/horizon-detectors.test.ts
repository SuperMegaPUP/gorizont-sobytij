// ─── Black Star Detectors — Тесты ──────────────────────────────────────────

import {
  detectGraviton,
  detectDarkmatter,
  detectAccretor,
  detectDecoherence,
  detectHawking,
  detectPredator,
  detectCipher,
  detectEntangle,
  detectWavefunction,
  detectAttractor,
  runAllDetectors,
  calcBSCI,
} from '@/lib/horizon/detectors';
import type { DetectorInput, DetectorResult } from '@/lib/horizon/detectors';
import type { OrderBookData } from '@/lib/horizon/calculations/ofi';
import type { Trade, CumDeltaResult } from '@/lib/horizon/calculations/delta';
import type { Candle, VPINResult } from '@/lib/horizon/calculations/vpin';

// ─── Тестовые данные ──────────────────────────────────────────────────────

function makeInput(overrides: Partial<DetectorInput> = {}): DetectorInput {
  const balancedBook: OrderBookData = {
    bids: Array.from({ length: 10 }, (_, i) => ({ price: 100 - i * 0.1, quantity: 100 + i * 10 })),
    asks: Array.from({ length: 10 }, (_, i) => ({ price: 100.1 + i * 0.1, quantity: 100 + i * 10 })),
  };

  const trades: Trade[] = Array.from({ length: 50 }, (_, i) => ({
    price: 100 + (i % 5) * 0.1,
    quantity: 10,
    direction: i % 3 === 0 ? 'SELL' : 'BUY',
    timestamp: 1000000 + i * 100,
  }));

  const cumDelta: CumDeltaResult = { delta: 200, buyVolume: 600, sellVolume: 400, totalVolume: 1000 };
  const vpin: VPINResult = { vpin: 0.4, toxicity: 'moderate', buckets: 25, avgBuyVolume: 500, avgSellVolume: 500 };

  return {
    ticker: 'SBER',
    orderbook: balancedBook,
    trades,
    recentTrades: trades.slice(-20),
    ofi: 0.2,
    weightedOFI: 0.25,
    cumDelta,
    vpin,
    prices: Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 5) * 2),
    volumes: Array.from({ length: 30 }, () => 1000),
    candles: Array.from({ length: 20 }, (_, i) => ({
      open: 100 + i * 0.1,
      close: 100 + (i + 1) * 0.1,
      high: 100 + (i + 1) * 0.1 + 0.5,
      low: 100 + i * 0.1 - 0.5,
      volume: 1000,
    })),
    ...overrides,
  };
}

// ─── Общие тесты для всех детекторов ──────────────────────────────────────

describe('Black Star Detectors: Common', () => {
  const input = makeInput();

  test('runAllDetectors возвращает 10 результатов', () => {
    const results = runAllDetectors(input);
    expect(results).toHaveLength(10);
    const names = results.map(r => r.detector);
    expect(names).toContain('GRAVITON');
    expect(names).toContain('DARKMATTER');
    expect(names).toContain('ACCRETOR');
    expect(names).toContain('DECOHERENCE');
    expect(names).toContain('HAWKING');
    expect(names).toContain('PREDATOR');
    expect(names).toContain('CIPHER');
    expect(names).toContain('ENTANGLE');
    expect(names).toContain('WAVEFUNCTION');
    expect(names).toContain('ATTRACTOR');
  });

  test('каждый детектор возвращает корректную структуру', () => {
    const results = runAllDetectors(input);
    for (const r of results) {
      expect(r.detector).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(['BULLISH', 'BEARISH', 'NEUTRAL']).toContain(r.signal);
      expect(r.metadata).toBeDefined();
    }
  });
});

// ─── GRAVITON ─────────────────────────────────────────────────────────────

describe('GRAVITON', () => {
  test('высокий score при концентрации на лучшем уровне', () => {
    const input = makeInput({
      orderbook: {
        bids: [{ price: 100, quantity: 900 }, { price: 99.9, quantity: 50 }, { price: 99.8, quantity: 50 }],
        asks: [{ price: 100.1, quantity: 100 }, { price: 100.2, quantity: 100 }],
      },
      ofi: 0.7,
      weightedOFI: 0.9,
    });
    const result = detectGraviton(input);
    expect(result.detector).toBe('GRAVITON');
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.metadata.lensingRatio).toBeDefined();
    expect(result.metadata.bidConcentration).toBeDefined();
  });

  test('низкий score при сбалансированном стакане', () => {
    const input = makeInput({
      orderbook: {
        bids: Array.from({ length: 10 }, (_, i) => ({ price: 100 - i, quantity: 100 })),
        asks: Array.from({ length: 10 }, (_, i) => ({ price: 101 + i, quantity: 100 })),
      },
      ofi: 0,
      weightedOFI: 0,
    });
    const result = detectGraviton(input);
    expect(result.score).toBeLessThan(0.3);
  });
});

// ─── DARKMATTER ───────────────────────────────────────────────────────────

describe('DARKMATTER', () => {
  test('высокий score при скрытой ликвидности', () => {
    // v4.1: DARKMATTER теперь использует ΔH_norm + iceberg consecutive
    // Создаём стакан с неравномерным распределением (низкая энтропия = скрытая ликвидность)
    // И сделки с consecutive runs одинакового объёма на одном уровне
    const icebergTrades: Trade[] = [];
    // 5 сделок подряд объёмом 100 на одном уровне = iceberg pattern
    for (let i = 0; i < 5; i++) {
      icebergTrades.push({ price: 100, quantity: 100, direction: 'BUY', timestamp: Date.now() + i * 100 });
    }
    // Дополнительные сделки для дневного оборота
    for (let i = 0; i < 20; i++) {
      icebergTrades.push({ price: 100 + Math.random(), quantity: 10 + Math.floor(Math.random() * 30), direction: i % 2 === 0 ? 'BUY' : 'SELL', timestamp: Date.now() + (5 + i) * 100 });
    }
    const input = makeInput({
      orderbook: {
        bids: [
          { price: 100, quantity: 5000 },  // огромный уровень
          { price: 99.9, quantity: 50 },
          { price: 99.8, quantity: 50 },
        ],
        asks: [
          { price: 100.1, quantity: 50 },
          { price: 100.2, quantity: 50 },
        ],
      },
      trades: icebergTrades,
      recentTrades: icebergTrades.slice(-20),
      ofi: -0.3,
      cumDelta: { delta: 500, buyVolume: 750, sellVolume: 250, totalVolume: 1000 },
    });
    const result = detectDarkmatter(input);
    expect(result.detector).toBe('DARKMATTER');
    expect(result.metadata.deltaH_norm).toBeDefined();
    expect(result.metadata.icebergScore).toBeDefined();
  });

  test('низкий score при прозрачном рынке', () => {
    const input = makeInput({
      orderbook: {
        bids: Array.from({ length: 20 }, (_, i) => ({ price: 100 - i * 0.1, quantity: 500 })),
        asks: Array.from({ length: 20 }, (_, i) => ({ price: 100.1 + i * 0.1, quantity: 500 })),
      },
      recentTrades: Array.from({ length: 5 }, () => ({ price: 100, quantity: 1, direction: 'BUY', timestamp: Date.now() })),
    });
    const result = detectDarkmatter(input);
    expect(result.score).toBeLessThan(0.5);
  });
});

// ─── ACCRETOR ─────────────────────────────────────────────────────────────

describe('ACCRETOR', () => {
  test('обнаруживает монотонное накопление', () => {
    const trades: Trade[] = Array.from({ length: 30 }, (_, i) => ({
      price: 100,
      quantity: 10,
      direction: 'BUY',
      timestamp: 1000000 + i * 100,
    }));
    const input = makeInput({
      trades,
      prices: Array.from({ length: 30 }, () => 100), // цена стоит
    });
    const result = detectAccretor(input);
    expect(result.detector).toBe('ACCRETOR');
    expect(result.score).toBeGreaterThan(0);
  });

  test('нет данных → score = 0', () => {
    const input = makeInput({ trades: [], prices: [100] });
    const result = detectAccretor(input);
    expect(result.score).toBe(0);
  });
});

// ─── DECOHERENCE ──────────────────────────────────────────────────────────

describe('DECOHERENCE', () => {
  test('обнаруживает расхождение OFI и CumDelta', () => {
    const input = makeInput({
      ofi: 0.5,  // стакан бычий
      cumDelta: { delta: -300, buyVolume: 200, sellVolume: 500, totalVolume: 700 }, // дельта медвежья
    });
    const result = detectDecoherence(input);
    expect(result.detector).toBe('DECOHERENCE');
    expect(result.metadata.flowDivergence).toBe(true);
  });

  test('нет расхождения → низкий score', () => {
    const input = makeInput({
      ofi: 0.5,
      cumDelta: { delta: 300, buyVolume: 500, sellVolume: 200, totalVolume: 700 },
    });
    const result = detectDecoherence(input);
    expect(result.metadata.flowDivergence).toBe(false);
  });
});

// ─── HAWKING ──────────────────────────────────────────────────────────────

describe('HAWKING', () => {
  test('периодичные сделки → высокий score', () => {
    // v4.1: HAWKING теперь использует ACF + PSD вместо VPIN-only
    // Создаём 60+ сделок с периодичными интервалами (алгоритмический паттерн)
    const periodicTrades: Trade[] = [];
    for (let i = 0; i < 80; i++) {
      periodicTrades.push({
        price: 100 + Math.sin(i / 3) * 0.5, // цена с периодичностью
        quantity: 50,
        direction: i % 2 === 0 ? 'BUY' : 'SELL',
        timestamp: 1000000 + i * 200, // ровно 200мс между сделками = 5Hz
      });
    }
    const input = makeInput({
      trades: periodicTrades,
      vpin: { vpin: 0.85, toxicity: 'extreme', buckets: 45, avgBuyVolume: 400, avgSellVolume: 600 },
    });
    const result = detectHawking(input);
    expect(result.detector).toBe('HAWKING');
    // С периодичными интервалами score должен быть > 0
    expect(result.score).toBeGreaterThan(0);
    expect(result.metadata.periodicity).toBeDefined();
    expect(result.metadata.noiseRatio).toBeDefined();
  });

  test('мало сделок → score = 0', () => {
    // Меньше 50 сделок → недостаточно данных
    const fewTrades: Trade[] = Array.from({ length: 30 }, (_, i) => ({
      price: 100, quantity: 10, direction: 'BUY', timestamp: 1000000 + i * 100,
    }));
    const input = makeInput({
      trades: fewTrades,
      vpin: { vpin: 0.1, toxicity: 'low', buckets: 30, avgBuyVolume: 500, avgSellVolume: 500 },
    });
    const result = detectHawking(input);
    expect(result.score).toBe(0);
    expect(result.metadata.insufficientData).toBe(true);
  });
});

// ─── PREDATOR ─────────────────────────────────────────────────────────────

describe('PREDATOR', () => {
  test('обнаруживает ценовой спайк', () => {
    const prices = Array.from({ length: 20 }, (_, i) => 100 + (i === 18 ? 3 : Math.random() * 0.1));
    const input = makeInput({ prices });
    const result = detectPredator(input);
    expect(result.detector).toBe('PREDATOR');
    expect(result.metadata.spikeSigma).toBeDefined();
  });

  test('нет данных → score = 0', () => {
    const input = makeInput({ prices: [100], volumes: [] });
    const result = detectPredator(input);
    expect(result.score).toBe(0);
  });
});

// ─── CIPHER ───────────────────────────────────────────────────────────────

describe('CIPHER', () => {
  test('обнаруживает периодические интервалы', () => {
    const trades: Trade[] = Array.from({ length: 20 }, (_, i) => ({
      price: 100,
      quantity: 50,
      direction: 'BUY',
      timestamp: 1000000 + i * 1000, // ровно 1 сек между сделками
    }));
    const input = makeInput({ recentTrades: trades });
    const result = detectCipher(input);
    expect(result.detector).toBe('CIPHER');
    expect(result.metadata.cv).toBeDefined();
    expect(result.metadata.cv as number).toBeLessThan(0.2);
  });

  test('случайные интервалы → низкий score', () => {
    const trades: Trade[] = Array.from({ length: 20 }, (_, i) => ({
      price: 100,
      quantity: Math.random() * 100,
      direction: i % 2 === 0 ? 'BUY' : 'SELL',
      timestamp: 1000000 + Math.random() * 10000,
    }));
    const input = makeInput({ recentTrades: trades });
    const result = detectCipher(input);
    expect(result.metadata.cv as number).toBeGreaterThan(0.3);
  });
});

// ─── ENTANGLE ─────────────────────────────────────────────────────────────

describe('ENTANGLE', () => {
  test('обнаруживает кросс-тикерную корреляцию', () => {
    const input = makeInput({
      prices: Array.from({ length: 20 }, (_, i) => 100 + i * 0.1),
      crossTickers: {
        GAZP: { priceChange: 2.0, ofi: 0.3 },
        LKOH: { priceChange: 1.8, ofi: 0.25 },
      },
    });
    const result = detectEntangle(input);
    expect(result.detector).toBe('ENTANGLE');
    expect(result.metadata.maxCorrelation).toBeDefined();
  });

  test('нет кросс-тикерных данных → score = 0', () => {
    const input = makeInput({ crossTickers: undefined });
    const result = detectEntangle(input);
    expect(result.score).toBe(0);
    expect(result.metadata.noCrossData).toBe(true);
  });
});

// ─── WAVEFUNCTION ─────────────────────────────────────────────────────────

describe('WAVEFUNCTION', () => {
  test('обнаруживает циклический паттерн', () => {
    // Синусоида — идеальный циклический паттерн
    const prices = Array.from({ length: 40 }, (_, i) =>
      100 + Math.sin(i * Math.PI / 5) * 3
    );
    const input = makeInput({ prices });
    const result = detectWavefunction(input);
    expect(result.detector).toBe('WAVEFUNCTION');
    expect(result.metadata.dominantPeriod).toBeDefined();
    expect(result.metadata.autocorrStrength as number).toBeGreaterThan(0);
  });

  test('монотонный рост → слабый цикл', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const input = makeInput({ prices });
    const result = detectWavefunction(input);
    // Монотонный ряд не имеет цикла
    expect(result.score).toBeLessThan(0.7);
  });

  test('мало данных → score = 0', () => {
    const input = makeInput({ prices: [100, 101] });
    const result = detectWavefunction(input);
    expect(result.score).toBe(0);
  });
});

// ─── ATTRACTOR ────────────────────────────────────────────────────────────

describe('ATTRACTOR', () => {
  test('обнаруживает кластеризацию вокруг уровня', () => {
    // Цена колеблется вокруг 100
    const prices = Array.from({ length: 30 }, (_, i) =>
      i % 3 === 0 ? 100 : 100 + (Math.random() - 0.5) * 2
    );
    const input = makeInput({ prices });
    const result = detectAttractor(input);
    expect(result.detector).toBe('ATTRACTOR');
    expect(result.metadata.attractorPrice).toBeDefined();
    expect(result.metadata.clusteringStrength as number).toBeGreaterThan(0);
  });

  test('нет данных → score = 0', () => {
    const input = makeInput({ prices: [100], recentTrades: [] });
    const result = detectAttractor(input);
    expect(result.score).toBe(0);
  });
});

// ─── BSCI Composite ───────────────────────────────────────────────────────

describe('BSCI Composite Index', () => {
  test('BSCI = Σ(w_i × score_i) / Σ(w_i)', () => {
    const scores: DetectorResult[] = [
      { detector: 'GRAVITON', description: '', score: 0.8, confidence: 0.9, signal: 'BULLISH', metadata: {} },
      { detector: 'DARKMATTER', description: '', score: 0.3, confidence: 0.5, signal: 'NEUTRAL', metadata: {} },
      { detector: 'ACCRETOR', description: '', score: 0.6, confidence: 0.7, signal: 'BULLISH', metadata: {} },
      { detector: 'DECOHERENCE', description: '', score: 0.2, confidence: 0.3, signal: 'NEUTRAL', metadata: {} },
      { detector: 'HAWKING', description: '', score: 0.5, confidence: 0.6, signal: 'BEARISH', metadata: {} },
      { detector: 'PREDATOR', description: '', score: 0.4, confidence: 0.5, signal: 'BULLISH', metadata: {} },
      { detector: 'CIPHER', description: '', score: 0.1, confidence: 0.2, signal: 'NEUTRAL', metadata: {} },
      { detector: 'ENTANGLE', description: '', score: 0.7, confidence: 0.8, signal: 'BULLISH', metadata: {} },
      { detector: 'WAVEFUNCTION', description: '', score: 0.3, confidence: 0.4, signal: 'NEUTRAL', metadata: {} },
      { detector: 'ATTRACTOR', description: '', score: 0.5, confidence: 0.6, signal: 'BULLISH', metadata: {} },
    ];
    const weights: Record<string, number> = {
      GRAVITON: 0.15, DARKMATTER: 0.1, ACCRETOR: 0.12, DECOHERENCE: 0.08,
      HAWKING: 0.1, PREDATOR: 0.1, CIPHER: 0.05, ENTANGLE: 0.12,
      WAVEFUNCTION: 0.08, ATTRACTOR: 0.1,
    };
    const result = calcBSCI(scores, weights);
    expect(result.bsci).toBeGreaterThanOrEqual(0);
    expect(result.bsci).toBeLessThanOrEqual(1);
    expect(result.topDetector).toBe('GRAVITON');
    expect(result.direction).toBe('BULLISH');
    expect(['GREEN', 'YELLOW', 'ORANGE', 'RED']).toContain(result.alertLevel);
  });

  test('все score = 0 → BSCI = 0, GREEN', () => {
    const scores: DetectorResult[] = [
      'GRAVITON', 'DARKMATTER', 'ACCRETOR', 'DECOHERENCE', 'HAWKING',
      'PREDATOR', 'CIPHER', 'ENTANGLE', 'WAVEFUNCTION', 'ATTRACTOR',
    ].map(name => ({
      detector: name, description: '', score: 0, confidence: 0, signal: 'NEUTRAL' as const, metadata: {},
    }));
    const result = calcBSCI(scores, {});
    expect(result.bsci).toBe(0);
    expect(result.alertLevel).toBe('GREEN');
    expect(result.direction).toBe('NEUTRAL');
  });

  test('все score = 1 → BSCI = 1, RED', () => {
    const scores: DetectorResult[] = [
      'GRAVITON', 'DARKMATTER', 'ACCRETOR', 'DECOHERENCE', 'HAWKING',
      'PREDATOR', 'CIPHER', 'ENTANGLE', 'WAVEFUNCTION', 'ATTRACTOR',
    ].map(name => ({
      detector: name, description: '', score: 1, confidence: 1, signal: 'BULLISH' as const, metadata: {},
    }));
    const result = calcBSCI(scores, { GRAVITON: 0.1, DARKMATTER: 0.1, ACCRETOR: 0.1, DECOHERENCE: 0.1, HAWKING: 0.1, PREDATOR: 0.1, CIPHER: 0.1, ENTANGLE: 0.1, WAVEFUNCTION: 0.1, ATTRACTOR: 0.1 });
    expect(result.bsci).toBe(1);
    expect(result.alertLevel).toBe('RED');
    expect(result.direction).toBe('BULLISH');
  });

  test('alert levels корректны', () => {
    const makeScores = (score: number) =>
      ['GRAVITON', 'DARKMATTER', 'ACCRETOR', 'DECOHERENCE', 'HAWKING',
       'PREDATOR', 'CIPHER', 'ENTANGLE', 'WAVEFUNCTION', 'ATTRACTOR',
      ].map(name => ({
        detector: name, description: '', score, confidence: score, signal: 'NEUTRAL' as const, metadata: {},
      }));

    expect(calcBSCI(makeScores(0.1), {}).alertLevel).toBe('GREEN');
    expect(calcBSCI(makeScores(0.35), {}).alertLevel).toBe('YELLOW');
    expect(calcBSCI(makeScores(0.55), {}).alertLevel).toBe('ORANGE');
    expect(calcBSCI(makeScores(0.8), {}).alertLevel).toBe('RED');
  });
});
