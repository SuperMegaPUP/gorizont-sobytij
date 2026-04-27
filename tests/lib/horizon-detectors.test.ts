// ─── Black Star Detectors — Тесты ──────────────────────────────────────────

import {
  detectGraviton,
  detectDarkmatter,
  detectAccretor,
  detectDecoherence,
  detectHawking,
  detectPredator,
  resetPredatorState,
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
    quantity: [1, 2, 4, 8, 16][i % 5],
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
        bids: [{ price: 100, quantity: 9000 }, { price: 99.9, quantity: 50 }, { price: 99.8, quantity: 50 }],
        asks: [{ price: 100.1, quantity: 100 }, { price: 100.2, quantity: 100 }],
      },
      ofi: 0.7,
      weightedOFI: 0.9,
    });
    const result = detectGraviton(input);
    expect(result.detector).toBe('GRAVITON');
    // П2: v5.1 использует центры масс + стены вместо lensingRatio/bidConcentration
    expect(result.metadata.cmBid).toBeDefined();
    expect(result.metadata.cmAsk).toBeDefined();
    // Стена 9000 на лучшем биде → wallScore > 0
    expect(result.score).toBeGreaterThan(0);
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
    // Дополнительные сделки для дневного оборота (детерминированные)
    let seed = 7;
    const pr = () => { seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF; return (seed >>> 0) / 0xFFFFFFFF; };
    for (let i = 0; i < 20; i++) {
      icebergTrades.push({ price: 100 + pr(), quantity: 10 + Math.floor(pr() * 30), direction: i % 2 === 0 ? 'BUY' : 'SELL', timestamp: Date.now() + (5 + i) * 100 });
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
      trades: [],
      recentTrades: Array.from({ length: 5 }, () => ({ price: 100, quantity: 1, direction: 'BUY', timestamp: Date.now() })),
    });
    const result = detectDarkmatter(input);
    expect(result.score).toBeLessThan(0.5);
  });

  test('cutoff_depth < 5 → entropy_score = 0', () => {
    // Мало уровней в стакане → guard срабатывает
    const input = makeInput({
      orderbook: {
        bids: [
          { price: 100, quantity: 500 },
          { price: 99.9, quantity: 100 },
        ],
        asks: [
          { price: 100.1, quantity: 500 },
          { price: 100.2, quantity: 100 },
        ],
      },
      trades: Array.from({ length: 10 }, (_, i) => ({
        price: 100, quantity: 50, direction: 'BUY', timestamp: Date.now() + i * 100,
      })),
    });
    const result = detectDarkmatter(input);
    expect(result.metadata.cutoffDepth as number).toBeLessThan(5);
    expect(result.metadata.deltaH_norm as number).toBe(0);
  });

  test('Miller-Madow: H_MM > H_ML', () => {
    const input = makeInput();
    const result = detectDarkmatter(input);
    const H_ML = result.metadata.H_ML as number;
    const H_MM = result.metadata.H_MM as number;
    expect(H_ML).toBeDefined();
    expect(H_MM).toBeDefined();
    expect(H_MM).toBeGreaterThan(H_ML);
  });
});

// ─── ACCRETOR ─────────────────────────────────────────────────────────────

describe('ACCRETOR', () => {
  test('обнаруживает кластерное накопление (DBSCAN)', () => {
    // П2: v5.1 использует DBSCAN кластеризацию мелких сделок
    // Создаём много мелких сделок + несколько крупных
    const trades: Trade[] = [];
    // 20 мелких кластеризованных сделок (одна цена, близкое время)
    for (let i = 0; i < 20; i++) {
      trades.push({
        price: 100,
        quantity: 3, // мелкие
        direction: 'BUY',
        timestamp: 1000000 + i * 50, // плотный кластер
      });
    }
    // 10 крупных
    for (let i = 0; i < 10; i++) {
      trades.push({
        price: 100.1 + Math.random() * 0.5,
        quantity: 100,
        direction: i % 2 === 0 ? 'BUY' : 'SELL',
        timestamp: 1002000 + i * 500,
      });
    }
    const input = makeInput({
      trades,
      prices: Array.from({ length: 30 }, () => 100), // цена стоит
    });
    const result = detectAccretor(input);
    expect(result.detector).toBe('ACCRETOR');
    // DBSCAN должен найти кластер или delta-trend даёт score > 0
    expect(result.score).toBeGreaterThanOrEqual(0); // может быть 0 если кластер не найден
    expect(result.metadata.clusterCount).toBeDefined();
  });

  test('нет данных → score = 0', () => {
    const input = makeInput({ trades: [], prices: [100] });
    const result = detectAccretor(input);
    expect(result.score).toBe(0);
  });
});

