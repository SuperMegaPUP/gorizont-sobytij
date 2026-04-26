'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { ScanSearch, List, Trophy } from 'lucide-react';
import { useHorizonStore, type ScannerMode, type ScannerTicker } from '@/lib/horizon-store';
import { getBsciEmoji, getBsciColor } from '../shared/BSCIColor';
import { DirectionArrow } from '../shared/DirectionArrow';
import { DetectorDots } from '../scanner/DetectorDots';

type FilterMode = 'all' | 'alert' | 'bear' | 'bull';

// ─── Convergence Cell Component ────────────────────────────────────────────

interface ConvergenceCellProps {
  taContext?: ScannerTicker['taContext'];
  convergenceScore?: ScannerTicker['convergenceScore'];
  robotContext?: ScannerTicker['robotContext'];
}

function ConvergenceCell({ taContext, convergenceScore, robotContext }: ConvergenceCellProps) {
  if (!taContext) {
    return <span className="text-[var(--terminal-muted)]">—</span>;
  }

  const { signal, divergence, indicators } = taContext;

  // Signal label + color
  const signalConfig: Record<string, { label: string; color: string; bg: string }> = {
    STRONG_BULL: { label: '▲▲', color: 'text-green-400', bg: 'bg-green-500/10' },
    BULL:       { label: '▲',  color: 'text-green-400/70', bg: 'bg-green-500/5' },
    NEUTRAL:    { label: '—',  color: 'text-[var(--terminal-muted)]', bg: '' },
    BEAR:       { label: '▼',  color: 'text-red-400/70', bg: 'bg-red-500/5' },
    STRONG_BEAR: { label: '▼▼', color: 'text-red-400', bg: 'bg-red-500/10' },
  };

  const cfg = signalConfig[signal] || signalConfig.NEUTRAL;

  // Convergence score badge (X/10)
  const convScore = convergenceScore?.score;
  const convBadge = convScore !== undefined ? (
    <span className={`text-[6px] font-bold ${
      convScore >= 7 ? 'text-green-400' : convScore >= 4 ? 'text-yellow-400' : 'text-red-400'
    }`}>{convScore}/10</span>
  ) : null;

  // Divergence flash
  const divergenceMark = divergence ? (
    <span className="text-yellow-400 ml-0.5" title={taContext.divergenceNote}>⚡</span>
  ) : null;

  // Robot confirmation indicator (🤖)
  const robotMark = robotContext && robotContext.confirmation >= 0.4 ? (
    <span className="text-cyan-400" title={`Робот-подтверждение: ${robotContext.confirmation.toFixed(2)} | ${robotContext.matchedDetector} ↔ ${robotContext.matchedPattern} | Робот%: ${(robotContext.robotVolumePct * 100).toFixed(0)}%`}>🤖</span>
  ) : null;

  // Spoofing penalty indicator (🚫)
  const spoofingMark = robotContext?.hasSpoofing ? (
    <span className="text-red-400" title={`СПУФИНГ! Cancel%: ${(robotContext.cancelRatio * 100).toFixed(0)}% → −2 конвергенция`}>🚫</span>
  ) : null;

  // Cancel penalty indicator
  const cancelMark = robotContext && robotContext.cancelRatio > 0.8 && !robotContext.hasSpoofing ? (
    <span className="text-orange-400" title={`Cancel ${(robotContext.cancelRatio * 100).toFixed(0)}% > 80% → −1 конвергенция`}>⚠</span>
  ) : null;

  // ATR zone indicator
  const atrMark = indicators.atrZone === 'COMPRESSED'
    ? <span className="text-blue-400" title="ATR: сжатие перед прорывом">⊕</span>
    : indicators.atrZone === 'EXPANDED'
      ? <span className="text-orange-400" title="ATR: расширенная волатильность">⊗</span>
      : null;

  // RSI zone
  const rsiLabel = indicators.rsiZone === 'OVERSOLD'
    ? <span className="text-green-400" title={`RSI ${indicators.rsi}`}>OS</span>
    : indicators.rsiZone === 'OVERBOUGHT'
      ? <span className="text-red-400" title={`RSI ${indicators.rsi}`}>OB</span>
      : null;

  return (
    <span className={`inline-flex items-center gap-0.5 px-0.5 rounded-sm ${cfg.bg} ${cfg.color}`} title={convergenceScore?.summary || taContext.divergenceNote || `${signal} | RSI=${indicators.rsi} CMF=${indicators.cmf} ATR%=${(indicators.atrPercentile * 100).toFixed(0)}`}>
      <span>{cfg.label}</span>
      {convBadge}
      {robotMark}
      {spoofingMark}
      {cancelMark}
      {divergenceMark}
      {atrMark}
      {rsiLabel}
    </span>
  );
}

