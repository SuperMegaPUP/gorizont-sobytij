import * as z from 'zod';

export const GlobalConfigSchema = z.object({
  shadowMode: z.boolean(),
  timezone: z.string(),
  sessionStart: z.string(),
  sessionEnd: z.string(),
  eveningCutoff: z.string(),
  maxChangesPerSession: z.number().min(1).max(20),
  autoRollbackSigma: z.number().min(1.0).max(5.0),
  autoRollbackWindowMin: z.number().min(5).max(1440),
});

export const Q10PredatorConfigSchema = z.object({
  emaAlpha: z.number().min(0.05).max(0.95),
  zScoreThreshold: z.number().min(1.0).max(4.0),
  sessionReset: z.boolean(),
});

export const Q1PriceControlConfigSchema = z.object({
  ofiWindow: z.number().min(5).max(60),
  rtofiWindow: z.number().min(5).max(60),
  divergenceSigma: z.number().min(1.0).max(4.0),
  ofiMinAbsolute: z.number().min(0.1).max(1.0),
});

export const Q8SqueezeConfigSchema = z.object({
  emaAlpha: z.number().min(0.1).max(0.9),
  cancelDropThreshold: z.number().min(-0.30).max(-0.02),
  cancelLowThreshold: z.number().min(0.20).max(0.80),
  bsciMax: z.number().min(0.05).max(0.40),
  vwapDeviationMax: z.number().min(0.005).max(0.05),
  atrPctMax: z.number().min(20).max(90),
  cancelWindow: z.number().min(1).max(10),
  kvTimeoutMs: z.number().min(200).max(2000),
});

export const Q11RotationConfigSchema = z.object({
  scoreThreshold: z.number().min(3).max(10),
  maxScore: z.number().min(8).max(20),
  minTrades: z.number().min(20).max(100),
});

export const Q9PreImpulseConfigSchema = z.object({
  tier1VolumeDrop: z.number().min(0.10).max(0.60),
  tier1CancelPct: z.number().min(0.50).max(0.99),
  tier2BsciLow: z.number().min(0.01).max(0.10),
  tier2BsciHigh: z.number().min(0.10).max(0.30),
  tier2SilenceBars: z.number().min(5).max(30),
  mainSessionOnly: z.boolean(),
});

export const Q12AlgorithmicConfigSchema = z.object({
  robotVolThreshold: z.number().min(0.40).max(0.95),
  robotVolWindow: z.number().min(10).max(60),
  eveningCutoff: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
});

export const CNPenaltyBandSchema = z.object({
  min: z.number().min(0),
  max: z.number().min(0),
  penalty: z.number().min(0).max(1),
});

export const CIPHERConfigSchema = z.object({
  threshold: z.number().min(0.30).max(0.80),
  percentilePenaltyEnabled: z.boolean(),
  cnPenaltyBands: z.array(CNPenaltyBandSchema),
});

export const CONFFactorsSchema = z.object({
  cancelRatioWeight: z.number().min(0).max(0.5),
  cipherWeight: z.number().min(0).max(0.5),
  icebergWeight: z.number().min(0).max(0.5),
  sessionPhaseWeight: z.number().min(0).max(0.5),
  dataQualityWeight: z.number().min(0).max(0.5),
}).refine(
  (factors) => {
    const total = Object.values(factors).reduce((a, b) => a + b, 0);
    return Math.abs(total - 1.0) < 0.15;
  },
  { message: 'Sum of weights must be ~1.0' }
);

export const CONFConfigSchema = z.object({
  enabled: z.boolean(),
  confidenceFloor: z.number().min(0.1).max(1.0),
  confidenceCeiling: z.number().min(1.0).max(3.0),
  factors: CONFFactorsSchema,
}).refine(
  (conf) => conf.confidenceFloor < conf.confidenceCeiling,
  { message: 'confidenceFloor must be < confidenceCeiling', path: ['confidenceFloor'] }
);

export const HorizonDetectorConfigSchema = z.object({
  global: GlobalConfigSchema,
  q10_predator: Q10PredatorConfigSchema,
  q1_priceControl: Q1PriceControlConfigSchema,
  q8_squeeze: Q8SqueezeConfigSchema,
  q11_rotation: Q11RotationConfigSchema,
  q9_preImpulse: Q9PreImpulseConfigSchema,
  q12_algorithmic: Q12AlgorithmicConfigSchema,
  cipher: CIPHERConfigSchema,
  conf: CONFConfigSchema,
});

export const CONFIG_GROUP_ENUM = z.enum([
  'global', 'q10_predator', 'q1_priceControl', 'q8_squeeze',
  'q11_rotation', 'q9_preImpulse', 'q12_algorithmic', 'cipher', 'conf',
]);

export const ConfigUpdateRequestSchema = z.object({
  group: CONFIG_GROUP_ENUM,
  values: z.record(z.union([z.number(), z.string(), z.boolean()])),
  reason: z.string().min(3).max(500),
});

export const ConfigPreviewRequestSchema = z.object({
  group: CONFIG_GROUP_ENUM,
  values: z.record(z.union([z.number(), z.string(), z.boolean()])),
  ticker: z.string().min(2).max(10),
});

export const ConfigRollbackRequestSchema = z.object({
  historyId: z.string().min(1),
  reason: z.string().min(3).max(500),
});

export const ConfigFreezeRequestSchema = z.object({
  freeze: z.boolean(),
  reason: z.string().max(500).optional(),
  groups: z.array(CONFIG_GROUP_ENUM).optional(),
});

export const CreateExperimentRequestSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().min(5).max(500),
  config: z.record(z.unknown()),
  tickers: z.array(z.string().min(2).max(10)).min(1).max(20),
});

export const ExperimentActionRequestSchema = z.object({
  action: z.enum(['start', 'complete', 'cancel', 'promote']),
  controlTickers: z.array(z.string()).optional(),
});