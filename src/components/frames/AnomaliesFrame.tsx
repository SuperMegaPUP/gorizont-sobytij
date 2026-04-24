'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { fmtNum } from '@/lib/helpers';

export function AnomaliesFrame() {
  const anomalies = useDashboardStore((s) => s.anomalies);
  const totalEvents = useDashboardStore((s) => s.totalEvents);
  const dataSource = useDashboardStore((s) => s.dataSource);
  const dbLoaded = useDashboardStore((s) => s.dbLoaded);
  const hasData = totalEvents > 0 || dbLoaded;

  return (
    <div id="anomalies-section" className="px-2 py-1.5 border-b border-[var(--terminal-border)] shrink-0">
      <div className="flex items-center gap-1.5 mb-1">
        <AlertTriangle className="w-2.5 h-2.5 text-[var(--terminal-warning)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">АНОМАЛИИ</span>
        <span className="text-[6px] text-[var(--terminal-muted)] font-mono ml-auto">10 мин</span>
      </div>
      {anomalies.length === 0 ? (
        <div className="text-[7px] text-[var(--terminal-muted)] font-mono text-center py-1">
          {hasData ? 'Нет аномалий' : dataSource === 'closed' ? 'Биржа закрыта' : 'Ожидание...'}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-2 gap-y-px">
          {anomalies.map((a) => {
            const now = Date.now();
            const isBlinking = a.blinkUntil && now < a.blinkUntil;
            return (
              <div key={a.id} className={`flex items-center gap-1 px-1.5 py-0.5 text-[7px] font-mono transition-all duration-500 ${
                isBlinking
                  ? 'border border-[var(--terminal-warning)]/50 bg-[var(--terminal-warning)]/8 rounded'
                  : 'border border-transparent bg-transparent opacity-60'
              }`}>
                <span className={`shrink-0 ${isBlinking ? 'text-[var(--terminal-warning)]' : 'text-[var(--terminal-muted)]'}`}>{'\u26A0'}</span>
                <span className="text-[var(--terminal-text)] font-bold truncate">{a.ticker}</span>
                <span className={a.direction === 'sell' ? 'text-[var(--terminal-negative)]' : 'text-[var(--terminal-positive)]'}>
                  {a.direction === 'buy' ? '\u25B2' : '\u25BC'}
                </span>
                <span className="text-[var(--terminal-muted)] truncate">{fmtNum(a.lots)}л</span>
                <span className="text-[var(--terminal-accent)] truncate">{a.pattern}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
