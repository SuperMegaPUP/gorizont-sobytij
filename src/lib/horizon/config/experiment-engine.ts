import type { Experiment, HorizonDetectorConfig } from './config-schema';
import type { IConfigStore } from './config-redis';

export class ExperimentEngine {
  private store: IConfigStore;

  constructor(store: IConfigStore) {
    this.store = store;
  }

  async createExperiment(params: {
    name: string;
    description: string;
    createdBy: string;
    config: Partial<HorizonDetectorConfig>;
    tickers: string[];
  }): Promise<Experiment> {
    const exp: Experiment = {
      id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: params.name,
      description: params.description,
      createdAt: new Date().toISOString(),
      createdBy: params.createdBy,
      status: 'draft',
      config: params.config,
      tickers: params.tickers,
      controlTickers: [],
      metrics: {
        experimentTickerAlerts: Object.fromEntries(params.tickers.map((t) => [t, 0])),
        controlTickerAlerts: {},
        alertTimeline: [],
        runningPrecision: { experiment: 0, control: 0 },
        slotsProcessed: 0,
      },
    };

    await this.store.saveExperiment(exp);
    return exp;
  }

  async startExperiment(experimentId: string, controlTickers: string[]): Promise<Experiment> {
    const exps = await this.store.getExperiments();
    const exp = exps.find((e) => e.id === experimentId);

    if (!exp || exp.status !== 'draft') {
      throw new Error('Invalid experiment');
    }

    const overlap = exp.tickers.filter((t) => controlTickers.includes(t));
    if (overlap.length > 0) {
      throw new Error(`Overlap: ${overlap.join(',')}`);
    }

    exp.status = 'running';
    exp.startedAt = new Date().toISOString();
    exp.controlTickers = controlTickers;
    exp.metrics!.controlTickerAlerts = Object.fromEntries(controlTickers.map((t) => [t, 0]));

    await this.store.saveExperiment(exp);
    return exp;
  }

  async recordAlert(
    experimentId: string,
    ticker: string,
    group: 'experiment' | 'control',
    pattern: string,
    effectiveSignal: number
  ): Promise<void> {
    const exps = await this.store.getExperiments();
    const exp = exps.find((e) => e.id === experimentId);

    if (!exp || exp.status !== 'running' || !exp.metrics) {
      return;
    }

    if (group === 'experiment') {
      exp.metrics.experimentTickerAlerts[ticker] = (exp.metrics.experimentTickerAlerts[ticker] ?? 0) + 1;
    } else {
      exp.metrics.controlTickerAlerts[ticker] = (exp.metrics.controlTickerAlerts[ticker] ?? 0) + 1;
    }

    exp.metrics.alertTimeline.push({
      timestamp: new Date().toISOString(),
      ticker,
      group,
      pattern,
      effectiveSignal,
    });

    exp.metrics.slotsProcessed += 1;
    await this.store.saveExperiment(exp);
  }

  async completeExperiment(experimentId: string): Promise<Experiment> {
    const exps = await this.store.getExperiments();
    const exp = exps.find((e) => e.id === experimentId);

    if (!exp || exp.status !== 'running') {
      throw new Error('Invalid');
    }

    exp.status = 'completed';
    exp.endedAt = new Date().toISOString();

    const eA = Object.values(exp.metrics?.experimentTickerAlerts ?? {}).reduce((a, b) => a + b, 0);
    const cA = Object.values(exp.metrics?.controlTickerAlerts ?? {}).reduce((a, b) => a + b, 0);
    const eP = exp.metrics?.runningPrecision.experiment ?? 0;
    const cP = exp.metrics?.runningPrecision.control ?? 0;

    exp.results = {
      experimentAlerts: eA,
      controlAlerts: cA,
      experimentPrecision: eP,
      controlPrecision: cP,
      delta: eA - cA,
      confidence: Math.min(1, 1 - Math.exp(-(exp.metrics?.slotsProcessed ?? 0) / 50)),
      recommendation: eP - cP > 0.1 ? 'promote' : eP - cP < -0.1 ? 'revert' : 'extend',
    };

    await this.store.saveExperiment(exp);
    return exp;
  }

  async cancelExperiment(experimentId: string): Promise<Experiment> {
    const exps = await this.store.getExperiments();
    const exp = exps.find((e) => e.id === experimentId);

    if (!exp) {
      throw new Error('Not found');
    }

    exp.status = 'cancelled';
    exp.endedAt = new Date().toISOString();

    await this.store.saveExperiment(exp);
    return exp;
  }

  async promoteExperiment(experimentId: string): Promise<HorizonDetectorConfig> {
    const exps = await this.store.getExperiments();
    const exp = exps.find((e) => e.id === experimentId);

    if (!exp || exp.status !== 'completed') {
      throw new Error('Invalid');
    }

    for (const [group, values] of Object.entries(exp.config)) {
      await this.store.updateGroup(group as keyof HorizonDetectorConfig, values as Record<string, unknown>);
    }

    await this.store.addHistory({
      id: `hist_${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: 'experiment_promote',
      action: 'experiment_apply',
      group: Object.keys(exp.config)[0] as keyof HorizonDetectorConfig,
      previousValue: {},
      newValue: exp.config as Record<string, unknown>,
      reason: `Promoted: ${exp.name}`,
      experimentId: exp.id,
    });

    return this.store.getConfig();
  }
}