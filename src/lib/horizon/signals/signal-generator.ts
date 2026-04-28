// ─── signal-generator.ts — Генератор торговых сигналов ──────────────────────
// v4.1: Спецификация заморожена
//
// ПОРОГ ГЕНЕРАЦИИ (параметризован — можно подправить одной строкой):
//   BSCI ≥ SIGNAL_BSCI_THRESHOLD (0.45, калибровка 2026-04-26)
//   Конвергенция ≥ SIGNAL_CONV_THRESHOLD (7)
//   Top-детектор ≥ 0.75
//   Явная дивергенция (детектор ≠ ТА)
//
// ТИПЫ СИГНАЛОВ: LONG / SHORT / AWAIT / BREAKOUT
// CONFIDENCE: условное взвешивание BSCI (conv≥8→20, <5→30, else→25)
// FALSE_BREAKOUT: градиент вместо бинарного порога
// ДЕДУПЛИКАЦИЯ: тот же тикер+direction → обновить
// ДИНАМИЧЕСКИЙ TTL: по сессии МОЕКС

import type { Candle } from '../calculations/vpin';
import type { Trade } from '../calculations/delta';
import type { OrderBookData } from '../calculations/ofi';
import type { TAIndicators } from '../ta-context';
import type { ConvergenceScoreResult } from '../convergence-score';
import type { RobotContext } from '../robot-context';
import { BSCI_ALERT_THRESHOLD, BSCI_AWAIT_THRESHOLD } from '../constants';
import { calculateLevels, type LevelResult } from './level-calculator';
import { calculateTTL, calculateExpiresAt, canGenerateSignals, getSessionInfo } from './moex-sessions';

// ─── Параметризованные пороги ────────────────────────────────────────────────

/** BSCI порог для генерации сигнала.
 * Калибровка 2026-04-26: Max BSCI=0.546, P90=0.485 на 100 тикерах.
 * Старый порог 0.55 → 0 сигналов. Новый 0.45 → 4 сигнала (редкость=ценность).
 * При П2 правках (Sprint 5) BSCI дискриминация улучшится → пересмотреть.
 */
export const SIGNAL_BSCI_THRESHOLD = BSCI_ALERT_THRESHOLD; // 0.20 — синхронизировано с constants.ts

/** Конвергенция порог для генерации сигнала.
 * Калибровка 2026-04-26: Max conv=9, conv>=5 у 32%, conv>=7 у 2%.
 * Старый порог 7 → 2 сигнала. Новый 5 → 4 сигнала (с BSCI>=0.45).
 * При П2 правках (Sprint 5) конвергенция уточнится → пересмотреть.
 */
export const SIGNAL_CONV_THRESHOLD = 5;

/** Top-детектор порог */
export const SIGNAL_TOP_DET_THRESHOLD = 0.75;

/** Порог BSCI для AWAIT сигнала */
export const SIGNAL_AWAIT_BSCI_THRESHOLD = BSCI_AWAIT_THRESHOLD; // 0.35 — синхронизировано с constants.ts

/** Порог HAWKING для BREAKOUT сигнала */
export const SIGNAL_BREAKOUT_HAWKING_THRESHOLD = 0.7;

/** Условное взвешивание BSCI в confidence */
export const BSCI_WEIGHTS = {
  highConv: 20,   // conv ≥ SIGNAL_CONV_THRESHOLD (калибровка: 5)
  midConv: 25,    // порог ≤ conv < threshold + 2
  lowConv: 30,    // conv < threshold
} as const;

/** Вес компонентов confidence */
export const CONFIDENCE_WEIGHTS = {
  bsci: 0,       // динамический (BSCI_WEIGHTS)
  convergence: 25,
  rsiCrsi: 20,
  robots: 15,
  divergence: 15,
} as const;

