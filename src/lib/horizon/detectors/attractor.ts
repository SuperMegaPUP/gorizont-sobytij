// ─── ATTRACTOR — Аттрактор (цена «прилипает» к уровню) ────────────────────
// Цена кластеризуется вокруг определённого уровня — как аттрактор
// в динамических системах. Это уровень поддержки/сопротивления.
//
// Признаки:
// - Высокая частота сделок на одной цене (мода ценового ряда)
// - Цена постоянно возвращается к уровню (mean reversion)
// - Узкий диапазон (low volatility) вокруг уровня
//
// Score: clusteringStrength × meanReversion × levelSignificance

import type { DetectorInput, DetectorResult } from './types';

export function detectAttractor(input: DetectorInput): DetectorResult {
  const { prices, recentTrades } = input;
  const metadata: Record<string, number | string | boolean> = {};

  if (prices.length < 8 || recentTrades.length < 5) {
    return {
      detector: 'ATTRACTOR', description: 'Аттрактор — цена прилипает к уровню',
      score: 0, confidence: 0, signal: 'NEUTRAL', metadata: { insufficientData: true },
    };
  }

  // 1. Price clustering: находим цену-аттрактор
  const priceRounded = prices.map(p => Math.round(p * 100) / 100);
  const freq: Record<string, number> = {};
  for (const p of priceRounded) {
    freq[p] = (freq[p] || 0) + 1;
  }
  let attractorPrice = 0;
  let maxFreq = 0;
  for (const [p, f] of Object.entries(freq)) {
    if (f > maxFreq) { maxFreq = f; attractorPrice = Number(p); }
  }
  const clusteringStrength = maxFreq / prices.length;
  metadata.attractorPrice = attractorPrice;
  metadata.clusteringStrength = Math.round(clusteringStrength * 1000) / 1000;
  metadata.maxFreq = maxFreq;

  // 2. Mean reversion: цена возвращается к аттрактору
  // Считаем сколько раз цена пересекла аттрактор (вверх-вниз)
  let crossings = 0;
  for (let i = 1; i < prices.length; i++) {
    const prevDiff = prices[i - 1] - attractorPrice;
    const currDiff = prices[i] - attractorPrice;
    if (prevDiff * currDiff < 0) crossings++; // пересечение
  }
  const crossingRate = crossings / (prices.length - 1);
  metadata.crossings = crossings;
  metadata.crossingRate = Math.round(crossingRate * 1000) / 1000;

  // Mean reversion score: высокая частота пересечений = цена колеблется вокруг уровня
  const meanReversionScore = crossingRate > 0.4 ? 1
    : crossingRate > 0.25 ? 0.7
    : crossingRate > 0.15 ? 0.4
    : crossingRate > 0.05 ? 0.2 : 0;

  // 3. Level significance: аттрактор в середине диапазона (не край)
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice;
  const attractorPosition = range > 0
    ? (attractorPrice - minPrice) / range : 0.5; // 0=низ, 1=верх, 0.5=середина
  // Аттрактор более значим если он не на краю
  const levelSignificance = 1 - Math.abs(attractorPosition - 0.5) * 2;
  metadata.attractorPosition = Math.round(attractorPosition * 100) / 100;
  metadata.priceRange = Math.round(range * 1000) / 1000;

  // 4. Volatility around attractor
  const distances = prices.map(p => Math.abs(p - attractorPrice));
  const avgDistance = distances.reduce((s, d) => s + d, 0) / distances.length;
  const normDistance = range > 0 ? avgDistance / range : 1;
  // Малый normDistance = цена близко к аттрактору
  const proximity = 1 - normDistance;
  metadata.proximity = Math.round(proximity * 1000) / 1000;

  // Score
  const clusterScore = clusteringStrength > 0.4 ? 1
    : clusteringStrength > 0.25 ? 0.7
    : clusteringStrength > 0.15 ? 0.4 : 0.1;

  const sigScore = levelSignificance > 0.6 ? 1
    : levelSignificance > 0.3 ? 0.6 : 0.2;

  const proxScore = proximity > 0.7 ? 1 : proximity > 0.5 ? 0.7 : proximity > 0.3 ? 0.4 : 0.1;

  const rawScore = clusterScore * 0.35 + meanReversionScore * 0.3 +
    sigScore * 0.15 + proxScore * 0.2;
  const score = Math.min(1, Math.max(0, rawScore));

  // Signal: текущая позиция относительно аттрактора
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2) {
    const currentPrice = prices[prices.length - 1];
    const diff = currentPrice - attractorPrice;
    // Если ниже аттрактора → ожидаем возврат вверх (BULLISH)
    // Если выше → ожидаем возврат вниз (BEARISH)
    signal = diff < -range * 0.1 ? 'BULLISH'
      : diff > range * 0.1 ? 'BEARISH' : 'NEUTRAL';
  }

  const confidence = score > 0.2
    ? Math.min(1, (clusterScore + meanReversionScore) / 1.5)
    : 0;

  return {
    detector: 'ATTRACTOR',
    description: 'Аттрактор — цена прилипает к уровню',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
