'use client';

import React from 'react';
import { ResponsiveContainer, AreaChart, XAxis, YAxis, Tooltip, Area } from 'recharts';
import type { HourlyData } from '@/lib/types';

export function HourlyChart({ data }: { data: HourlyData[] }) {
  if (data.length === 0) {
    return <div className="text-[9px] text-[var(--terminal-muted)] text-center py-4 font-mono">Нет данных</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={130}>
      <AreaChart data={data} margin={{ left: -20, right: 5, top: 5, bottom: 0 }}>
        <XAxis dataKey="hour" tick={{ fill: 'var(--terminal-muted)', fontSize: 8, fontFamily: 'monospace' }} axisLine={{ stroke: 'var(--terminal-border)' }} tickLine={false} />
        <YAxis tick={{ fill: 'var(--terminal-muted)', fontSize: 8, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ backgroundColor: 'var(--terminal-surface)', border: '1px solid var(--terminal-border)', borderRadius: '6px', fontSize: '11px' }} labelStyle={{ color: 'var(--terminal-text)' }} />
        <Area type="monotone" dataKey="buy" stackId="1" stroke="var(--terminal-positive)" fill="var(--terminal-positive)" fillOpacity={0.15} strokeWidth={1.5} name="Покупка" />
        <Area type="monotone" dataKey="sell" stackId="1" stroke="var(--terminal-negative)" fill="var(--terminal-negative)" fillOpacity={0.15} strokeWidth={1.5} name="Продажа" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
