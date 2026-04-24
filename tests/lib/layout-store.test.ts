// ─── Layout Store Tests ──────────────────────────────────────────────────
// LAYOUT_VERSION=16, 17 фреймов, DEFAULT_ZONE

import {
  LAYOUT_VERSION,
  ALL_FRAME_KEYS,
  DEFAULT_ZONE,
} from '@/lib/layout-store';

describe('Layout Store', () => {
  test('LAYOUT_VERSION = 16', () => {
    expect(LAYOUT_VERSION).toBe(16);
  });

  test('ALL_FRAME_KEYS содержит 17 фреймов', () => {
    expect(ALL_FRAME_KEYS).toHaveLength(17);
  });

  test('ALL_FRAME_KEYS содержит обязательные фреймы', () => {
    const required = [
      'instruments', 'tickers', 'duration', 'orderbook', 'dynamics',
      'signals', 'institutional', 'anomalies', 'fearGreed', 'hourlyActivity',
      'smartMoney', 'oiDynamics', 'futuresOI', 'top5', 'strategies',
      'robotHistory', 'news',
    ];
    for (const key of required) {
      expect(ALL_FRAME_KEYS).toContain(key);
    }
  });

  test('DEFAULT_ZONE: collapsed=true, width=280', () => {
    expect(DEFAULT_ZONE.collapsed).toBe(true);
    expect(DEFAULT_ZONE.width).toBe(280);
  });

  test('DEFAULT_ZONE: frameKeys пустой массив', () => {
    expect(DEFAULT_ZONE.frameKeys).toEqual([]);
  });

  test('DEFAULT_ZONE: frameHeights пустой объект', () => {
    expect(DEFAULT_ZONE.frameHeights).toEqual({});
  });
});
