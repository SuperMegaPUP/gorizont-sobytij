// ─── SQUEEZE ALERT Detector Tests ────────────────────────────────────────

import { detectSqueezeAlert, SQUEEZE_DEFAULT_CONFIG } from '../squeeze-alert';

// Мок StateStore с in-memory реализацией для EMA
const createMockStore = () => {
  const emaState = new Map<string, { prev: number; smoothed: number }>();
  return {
    get: async (_key: string) => null,
    set: async (_key: string, _value: string, _ttl?: number) => { /* noop */ },
    calcEMA: async (key: string, value: number, alpha: number) => {
      const state = emaState.get(key) || { prev: value, smoothed: value };
      // EMA: smoothed = alpha * value + (1 - alpha) * prev
      const smoothed = alpha * value + (1 - alpha) * state.prev;
      const result = { smoothed, prev: state.smoothed, isColdStart: !emaState.has(key), delta: smoothed - state.smoothed };
      emaState.set(key, { prev: value, smoothed });
      return result;
    },
  };
};

describe('SQUEEZE Alert Detector (Q-8)', () => {
  const store = createMockStore();

  // ─── Базовые условия ───────────────────────────────────────────────────

  it('NE срабатывает при BSCI > 0.20 (X5 кейс)', async () => {
    const result = await detectSqueezeAlert(
      { ticker: 'X5', bsci: 0.27, vwapDeviation: 0.01, atrPct: 78, cancelPct: 0.99, timestamp: mainSessionTs() },
      store
    );

    expect(result.squeezeAlertActive).toBe(false);
    expect(result.conditions.bsciLow).toBe(false);
    expect(result.squeezePhase).toBe('NONE');
  });

  it('NE срабатывает при ATR > 85% (GAZP #3 кейс - экстремальная волатильность)', async () => {
    const result = await detectSqueezeAlert(
      { ticker: 'GAZP', bsci: 0.07, vwapDeviation: 0.01, atrPct: 93, cancelPct: 0.96, timestamp: mainSessionTs() },
      store
    );

    expect(result.squeezeAlertActive).toBe(false);
    expect(result.conditions.atrNormal).toBe(false);
    expect(result.squeezePhase).toBe('NONE');
  });

  it('NE срабатывает вне MAIN сессии (ночь)', async () => {
    const result = await detectSqueezeAlert(
      { ticker: 'SBER', bsci: 0.15, vwapDeviation: 0.01, atrPct: 60, cancelPct: 0.30, timestamp: nightTs() },
      store
    );

    expect(result.squeezeAlertActive).toBe(false);
    expect(result.conditions.sessionMain).toBe(false);
    expect(result.sessionPhase).toBe('CLOSED');
  });

  it('NE срабатывает при VWAP отклонении > 2%', async () => {
    const result = await detectSqueezeAlert(
      { ticker: 'LKOH', bsci: 0.15, vwapDeviation: 0.05, atrPct: 60, cancelPct: 0.30, timestamp: mainSessionTs() },
      store
    );

    expect(result.squeezeAlertActive).toBe(false);
    expect(result.conditions.vwapNear).toBe(false);
  });

  // ─── PRE_SQUEEZE ───────────────────────────────────────────────────────

  it('PRE_SQUEEZE когда базовые условия есть но Cancel% высокий (SBER кейс)', async () => {
    const result = await detectSqueezeAlert(
      { ticker: 'SBER', bsci: 0.15, vwapDeviation: 0.01, atrPct: 60, cancelPct: 0.98, timestamp: mainSessionTs() },
      store
    );

    expect(result.squeezePhase).toBe('PRE_SQUEEZE');
    expect(result.squeezeAlertActive).toBe(false);
    expect(result.conditions.bsciLow).toBe(true);
    expect(result.conditions.sessionMain).toBe(true);
    expect(result.conditions.cancelDrop).toBe(false);
  });

  it('PRE_SQUEEZE для LKOH (Cancel% 99%, BSCI 0.16 - стены на месте)', async () => {
    const result = await detectSqueezeAlert(
      { ticker: 'LKOH', bsci: 0.16, vwapDeviation: 0.01, atrPct: 55, cancelPct: 0.99, timestamp: mainSessionTs() },
      store
    );

    expect(result.squeezePhase).toBe('PRE_SQUEEZE');
    expect(result.squeezeAlertActive).toBe(false);
  });

  // ─── SQUEEZE ───────────────────────────────────────────────────────────

  it('SQUEEZE при Cancel% DROP (GAZP #2 эталонный кейс)', async () => {
    // Слот 2: Cancel% упал с 0.90 до 0.60 → EMA падает → SQUEEZE
    const result = await detectSqueezeAlert(
      { ticker: 'GAZP', bsci: 0.18, vwapDeviation: 0.01, atrPct: 60, cancelPct: 0.60, timestamp: mainSessionTs() },
      store
    );

    expect(result.squeezeAlertActive).toBe(true);
    expect(result.squeezePhase).toBe('SQUEEZE');
    expect(result.cancelRatioTrendingDown).toBe(true);
    expect(result.conditions.bsciLow).toBe(true);
  });

  it('SQUEEZE при Cancel% < 50% (cancelLow)', async () => {
    const result = await detectSqueezeAlert(
      { ticker: 'GAZP', bsci: 0.12, vwapDeviation: 0.01, atrPct: 55, cancelPct: 0.30, timestamp: mainSessionTs() },
      store
    );

    expect(result.squeezeAlertActive).toBe(true);
    expect(result.cancelRatioLow).toBe(true);
  });

  // ─── ATR экстремумы ───────────────────────────────────────────────────

  it('NE срабатывает при ATR > 85% (любой тикер)', async () => {
    const result = await detectSqueezeAlert(
      { ticker: 'TEST', bsci: 0.15, vwapDeviation: 0.01, atrPct: 90, cancelPct: 0.30, timestamp: mainSessionTs() },
      store
    );

    expect(result.squeezeAlertActive).toBe(false);
    expect(result.conditions.atrNormal).toBe(false);
  });

  // ─── Кластерный лимит ─────────────────────────────────────────────────

  it('не более 5 тикеров из 100 одновременно (нормальный сценарий)', async () => {
    let squeezeCount = 0;

    for (let i = 0; i < 100; i++) {
      const ticker = `TICK${i}`;
      // Только 3 тикера с низким Cancel% → SQUEEZE
      const cancelPct = i < 3 ? 0.30 : 0.95;

      const result = await detectSqueezeAlert(
        { ticker, bsci: 0.12, vwapDeviation: 0.01, atrPct: 55, cancelPct, timestamp: mainSessionTs() },
        store
      );

      if (result.squeezeAlertActive) squeezeCount++;
    }

    expect(squeezeCount).toBeLessThanOrEqual(5);
  });

  // ─── KV Timeout Fallback ──────────────────────────────────────────────

  it('KV timeout fallback использует сырой Cancel%', async () => {
    // Store который всегда timeout
    const timeoutStore = {
      get: async () => { throw new Error('KV_TIMEOUT'); },
      set: async () => { throw new Error('KV_TIMEOUT'); },
      calcEMA: async () => { throw new Error('KV_TIMEOUT'); },
    };

    const result = await detectSqueezeAlert(
      { ticker: 'TEST', bsci: 0.15, vwapDeviation: 0.01, atrPct: 60, cancelPct: 0.50, timestamp: mainSessionTs() },
      timeoutStore as any
    );

    // Fallback работает - используется сырой cancelPct
    expect(result.metadata.kvTimeoutFallback).toBe(true);
    // Результат вычислен (хоть и с fallback)
    expect(result.squeezePhase).toBeDefined();
  });

  // ─── Конфигурация ────────────────────────────────────────────────────

  it('использует SQUEEZE_DEFAULT_CONFIG', async () => {
    const result = await detectSqueezeAlert(
      { ticker: 'TEST', bsci: 0.15, vwapDeviation: 0.01, atrPct: 60, cancelPct: 0.30, timestamp: mainSessionTs() },
      store
    );

    expect(result.metadata.config).toEqual(SQUEEZE_DEFAULT_CONFIG);
  });
});

// ─── Вспомогательные функции ─────────────────────────────────────────────

function mainSessionTs(): number {
  // 01.05.2025 12:00 MSK = 09:00 UTC
  return new Date('2025-05-01T09:00:00Z').getTime();
}

function nightTs(): number {
  // 01.05.2025 02:00 MSK = 23:00 UTC предыдущего дня
  return new Date('2025-04-30T23:00:00Z').getTime();
}