/** FALSE_BREAKOUT градиент пороги */
export const FALSE_BREAKOUT_THRESHOLDS = {
  fullConfidence: 0.7,    // ≥0.7 → CONSUME, modifier = 1.0
  partialConfidence: 0.4, // 0.4-0.7 → CONSUME с modifier
  falseBreakout: 0.4,     // <0.4 → FALSE_BREAKOUT
} as const;

// ─── Типы сигналов ───────────────────────────────────────────────────────────

export type SignalType = 'LONG' | 'SHORT' | 'AWAIT' | 'BREAKOUT';
export type SignalState = 'ACTIVE' | 'CLOSED';
export type SignalDirection = 'LONG' | 'SHORT';
export type WavefunctionState = 'ACCUMULATE' | 'DISTRIBUTE' | 'HOLD';
export type SignalResult = 'WIN' | 'LOSS' | 'EXPIRED';
export type CloseReason = 'TARGET' | 'STOP' | 'EXPIRED' | 'DIRECTION_CHANGE' | 'FALSE_BREAKOUT';
export type CorrelationType = 'SAME_ISSUER' | 'SAME_SECTOR' | 'SAME_FUND';

export interface ExitCondition {
  type: 'CUMDELTA_REVERSAL' | 'BSCI_DROP' | 'VPIN_SPIKE' | 'PRICE_STOP' | 'FALSE_BREAKOUT';
  threshold: number;
  description: string;
  triggered: boolean;
}

export interface SignalSnapshot {
  signal_id: string;
  timestamp: Date;
  price: number;
  bsci: number;
  convergence: number;
  topDetector: string;
  topDetectorScore: number;
  pnl_unrealized: number;
  wavefunction_state: string;
}

export interface TradeSignal {
  /** Уникальный ID сигнала */
  signal_id: string;
  /** Тикер */
  ticker: string;
  /** Тип сигнала */
  type: SignalType;
  /** Уверенность 0-100% */
  confidence: number;
  /** Конвергенция 0-10 */
  convergence: number;

  // ── Уровни ──
  entry_price: number;
  entryZone: [number, number];
  stopLoss: number;
  targets: [number, number, number]; // T1, T2, T3
  riskRewardRatio: number;

  // ── Обоснование ──
  trigger: string;
  confirmations: string[];
  divergences: string[];

  // ── Управление ──
  exitConditions: ExitCondition[];

  // ── Метаданные ──
  direction: SignalDirection;
  state: SignalState;
  wavefunction_state: WavefunctionState;
  top_detector: string;
  bsciAtCreation: number;

  // ── Корреляция (v4.1) ──
  correlatedWith?: string[];
  correlationType?: CorrelationType;

  // ── Время (v4.1 — динамический TTL) ──
  createdAt: Date;
  expiresAt: Date;

  // ── История ──
  snapshots: SignalSnapshot[];
  result?: SignalResult;
  close_reason?: CloseReason;
  close_price?: number;
  pnl_ticks?: number;

  // ── Confidence breakdown ──
  confidenceBreakdown: ConfidenceBreakdown;
}

export interface ConfidenceBreakdown {
  bsci: number;
  bsciWeight: number;
  convergence: number;
  rsiCrsi: number;
  robots: number;
  divergence: number;
  divergenceConditional: 'positive' | 'negative';
  falseBreakoutModifier: number;
  total: number;
}

// ─── Корреляция тикеров (SAME_ISSUER) ───────────────────────────────────────

/**
 * Мэппинг тикеров одного эмитента.
 * Ключ — старший тикер, значение — массив привилегированных/дочерних.
 */
