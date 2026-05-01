import type { IConfigStore, HorizonDetectorConfig, ConfigGroup, ConfigHistoryEntry, FreezeState, Experiment, AutoRollbackEvent } from './config-schema';
import { DEFAULT_HORIZON_CONFIG } from './default-config';

export class UpstashConfigStore implements IConfigStore {
  private redis: any;
  private prefix = 'horizon:config';

  constructor(redis: any) {
    this.redis = redis;
  }

  async getConfig(): Promise<HorizonDetectorConfig> {
    const raw = await this.redis.get<string>(`${this.prefix}:current`);
    if (!raw) {
      await this.redis.set(`${this.prefix}:current`, JSON.stringify(DEFAULT_HORIZON_CONFIG));
      return { ...DEFAULT_HORIZON_CONFIG };
    }
    return JSON.parse(raw) as HorizonDetectorConfig;
  }

  async updateGroup(group: ConfigGroup, values: Record<string, unknown>): Promise<HorizonDetectorConfig> {
    const current = await this.getConfig();
    const updated = { ...current, [group]: { ...current[group], ...values } };
    await this.redis.set(`${this.prefix}:current`, JSON.stringify(updated));
    return updated;
  }

  async getHistory(limit = 100): Promise<ConfigHistoryEntry[]> {
    const raw = await this.redis.get<string>(`${this.prefix}:history`);
    if (!raw) return [];
    const all = JSON.parse(raw) as ConfigHistoryEntry[];
    return all.slice(-limit);
  }

  async addHistory(entry: ConfigHistoryEntry): Promise<void> {
    const raw = await this.redis.get<string>(`${this.prefix}:history`);
    const all = raw ? (JSON.parse(raw) as ConfigHistoryEntry[]) : [];
    all.push(entry);
    if (all.length > 500) {
      await this.redis.set(`${this.prefix}:history`, JSON.stringify(all.slice(-500)));
    } else {
      await this.redis.set(`${this.prefix}:history`, JSON.stringify(all));
    }
  }

  async getFreezeState(): Promise<FreezeState> {
    const raw = await this.redis.get<string>(`${this.prefix}:freeze`);
    if (!raw) return { frozen: false };
    return JSON.parse(raw) as FreezeState;
  }

  async setFreezeState(state: FreezeState): Promise<void> {
    await this.redis.set(`${this.prefix}:freeze`, JSON.stringify(state));
  }

  async getExperiments(): Promise<Experiment[]> {
    const raw = await this.redis.get<string>(`${this.prefix}:experiments`);
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
    await this.redis.set(`${this.prefix}:experiments`, JSON.stringify(experiments));
  }

  async getRollbackLog(): Promise<AutoRollbackEvent[]> {
    const raw = await this.redis.get<string>(`${this.prefix}:rollback_log`);
    if (!raw) return [];
    return JSON.parse(raw) as AutoRollbackEvent[];
  }

  async addRollbackEvent(event: AutoRollbackEvent): Promise<void> {
    const raw = await this.redis.get<string>(`${this.prefix}:rollback_log`);
    const all = raw ? (JSON.parse(raw) as AutoRollbackEvent[]) : [];
    all.push(event);
    await this.redis.set(`${this.prefix}:rollback_log`, JSON.stringify(all.slice(-100)));
  }

  async getChangeCount(sessionId: string): Promise<number> {
    const val = await this.redis.get<number>(`${this.prefix}:changes:${sessionId}`);
    return val ?? 0;
  }

  async incrementChangeCount(sessionId: string): Promise<number> {
    const key = `${this.prefix}:changes:${sessionId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 28800);
    return count;
  }

  async resetChangeCount(sessionId: string): Promise<void> {
    await this.redis.del(`${this.prefix}:changes:${sessionId}`);
  }

  async getAlertRates(limit = 100): Promise<Array<{ timestamp: string; rate: number }>> {
    const raw = await this.redis.get<string>(`${this.prefix}:alert_rates`);
    if (!raw) return [];
    return (JSON.parse(raw) as Array<{ timestamp: string; rate: number }>).slice(-limit);
  }

  async addAlertRate(timestamp: string, rate: number): Promise<void> {
    const raw = await this.redis.get<string>(`${this.prefix}:alert_rates`);
    const all = raw ? (JSON.parse(raw) as Array<{ timestamp: string; rate: number }>) : [];
    all.push({ timestamp, rate });
    await this.redis.set(`${this.prefix}:alert_rates`, JSON.stringify(all.slice(-200)));
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