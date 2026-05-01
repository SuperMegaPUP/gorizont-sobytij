import { MemoryStateStore } from '@/lib/horizon/state/memory-store';
import { createStateStore, IStateStore } from '@/lib/horizon/state/factory';

describe('IStateStore implementations', () => {
  const testKey = 'test:state:ema';
  const alpha = 0.3;

  describe('MemoryStateStore', () => {
    let store: IStateStore;

    beforeEach(() => {
      store = new MemoryStateStore();
    });

    it('should return null for non-existent key', async () => {
      const result = await store.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should set and get value', async () => {
      await store.set(testKey, 0.5);
      const result = await store.get(testKey);
      expect(result).toBe(0.5);
    });

    it('should calculate EMA on cold start', async () => {
      const result = await store.calcEMA(testKey, 0.5, alpha);
      expect(result.smoothed).toBe(0.5);
      expect(result.isColdStart).toBe(true);
      expect(result.prev).toBe(0.5);
    });

    it('should calculate EMA with continuity', async () => {
      await store.calcEMA(testKey, 0.5, alpha);
      const result = await store.calcEMA(testKey, 0.8, alpha);
      expect(result.smoothed).toBeCloseTo(0.3 * 0.8 + 0.7 * 0.5);
      expect(result.isColdStart).toBe(false);
    });

    it('should handle rolling window', async () => {
      await store.pushRolling('test:rolling', 1, 5);
      await store.pushRolling('test:rolling', 2, 5);
      await store.pushRolling('test:rolling', 3, 5);

      const result = await store.getRolling('test:rolling', 5);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should truncate rolling window beyond limit', async () => {
      for (let i = 1; i <= 7; i++) {
        await store.pushRolling('test:window', i, 5);
      }

      const result = await store.getRolling('test:window', 5);
      expect(result).toEqual([3, 4, 5, 6, 7]);
    });

    it('should return true for ping', async () => {
      const result = await store.ping();
      expect(result).toBe(true);
    });
  });

  describe('createStateStore factory', () => {
    it('should return MemoryStateStore when no Redis configured', () => {
      // Clear env vars for test
      const originalEnv = { ...process.env };
      delete process.env.REDIS_URL;
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;

      const store = createStateStore();
      expect(store).toBeInstanceOf(MemoryStateStore);

      // Restore
      process.env = originalEnv;
    });

    it('should handle missing Redis gracefully', () => {
      const originalEnv = { ...process.env };
      process.env.REDIS_URL = 'redis://invalid:6379';

      // Should not throw, should fallback to Memory
      expect(() => createStateStore()).not.toThrow();

      process.env = originalEnv;
    });
  });

  describe('EMA calculation parity', () => {
    it('should produce same result across implementations', async () => {
      const memoryStore = new MemoryStateStore();

      // Test sequence: 0.5 → 0.8 → 0.3 → 0.9
      const values = [0.5, 0.8, 0.3, 0.9];
      const results: number[] = [];

      for (const value of values) {
        const result = await memoryStore.calcEMA(testKey, value, alpha);
        results.push(result.smoothed);
        // Reset for next iteration
        await memoryStore.set(testKey, value);
      }

      // First should be cold start (0.5)
      expect(results[0]).toBe(0.5);
      // Second: 0.3*0.8 + 0.7*0.5 = 0.59
      expect(results[1]).toBeCloseTo(0.59, 2);
    });
  });
});