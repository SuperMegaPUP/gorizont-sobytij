// ─── ROTATION DETECTOR (Q-11) ─────────────────────────────────────────────
// Определяет перекладку позиции крупняка:
//   - Айсберги в одну сторону (BUY/SELL крупные ордера)
//   - Шлифовщик в другую сторону (мелкие ордера противоположного направления)
//   - Итог: крупняк накапливает позицию в одном направлении, но маскирует её мелкими ордерами
//
// Формула: rotationScore = icebergScore × 0.5 + grinderScore × 0.3 + divergenceScore × 0.2

import type { DetectorInput, DetectorResult } from './types';
import { clampScore, stalePenalty } from './guards';
import { calcTradeOFI, type TradeOFIResult } from '../calculations/ofi';

const ROTATION_MIN_TRADES = 20;
const ROTATION_ABSOLUTE_MIN = 10;

// ─── Detect Iceberg ───────────────────────────────────────────────────────
// Ищет крупные ордера (айсберги) - аномально большие объёмы на одной цене
function detectIceberg(trades: Array<{ price: number; quantity: number; direction?: string }>): number {
  if (trades.length < 3) return 0;

  const priceMap = new Map<number, { volume: number; count: number }>();
  for (const t of trades) {
    const existing = priceMap.get(t.price) || { volume: 0, count: 0 };
    existing.volume += t.quantity;
    existing.count += 1;
    priceMap.set(t.price, existing);
  }

  // Средний объём на уровень
  const volumes = Array.from(priceMap.values()).map(p => p.volume);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

  // Находим аномально большие объёмы (2x+ от среднего)
  const maxVolume = Math.max(...volumes);
  const icebergRatio = avgVolume > 0 ? maxVolume / avgVolume : 0;

  // Score = насколько айсберг выделяется
  return Math.min(1, Math.max(0, (icebergRatio - 1) / 2));
}

// ─── Detect Grinder ────────────────────────────────────────────────────────
// Ищет "шлифовщика" - частые мелкие ордера в одном направлении
// Это маскировка - крупняк продаёт/покупает мелкими порциями
function detectGrinder(trades: Array<{ price: number; quantity: number; direction?: string }>): number {
  if (trades.length < 5) return 0;

  const recentTrades = trades.slice(-20);
  const smallTrades = recentTrades.filter(t => t.quantity < 10); // small = < 10 contracts

  if (smallTrades.length < 3) return 0;

  // Проверяем направление мелких сделок
  let buyCount = 0, sellCount = 0;
  for (const t of smallTrades) {
    const dir = (t.direction || '').toUpperCase();
    if (dir.includes('BUY') || dir === 'B' || dir === '1') buyCount++;
    else if (dir.includes('SELL') || dir === 'S' || dir === '-1') sellCount++;
  }

  const total = buyCount + sellCount;
  if (total < 3) return 0;

  const dominance = Math.abs(buyCount - sellCount) / total;
  return dominance > 0.6 ? dominance : 0;
}

// ─── Detect Direction Divergence ───────────────────────────────────────────
// Проверяет: OFI показывает одно направление, но мелкие сделки в другую
function detectDivergence(
  ofi: number,
  smallTrades: Array<{ direction?: string }>
): number {
  if (smallTrades.length < 3) return 0;

  // Direction from small trades
  let buyCount = 0, sellCount = 0;
  for (const t of smallTrades) {
    const dir = (t.direction || '').toUpperCase();
    if (dir.includes('BUY') || dir === 'B' || dir === '1') buyCount++;
    else if (dir.includes('SELL') || dir === 'S' || dir === '-1') sellCount++;
  }

  const smallDir = buyCount > sellCount ? 1 : (sellCount > buyCount ? -1 : 0);
  const ofiSign = Math.sign(ofi);

  // Divergence: OFI и мелкие сделки в разные стороны
  if (ofiSign !== 0 && smallDir !== 0 && ofiSign !== smallDir) {
    return Math.min(1, Math.abs(ofi) + 0.3);
  }

  return 0;
}

