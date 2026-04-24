'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Grid3x3, Clock } from 'lucide-react';
import { useHorizonStore } from '@/lib/horizon-store';

// Short codes for core 9 futures (shown first in grid)
const CORE_TICKERS = ['MX', 'Si', 'RI', 'BR', 'GZ', 'GK', 'SR', 'LK', 'RN'];

// Map short futures codes → MOEX stock equivalents (for dedup when both appear)
const SHORT_TO_MOEX: Record<string, string> = {
  'SR': 'SBER', 'GZ': 'GAZP', 'GK': 'GMKN', 'LK': 'LKOH',
  'RN': 'ROSN', 'MX': 'MOEX', 'Si': 'Si', 'RI': 'RI', 'BR': 'BR',
};
const MOEX_SET = new Set(Object.values(SHORT_TO_MOEX));

// Trading hours (Moscow time) for columns
const TRADING_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

function bsciToColor(bsci: number, alertLevel: string): string {
  if (alertLevel === 'RED' || bsci > 0.7) return 'bg-red-500/70';
  if (alertLevel === 'ORANGE' || bsci > 0.4) return 'bg-orange-500/60';
  if (alertLevel === 'YELLOW' || bsci > 0.2) return 'bg-yellow-500/50';
  return 'bg-green-500/30';
}

function bsciToTextColor(bsci: number): string {
  if (bsci > 0.7) return 'text-red-200';
  if (bsci > 0.4) return 'text-orange-200';
  if (bsci > 0.2) return 'text-yellow-200';
  return 'text-green-200';
}