const SAME_ISSUER_MAP: Record<string, string[]> = {
  SBER: ['SBERP'],
  SBERP: ['SBER'],
  GAZP: ['GAZPP'],
  GAZPP: ['GAZP'],
  SNGS: ['SNGSP'],
  SNGSP: ['SNGS'],
  LKOH: ['LKOHM'],
  LKOHM: ['LKOH'],
  TATN: ['TATNP'],
  TATNP: ['TATN'],
  VTBR: ['VTBRP'],
  VTBRP: ['VTBR'],
  RUAL: ['RUALP'],
  RUALP: ['RUAL'],
  BANE: ['BANEP'],
  BANEP: ['BANE'],
  LSNG: ['LSNGP'],
  LSNGP: ['LSNG'],
  MTLR: ['MTLRP'],
  MTLRP: ['MTLR'],
  TCSG: ['TCSGP'],
  TCSGP: ['TCSG'],
  SELG: ['SELGP'],
  SELGP: ['SELG'],
  KZOS: ['KZOSP'],
  KZOSP: ['KZOS'],
  LNZL: ['LNZLP'],
  LNZLP: ['LNZL'],
  KAZT: ['KAZTP'],
  KAZTP: ['KAZT'],
  PLZL: ['PLZLP'],
  PLZLP: ['PLZL'],
  MRKC: ['MRKP'],
  MRKP: ['MRKC'],
};

/**
 * Находит связанные тикеры (SAME_ISSUER).
 */
export function findCorrelatedTickers(ticker: string): { tickers: string[]; type: CorrelationType } {
  const sameIssuer = SAME_ISSUER_MAP[ticker];
  if (sameIssuer) {
    return { tickers: sameIssuer, type: 'SAME_ISSUER' };
  }
  return { tickers: [], type: 'SAME_SECTOR' };
}

// ─── Confidence расчёт (v4.1 — условное взвешивание BSCI) ───────────────────

export interface ConfidenceInput {
  bsci: number;
  convergence: number;
  rsi: number;
  crsi: number;
  robotConfirmed: boolean;
  robotConfirmation: number;
  hasDivergence: boolean;
  topDetectorScore: number;
  priceReversion?: number;       // из PREDATOR metadata
  deltaFlip?: boolean;           // смена знака CumDelta
}

/**
 * Вычисляет confidence сигнала 0-100% с условным взвешиванием BSCI.
 *
 * bsci_weight = conv≥8 → 20, conv<5 → 30, else → 25
 * confidence = BSCI(bsci_weight) + conv(25) + RSI/CRSI(20) + robots(15) + divergence(15)
 *
 * Divergence УСЛОВНАЯ:
 *   topDet ≥ 0.85 → +15 (детектор уверен → дивергенция = сила)
 *   topDet < 0.85 → −10 (детектор неуверен → дивергенция = риск)
 *
 * FALSE_BREAKOUT градиент:
 *   priceReversion ≥ 0.7 → modifier = 1.0
 *   0.4 ≤ priceReversion < 0.7 → modifier = priceReversion
 *   priceReversion ≥ 0.4 && !deltaFlip → modifier = priceReversion × 0.5
 *   priceReversion < 0.4 → FALSE_BREAKOUT → modifier = 0.3
 */
