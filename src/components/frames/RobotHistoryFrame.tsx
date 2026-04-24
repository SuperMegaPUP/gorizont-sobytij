'use client';

import React from 'react';
import { History } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { fmtNum } from '@/lib/helpers';

// ─── RobotHistoryFrame — история активности роботов ──────────────────────
// Shows historical robot events/aggregations from tickerDurationAggs
// Display: ticker, direction, pattern, lots, confidence, time

export function RobotHistoryFrame() {
  const events = useDashboardStore((s) => s.events);
  const dataSource = useDashboardStore((s) => s.dataSource);
  const totalEvents = useDashboardStore((s) => s.totalEvents);
  const dbLoaded = useDashboardStore((s) => s.dbLoaded);
  const hasData = totalEvents > 0 || dbLoaded;

  // Show last 30 events as history
  const historyEvents = events.slice(0, 30);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <History className="w-3 h-3 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">ИСТОРИЯ: Роботы</span>
        <span className="text-[8px] text-[var(--terminal-muted)] font-mono ml-auto">{historyEvents.length} соб.</span>
      </div>
      <div className="flex-1 overflow-y-auto terminal-scroll">
        {!hasData ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[9px] text-[var(--terminal-muted)] font-mono">{dataSource === 'closed' ? 'Биржа закрыта' : 'Ожидание данных...'}</p>
          </div>
        ) : historyEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[9px] text-[var(--terminal-muted)] font-mono">Нет событий в истории</p>
          </div>
        ) : (
          <div className="space-y-0">
            {/* Column headers */}
            <div className="grid grid-cols-[32px_32px_50px_40px_32px_32px_1fr] gap-0.5 px-2 py-0.5 text-[7px] text-[var(--terminal-muted)] border-b border-[var(--terminal-border)]/30 sticky top-0 bg-[var(--terminal-bg)] z-10">
              <span>Время</span>
              <span>Тикер</span>
              <span>Напр</span>
              <span>Лоты</span>
              <span>Ув.</span>
              <span>Ур.</span>
              <span>Паттерн</span>
            </div>
            {historyEvents.map((e) => {
              const isBuy = e.direction === 'buy';
              const isSell = e.direction === 'sell';
              const dirColor = isBuy ? 'var(--terminal-positive)' : isSell ? 'var(--terminal-negative)' : 'var(--terminal-warning)';
              const dirIcon = isBuy ? '\u25B2' : isSell ? '\u25BC' : '\u25CF';
              const dirLabel = isBuy ? 'Пок' : isSell ? 'Прод' : 'См';
              const confPct = Math.round(e.confidence * 100);
              const confColor = confPct > 70 ? 'var(--terminal-positive)' : confPct > 40 ? 'var(--terminal-neutral)' : 'var(--terminal-muted)';
              const levelColor = e.level === 'hft' ? 'var(--terminal-negative)' : e.level === 'structural' ? 'var(--terminal-warning)' : 'var(--terminal-muted)';

              return (
                <div
                  key={e.id}
                  className="grid grid-cols-[32px_32px_50px_40px_32px_32px_1fr] gap-0.5 px-2 py-0.5 text-[7px] font-mono border-b border-[var(--terminal-border)]/10 hover:bg-white/[0.02] transition-colors"
                >
                  <span className="text-[var(--terminal-muted)]">{e.time?.slice(0, 5) || '--:--'}</span>
                  <span className="text-[var(--terminal-text)] font-bold">{e.ticker}</span>
                  <span style={{ color: dirColor }}>{dirIcon} {dirLabel}</span>
                  <span className="text-[var(--terminal-accent)]">{fmtNum(e.lots)}</span>
                  <span style={{ color: confColor }}>{confPct}%</span>
                  <span style={{ color: levelColor }}>{e.levelRu || '—'}</span>
                  <span className="text-[var(--terminal-muted)] truncate">{e.pattern}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Footer */}
      {hasData && historyEvents.length > 0 && (
        <div className="px-2 py-0.5 border-t border-[var(--terminal-border)]/30 text-[7px] text-[var(--terminal-muted)] shrink-0">
          Последние {historyEvents.length} из {events.length} событий | {dataSource === 'closed' ? 'Биржа закрыта' : 'Live'}
        </div>
      )}
    </div>
  );
}
