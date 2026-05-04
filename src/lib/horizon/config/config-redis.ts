import type { IConfigStore, HorizonDetectorConfig, ConfigGroup, ConfigHistoryEntry, FreezeState, Experiment, AutoRollbackEvent } from './config-schema';
import { DEFAULT_HORIZON_CONFIG } from './default-config';

export class UpstashConfigStore implements IConfigStore {
  private redis: any;
  private prefix = 'horizon:config';
  private useFallback = false;

  constructor(redis: any) {
    this.redis = redis;
  }

  private async withTimeout<T>(promise: Promise<T>, ms = 5000): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Redis timeout after ${ms}ms`)), ms)
      ),
    ]);
  }

  private async safeGet<T>(key: string): Promise<T | null> {
    if (this.useFallback) return null;
    try {
      return await this.withTimeout(this.redis.get<T>(key), 5000);
    } catch (e) {
      console.error('[ConfigRedis] GET failed, using memory fallback:', e);
      this.useFallback = true;
      return null;
    }
  }

  private async safeSet(key: string, value: string): Promise<void> {
    if (this.useFallback) return;
    try {
      await this.withTimeout(this.redis.set(key, value), 5000);
    } catch (e) {
      console.error('[ConfigRedis] SET failed, using memory fallback:', e);
      this.useFallback = true;
    }
  }

  async getConfig(): Promise<HorizonDetectorConfig> {
    const raw = await this.safeGet<string>(`${this.prefix}:current`);
    if (!raw) {
      await this.safeSet(`${this.prefix}:current`, JSON.stringify(DEFAULT_HORIZON_CONFIG));
      return { ...DEFAULT_HORIZON_CONFIG };
    }
    return JSON.parse(raw) as HorizonDetectorConfig;
  }

  async updateGroup(group: ConfigGroup, values: Record<string, unknown>): Promise<HorizonDetectorConfig> {
    const current = await this.getConfig();
    const updated = { ...current, [group]: { ...current[group], ...values } };
    await this.safeSet(`${this.prefix}:current`, JSON.stringify(updated));
    return updated;
  }

  async getHistory(limit = 100): Promise<ConfigHistoryEntry[]> {
    const raw = await this.safeGet<string>(`${this.prefix}:history`);
    if (!raw) return [];
    const all = JSON.parse(raw) as ConfigHistoryEntry[];
    return all.slice(-limit);
  }

  async addHistory(entry: ConfigHistoryEntry): Promise<void> {
    const raw = await this.safeGet<string>(`${this.prefix}:history`);
    const all = raw ? (JSON.parse(raw) as ConfigHistoryEntry[]) : [];
    all.push(entry);
    if (all.length > 500) {
      await this.safeSet(`${this.prefix}:history`, JSON.stringify(all.slice(-500)));
    } else {
      await this.safeSet(`${this.prefix}:history`, JSON.stringify(all));
    }
  }

  async getFreezeState(): Promise<FreezeState> {
    const raw = await this.safeGet<string>(`${this.prefix}:freeze`);
    if (!raw) return { frozen: false };
    return JSON.parse(raw) as FreezeState;
  }

  async setFreezeState(state: FreezeState): Promise<void> {
    await this.safeSet(`${this.prefix}:freeze`, JSON.stringify(state));
  }

  async getExperiments(): Promise<Experiment[]> {
    const raw = await this.safeGet<string>(`${this.prefix}:experiments`);
    if (!raw) return [];
    return JSON.parse(raw) as Experiment[];
  }

  async saveExperiment(experiment: Experiment): Promise<void> {
    const experiments = await this.getExperiments();
    const idx = experiments.findIndex((e) => e.id === experiment.id);
    if (idx >= 0) {
      experiments[idx] = experiment;
    } else {
      experiments.push(experiment);
    }
    await this.safeSet(`${this.prefix}:experiments`, JSON.stringify(experiments));
  }

  async getRollbackLog(): Promise<AutoRollbackEvent[]> {
    const raw = await this.safeGet<string>(`${this.prefix}:rollback_log`);
    if (!raw) return [];
    return JSON.parse(raw) as AutoRollbackEvent[];
  }

  async addRollbackEvent(event: AutoRollbackEvent): Promise<void> {
    const raw = await this.safeGet<string>(`${this.prefix}:rollback_log`);
    const all = raw ? (JSON.parse(raw) as AutoRollbackEvent[]) : [];
    all.push(event);
    await this.safeSet(`${this.prefix}:rollback_log`, JSON.stringify(all.slice(-100)));
  }

  async getChangeCount(sessionId: string): Promise<number> {
    const val = await this.safeGet<number>(`${this.prefix}:changes:${sessionId}`);
    return val ?? 0;
  }

  async incrementChangeCount(sessionId: string): Promise<number> {
    if (this.useFallback) {
      const c = (await this.getChangeCount(sessionId)) + 1;
      return c;
    }
    const key = `${this.prefix}:changes:${sessionId}`;
    try {
      const count = await this.withTimeout(this.redis.incr(key), 5000);
      if (count === 1) await this.redis.expire(key, 28800);
      return count;
    } catch (e) {
      console.error('[ConfigRedis] INCR failed, using memory fallback:', e);
      this.useFallback = true;
      return (await this.getChangeCount(sessionId)) + 1;
    }
  }

  async resetChangeCount(sessionId: string): Promise<void> {
    if (this.useFallback) return;
    const key = `${this.prefix}:changes:${sessionId}`;
    try {
      await this.withTimeout(this.redis.del(key), 5000);
    } catch (e) {
      this.useFallback = true;
    }
  }

  async getAlertRates(limit = 100): Promise<Array<{ timestamp: string; rate: number }>> {
    const raw = await this.safeGet<string>(`${this.prefix}:alert_rates`);
    if (!raw) return [];
    return (JSON.parse(raw) as Array<{ timestamp: string; rate: number }>).slice(-limit);
  }

  async addAlertRate(timestamp: string, rate: number): Promise<void> {
    const raw = await this.safeGet<string>(`${this.prefix}:alert_rates`);
    const all = raw ? (JSON.parse(raw) as Array<{ timestamp: string; rate: number }>) : [];
    all.push({ timestamp, rate });
    await this.safeSet(`${this.prefix}:alert_rates`, JSON.stringify(all.slice(-200)));
  }
}

export class MemoryConfigStore implements IConfigStore {
  private config: HorizonDetectorConfig = { ...DEFAULT_HORIZON_CONFIG };
  private history: ConfigHistoryEntry[] = [];
  private freeze: FreezeState = { frozen: false };
  private experiments: Experiment[] = [];
  private rollbackLog: AutoRollbackEvent[] = [];
  private changeCounts = new Map<string, number>();
  private alertRates: Array<{ timestamp: string; rate: number }> = [];

  async getConfig(): Promise<HorizonDetectorConfig> {
    return { ...this.config };
  }

  async updateGroup(group: ConfigGroup, values: Record<string, unknown>): Promise<HorizonDetectorConfig> {
    this.config = {
      ...this.config,
      [group]: { ...this.config[group], ...values },
    };
    return { ...this.config };
  }

  async getHistory(limit?: number): Promise<ConfigHistoryEntry[]> {
    return this.history.slice(-(limit ?? 100));
  }

  async addHistory(entry: ConfigHistoryEntry): Promise<void> {
    this.history.push(entry);
    if (this.history.length > 500) {
      this.history = this.history.slice(-500);
    }
  }

  async getFreezeState(): Promise<FreezeState> {
    return { ...this.freeze };
  }

  async setFreezeState(state: FreezeState): Promise<void> {
    this.freeze = { ...state };
  }

  async getExperiments(): Promise<Experiment[]> {
    return [...this.experiments];
  }

  async saveExperiment(experiment: Experiment): Promise<void> {
    const idx = this.experiments.findIndex((e) => e.id === experiment.id);
    if (idx >= 0) {
      this.experiments[idx] = experiment;
    } else {
      this.experiments.push(experiment);
    }
  }

  async getRollbackLog(): Promise<AutoRollbackEvent[]> {
    return [...this.rollbackLog];
  }

  async addRollbackEvent(event: AutoRollbackEvent): Promise<void> {
    this.rollbackLog.push(event);
    if (this.rollbackLog.length > 100) {
      this.rollbackLog = this.rollbackLog.slice(-100);
    }
  }

  async getChangeCount(sessionId: string): Promise<number> {
    return this.changeCounts.get(sessionId) ?? 0;
  }

  async incrementChangeCount(sessionId: string): Promise<number> {
    const c = (this.changeCounts.get(sessionId) ?? 0) + 1;
    this.changeCounts.set(sessionId, c);
    return c;
  }

  async resetChangeCount(sessionId: string): Promise<void> {
    this.changeCounts.delete(sessionId);
  }

  async getAlertRates(limit?: number): Promise<Array<{ timestamp: string; rate: number }>> {
    return this.alertRates.slice(-(limit ?? 100));
  }

  async addAlertRate(timestamp: string, rate: number): Promise<void> {
    this.alertRates.push({ timestamp, rate });
    if (this.alertRates.length > 200) {
      this.alertRates = this.alertRates.slice(-200);
    }
  }
}