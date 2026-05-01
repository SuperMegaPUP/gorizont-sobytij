// ─── PRE-IMPULSE SILENCE DETECTOR (Q-9) ──────────────────────────────────
// Detects market silence before impulse - low BSCI + low detector activity + high volatility
// Эталонный кейс: GAZP #3 - BSCI 0.07 + CIPHER=0.00 + ATR 93%
//
// PRE_IMPULSE = BSCI_low && CIPHER_low && (ATR_high OR volume_low)
// TIER_1: Early warning (BSCI < 0.15, CIPHER < 0.1)
// TIER_2: Close to impulse (BSCI < 0.10, CIPHER < 0.05, ATR expanding)
//
// Формула: silenceScore = bsciFactor × 0.4 + cipherFactor × 0.3 + volatilityFactor × 0.3

import type { DetectorInput, DetectorResult } from './types';
import { clampScore, stalePenalty } from './guards';

const PREIMPULSE_MIN_TRADES = 10;
const PREIMPULSE_ABSOLUTE_MIN = 5;

// TIER thresholds
const TIER1_BSCI_MAX = 0.15;
const TIER1_CIPHER_MAX = 0.10;
const TIER2_BSCI_MAX = 0.10;
const TIER2_CIPHER_MAX = 0.05;
const HIGH_ATR_THRESHOLD = 80; // percent

export interface PreImpulseConfig {
  tier1BsciMax: number;
  tier1CipherMax: number;
  tier2BsciMax: number;
  tier2CipherMax: number;
  highAtrThreshold: number;
  bsciWeight: number;
  cipherWeight: number;
  volatilityWeight: number;
}

export const PREIMPULSE_DEFAULT_CONFIG: PreImpulseConfig = {
  tier1BsciMax: TIER1_BSCI_MAX,
  tier1CipherMax: TIER1_CIPHER_MAX,
  tier2BsciMax: TIER2_BSCI_MAX,
  tier2CipherMax: TIER2_CIPHER_MAX,
  highAtrThreshold: HIGH_ATR_THRESHOLD,
  bsciWeight: 0.4,
  cipherWeight: 0.3,
  volatilityWeight: 0.3,
};

export interface PreImpulseResult {
  silenceAlertActive: boolean;
  tier: 'TIER_1' | 'TIER_2' | 'NONE';
  silenceScore: number;
  bsciFactor: number;
  cipherFactor: number;
  volatilityFactor: number;
  conditions: {
    bsciLow: boolean;
    cipherLow: boolean;
    atrHigh: boolean;
    tier1Met: boolean;
    tier2Met: boolean;
  };
  metadata: Record<string, number | string | boolean>;
}

/**
 * Q-9: Detect PRE-IMPULSE SILENCE
 * @param detectorScores - Map of detector names to scores
 * @param bsci - Current BSCI value
 * @param atrPct - ATR percentage (0-100)
 * @param ofi - Order Flow Imbalance for direction
 * @param config - Configuration parameters
 */