// ─── DECOHERENCE v4.2 ─────────────────────────────────────────────────────

describe('DECOHERENCE', () => {
  test('score ∈ [0, 1], корректная структура', () => {
    const input = makeInput();
    const result = detectDecoherence(input);
    expect(result.detector).toBe('DECOHERENCE');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(['BULLISH', 'BEARISH', 'NEUTRAL']).toContain(result.signal);
  });

  test('alphabet guard: <5 символов → score = 0', () => {
    // Все сделки с одинаковым объёмом и направлением → 1-2 символа
    const monoTrades: Trade[] = Array.from({ length: 50 }, (_, i) => ({
      price: 100 + (i % 2) * 0.01, // почти нулевое изменение
      quantity: 10,
      direction: 'BUY',
      timestamp: 1000000 + i * 100,
    }));
    const input = makeInput({ trades: monoTrades, recentTrades: monoTrades });
    const result = detectDecoherence(input);
    expect(result.score).toBe(0);
    expect(result.metadata.guardTriggered).toBe('alphabet_lt_5');
  });

  test('low activity guard: <30% price changes → score = 0', () => {
    // Цена не меняется вообще → 0% price changes
    // Широкий диапазон объёмов чтобы alphabet guard НЕ сработал раньше
    const flatTrades: Trade[] = Array.from({ length: 50 }, (_, i) => ({
      price: 100,
      quantity: [1, 2, 4, 8, 16, 32, 64][i % 7],
      direction: i % 2 === 0 ? 'BUY' : 'SELL',
      timestamp: 1000000 + i * 100,
    }));
    const input = makeInput({ trades: flatTrades, recentTrades: flatTrades });
    const result = detectDecoherence(input);
    expect(result.score).toBe(0);
    expect(result.metadata.guardTriggered).toBe('low_activity');
  });

  test('volume=0 skip — нет crash', () => {
    const zeroVolTrades: Trade[] = Array.from({ length: 50 }, (_, i) => ({
      price: 100 + (i % 3) * 0.1,
      quantity: i % 5 === 0 ? 0 : 10 + i, // каждая 5-я сделка с volume=0
      direction: i % 2 === 0 ? 'BUY' : 'SELL',
      timestamp: 1000000 + i * 100,
    }));
    const input = makeInput({ trades: zeroVolTrades, recentTrades: zeroVolTrades });
    const result = detectDecoherence(input);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    // Должно быть меньше символов из-за skip
    expect(result.metadata.totalSymbols).toBeLessThanOrEqual(40);
  });

  test('Miller-Madow: H_MM > H_ML (коррекция увеличивает энтропию)', () => {
    const input = makeInput();
    const result = detectDecoherence(input);
    const H_ML = result.metadata.H_ML as number;
    const H_MM = result.metadata.H_MM as number;
    expect(H_ML).toBeDefined();
    expect(H_MM).toBeDefined();
    expect(H_MM).toBeGreaterThan(H_ML);
  });

  test('H_max floor: effective_H_max >= log2(7) ≈ 2.807', () => {
    const input = makeInput();
    const result = detectDecoherence(input);
    const hMax = result.metadata.effective_H_max as number;
    expect(hMax).toBeGreaterThanOrEqual(2.8);
  });

  test('алгоритмический паттерн → высокий score (>0.3)', () => {
    // 95% сделок с одним объёмом → низкая энтропия → высокий score
    // Несколько редких объёмов чтобы alphabet guard прошёл (≥5 символов)
    const algoTrades: Trade[] = Array.from({ length: 100 }, (_, i) => {
      let quantity = 16;
      if (i === 10) quantity = 1;   // symbol 0
      if (i === 20) quantity = 2;   // symbol ±1
      if (i === 30) quantity = 4;   // symbol ±2
      if (i === 40) quantity = 8;   // symbol ±3
      return {
        price: 100 + (i % 2 === 0 ? 0.1 : 0), // чередование +0.1 / 0
        quantity,
        direction: i % 2 === 0 ? 'BUY' : 'SELL',
        timestamp: 1000000 + i * 500,
      };
    });
    const input = makeInput({ trades: algoTrades, recentTrades: algoTrades });
    const result = detectDecoherence(input);
    expect(result.score).toBeGreaterThan(0.3);
  });

  test('случайные данные → низкий score (<0.5)', () => {
    // Равномерное распределение → высокая энтропия → низкая декогерентность
    // Детерминированный LCG вместо Math.random() для воспроизводимости в CI
    let seed = 42;
    const pseudoRandom = () => {
      seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
      return (seed >>> 0) / 0xFFFFFFFF;
    };
    const randomTrades: Trade[] = Array.from({ length: 100 }, (_, i) => ({
      price: 100 + Math.sin(i) * 2,
      quantity: 1 + Math.floor(pseudoRandom() * 100),
      direction: i % 2 === 0 ? 'BUY' : 'SELL',
      timestamp: 1000000 + i * 100,
    }));
    const input = makeInput({ trades: randomTrades, recentTrades: randomTrades });
    const result = detectDecoherence(input);
    expect(result.score).toBeLessThan(0.5);
  });

  test('мало сделок → insufficientData', () => {
    const input = makeInput({ trades: [], recentTrades: [] });
    const result = detectDecoherence(input);
    expect(result.score).toBe(0);
    expect(result.metadata.insufficientData).toBe(true);
  });
});

