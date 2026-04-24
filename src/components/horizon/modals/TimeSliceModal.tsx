'use client';

import React, { useEffect, useMemo } from 'react';
import { X, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { useHorizonStore } from '@/lib/horizon-store';
import { getBsciEmoji, getBsciColor, getBsciLevel } from '../shared/BSCIColor';

export function TimeSliceModal() {
  const selectedTimeSlice = useHorizonStore((s) => s.selectedTimeSlice);
  const heatmapData = useHorizonStore((s) => s.heatmapData);
  const scannerData = useHorizonStore((s) => s.scannerData);
  const selectTimeSlice = useHorizonStore((s) => s.selectTimeSlice);
  const selectTicker = useHorizonStore((s) => s.selectTicker);
  const fetchObservations = useHorizonStore((s) => s.fetchObservations);

  const ticker = selectedTimeSlice?.ticker ?? '';
  const hour = selectedTimeSlice?.hour ?? 0;

  // Find heatmap cell for this time slice
  const cell = useMemo(() => {
    if (!selectedTimeSlice) return null;
    return heatmapData.find((c) => c.ticker === ticker && c.hour === hour) || null;
  }, [heatmapData, ticker, hour, selectedTimeSlice]);

  // Find current scanner data for this ticker
  const scannerItem = useMemo(() => {
    if (!selectedTimeSlice) return null;
    return scannerData.find((t) => t.ticker === ticker) || null;
  }, [scannerData, ticker, selectedTimeSlice]);

  // Find all cells for this ticker (for mini sparkline)
  const tickerCells = useMemo(() => {
    if (!selectedTimeSlice) return [];
    return heatmapData
      .filter((c) => c.ticker === ticker)
      .sort((a, b) => a.hour - b.hour);
  }, [heatmapData, ticker, selectedTimeSlice]);

  // Sparkline data for SVG
  const sparkW = 260;
  const sparkH = 40;
  const sparkPoints = useMemo(() => {
    if (tickerCells.length < 2) return '';
    const maxBsci = Math.max(...tickerCells.map((c) => c.avgBsci), 0.01);
    return tickerCells
      .map((c, i) => {
        const x = (i / (tickerCells.length - 1)) * sparkW;
        const y = sparkH - (c.avgBsci / maxBsci) * (sparkH - 4) - 2;
        return `${x},${y}`;
      })
      .join(' ');
  }, [tickerCells]);

  if (!selectedTimeSlice) return null;

  const bsciLevel = cell ? getBsciLevel(cell.avgBsci) : 'GREEN';
  const bsciColor = cell ? getBsciColor(cell.avgBsci) : getBsciColor(0);
  const bsciEmoji = cell ? getBsciEmoji(cell.avgBsci) : getBsciEmoji(0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--terminal-surface)] border border-[var(--terminal-border)] rounded-lg shadow-2xl w-[480px] max-h-[70vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className={`flex items-center gap-3 px-4 py-3 border-b border-[var(--terminal-border)] ${bsciColor.bg}`}>
          <div className="flex items-center gap-2">
            <span className="text-lg">{bsciEmoji}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-mono text-[var(--terminal-text)] font-bold">{ticker}</span>
                <Clock className="w-3 h-3 text-[var(--terminal-muted)]" />
                <span className="text-xs font-mono text-[var(--terminal-muted)]">{hour}:00 МСК</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-mono font-bold ${bsciColor.text}`}>
                  BSCI {cell?.avgBsci.toFixed(2) ?? '—'}
                </span>
                {cell && (
                  <span className="text-[9px] font-mono text-[var(--terminal-muted)]">
                    max {cell.maxBsci.toFixed(2)} ×{cell.count}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="ml-auto">
            <button
              onClick={() => selectTimeSlice(null)}
              className="text-[var(--terminal-muted)] hover:text-[var(--terminal-text)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto terminal-scroll p-4 space-y-3">
          {/* BSCI Bar */}
          {cell && (
            <div className="space-y-1">
              <div className="w-full h-2.5 bg-[var(--terminal-border)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    cell.avgBsci > 0.7 ? 'bg-red-500' :
                    cell.avgBsci > 0.4 ? 'bg-orange-500' :
                    cell.avgBsci > 0.2 ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(cell.avgBsci * 100, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Sparkline — BSCI across hours */}
          {tickerCells.length >= 2 && (
            <div className="space-y-1">
              <span className="text-[9px] font-mono text-[var(--terminal-muted)]">BSCI по часам</span>
              <svg width={sparkW} height={sparkH} className="block">
                {/* Grid lines */}
                {[0.25, 0.5, 0.75].map((v) => (
                  <line
                    key={v}
                    x1={0} y1={sparkH - v * (sparkH - 4) - 2}
                    x2={sparkW} y2={sparkH - v * (sparkH - 4) - 2}
                    stroke="var(--terminal-border)" strokeWidth={0.5} strokeDasharray="2,4"
                  />
                ))}
                {/* Line */}
                <polyline
                  points={sparkPoints}
                  fill="none"
                  stroke={
                    (cell?.avgBsci ?? 0) > 0.4 ? '#fb923c' :
                    (cell?.avgBsci ?? 0) > 0.2 ? '#facc15' : '#4ade80'
                  }
                  strokeWidth={1.5}
                />
                {/* Current hour dot */}
                {cell && tickerCells.findIndex((c) => c.hour === hour) >= 0 && (
                  (() => {
                    const idx = tickerCells.findIndex((c) => c.hour === hour);
                    const maxBsci = Math.max(...tickerCells.map((c) => c.avgBsci), 0.01);
                    const cx = (idx / (tickerCells.length - 1)) * sparkW;
                    const cy = sparkH - (cell.avgBsci / maxBsci) * (sparkH - 4) - 2;
                    return <circle cx={cx} cy={cy} r={3} fill="#fb923c" />;
                  })()
                )}
                {/* Hour labels */}
                {tickerCells.map((c, i) => (
                  <text
                    key={i}
                    x={(i / (tickerCells.length - 1)) * sparkW}
                    y={sparkH}
                    textAnchor="middle"
                    fill="var(--terminal-muted)"
                    fontSize={6}
                    fontFamily="monospace"
                  >
                    {c.hour}
                  </text>
                ))}
              </svg>
            </div>
          )}

          {/* Current scanner data */}
          {scannerItem && (
            <div className="space-y-2">
              <span className="text-[9px] font-mono text-[var(--terminal-muted)]">Текущие данные сканера</span>

              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: 'Направление', value: scannerItem.direction, icon: scannerItem.direction === 'BULLISH' ? <TrendingUp className="w-3 h-3 text-green-400" /> : scannerItem.direction === 'BEARISH' ? <TrendingDown className="w-3 h-3 text-red-400" /> : null },
                  { label: 'VPIN', value: scannerItem.vpin.toFixed(3) },
                  { label: 'CumDelta', value: scannerItem.cumDelta.toFixed(0) },
                  { label: 'Действие', value: scannerItem.action },
                  { label: 'Сигнал', value: scannerItem.keySignal },
                  { label: 'Оборот', value: `${(scannerItem.turnover / 1e6).toFixed(1)}M` },
                ].map((m) => (
                  <div key={m.label} className="bg-[var(--terminal-bg)]/50 rounded px-2 py-1 border border-[var(--terminal-border)]/20">
                    <div className="text-[7px] font-mono text-[var(--terminal-muted)]">{m.label}</div>
                    <div className="flex items-center gap-1 text-[9px] font-mono text-[var(--terminal-text)] font-bold">
                      {m.icon}
                      {m.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick status */}
              <div className="bg-[var(--terminal-bg)]/50 rounded px-2.5 py-1.5 border border-[var(--terminal-border)]/20">
                <div className="text-[7px] font-mono text-[var(--terminal-muted)] mb-0.5">Статус</div>
                <div className="text-[9px] font-mono text-[var(--terminal-text-dim)]">
                  {scannerItem.quickStatus}
                </div>
              </div>
            </div>
          )}

          {/* Action: Open Ticker Detail */}
          <button
            onClick={() => {
              selectTimeSlice(null);
              selectTicker(ticker);
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--terminal-accent)]/10 text-[var(--terminal-accent)] text-[10px] font-mono font-bold border border-[var(--terminal-accent)]/20 hover:bg-[var(--terminal-accent)]/20 transition-colors"
          >
            Открыть детали тикера →
          </button>
        </div>
      </div>
    </div>
  );
}
