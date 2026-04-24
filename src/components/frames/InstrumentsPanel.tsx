'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Database } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { fmtNum } from '@/lib/helpers';

export function InstrumentsPanel() {
  const instruments = useDashboardStore((s) => s.instruments);
  const dataSource = useDashboardStore((s) => s.dataSource);

  if (instruments.length === 0) {
    return (
      <div className="flex flex-col">
        <div className="px-3 py-2 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-[var(--terminal-accent)]" />
            <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">ТОП-100 ИНСТРУМЕНТЫ</span>
          </div>
        </div>
        <div className="px-3 py-8 text-center">
          <Database className="w-6 h-6 text-[var(--terminal-border)] mx-auto mb-2" />
          <p className="text-[9px] text-[var(--terminal-muted)] font-mono">
            {dataSource === 'closed' ? 'Биржа закрыта. Данные будут доступны в торговые часы.' : 'Загрузка данных с MOEX API...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[var(--terminal-accent)]" />
          <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">ТОП-100 ИНСТРУМЕНТЫ</span>
        </div>
        <div className="grid grid-cols-[20px_1fr_1fr_1fr] gap-1 mt-1.5 text-[8px] text-[var(--terminal-muted)] font-mono px-0.5">
          <span>#</span>
          <span>Тикер</span>
          <span className="text-right">Объём</span>
          <span className="text-right">Оборот</span>
        </div>
      </div>
      <div>
        {instruments.map((inst) => (
          <motion.div
            key={inst.ticker}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: inst.rank * 0.01 }}
            className="grid grid-cols-[20px_1fr_1fr_1fr] gap-1 px-2.5 py-1.5 text-[10px] font-mono hover:bg-[var(--terminal-positive)]/5 border-b border-[var(--terminal-border)]/30 cursor-pointer transition-colors"
          >
            <span className="text-[var(--terminal-muted)]">
              {inst.rank <= 3 ? (
                <span className={inst.rank === 1 ? 'text-[var(--terminal-neutral)] font-bold' : inst.rank === 2 ? 'text-gray-300 font-bold' : 'text-orange-400 font-bold'}>
                  {inst.rank}
                </span>
              ) : inst.rank}
            </span>
            <span className="text-[var(--terminal-text)] font-bold flex items-center gap-0.5">
              {inst.rank <= 3 && (
                <span className="text-[8px]">
                  {inst.rank === 1 ? '\uD83E\uDD47' : inst.rank === 2 ? '\uD83E\uDD48' : '\uD83E\uDD49'}
                </span>
              )}
              {inst.ticker}
            </span>
            <span className="text-[var(--terminal-muted)] text-right">{fmtNum(inst.volume)}</span>
            <span className="text-[var(--terminal-accent)] text-right">{inst.turnover}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
