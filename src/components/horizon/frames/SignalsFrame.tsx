'use client';

// ─── SignalsFrame.tsx — Фрейм торговых сигналов ─────────────────────────────
// Sprint 4 (v4.1): Карточки LONG/SHORT/AWAIT/BREAKOUT
// Confidence breakdown, Entry/Stop/Targets, TTL countdown, Корреляция

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Zap, Clock, TrendingUp, TrendingDown, Hourglass, Link2, Target, ShieldAlert, BarChart3 } from 'lucide-react';
import { useSignalStore, getFilteredSignals, groupSignalsByType, type SignalSortBy } from '@/lib/horizon/signals/signal-store';
import type { TradeSignal, SignalType, SignalDirection } from '@/lib/horizon/signals/signal-generator';
import { formatTTLRemaining } from '@/lib/horizon/signals/moex-sessions';

// ─── Signal Type Config ──────────────────────────────────────────────────────

const SIGNAL_TYPE_CONFIG: Record<SignalType, {
  icon: React.ReactNode;
  label: string;
  labelRu: string;
  bg: string;
  border: string;
  text: string;
  glow: string;
}> = {
  LONG: {
    icon: <TrendingUp className="w-4 h-4" />,
    label: 'LONG',
    labelRu: 'ЛОНГ',
    bg: 'bg-green-500/10',
    border: 'border-green-500/40',
    text: 'text-green-400',
    glow: 'shadow-green-500/20',
  },
  SHORT: {
    icon: <TrendingDown className="w-4 h-4" />,
    label: 'SHORT',
    labelRu: 'ШОРТ',
    bg: 'bg-red-500/10',
    border: 'border-red-500/40',
    text: 'text-red-400',
    glow: 'shadow-red-500/20',
  },
  AWAIT: {
    icon: <Hourglass className="w-4 h-4" />,
    label: 'AWAIT',
    labelRu: 'ОЖИДАНИЕ',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/40',
    text: 'text-yellow-400',
    glow: 'shadow-yellow-500/20',
  },
  BREAKOUT: {
    icon: <Zap className="w-4 h-4" />,
    label: 'BREAKOUT',
    labelRu: 'ПРОРЫВ',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/40',
    text: 'text-purple-400',
    glow: 'shadow-purple-500/20',
  },
};

