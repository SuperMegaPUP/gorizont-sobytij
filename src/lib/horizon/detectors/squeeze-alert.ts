// ─── SQUEEZE ALERT DETECTOR (Q-8) ────────────────────────────────────────
// Detects squeeze phase: low BSCI + cancel ratio drop + normal volatility
// Эталонный кейс: GAZP #2 - Cancel% 90%→0% за час → импульс +2.4%
//
// Формула: squeeze = bsciLow && vwapNear && atrNormal && sessionMain && (cancelDrop || cancelLow)
//
// Параметры (SQUEEZE_DEFAULT_CONFIG):
//   - emaCancelAlpha: 0.40 (быстрее чем PREDATOR EMA=0.3, т.к. Cancel% шумнее)
//   - cancelDeltaTrigger: -0.10 (падение EMA на 10 п.п.)
//   - cancelLowThreshold: 0.50 (Cancel% < 50% = стакан разгружен)
//   - bsciSqueezeMax: 0.20 (BSCI ниже = потенциальный squeeze)
//   - vwapDeviationMax: 0.02 (отклонение от VWAP < 2%)
//   - atrPctMax: 85 (ATR% ниже = нормальная волатильность)
//   - sessionGuard: 10:00-18:40 MSK

import type { DetectorInput, DetectorResult } from './types';
import { clampScore } from './guards';
import type { IStateStore } from '../state/factory';

const KV_TIMEOUT_MS = 800;
const MOEX_TZ = process.env.MOEX_TZ || 'Europe/Moscow';

export interface SqueezeConfig {
  emaCancelAlpha: number;
  cancelDeltaTrigger: number;
  cancelLowThreshold: number;
  bsciSqueezeMax: number;
  vwapDeviationMax: number;
  atrPctMax: number;
  sessionGuardStart: string; // "10:00"
  sessionGuardEnd: string;    // "18:40"
}

export const SQUEEZE_DEFAULT_CONFIG: SqueezeConfig = {
  emaCancelAlpha: 0.40,
  cancelDeltaTrigger: -0.10,
  cancelLowThreshold: 0.50,
  bsciSqueezeMax: 0.20,
  vwapDeviationMax: 0.02,
  atrPctMax: 85,
  sessionGuardStart: '10:00',
  sessionGuardEnd: '18:40',
};

export interface SqueezeInput {
  ticker: string;
  bsci: number;
  vwapDeviation: number;  // |price - vwap| / price
  atrPct: number;         // 0-100 (масштабированный из taContext.atrPercentile * 100)
  cancelPct: number;      // 0.0-1.0 (Cancel ratio)
  timestamp: number;
  rtOFI?: number;         // для направления сигнала
}

export interface SqueezeResult {
  squeezeAlertActive: boolean;
  squeezePhase: 'SQUEEZE' | 'PRE_SQUEEZE' | 'NONE';
  emaCancelCurrent: number;
  emaCancelPrev: number;
  cancelDelta: number;
  cancelRatioTrendingDown: boolean;
  cancelRatioLow: boolean;
  sessionPhase: 'MAIN' | 'AUCTION' | 'CLOSED';
  conditions: {
    bsciLow: boolean;
    vwapNear: boolean;
    atrNormal: boolean;
    sessionMain: boolean;
    cancelDrop: boolean;
    cancelLow: boolean;
  };
  metadata: Record<string, number | string | boolean>;
}

/**
 * Q-8: Detect SQUEEZE alert
 */
export async function detectSqueezeAlert(
  input: SqueezeInput,
  stateStore: IStateStore | null,
  config: SqueezeConfig = SQUEEZE_DEFAULT_CONFIG
): Promise<SqueezeResult> {
  const { ticker, bsci, vwapDeviation, atrPct, cancelPct, timestamp, rtOFI } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // 1. Session phase check
  const sessionPhase = getSessionPhase(timestamp, config);
  const sessionMain = sessionPhase === 'MAIN';

  // 2. Compute EMA(Cancel%) with KV timeout fallback
  let emaCurrent = cancelPct;
  let emaPrev = cancelPct;
  let isColdStart = true;

  if (stateStore) {
    try {
      const emaResult = await Promise.race([
        stateStore.calcEMA(
          `horizon:state:${ticker}:ema_cancel`,
          cancelPct,
          config.emaCancelAlpha
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('KV_TIMEOUT')), KV_TIMEOUT_MS)
        ),
      ]);
      emaCurrent = emaResult.smoothed;
      emaPrev = emaResult.prev;
      isColdStart = emaResult.isColdStart;
    } catch (e) {
      // KV timeout fallback: используем сырой Cancel%
      console.warn(`[Q-8] KV timeout for ${ticker}, using raw cancelPct`);
      emaCurrent = cancelPct;
      emaPrev = cancelPct;
      metadata.kvTimeoutFallback = true;
    }
  }

  // 3. Calculate cancel delta
  const cancelDelta = emaCurrent - emaPrev;

  // 4. Evaluate conditions
  const bsciLow = bsci < config.bsciSqueezeMax;
  const vwapNear = vwapDeviation < config.vwapDeviationMax;
  const atrNormal = atrPct < config.atrPctMax;
  const cancelRatioTrendingDown = cancelDelta < config.cancelDeltaTrigger;
  const cancelRatioLow = emaCurrent < config.cancelLowThreshold;

  // 5. Determine squeeze phase
  let squeezePhase: 'SQUEEZE' | 'PRE_SQUEEZE' | 'NONE' = 'NONE';
  let squeezeAlertActive = false;

  const allBaseConditions = bsciLow && vwapNear && atrNormal && sessionMain;

  if (allBaseConditions) {
    if (cancelRatioTrendingDown || cancelRatioLow) {
      squeezePhase = 'SQUEEZE';
      squeezeAlertActive = true;
    } else {
      squeezePhase = 'PRE_SQUEEZE';
    }
  }

  // 6. Signal direction from rtOFI
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (squeezeAlertActive && rtOFI !== undefined) {
    if (rtOFI > 0.1) signal = 'BULLISH';
    else if (rtOFI < -0.1) signal = 'BEARISH';
  }

  // 7. Confidence
  let confidence = 0;
  if (squeezeAlertActive) {
    const conditionsMet = [bsciLow, vwapNear, atrNormal, sessionMain, cancelRatioTrendingDown || cancelRatioLow]
      .filter(Boolean).length;
    confidence = Math.min(0.8, conditionsMet / 5 + 0.3);
  }

  // 8. Metadata
  metadata.config = config;
  metadata.isColdStart = isColdStart;

  return {
    squeezeAlertActive,
    squeezePhase,
    emaCancelCurrent: Math.round(emaCurrent * 1000) / 1000,
    emaCancelPrev: Math.round(emaPrev * 1000) / 1000,
    cancelDelta: Math.round(cancelDelta * 1000) / 1000,
    cancelRatioTrendingDown,
    cancelRatioLow,
    sessionPhase,
    conditions: {
      bsciLow,
      vwapNear,
      atrNormal,
      sessionMain,
      cancelDrop: cancelRatioTrendingDown,
      cancelLow: cancelRatioLow,
    },
    metadata,
  };
}