// ─── Main Scanner Frame ─────────────────────────────────────────────────────

export function HorizonScannerFrame() {
  const scannerData = useHorizonStore((s) => s.scannerData);
  const scannerSortBy = useHorizonStore((s) => s.scannerSortBy);
  const scannerMode = useHorizonStore((s) => s.scannerMode);
  const top100Data = useHorizonStore((s) => s.top100Data);
  const top100Loading = useHorizonStore((s) => s.top100Loading);
  const lastTop100Update = useHorizonStore((s) => s.lastTop100Update);

  const selectTicker = useHorizonStore((s) => s.selectTicker);
  const fetchScanner = useHorizonStore((s) => s.fetchScanner);
  const fetchTop100 = useHorizonStore((s) => s.fetchTop100);
  const setScannerMode = useHorizonStore((s) => s.setScannerMode);
  const setScannerSortBy = useHorizonStore((s) => s.setScannerSortBy);
  const loading = useHorizonStore((s) => s.loading);
  const lastScannerUpdate = useHorizonStore((s) => s.lastScannerUpdate);
  const marketClosed = useHorizonStore((s) => s.marketClosed);
  const sessionInfo = useHorizonStore((s) => s.sessionInfo);

  const [filter, setFilter] = useState<FilterMode>('all');
  const [countdown, setCountdown] = useState(30);
  const [now, setNow] = useState(new Date());

  // Current data source based on mode
  const currentData = scannerMode === 'top100' ? top100Data : scannerData;
  const isLoading = scannerMode === 'top100' ? top100Loading : loading;
  const lastUpdate = scannerMode === 'top100' ? lastTop100Update : lastScannerUpdate;

  // Fetch on mount + interval
  useEffect(() => {
    if (scannerMode === 'core') {
      fetchScanner();
      const interval = setInterval(() => {
        fetchScanner();
        setCountdown(30);
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [fetchScanner, scannerMode]);

  // Fetch TOP-100 on mode switch (only if no data yet)
  useEffect(() => {
    if (scannerMode === 'top100' && top100Data.length === 0 && !top100Loading) {
      fetchTop100();
    }
  }, [scannerMode, top100Data.length, top100Loading, fetchTop100]);

  // Auto-refresh TOP-100 every 5 min when in top100 mode
  useEffect(() => {
    if (scannerMode !== 'top100') return;
    const interval = setInterval(() => {
      if (!lastTop100Update || Date.now() - lastTop100Update > 5 * 60 * 1000) {
        fetchTop100();
      }
    }, 60 * 1000); // check every minute
    return () => clearInterval(interval);
  }, [scannerMode, lastTop100Update, fetchTop100]);

  // Reset on filter change
  // (no pagination needed — all items shown in scroll)

  // Countdown timer
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  // Current time
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Filter + sort
  const filtered = useMemo(() => {
    let data = [...currentData];
    if (filter === 'alert') data = data.filter((t) => t.alertLevel === 'ORANGE' || t.alertLevel === 'RED');
    else if (filter === 'bear') data = data.filter((t) => t.direction === 'BEARISH');
    else if (filter === 'bull') data = data.filter((t) => t.direction === 'BULLISH');

    // Sort
    data.sort((a, b) => {
      switch (scannerSortBy) {
        case 'bsci': return b.bsci - a.bsci;
        case 'vpin': return b.vpin - a.vpin;
        case 'delta': return b.cumDelta - a.cumDelta;
        case 'turnover': {
          // TOP-100: use moexTurnover (VALTODAY) if available, else fallback to turnover
          const aVal = (a as any).moexTurnover || a.turnover;
          const bVal = (b as any).moexTurnover || b.turnover;
          return bVal - aVal;
        }
        default: return b.bsci - a.bsci;
      }
    });
    return data;
  }, [currentData, filter, scannerSortBy]);

  // Display data: show all items (scrollable)
  const displayData = useMemo(() => {
    return filtered; // Show all tickers — scrollable table
  }, [filtered]);

  // Summary
  const summary = useMemo(() => {
    const green = currentData.filter((t) => t.alertLevel === 'GREEN').length;
    const yellow = currentData.filter((t) => t.alertLevel === 'YELLOW').length;
    const orange = currentData.filter((t) => t.alertLevel === 'ORANGE').length;
    const red = currentData.filter((t) => t.alertLevel === 'RED').length;
    const top3 = [...currentData].sort((a, b) => b.bsci - a.bsci).slice(0, 3).map((t) => t.ticker).join(', ');
    const bullCount = currentData.filter((t) => t.direction === 'BULLISH').length;
    const bearCount = currentData.filter((t) => t.direction === 'BEARISH').length;
    const sentiment = bullCount > bearCount ? 'бычий' : bearCount > bullCount ? 'медвежий' : 'нейтр';
    const avgBsci = currentData.length > 0 ? currentData.reduce((s, t) => s + t.bsci, 0) / currentData.length : 0;
    return { green, yellow, orange, red, total: currentData.length, top3, sentiment, avgBsci };
  }, [currentData]);

  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const filterChips: { mode: FilterMode; label: string }[] = [
    { mode: 'all', label: 'все' },
    { mode: 'alert', label: 'тревога' },
    { mode: 'bear', label: '\u25BC медведи' },
    { mode: 'bull', label: '\u25B2 быки' },
  ];

  const sortOptions: { value: typeof scannerSortBy; label: string }[] = [
    { value: 'bsci', label: 'BSCI' },
    { value: 'vpin', label: 'VPIN' },
    { value: 'delta', label: 'Delta' },
    { value: 'turnover', label: 'Оборот' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <ScanSearch className="w-3 h-3 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide uppercase">
          СКАНЕР
        </span>

        {/* Mode switcher */}
        <div className="flex items-center ml-2 gap-0.5">
          <button
            onClick={() => setScannerMode('core')}
            className={`text-[7px] font-mono px-1.5 py-0.5 rounded-sm transition-colors ${
              scannerMode === 'core'
                ? 'bg-[var(--terminal-accent)]/20 text-[var(--terminal-accent)] border border-[var(--terminal-accent)]/40'
                : 'bg-transparent text-[var(--terminal-muted)] border border-transparent hover:border-[var(--terminal-border)]'
            }`}
          >
            <List className="w-2 h-2 inline mr-0.5" />
            9
          </button>
          <button
            onClick={() => setScannerMode('top100')}
            className={`text-[7px] font-mono px-1.5 py-0.5 rounded-sm transition-colors ${
              scannerMode === 'top100'
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                : 'bg-transparent text-[var(--terminal-muted)] border border-transparent hover:border-[var(--terminal-border)]'
            }`}
          >
            <Trophy className="w-2 h-2 inline mr-0.5" />
            ТОП 100
          </button>
        </div>

        <span className="text-[7px] text-[var(--terminal-muted)] font-mono ml-auto">
          {isLoading ? '...' : `${countdown}s`}
        </span>
        <span className="text-[7px] text-[var(--terminal-muted)] font-mono">
          {timeStr}
        </span>
      </div>

      {/* Market closed banner */}
      {marketClosed && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/10 border-b border-blue-500/20 shrink-0">
          <span className="text-[8px] text-blue-400 font-mono">🔒</span>
          <span className="text-[7px] text-blue-300 font-mono">Рынок закрыт</span>
          {sessionInfo && (
            <span className="text-[6px] text-blue-400/70 font-mono">({sessionInfo})</span>
          )}
          <span className="text-[6px] text-[var(--terminal-muted)] font-mono ml-1">— данные за последний торговый день</span>
        </div>
      )}

      {/* Filter + Sort bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--terminal-border)] shrink-0">
        {/* Filter chips */}
        {filterChips.map((chip) => (
          <button
            key={chip.mode}
            onClick={() => setFilter(chip.mode)}
            className={`text-[7px] font-mono px-1.5 py-0.5 rounded-sm transition-colors ${
              filter === chip.mode
                ? 'bg-[var(--terminal-accent)]/20 text-[var(--terminal-accent)] border border-[var(--terminal-accent)]/40'
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
            onClick={() => setScannerSortBy(opt.value)}
            className={`text-[7px] font-mono px-1 py-0.5 rounded-sm transition-colors ${
              scannerSortBy === opt.value
                ? 'bg-[var(--terminal-accent)]/15 text-[var(--terminal-accent)]'
                : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text-dim)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto terminal-scroll">
        {isLoading && currentData.length === 0 ? (
          <div className="text-[7px] text-[var(--terminal-muted)] font-mono text-center py-3">
            {scannerMode === 'top100' ? 'Сканирование ТОП 100 (~30 сек)...' : 'Загрузка сканера...'}
          </div>
        ) : displayData.length === 0 ? (
          <div className="text-[7px] text-[var(--terminal-muted)] font-mono text-center py-3">
            {scannerMode === 'top100' && !top100Loading ? (
              <button
                onClick={() => fetchTop100()}
                className="text-[var(--terminal-accent)] hover:underline"
              >
                Нет данных. Нажмите для сканирования ТОП 100
              </button>
            ) : (
              'Нет данных'
            )}
          </div>
        ) : (
          <table className="w-full text-[7px] font-mono">
            <thead>
              <tr className="text-[var(--terminal-muted)] border-b border-[var(--terminal-border)]">
                <th className="text-left px-1.5 py-0.5 font-normal w-6">#</th>
                <th className="text-left px-1.5 py-0.5 font-normal">Тикер</th>
                <th className="text-left px-1.5 py-0.5 font-normal">BSCI</th>
                <th className="text-left px-1.5 py-0.5 font-normal">Детекторы</th>
                <th className="text-center px-1 py-0.5 font-normal">Напр.</th>
                <th className="text-left px-1.5 py-0.5 font-normal">Конверг.</th>
                <th className="text-left px-1.5 py-0.5 font-normal">Ключ.сигнал</th>
                <th className="text-center px-1 py-0.5 font-normal">Действие</th>
              </tr>
            </thead>
            <tbody>
              {displayData.map((ticker, idx) => {
                const globalIdx = idx + 1;
                const bsciColor = getBsciColor(ticker.bsci);
                const bsciEmoji = getBsciEmoji(ticker.bsci);
                const actionStyle = ticker.action === 'URGENT'
                  ? 'text-red-400 font-bold'
                  : ticker.action === 'ALERT'
                    ? 'text-orange-400'
                    : 'text-[var(--terminal-muted)]';

                // Rank badge for TOP 100
                const isTop3 = globalIdx <= 3 && scannerMode === 'top100';
                // Divergence flag — subtle highlight
                const hasDivergence = ticker.taContext?.divergence === true;

                return (
                  <tr
                    key={ticker.ticker}
                    onClick={() => selectTicker(ticker.ticker)}
                    className={`border-b border-[var(--terminal-border)]/30 hover:bg-[var(--terminal-surface-hover)]/50 cursor-pointer transition-colors ${
                      isTop3 ? 'bg-yellow-500/5' : ''
                    } ${hasDivergence ? 'border-l-2 border-l-yellow-500/60' : ''}`}
                    title={hasDivergence ? ticker.taContext?.divergenceNote : undefined}
                  >
                    <td className="px-1.5 py-0.5 text-[var(--terminal-muted)]">
                      {isTop3 ? (
                        <span className={globalIdx === 1 ? 'text-yellow-400' : globalIdx === 2 ? 'text-gray-300' : 'text-orange-400'}>
                          {globalIdx}
                        </span>
                      ) : (
                        globalIdx
                      )}
                    </td>
                    <td className="px-1.5 py-0.5">
                      <span className="text-[var(--terminal-text)] font-bold">{ticker.ticker}</span>
                      <span className="text-[var(--terminal-muted)] ml-1 hidden xl:inline">{ticker.name}</span>
                    </td>
                    <td className="px-1.5 py-0.5">
                      <div className="flex items-center gap-1">
                        <span>{bsciEmoji}</span>
                        <span className={bsciColor.text}>{ticker.bsci.toFixed(2)}</span>
                        {/* Mini bar */}
                        <div className="w-8 h-1.5 bg-[var(--terminal-border)] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${ticker.bsci > 0.7 ? 'bg-red-500' : ticker.bsci > 0.4 ? 'bg-orange-500' : ticker.bsci > 0.2 ? 'bg-yellow-500' : 'bg-green-500'}`}
                            style={{ width: `${Math.min(ticker.bsci * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-1.5 py-0.5">
                      <DetectorDots scores={ticker.detectorScores} />
                    </td>
                    <td className="px-1 py-0.5 text-center">
                      <DirectionArrow direction={ticker.direction} confidence={ticker.confidence} />
                    </td>
                    <td className="px-1.5 py-0.5">
                      <ConvergenceCell taContext={ticker.taContext} convergenceScore={ticker.convergenceScore} robotContext={ticker.robotContext} />
                    </td>
                    <td className="px-1.5 py-0.5 text-[var(--terminal-text-dim)] truncate max-w-[120px]" title={ticker.keySignal}>
                      {ticker.keySignal}
                    </td>
                    <td className={`px-1 py-0.5 text-center ${actionStyle}`}>
                      {ticker.action}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer summary */}
      <div className="flex items-center gap-2 px-2 py-1 border-t border-[var(--terminal-border)] bg-[var(--terminal-surface)]/30 shrink-0 text-[6px] font-mono text-[var(--terminal-muted)]">
        <span>зел: {summary.green}</span>
        <span>жёлт: {summary.yellow}</span>
        <span>орж: {summary.orange}</span>
        <span>красн: {summary.red}</span>
        <span className="text-[var(--terminal-text-dim)]">всего: {summary.total}</span>
        {summary.avgBsci > 0 && (
          <span>ср.BSCI: {summary.avgBsci.toFixed(2)}</span>
        )}
        {summary.top3 && (
          <span className="ml-auto truncate">
            ТОП-3: <span className="text-[var(--terminal-text)]">{summary.top3}</span>
            {' | '}
            <span className={summary.sentiment === 'бычий' ? 'text-green-400' : summary.sentiment === 'медвежий' ? 'text-red-400' : 'text-[var(--terminal-muted)]'}>
              {summary.sentiment}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