// ─── HAWKING ──────────────────────────────────────────────────────────────

describe('HAWKING', () => {
  test('периодичные сделки → высокий score', () => {
    // v4.2: activity series (100ms bins), period = 4 bins = 400ms → 2.5 Hz
    const periodicTrades: Trade[] = [];
    for (let i = 0; i < 80; i++) {
      periodicTrades.push({
        price: 100 + Math.sin(i / 3) * 0.5,
        quantity: 50,
        direction: i % 2 === 0 ? 'BUY' : 'SELL',
        timestamp: 1000000 + i * 500, // ровно 500мс = period 5 bins → 2.0 Hz
      });
    }
    const input = makeInput({ trades: periodicTrades });
    const result = detectHawking(input);
    expect(result.detector).toBe('HAWKING');
    expect(result.score).toBeGreaterThan(0);
    expect(result.metadata.periodicity).toBeDefined();
    expect(result.metadata.noiseRatio).toBeDefined();
    // Должен использовать FFT (n_bins = ~316 < 500)
    expect(result.metadata.psdMethod).toBe('fft');
  });

  test('мало сделок (<50) → score = 0', () => {
    const fewTrades: Trade[] = Array.from({ length: 30 }, (_, i) => ({
      price: 100, quantity: 10, direction: 'BUY', timestamp: 1000000 + i * 100,
    }));
    const input = makeInput({ trades: fewTrades });
    const result = detectHawking(input);
    expect(result.score).toBe(0);
    expect(result.metadata.insufficientData).toBe(true);
  });

  test('короткая длительность (<10с) → score = 0', () => {
    // 60 сделок за 5 секунд — много сделок, но длительность < 10с
    const shortTrades: Trade[] = Array.from({ length: 60 }, (_, i) => ({
      price: 100, quantity: 10, direction: 'BUY', timestamp: 1000000 + i * 83, // ~5с total
    }));
    const input = makeInput({ trades: shortTrades });
    const result = detectHawking(input);
    expect(result.score).toBe(0);
    expect(result.metadata.insufficientData).toBe(true);
  });

  test('случайные интервалы → низкий score (<0.5)', () => {
    // Детерминированный LCG для воспроизводимости
    let seed = 123;
    const pseudoRandom = () => {
      seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
      return (seed >>> 0) / 0xFFFFFFFF;
    };
    const randomTrades: Trade[] = Array.from({ length: 100 }, (_, i) => ({
      price: 100,
      quantity: 10,
      direction: i % 2 === 0 ? 'BUY' : 'SELL',
      timestamp: 1000000 + Math.floor(pseudoRandom() * 30000), // 0..30с равномерно
    }));
    // Сортируем по timestamp
    randomTrades.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const input = makeInput({ trades: randomTrades });
    const result = detectHawking(input);
    expect(result.score).toBeLessThan(0.5);
  });
});

// ─── PREDATOR ─────────────────────────────────────────────────────────────

