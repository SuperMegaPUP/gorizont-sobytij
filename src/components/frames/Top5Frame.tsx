'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { fmtNum } from '@/lib/helpers';

export function Top5Frame() {
  const topTickers = useDashboardStore((s) => s.topTickers);
  const dataSource = useDashboardStore((s) => s.dataSource);

  return (
    <div className="px-3 py-3 border-b border-[var(--terminal-border)] shrink-0">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-3.5 h-3.5 text-[var(--terminal-warning)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">ТОП-5 ИНСТРУМЕНТОВ</span>
      </div>
      {topTickers.length === 0 ? (
        <div className="text-[9px] text-[var(--terminal-muted)] font-mono text-center py-4">
          {dataSource === 'closed' ? 'Биржа закрыта' : 'Ожидание данных...'}
        </div>
      ) : (
        <div className="space-y-2">
          {topTickers.map((t, i) => (
            <motion.div key={t.ticker} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }} className="text-[9px] font-mono">
              <div className="flex items-center justify-between">
                <span className="text-[var(--terminal-muted)] w-4">{i + 1}.</span>
                <span className="text-[var(--terminal-text)] font-bold flex-1">{t.ticker}</span>
                <span className="text-[var(--terminal-muted)]">Соб: <span className="text-[var(--terminal-text)]">{t.events}</span></span>
              </div>
              <div className="flex items-center justify-between text-[8px] mt-0.5">
                <span className="text-[var(--terminal-positive)]">{'\u25B2'} {fmtNum(t.buyLots)}</span>
                <span className="text-[var(--terminal-negative)]">{'\u25BC'} {fmtNum(t.sellLots)}</span>
                <span className="text-[var(--terminal-muted)]">Ср.ув.: <span className="text-[var(--terminal-text)]">{Math.round(t.avgConfidence * 100)}%</span></span>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <div className="flex-1 h-1.5 bg-[var(--terminal-border)] rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(t.score * 100, 100)}%` }} transition={{ duration: 1, delay: i * 0.15 }} className="h-full bg-[var(--terminal-accent)] rounded-full" />
                </div>
                <span className="text-[8px] text-[var(--terminal-muted)] w-12 text-right">SC: {(t.score ?? 0).toFixed(1)}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
