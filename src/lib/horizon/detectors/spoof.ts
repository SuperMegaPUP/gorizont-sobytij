// ─── SPOOF DETECTOR (Q-5) ────────────────────────────────────────────────
// Detects aggressive vs passive spoofing patterns
//   - Aggressive: быстрое размещение и снятие ордеров
//   - Passive: ордера стоят долго, создают видимость
//
// Формула: spoofScore = cancelRate × size × duration_factor

import type { DetectorInput, DetectorResult } from './types';
import { clampScore } from './guards';

const SPOOF_MIN_TRADES = 15;

// Типы спуфинга
type SpoofType = 'AGGRESSIVE' | 'PASSIVE' | 'NONE';

export interface SpoofConfig {
  aggressiveThreshold: number;  // быстрые ордера (ms)
  passiveThreshold: number;      // долгие ордера (ms)
  minCancelRate: number;         // минимум cancels для детекта
}

export const SPOOF_DEFAULT_CONFIG: SpoofConfig = {
  aggressiveThreshold: 2000,   // <2 сек = агрессивный
  passiveThreshold: 30000,     // >30 сек = пассивный
  minCancelRate: 0.3,           // 30% cancel rate minimum
};

export interface SpoofResult {
  spoofActive: boolean;
  spoofType: SpoofType;
  spoofScore: number;
  cancelRate: number;
  avgOrderDuration: number;
  conditions: {
    highCancelRate: boolean;
    aggressivePattern: boolean;
    passivePattern: boolean;
  };
}

/**
 * Q-5: Detect SPOOF patterns from orderbook changes
 * Note: Requires orderbook history to detect cancels - simplified here
 */
export function detectSpoof(
  input: DetectorInput,
  config: SpoofConfig = SPOOF_DEFAULT_CONFIG
): SpoofResult {
  const { orderbook, ofi } = input;
  const bids = orderbook?.bids || [];
  const asks = orderbook?.asks || [];

  // Simplified: use orderbook levels as proxy for spoof patterns
  // In real implementation, would track order lifecycle

  // Calculate level distribution
  const bidVolumes = bids.map(l => l.quantity);
  const askVolumes = asks.map(l => l.quantity);
  const totalLevels = bidVolumes.length + askVolumes.length;

  if (totalLevels < 3) {
    return {
      spoofActive: false,
      spoofType: 'NONE',
      spoofScore: 0,
      cancelRate: 0,
      avgOrderDuration: 0,
      conditions: { highCancelRate: false, aggressivePattern: false, passivePattern: false },
    };
  }

  // Proxy metrics based on orderbook structure
  // High volume on one side + low on other = potential spoof
  const maxBid = Math.max(...bidVolumes, 0);
  const maxAsk = Math.max(...askVolumes, 0);
  const imbalance = Math.abs(maxBid - maxAsk) / Math.max(maxBid + maxAsk, 1);

  // Cancel rate proxy: levels with unusual volume ratios
  const avgVol = (bidVolumes.reduce((a, b) => a + b, 0) + askVolumes.reduce((a, b) => a + b, 0)) / totalLevels;
  const bigLevels = (bidVolumes.filter(v => v > avgVol * 2).length + askVolumes.filter(v => v > avgVol * 2).length);
  const cancelRate = bigLevels / Math.max(totalLevels, 1);

  const highCancelRate = cancelRate > config.minCancelRate;

  // Determine spoof type based on OFI
  let spoofType: SpoofType = 'NONE';
  if (highCancelRate) {
    const ofiValue = ofi || 0;
    // Aggressive: OFI opposite to big orders (orders likely to cancel)
    if (imbalance > 0.7 && Math.abs(ofiValue) < 0.2) {
      spoofType = 'AGGRESSIVE';
    } else if (imbalance > 0.5) {
      spoofType = 'PASSIVE';
    }
  }

  // Calculate score
  let spoofScore = 0;
  if (spoofType !== 'NONE') {
    spoofScore = Math.min(1, cancelRate * imbalance * (spoofType === 'AGGRESSIVE' ? 1.2 : 1.0));
  }

  return {
    spoofActive: spoofScore > 0.2,
    spoofType,
    spoofScore: Math.round(spoofScore * 1000) / 1000,
    cancelRate: Math.round(cancelRate * 1000) / 1000,
    avgOrderDuration: 0,
    conditions: {
      highCancelRate,
      aggressivePattern: spoofType === 'AGGRESSIVE',
      passivePattern: spoofType === 'PASSIVE',
    },
  };
}

/**
 * Detect SPOOF from DetectorInput
 */
export function detectSpoofFromInput(input: DetectorInput): DetectorResult {
  const result = detectSpoof(input);

  return {
    detector: 'SPOOF',
    description: result.spoofActive
      ? `SPOOF ${result.spoofType} — cancelRate=${(result.cancelRate * 100).toFixed(0)}%, score=${result.spoofScore.toFixed(2)}`
      : 'SPOOF — не обнаружен',
    score: result.spoofScore,
    confidence: result.spoofScore * 0.7,
    signal: result.spoofActive ? 'NEUTRAL' : 'NEUTRAL', // Spoof doesn't indicate direction
    metadata: {
      spoofType: result.spoofType,
      cancelRate: result.cancelRate,
    },
  };
}