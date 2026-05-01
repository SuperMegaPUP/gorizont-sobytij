// ─── DISTRIBUTION DETECTOR (Q-7) ─────────────────────────────────────────
// TYPE_1: Pump & Dump - быстрый рост объёма + быстрое распределение
// TYPE_2: Stealth Distribution - скрытое распределение крупняка
//
// TYPE_1: volumeSpike + priceDrop + OFI_neg = PUMP_FAIL (распределение после пампа)
// TYPE_2: highVolume + lowPriceMove + rtOFI_divergence = STEALTH_DIST

import type { DetectorInput, DetectorResult } from './types';
import { clampScore, stalePenalty } from './guards';

const DIST_MIN_TRADES = 20;
const DIST_ABSOLUTE_MIN = 10;

// TYPE_1 thresholds
const TYPE1_VOLUME_SPIKE = 2.5;  // 2.5x average volume
const TYPE1_PRICE_DROP = 0.03;   // 3% price drop
const TYPE1_OFI_NEG = -0.1;      // negative OFI

// TYPE_2 thresholds
const TYPE2_RT_OFI_DIVERGENCE = 0.2;  // rtOFI vs price direction
const TYPE2_HIGH_VOLUME = 1.5;        // 1.5x average

export interface DistributionConfig {
  type1VolumeSpike: number;
  type1PriceDrop: number;
  type1OfiNeg: number;
  type2RtOfiDivergence: number;
  type2HighVolume: number;
}

export const DISTRIBUTION_DEFAULT_CONFIG: DistributionConfig = {
  type1VolumeSpike: TYPE1_VOLUME_SPIKE,
  type1PriceDrop: TYPE1_PRICE_DROP,
  type1OfiNeg: TYPE1_OFI_NEG,
  type2RtOfiDivergence: TYPE2_RT_OFI_DIVERGENCE,
  type2HighVolume: TYPE2_HIGH_VOLUME,
};

export interface DistributionResult {
  distributionActive: boolean;
  type: 'TYPE_1' | 'TYPE_2' | 'NONE';
  type1Score: number;
  type2Score: number;
  conditions: {
    volumeSpike: boolean;
    priceDrop: boolean;
    ofiNegative: boolean;
    rtOfiDivergence: boolean;
  };
}

/**
 * Q-7: Detect DISTRIBUTION patterns
 */
export function detectDistribution(
  input: DetectorInput,
  config: DistributionConfig = DISTRIBUTION_DEFAULT_CONFIG
): DistributionResult {
  const { trades, ofi, realtimeOFI } = input;
  const allTrades = trades || [];
  const nTrades = allTrades.length;

  if (nTrades < DIST_ABSOLUTE_MIN) {
    return {
      distributionActive: false,
      type: 'NONE',
      type1Score: 0,
      type2Score: 0,
      conditions: { volumeSpike: false, priceDrop: false, ofiNegative: false, rtOfiDivergence: false },
    };
  }

  // ─── TYPE_1: Pump & Dump Detection ─────────────────────────────────────
  // Взрыв объёма + падение цены + негативный OFI

  // Calculate average volume
  const volumes = allTrades.map(t => t.quantity);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / nTrades;
  const maxVolume = Math.max(...volumes);
  const volumeSpike = maxVolume / avgVolume;

  // Calculate price change
  const prices = allTrades.map(t => t.price).filter(p => p > 0);
  const startPrice = prices[0] || 0;
  const endPrice = prices[prices.length - 1] || 0;
  const priceChange = startPrice > 0 ? (endPrice - startPrice) / startPrice : 0;
  const priceDrop = priceChange < -config.type1PriceDrop;

  // OFI check
  const ofiNegative = (ofi || 0) < config.type1OfiNeg;

  // TYPE_1 score
  const type1Conditions = volumeSpike > config.type1VolumeSpike && priceDrop && ofiNegative;
  const type1Score = type1Conditions
    ? Math.min(1, (volumeSpike / config.type1VolumeSpike) * 0.4 + Math.abs(priceChange) * 10 * 0.3 + Math.abs(ofi || 0) * 0.3)
    : 0;

  // ─── TYPE_2: Stealth Distribution ───────────────────────────────────────
  // Высокий объём + низкое движение цены + расхождение rtOFI

  const priceRange = Math.max(...prices) - Math.min(...prices);
  const priceMovePct = startPrice > 0 ? priceRange / startPrice : 0;
  const highVolume = volumeSpike > config.type2HighVolume;
  const lowPriceMove = priceMovePct < 0.02; // <2% movement

  // rtOFI vs price direction divergence
  let rtOfiDivergence = false;
  if (realtimeOFI !== undefined) {
    const priceDir = priceChange > 0 ? 1 : priceChange < 0 ? -1 : 0;
    const ofiDir = realtimeOFI > 0.1 ? 1 : realtimeOFI < -0.1 ? -1 : 0;
    const divergence = priceDir !== 0 && ofiDir !== 0 && priceDir !== ofiDir;
    rtOfiDivergence = divergence && Math.abs(realtimeOFI) > config.type2RtOfiDivergence;
  }

  // TYPE_2 score
  const type2Conditions = highVolume && lowPriceMove && rtOfiDivergence;
  const type2Score = type2Conditions
    ? Math.min(1, volumeSpike * 0.2 + 0.3 + Math.abs(realtimeOFI || 0) * 0.5)
    : 0;

  // ─── Determine result ──────────────────────────────────────────────────
  const distributionActive = type1Score > 0.3 || type2Score > 0.3;
  let type: 'TYPE_1' | 'TYPE_2' | 'NONE' = 'NONE';

  if (type1Score > type2Score && type1Score > 0.3) {
    type = 'TYPE_1';
  } else if (type2Score > 0.3) {
    type = 'TYPE_2';
  }

  return {
    distributionActive,
    type,
    type1Score: Math.round(type1Score * 1000) / 1000,
    type2Score: Math.round(type2Score * 1000) / 1000,
    conditions: {
      volumeSpike: volumeSpike > config.type1VolumeSpike,
      priceDrop,
      ofiNegative,
      rtOfiDivergence,
    },
  };
}

/**
 * Detect DISTRIBUTION from DetectorInput
 */
export function detectDistributionFromInput(input: DetectorInput): DetectorResult {
  const { ticker, ofi } = input;
  const result = detectDistribution(input);

  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (result.distributionActive) {
    if (result.type === 'TYPE_1') signal = 'BEARISH'; // Pump & dump = bearish
    else if (result.type === 'TYPE_2') signal = 'BEARISH'; // Distribution = bearish
  }

  return {
    detector: 'DISTRIBUTION',
    description: result.distributionActive
      ? `DISTRIBUTION ${result.type} — volSpike=${result.conditions.volumeSpike}, priceDrop=${result.conditions.priceDrop}, rtOFIdiv=${result.conditions.rtOfiDivergence}`
      : 'DISTRIBUTION — не обнаружен',
    score: result.distributionActive ? Math.max(result.type1Score, result.type2Score) : 0,
    confidence: result.distributionActive ? 0.6 : 0,
    signal,
    metadata: {
      type1Score: result.type1Score,
      type2Score: result.type2Score,
      type: result.type,
    },
  };
}