export function calculateConfidence(input: ConfidenceInput): { confidence: number; breakdown: ConfidenceBreakdown } {
  const { bsci, convergence, rsi, crsi, robotConfirmed, robotConfirmation, hasDivergence, topDetectorScore, priceReversion, deltaFlip } = input;

  // 1. BSCI (условный вес)
  let bsciWeight: number;
  if (convergence >= SIGNAL_CONV_THRESHOLD + 2) bsciWeight = BSCI_WEIGHTS.highConv;
  else if (convergence < SIGNAL_CONV_THRESHOLD) bsciWeight = BSCI_WEIGHTS.lowConv;
  else bsciWeight = BSCI_WEIGHTS.midConv;

  // BSCI баллы: линейно от SIGNAL_BSCI_THRESHOLD до 1.0 (если ниже порога — 0, если 1.0 — максимум)
  const bsciPoints = bsci >= SIGNAL_BSCI_THRESHOLD
    ? ((bsci - SIGNAL_BSCI_THRESHOLD) / (1 - SIGNAL_BSCI_THRESHOLD)) * bsciWeight
    : 0;

  // 2. Convergence: 0-25 баллов (линейно от 7 до 10)
  const convPoints = convergence >= SIGNAL_CONV_THRESHOLD
    ? ((convergence - SIGNAL_CONV_THRESHOLD) / (10 - SIGNAL_CONV_THRESHOLD)) * CONFIDENCE_WEIGHTS.convergence
    : (convergence / SIGNAL_CONV_THRESHOLD) * CONFIDENCE_WEIGHTS.convergence * 0.5; // неполный — половина

  // 3. RSI/CRSI: 0-20 баллов (экстремумы = больше баллов)
  const rsiExtremity = Math.max(
    rsi > 70 ? (rsi - 70) / 30 : 0,   // overbought
    rsi < 30 ? (30 - rsi) / 30 : 0,   // oversold
  );
  const crsiExtremity = Math.max(
    crsi > 80 ? (crsi - 80) / 20 : 0,
    crsi < 20 ? (20 - crsi) / 20 : 0,
  );
  const rsiCrsiPoints = (rsiExtremity * 0.6 + crsiExtremity * 0.4) * CONFIDENCE_WEIGHTS.rsiCrsi;

  // 4. Robots: 0-15 баллов (graceful degradation)
  const robotPoints = robotConfirmed
    ? Math.min(robotConfirmation, 1) * CONFIDENCE_WEIGHTS.robots
    : 0;

  // 5. Divergence: УСЛОВНАЯ
  let divergencePoints: number;
  let divergenceConditional: 'positive' | 'negative';

  if (hasDivergence) {
    if (topDetectorScore >= 0.85) {
      divergencePoints = CONFIDENCE_WEIGHTS.divergence; // +15
      divergenceConditional = 'positive';
    } else {
      divergencePoints = -10; // -10
      divergenceConditional = 'negative';
    }
  } else {
    divergencePoints = 0;
    divergenceConditional = 'positive';
  }

  // 6. FALSE_BREAKOUT градиент (modifier)
  let falseBreakoutModifier = 1.0;
  if (priceReversion !== undefined) {
    if (priceReversion >= FALSE_BREAKOUT_THRESHOLDS.fullConfidence && deltaFlip) {
      falseBreakoutModifier = 1.0;
    } else if (priceReversion >= FALSE_BREAKOUT_THRESHOLDS.partialConfidence && priceReversion < FALSE_BREAKOUT_THRESHOLDS.fullConfidence && deltaFlip) {
      falseBreakoutModifier = priceReversion;
    } else if (priceReversion >= FALSE_BREAKOUT_THRESHOLDS.partialConfidence && !deltaFlip) {
      falseBreakoutModifier = priceReversion * 0.5;
    } else {
      // priceReversion < 0.4 → FALSE_BREAKOUT
      falseBreakoutModifier = 0.3; // сильно понижаем confidence
    }
  }

  // Итог
  const rawTotal = bsciPoints + convPoints + rsiCrsiPoints + robotPoints + divergencePoints;
  const total = Math.min(100, Math.max(0, rawTotal * falseBreakoutModifier));

  return {
    confidence: Math.round(total * 10) / 10,
    breakdown: {
      bsci: Math.round(bsciPoints * 10) / 10,
      bsciWeight,
      convergence: Math.round(convPoints * 10) / 10,
      rsiCrsi: Math.round(rsiCrsiPoints * 10) / 10,
      robots: Math.round(robotPoints * 10) / 10,
      divergence: Math.round(divergencePoints * 10) / 10,
      divergenceConditional,
      falseBreakoutModifier,
      total: Math.round(total * 10) / 10,
    },
  };
}

// ─── Wavefunction State ─────────────────────────────────────────────────────

/**
 * Определяет состояние WAVEFUNCTION для сигнала.
 * ACCUMULATE: BSCI бычий + стабильная цена (аккумуляция)
 * DISTRIBUTE: BSCI медвежий + высокая волатильность (распределение)
 * HOLD: нейтральное состояние
 */
