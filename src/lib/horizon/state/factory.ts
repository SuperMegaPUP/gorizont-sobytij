import { RedisStateStore } from './redis-store';
import { UpstashStateStore } from './upstash-store';
import { MemoryStateStore } from './memory-store';

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

export function createStateStore(): IStateStore {
  const redisUrl = process.env.REDIS_URL;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  // Vercel KV (Upstash)
  if (kvUrl && kvToken) {
    console.log('🔵 Using UpstashStateStore (Vercel KV)');
    return new UpstashStateStore(kvUrl, kvToken);
  }

  // Local Redis (Docker)
  if (redisUrl && redisUrl.includes('redis://')) {
    console.log('🔴 Using RedisStateStore (local)');
    try {
      return new RedisStateStore(redisUrl);
    } catch (error) {
      console.warn('⚠️ RedisStateStore failed, falling back to MemoryStateStore:', error);
      return new MemoryStateStore();
    }
  }

  // Fallback: Memory (test/dev without Redis)
  console.log('⚪ Using MemoryStateStore (fallback)');
  return new MemoryStateStore();
}

export { MemoryStateStore } from './memory-store';