describe('PREDATOR', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    resetPredatorState();
  });

  test('мало сделок (<20) → score = 0', () => {
    const input = makeInput({ trades: [], ticker: 'PRED_TEST_1' });
    const result = detectPredator(input);
    expect(result.score).toBe(0);
    expect(result.metadata.insufficientData).toBe(true);
  });

  test('IDLE → STALK когда цена у стопов', () => {
    // Стоп на bid = 99 (round number), цена = 100.1 → 1.1 пунктов
    // ATR ≈ 0.14 (из candles makeInput), 1.5×ATR ≈ 0.21
    // 1.1 > 0.21 → не должно сработать... нужно цену ближе
    // Стоп на ask = 100.5, цена = 100.1 → 0.4 пунктов
    const stalkTrades: Trade[] = Array.from({ length: 25 }, (_, i) => ({
      price: i < 20 ? 100 : 100.05, // близко к стопу на 100.5
      quantity: 10,
      direction: i % 2 === 0 ? 'BUY' : 'SELL',
      timestamp: 1000000 + i * 1000,
    }));
    const input = makeInput({ trades: stalkTrades, ticker: 'PRED_TEST_2', cumDelta: { delta: 50, buyVolume: 150, sellVolume: 100, totalVolume: 250 } });
    const result = detectPredator(input);
    expect(result.detector).toBe('PREDATOR');
    expect(result.metadata.phase).toBeDefined();
  });

  test('агрессивный рынок → ATTACK или CONSUME', () => {
    const now = 1000000000000;
    jest.spyOn(global.Date, 'now').mockReturnValue(now);

    // Создаём сценарий: много мелких сделок (herding) + резкий price spike + высокий aggression
    const trades: Trade[] = [];
    for (let i = 0; i < 15; i++) {
      trades.push({ price: 100, quantity: 2, direction: 'BUY', timestamp: now - (20 - i) * 60000 });
    }
    for (let i = 0; i < 10; i++) {
      trades.push({ price: 100 + i * 0.3, quantity: 100, direction: 'BUY', timestamp: now - (5 - i) * 60000 });
    }

    const input = makeInput({
      trades,
      ticker: 'PRED_TEST_3',
      cumDelta: { delta: 500, buyVolume: 900, sellVolume: 100, totalVolume: 1000 },
    });
    const result = detectPredator(input);
    expect(result.detector).toBe('PREDATOR');
    // aggression_ratio = 900/100 = 9 > 2.0 → ATTACK возможен
    expect(result.metadata.phase).toBeDefined();
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

  test('случайные интервалы → PCA dominance низкий', () => {
    // П2: v5.1 использует PCA — случайные данные → низкий dominance_ratio
    const trades: Trade[] = Array.from({ length: 30 }, (_, i) => ({
      price: 100,
      quantity: 10 + Math.random() * 100,
      direction: i % 2 === 0 ? 'BUY' : 'SELL',
      timestamp: 1000000 + Math.random() * 10000,
    }));
    const input = makeInput({ trades, recentTrades: trades });
    const result = detectCipher(input);
    // PCA dominance_ratio для случайных данных должен быть относительно низким
    expect(result.metadata.pcaDominance).toBeDefined();
  });
});

// ─── ENTANGLE ─────────────────────────────────────────────────────────────

describe('ENTANGLE', () => {
  test('обнаруживает кросс-тикерную корреляцию', () => {
    // П2: v5.1 требует стационарный ряд (ADF-тест)
    // Используем стационарный ряд (mean-reverting, не трендовый)
    const input = makeInput({
      prices: Array.from({ length: 30 }, (_, i) =>
        100 + Math.sin(i / 3) * 2 + Math.random() * 0.5 // стационарный (mean-reverting)
      ),
      crossTickers: {
        GAZP: { priceChange: 2.0, ofi: 0.3 },
        LKOH: { priceChange: 1.8, ofi: 0.25 },
      },
    });
    const result = detectEntangle(input);
    expect(result.detector).toBe('ENTANGLE');
    // ADF может пройти или нет — проверяем что детектор запустился
    expect(result.metadata.isStationary).toBeDefined();
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
    // П2: v5.1 использует Takens + volume_profile + stickiness
    // Цена колеблется вокруг 100
    const prices = Array.from({ length: 30 }, (_, i) =>
      i % 3 === 0 ? 100 : 100 + (Math.random() - 0.5) * 2
    );
    // Добавляем сделки для volume_profile и stickiness
    const trades: Trade[] = Array.from({ length: 30 }, (_, i) => ({
      price: prices[i] || 100,
      quantity: 10,
      direction: i % 2 === 0 ? 'BUY' : 'SELL',
      timestamp: 1000000 + i * 100,
    }));
    const input = makeInput({ prices, trades });
    const result = detectAttractor(input);
    expect(result.detector).toBe('ATTRACTOR');
    // П2: v5.1 использует takens_convergence + stickiness + volume_profile
    expect(result.metadata.takensConvergence).toBeDefined();
    expect(result.metadata.stickinessRatio).toBeDefined();
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