export function determineWavefunctionState(
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  atrPercentile: number,
): WavefunctionState {
  if (direction === 'BULLISH' && atrPercentile < 0.3) return 'ACCUMULATE';
  if (direction === 'BEARISH' && atrPercentile > 0.7) return 'DISTRIBUTE';
  if (direction === 'BULLISH') return 'ACCUMULATE';
  if (direction === 'BEARISH') return 'DISTRIBUTE';
  return 'HOLD';
}

// ─── Exit Conditions ─────────────────────────────────────────────────────────

export function buildExitConditions(
  direction: SignalDirection,
  stopLoss: number,
  bsciAtCreation: number,
  currentVpin: number,
): ExitCondition[] {
  return [
    {
      type: 'PRICE_STOP',
      threshold: stopLoss,
      description: direction === 'LONG'
        ? `Цена < ${stopLoss.toFixed(2)} → стоп-лосс`
        : `Цена > ${stopLoss.toFixed(2)} → стоп-лосс`,
      triggered: false,
    },
    {
      type: 'CUMDELTA_REVERSAL',
      threshold: 0.5,
      description: 'CumDelta сменил знак на 3 свечах → разворот потока',
      triggered: false,
    },
    {
      type: 'BSCI_DROP',
      threshold: bsciAtCreation - 0.15,
      description: `BSCI упал >0.15 (с ${bsciAtCreation.toFixed(2)} до <${(bsciAtCreation - 0.15).toFixed(2)})`,
      triggered: false,
    },
    {
      type: 'VPIN_SPIKE',
      threshold: currentVpin * 1.5,
      description: `VPIN > ${(currentVpin * 1.5).toFixed(3)} (рост >50% от ${currentVpin.toFixed(3)})`,
      triggered: false,
    },
  ];
}

// ─── Signal ID генерация ────────────────────────────────────────────────────

let signalCounter = 0;

function generateSignalId(ticker: string, direction: SignalDirection): string {
  signalCounter++;
  const ts = Date.now().toString(36);
  const counter = signalCounter.toString(36);
  return `sig_${ticker.toLowerCase()}_${direction.toLowerCase()}_${ts}_${counter}`;
}

// ─── Главная функция ─────────────────────────────────────────────────────────

export interface SignalGeneratorInput {
  ticker: string;
  name: string;
  bsci: number;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  convergenceScore: number;
  convergenceResult?: ConvergenceScoreResult;
  detectorScores: Record<string, number>;
  topDetector: string;
  vpin: number;
  cumDelta: number;
  ofi: number;
  taIndicators: TAIndicators;
  robotContext?: RobotContext;
  // Данные для уровней
  candles: Candle[];
  trades: Trade[];
  orderbook?: OrderBookData;
  currentPrice: number;
  // Для дедупликации
  existingActiveSignals?: TradeSignal[];
}

export interface SignalGeneratorOutput {
  /** Сгенерированный сигнал или null если пороги не пройдены */
  signal: TradeSignal | null;
  /** Причина отсутствия сигнала (для логирования) */
  reason?: string;
  /** Тип сигнала, который был бы сгенерирован */
  wouldBeType?: SignalType;
}

/**
 * Генерирует торговый сигнал на основе результатов сканирования.
 *
 * Логика:
 * 1. Проверка порогов: BSCI ≥ 0.55 AND conv ≥ 7 AND topDet ≥ 0.75
 * 2. Определение типа: LONG / SHORT / AWAIT / BREAKOUT
 * 3. Расчёт confidence с условным BSCI весом
 * 4. Расчёт уровней (entry/stop/targets)
 * 5. Дедупликация
 * 6. Формирование exit conditions
 */
