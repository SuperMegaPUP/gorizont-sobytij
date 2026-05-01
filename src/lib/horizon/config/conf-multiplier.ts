import type { CONFConfigSchema } from './config-schema';

export interface SlotDataForConfidence {
  cancelRatio: number;
  cipherScore: number;
  icebergCount: number;
  tradeCount: number;
  sessionPhase?: string;
  dataQuality?: number;
}

export function computeConfidenceMultiplier(
  slotData: SlotDataForConfidence,
  confConfig: CONFConfigSchema
): number {
  if (!confConfig.enabled) {
    return 1.0;
  }

  const { factors, confidenceFloor, confidenceCeiling } = confConfig;

  const cancelConf = 1 - slotData.cancelRatio * factors.cancelRatioWeight;

  let cipherConf: number;
  if (slotData.cipherScore > 0.3) {
    cipherConf = 1 + slotData.cipherScore * factors.cipherWeight;
  } else {
    cipherConf = 1 - factors.cipherWeight * 0.5;
  }

  let icebergConf: number;
  if (slotData.icebergCount > 2) {
    icebergConf = 1 + factors.icebergWeight;
  } else if (slotData.icebergCount > 0) {
    icebergConf = 1 - factors.icebergWeight * 0.3;
  } else {
    icebergConf = 1 - factors.icebergWeight * 0.5;
  }

  const qualityConf = slotData.tradeCount > 20 ? 1 : 0.8;

  const phaseConf = slotData.sessionPhase === 'MAIN' 
    ? 1 + factors.sessionPhaseWeight * 0.2 
    : 1 - factors.sessionPhaseWeight * 0.1;

  const rawMultiplier = 
    cancelConf * (1 - factors.cancelRatioWeight) +
    cipherConf * factors.cipherWeight +
    icebergConf * factors.icebergWeight +
    phaseConf * factors.sessionPhaseWeight +
    qualityConf * factors.dataQualityWeight;

  const clamped = Math.max(confidenceFloor, Math.min(confidenceCeiling, rawMultiplier));
  
  return Math.round(clamped * 100) / 100;
}

export function applyConfidenceMultiplier(
  bsci: number,
  slotData: SlotDataForConfidence,
  confConfig: CONFConfigSchema
): number {
  if (!confConfig.enabled) {
    return bsci;
  }

  const multiplier = computeConfidenceMultiplier(slotData, confConfig);
  const effectiveSignal = bsci * multiplier;

  return Math.round(effectiveSignal * 1000) / 1000;
}