'use client';

import React, { useMemo } from 'react';
import { Clock } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { toMoscowTime } from '@/lib/helpers';
import { HourlyChart } from './HourlyChart';

export function HourlyActivityFrame() {
  const hourlyActivity = useDashboardStore((s) => s.hourlyActivity);

  // Фильтруем hourlyActivity — только последние 3 часа по МСК
  const hourlyActivity3h = useMemo(() => {
    if (hourlyActivity.length === 0) return [];
    const now = new Date();
    const msk = toMoscowTime(now);
    const currentHour = msk.getHours();
    return hourlyActivity.filter(h => {
      const hourNum = parseInt(h.hour.split(':')[0], 10);
      const diff = (currentHour - hourNum + 24) % 24;
      return diff < 3;
    });
  }, [hourlyActivity]);

  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Clock className="w-2.5 h-2.5 text-[var(--terminal-positive)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">АКТИВНОСТЬ ПО ЧАСАМ</span>
        <span className="text-[6px] text-[var(--terminal-muted)] font-mono ml-auto">3ч</span>
      </div>
      <HourlyChart data={hourlyActivity3h} />
      <div className="flex items-center justify-center gap-3 mt-0.5 text-[7px] font-mono text-[var(--terminal-muted)]">
        <span className="flex items-center gap-1"><span className="w-2 h-1 rounded-full bg-[var(--terminal-positive)]" /> Пок</span>
        <span className="flex items-center gap-1"><span className="w-2 h-1 rounded-full bg-[var(--terminal-negative)]" /> Прод</span>
      </div>
    </div>
  );
}
