'use client';

import React from 'react';
import { Activity } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { StrategyChart } from './StrategyChart';

export function StrategiesFrame() {
  const strategyDistribution = useDashboardStore((s) => s.strategyDistribution);

  return (
    <div className="px-3 py-2 border-b border-[var(--terminal-border)] shrink-0">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="w-3.5 h-3.5 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">СТРАТЕГИИ</span>
      </div>
      <StrategyChart data={strategyDistribution} />
    </div>
  );
}
