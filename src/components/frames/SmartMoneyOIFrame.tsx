'use client';

import React, { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Activity, TrendingUp } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { fmtNum, fmtDelta } from '@/lib/helpers';

export function SmartMoneyOIFrame() {
  const futoiInstruments = useDashboardStore((s) => s.futoiInstruments);
  const futoiSource = useDashboardStore((s) => s.futoiSource);
  const futoiRealtime = useDashboardStore((s) => s.futoiRealtime);
  const compositeSMI = useDashboardStore((s) => s.compositeSMI);
  const compositeDirection = useDashboardStore((s) => s.compositeDirection);
  const oiHistory = useDashboardStore((s) => s.oiHistory);
  const [oiTicker, setOiTicker] = useState<string>('MX');

  const getSmiColor = (smi: number) => {
    if (smi > 30) return 'var(--terminal-positive)';
    if (smi > 10) return 'color-mix(in srgb, var(--terminal-positive) 65%, var(--terminal-text))';
    if (smi > -10) return 'var(--terminal-warning)';
    if (smi > -30) return 'color-mix(in srgb, var(--terminal-negative) 65%, var(--terminal-text))';
    return 'var(--terminal-negative)';
  };

  const getSmiLabel = (dir: string) => {
    const labels: Record<string, string> = {
      bullish: 'БЫЧИЙ',
      slightly_bullish: 'Умер. бычий',
      neutral: 'Нейтрально',
      slightly_bearish: 'Умер. медвежий',
      bearish: 'МЕДВЕЖИЙ',
      no_data: 'Нет данных',
      error: 'Ошибка',
    };
    return labels[dir] || dir;
  };

  return (
    <div className="flex border-b border-[var(--terminal-border)] shrink-0">
      {/* Left: Smart Money Gauge */}
      <div className="w-[38%] px-2 py-2 border-r border-[var(--terminal-border)]">
        <div className="flex items-center gap-1.5 mb-1">
          <TrendingUp className="w-2.5 h-2.5 text-[var(--terminal-positive)]" />
          <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">SMART MONEY</span>
          {futoiRealtime && (
            <span className="text-[6px] font-bold font-mono px-1 py-0.5 rounded bg-[var(--terminal-positive)]/15 text-[var(--terminal-positive)] border border-[var(--terminal-positive)]/30 animate-pulse">RT</span>
          )}
          {futoiSource && futoiSource !== 'none' && (
            <span className={`text-[6px] font-mono ml-auto ${futoiSource === 'apim_futoi' ? 'text-[var(--terminal-accent)]' : futoiSource === 'iss_authorized' ? 'text-[var(--terminal-accent)]' : 'text-[var(--terminal-muted)]'}`}>
              {futoiSource === 'apim_futoi' ? 'APIM' : futoiSource === 'iss_authorized' ? 'ISS+' : 'ISS'}
            </span>
          )}
        </div>
        {/* Composite SMI Gauge */}
        <div className="flex flex-col items-center mb-1">
          <div className="relative w-full max-w-[160px] h-[40px]">
            <div className="absolute bottom-0 left-0 right-0 h-[20px] rounded-full overflow-hidden flex">
              <div className="flex-1 bg-[var(--terminal-negative)]/20" />
              <div className="flex-1 bg-[var(--terminal-warning)]/20" />
              <div className="flex-1 bg-[var(--terminal-warning)]/20" />
              <div className="flex-1 bg-[var(--terminal-positive)]/20" />
              <div className="flex-1 bg-[var(--terminal-positive)]/20" />
            </div>
            <div className="absolute bottom-0 left-0 h-[20px] rounded-full overflow-hidden" style={{ width: `${(compositeSMI + 100) / 2}%`, background: `linear-gradient(90deg, var(--terminal-negative), var(--terminal-warning), var(--terminal-warning), var(--terminal-positive), var(--terminal-positive))` }} />
            <div className="absolute bottom-[16px] left-1/2 -translate-x-1/2 w-[1px] h-[20px] bg-white/80" />
            <div className="absolute bottom-[14px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[3px] border-r-[3px] border-t-[4px] border-transparent border-t-white" />
          </div>
          <div className="text-center mt-0.5">
            <span className="text-lg font-bold font-mono" style={{ color: getSmiColor(compositeSMI) }}>{compositeSMI}</span>
            <span className="text-[8px] ml-1 font-bold font-mono" style={{ color: getSmiColor(compositeSMI) }}>{getSmiLabel(compositeDirection)}</span>
          </div>
        </div>
      </div>

      {/* Right: OI Dynamics Chart */}
      <div className="w-[62%] px-2 py-2">
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
            <div className="w-full h-[120px]">
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
    </div>
  );
}
