import type { IConfigStore, ConfigGroup, HorizonDetectorConfig } from './config-schema';

export interface GlobalRuntimeConfig {
  shadowMode: boolean;
  timezone: string;
  sessionStart: string;
  sessionEnd: string;
  eveningCutoff: string;
}

export interface Q10PredatorRuntimeConfig {
  emaAlpha: number;
  zScoreThreshold: number;
  sessionReset: boolean;
}

export interface Q1PriceControlRuntimeConfig {
  ofiWindow: number;
  rtofiWindow: number;
  divergenceSigma: number;
  ofiMinAbsolute: number;
}

export interface Q8SqueezeRuntimeConfig {
  emaAlpha: number;
  cancelDropThreshold: number;
  cancelLowThreshold: number;
  bsciMax: number;
  vwapDeviationMax: number;
  atrPctMax: number;
  cancelWindow: number;
  kvTimeoutMs: number;
}

export interface Q11RotationRuntimeConfig {
  scoreThreshold: number;
  maxScore: number;
  minTrades: number;
}

export interface Q9PreImpulseRuntimeConfig {
  tier1VolumeDrop: number;
  tier1CancelPct: number;
  tier2BsciLow: number;
  tier2BsciHigh: number;
  tier2SilenceBars: number;
  mainSessionOnly: boolean;
}

export interface Q12AlgorithmicRuntimeConfig {
  robotVolThreshold: number;
  robotVolWindow: number;
  eveningCutoff: string;
}

export interface CIPHERRuntimeConfig {
  threshold: number;
  percentilePenaltyEnabled: boolean;
  cnPenaltyBands: Array<{ min: number; max: number; penalty: number }>;
}

export interface CONFRuntimeConfig {
  enabled: boolean;
  confidenceFloor: number;
  confidenceCeiling: number;
  factors: {
    cancelRatioWeight: number;
    cipherWeight: number;
    icebergWeight: number;
    sessionPhaseWeight: number;
    dataQualityWeight: number;
  };
}

export interface DetectorRuntimeConfig {
  global: GlobalRuntimeConfig;
  q10_predator: Q10PredatorRuntimeConfig;
  q1_priceControl: Q1PriceControlRuntimeConfig;
  q8_squeeze: Q8SqueezeRuntimeConfig;
  q11_rotation: Q11RotationRuntimeConfig;
  q9_preImpulse: Q9PreImpulseRuntimeConfig;
  q12_algorithmic: Q12AlgorithmicRuntimeConfig;
  cipher: CIPHERRuntimeConfig;
  conf: CONFRuntimeConfig;
}

export class ConfigResolver {
  private store: IConfigStore;
  private cache: DetectorRuntimeConfig | null = null;
  private cacheExpiry = 0;
  private readonly TTL_MS = 30_000;

  constructor(store: IConfigStore) {
    this.store = store;
  }

  async resolve(): Promise<DetectorRuntimeConfig> {
    const now = Date.now();
    if (this.cache && now < this.cacheExpiry) {
      return this.cache;
    }

    const raw = await this.store.getConfig();
    const resolved = this.mapToRuntime(raw);

    this.cache = resolved;
    this.cacheExpiry = now + this.TTL_MS;

    return resolved;
  }

  async resolveGroup<G extends ConfigGroup>(group: G): Promise<DetectorRuntimeConfig[G]> {
    const full = await this.resolve();
    return full[group];
  }

  invalidateCache(): void {
    this.cache = null;
    this.cacheExpiry = 0;
  }

  private mapToRuntime(raw: HorizonDetectorConfig): DetectorRuntimeConfig {
    return {
      global: {
        shadowMode: raw.global.shadowMode,
        timezone: raw.global.timezone,
        sessionStart: raw.global.sessionStart,
        sessionEnd: raw.global.sessionEnd,
        eveningCutoff: raw.global.eveningCutoff,
      },
      q10_predator: {
        emaAlpha: raw.q10_predator.emaAlpha,
        zScoreThreshold: raw.q10_predator.zScoreThreshold,
        sessionReset: raw.q10_predator.sessionReset,
      },
      q1_priceControl: {
        ofiWindow: raw.q1_priceControl.ofiWindow,
        rtofiWindow: raw.q1_priceControl.rtofiWindow,
        divergenceSigma: raw.q1_priceControl.divergenceSigma,
        ofiMinAbsolute: raw.q1_priceControl.ofiMinAbsolute,
      },
      q8_squeeze: {
        emaAlpha: raw.q8_squeeze.emaAlpha,
        cancelDropThreshold: raw.q8_squeeze.cancelDropThreshold,
        cancelLowThreshold: raw.q8_squeeze.cancelLowThreshold,
        bsciMax: raw.q8_squeeze.bsciMax,
        vwapDeviationMax: raw.q8_squeeze.vwapDeviationMax,
        atrPctMax: raw.q8_squeeze.atrPctMax,
        cancelWindow: raw.q8_squeeze.cancelWindow,
        kvTimeoutMs: raw.q8_squeeze.kvTimeoutMs,
      },
      q11_rotation: {
        scoreThreshold: raw.q11_rotation.scoreThreshold,
        maxScore: raw.q11_rotation.maxScore,
        minTrades: raw.q11_rotation.minTrades,
      },
      q9_preImpulse: {
        tier1VolumeDrop: raw.q9_preImpulse.tier1VolumeDrop,
        tier1CancelPct: raw.q9_preImpulse.tier1CancelPct,
        tier2BsciLow: raw.q9_preImpulse.tier2BsciLow,
        tier2BsciHigh: raw.q9_preImpulse.tier2BsciHigh,
        tier2SilenceBars: raw.q9_preImpulse.tier2SilenceBars,
        mainSessionOnly: raw.q9_preImpulse.mainSessionOnly,
      },
      q12_algorithmic: {
        robotVolThreshold: raw.q12_algorithmic.robotVolThreshold,
        robotVolWindow: raw.q12_algorithmic.robotVolWindow,
        eveningCutoff: raw.q12_algorithmic.eveningCutoff,
      },
      cipher: {
        threshold: raw.cipher.threshold,
        percentilePenaltyEnabled: raw.cipher.percentilePenaltyEnabled,
        cnPenaltyBands: raw.cipher.cnPenaltyBands,
      },
      conf: {
        enabled: raw.conf.enabled,
        confidenceFloor: raw.conf.confidenceFloor,
        confidenceCeiling: raw.conf.confidenceCeiling,
        factors: { ...raw.conf.factors },
      },
    };
  }
}

let _resolver: ConfigResolver | null = null;

export function getConfigResolver(store: IConfigStore): ConfigResolver {
  if (!_resolver) {
    _resolver = new ConfigResolver(store);
  }
  return _resolver;
}

export function resetConfigResolver(): void {
  _resolver = null;
}