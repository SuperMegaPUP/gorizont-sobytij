import type { IConfigStore } from './config-redis';
import type { ConfigGroup, AutoRollbackEvent, HorizonDetectorConfig } from './config-schema';
import { shouldAutoRollback } from './config-validator';

export class AutoRollbackMonitor {
  private store: IConfigStore;

  constructor(store: IConfigStore) {
    this.store = store;
  }

  async check(config: HorizonDetectorConfig, currentRate: number): Promise<AutoRollbackEvent | null> {
    const rates = await this.store.getAlertRates(100);
    if (rates.length < 10) {
      return null;
    }

    const lastChange = await this.getLastConfigChangeTime();
    if (!lastChange) {
      return null;
    }

    const elapsed = Date.now() - new Date(lastChange).getTime();
    if (elapsed > config.global.autoRollbackWindowMin * 60 * 1000) {
      return null;
    }

    const mean = rates.reduce((a, r) => a + r.rate, 0) / rates.length;
    const std = Math.sqrt(rates.reduce((a, r) => a + (r.rate - mean) ** 2, 0) / rates.length);
    if (std === 0) {
      return null;
    }

    const { rollback, observedSigma } = shouldAutoRollback(
      mean,
      currentRate,
      std,
      config.global.autoRollbackSigma
    );

    if (!rollback) {
      return null;
    }

    const history = await this.store.getHistory(20);
    const lastUpdate = history
      .filter((h) => h.action === 'update')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    if (!lastUpdate) {
      return null;
    }

    await this.store.updateGroup(lastUpdate.group, lastUpdate.previousValue);

    const event: AutoRollbackEvent = {
      id: `arb_${Date.now()}`,
      timestamp: new Date().toISOString(),
      triggerGroup: lastUpdate.group as ConfigGroup,
      metric: 'alertRate',
      observedSigma,
      threshold: config.global.autoRollbackSigma,
      rolledBackTo: lastUpdate.id,
      details: { currentRate, baselineMean: mean, baselineStd: std, sigma: observedSigma },
    };

    await this.store.addRollbackEvent(event);

    await this.store.addHistory({
      id: `hist_${Date.now()}_arb`,
      timestamp: new Date().toISOString(),
      userId: 'auto_rollback',
      action: 'rollback',
      group: lastUpdate.group as ConfigGroup,
      previousValue: lastUpdate.newValue,
      newValue: lastUpdate.previousValue,
      reason: `AUTO-ROLLBACK: sigma=${observedSigma.toFixed(2)} > ${config.global.autoRollbackSigma}`,
    });

    return event;
  }

  private async getLastConfigChangeTime(): Promise<string | null> {
    const history = await this.store.getHistory(5);
    const lastUpdate = history
      .filter((h) => h.action === 'update')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    return lastUpdate?.timestamp ?? null;
  }
}