export function HorizonHeatmapFrame() {
  const heatmapData = useHorizonStore((s) => s.heatmapData);
  const fetchHeatmap = useHorizonStore((s) => s.fetchHeatmap);
  const selectTimeSlice = useHorizonStore((s) => s.selectTimeSlice);
  const selectTicker = useHorizonStore((s) => s.selectTicker);

  const [hoursRange, setHoursRange] = useState(24);

  // Fetch on mount + interval
  useEffect(() => {
    fetchHeatmap(hoursRange);
    const interval = setInterval(() => fetchHeatmap(hoursRange), 60000);
    return () => clearInterval(interval);
  }, [fetchHeatmap, hoursRange]);

  // Build grid lookup: key = "ticker:hour"
  const gridLookup = useMemo(() => {
    const map: Record<string, { avgBsci: number; maxBsci: number; alertLevel: string; count: number }> = {};
    for (const cell of heatmapData) {
      const key = `${cell.ticker}:${cell.hour}`;
      map[key] = cell;
    }
    return map;
  }, [heatmapData]);

  // Build sorted ticker list: core 9 futures first, then all TOP 100 stocks by max BSCI
  // All tickers shown together — futures + stocks combined
  const sortedTickers = useMemo(() => {
    const tickers = new Set(heatmapData.map((c) => c.ticker));

    // Core 9 futures (use short codes)
    const core = CORE_TICKERS.filter((t) => tickers.has(t));

    // Compute maxBsci per ticker for sorting (cache for perf)
    const maxBsciMap: Record<string, number> = {};
    for (const c of heatmapData) {
      maxBsciMap[c.ticker] = Math.max(maxBsciMap[c.ticker] || 0, c.maxBsci);
    }

    // All non-core tickers, sorted by max BSCI descending
    const stocks = [...tickers]
      .filter((t) => !CORE_TICKERS.includes(t))
      .sort((a, b) => (maxBsciMap[b] || 0) - (maxBsciMap[a] || 0));

    return [...core, ...stocks];
  }, [heatmapData]);

  // Range selector
  const ranges = [
    { label: '8ч', value: 8 },
    { label: '24ч', value: 24 },
    { label: '48ч', value: 48 },
  ];

  // Get current Moscow hour for highlight
  const now = new Date();
  const mskOffset = 3;
  const currentMskHour = (now.getUTCHours() + mskOffset) % 24;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <Grid3x3 className="w-3 h-3 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide uppercase">
          ТЕПЛОВАЯ КАРТА BSCI
        </span>
        <span className="text-[6px] text-[var(--terminal-muted)] font-mono ml-1">
          {sortedTickers.length} тикеров (фьючерсы + акции)
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Clock className="w-2 h-2 text-[var(--terminal-muted)]" />
          {ranges.map((r) => (
            <button
              key={r.value}
              onClick={() => setHoursRange(r.value)}
              className={`text-[6px] font-mono px-1 py-0.5 rounded-sm transition-colors ${
                hoursRange === r.value
                  ? 'bg-[var(--terminal-accent)]/20 text-[var(--terminal-accent)] border border-[var(--terminal-accent)]/40'
                  : 'text-[var(--terminal-muted)] border border-transparent hover:border-[var(--terminal-border)]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="flex-1 overflow-auto terminal-scroll">
        {heatmapData.length === 0 ? (
          <div className="text-[7px] text-[var(--terminal-muted)] font-mono text-center py-4">
            Нет данных тепловой карты. Запустите сканер.
          </div>
        ) : (
          <div className="min-w-[480px]">
            {/* Hour headers */}
            <div className="flex border-b border-[var(--terminal-border)]/30">
              <div className="w-10 shrink-0" /> {/* ticker column spacer */}
              {TRADING_HOURS.map((h) => (
                <div
                  key={h}
                  className={`flex-1 text-center text-[5px] font-mono py-0.5 ${
                    h === currentMskHour
                      ? 'text-[var(--terminal-accent)] font-bold'
                      : 'text-[var(--terminal-muted)]'
                  }`}
                >
                  {h}
                </div>
              ))}
            </div>

            {/* Ticker rows */}
            {sortedTickers.map((ticker) => (
              <div
                key={ticker}
                className="flex border-b border-[var(--terminal-border)]/10"
              >
                {/* Ticker label */}
                <div
                  className={`w-10 shrink-0 text-[5px] font-mono font-bold py-0.5 px-1 cursor-pointer hover:text-[var(--terminal-accent)] truncate ${
                    CORE_TICKERS.includes(ticker) ? 'text-cyan-400' : 'text-[var(--terminal-text)]'
                  }`}
                  onClick={() => selectTicker(ticker)}
                  title={ticker}
                >
                  {ticker}
                </div>

                {/* Hour cells */}
                {TRADING_HOURS.map((hour) => {
                  const cell = gridLookup[`${ticker}:${hour}`];
                  const isCurrent = hour === currentMskHour;

                  if (!cell) {
                    return (
                      <div
                        key={`${ticker}-${hour}`}
                        className={`flex-1 py-0.5 ${isCurrent ? 'bg-[var(--terminal-accent)]/5' : ''}`}
                      />
                    );
                  }

                  return (
                    <div
                      key={`${ticker}-${hour}`}
                      className={`flex-1 py-0.5 px-px cursor-pointer transition-all hover:brightness-125 ${bsciToColor(cell.avgBsci, cell.alertLevel)} ${isCurrent ? 'ring-1 ring-[var(--terminal-accent)]/40' : ''}`}
                      onClick={() => selectTimeSlice({ ticker, hour })}
                      title={`${ticker} ${hour}:00 — BSCI ${cell.avgBsci.toFixed(2)} (max ${cell.maxBsci.toFixed(2)}) ×${cell.count}`}
                    >
                      <div className={`text-center text-[4px] font-mono leading-tight ${bsciToTextColor(cell.avgBsci)}`}>
                        {cell.avgBsci.toFixed(1)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Legend */}
            <div className="flex items-center gap-2 px-2 py-1 border-t border-[var(--terminal-border)]/30">
              <span className="text-[5px] font-mono text-[var(--terminal-muted)]">BSCI:</span>
              {[
                { color: 'bg-green-500/30', label: '<0.2' },
                { color: 'bg-yellow-500/50', label: '0.2-0.4' },
                { color: 'bg-orange-500/60', label: '0.4-0.7' },
                { color: 'bg-red-500/70', label: '>0.7' },
              ].map((l) => (
                <div key={l.label} className="flex items-center gap-0.5">
                  <div className={`w-2 h-1.5 rounded-sm ${l.color}`} />
                  <span className="text-[5px] font-mono text-[var(--terminal-muted)]">{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
