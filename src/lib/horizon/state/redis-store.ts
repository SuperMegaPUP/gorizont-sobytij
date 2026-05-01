import IORedis from 'ioredis';
import type { IStateStore } from './factory';

export class RedisStateStore implements IStateStore {
  private client: IORedis;
  private readonly defaultTTL = 86400000; // 24h

  constructor(url: string) {
    this.client = new IORedis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      connectTimeout: 10000,
    });
  }

  async connect(): Promise<void> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
  }

  async get(key: string): Promise<number | null> {
    try {
      const value = await this.client.get(key);
      if (value === null) return null;
      const parsed = parseFloat(value);
      return isNaN(parsed) ? null : parsed;
    } catch {
      return null;
    }
  }

  async set(key: string, value: number, ttlMs?: number): Promise<void> {
    const ttl = ttlMs || this.defaultTTL;
    await this.client.set(key, String(value), 'EX', Math.floor(ttl / 1000));
  }

  async getRolling(key: string, window: number): Promise<number[]> {
    try {
      const result = await this.client.lrange(key, 0, window - 1);
      return result.map(v => parseFloat(v)).filter(v => !isNaN(v));
    } catch {
      return [];
    }
  }

  async pushRolling(key: string, value: number, window: number): Promise<void> {
    const ttl = Math.ceil(this.defaultTTL / 1000);
    const luaScript = `
      redis.call('RPUSH', KEYS[1], ARGV[1])
      redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[2]) - 1)
      redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
    `;
    await this.client.eval(luaScript, 1, key, String(value), window, ttl);
  }

  async calcEMA(key: string, currentValue: number, alpha: number): Promise<{
    smoothed: number;
    prev: number;
    delta: number;
    isColdStart: boolean;
  }> {
    const ttl = Math.ceil(this.defaultTTL / 1000);
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
      const result = await this.client.eval(luaScript, 1, key, alpha, currentValue, ttl);
      return {
        smoothed: parseFloat(result[0]),
        prev: parseFloat(result[1]),
        delta: Math.abs(parseFloat(result[0]) - currentValue),
        isColdStart: result[2] === '1',
      };
    } catch {
      return {
        smoothed: currentValue,
        prev: currentValue,
        delta: 0,
        isColdStart: true,
      };
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}