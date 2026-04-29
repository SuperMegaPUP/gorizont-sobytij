// Батчинг метрик в один KV-ключ на тикер (200 ops/скан вместо 600)
import { kv } from '@vercel/kv';

const BASELINE_PREFIX = 'horizon:baseline:';
const WINDOW_SIZE = 20; // ~100 мин при 5-мин сканах
const TTL_SEC = 86400;  // 24 часа
const EPS = 1e-6;

export async function pushBaseline(ticker: string, metrics: Record<string, number>): Promise<void> {
  try {
    const key = `${BASELINE_PREFIX}${ticker}`;
    const raw = (await kv.get<Record<string, number[]>>(key)) || {};
    for (const [metric, value] of Object.entries(metrics)) {
      if (!raw[metric] || !Array.isArray(raw[metric])) {
        raw[metric] = [];
      }
      raw[metric].push(value);
      if (raw[metric].length > WINDOW_SIZE) raw[metric].shift();
    }
    await kv.set(key, raw, { ex: TTL_SEC });
  } catch {
    // fire-and-forget: ошибка KV не должна ломать скан
  }
}

export async function getZFactors(
  ticker: string,
  metrics: Record<string, number>
): Promise<Record<string, { zFactor: number; n: number; mu: number; sigma: number }>> {
  try {
    const key = `${BASELINE_PREFIX}${ticker}`;
    const raw = (await kv.get<Record<string, number[]>>(key)) || {};
    const result: Record<string, { zFactor: number; n: number; mu: number; sigma: number }> = {};

    for (const [metric, value] of Object.entries(metrics)) {
      const history = (raw[metric] && Array.isArray(raw[metric])) ? raw[metric] : [];
      const n = history.length;
      if (n < 5) {
        result[metric] = { zFactor: 1.0, n, mu: 0, sigma: 0 };
        continue;
      }
      const mu = history.reduce((a, b) => a + b, 0) / n;
      const variance = history.reduce((a, b) => a + (b - mu) ** 2, 0) / n;
      const sigma = Math.max(Math.sqrt(variance), EPS);
      const z = (value - mu) / sigma;

      // PoC-safe range: ±15% вместо ±40%. Градиент сохранён, калибровка не ломается.
      const zFactor = Math.max(0.85, Math.min(1.15, 1 + z * 0.075));
      result[metric] = { zFactor, n, mu, sigma };
    }
    return result;
  } catch {
    return Object.fromEntries(
      Object.keys(metrics).map(m => [m, { zFactor: 1.0, n: 0, mu: 0, sigma: 0 }])
    );
  }
}
