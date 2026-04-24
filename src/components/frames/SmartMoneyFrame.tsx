'use client';

import React from 'react';
import { TrendingUp } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';

export function SmartMoneyFrame() {
  const futoiInstruments = useDashboardStore((s) => s.futoiInstruments);
  const futoiSource = useDashboardStore((s) => s.futoiSource);
  const futoiRealtime = useDashboardStore((s) => s.futoiRealtime);
  const compositeSMI = useDashboardStore((s) => s.compositeSMI);
  const compositeDirection = useDashboardStore((s) => s.compositeDirection);

  const getSmiColor = (smi: number) => {
    if (smi > 30) return 'var(--terminal-positive)';
    if (smi > 10) return 'color-mix(in srgb, var(--terminal-positive) 65%, var(--terminal-text))';
    if (smi > -10) return 'var(--terminal-warning)';
    if (smi > -30) return 'color-mix(in srgb, var(--terminal-negative) 65%, var(--terminal-text))';
    return 'var(--terminal-negative)';
  };

  const getSmiLabel = (dir: string) => {
    const labels: Record<string, string> = {
      bullish: 'БЫЧИЙ',
      slightly_bullish: 'Умер. бычий',
      neutral: 'Нейтрально',
      slightly_bearish: 'Умер. медвежий',
      bearish: 'МЕДВЕЖИЙ',
      no_data: 'Нет данных',
      error: 'Ошибка',
    };
    return labels[dir] || dir;
  };

  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-1.5 mb-1">
        <TrendingUp className="w-2.5 h-2.5 text-[var(--terminal-positive)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">SMART MONEY INDEX</span>
        {futoiRealtime && (
          <span className="text-[6px] font-bold font-mono px-1 py-0.5 rounded bg-[var(--terminal-positive)]/15 text-[var(--terminal-positive)] border border-[var(--terminal-positive)]/30 animate-pulse">RT</span>
        )}
        {futoiSource && futoiSource !== 'none' && (
          <span className={`text-[6px] font-mono ml-auto ${futoiSource === 'apim_futoi' ? 'text-[var(--terminal-accent)]' : futoiSource === 'iss_authorized' ? 'text-[var(--terminal-accent)]' : 'text-[var(--terminal-muted)]'}`}>
            {futoiSource === 'apim_futoi' ? 'APIM' : futoiSource === 'iss_authorized' ? 'ISS+' : 'ISS'}
          </span>
        )}
      </div>
      {/* Composite SMI Gauge */}
      <div className="flex flex-col items-center mb-1">
        <div className="relative w-full max-w-[200px] h-[40px]">
          <div className="absolute bottom-0 left-0 right-0 h-[20px] rounded-full overflow-hidden flex">
            <div className="flex-1 bg-[var(--terminal-negative)]/20" />
            <div className="flex-1 bg-[var(--terminal-warning)]/20" />
            <div className="flex-1 bg-[var(--terminal-warning)]/20" />
            <div className="flex-1 bg-[var(--terminal-positive)]/20" />
            <div className="flex-1 bg-[var(--terminal-positive)]/20" />
          </div>
          <div className="absolute bottom-0 left-0 h-[20px] rounded-full overflow-hidden" style={{ width: `${(compositeSMI + 100) / 2}%`, background: `linear-gradient(90deg, var(--terminal-negative), var(--terminal-warning), var(--terminal-warning), var(--terminal-positive), var(--terminal-positive))` }} />
          <div className="absolute bottom-[16px] left-1/2 -translate-x-1/2 w-[1px] h-[20px] bg-white/80" />
          <div className="absolute bottom-[14px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[3px] border-r-[3px] border-t-[4px] border-transparent border-t-white" />
        </div>
        <div className="text-center mt-0.5">
          <span className="text-lg font-bold font-mono" style={{ color: getSmiColor(compositeSMI) }}>{compositeSMI}</span>
          <span className="text-[8px] ml-1 font-bold font-mono" style={{ color: getSmiColor(compositeSMI) }}>{getSmiLabel(compositeDirection)}</span>
        </div>
      </div>
    </div>
  );
}
