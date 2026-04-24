'use client';

import React from 'react';
import { Activity } from 'lucide-react';
import { FrameTooltip } from './FrameTooltip';
import { ResponsiveContainer, AreaChart, XAxis, YAxis, Tooltip, Area } from 'recharts';
import { useDashboardStore } from '@/lib/store';

export function DynamicsFrame() {
  const timeBuckets = useDashboardStore((s) => s.timeBuckets);
  const dataSource = useDashboardStore((s) => s.dataSource);

  if (timeBuckets.length === 0 || timeBuckets.every(b => b.events === 0)) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50">
          <Activity className="w-3 h-3 text-[var(--terminal-positive)]" />
          <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">ДИНАМИКА: Волна л/ш</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[9px] text-[var(--terminal-muted)] font-mono">{dataSource === 'closed' ? 'Биржа закрыта' : 'Ожидание данных...'}</p>
        </div>
      </div>
    );
  }

  const chartData = timeBuckets.map(b => ({
    window: b.window,
    buy: b.buyLots,
    sell: b.sellLots,
    delta: b.delta,
    events: b.events,
  }));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <Activity className="w-3 h-3 text-[var(--terminal-positive)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">ДИНАМИКА: Волна л/ш</span>
        <FrameTooltip text="Волна агрессивных покупок и продаж роботов за последние 4 часа в 5-минутных окнах. Зелёная область — агрессивные покупки (маркет-ордера на покупку), красная — агрессивные продажи (маркет-ордера на продажу). Важно: это НЕ позиции лонг/шорт, а сторона-агрессор в сделке. Лонгист, закрывающий позицию маркет-ордером на продажу, отображается как «Продажи». Hover на точку графика — точные значения. Данные сохраняются в БД и не теряются при обновлении. Нарастающая волна покупок — бычий импульс; продаж — медвежий. Разворот волны — смена настроения." />
      </div>
      <div className="flex-1 flex flex-col">
        {/* Area chart — занимает всю доступную высоту */}
        <div className="flex-1 px-1 pt-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ left: -25, right: 5, top: 5, bottom: 0 }}>
              <XAxis dataKey="window" tick={{ fill: 'var(--terminal-muted)', fontSize: 7, fontFamily: 'monospace' }} axisLine={{ stroke: 'var(--terminal-border)' }} tickLine={false} />
              <YAxis tick={{ fill: 'var(--terminal-muted)', fontSize: 7, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ backgroundColor: 'var(--terminal-surface)', border: '1px solid var(--terminal-border)', borderRadius: '6px', fontSize: '10px' }} labelStyle={{ color: 'var(--terminal-text)' }} />
              <Area type="monotone" dataKey="buy" stackId="1" stroke="var(--terminal-positive)" fill="var(--terminal-positive)" fillOpacity={0.15} strokeWidth={1.5} name="Покупки" />
              <Area type="monotone" dataKey="sell" stackId="1" stroke="var(--terminal-negative)" fill="var(--terminal-negative)" fillOpacity={0.15} strokeWidth={1.5} name="Продажи" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {/* Legend */}
        <div className="flex items-center justify-center gap-4 px-2 py-1 text-[7px] font-mono text-[var(--terminal-muted)] shrink-0">
          <span className="flex items-center gap-1"><span className="w-2 h-1 rounded-full bg-[var(--terminal-positive)]" /> Покупки</span>
          <span className="flex items-center gap-1"><span className="w-2 h-1 rounded-full bg-[var(--terminal-negative)]" /> Продажи</span>
        </div>
      </div>
    </div>
  );
}
