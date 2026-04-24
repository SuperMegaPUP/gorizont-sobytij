'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ScanSearch } from 'lucide-react';
import { useHorizonStore } from '@/lib/horizon-store';
import { getBsciEmoji, getBsciColor } from '../shared/BSCIColor';
import { DirectionArrow } from '../shared/DirectionArrow';
import { DetectorDots } from '../scanner/DetectorDots';

type FilterMode = 'all' | 'alert' | 'bear' | 'bull';

export function HorizonScannerFrame() {
  const scannerData = useHorizonStore((s) => s.scannerData);
  const scannerSortBy = useHorizonStore((s) => s.scannerSortBy);
  const selectTicker = useHorizonStore((s) => s.selectTicker);
  const fetchScanner = useHorizonStore((s) => s.fetchScanner);
  const loading = useHorizonStore((s) => s.loading);
  const lastScannerUpdate = useHorizonStore((s) => s.lastScannerUpdate);

  const [filter, setFilter] = useState<FilterMode>('all');
  const [countdown, setCountdown] = useState(30);
  const [now, setNow] = useState(new Date());

  // Fetch on mount + interval
  useEffect(() => {
    fetchScanner();
    const interval = setInterval(() => {
      fetchScanner();
      setCountdown(30);
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchScanner]);

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
    let data = [...scannerData];
    if (filter === 'alert') data = data.filter((t) => t.alertLevel === 'ORANGE' || t.alertLevel === 'RED');
    else if (filter === 'bear') data = data.filter((t) => t.direction === 'BEARISH');
    else if (filter === 'bull') data = data.filter((t) => t.direction === 'BULLISH');

    // Sort
    data.sort((a, b) => {
      switch (scannerSortBy) {
        case 'bsci': return b.bsci - a.bsci;
        case 'vpin': return b.vpin - a.vpin;
        case 'delta': return b.cumDelta - a.cumDelta;
        case 'turnover': return b.turnover - a.turnover;
        default: return b.bsci - a.bsci;
      }
    });
    return data;
  }, [scannerData, filter, scannerSortBy]);

  // Summary
  const summary = useMemo(() => {
    const green = scannerData.filter((t) => t.alertLevel === 'GREEN').length;
    const yellow = scannerData.filter((t) => t.alertLevel === 'YELLOW').length;
    const orange = scannerData.filter((t) => t.alertLevel === 'ORANGE').length;
    const red = scannerData.filter((t) => t.alertLevel === 'RED').length;
    const top3 = [...scannerData].sort((a, b) => b.bsci - a.bsci).slice(0, 3).map((t) => t.ticker).join(', ');
    const bullCount = scannerData.filter((t) => t.direction === 'BULLISH').length;
    const bearCount = scannerData.filter((t) => t.direction === 'BEARISH').length;
    const sentiment = bullCount > bearCount ? 'бычий' : bearCount > bullCount ? 'медвежий' : 'нейтр';
    return { green, yellow, orange, red, total: scannerData.length, top3, sentiment };
  }, [scannerData]);

  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const filterChips: { mode: FilterMode; label: string }[] = [
    { mode: 'all', label: 'все' },
    { mode: 'alert', label: '\uD83D\uDFE0\uD83D\uDD34 тревога' },
    { mode: 'bear', label: '\u25BC медведи' },
    { mode: 'bull', label: '\u25B2 быки' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <ScanSearch className="w-3 h-3 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide uppercase">
          СКАНЕР: Чёрные звёзды
        </span>
        <span className="text-[7px] text-[var(--terminal-muted)] font-mono ml-auto">
          {countdown}s
        </span>
        <span className="text-[7px] text-[var(--terminal-muted)] font-mono">
          {timeStr}
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--terminal-border)] shrink-0">
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
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto terminal-scroll">
        {loading && scannerData.length === 0 ? (
          <div className="text-[7px] text-[var(--terminal-muted)] font-mono text-center py-3">
            Загрузка сканера...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-[7px] text-[var(--terminal-muted)] font-mono text-center py-3">
            Нет данных
          </div>
        ) : (
          <table className="w-full text-[7px] font-mono">
            <thead>
              <tr className="text-[var(--terminal-muted)] border-b border-[var(--terminal-border)]">
                <th className="text-left px-1.5 py-0.5 font-normal">Тикер</th>
                <th className="text-left px-1.5 py-0.5 font-normal">BSCI</th>
                <th className="text-left px-1.5 py-0.5 font-normal">Детекторы</th>
                <th className="text-center px-1 py-0.5 font-normal">Напр.</th>
                <th className="text-left px-1.5 py-0.5 font-normal">Ключ.сигнал</th>
                <th className="text-center px-1 py-0.5 font-normal">Действие</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ticker) => {
                const bsciColor = getBsciColor(ticker.bsci);
                const bsciEmoji = getBsciEmoji(ticker.bsci);
                const actionStyle = ticker.action === 'URGENT'
                  ? 'text-red-400 font-bold'
                  : ticker.action === 'ALERT'
                    ? 'text-orange-400'
                    : 'text-[var(--terminal-muted)]';

                return (
                  <tr
                    key={ticker.ticker}
                    onClick={() => selectTicker(ticker.ticker)}
                    className="border-b border-[var(--terminal-border)]/30 hover:bg-[var(--terminal-surface-hover)]/50 cursor-pointer transition-colors"
                  >
                    <td className="px-1.5 py-0.5">
                      <span className="text-[var(--terminal-text)] font-bold">{ticker.ticker}</span>
                      <span className="text-[var(--terminal-muted)] ml-1">{ticker.name}</span>
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
        <span>{'\uD83D\uDFE2'} {summary.green}</span>
        <span>{'\uD83D\uDFE1'} {summary.yellow}</span>
        <span>{'\uD83D\uDFE0'} {summary.orange}</span>
        <span>{'\uD83D\uDD34'} {summary.red}</span>
        <span className="text-[var(--terminal-text-dim)]">всего: {summary.total}</span>
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