export function detectPreImpulseSilence(
  detectorScores: Record<string, number>,
  bsci: number,
  atrPct: number = 50,
  ofi: number = 0,
  config: PreImpulseConfig = PREIMPULSE_DEFAULT_CONFIG
): PreImpulseResult {
  const metadata: Record<string, number | string | boolean> = {};

  // 1. Get CIPHER score (main indicator of market activity)
  const cipherScore = detectorScores['CIPHER'] || 0;
  const entropyScore = detectorScores['ENTANGLE'] || 0;
  const attractorScore = detectorScores['ATTRACTOR'] || 0;

  // Combined market activity score
  const marketActivity = Math.max(cipherScore, entropyScore, attractorScore);

  // 2. Calculate factors
  // BSCI factor: lower = more silent (inverted)
  const bsciFactor = Math.max(0, 1 - (bsci / config.tier1BsciMax));

  // CIPHER/market activity factor: lower = more silent
  const cipherFactor = Math.max(0, 1 - (marketActivity / config.tier1CipherMax));

  // Volatility factor: higher ATR = potential expansion before impulse
  const volatilityFactor = Math.min(1, Math.max(0, (atrPct - 50) / 50)); // normalized 0-1

  // 3. Check TIER conditions
  const bsciLow = bsci < config.tier1BsciMax;
  const cipherLow = marketActivity < config.tier1CipherMax;
  const atrHigh = atrPct > config.highAtrThreshold;

  const tier1Met = bsci < config.tier1BsciMax && marketActivity < config.tier1CipherMax;
  const tier2Met = bsci < config.tier2BsciMax && marketActivity < config.tier2CipherMax;

  // 4. Calculate silence score
  const silenceScore = bsciFactor * config.bsciWeight +
                       cipherFactor * config.cipherWeight +
                       volatilityFactor * config.volatilityWeight;

  // 5. Determine tier
  let tier: 'TIER_1' | 'TIER_2' | 'NONE' = 'NONE';
  let silenceAlertActive = false;

  if (tier2Met && atrHigh) {
    tier = 'TIER_2';
    silenceAlertActive = true;
  } else if (tier1Met) {
    tier = 'TIER_1';
    silenceAlertActive = silenceScore > 0.3;
  }

  // 6. Signal direction (based on what typically follows silence)
  // Silence before impulse - direction depends on OFI if available
  const signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = ofi 
    ? (ofi > 0.1 ? 'BULLISH' : ofi < -0.1 ? 'BEARISH' : 'NEUTRAL')
    : 'NEUTRAL';

  // 7. Confidence
  let confidence = 0;
  if (silenceAlertActive) {
    const conditionsMet = [bsciLow, cipherLow, tier1Met, tier2Met, atrHigh].filter(Boolean).length;
    confidence = Math.min(0.7, conditionsMet / 5 + 0.2);
  }

  // 8. Metadata
  metadata.bsci = Math.round(bsci * 1000) / 1000;
  metadata.cipherScore = Math.round(cipherScore * 1000) / 1000;
  metadata.marketActivity = Math.round(marketActivity * 1000) / 1000;
  metadata.atrPct = atrPct;
  metadata.bsciFactor = Math.round(bsciFactor * 1000) / 1000;
  metadata.cipherFactor = Math.round(cipherFactor * 1000) / 1000;
  metadata.volatilityFactor = Math.round(volatilityFactor * 1000) / 1000;
  metadata.config = config;

  return {
    silenceAlertActive,
    tier,
    silenceScore: Math.round(silenceScore * 1000) / 1000,
    bsciFactor,
    cipherFactor,
    volatilityFactor,
    conditions: {
      bsciLow,
      cipherLow,
      atrHigh,
      tier1Met,
      tier2Met,
    },
    metadata,
  };
}

/**
 * Detect PRE-IMPULSE from DetectorInput
 * Used for integration into runAllDetectors
 */
export function detectPreImpulseFromDetectorInput(
  input: DetectorInput,
  bsciValue: number = 0,
  atrPct: number = 50
): DetectorResult {
  const { ticker, ofi } = input;

  // Get all detector scores from metadata if available
  // In real flow, detectorScores is passed separately
  const detectorScores: Record<string, number> = {
    CIPHER: (input as any).cipherScore || 0,
    ENTANGLE: (input as any).entangleScore || 0,
    ATTRACTOR: (input as any).attractorScore || 0,
  };

  const result = detectPreImpulseSilence(detectorScores, bsciValue, atrPct);

  return {
    detector: 'PREIMPULSE',
    description: result.silenceAlertActive
      ? `PRE-IMPULSE ${result.tier} — BSCI ${bsciValue.toFixed(2)}, CIPHER ${detectorScores.CIPHER.toFixed(2)}, ATR ${atrPct}%`
      : result.tier === 'TIER_1'
        ? 'PRE-IMPULSE TIER_1 — раннее предупреждение'
        : 'PRE-IMPULSE — не обнаружен',
    score: result.silenceAlertActive ? result.silenceScore : 0,
    confidence: result.silenceAlertActive ? result.silenceScore * 0.8 : 0,
    signal,
    metadata: result.metadata,
  };
}