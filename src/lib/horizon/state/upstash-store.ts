import { Redis } from '@upstash/redis';
import type { IStateStore } from './factory';

export class UpstashStateStore implements IStateStore {
  private client: Redis;
  private readonly defaultTTL = 86400; // seconds

  constructor(url: string, token: string) {
    this.client = new Redis({ url, token });
  }

  async get(key: string): Promise<number | null> {
    try {
      const value = await this.client.get(key);
      if (value === null) return null;
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
      }
      if (typeof value === 'number') return value;
      return null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: number, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ? Math.floor(ttlMs / 1000) : this.defaultTTL;
    await this.client.set(key, String(value), { EX: ttl });
  }

  async getRolling(key: string, window: number): Promise<number[]> {
    try {
      const result = await this.client.lrange(key, 0, window - 1);
      if (!Array.isArray(result)) return [];
      return result.map(v => {
        if (typeof v === 'string') return parseFloat(v);
        if (typeof v === 'number') return v;
        return NaN;
      }).filter(v => !isNaN(v));
    } catch {
      return [];
    }
  }

  async pushRolling(key: string, value: number, window: number): Promise<void> {
    const luaScript = `
      redis.call('RPUSH', KEYS[1], ARGV[1])
      redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[2]) - 1)
      redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
    `;
    try {
      await this.client.eval(luaScript, [key], [value, window, this.defaultTTL]);
    } catch (error) {
      console.error('Upstash pushRolling error:', error);
    }
  }

  async calcEMA(key: string, currentValue: number, alpha: number): Promise<{
    smoothed: number;
    prev: number;
    delta: number;
    isColdStart: boolean;
  }> {
    const luaScript = `
      local prev = redis.call('GET', KEYS[1])
      local alpha = tonumber(ARGV[1])
      local current = tonumber(ARGV[2])
      local ttl = tonumber(ARGV[3])
      
      if prev == false then
        redis.call('SET', KEYS[1], tostring(current), 'EX', ttl)
        return {tostring(current), tostring(current), '1'}
      end
      
      local prevNum = tonumber(prev)
      local smoothed = alpha * current + (1 - alpha) * prevNum
      redis.call('SET', KEYS[1], tostring(smoothed), 'EX', ttl)
      return {tostring(smoothed), tostring(prevNum), '0'}
    `;

    try {
      const result = await this.client.eval(luaScript, [key], [alpha, currentValue, this.defaultTTL]);
      if (!Array.isArray(result) || result.length < 3) {
        return { smoothed: currentValue, prev: currentValue, delta: 0, isColdStart: true };
      }
      return {
        smoothed: parseFloat(result[0]),
        prev: parseFloat(result[1]),
        delta: Math.abs(parseFloat(result[0]) - currentValue),
        isColdStart: result[2] === '1',
      };
    } catch (error) {
      console.error('Upstash calcEMA error:', error);
      return { smoothed: currentValue, prev: currentValue, delta: 0, isColdStart: true };
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG' || result === 'OK';
    } catch {
      return false;
    }
  }
}