// ─── Calculate Iceberg Direction ──────────────────────────────────────────
function getIcebergDirection(trades: Array<{ price: number; quantity: number; direction?: string }>): number {
  const priceMap = new Map<number, { volume: number; buyVol: number; sellVol: number }>();
  for (const t of trades) {
    const existing = priceMap.get(t.price) || { volume: 0, buyVol: 0, sellVol: 0 };
    existing.volume += t.quantity;
    const dir = (t.direction || '').toUpperCase();
    if (dir.includes('BUY') || dir === 'B' || dir === '1') existing.buyVol += t.quantity;
    else if (dir.includes('SELL') || dir === 'S' || dir === '-1') existing.sellVol += t.quantity;
    priceMap.set(t.price, existing);
  }

  let totalBuyVol = 0, totalSellVol = 0;
  for (const p of priceMap.values()) {
    totalBuyVol += p.buyVol;
    totalSellVol += p.sellVol;
  }

  // Return direction: +1 = buy iceberg, -1 = sell iceberg
  if (totalBuyVol > totalSellVol * 1.5) return 1;
  if (totalSellVol > totalBuyVol * 1.5) return -1;
  return 0;
}

// ─── Main Detector ─────────────────────────────────────────────────────────

export function detectRotation(input: DetectorInput): DetectorResult {
  const { ticker, trades, recentTrades, ofi, tradeOFI } = input;
  const metadata: Record<string, number | string | boolean> = {};

  const allTrades = trades && trades.length > 0 ? trades : (recentTrades || []);
  const nTrades = allTrades.length;

  const tradeWeight = nTrades >= ROTATION_ABSOLUTE_MIN
    ? Math.min(1, nTrades / ROTATION_MIN_TRADES)
    : 0;

  if (nTrades < ROTATION_ABSOLUTE_MIN) {
    metadata.insufficientData = true;
    metadata.guardTriggered = 'insufficient_trades';
  }
  metadata.nTrades = nTrades;

  // Stale weight
  let staleWeight = 1;
  if (input.staleData && input.staleMinutes) {
    staleWeight = stalePenalty(input.staleMinutes);
    if (input.staleMinutes > 240) {
      metadata.guardTriggered = 'stale_data';
    }
  }
  metadata.staleWeight = Math.round(staleWeight * 1000) / 1000;

  // Calculate components
  const icebergScore = detectIceberg(allTrades);
  const grinderScore = detectGrinder(allTrades);
  const divergenceScore = detectDivergence(ofi || 0, allTrades.slice(-10));

  // Get directions
  const icebergDir = getIcebergDirection(allTrades);

  // Calculate direction from OFI
  const ofiSign = Math.sign(ofi || 0);

  // Determine rotation direction
  let rotationDir: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (icebergDir !== 0) {
    rotationDir = icebergDir > 0 ? 'BULLISH' : 'BEARISH';
  } else if (grinderScore > 0.3) {
    // Grinder direction from small trades
    const smallTrades = allTrades.filter(t => t.quantity < 10);
    let buyCount = 0, sellCount = 0;
    for (const t of smallTrades) {
      const dir = (t.direction || '').toUpperCase();
      if (dir.includes('BUY') || dir === 'B' || dir === '1') buyCount++;
      else if (dir.includes('SELL') || dir === 'S' || dir === '-1') sellCount++;
    }
    if (buyCount > sellCount) rotationDir = 'BULLISH';
    else if (sellCount > buyCount) rotationDir = 'BEARISH';
  }

  // Weighted score
  const baseScore = icebergScore * 0.5 + grinderScore * 0.3 + divergenceScore * 0.2;

  // Confidence based on multiple signals
  const signals = [icebergScore > 0.1, grinderScore > 0.1, divergenceScore > 0.1].filter(Boolean).length;
  const confidence = signals >= 2 ? Math.min(0.8, baseScore * 1.5) : 0;

  const rawScore = baseScore * tradeWeight * staleWeight;
  const score = clampScore(rawScore);

  // Metadata
  metadata.icebergScore = Math.round(icebergScore * 1000) / 1000;
  metadata.grinderScore = Math.round(grinderScore * 1000) / 1000;
  metadata.divergenceScore = Math.round(divergenceScore * 1000) / 1000;
  metadata.icebergDirection = icebergDir;
  metadata.ofiSign = ofiSign;
  metadata.signals = signals;

  return {
    detector: 'ROTATION',
    description: score > 0.1
      ? `Ротация — айсберги ${icebergDir > 0 ? 'BUY' : icebergDir < 0 ? 'SELL' : '?'}, шлифовщик ${(grinderScore * 100).toFixed(0)}%`
      : 'Ротация — перекладка позиции не обнаружена',
    score,
    confidence,
    signal: rotationDir,
    metadata,
  };
}