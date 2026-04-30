export interface IStateStore {
  get(key: string): Promise<number | null>;
  set(key: string, value: number, ttlMs?: number): Promise<void>;
  getRolling(key: string, window: number): Promise<number[]>;
  pushRolling(key: string, value: number, window: number): Promise<void>;
  calcEMA(key: string, currentValue: number, alpha: number): Promise<{
    smoothed: number;
    prev: number;
    delta: number;
    isColdStart: boolean;
  }>;
  ping(): Promise<boolean>;
}

class MemoryStateStore implements IStateStore {
  private store = new Map<string, { value: number; expires?: number }>();
  private rolling = new Map<string, number[]>();

  async get(key: string): Promise<number | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expires && item.expires < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: number, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expires: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }

  async getRolling(key: string, window: number): Promise<number[]> {
    return this.rolling.get(key) || [];
  }

  async pushRolling(key: string, value: number, window: number): Promise<void> {
    const arr = this.rolling.get(key) || [];
    arr.push(value);
    if (arr.length > window) arr.shift();
    this.rolling.set(key, arr);
  }

  async calcEMA(key: string, currentValue: number, alpha: number): Promise<{
    smoothed: number;
    prev: number;
    delta: number;
    isColdStart: boolean;
  }> {
    const prev = await this.get(key);
    if (prev === null) {
      await this.set(key, currentValue, 86400000);
      return { smoothed: currentValue, prev: currentValue, delta: 0, isColdStart: true };
    }
    const smoothed = alpha * currentValue + (1 - alpha) * prev;
    await this.set(key, smoothed, 86400000);
    return {
      smoothed,
      prev,
      delta: Math.abs(smoothed - currentValue),
      isColdStart: false,
    };
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

export function createStateStore(): IStateStore {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && redisUrl.includes('redis://')) {
    // TODO: RedisStateStore implementation
    console.warn('⚠️ Redis not implemented yet, using MemoryStateStore fallback');
  }
  return new MemoryStateStore();
}