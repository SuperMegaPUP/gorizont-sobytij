'use client';

import React from 'react';
import { ResponsiveContainer, BarChart, XAxis, YAxis, Tooltip, Bar, Cell } from 'recharts';
import type { StrategyItem } from '@/lib/types';
import { PATTERNS } from '@/lib/static-data';

/** Map strategy name to its CSS variable for theme-aware coloring */
function getStrategyCssVar(name: string): string {
  const idx = PATTERNS.findIndex(p => p.name === name);
  return idx >= 0 ? `--terminal-chart-pattern-${idx + 1}` : '--terminal-muted';
}

export function StrategyChart({ data }: { data: StrategyItem[] }) {
  if (data.length === 0) {
    return <div className="text-[9px] text-[var(--terminal-muted)] text-center py-4 font-mono">Нет данных</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
        <XAxis type="number" hide />
        <YAxis dataKey="name" type="category" width={95} tick={{ fill: 'var(--terminal-neutral)', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ backgroundColor: 'var(--terminal-surface)', border: '1px solid var(--terminal-border)', borderRadius: '6px', fontSize: '12px' }} labelStyle={{ color: 'var(--terminal-text)' }} itemStyle={{ color: 'var(--terminal-neutral)' }} formatter={(val: number, _name: string, props: { payload: StrategyItem }) => [`${val} (${props.payload.percentage}%)`, 'Кол-во']} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={12}>
          {data.map((entry, index) => {
            const cssVar = getStrategyCssVar(entry.name);
            return (
              <Cell key={`cell-${index}`} fill={`var(${cssVar})`} fillOpacity={0.85} />
            );
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
