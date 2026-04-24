// ─── Helpers Tests ──────────────────────────────────────────────────────
// fmtNum, fmtDelta, fmtImpact, toMoscowTime, getMoscowISOString, msToMoscowISO, nextId, isMarketOpen

import {
  fmtNum,
  fmtDelta,
  fmtImpact,
  toMoscowTime,
  getMoscowISOString,
  msToMoscowISO,
  nextId,
  isMarketOpen,
} from '@/lib/helpers';

describe('fmtNum', () => {
  test('1000 → формат с разделителем', () => {
    const result = fmtNum(1000);
    // ru-RU locale использует неразрывный пробел (U+00A0) или обычный пробел
    expect(result).toContain('1');
    expect(result).toContain('000');
    // Длина строки > 4 (цифры + разделитель)
    expect(result.length).toBeGreaterThan(4);
  });

  test('0 → "0"', () => {
    expect(fmtNum(0)).toBe('0');
  });

  test('отрицательные числа', () => {
    const result = fmtNum(-500);
    expect(result).toContain('500');
  });
});

describe('fmtDelta', () => {
  test('положительное число со знаком +', () => {
    const result = fmtDelta(100);
    expect(result).toContain('+');
    expect(result).toContain('100');
  });

  test('0 → "0"', () => {
    expect(fmtDelta(0)).toBe('0');
  });

  test('отрицательное без +', () => {
    const result = fmtDelta(-50);
    expect(result).toContain('50');
    expect(result).not.toContain('+');
  });
});

describe('fmtImpact', () => {
  test('положительное со знаком +', () => {
    expect(fmtImpact(0.5)).toBe('+0.50%');
  });

  test('0 → "+0.00%"', () => {
    expect(fmtImpact(0)).toBe('+0.00%');
  });

  test('отрицательное', () => {
    expect(fmtImpact(-1.25)).toBe('-1.25%');
  });
});

describe('toMoscowTime', () => {
  test('возвращает Date объект', () => {
    const result = toMoscowTime(new Date());
    expect(result).toBeInstanceOf(Date);
  });

  test('MSK = UTC+3', () => {
    const utc = new Date('2026-01-01T12:00:00Z');
    const msk = toMoscowTime(utc);
    expect(msk.getHours()).toBe(15); // 12 + 3 = 15
  });
});

describe('getMoscowISOString', () => {
  test('возвращает строку с +03:00', () => {
    const result = getMoscowISOString();
    expect(result).toContain('+03:00');
  });

  test('формат ISO', () => {
    const result = getMoscowISOString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+03:00$/);
  });
});

describe('msToMoscowISO', () => {
  test('конвертирует миллисекунды в ISO MSK', () => {
    const ms = new Date('2026-06-15T10:00:00Z').getTime();
    const result = msToMoscowISO(ms);
    expect(result).toContain('+03:00');
    expect(result).toContain('2026-06-15');
  });
});

describe('nextId', () => {
  test('возвращает строку с префиксом evt-', () => {
    const id = nextId();
    expect(id).toMatch(/^evt-\d+$/);
  });

  test('монотонно возрастающие ID', () => {
    const id1 = nextId();
    const id2 = nextId();
    const num1 = parseInt(id1.replace('evt-', ''));
    const num2 = parseInt(id2.replace('evt-', ''));
    expect(num2).toBeGreaterThan(num1);
  });
});

describe('isMarketOpen', () => {
  test('возвращает boolean', () => {
    const result = isMarketOpen();
    expect(typeof result).toBe('boolean');
  });
});
