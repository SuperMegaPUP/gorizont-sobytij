// ─── GRAVITON — Гравитационная линза ──────────────────────────────────────
// Крупный игрок «стягивает» объём к себе — как чёрная дыра искривляет
// пространство. OFI multi-level показывает концентрацию на ближних уровнях.
//
// Признаки:
// - OFIByLevel: ближние уровни >> дальние (асимметрия)
// - WeightedOFI >> SimpleOFI (ближние уровни доминируют)
// - Бид/аск объём резко несбалансирован на лучшем уровне
//
// Score: lensingRatio × concentration × directionalBias
//
// v5.0: Trade-based OFI fallback — когда orderbook пуст (ДСВД выходные),
// используем tradeOFI для lensing ratio и directional bias

import type { DetectorInput, DetectorResult } from './types';
import { calcOFIByLevel } from '../calculations/ofi';

export function detectGraviton(input: DetectorInput): DetectorResult {
  const { orderbook, ofi, weightedOFI, tradeOFI } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // v4.1.2: Stale data → нет аномалии (стакан из прошлой сессии — не актуален)
  if (input.staleData) {
    return {
      detector: 'GRAVITON',
      description: 'Гравитационная линза (устаревшие данные)',
      score: 0, confidence: 0, signal: 'NEUTRAL',
      metadata: { insufficientData: true, staleData: true, staleMinutes: input.staleMinutes ?? 0 },
    };
  }

  const obIsEmpty = orderbook.bids.length === 0 && orderbook.asks.length === 0;

  // ─── Режим 1: Нет стакана — используем Trade-based OFI ────────────────
  // На выходных (ДСВД) ISS возвращает HTML для orderbook, но trades свежие.
  // tradeOFI даёт direction + weighted direction → можем считать lensing ratio
  if (obIsEmpty) {
    // Нужны сделки для расчёта
    if (!tradeOFI || (tradeOFI.buyCount + tradeOFI.sellCount) < 5) {
      metadata.insufficientData = true;
      metadata.tradeOFI = true;
      return {
        detector: 'GRAVITON',
        description: 'Гравитационная линза — нет стакана и мало сделок для tradeOFI',
        score: 0,
        confidence: 0,
        signal: 'NEUTRAL',
        metadata,
      };
    }

    // Lensing ratio: weightedTradeOFI / (|tradeOFI| + ε)
    // Если weighted >> simple → свежие сделки доминируют → крупный игрок активен сейчас
    const tradeOfiSimple = tradeOFI.ofi;
    const tradeOfiWeighted = tradeOFI.weightedOFI;
    const lensingRatio = Math.abs(tradeOfiWeighted) / (Math.abs(tradeOfiSimple) + 0.01);
    metadata.lensingRatio = Math.round(lensingRatio * 100) / 100;
    metadata.ofiSource = 'trades';

    // Concentration: доля покупок/продаж среди недавних сделок
    // nearTermOFI показывает "сейчас" лучше, чем общий OFI
    const nearTermConcentration = Math.abs(tradeOFI.nearTermOFI);
    metadata.nearTermConcentration = Math.round(nearTermConcentration * 1000) / 1000;

    // Trade intensity ratio: buyCount / (buyCount + sellCount)
    const totalTrades = tradeOFI.buyCount + tradeOFI.sellCount;
    const tradeImbalance = totalTrades > 0
      ? Math.abs(tradeOFI.buyCount - tradeOFI.sellCount) / totalTrades
      : 0;
    metadata.tradeImbalance = Math.round(tradeImbalance * 1000) / 1000;

    // Score calculation (упрощённый для trade-based режима)
    const lensingScore = Math.min(1, Math.max(0, (lensingRatio - 1) / 3));
    const concentrationScore = Math.min(1, Math.max(0, (nearTermConcentration - 0.15) / 0.5));
    const imbalanceScore = Math.min(1, Math.max(0, (tradeImbalance - 0.1) / 0.5));

    const rawScore = lensingScore * 0.4 + concentrationScore * 0.35 + imbalanceScore * 0.25;
    const score = Math.min(1, Math.max(0, rawScore));

    // Confidence ниже в trade-based режиме (нет стакана → менее точно)
    const agreement = [lensingScore, concentrationScore, imbalanceScore]
      .filter(s => s > 0.3).length / 3;
    const confidence = score > 0.2 ? Math.min(0.8, agreement * 1.2) : 0; // макс 0.8 без стакана

    // Direction
    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (score > 0.2) {
      signal = tradeOfiSimple > 0.1 ? 'BULLISH' : tradeOfiSimple < -0.1 ? 'BEARISH' : 'NEUTRAL';
    }

    return {
      detector: 'GRAVITON',
      description: 'Гравитационная линза — крупный игрок (trade-based OFI, нет стакана)',
      score: Math.round(score * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      signal,
      metadata,
    };
  }

  // ─── Режим 2: Минимум 2 уровня с каждой стороны — полноценный анализ ──
  if (orderbook.bids.length < 2 || orderbook.asks.length < 2) {
    metadata.insufficientData = true;
    return {
      detector: 'GRAVITON',
      description: 'Гравитационная линза — мало уровней стакана',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  // 1. Lensing ratio: weightedOFI / (|simpleOFI| + ε)
  // Если weighted >> simple → ближние уровни доминируют
  const lensingRatio = Math.abs(weightedOFI) / (Math.abs(ofi) + 0.01);
  metadata.lensingRatio = Math.round(lensingRatio * 100) / 100;

  // 2. Concentration: доля объёма на лучшем уровне vs общий
  const bestBidVol = orderbook.bids.length > 0 ? orderbook.bids[0].quantity : 0;
  const bestAskVol = orderbook.asks.length > 0 ? orderbook.asks[0].quantity : 0;
  const totalBidVol = orderbook.bids.reduce((s, l) => s + l.quantity, 0);
  const totalAskVol = orderbook.asks.reduce((s, l) => s + l.quantity, 0);
  const bidConcentration = totalBidVol > 0 ? bestBidVol / totalBidVol : 0;
  const askConcentration = totalAskVol > 0 ? bestAskVol / totalAskVol : 0;
  const maxConcentration = Math.max(bidConcentration, askConcentration);
  metadata.bidConcentration = Math.round(bidConcentration * 1000) / 1000;
  metadata.askConcentration = Math.round(askConcentration * 1000) / 1000;

  // 3. Level asymmetry: OFI на ближних уровнях vs дальних
  const levels = calcOFIByLevel(orderbook);
  const nearLevels = levels.slice(0, Math.ceil(levels.length / 2));
  const farLevels = levels.slice(Math.ceil(levels.length / 2));
  const nearAvg = nearLevels.length > 0
    ? nearLevels.reduce((s, v) => s + Math.abs(v), 0) / nearLevels.length
    : 0;
  const farAvg = farLevels.length > 0
    ? farLevels.reduce((s, v) => s + Math.abs(v), 0) / farLevels.length
    : 0;
  const levelAsymmetry = nearAvg / (farAvg + 0.01);
  metadata.levelAsymmetry = Math.round(levelAsymmetry * 100) / 100;

  // 4. Directional bias
  const directionalBias = ofi; // [-1, 1]

  // 5. Score calculation
  // lensing > 1.5 → significant, > 3 → strong
  const lensingScore = Math.min(1, Math.max(0, (lensingRatio - 1) / 3));
  // concentration > 0.3 → significant, > 0.5 → strong
  const concentrationScore = Math.min(1, Math.max(0, (maxConcentration - 0.15) / 0.4));
  // asymmetry > 1.5 → significant, > 3 → strong
  const asymmetryScore = Math.min(1, Math.max(0, (levelAsymmetry - 1) / 3));

  const rawScore = (lensingScore * 0.4 + concentrationScore * 0.35 + asymmetryScore * 0.25);
  const score = Math.min(1, Math.max(0, rawScore));

  // Signal direction
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (score > 0.2) {
    signal = directionalBias > 0.1 ? 'BULLISH' : directionalBias < -0.1 ? 'BEARISH' : 'NEUTRAL';
  }

  // Confidence: выше при согласии всех метрик
  const agreement = [lensingScore, concentrationScore, asymmetryScore]
    .filter(s => s > 0.3).length / 3;
  const confidence = score > 0.2 ? Math.min(1, agreement * 1.5) : 0;

  return {
    detector: 'GRAVITON',
    description: 'Гравитационная линза — крупный игрок стягивает объём',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
