// ─── signal-feedback.ts — Виртуальный P&L и обратная связь ───────────────────
// v4.1: Feedback loop без роботов — виртуальный P&L
//
// Каждые 5 минут проверяем ACTIVE сигналы:
//   LONG: max(price) >= target → WIN; min(price) <= stop → LOSS
//   SHORT — зеркально
//   TTL истёк → EXPIRED
//
// Snapshot при каждой проверке (~100/день для ACTIVE сигналов)
// Обратная связь для WAVEFUNCTION и BSCI весов

import type { TradeSignal, SignalSnapshot, SignalResult, CloseReason, ExitCondition } from './signal-generator';
import { formatTTLRemaining } from './moex-sessions';

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface SignalFeedbackResult {
  signal_id: string;
  ticker: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  stop_loss: number;
  target: number;
  generated_at: number;
  wavefunction_state: string;
  top_detector: string;
  bsci: number;
  convergence: number;
  closed_at: number;
  close_reason: CloseReason;
  close_price: number;
  pnl_ticks: number;
  result: SignalResult;
}

export interface FeedbackCheckResult {
  /** ID проверенного сигнала */
  signal_id: string;
  /** Был ли сигнал закрыт */
  closed: boolean;
  /** Причина закрытия (если закрыт) */
  closeReason?: CloseReason;
  /** Результат (если закрыт) */
  result?: SignalResult;
  /** PnL в тиках (если закрыт) */
  pnlTicks?: number;
  /** Был ли добавлен snapshot */
  snapshotAdded: boolean;
  /** Какие exit conditions сработали */
  triggeredExits: ExitCondition[];
}

// ─── Проверка P&L одного сигнала ─────────────────────────────────────────────

export interface PnLCheckInput {
  signal: TradeSignal;
  currentPrice: number;
  currentBsci: number;
  currentConvergence: number;
  currentVpin: number;
  currentCumDelta: number;
  /** Предыдущий CumDelta (для reversal detection) */
  prevCumDelta: number;
  /** Сколько свечей подряд CumDelta сменил знак */
  cumDeltaSignChanges: number;
  /** Текущее время */
  now?: Date;
}

/**
 * Проверяет один ACTIVE сигнал на условия закрытия.
 *
 * Условия выхода:
 * 1. PRICE_STOP: цена пробила стоп-лосс
 * 2. TARGET: цена достигла T1 (минимум)
 * 3. EXPIRED: TTL истёк
 * 4. CUMDELTA_REVERSAL: CumDelta сменил знак на 3+ свечах
 * 5. BSCI_DROP: BSCI упал >0.15 от момента создания
 * 6. VPIN_SPIKE: VPIN вырос >50% от начального
 * 7. FALSE_BREAKOUT: PREDATOR подтвердил ложный пробой
 */