export function generateSignal(input: SignalGeneratorInput): SignalGeneratorOutput {
  const {
    ticker, bsci, direction, convergenceScore, detectorScores, topDetector,
    vpin, taIndicators, robotContext, candles, trades, orderbook, currentPrice,
    existingActiveSignals,
  } = input;

  const topDetScore = detectorScores[topDetector] || 0;
  const hasDivergence = direction !== 'NEUTRAL' && (
    (direction === 'BULLISH' && (taIndicators.rsiZone === 'OVERBOUGHT' || taIndicators.cmfZone === 'NEGATIVE')) ||
    (direction === 'BEARISH' && (taIndicators.rsiZone === 'OVERSOLD' || taIndicators.cmfZone === 'POSITIVE'))
  );

  // ── 1. Определяем тип сигнала ────────────────────────────────────────────
  const bsciPass = bsci >= SIGNAL_BSCI_THRESHOLD;
  const convPass = convergenceScore >= SIGNAL_CONV_THRESHOLD;
  const topDetPass = topDetScore >= SIGNAL_TOP_DET_THRESHOLD;
  const hawkingScore = detectorScores['HAWKING'] || 0;
  const atrCompressed = taIndicators.atrZone === 'COMPRESSED';

  // Cross-filter: если менее 3 детекторов с высоким скором → нет сигнала
  const nHighDetectors = Object.values(detectorScores).filter(s => s > 0.7).length;
  const hasEnoughSupport = nHighDetectors >= 3;

  let signalType: SignalType | null = null;
  let signalDirection: SignalDirection;
  let reason = '';

  // BREAKOUT: BSCI≥SIGNAL_BSCI_THRESHOLD + HAWKING≥0.7 + ATR сжат + ≥3 детекторов
  if (bsciPass && hasEnoughSupport && hawkingScore >= SIGNAL_BREAKOUT_HAWKING_THRESHOLD && atrCompressed) {
    signalType = 'BREAKOUT';
    signalDirection = direction === 'BEARISH' ? 'SHORT' : 'LONG';
  }
  // LONG / SHORT: все пороги пройдены + ≥3 детекторов
  else if (bsciPass && hasEnoughSupport && convPass && topDetPass) {
    signalDirection = direction === 'BEARISH' ? 'SHORT' : 'LONG';

    if (direction === 'BULLISH' || direction === 'BEARISH') {
      signalType = signalDirection;
    } else {
      // NEUTRAL — недостаточно для LONG/SHORT
      signalType = null;
      reason = 'BSCI direction NEUTRAL — нет направления для сигнала';
    }
  }
  // AWAIT: BSCI≥0.35 но конвергенция <SIGNAL_CONV_THRESHOLD
  else if (bsci >= SIGNAL_AWAIT_BSCI_THRESHOLD && !convPass) {
    signalType = 'AWAIT';
    signalDirection = direction === 'BEARISH' ? 'SHORT' : 'LONG';
  }
  // Нет сигнала
  else {
    const failed: string[] = [];
    if (!bsciPass) failed.push(`BSCI ${bsci.toFixed(2)} < ${SIGNAL_BSCI_THRESHOLD}`);
    if (!convPass) failed.push(`Conv ${convergenceScore} < ${SIGNAL_CONV_THRESHOLD}`);
    if (!topDetPass) failed.push(`TopDet ${topDetScore.toFixed(2)} < ${SIGNAL_TOP_DET_THRESHOLD}`);

    return {
      signal: null,
      reason: `Пороги не пройдены: ${failed.join(', ')}`,
      wouldBeType: bsci >= SIGNAL_AWAIT_BSCI_THRESHOLD ? 'AWAIT' : undefined,
    };
  }

  // ── 2. Проверяем сессию МОЕКС ────────────────────────────────────────────
  const now = new Date();
  const sessionInfo = getSessionInfo(now);

  if (!canGenerateSignals(now)) {
    return {
      signal: null,
      reason: `Сессия ${sessionInfo.session} — сигналы не генерируются`,
      wouldBeType: signalType || undefined,
    };
  }

  // ── 3. Дедупликация ──────────────────────────────────────────────────────
  // Тот же тикер + тот же direction + ACTIVE → обновить, не создавать новый
  if (existingActiveSignals && existingActiveSignals.length > 0) {
    const existing = existingActiveSignals.find(
      s => s.ticker === ticker && s.direction === signalDirection && s.state === 'ACTIVE',
    );

    if (existing) {
      // Обновляем существующий сигнал
      const updated = updateExistingSignal(existing, input, signalType!);
      return { signal: updated };
    }

    // Тот же тикер, но сменился direction → закрыть старый, создать новый
    const oppositeDir = signalDirection === 'LONG' ? 'SHORT' : 'LONG';
    const oppositeSignal = existingActiveSignals.find(
      s => s.ticker === ticker && s.direction === oppositeDir && s.state === 'ACTIVE',
    );

    if (oppositeSignal) {
      // Закрываем старый с DIRECTION_CHANGE
      oppositeSignal.state = 'CLOSED';
      oppositeSignal.close_reason = 'DIRECTION_CHANGE';
      oppositeSignal.close_price = currentPrice;
      oppositeSignal.result = 'EXPIRED';
      oppositeSignal.pnl_ticks = 0;
    }
  }

  // ── 4. Расчёт уровней ────────────────────────────────────────────────────
  const levels = calculateLevels({
    candles,
    trades,
    orderbook,
    currentPrice,
    direction: signalDirection,
    vwap: taIndicators.vwap,
  });

  // ── 5. Confidence ────────────────────────────────────────────────────────
  const priceReversion = input.robotContext?.hasSpoofing ? 0.3 : undefined; // Спуфинг → низкий priceReversion
  const { confidence, breakdown } = calculateConfidence({
    bsci,
    convergence: convergenceScore,
    rsi: taIndicators.rsi,
    crsi: taIndicators.crsi,
    robotConfirmed: robotContext ? robotContext.confirmation >= 0.4 : false,
    robotConfirmation: robotContext?.confirmation ?? 0,
    hasDivergence,
    topDetectorScore: topDetScore,
    priceReversion,
    deltaFlip: undefined, // Будет обновляться в exit conditions
  });

  // ── 6. Формируем сигнал ──────────────────────────────────────────────────
  const wfState = determineWavefunctionState(direction, taIndicators.atrPercentile);
  const exitConditions = buildExitConditions(signalDirection, levels.stopLoss, bsci, vpin);

  // Корреляция
  const correlated = findCorrelatedTickers(ticker);

  // Подтверждения и противоречия
  const confirmations: string[] = [];
  const divergences: string[] = [];

  if (robotContext && robotContext.confirmation >= 0.4) {
    confirmations.push(`Роботы подтверждают: ${robotContext.matchedPattern} (${(robotContext.confirmation * 100).toFixed(0)}%)`);
  }
  if (hasDivergence && topDetScore >= 0.85) {
    confirmations.push('Дивергенция = скрытая активность (детектор уверен)');
  }
  if (atrCompressed) {
    confirmations.push('ATR сжат → прорыв imminent');
  }
  if (taIndicators.rsiZone === 'OVERSOLD' && direction === 'BULLISH') {
    confirmations.push(`RSI перепроданность (${taIndicators.rsi.toFixed(1)})`);
  }
  if (taIndicators.rsiZone === 'OVERBOUGHT' && direction === 'BEARISH') {
    confirmations.push(`RSI перекупленность (${taIndicators.rsi.toFixed(1)})`);
  }

  if (hasDivergence && topDetScore < 0.85) {
    divergences.push('Дивергенция при слабом детекторе → риск ложного пробоя');
  }
  if (robotContext?.hasSpoofing) {
    divergences.push('Спуфинг обнаружен → стена фейк');
  }
  if (robotContext && robotContext.cancelRatio > 0.8) {
    divergences.push(`Cancel ratio ${(robotContext.cancelRatio * 100).toFixed(0)}% > 80%`);
  }

  // Trigger описание
  const trigger = `${topDetector} ${topDetScore.toFixed(2)} — ${
    signalType === 'LONG' ? 'кит накапливает' :
    signalType === 'SHORT' ? 'кит распределяет' :
    signalType === 'BREAKOUT' ? 'прорыв imminent' :
    'ожидает подтверждения'
  }`;

  const expiresAt = calculateExpiresAt(now);

  const signal: TradeSignal = {
    signal_id: generateSignalId(ticker, signalDirection),
    ticker,
    type: signalType!,
    confidence,
    convergence: convergenceScore,

    entry_price: levels.entryPrice,
    entryZone: levels.entryZone,
    stopLoss: levels.stopLoss,
    targets: [levels.T1, levels.T2, levels.T3],
    riskRewardRatio: levels.riskRewardRatio,

    trigger,
    confirmations,
    divergences,

    exitConditions,

    direction: signalDirection,
    state: 'ACTIVE',
    wavefunction_state: wfState,
    top_detector: topDetector,
    bsciAtCreation: bsci,

    correlatedWith: correlated.tickers.length > 0 ? [] : undefined, // Заполнится при сохранении (нужны ID сигналов)
    correlationType: correlated.tickers.length > 0 ? correlated.type : undefined,

    createdAt: now,
    expiresAt,

    snapshots: [],
    result: undefined,
    close_reason: undefined,
    close_price: undefined,
    pnl_ticks: undefined,

    confidenceBreakdown: breakdown,
  };

  return { signal };
}

