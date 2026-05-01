// ─── ICEBERG DIRECTION DETECTOR (Q-4) ─────────────────────────────────────
// Эвристика определения направления айсбергов:
//   - Большие ордера на bid = накопление (BULLISH)
//   - Большие ордера на ask = распределение (BEARISH)
//   - Паттерн: частые ордера на одном уровне + низкая ликвидность в стакане
//
// Формула: icebergDirection = Σ(bid_volume) - Σ(ask_volume) normalized

import type { DetectorInput, DetectorResult } from './types';
import { clampScore } from './guards';

const ICEBERG_MIN_LEVELS = 3;
const VOLUME_SPIKE_THRESHOLD = 2.0; // Объём в 2x+ от среднего = потенциальный айсберг
const DIRECTION_WEIGHT_BID = 0.6;   // Bid volume weighted higher
const DIRECTION_WEIGHT_ASK = 0.4;

export interface IcebergConfig {
  minLevels: number;
  volumeSpikeThreshold: number;
  bidWeight: number;
  askWeight: number;
}

export const ICEBERG_DEFAULT_CONFIG: IcebergConfig = {
  minLevels: ICEBERG_MIN_LEVELS,
  volumeSpikeThreshold: VOLUME_SPIKE_THRESHOLD,
  bidWeight: DIRECTION_WEIGHT_BID,
  askWeight: DIRECTION_WEIGHT_ASK,
};

export interface IcebergResult {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  icebergScore: number;
  bidVolumeTotal: number;
  askVolumeTotal: number;
  bidLevels: number;
  askLevels: number;
  maxBidLevel: number;
  maxAskLevel: number;
  conditions: {
    hasMinLevels: boolean;
    hasBidSpike: boolean;
    hasAskSpike: boolean;
  };
}

/**
 * Q-4: Detect ICEBERG direction from orderbook
 */
export function detectIcebergDirection(
  input: DetectorInput,
  config: IcebergConfig = ICEBERG_DEFAULT_CONFIG
): IcebergResult {
  const { orderbook, ofi } = input;
  const bids = orderbook?.bids || [];
  const asks = orderbook?.asks || [];

  // 1. Calculate volumes
  const bidVolumes = bids.map(l => l.quantity);
  const askVolumes = asks.map(l => l.quantity);

  const bidVolumeTotal = bidVolumes.reduce((a, b) => a + b, 0);
  const askVolumeTotal = askVolumes.reduce((a, b) => a + b, 0);

  // 2. Calculate average volumes
  const avgBidVol = bidVolumes.length > 0 ? bidVolumeTotal / bidVolumes.length : 0;
  const avgAskVol = askVolumes.length > 0 ? askVolumeTotal / askVolumes.length : 0;

  // 3. Detect spikes (potential iceberg levels)
  const bidSpikes = bidVolumes.filter(v => avgBidVol > 0 && v / avgBidVol > config.volumeSpikeThreshold).length;
  const askSpikes = askVolumes.filter(v => avgAskVol > 0 && v / avgAskVol > config.volumeSpikeThreshold).length;

  // 4. Find max levels (where biggest orders are)
  const maxBidIdx = bidVolumes.indexOf(Math.max(...bidVolumes));
  const maxAskIdx = askVolumes.indexOf(Math.max(...askVolumes));

  // 5. Calculate direction score
  let directionScore = 0;
  if (bidVolumeTotal > 0 || askVolumeTotal > 0) {
    // Weighted difference: bids more important for accumulation
    const bidNorm = config.bidWeight * (bidVolumeTotal / (bidVolumeTotal + askVolumeTotal || 1));
    const askNorm = config.askWeight * (askVolumeTotal / (bidVolumeTotal + askVolumeTotal || 1));
    directionScore = bidNorm - askNorm;
  }

  // 6. Determine direction
  let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (directionScore > 0.2) direction = 'BULLISH';
  else if (directionScore < -0.2) direction = 'BEARISH';

  // 7. Iceberg score based on spike count and direction
  const spikeCount = bidSpikes + askSpikes;
  const hasMinLevels = bids.length >= config.minLevels && asks.length >= config.minLevels;

  let icebergScore = 0;
  if (hasMinLevels && spikeCount > 0) {
    icebergScore = Math.min(1, (spikeCount / 5) * Math.abs(directionScore));
  }

  return {
    direction,
    icebergScore: Math.round(icebergScore * 1000) / 1000,
    bidVolumeTotal,
    askVolumeTotal,
    bidLevels: bids.length,
    askLevels: asks.length,
    maxBidLevel: maxBidIdx + 1,
    maxAskLevel: maxAskIdx + 1,
    conditions: {
      hasMinLevels,
      hasBidSpike: bidSpikes > 0,
      hasAskSpike: askSpikes > 0,
    },
  };
}

/**
 * Detect ICEBERG from DetectorInput
 */
export function detectIcebergFromInput(input: DetectorInput): DetectorResult {
  const result = detectIcebergDirection(input);

  return {
    detector: 'ICEBERG',
    description: result.direction !== 'NEUTRAL'
      ? `ICEBERG ${result.direction} — bid ${result.bidVolumeTotal} vs ask ${result.askVolumeTotal}, spikes ${result.conditions.hasBidSpike ? 'BID' : ''}${result.conditions.hasAskSpike ? 'ASK' : ''}`
      : 'ICEBERG — не обнаружен',
    score: result.icebergScore,
    confidence: result.icebergScore * 0.8,
    signal: result.direction,
    metadata: {
      bidVolume: result.bidVolumeTotal,
      askVolume: result.askVolumeTotal,
      bidLevels: result.bidLevels,
      askLevels: result.askLevels,
    },
  };
}