export function checkSignalPnL(input: PnLCheckInput): FeedbackCheckResult {
  const { signal, currentPrice, currentBsci, currentConvergence, currentVpin, currentCumDelta, prevCumDelta, cumDeltaSignChanges, now = new Date() } = input;

  const triggeredExits: ExitCondition[] = [];

  // ── 1. Добавляем snapshot ────────────────────────────────────────────────
  const snapshot: SignalSnapshot = {
    signal_id: signal.signal_id,
    timestamp: now,
    price: currentPrice,
    bsci: currentBsci,
    convergence: currentConvergence,
    topDetector: signal.top_detector,
    topDetectorScore: signal.bsciAtCreation, // approximate
    pnl_unrealized: signal.direction === 'LONG'
      ? currentPrice - signal.entry_price
      : signal.entry_price - currentPrice,
    wavefunction_state: signal.wavefunction_state,
  };

  // ── 2. Проверяем exit conditions ────────────────────────────────────────

  // PRICE_STOP
  if (signal.direction === 'LONG' && currentPrice <= signal.stopLoss) {
    const exit = signal.exitConditions.find(e => e.type === 'PRICE_STOP');
    if (exit) { exit.triggered = true; triggeredExits.push(exit); }
    return closeSignal(signal, 'STOP', 'LOSS', currentPrice, now, snapshot);
  }
  if (signal.direction === 'SHORT' && currentPrice >= signal.stopLoss) {
    const exit = signal.exitConditions.find(e => e.type === 'PRICE_STOP');
    if (exit) { exit.triggered = true; triggeredExits.push(exit); }
    return closeSignal(signal, 'STOP', 'LOSS', currentPrice, now, snapshot);
  }

  // TARGET: цена достигла T1
  if (signal.direction === 'LONG' && currentPrice >= signal.targets[0]) {
    return closeSignal(signal, 'TARGET', 'WIN', currentPrice, now, snapshot);
  }
  if (signal.direction === 'SHORT' && currentPrice <= signal.targets[0]) {
    return closeSignal(signal, 'TARGET', 'WIN', currentPrice, now, snapshot);
  }

  // EXPIRED: TTL истёк
  if (now >= signal.expiresAt) {
    return closeSignal(signal, 'EXPIRED', 'EXPIRED', currentPrice, now, snapshot);
  }

  // CUMDELTA_REVERSAL: CumDelta сменил знак на 3+ свечах
  if (cumDeltaSignChanges >= 3) {
    const exit = signal.exitConditions.find(e => e.type === 'CUMDELTA_REVERSAL');
    if (exit) { exit.triggered = true; triggeredExits.push(exit); }
    // Не закрываем сразу — это предупреждение, но помечаем
  }

  // BSCI_DROP: BSCI упал >0.15 от момента создания
  if (currentBsci < signal.bsciAtCreation - 0.15) {
    const exit = signal.exitConditions.find(e => e.type === 'BSCI_DROP');
    if (exit) { exit.triggered = true; triggeredExits.push(exit); }
    // Не закрываем сразу — предупреждение
  }

  // VPIN_SPIKE: VPIN вырос >50%
  const vpinExit = signal.exitConditions.find(e => e.type === 'VPIN_SPIKE');
  if (vpinExit && currentVpin > vpinExit.threshold) {
    vpinExit.triggered = true;
    triggeredExits.push(vpinExit);
  }

  // ── 3. Сигнал остаётся ACTIVE ───────────────────────────────────────────
  signal.snapshots.push(snapshot);

  return {
    signal_id: signal.signal_id,
    closed: false,
    snapshotAdded: true,
    triggeredExits,
  };
}

/**
 * Закрывает сигнал с указанными параметрами.
 */
function closeSignal(
  signal: TradeSignal,
  closeReason: CloseReason,
  result: SignalResult,
  closePrice: number,
  closedAt: Date,
  lastSnapshot: SignalSnapshot,
): FeedbackCheckResult {
  // Вычисляем PnL в тиках
  let pnlTicks: number;
  if (signal.direction === 'LONG') {
    pnlTicks = closePrice - signal.entry_price;
  } else {
    pnlTicks = signal.entry_price - closePrice;
  }

  // Обновляем сигнал
  signal.state = 'CLOSED';
  signal.close_reason = closeReason;
  signal.close_price = closePrice;
  signal.result = result;
  signal.pnl_ticks = Math.round(pnlTicks * 100) / 100;

  // Добавляем финальный snapshot
  lastSnapshot.pnl_unrealized = pnlTicks;
  signal.snapshots.push(lastSnapshot);

  return {
    signal_id: signal.signal_id,
    closed: true,
    closeReason,
    result,
    pnlTicks: signal.pnl_ticks,
    snapshotAdded: true,
    triggeredExits: signal.exitConditions.filter(e => e.triggered),
  };
}

// ─── Feedback Loop ───────────────────────────────────────────────────────────

export interface FeedbackAccumulator {
  /** Количество сигналов по каждому top_detector */
  detectorStats: Record<string, {
    total: number;
    wins: number;
    losses: number;
    expired: number;
    winRate: number;
  }>;
  /** Количество сигналов по wavefunction_state */
  wavefunctionStats: Record<string, {
    total: number;
    wins: number;
    losses: number;
    winRate: number;
  }>;
  /** Общая статистика */
  total: number;
  wins: number;
  losses: number;
  expired: number;
  overallWinRate: number;
}

/**
 * Вычисляет aggregate статистику по закрытым сигналам.
 * Используется для weekly feedback loop.
 */
