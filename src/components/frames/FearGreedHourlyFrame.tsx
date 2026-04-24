'use client';

import React, { useMemo } from 'react';
import { Shield, Clock } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { fmtNum, toMoscowTime } from '@/lib/helpers';
import { FearGreedGauge } from './FearGreedGauge';
import { HourlyChart } from './HourlyChart';

export function FearGreedHourlyFrame() {
  const fearGreedIndex = useDashboardStore((s) => s.fearGreedIndex);
  const buyLots = useDashboardStore((s) => s.buyLots);
  const sellLots = useDashboardStore((s) => s.sellLots);
  const totalEvents = useDashboardStore((s) => s.totalEvents);
  const hourlyActivity = useDashboardStore((s) => s.hourlyActivity);
  const dbLoaded = useDashboardStore((s) => s.dbLoaded);
  const hasData = totalEvents > 0 || dbLoaded;

  // Фильтруем hourlyActivity — только последние 6 часов по МСК
  const hourlyActivity6h = useMemo(() => {
    if (hourlyActivity.length === 0) return [];
    const now = new Date();
    const msk = toMoscowTime(now);
    const currentHour = msk.getHours();
    return hourlyActivity.filter(h => {
      const hourNum = parseInt(h.hour.split(':')[0], 10);
      const diff = (currentHour - hourNum + 24) % 24;
      return diff < 6;
    });
  }, [hourlyActivity]);

  return (
    <div className="flex border-b border-[var(--terminal-border)] shrink-0">
      {/* Left: Fear/Greed gauge */}
      <div className="w-[45%] px-2 py-2 border-r border-[var(--terminal-border)]">
        <div className="flex items-center gap-1.5 mb-1">
          <Shield className="w-2.5 h-2.5 text-[var(--terminal-warning)]" />
          <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">F&G</span>
        </div>
        <FearGreedGauge value={hasData ? fearGreedIndex : 50} />
        <div className="mt-1 text-[7px] text-[var(--terminal-muted)] font-mono text-center space-y-px">
          <div>Пок: <span className="text-[var(--terminal-positive)]">{fmtNum(buyLots)}</span> | Прод: <span className="text-[var(--terminal-negative)]">{fmtNum(sellLots)}</span></div>
          <div>Событий: <span className="text-[var(--terminal-text)]">{fmtNum(totalEvents)}</span></div>
        </div>
      </div>

      {/* Right: Hourly Activity */}
      <div className="w-[55%] px-2 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <Clock className="w-2.5 h-2.5 text-[var(--terminal-positive)]" />
          <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">АКТИВНОСТЬ</span>
          <span className="text-[6px] text-[var(--terminal-muted)] font-mono ml-auto">6ч</span>
        </div>
        <HourlyChart data={hourlyActivity6h} />
        <div className="flex items-center justify-center gap-3 mt-0.5 text-[7px] font-mono text-[var(--terminal-muted)]">
          <span className="flex items-center gap-1"><span className="w-2 h-1 rounded-full bg-[var(--terminal-positive)]" /> Пок</span>
          <span className="flex items-center gap-1"><span className="w-2 h-1 rounded-full bg-[var(--terminal-negative)]" /> Прод</span>
        </div>
      </div>
    </div>
  );
}
