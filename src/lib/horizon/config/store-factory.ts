import type { IConfigStore } from './config-schema';
import { UpstashConfigStore, MemoryConfigStore } from './config-redis';

let _store: IConfigStore | null = null;

export function getConfigStore(): IConfigStore {
  if (_store) return _store;

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    try {
      const { Redis } = require('@upstash/redis');
      const redis = new Redis({ url, token });
      _store = new UpstashConfigStore(redis);
      console.log('[ConfigStore] Using @upstash/redis (REST API)');
      return _store;
    } catch (err) {
      console.warn('[ConfigStore] @upstash/redis failed, falling back:', String(err));
    }
  }

  console.warn('[ConfigStore] No Redis — using in-memory (NO PERSISTENCE!)');
  _store = new MemoryConfigStore();
  return _store;
}

export function resetConfigStore(): void {
  _store = null;
}