export function computeFeedbackStats(closedSignals: SignalFeedbackResult[]): FeedbackAccumulator {
  const detectorStats: FeedbackAccumulator['detectorStats'] = {};
  const wavefunctionStats: FeedbackAccumulator['wavefunctionStats'] = {};

  let total = closedSignals.length;
  let wins = 0;
  let losses = 0;
  let expired = 0;

  for (const sig of closedSignals) {
    if (sig.result === 'WIN') wins++;
    else if (sig.result === 'LOSS') losses++;
    else expired++;

    // По детектору
    if (!detectorStats[sig.top_detector]) {
      detectorStats[sig.top_detector] = { total: 0, wins: 0, losses: 0, expired: 0, winRate: 0 };
    }
    const ds = detectorStats[sig.top_detector];
    ds.total++;
    if (sig.result === 'WIN') ds.wins++;
    else if (sig.result === 'LOSS') ds.losses++;
    else ds.expired++;
    ds.winRate = ds.total > 0 ? ds.wins / ds.total : 0;

    // По wavefunction
    const wfKey = sig.wavefunction_state;
    if (!wavefunctionStats[wfKey]) {
      wavefunctionStats[wfKey] = { total: 0, wins: 0, losses: 0, winRate: 0 };
    }
    const ws = wavefunctionStats[wfKey];
    ws.total++;
    if (sig.result === 'WIN') ws.wins++;
    else if (sig.result === 'LOSS') ws.losses++;
    ws.winRate = ws.total > 0 ? ws.wins / ws.total : 0;
  }

  return {
    detectorStats,
    wavefunctionStats,
    total,
    wins,
    losses,
    expired,
    overallWinRate: total > 0 ? wins / total : 0,
  };
}

/**
 * Генерирует рекомендации по корректировке весов на основе feedback.
 *
 * Правила (из спецификации):
 * - Детектор с win_rate > 60% → увеличить вес
 * - Детектор с win_rate < 40% → уменьшить вес
 * - Минимум 30+ сигналов для корректировки
 *
 * WAVEFUNCTION feedback:
 * - ACCUMULATE → WIN → усиливаем переход +0.01
 * - DISTRIBUTE → WIN → усиливаем переход +0.01
 * - ACCUMULATE → LOSS → ослабляем -0.01
 */
export function generateWeightAdjustments(
  stats: FeedbackAccumulator,
): Array<{ detector: string; adjustment: number; reason: string }> {
  const adjustments: Array<{ detector: string; adjustment: number; reason: string }> = [];

  for (const [detector, ds] of Object.entries(stats.detectorStats)) {
    if (ds.total < 30) continue; // Недостаточно данных

    if (ds.winRate > 0.6) {
      adjustments.push({
        detector,
        adjustment: 0.01,
        reason: `${detector}: win_rate ${(ds.winRate * 100).toFixed(1)}% > 60% (${ds.wins}/${ds.total})`,
      });
    } else if (ds.winRate < 0.4) {
      adjustments.push({
        detector,
        adjustment: -0.01,
        reason: `${detector}: win_rate ${(ds.winRate * 100).toFixed(1)}% < 40% (${ds.wins}/${ds.total})`,
      });
    }
  }

  return adjustments;
}

// ─── Утилита: преобразование TradeSignal → SignalFeedbackResult ──────────────

export function signalToFeedbackResult(signal: TradeSignal): SignalFeedbackResult | null {
  if (signal.state !== 'CLOSED' || !signal.close_reason || !signal.result) return null;

  return {
    signal_id: signal.signal_id,
    ticker: signal.ticker,
    direction: signal.direction,
    entry_price: signal.entry_price,
    stop_loss: signal.stopLoss,
    target: signal.targets[0],
    generated_at: signal.createdAt.getTime(),
    wavefunction_state: signal.wavefunction_state,
    top_detector: signal.top_detector,
    bsci: signal.bsciAtCreation,
    convergence: signal.convergence,
    closed_at: (signal.snapshots[signal.snapshots.length - 1]?.timestamp || signal.createdAt).getTime(),
    close_reason: signal.close_reason,
    close_price: signal.close_price || 0,
    pnl_ticks: signal.pnl_ticks || 0,
    result: signal.result,
  };
}