// ─── Вспомогательные функции ───────────────────────────────────────────────

function getSessionPhase(
  timestamp: number,
  config: SqueezeConfig
): 'MAIN' | 'AUCTION' | 'CLOSED' {
  const date = new Date(timestamp);
  const mskTime = new Date(date.toLocaleString('en-US', { timeZone: MOEX_TZ }));
  const mskHours = mskTime.getHours();
  const mskMinutes = mskTime.getMinutes();
  const mskMinutesTotal = mskHours * 60 + mskMinutes;

  const [startH, startM] = config.sessionGuardStart.split(':').map(Number);
  const [endH, endM] = config.sessionGuardEnd.split(':').map(Number);

  const mainStart = startH * 60 + startM;  // 600 = 10:00
  const mainEnd = endH * 60 + endM;        // 1120 = 18:40

  if (mskMinutesTotal >= mainStart && mskMinutesTotal <= mainEnd) {
    return 'MAIN';
  }

  // Аукционы: 09:50-10:00 и 18:40-18:50
  if ((mskMinutesTotal >= 590 && mskMinutesTotal < 600) || (mskMinutesTotal > 1120 && mskMinutesTotal <= 1130)) {
    return 'AUCTION';
  }

  return 'CLOSED';
}

/**
 * Detect SQUEEZE from DetectorInput (with backward compatibility)
 * Используется для интеграции в runAllDetectors
 */
export async function detectSqueezeFromDetectorInput(
  input: DetectorInput,
  stateStore: IStateStore | null
): Promise<DetectorResult> {
  const { ticker, trades, recentTrades, ofi, weightedOFI } = input;

  // Нужен taContext для atrPct - используем значение по умолчанию если нет
  const defaultAtrPct = 50;

  // Нужен VWAP - вычисляем из последних сделок
  const allTrades = trades && trades.length > 0 ? trades : (recentTrades || []);
  const prices = allTrades.map(t => t.price);
  const vwap = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const currentPrice = prices.length > 0 ? prices[prices.length - 1] : 0;
  const vwapDeviation = currentPrice > 0 ? Math.abs(currentPrice - vwap) / currentPrice : 0;

  // BSCI нужно получить извне - используем placeholder для совместимости
  // В реальной интеграции BSCI передаётся в squeezeInput
  const placeholderBsci = 0.15;

  const squeezeInput: SqueezeInput = {
    ticker,
    bsci: placeholderBsci,
    vwapDeviation,
    atrPct: defaultAtrPct,
    cancelPct: 0.9, // placeholder - Cancel ratio требует отдельного вычисления
    timestamp: Date.now(),
    rtOFI: input.realtimeOFI,
  };

  const result = await detectSqueezeAlert(squeezeInput, stateStore, SQUEEZE_DEFAULT_CONFIG);

  return {
    detector: 'SQUEEZE',
    description: result.squeezeAlertActive
      ? `SQUEEZE — ${result.squeezePhase}, Cancel% ${(result.emaCancelCurrent * 100).toFixed(0)}%`
      : result.squeezePhase === 'PRE_SQUEEZE'
        ? 'PRE_SQUEEZE — базовые условия есть, ждём Cancel% DROP'
        : 'SQUEEZE — не обнаружен',
    score: result.squeezeAlertActive ? 0.7 : 0,
    confidence: result.squeezeAlertActive ? 0.6 : 0,
    signal: ofi && ofi > 0.1 ? 'BULLISH' : ofi && ofi < -0.1 ? 'BEARISH' : 'NEUTRAL',
    metadata: result.metadata,
  };
}