// ─── Обновление существующего сигнала ────────────────────────────────────────

/**
 * Обновляет существующий ACTIVE сигнал вместо создания нового.
 * Дедупликация: тот же тикер + direction → обновить entry/stop/target, добавить snapshot.
 */
function updateExistingSignal(
  existing: TradeSignal,
  input: SignalGeneratorInput,
  newType: SignalType,
): TradeSignal {
  const { bsci, convergenceScore, detectorScores, topDetector, taIndicators, currentPrice, vpin, robotContext } = input;

  const topDetScore = detectorScores[topDetector] || 0;

  // Пересчитываем уровни
  const levels = calculateLevels({
    candles: input.candles,
    trades: input.trades,
    orderbook: input.orderbook,
    currentPrice,
    direction: existing.direction,
    vwap: taIndicators.vwap,
  });

  // Пересчитываем confidence
  const hasDivergence = existing.direction === 'LONG'
    ? (taIndicators.rsiZone === 'OVERBOUGHT' || taIndicators.cmfZone === 'NEGATIVE')
    : (taIndicators.rsiZone === 'OVERSOLD' || taIndicators.cmfZone === 'POSITIVE');

  const { confidence, breakdown } = calculateConfidence({
    bsci,
    convergence: convergenceScore,
    rsi: taIndicators.rsi,
    crsi: taIndicators.crsi,
    robotConfirmed: robotContext ? robotContext.confirmation >= 0.4 : false,
    robotConfirmation: robotContext?.confirmation ?? 0,
    hasDivergence,
    topDetectorScore: topDetScore,
  });

  // Добавляем snapshot
  const snapshot: SignalSnapshot = {
    signal_id: existing.signal_id,
    timestamp: new Date(),
    price: currentPrice,
    bsci,
    convergence: convergenceScore,
    topDetector: topDetector,
    topDetectorScore: topDetScore,
    pnl_unrealized: existing.direction === 'LONG'
      ? currentPrice - existing.entry_price
      : existing.entry_price - currentPrice,
    wavefunction_state: existing.wavefunction_state,
  };

  // Обновляем поля
  existing.type = newType;
  existing.confidence = confidence;
  existing.convergence = convergenceScore;
  existing.entry_price = currentPrice;
  existing.entryZone = levels.entryZone;
  existing.stopLoss = levels.stopLoss;
  existing.targets = [levels.T1, levels.T2, levels.T3];
  existing.riskRewardRatio = levels.riskRewardRatio;
  existing.bsciAtCreation = bsci;
  existing.confidenceBreakdown = breakdown;
  existing.snapshots.push(snapshot);

  // Обновляем exit conditions
  existing.exitConditions = buildExitConditions(existing.direction, levels.stopLoss, bsci, vpin);

  return existing;
}
