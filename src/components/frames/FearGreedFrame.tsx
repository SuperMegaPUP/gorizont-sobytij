'use client';

import React from 'react';
import { Shield } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { fmtNum } from '@/lib/helpers';
import { FearGreedGauge } from './FearGreedGauge';

export function FearGreedFrame() {
  const fearGreedIndex = useDashboardStore((s) => s.fearGreedIndex);
  const buyLots = useDashboardStore((s) => s.buyLots);
  const sellLots = useDashboardStore((s) => s.sellLots);
  const totalEvents = useDashboardStore((s) => s.totalEvents);
  const dbLoaded = useDashboardStore((s) => s.dbLoaded);
  const hasData = totalEvents > 0 || dbLoaded;

  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Shield className="w-2.5 h-2.5 text-[var(--terminal-warning)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">ИНДЕКС СТРАХА И ЖАДНОСТИ</span>
      </div>
      <FearGreedGauge value={hasData ? fearGreedIndex : 50} />
      <div className="mt-1 text-[7px] text-[var(--terminal-muted)] font-mono text-center space-y-px">
        <div>Пок: <span className="text-[var(--terminal-positive)]">{fmtNum(buyLots)}</span> | Прод: <span className="text-[var(--terminal-negative)]">{fmtNum(sellLots)}</span></div>
        <div>Событий: <span className="text-[var(--terminal-text)]">{fmtNum(totalEvents)}</span></div>
      </div>
    </div>
  );
}
