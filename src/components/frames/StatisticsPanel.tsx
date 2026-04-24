'use client';

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Activity, AlertTriangle, Clock, Database, Shield, TrendingUp, Zap,
} from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { FearGreedGauge } from './FearGreedGauge';
import { HourlyChart } from './HourlyChart';
import { StrategyChart } from './StrategyChart';
import { fmtNum, fmtDelta, toMoscowTime } from '@/lib/helpers';

export function StatisticsPanel() {
  const fearGreedIndex = useDashboardStore((s) => s.fearGreedIndex);
  const topTickers = useDashboardStore((s) => s.topTickers);
  const strategyDistribution = useDashboardStore((s) => s.strategyDistribution);
  const hourlyActivity = useDashboardStore((s) => s.hourlyActivity);
  // Фильтруем hourlyActivity — только последние 6 часов по МСК
  const hourlyActivity6h = useMemo(() => {
    if (hourlyActivity.length === 0) return [];
    const now = new Date();
    const msk = toMoscowTime(now);
    const currentHour = msk.getHours();
    return hourlyActivity.filter(h => {
      const hourNum = parseInt(h.hour.split(':')[0], 10);
      const diff = (currentHour - hourNum + 24) % 24;
      return diff < 6;
    });
  }, [hourlyActivity]);
  const anomalies = useDashboardStore((s) => s.anomalies);
  const buyLots = useDashboardStore((s) => s.buyLots);
  const sellLots = useDashboardStore((s) => s.sellLots);
  const totalEvents = useDashboardStore((s) => s.totalEvents);
  const dataSource = useDashboardStore((s) => s.dataSource);
  const futoiInstruments = useDashboardStore((s) => s.futoiInstruments);
  const futoiSource = useDashboardStore((s) => s.futoiSource);
  const futoiRealtime = useDashboardStore((s) => s.futoiRealtime);
  const compositeSMI = useDashboardStore((s) => s.compositeSMI);
  const compositeDirection = useDashboardStore((s) => s.compositeDirection);
  const oiHistory = useDashboardStore((s) => s.oiHistory);
  const [oiTicker, setOiTicker] = useState<string>('MX');

  const dbLoaded = useDashboardStore((s) => s.dbLoaded);
  const hasData = totalEvents > 0 || dbLoaded;

  const FUTOI_TICKER_NAMES: Record<string, string> = {
    MX: 'MX (Российский рынок)',
    SR: 'SR (Сбербанк)',
    GZ: 'GZ (Газпром)',
    Si: 'Si (Доллар/рубль)',
    LK: 'LK (Лукойл)',
    RI: 'RI (Индекс РТС)',
    RN: 'RN (Роснефть)',
    BR: 'BR (Brent)',
    GK: 'GK (Норникель)',
  };

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
    <div className="flex flex-col gap-0">
      {/* ─── АНОМАЛИИ (отдельный фрейм) ─── */}
      <div id="anomalies-section" className="px-2 py-1.5 border-b border-[var(--terminal-border)] shrink-0">
        <div className="flex items-center gap-1.5 mb-1">
          <AlertTriangle className="w-2.5 h-2.5 text-[var(--terminal-warning)]" />
          <h3 className="text-[8px] font-bold text-[var(--terminal-text)] tracking-wide">АНОМАЛИИ</h3>
          <span className="text-[6px] text-[var(--terminal-muted)] font-mono ml-auto">10 мин</span>
        </div>
        {anomalies.length === 0 ? (
          <div className="text-[7px] text-[var(--terminal-muted)] font-mono text-center py-1">
            {hasData ? 'Нет аномалий' : dataSource === 'closed' ? 'Биржа закрыта' : 'Ожидание...'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-2 gap-y-px">
            {anomalies.map((a) => {
              const now = Date.now();
              const isBlinking = a.blinkUntil && now < a.blinkUntil;
              return (
                <div key={a.id} className={`flex items-center gap-1 px-1.5 py-0.5 text-[7px] font-mono transition-all duration-500 ${
                  isBlinking
                    ? 'border border-[var(--terminal-warning)]/50 bg-[var(--terminal-warning)]/8 rounded'
                    : 'border border-transparent bg-transparent opacity-60'
                }`}>
                  <span className={`shrink-0 ${isBlinking ? 'text-[var(--terminal-warning)]' : 'text-[var(--terminal-muted)]'}`}>{'\u26A0'}</span>
                  <span className="text-[var(--terminal-text)] font-bold truncate">{a.ticker}</span>
                  <span className={a.direction === 'sell' ? 'text-[var(--terminal-negative)]' : 'text-[var(--terminal-positive)]'}>
                    {a.direction === 'buy' ? '\u25B2' : '\u25BC'}
                  </span>
                  <span className="text-[var(--terminal-muted)] truncate">{fmtNum(a.lots)}л</span>
                  <span className="text-[var(--terminal-accent)] truncate">{a.pattern}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── СТРАХ/ЖАДНОСТЬ + АКТИВНОСТЬ ПО ЧАСАМ ─── */}
      <div className="flex border-b border-[var(--terminal-border)] shrink-0">
        {/* Left: Fear/Greed gauge */}
        <div className="w-[45%] px-2 py-2 border-r border-[var(--terminal-border)]">
          <div className="flex items-center gap-1.5 mb-1">
            <Shield className="w-2.5 h-2.5 text-[var(--terminal-warning)]" />
            <h3 className="text-[8px] font-bold text-[var(--terminal-text)] tracking-wide">СТРАХ / ЖАДНОСТЬ</h3>
          </div>
          <FearGreedGauge value={hasData ? fearGreedIndex : 50} />
          <div className="mt-1 text-[7px] text-[var(--terminal-muted)] font-mono text-center space-y-px">
            <div>Пок: <span className="text-[var(--terminal-positive)]">{fmtNum(buyLots)}</span> | Прод: <span className="text-[var(--terminal-negative)]">{fmtNum(sellLots)}</span></div>
            <div>Событий: <span className="text-[var(--terminal-text)]">{fmtNum(totalEvents)}</span></div>
          </div>
        </div>

        {/* Right: Hourly Activity */}
        <div className="w-[55%] px-2 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="w-2.5 h-2.5 text-[var(--terminal-positive)]" />
            <h3 className="text-[8px] font-bold text-[var(--terminal-text)] tracking-wide">АКТИВНОСТЬ / ЧАС</h3>
            <span className="text-[6px] text-[var(--terminal-muted)] font-mono ml-auto">6ч</span>
          </div>
          <HourlyChart data={hourlyActivity6h} />
          <div className="flex items-center justify-center gap-3 mt-0.5 text-[7px] font-mono text-[var(--terminal-muted)]">
            <span className="flex items-center gap-1"><span className="w-2 h-1 rounded-full bg-[var(--terminal-positive)]" /> Пок</span>
            <span className="flex items-center gap-1"><span className="w-2 h-1 rounded-full bg-[var(--terminal-negative)]" /> Прод</span>
          </div>
        </div>
      </div>

      {/* ─── SMART MONEY INDEX + ДИНАМИКА ОИ (side by side) ─── */}
      <div className="flex border-b border-[var(--terminal-border)] shrink-0">
        {/* Left: Smart Money Gauge */}
        <div className="w-[38%] px-2 py-2 border-r border-[var(--terminal-border)]">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-2.5 h-2.5 text-[var(--terminal-positive)]" />
            <h3 className="text-[8px] font-bold text-[var(--terminal-text)] tracking-wide">SMART MONEY</h3>
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
            <span className="text-[8px] font-bold text-[var(--terminal-text)] font-mono tracking-wide">ДИНАМИКА ОИ</span>
            <div className="flex gap-px ml-auto">
              {['MX', 'SR', 'GZ', 'Si', 'LK', 'RI', 'RN', 'BR', 'GK'].map(t => (
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

      {/* ─── ФЬЮЧЕРСЫ: OI — 2-колоночный grid с прокруткой ─── */}
      <div className="px-2 py-1.5 border-b border-[var(--terminal-border)]">
        <div className="flex items-center gap-1.5 mb-1">
          <Database className="w-2.5 h-2.5 text-[var(--terminal-accent)]" />
          <h3 className="text-[9px] font-bold text-[var(--terminal-text)] tracking-wide">ФЬЮЧЕРСЫ: ОТКРЫТЫЙ ИНТЕРЕС</h3>
          {futoiInstruments.length > 0 && futoiInstruments[0]?.tradetime && (
            <span className="text-[8px] text-[var(--terminal-accent)] font-mono ml-auto">
              {futoiInstruments[0].tradetime} МСК
            </span>
          )}
          {futoiInstruments.length > 0 && !futoiInstruments[0]?.tradetime && futoiInstruments[0]?.timestamp && (
            <span className="text-[8px] text-[var(--terminal-muted)] font-mono ml-auto">
              {futoiInstruments[0].timestamp}
            </span>
          )}
        </div>
        {futoiInstruments.length === 0 ? (
          <div className="text-[8px] text-[var(--terminal-muted)] font-mono text-center py-2">Загрузка OI...</div>
        ) : (
          <div className="grid grid-cols-2 gap-1 overflow-y-auto terminal-scroll" style={{ maxHeight: '200px' }}>
            {futoiInstruments.map((inst) => {
              const isDiv = (inst.yur.pos >= 0 && inst.fiz.pos < 0) || (inst.yur.pos < 0 && inst.fiz.pos >= 0);
              const tickerName = FUTOI_TICKER_NAMES[inst.ticker] || inst.ticker;
              return (
                <div key={inst.ticker} className={`rounded border ${isDiv ? 'border-[var(--terminal-warning)]/30 bg-[var(--terminal-warning)]/5' : 'border-[var(--terminal-border)] bg-[var(--terminal-bg)]'} px-1.5 py-1`}>
                  {/* Заголовок: тикер + SMI */}
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[9px] font-bold text-[var(--terminal-text)] truncate" title={tickerName}>{inst.ticker}</span>
                    <span className="text-[9px] font-bold font-mono" style={{ color: getSmiColor(inst.smi) }}>
                      {inst.smi > 0 ? '+' : ''}{inst.smi}
                    </span>
                  </div>
                  {/* Компактные данные: ЮР / ФИЗ */}
                  <div className="text-[7px] font-mono space-y-px">
                    <div className="flex justify-between">
                      <span className="text-[var(--terminal-accent)] font-bold">ЮР</span>
                      <span className={inst.yur.pos >= 0 ? 'text-[var(--terminal-positive)]' : 'text-[var(--terminal-negative)]'}>
                        {inst.yur.pos >= 0 ? '▲' : '▼'}{fmtNum(Math.abs(inst.yur.pos))}
                        {inst.yur.oi_change_long !== 0 && <span className="text-[var(--terminal-muted)]"> ({fmtDelta(inst.yur.oi_change_long - inst.yur.oi_change_short)})</span>}
                      </span>
                    </div>
                    <div className="flex justify-between text-[var(--terminal-muted)]">
                      <span>Л {fmtNum(inst.yur.pos_long)}</span>
                      <span>Ш {fmtNum(Math.abs(inst.yur.pos_short))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--terminal-accent)] font-bold">ФИЗ</span>
                      <span className={inst.fiz.pos >= 0 ? 'text-[var(--terminal-positive)]' : 'text-[var(--terminal-negative)]'}>
                        {inst.fiz.pos >= 0 ? '▲' : '▼'}{fmtNum(Math.abs(inst.fiz.pos))}
                      </span>
                    </div>
                    <div className="flex justify-between text-[var(--terminal-muted)]">
                      <span>Л {fmtNum(inst.fiz.pos_long)}</span>
                      <span>Ш {fmtNum(Math.abs(inst.fiz.pos_short))}</span>
                    </div>
                  </div>
                  {/* Дивергенция */}
                  {isDiv && (
                    <div className="mt-0.5 text-[6px] font-bold text-[var(--terminal-warning)] bg-[var(--terminal-warning)]/10 rounded px-1 py-px text-center">
                      {'\u26A0'} ДИВ: ЮР {inst.yur.pos >= 0 ? 'ЛОНГ' : 'ШОРТ'} vs ФИЗ
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-3 border-b border-[var(--terminal-border)] shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-3.5 h-3.5 text-[var(--terminal-warning)]" />
          <h3 className="text-[10px] font-bold text-[var(--terminal-text)] tracking-wide">ТОП-5 ИНСТРУМЕНТОВ</h3>
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

      <div className="px-3 py-2 border-b border-[var(--terminal-border)] shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-3.5 h-3.5 text-[var(--terminal-accent)]" />
          <h3 className="text-[10px] font-bold text-[var(--terminal-text)] tracking-wide">РАСПРЕДЕЛЕНИЕ СТРАТЕГИЙ</h3>
        </div>
        <StrategyChart data={strategyDistribution} />
      </div>

      <div className="px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 text-[9px] text-[var(--terminal-muted)] font-mono">
          <Database className="w-3 h-3" />
          <span>T-Invest API | MOEX API | SQLite</span>
        </div>
      </div>
    </div>
  );
}
