'use client';

import React, { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Activity } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { fmtNum } from '@/lib/helpers';

export function OiDynamicsFrame() {
  const oiHistory = useDashboardStore((s) => s.oiHistory);
  const [oiTicker, setOiTicker] = useState<string>('MX');

  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Activity className="w-2.5 h-2.5 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">OI ДИНАМИКА</span>
        <div className="flex gap-px ml-auto">
          {['MX', 'Si', 'RI', 'BR'].map(t => (
            <button
              key={t}
              onClick={() => setOiTicker(t)}
              className={`text-[6px] font-bold font-mono px-1 py-0.5 rounded transition-colors ${
                oiTicker === t
                  ? 'bg-[var(--terminal-accent)]/20 text-[var(--terminal-accent)] border border-[var(--terminal-accent)]/40'
                  : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-neutral)] border border-transparent'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {(() => {
        const snapshots = oiHistory[oiTicker] || [];
        if (snapshots.length < 2) {
          return (
            <div className="text-[7px] text-[var(--terminal-muted)] font-mono text-center py-3">
              {snapshots.length === 0 ? 'Накопление данных...' : `${snapshots.length} точка — нужно 2+`}
            </div>
          );
        }
        const chartData = snapshots.map(s => ({
          time: s.time,
          yurLong: s.yurLong,
          fizLong: s.fizLong,
          yurShort: -s.yurShort,
          fizShort: -s.fizShort,
        }));
        const maxY = Math.max(...snapshots.map(s => s.yurLong + s.fizLong)) || 1;
        const minY = Math.min(...chartData.map(s => s.yurShort + s.fizShort)) || -1;
        return (
          <div className="w-full h-[140px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 6, fill: 'var(--terminal-muted)' }}
                  axisLine={{ stroke: 'var(--terminal-border)' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[Math.floor(minY / 1000) * 1000, Math.ceil(maxY / 1000) * 1000]}
                  tick={{ fontSize: 5, fill: 'var(--terminal-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                  tickFormatter={(v: number) => v >= 0 ? `${(v / 1000).toFixed(0)}к` : `${(v / 1000).toFixed(0)}к`}
                />
                <Tooltip
                  contentStyle={{ fontSize: 7, background: 'var(--terminal-bg)', border: '1px solid var(--terminal-border)', borderRadius: 4, padding: 3 }}
                  labelStyle={{ color: 'var(--terminal-muted)', fontSize: 6 }}
                  formatter={(value: number, name: string) => {
                    const labels: Record<string, string> = {
                      yurLong: 'ЮР Лонг', fizLong: 'ФИЗ Лонг',
                      yurShort: 'ЮР Шорт', fizShort: 'ФИЗ Шорт',
                    };
                    return [fmtNum(Math.abs(value)), labels[name] || name];
                  }}
                />
                <Area type="monotone" dataKey="yurLong" stackId="longs" stroke="var(--terminal-positive)" fill="var(--terminal-positive)30" strokeWidth={1} name="yurLong" label={false} />
                <Area type="monotone" dataKey="fizLong" stackId="longs" stroke="var(--terminal-positive)" fill="var(--terminal-positive)20" strokeWidth={1} name="fizLong" label={false} />
                <Area type="monotone" dataKey="yurShort" stackId="shorts" stroke="var(--terminal-negative)" fill="var(--terminal-negative)30" strokeWidth={1} name="yurShort" label={false} />
                <Area type="monotone" dataKey="fizShort" stackId="shorts" stroke="var(--terminal-warning)" fill="var(--terminal-warning)20" strokeWidth={1} name="fizShort" label={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );
      })()}
    </div>
  );
}