const RESULT_CONFIG: Record<string, { label: string; color: string }> = {
  WIN: { label: 'WIN', color: 'text-green-400' },
  LOSS: { label: 'LOSS', color: 'text-red-400' },
  EXPIRED: { label: 'EXPIRED', color: 'text-[var(--terminal-muted)]' },
};

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Confidence Bar — визуальный breakdown уверенности */
function ConfidenceBar({ signal }: { signal: TradeSignal }) {
  const bd = signal.confidenceBreakdown;
  if (!bd) return null;

  const segments = [
    { label: 'BSCI', value: bd.bsci, max: 30, color: 'bg-blue-500' },
    { label: 'Conv', value: bd.convergence, max: 25, color: 'bg-green-500' },
    { label: 'RSI', value: bd.rsiCrsi, max: 20, color: 'bg-cyan-500' },
    { label: 'Robot', value: bd.robots, max: 15, color: 'bg-purple-500' },
    { label: 'Div', value: Math.max(0, bd.divergence), max: 15, color: 'bg-yellow-500' },
  ];

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[6px] text-[var(--terminal-muted)] font-mono">CONFIDENCE</span>
        <span className={`text-[9px] font-mono font-bold ${
          signal.confidence >= 80 ? 'text-green-400' :
          signal.confidence >= 60 ? 'text-yellow-400' :
          signal.confidence >= 40 ? 'text-orange-400' : 'text-red-400'
        }`}>
          {signal.confidence.toFixed(1)}%
        </span>
      </div>
      {/* Stacked bar */}
      <div className="flex h-1.5 w-full bg-[var(--terminal-border)] rounded-full overflow-hidden">
        {segments.map((seg, i) => {
          const width = Math.min((seg.value / 100) * 100, 100);
          return width > 0 ? (
            <div
              key={i}
              className={`${seg.color} h-full`}
              style={{ width: `${width}%` }}
              title={`${seg.label}: ${seg.value.toFixed(1)}`}
            />
          ) : null;
        })}
      </div>
      {/* Labels */}
      <div className="flex justify-between text-[5px] text-[var(--terminal-muted)] font-mono">
        {segments.map((seg, i) => (
          <span key={i}>{seg.label} {seg.value.toFixed(0)}</span>
        ))}
      </div>
      {/* Divergence conditional */}
      {bd.divergenceConditional === 'negative' && (
        <div className="text-[5px] text-red-400 font-mono">
          Div: -10 (topDet &lt; 0.85)
        </div>
      )}
      {bd.falseBreakoutModifier < 1 && bd.falseBreakoutModifier > 0 && (
        <div className="text-[5px] text-orange-400 font-mono">
          FB modifier: {(bd.falseBreakoutModifier * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}

/** Levels Row — Entry / Stop / T1 / T2 / T3 */
function LevelsRow({ signal }: { signal: TradeSignal }) {
  const isLong = signal.direction === 'LONG';
  const fmt = (v: number) => v.toFixed(2);

  return (
    <div className="grid grid-cols-5 gap-1 text-[6px] font-mono">
      <div className="text-center">
        <div className="text-[var(--terminal-muted)]">ENTRY</div>
        <div className="text-[var(--terminal-text)]">{fmt(signal.entry_price)}</div>
      </div>
      <div className="text-center">
        <div className="text-red-400/70">STOP</div>
        <div className="text-red-400">{fmt(signal.stopLoss)}</div>
      </div>
      <div className="text-center">
        <div className="text-green-400/70">T1</div>
        <div className="text-green-400">{fmt(signal.targets[0])}</div>
      </div>
      <div className="text-center">
        <div className="text-green-400/50">T2</div>
        <div className="text-green-400/80">{fmt(signal.targets[1])}</div>
      </div>
      <div className="text-center">
        <div className="text-green-400/30">T3</div>
        <div className="text-green-400/60">{fmt(signal.targets[2])}</div>
      </div>
    </div>
  );
}

/** TTL Countdown — показывает сколько осталось до экспирации */
function TTLCountdown({ expiresAt }: { expiresAt: Date }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  const remaining = expiresAt.getTime() - now.getTime();
  const ttlStr = formatTTLRemaining(expiresAt, now);
  const isUrgent = remaining < 15 * 60 * 1000; // < 15 мин
  const isExpired = remaining <= 0;

  return (
    <span className={`text-[7px] font-mono flex items-center gap-0.5 ${
      isExpired ? 'text-red-400' : isUrgent ? 'text-orange-400 animate-pulse' : 'text-[var(--terminal-muted)]'
    }`}>
      <Clock className="w-2.5 h-2.5" />
      {isExpired ? 'EXPIRED' : ttlStr}
    </span>
  );
}

/** Signal Card — основная карточка сигнала */
function SignalCard({ signal, isSelected, onClick }: {
  signal: TradeSignal;
  isSelected: boolean;
  onClick: () => void;
}) {
  const config = SIGNAL_TYPE_CONFIG[signal.type];
  const resultConfig = signal.result ? RESULT_CONFIG[signal.result] : null;

  return (
    <div
      onClick={onClick}
      className={`
        border rounded-sm p-2 cursor-pointer transition-all
        ${config.border} ${config.bg}
        ${isSelected ? `ring-1 ring-[var(--terminal-accent)] shadow-lg ${config.glow}` : 'hover:ring-1 hover:ring-[var(--terminal-border)]'}
        ${signal.state === 'CLOSED' ? 'opacity-60' : ''}
      `}
    >
      {/* Header: Type + Ticker + TTL */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`${config.text}`}>{config.icon}</span>
          <span className={`text-[10px] font-mono font-bold ${config.text}`}>
            {config.labelRu}
          </span>
          <span className="text-[9px] font-mono text-[var(--terminal-text)] font-bold">
            {signal.ticker}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {signal.correlatedWith && signal.correlatedWith.length > 0 && (
            <span className="text-[6px] text-cyan-400 font-mono flex items-center gap-0.5"
              title={`Связано с: ${signal.correlatedWith.join(', ')} (${signal.correlationType})`}>
              <Link2 className="w-2 h-2" />
              {signal.correlationType === 'SAME_ISSUER' ? 'эмитент' : signal.correlationType}
            </span>
          )}
          {signal.state === 'ACTIVE' ? (
            <TTLCountdown expiresAt={new Date(signal.expiresAt)} />
          ) : resultConfig ? (
            <span className={`text-[7px] font-mono font-bold ${resultConfig.color}`}>
              {resultConfig.label}
            </span>
          ) : null}
        </div>
      </div>

      {/* Trigger */}
      <div className="text-[7px] text-[var(--terminal-text-dim)] font-mono mb-1.5 truncate"
        title={signal.trigger}>
        <Target className="w-2 h-2 inline mr-0.5" />
        {signal.trigger}
      </div>

      {/* Confidence Bar */}
      <ConfidenceBar signal={signal} />

      {/* Levels */}
      <div className="mt-1.5 pt-1.5 border-t border-[var(--terminal-border)]/30">
        <LevelsRow signal={signal} />
        {/* R:R Ratio */}
        <div className="flex items-center justify-between mt-1 text-[6px] font-mono">
          <span className="text-[var(--terminal-muted)]">R:R</span>
          <span className={signal.riskRewardRatio >= 2 ? 'text-green-400' : signal.riskRewardRatio >= 1.5 ? 'text-yellow-400' : 'text-red-400'}>
            1:{signal.riskRewardRatio.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Confirmations & Divergences */}
      <div className="mt-1.5 pt-1.5 border-t border-[var(--terminal-border)]/30 space-y-0.5">
        {signal.confirmations.slice(0, 3).map((c, i) => (
          <div key={i} className="text-[6px] text-green-400/70 font-mono flex items-start gap-0.5">
            <span className="shrink-0">+</span>
            <span>{c}</span>
          </div>
        ))}
        {signal.divergences.slice(0, 2).map((d, i) => (
          <div key={i} className="text-[6px] text-red-400/70 font-mono flex items-start gap-0.5">
            <ShieldAlert className="w-2 h-2 shrink-0 mt-0.5" />
            <span>{d}</span>
          </div>
        ))}
      </div>

      {/* Exit Conditions (triggered) */}
      {signal.exitConditions.filter(e => e.triggered).length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-[var(--terminal-border)]/30">
          <div className="text-[6px] text-orange-400 font-mono font-bold mb-0.5">EXIT WARNINGS:</div>
          {signal.exitConditions.filter(e => e.triggered).map((e, i) => (
            <div key={i} className="text-[5px] text-orange-400/70 font-mono">
              {e.type}: {e.description}
            </div>
          ))}
        </div>
      )}

      {/* Wavefunction State */}
      <div className="mt-1.5 flex items-center justify-between text-[6px] font-mono text-[var(--terminal-muted)]">
        <span>WF: {signal.wavefunction_state}</span>
        <span>BSCI: {signal.bsciAtCreation.toFixed(2)} | Conv: {signal.convergence}/10</span>
      </div>

      {/* P&L (for closed signals) */}
      {signal.state === 'CLOSED' && signal.pnl_ticks !== undefined && (
        <div className={`mt-1 text-[8px] font-mono font-bold ${
          signal.pnl_ticks > 0 ? 'text-green-400' : signal.pnl_ticks < 0 ? 'text-red-400' : 'text-[var(--terminal-muted)]'
        }`}>
          P&L: {signal.pnl_ticks > 0 ? '+' : ''}{signal.pnl_ticks.toFixed(2)} ticks
          {signal.close_reason && <span className="text-[var(--terminal-muted)] font-normal ml-1">({signal.close_reason})</span>}
        </div>
      )}
    </div>
  );
}

// ─── Main SignalsFrame ───────────────────────────────────────────────────────

export function SignalsFrame() {
  const activeSignals = useSignalStore((s) => s.activeSignals);
  const signalHistory = useSignalStore((s) => s.signalHistory);
  const filters = useSignalStore((s) => s.filters);
  const sortBy = useSignalStore((s) => s.sortBy);
  const loading = useSignalStore((s) => s.loading);
  const selectedSignal = useSignalStore((s) => s.selectedSignal);
  const feedbackStats = useSignalStore((s) => s.feedbackStats);

  const fetchActiveSignals = useSignalStore((s) => s.fetchActiveSignals);
  const fetchSignalHistory = useSignalStore((s) => s.fetchSignalHistory);
  const selectSignal = useSignalStore((s) => s.selectSignal);
  const setFilters = useSignalStore((s) => s.setFilters);
  const setSortBy = useSignalStore((s) => s.setSortBy);

  const [showHistory, setShowHistory] = useState(false);
  const [now, setNow] = useState(new Date());

  // Fetch signals on mount + interval
  useEffect(() => {
    fetchActiveSignals();
    const interval = setInterval(() => {
      fetchActiveSignals();
    }, 30000); // каждые 30 сек
    return () => clearInterval(interval);
  }, [fetchActiveSignals]);

  // Current time ticker
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Filtered & sorted signals
  const filteredSignals = useMemo(() => {
    const source = showHistory ? signalHistory : activeSignals;
    return getFilteredSignals(source, filters, sortBy);
  }, [activeSignals, signalHistory, showHistory, filters, sortBy]);

  // Grouped by type
  const grouped = useMemo(() => groupSignalsByType(filteredSignals), [filteredSignals]);

  // Summary
  const summary = useMemo(() => {
    const active = activeSignals.filter(s => s.state === 'ACTIVE');
    return {
      total: active.length,
      longs: active.filter(s => s.type === 'LONG').length,
      shorts: active.filter(s => s.type === 'SHORT').length,
      awaits: active.filter(s => s.type === 'AWAIT').length,
      breakouts: active.filter(s => s.type === 'BREAKOUT').length,
      avgConfidence: active.length > 0
        ? active.reduce((s, sig) => s + sig.confidence, 0) / active.length
        : 0,
    };
  }, [activeSignals]);

  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Type filter chips
  const typeChips: { type: SignalType | ''; label: string }[] = [
    { type: '', label: 'все' },
    { type: 'LONG', label: 'лонг' },
    { type: 'SHORT', label: 'шорт' },
    { type: 'AWAIT', label: 'ожид' },
    { type: 'BREAKOUT', label: 'прорыв' },
  ];

  const sortOptions: { value: SignalSortBy; label: string }[] = [
    { value: 'confidence', label: 'Conf' },
    { value: 'convergence', label: 'Conv' },
    { value: 'bsci', label: 'BSCI' },
    { value: 'ttl', label: 'TTL' },
    { value: 'createdAt', label: 'Время' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <Zap className="w-3 h-3 text-purple-400" />
        <span className="text-[9px] text-purple-400 font-mono font-bold tracking-wide uppercase">
          СИГНАЛЫ
        </span>

        {/* Active / History toggle */}
        <div className="flex items-center ml-2 gap-0.5">
          <button
            onClick={() => { setShowHistory(false); fetchActiveSignals(); }}
            className={`text-[7px] font-mono px-1.5 py-0.5 rounded-sm transition-colors ${
              !showHistory
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                : 'bg-transparent text-[var(--terminal-muted)] border border-transparent hover:border-[var(--terminal-border)]'
            }`}
          >
            Активные
          </button>
          <button
            onClick={() => { setShowHistory(true); fetchSignalHistory(); }}
            className={`text-[7px] font-mono px-1.5 py-0.5 rounded-sm transition-colors ${
              showHistory
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40'
                : 'bg-transparent text-[var(--terminal-muted)] border border-transparent hover:border-[var(--terminal-border)]'
            }`}
          >
            История
          </button>
        </div>

        <span className="text-[7px] text-[var(--terminal-muted)] font-mono ml-auto">
          {timeStr}
        </span>
      </div>

      {/* Filter + Sort bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--terminal-border)] shrink-0">
        {/* Type filter chips */}
        {typeChips.map((chip) => (
          <button
            key={chip.type}
            onClick={() => setFilters({ type: chip.type })}
            className={`text-[7px] font-mono px-1.5 py-0.5 rounded-sm transition-colors ${
              filters.type === chip.type
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                : 'bg-transparent text-[var(--terminal-muted)] border border-transparent hover:border-[var(--terminal-border)]'
            }`}
          >
            {chip.label}
          </button>
        ))}

        <span className="text-[var(--terminal-border)] mx-1">|</span>

        {/* Sort options */}
        {sortOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSortBy(opt.value)}
            className={`text-[7px] font-mono px-1 py-0.5 rounded-sm transition-colors ${
              sortBy === opt.value
                ? 'bg-purple-500/15 text-purple-400'
                : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text-dim)]'
            }`}
          >
            {opt.label}
          </button>
        ))}

        {/* Ticker search */}
        <input
          type="text"
          placeholder="тикер..."
          value={filters.ticker}
          onChange={(e) => setFilters({ ticker: e.target.value })}
          className="ml-1 w-16 text-[7px] font-mono bg-transparent border border-[var(--terminal-border)] rounded-sm px-1 py-0.5 text-[var(--terminal-text)] placeholder:text-[var(--terminal-muted)]/50 focus:outline-none focus:border-purple-500/40"
        />
      </div>

      {/* Signals Grid */}
      <div className="flex-1 overflow-y-auto terminal-scroll p-2">
        {loading && filteredSignals.length === 0 ? (
          <div className="text-[7px] text-[var(--terminal-muted)] font-mono text-center py-4">
            Загрузка сигналов...
          </div>
        ) : filteredSignals.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-[9px] text-[var(--terminal-muted)] font-mono">
              {showHistory ? 'Нет исторических сигналов' : 'Нет активных сигналов'}
            </div>
            {!showHistory && (
              <div className="text-[7px] text-[var(--terminal-muted)]/60 font-mono mt-2">
                Тишина = норма. Сигналы генерируются при BSCI &ge; 0.45, Conv &ge; 5, TopDet &ge; 0.75
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            {filteredSignals.map((signal) => (
              <SignalCard
                key={signal.signal_id}
                signal={signal}
                isSelected={selectedSignal?.signal_id === signal.signal_id}
                onClick={() => selectSignal(
                  selectedSignal?.signal_id === signal.signal_id ? null : signal,
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer summary */}
      <div className="flex items-center gap-2 px-2 py-1 border-t border-[var(--terminal-border)] bg-[var(--terminal-surface)]/30 shrink-0 text-[6px] font-mono text-[var(--terminal-muted)]">
        <span className="text-green-400">лонг: {summary.longs}</span>
        <span className="text-red-400">шорт: {summary.shorts}</span>
        <span className="text-yellow-400">ожид: {summary.awaits}</span>
        <span className="text-purple-400">прорыв: {summary.breakouts}</span>
        <span className="text-[var(--terminal-text-dim)]">всего: {summary.total}</span>
        {summary.avgConfidence > 0 && (
          <span>ср.Conf: {summary.avgConfidence.toFixed(0)}%</span>
        )}
        {feedbackStats && feedbackStats.total > 0 && (
          <>
            <span className="text-[var(--terminal-border)]">|</span>
            <span>
              WR: <span className={feedbackStats.winRate >= 0.6 ? 'text-green-400' : feedbackStats.winRate >= 0.4 ? 'text-yellow-400' : 'text-red-400'}>
                {(feedbackStats.winRate * 100).toFixed(0)}%
              </span>
              ({feedbackStats.wins}/{feedbackStats.total})
            </span>
          </>
        )}
        <span className="ml-auto">
          Пороги: BSCI&ge;0.45 | Conv&ge;5 | TopDet&ge;0.75
        </span>
      </div>
    </div>
  );
}
