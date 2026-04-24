// ─── P0: API контракты — проверка структуры ответов ───────────────────────
// Гарантируем что API возвращает ожидаемую структуру данных

import {
  detectBurstsMultiLevel,
  makeBuyTrades,
  DETECT_LEVELS,
  PATTERN_NAMES,
  type BurstResult,
} from '@/lib/detect-engine';

// ─── Контракт: POST /api/detect ───────────────────────────────────────────

describe('Контракт: /api/detect response', () => {
  test('BurstResult содержит все обязательные поля', () => {
    const trades = makeBuyTrades(10, { intervalSec: 0.1 });
    const bursts = detectBurstsMultiLevel(trades, 'SBER', 'figi123', 1000000, 0, 'api');

    if (bursts.length > 0) {
      const b = bursts[0];
      const requiredFields: (keyof BurstResult)[] = [
        'tsStart', 'tsEnd', 'ticker', 'figi', 'direction',
        'totalLots', 'buyLots', 'sellLots', 'delta', 'wap',
        'duration', 'tradeCount', 'strategy', 'strategyRu',
        'confidence', 'lotsPctDaily', 'valuePctDaily',
        'priceImpactPct', 'spreadImpact', 'source',
        'intervalSec', 'level', 'levelRu',
      ];

      for (const field of requiredFields) {
        expect(b).toHaveProperty(field);
      }
    }
  });

  test('direction ∈ {BUY, SELL, MIXED}', () => {
    const trades = makeBuyTrades(10, { intervalSec: 0.1 });
    const bursts = detectBurstsMultiLevel(trades, 'SBER', '', 0, 0, 'api');

    for (const b of bursts) {
      expect(['BUY', 'SELL', 'MIXED']).toContain(b.direction);
    }
  });

  test('confidence ∈ [0, 1]', () => {
    const trades = makeBuyTrades(10, { intervalSec: 0.1 });
    const bursts = detectBurstsMultiLevel(trades, 'SBER', '', 0, 0, 'api');

    for (const b of bursts) {
      expect(b.confidence).toBeGreaterThanOrEqual(0);
      expect(b.confidence).toBeLessThanOrEqual(1);
    }
  });

  test('level ∈ {hft, algo, structural}', () => {
    const trades = makeBuyTrades(10, { intervalSec: 0.1 });
    const bursts = detectBurstsMultiLevel(trades, 'SBER', '', 0, 0, 'api');

    for (const b of bursts) {
      expect(['hft', 'algo', 'structural']).toContain(b.level);
    }
  });

  test('strategy — известный паттерн или unknown', () => {
    const trades = makeBuyTrades(10, { intervalSec: 0.1 });
    const bursts = detectBurstsMultiLevel(trades, 'SBER', '', 0, 0, 'api');

    for (const b of bursts) {
      expect(PATTERN_NAMES).toHaveProperty(b.strategy);
    }
  });

  test('ticker передаётся корректно', () => {
    const trades = makeBuyTrades(10, { intervalSec: 0.1 });
    const bursts = detectBurstsMultiLevel(trades, 'GAZP', 'figi456', 0, 0, 'api');

    for (const b of bursts) {
      expect(b.ticker).toBe('GAZP');
      expect(b.figi).toBe('figi456');
    }
  });

  test('delta = buyLots - sellLots', () => {
    const trades = makeBuyTrades(10, { intervalSec: 0.1, lots: 100 });
    const bursts = detectBurstsMultiLevel(trades, 'SBER', '', 0, 0, 'api');

    for (const b of bursts) {
      expect(b.delta).toBe(b.buyLots - b.sellLots);
    }
  });

  test('totalLots = buyLots + sellLots', () => {
    const trades = makeBuyTrades(10, { intervalSec: 0.1, lots: 100 });
    const bursts = detectBurstsMultiLevel(trades, 'SBER', '', 0, 0, 'api');

    for (const b of bursts) {
      expect(b.totalLots).toBe(b.buyLots + b.sellLots);
    }
  });
});

// ─── Контракт: GET /api/detect ────────────────────────────────────────────

describe('Контракт: GET /api/detect (metadata)', () => {
  test('DETECT_LEVELS корректны', () => {
    expect(DETECT_LEVELS).toHaveLength(3);
    for (const l of DETECT_LEVELS) {
      expect(l).toHaveProperty('name');
      expect(l).toHaveProperty('labelRu');
      expect(l).toHaveProperty('windowSec');
      expect(l).toHaveProperty('minTrades');
      expect(l).toHaveProperty('maxAvgInterval');
    }
  });

  test('PATTERN_NAMES содержит все 12+1 паттернов', () => {
    const expectedIds = [
      'periodic', 'fixed_volume', 'layered',
      'iceberg', 'scalper', 'momentum', 'ping_pong',
      'market_maker', 'aggressive', 'slow_grinder', 'sweeper',
      'absorber', 'unknown',
    ];
    expect(Object.keys(PATTERN_NAMES).sort()).toEqual(expectedIds.sort());
  });
});
