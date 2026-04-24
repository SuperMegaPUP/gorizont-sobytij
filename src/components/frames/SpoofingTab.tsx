'use client';

import React, { useMemo } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { fmtNum } from '@/lib/helpers';

// ─── SpoofingTab — Спуфинг-детекция ────────────────────────────────────────
// Shows tickers with spoofing activity detected from AlgoPack
// Displays wall/accumulation data for spoofing tickers

export function SpoofingTab() {
  const algopack = useDashboardStore((s) => s.algopack);
  const spoofingTickers = algopack.spoofingTickers;
  const accumulations = algopack.accumulations;
  const walls = algopack.walls;
  const topTickers = algopack.topTickers;
  const dataSource = useDashboardStore((s) => s.dataSource);

  // Find accumulation details for spoofing tickers
  const spoofingDetails = useMemo(() => {
    return spoofingTickers.map(ticker => {
      const accum = accumulations.find(a => a.secid === ticker && a.spoofing);
      const wall = walls.find(w => w.secid === ticker);
      const isLiquid = topTickers.includes(ticker);
      return { ticker, accum, wall, isLiquid };
    });
  }, [spoofingTickers, accumulations, walls, topTickers]);

  const hasData = spoofingTickers.length > 0;

  const fmtVal = (v: number): string => {
    const abs = Math.abs(v);
    if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toFixed(0);
  };

  return (
    <div className="flex flex-col h-full text-[8px] font-mono">
      {/* Header */}
      <div className="px-2 py-1 border-b border-[var(--terminal-border)]/50 flex items-center justify-between shrink-0 bg-[var(--terminal-surface)]/30">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="w-3 h-3 text-[var(--terminal-negative)]" />
          <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">СПОФИНГ: Детекция</span>
        </div>
        <div className="flex items-center gap-2">
          {algopack.source !== 'none' && (
            <span className="text-[7px] text-[var(--terminal-muted)]">
              {algopack.tradetime ? `${algopack.tradetime.slice(0,5)} МСК` : ''}
            </span>
          )}
          <span className={`text-[7px] px-1 rounded ${hasData ? 'bg-[var(--terminal-negative)]/15 text-[var(--terminal-negative)]' : 'bg-[var(--terminal-muted)]/10 text-[var(--terminal-muted)]'}`}>
            {hasData ? `${spoofingTickers.length} ОБНАР` : 'НЕТ'}
          </span>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[36px_22px_1fr_42px_40px] gap-0.5 px-2 py-0.5 text-[7px] text-[var(--terminal-muted)] border-b border-[var(--terminal-border)]/30 sticky top-0 bg-[var(--terminal-bg)] z-10">
        <span>Тикер</span>
        <span>Напр</span>
        <span>Стена</span>
        <span>Cancel%</span>
        <span>Тег</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto terminal-scroll">
        {!hasData ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <ShieldAlert className="w-5 h-5 text-[var(--terminal-border)] mx-auto mb-1" />
              <p className="text-[8px] text-[var(--terminal-muted)]">
                {algopack.source === 'none' ? 'Загрузка данных...' : 'Спуфинг не обнаружен'}
              </p>
              <p className="text-[7px] text-[var(--terminal-border)] mt-0.5">AlgoPack orderstats каждые 5 мин</p>
            </div>
          </div>
        ) : (
          spoofingDetails.map((detail) => {
            const { ticker, accum, wall, isLiquid } = detail;
            const isLONG = accum?.direction === 'LONG';
            const dirColor = isLONG ? 'var(--terminal-positive)' : 'var(--terminal-negative)';
            const dirIcon = isLONG ? '\u25B2' : '\u25BC';
            const tagColor = isLiquid
              ? 'bg-[var(--terminal-negative)]/15 text-[var(--terminal-negative)]'
              : 'bg-[var(--terminal-warning)]/10 text-[var(--terminal-warning)]';

            return (
              <div
                key={ticker}
                className="grid grid-cols-[36px_22px_1fr_42px_40px] gap-0.5 px-2 py-1 border-b border-[var(--terminal-border)]/10 hover:bg-white/[0.02] transition-colors bg-[var(--terminal-negative)]/3"
                title={`${ticker} | Спуфинг обнаружен | Cancel ratio: ${accum ? (accum.cancelRatio * 100).toFixed(0) + '%' : '?'} | ${isLiquid ? 'ЛИКВИД' : 'НЕЛИКВИД'} | DISB: ${accum?.disb?.toFixed(3) || '?'} | Дельта: ${accum ? fmtVal(accum.deltaVal) + ' руб' : '?'}`}
              >
                <span className="font-bold text-[var(--terminal-negative)]">
                  {ticker}
                  <span className="text-[5px] ml-0.5">{'\u26A0'}</span>
                </span>
                <span style={{ color: dirColor }}>
                  {dirIcon}
                </span>
                <div className="flex items-center">
                  {wall ? (
                    <div className="w-full h-2 bg-[var(--terminal-border)]/50 rounded-sm overflow-hidden relative">
                      <div
                        className={`h-full rounded-sm ${wall.volDomination === 'BID' ? 'bg-[var(--terminal-positive)]/60' : 'bg-[var(--terminal-negative)]/60'}`}
                        style={{ width: `${Math.min(wall.wallScore, 100)}%` }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[5px] text-white/80 font-bold">
                        {wall.wallScore.toFixed(0)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[var(--terminal-muted)] text-[6px]">—</span>
                  )}
                </div>
                <span className="text-[var(--terminal-negative)]">
                  {accum ? `${(accum.cancelRatio * 100).toFixed(0)}%` : '—'}
                </span>
                <span className={`text-[7px] px-0.5 rounded ${tagColor} text-center`}>
                  {isLiquid ? 'ЛИКВ' : 'НЕЛИК'}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-2 py-0.5 border-t border-[var(--terminal-border)]/30 text-[7px] text-[var(--terminal-muted)] shrink-0">
        {hasData ? (
          <span className="text-[var(--terminal-negative)]/80">
            {'\u26A0'} Спуфинг: {spoofingTickers.slice(0, 6).join(', ')}
            {spoofingTickers.length > 6 && ` +${spoofingTickers.length - 6}`}
          </span>
        ) : (
          <span>5 мин AlgoPack | cancelRatio &gt; 70%</span>
        )}
      </div>
    </div>
  );
}
