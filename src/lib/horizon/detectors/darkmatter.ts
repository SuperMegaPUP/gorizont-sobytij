// ─── DARKMATTER — Скрытая ликвидность (айсберги) ──────────────────────────
// Обнаружение скрытых ордеров: объём на уровне резко меняется без
// видимого ордера в стакане, или стакан не отражает реальный поток.
//
// Признаки:
// - Большой объём на сделках, но малый объём в стакане → айсберг
// - Отношение trade volume / orderbook volume > порога
// - CumDelta direction ≠ OFI direction → скрытый поток
//
// Score: hiddenRatio × deltaDiscrepancy × volumeSurprise

import type { DetectorInput, DetectorResult } from './types';

export function detectDarkmatter(input: DetectorInput): DetectorResult {
  const { orderbook, cumDelta, ofi, recentTrades } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // 1. Hidden ratio: trade volume vs visible orderbook volume
  const visibleBidVol = orderbook.bids.reduce((s, l) => s + l.quantity, 0);
  const visibleAskVol = orderbook.asks.reduce((s, l) => s + l.quantity, 0);
  const visibleTotal = visibleBidVol + visibleAskVol;
  const recentTradeVol = recentTrades.reduce((s, t) => s + t.quantity, 0);
  const hiddenRatio = visibleTotal > 0 ? recentTradeVol / visibleTotal : 0;
  metadata.hiddenRatio = Math.round(hiddenRatio * 100) / 100;

  // 2. Delta-OFI discrepancy: CumDelta direction ≠ OFI direction
  // CumDelta > 0 (больше покупок) но OFI < 0 (стакан продавливает) = скрытая покупка
  const deltaSign = Math.sign(cumDelta.delta);
  const ofiSign = Math.sign(ofi);
  const deltaDiscrepancy = deltaSign !== 0 && ofiSign !== 0 && deltaSign !== ofiSign ? 1 : 0;
  metadata.deltaDiscrepancy = deltaDiscrepancy;

  // 3. Volume surprise: большой объём на одной цене (айсберг-паттерн)
  const priceFreq = new Map<number, number>();
  for (const t of recentTrades) {
    const rounded = Math.round(t.price * 100) / 100;
    priceFreq.set(rounded, (priceFreq.get(rounded) || 0) + t.quantity);
  }
  let maxPriceVol = 0;
  for (const vol of priceFreq.values()) maxPriceVol = Math.max(maxPriceVol, vol);
  const volumeSurprise = recentTradeVol > 0 ? maxPriceVol / recentTradeVol : 0;
  metadata.volumeSurprise = Math.round(volumeSurprise * 100) / 100;
  metadata.uniquePrices = priceFreq.size;

  // 4. Orderbook thinness: малая глубина при активных сделках
  const avgLevelVol = (orderbook.bids.length + orderbook.asks.length) > 0
    ? visibleTotal / (orderbook.bids.length + orderbook.asks.length)
    : 0;
  const thinness = recentTrades.length > 0 && avgLevelVol > 0
    ? (recentTradeVol / recentTrades.length) / avgLevelVol
    : 0;
  metadata.thinness = Math.round(thinness * 100) / 100;

  // 5. Score calculation
  // hiddenRatio > 0.5 → significant, > 2 → strong
  const hiddenScore = Math.min(1, Math.max(0, hiddenRatio / 2));
  // deltaDiscrepancy is binary
  const discrepancyScore = deltaDiscrepancy * 0.7;
  // volumeSurprise > 0.3 → single price dominates
  const surpriseScore = Math.min(1, Math.max(0, (volumeSurprise - 0.2) / 0.5));
  // thinness > 1 → trade avg > orderbook avg
  const thinnessScore = Math.min(1, Math.max(0, (thinness - 0.5) / 2));

  const rawScore = hiddenScore * 0.35 + discrepancyScore * 0.25 +
    surpriseScore * 0.25 + thinnessScore * 0.15;
  const score = Math.min(1, Math.max(0, rawScore));

  // Signal direction: based on CumDelta if hidden
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2 && deltaDiscrepancy) {
    signal = cumDelta.delta > 0 ? 'BULLISH' : 'BEARISH';
  } else if (score > 0.2) {
    signal = ofi > 0.1 ? 'BULLISH' : ofi < -0.1 ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.2
    ? Math.min(1, (hiddenScore + discrepancyScore + surpriseScore) / 2)
    : 0;

  return {
    detector: 'DARKMATTER',
    description: 'Скрытая ликвидность — айсберги в стакане',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
