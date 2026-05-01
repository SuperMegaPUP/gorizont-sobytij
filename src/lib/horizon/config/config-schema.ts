export type ConfigGroup = 
  | 'global'
  | 'q10_predator'
  | 'q1_priceControl'
  | 'q8_squeeze'
  | 'q11_rotation'
  | 'q9_preImpulse'
  | 'q12_algorithmic'
  | 'cipher'
  | 'conf';

export interface GlobalConfigSchema {
  shadowMode: boolean;
  timezone: string;
  sessionStart: string;
  sessionEnd: string;
  eveningCutoff: string;
  maxChangesPerSession: number;
  autoRollbackSigma: number;
  autoRollbackWindowMin: number;
}

export interface Q10PredatorConfigSchema {
  emaAlpha: number;
  zScoreThreshold: number;
  sessionReset: boolean;
}

export interface Q1PriceControlConfigSchema {
  ofiWindow: number;
  rtofiWindow: number;
  divergenceSigma: number;
  ofiMinAbsolute: number;
}

export interface Q8SqueezeConfigSchema {
  emaAlpha: number;
  cancelDropThreshold: number;
  cancelLowThreshold: number;
  bsciMax: number;
  vwapDeviationMax: number;
  atrPctMax: number;
  cancelWindow: number;
  kvTimeoutMs: number;
}

export interface Q11RotationConfigSchema {
  scoreThreshold: number;
  maxScore: number;
  minTrades: number;
}

export interface Q9PreImpulseConfigSchema {
  tier1VolumeDrop: number;
  tier1CancelPct: number;
  tier2BsciLow: number;
  tier2BsciHigh: number;
  tier2SilenceBars: number;
  mainSessionOnly: boolean;
}

export interface Q12AlgorithmicConfigSchema {
  robotVolThreshold: number;
  robotVolWindow: number;
  eveningCutoff: string;
}

export interface CIPHERConfigSchema {
  threshold: number;
  percentilePenaltyEnabled: boolean;
  cnPenaltyBands: Array<{ min: number; max: number; penalty: number }>;
}

export interface CONFFactorsSchema {
  cancelRatioWeight: number;
  cipherWeight: number;
  icebergWeight: number;
  sessionPhaseWeight: number;
  dataQualityWeight: number;
}

export interface CONFConfigSchema {
  enabled: boolean;
  confidenceFloor: number;
  confidenceCeiling: number;
  factors: CONFFactorsSchema;
}

export interface HorizonDetectorConfig {
  global: GlobalConfigSchema;
  q10_predator: Q10PredatorConfigSchema;
  q1_priceControl: Q1PriceControlConfigSchema;
  q8_squeeze: Q8SqueezeConfigSchema;
  q11_rotation: Q11RotationConfigSchema;
  q9_preImpulse: Q9PreImpulseConfigSchema;
  q12_algorithmic: Q12AlgorithmicConfigSchema;
  cipher: CIPHERConfigSchema;
  conf: CONFConfigSchema;
}

export interface ConfigUpdateRequest {
  group: ConfigGroup;
  values: Record<string, number | string | boolean>;
  reason: string;
}

export interface ConfigUpdateResponse {
  success: boolean;
  previousValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  historyId: string;
  warnings: string[];
  changesRemaining: number;
}

export interface ConfigRollbackRequest {
  historyId: string;
  reason: string;
}

export interface ConfigFreezeRequest {
  freeze: boolean;
  reason?: string;
  groups?: ConfigGroup[];
}

export interface FreezeState {
  frozen: boolean;
  frozenAt?: string;
  frozenBy?: string;
  reason?: string;
  frozenGroups?: ConfigGroup[];
}

export interface ValidationError {
  field: string;
  message: string;
  value: unknown;
  constraint: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: Array<{ field: string; message: string }>;
}

export interface ConfigHistoryEntry {
  id: string;
  timestamp: string;
  userId: string;
  action: 'update' | 'rollback' | 'freeze' | 'unfreeze' | 'experiment_apply';
  group: string;
  previousValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  reason: string;
  experimentId?: string;
}

export interface Experiment {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  createdBy: string;
  status: 'draft' | 'running' | 'completed' | 'cancelled';
  config: Partial<HorizonDetectorConfig>;
  tickers: string[];
  controlTickers: string[];
  startedAt?: string;
  endedAt?: string;
  metrics?: {
    experimentTickerAlerts: Record<string, number>;
    controlTickerAlerts: Record<string, number>;
    alertTimeline: Array<{
      timestamp: string;
      ticker: string;
      group: 'experiment' | 'control';
      pattern: string;
      effectiveSignal: number;
    }>;
    runningPrecision: { experiment: number; control: number };
    slotsProcessed: number;
  };
  results?: {
    experimentAlerts: number;
    controlAlerts: number;
    experimentPrecision: number;
    controlPrecision: number;
    delta: number;
    confidence: number;
    recommendation: 'promote' | 'revert' | 'extend';
  };
}

export interface AutoRollbackEvent {
  id: string;
  timestamp: string;
  triggerGroup: ConfigGroup;
  metric: string;
  observedSigma: number;
  threshold: number;
  rolledBackTo: string;
  details: Record<string, unknown>;
}

export interface HorizonHealthStatus {
  status: 'healthy' | 'degraded' | 'critical';
  uptime: number;
  detectorsActive: number;
  detectorsTotal: number;
  shadowDetectors: string[];
  lastScanAt: string;
  configFrozen: boolean;
  activeExperiments: number;
  redisConnected: boolean;
  alertRate: number;
  alertRateSigma: number;
}

export interface ConfigPreviewRequest {
  group: ConfigGroup;
  values: Record<string, number | string | boolean>;
  ticker: string;
}

export interface ConfigPreviewResponse {
  ticker: string;
  timestamp: string;
  current: {
    alerts: number;
    topPatterns: string[];
    effectiveSignals: Record<string, number>;
  };
  proposed: {
    alerts: number;
    topPatterns: string[];
    effectiveSignals: Record<string, number>;
  };
  slots: Array<{
    timestamp: string;
    detector: string;
    currentSignal: number;
    proposedSignal: number;
    currentAlert: boolean;
    proposedAlert: boolean;
  }>;
  delta: {
    alertsDelta: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    warnings: string[];
    affectedDetectors: string[];
  };
}

export interface IConfigStore {
  getConfig(): Promise<HorizonDetectorConfig>;
  updateGroup(group: ConfigGroup, values: Record<string, unknown>): Promise<HorizonDetectorConfig>;
  getHistory(limit?: number): Promise<ConfigHistoryEntry[]>;
  addHistory(entry: ConfigHistoryEntry): Promise<void>;
  getFreezeState(): Promise<FreezeState>;
  setFreezeState(state: FreezeState): Promise<void>;
  getExperiments(): Promise<Experiment[]>;
  saveExperiment(experiment: Experiment): Promise<void>;
  getRollbackLog(): Promise<AutoRollbackEvent[]>;
  addRollbackEvent(event: AutoRollbackEvent): Promise<void>;
  getChangeCount(sessionId: string): Promise<number>;
  incrementChangeCount(sessionId: string): Promise<number>;
  resetChangeCount(sessionId: string): Promise<void>;
  getAlertRates(limit?: number): Promise<Array<{ timestamp: string; rate: number }>>;
  addAlertRate(timestamp: string, rate: number): Promise<void>;
}