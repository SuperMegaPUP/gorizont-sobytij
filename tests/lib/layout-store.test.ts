// ─── Layout Store Tests ──────────────────────────────────────────────────
// LAYOUT_VERSION=19, 22 фрейма, DEFAULT_ZONE, DashboardTab

import {
  LAYOUT_VERSION,
  ALL_FRAME_KEYS,
  DEFAULT_ZONE,
  HORIZON_FRAME_KEYS,
  MAIN_FRAME_KEYS,
  getFrameKeysForTab,
} from '@/lib/layout-store';

describe('Layout Store', () => {
  test('LAYOUT_VERSION = 19', () => {
    expect(LAYOUT_VERSION).toBe(19);
  });

  test('ALL_FRAME_KEYS содержит 22 фрейма', () => {
    expect(ALL_FRAME_KEYS).toHaveLength(22);
  });

  test('ALL_FRAME_KEYS содержит обязательные фреймы', () => {
    const required = [
      'instruments', 'tickers', 'duration', 'orderbook', 'dynamics',
      'signals', 'institutional', 'anomalies', 'fearGreed', 'hourlyActivity',
      'smartMoney', 'oiDynamics', 'futuresOI', 'top5', 'strategies',
      'robotHistory', 'news', 'horizonScanner', 'horizonRadar',
      'horizonObserver', 'horizonHeatmap', 'horizonSignals',
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

  test('HORIZON_FRAME_KEYS содержит 5 horizon фреймов', () => {
    expect(HORIZON_FRAME_KEYS).toHaveLength(5);
    expect(HORIZON_FRAME_KEYS).toContain('horizonScanner');
    expect(HORIZON_FRAME_KEYS).toContain('horizonRadar');
    expect(HORIZON_FRAME_KEYS).toContain('horizonObserver');
    expect(HORIZON_FRAME_KEYS).toContain('horizonHeatmap');
    expect(HORIZON_FRAME_KEYS).toContain('horizonSignals');
  });

  test('MAIN_FRAME_KEYS содержит 17 основных фреймов', () => {
    expect(MAIN_FRAME_KEYS).toHaveLength(17);
    expect(MAIN_FRAME_KEYS).not.toContain('horizonScanner');
  });

  test('getFrameKeysForTab возвращает правильные ключи', () => {
    expect(getFrameKeysForTab('main')).toEqual(MAIN_FRAME_KEYS);
    expect(getFrameKeysForTab('horizon')).toEqual(HORIZON_FRAME_KEYS);
  });
});
