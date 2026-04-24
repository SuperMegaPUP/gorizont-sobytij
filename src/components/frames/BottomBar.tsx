'use client';

import React from 'react';
import { useDashboardStore } from '@/lib/store';
import { fmtNum } from '@/lib/helpers';

export function BottomBar() {
  const lastUpdate = useDashboardStore((s) => s.lastUpdate);
  const connected = useDashboardStore((s) => s.connected);
  const dataSource = useDashboardStore((s) => s.dataSource);
  const totalEvents = useDashboardStore((s) => s.totalEvents);
  const apiError = useDashboardStore((s) => s.apiError);

  const statusBadge = () => {
    if (dataSource === 'closed') return <span className="ml-1 px-1.5 py-0.5 rounded text-[8px] bg-[var(--terminal-negative)]/10 text-[var(--terminal-negative)] border border-[var(--terminal-negative)]/30">БИРЖА ЗАКРЫТА</span>;
    if (dataSource === 'ws') return <span className="ml-1 px-1.5 py-0.5 rounded text-[8px] bg-[var(--terminal-positive)]/10 text-[var(--terminal-positive)] border border-[var(--terminal-positive)]/30">LIVE WS</span>;
    if (dataSource === 'api') return <span className="ml-1 px-1.5 py-0.5 rounded text-[8px] bg-[var(--terminal-accent)]/10 text-[var(--terminal-accent)] border border-[var(--terminal-accent)]/30">API</span>;
    return <span className="ml-1 px-1.5 py-0.5 rounded text-[8px] bg-[var(--terminal-warning)]/10 text-[var(--terminal-warning)] border border-[var(--terminal-warning)]/30">ОЖИДАНИЕ</span>;
  };

  return (
    <footer className="flex flex-wrap items-center justify-between gap-1 px-3 py-1 border-t border-[var(--terminal-border)] bg-[var(--terminal-bg)]/90 backdrop-blur-sm text-[9px] text-[var(--terminal-muted)] font-mono" suppressHydrationWarning>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[var(--terminal-positive)]' : dataSource === 'closed' ? 'bg-[var(--terminal-muted)]' : 'bg-[var(--terminal-negative)]'}`} />
          {connected ? 'Подключено:' : dataSource === 'closed' ? 'Биржа закрыта:' : 'Отключено:'} T-Invest API | MOEX API
          {statusBadge()}
        </span>
        {apiError && <span className="text-[var(--terminal-negative)] ml-2">{apiError}</span>}
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="hidden sm:inline">Детекторов: 12 | Событий: {fmtNum(totalEvents)}</span>
        <span className="text-[var(--terminal-text)]">Последнее: {lastUpdate}</span>
      </div>
    </footer>
  );
}
