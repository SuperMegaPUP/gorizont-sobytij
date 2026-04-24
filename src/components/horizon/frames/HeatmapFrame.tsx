'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3x3, Clock } from 'lucide-react';
import { useHorizonStore } from '@/lib/horizon-store';

// Short codes for core 9 futures (shown first in grid)
const CORE_TICKERS = ['MX', 'Si', 'RI', 'BR', 'GZ', 'GK', 'SR', 'LK', 'RN'];

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

interface SlotInfo {
  slotKey: string;  // "24/04 10"
  slotIndex: number; // 0-47
  hour: number;     // 0-23
}

export function HorizonHeatmapFrame() {
  const heatmapData = useHorizonStore((s) => s.heatmapData);
  const fetchHeatmap = useHorizonStore((s) => s.fetchHeatmap);
  const selectTimeSlice = useHorizonStore((s) => s.selectTimeSlice);
  const selectTicker = useHorizonStore((s) => s.selectTicker);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tickerColRef = useRef<HTMLDivElement>(null);

  // Slots come from API response, or generate locally as fallback
  const [slots, setSlots] = useState<SlotInfo[]>([]);

  // Fetch on mount + interval (always 48h)
  useEffect(() => {
    fetchHeatmap(48);
    const interval = setInterval(() => fetchHeatmap(48), 60000);
    return () => clearInterval(interval);
  }, [fetchHeatmap]);

  // Extract slots from the raw API response
  useEffect(() => {
    async function loadSlots() {
      try {
        const res = await fetch('/api/horizon/heatmap?hours=48');
        if (res.ok) {
          const json = await res.json();
          if (json.slots && json.slots.length > 0) {
            setSlots(json.slots);
          }
        }
      } catch { /* ignore */ }
    }
    // Only load once on mount if no slots yet
    if (slots.length === 0) loadSlots();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback: generate 48 slots locally
  const allSlots = useMemo(() => {
    if (slots.length > 0) return slots;

    const result: SlotInfo[] = [];
    const now = new Date();
    const mskOffset = 3;
    const nowMSK = new Date(now.getTime() + (mskOffset * 60 + now.getTimezoneOffset()) * 60000);

    for (let i = 47; i >= 0; i--) {
      const slotDate = new Date(nowMSK.getTime() - i * 3600000);
      const hour = slotDate.getHours();
      const day = slotDate.getDate().toString().padStart(2, '0');
      const month = (slotDate.getMonth() + 1).toString().padStart(2, '0');
      result.push({
        slotKey: `${day}/${month} ${hour.toString().padStart(2, '0')}`,
        slotIndex: 47 - i,
        hour,
      });
    }
    return result;
  }, [slots]);

  // Build grid lookup: key = "ticker:slotIndex"
  const gridLookup = useMemo(() => {
    const map: Record<string, { avgBsci: number; maxBsci: number; alertLevel: string; count: number }> = {};
    for (const cell of heatmapData) {
      // Use slotIndex if available, fallback to constructing from hour
      const slotIdx = (cell as any).slotIndex ?? cell.hour;
      const key = `${cell.ticker}:${slotIdx}`;
      map[key] = cell;
    }
    return map;
  }, [heatmapData]);

  // Build sorted ticker list: core 9 futures first, then stocks by max BSCI
  const sortedTickers = useMemo(() => {
    const tickers = new Set(heatmapData.map((c) => c.ticker));
    const core = CORE_TICKERS.filter((t) => tickers.has(t));

    const maxBsciMap: Record<string, number> = {};
    for (const c of heatmapData) {
      maxBsciMap[c.ticker] = Math.max(maxBsciMap[c.ticker] || 0, c.maxBsci);
    }

    const stocks = [...tickers]
      .filter((t) => !CORE_TICKERS.includes(t))
      .sort((a, b) => (maxBsciMap[b] || 0) - (maxBsciMap[a] || 0));

    return [...core, ...stocks];
  }, [heatmapData]);

  // Find which slot is "now" for highlight
  const nowSlotIndex = allSlots.length > 0 ? allSlots[allSlots.length - 1].slotIndex : -1;

  // Detect day boundaries for visual separators
  const dayLabels = useMemo(() => {
    const labels: Record<number, string> = {};
    let lastDay = '';
    for (const s of allSlots) {
      const dayPart = s.slotKey.split(' ')[0]; // "24/04"
      if (dayPart !== lastDay) {
        labels[s.slotIndex] = dayPart;
        lastDay = dayPart;
      }
    }
    return labels;
  }, [allSlots]);

  // Sync horizontal scroll between header and grid
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const handleGridScroll = () => {
    if (scrollRef.current && headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = scrollRef.current.scrollLeft;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <Grid3x3 className="w-3 h-3 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide uppercase">
          ТЕПЛОВАЯ КАРТА BSCI
        </span>
        <span className="text-[6px] text-[var(--terminal-muted)] font-mono ml-1">
          {sortedTickers.length} тикеров
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Clock className="w-2 h-2 text-[var(--terminal-muted)]" />
          <span className="text-[6px] font-mono text-[var(--terminal-muted)]">48ч</span>
        </div>
      </div>

      {/* Main content area with scrolling */}
      <div className="flex-1 flex flex-col min-h-0">
        {heatmapData.length === 0 ? (
          <div className="text-[7px] text-[var(--terminal-muted)] font-mono text-center py-4">
            Нет данных тепловой карты. Запустите сканер.
          </div>
        ) : (
          <>
            {/* Day labels row (sticky at top) */}
            <div className="flex shrink-0 border-b border-[var(--terminal-border)]/30 bg-[var(--terminal-bg)]">
              <div className="w-12 shrink-0" />
              <div
                ref={headerScrollRef}
                className="flex-1 overflow-hidden"
                style={{ minWidth: 0 }}
              >
                <div className="flex" style={{ minWidth: `${allSlots.length * 20}px` }}>
                  {allSlots.map((s) => (
                    <div
                      key={`day-${s.slotIndex}`}
                      className="flex-1 min-w-[20px]"
                    >
                      {dayLabels[s.slotIndex] && (
                        <div className="text-[5px] font-mono text-[var(--terminal-accent)] font-bold text-center border-r border-[var(--terminal-accent)]/20">
                          {dayLabels[s.slotIndex]}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Hour headers row (synced horizontal scroll) */}
            <div className="flex shrink-0 border-b border-[var(--terminal-border)]/30 bg-[var(--terminal-bg)]">
              <div className="w-12 shrink-0" />
              <div
                className="flex-1 overflow-hidden"
                style={{ minWidth: 0 }}
                ref={headerScrollRef}
              >
                <div className="flex" style={{ minWidth: `${allSlots.length * 20}px` }}>
                  {allSlots.map((s) => {
                    const isNow = s.slotIndex === nowSlotIndex;
                    return (
                      <div
                        key={`h-${s.slotIndex}`}
                        className={`flex-1 min-w-[20px] text-center text-[5px] font-mono py-0.5 ${
                          isNow
                            ? 'text-[var(--terminal-accent)] font-bold'
                            : 'text-[var(--terminal-muted)]'
                        }`}
                      >
                        {s.hour.toString().padStart(2, '0')}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Scrollable grid body */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto overflow-x-auto terminal-scroll min-h-0"
              onScroll={handleGridScroll}
            >
              <div className="flex flex-col" style={{ minWidth: `${allSlots.length * 20 + 48}px` }}>
                {/* Ticker rows */}
                {sortedTickers.map((ticker) => (
                  <div
                    key={ticker}
                    className="flex border-b border-[var(--terminal-border)]/10"
                  >
                    {/* Ticker label (fixed column) */}
                    <div
                      className={`w-12 shrink-0 text-[5px] font-mono font-bold py-0.5 px-1 cursor-pointer hover:text-[var(--terminal-accent)] truncate sticky left-0 bg-[var(--terminal-bg)] z-[5] ${
                        CORE_TICKERS.includes(ticker) ? 'text-cyan-400' : 'text-[var(--terminal-text)]'
                      }`}
                      onClick={() => selectTicker(ticker)}
                      title={ticker}
                    >
                      {ticker}
                    </div>

                    {/* Slot cells */}
                    <div className="flex" style={{ minWidth: `${allSlots.length * 20}px` }}>
                      {allSlots.map((slot) => {
                        const cell = gridLookup[`${ticker}:${slot.slotIndex}`];
                        const isNow = slot.slotIndex === nowSlotIndex;

                        if (!cell) {
                          return (
                            <div
                              key={`${ticker}-${slot.slotIndex}`}
                              className={`flex-1 min-w-[20px] py-0.5 ${isNow ? 'bg-[var(--terminal-accent)]/5' : ''}`}
                            />
                          );
                        }

                        return (
                          <div
                            key={`${ticker}-${slot.slotIndex}`}
                            className={`flex-1 min-w-[20px] py-0.5 px-px cursor-pointer transition-all hover:brightness-125 ${bsciToColor(cell.avgBsci, cell.alertLevel)} ${isNow ? 'ring-1 ring-[var(--terminal-accent)]/40' : ''}`}
                            onClick={() => selectTimeSlice({ ticker, hour: slot.hour })}
                            title={`${ticker} ${slot.slotKey} — BSCI ${cell.avgBsci.toFixed(2)} (max ${cell.maxBsci.toFixed(2)}) ×${cell.count}`}
                          >
                            <div className={`text-center text-[4px] font-mono leading-tight ${bsciToTextColor(cell.avgBsci)}`}>
                              {cell.avgBsci.toFixed(1)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Legend */}
                <div className="flex items-center gap-2 px-2 py-1 border-t border-[var(--terminal-border)]/30 sticky bottom-0 bg-[var(--terminal-bg)] z-[5]">
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
                  <span className="text-[var(--terminal-border)] mx-0.5">|</span>
                  <div className="flex items-center gap-0.5">
                    <div className="w-2 h-1.5 rounded-sm bg-cyan-400/40" />
                    <span className="text-[5px] font-mono text-[var(--terminal-muted)]">фьючерс</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
