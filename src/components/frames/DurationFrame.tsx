'use client';

import React from 'react';
import { Clock } from 'lucide-react';
import { FrameTooltip } from './FrameTooltip';
import { useDashboardStore } from '@/lib/store';
import { fmtNum } from '@/lib/helpers';
import { PATTERNS } from '@/lib/static-data';
import type { RobotProfile } from '@/lib/types';

// ─── Профиль робота: цвета и ярлыки ───
const PROFILE_STYLES: Record<RobotProfile, { color: string; bg: string; border: string; label: string }> = {
  HFT:      { color: 'var(--terminal-negative)',     bg: 'var(--terminal-negative)12',  border: 'var(--terminal-negative)30',  label: 'HFT' },
  'СКАЛЬП': { color: 'var(--terminal-warning)',       bg: 'var(--terminal-warning)12',   border: 'var(--terminal-warning)30',   label: 'СКАЛЬП' },
  'ИМПУЛЬС':{ color: '#ffcc00',                      bg: '#ffcc0012',                   border: '#ffcc0030',                   label: 'ИМПУЛЬС' },
  'СТРУКТУР':{ color: 'var(--terminal-accent)',       bg: 'var(--terminal-accent)12',    border: 'var(--terminal-accent)30',    label: 'СТРУКТУР' },
  'НАКОПЛ': { color: 'var(--terminal-positive)',      bg: 'var(--terminal-positive)12',  border: 'var(--terminal-positive)30',  label: 'НАКОПЛ' },
  'МУЛЬТИ': { color: 'var(--terminal-text)',          bg: 'var(--terminal-text)08',      border: 'var(--terminal-text)20',      label: 'МУЛЬТИ' },
};

export function DurationFrame() {
  const tickerDurationAggs = useDashboardStore((s) => s.tickerDurationAggs);
  const dataSource = useDashboardStore((s) => s.dataSource);

  // Легенда длительности
  const DUR_LEGEND = [
    { key: 'hftLots', label: '0-3с HFT', cssVar: '--terminal-chart-hft' },
    { key: 'scalperLots', label: '3-30с Скальп', cssVar: '--terminal-chart-scalper' },
    { key: 'impulseLots', label: '30с-2м Импульс', cssVar: '--terminal-chart-impulse' },
    { key: 'structuralLots', label: '2-10м Структур', cssVar: '--terminal-chart-structural' },
    { key: 'accumulationLots', label: '10+м Накоплен', cssVar: '--terminal-chart-accumulation' },
  ] as const;

  if (tickerDurationAggs.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50">
          <Clock className="w-3 h-3 text-[var(--terminal-warning)]" />
          <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">АКТИВНОСТЬ v2: Роботы</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[9px] text-[var(--terminal-muted)] font-mono">{dataSource === 'closed' ? 'Биржа закрыта' : 'Ожидание данных...'}</p>
        </div>
      </div>
    );
  }

  // Логарифмическая шкала: медиана для нормализации (не максимум — чтобы гигант не схлопывал остальных)
  const allDurLots = tickerDurationAggs.map(t => t.hftLots + t.scalperLots + t.impulseLots + t.structuralLots + t.accumulationLots);
  const medianLots = allDurLots.length > 0 ? [...allDurLots].sort((a, b) => a - b)[Math.floor(allDurLots.length / 2)] : 1;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <Clock className="w-3 h-3 text-[var(--terminal-warning)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">АКТИВНОСТЬ v2: Роботы</span>
        <span className="text-[8px] text-[var(--terminal-muted)] font-mono ml-auto">{tickerDurationAggs.length} тик.</span>
        <FrameTooltip text="АКТИВНОСТЬ v2 — профиль роботов по каждому тикеру за 30 мин. Activity Score = dominanceWeight × aggression × persistence × (0.3 + 0.7 × volumeAnomaly) × algoConfirm × 100. dominanceWeight: один тип доминирует = 1.0, равномерное распределение = 0.5. algoConfirm — кросс-подтверждение AlgoPack: ×1.2 (СТАКАН), ×1.3 (ЛОКАТОР), ×1.5 (оба). Профиль робота: HFT (50%+ лотов 0-3с), СКАЛЬП (50%+ 3-30с), ИМПУЛЬС (30%+ 30с-2м), СТРУКТУР (30%+ 2-10м), НАКОПЛ (30%+ 10м+), МУЛЬТИ (2+ типа ≥ 20%). Фильтр: 3+ событий, 5000+ лотов. Направление: порог 20% (не 10%). Абсолютная шкала [0-100]: 90+ = мощнейшая программа, 50+ = значимая, 25+ = умеренная." />
      </div>
      {/* Легенда */}
      <div className="flex items-center gap-3 px-2.5 py-1 border-b border-[var(--terminal-border)]/30 bg-[var(--terminal-bg)] shrink-0">
        {DUR_LEGEND.map(l => (
          <span key={l.key} className="flex items-center gap-1 text-[7px] font-mono text-[var(--terminal-muted)]">
            <span className="w-2 h-1.5 rounded-sm" style={{ backgroundColor: `var(${l.cssVar})` }} />
            {l.label}
          </span>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto terminal-scroll">
        {tickerDurationAggs.map((t) => {
          const totalDurLots = t.hftLots + t.scalperLots + t.impulseLots + t.structuralLots + t.accumulationLots;
          // Логарифмическая ширина: log(1 + lots/median) / log(11) × 100%
          const barWidth = medianLots > 0 ? (Math.log(1 + totalDurLots / medianLots) / Math.log(11)) * 100 : 0;
          const hftPct = totalDurLots > 0 ? (t.hftLots / totalDurLots) * 100 : 0;
          const scPct = totalDurLots > 0 ? (t.scalperLots / totalDurLots) * 100 : 0;
          const imPct = totalDurLots > 0 ? (t.impulseLots / totalDurLots) * 100 : 0;
          const stPct = totalDurLots > 0 ? (t.structuralLots / totalDurLots) * 100 : 0;
          const acPct = totalDurLots > 0 ? (t.accumulationLots / totalDurLots) * 100 : 0;
          const dirColor = t.direction === 'LONG' ? 'var(--terminal-positive)' : t.direction === 'SHORT' ? 'var(--terminal-negative)' : 'var(--terminal-neutral)';
          const dirIcon = t.direction === 'LONG' ? '\u25B2' : t.direction === 'SHORT' ? '\u25BC' : '\u25CF';
          const dirLabel = t.direction === 'LONG' ? 'Пок' : t.direction === 'SHORT' ? 'Прод' : 'Нтр';
          const confPct = Math.round(t.avgConfidence * 100);
          const hasAlgoConfirm = (t.algoConfirm ?? 1) > 1.0;

          // Стиль профиля
          const pStyle = PROFILE_STYLES[t.robotProfile] || PROFILE_STYLES['МУЛЬТИ'];

          // SCORE бар: цвет по уровню
          const scoreVal = t.score ?? 0;
          const scoreColor = scoreVal >= 50 ? 'var(--terminal-positive)' : scoreVal >= 25 ? 'var(--terminal-warning)' : 'var(--terminal-muted)';

          return (
            <div key={t.ticker} className="px-2 py-1.5 border-b border-[var(--terminal-border)]/20 hover:bg-white/[0.02] transition-colors">
              {/* Row 1: ticker + direction + profile + events + lots + time */}
              <div className="flex items-center gap-1 text-[8px] font-mono">
                <span className="text-[var(--terminal-text)] font-bold w-10 shrink-0">{t.ticker}</span>
                <span className="font-bold shrink-0" style={{ color: dirColor }}>{dirIcon} {dirLabel}</span>
                {/* Профиль робота — ярлык */}
                <span
                  className="text-[6px] px-1 py-0 rounded-sm font-bold shrink-0"
                  style={{ color: pStyle.color, backgroundColor: pStyle.bg, borderColor: pStyle.border, borderWidth: '1px' }}
                >
                  {pStyle.label}
                </span>
                <span className="text-[var(--terminal-muted)] shrink-0">{t.events} соб</span>
                <span className="text-[var(--terminal-accent)] shrink-0">{fmtNum(t.buyLots + t.sellLots)} л</span>
                {/* AlgoConfirm star */}
                {hasAlgoConfirm && (
                  <span className="text-[var(--terminal-accent)] shrink-0" title={`AlgoConfirm: ×${(t.algoConfirm ?? 1).toFixed(1)}`}>★</span>
                )}
                <span className="text-[var(--terminal-muted)] ml-auto shrink-0">{t.lastTime}</span>
              </div>
              {/* Row 2: stacked duration bar (log scale) */}
              <div className="flex items-center gap-1.5 mt-1">
                <div className="h-3 bg-[var(--terminal-border)] rounded-sm overflow-hidden flex" style={{ width: `${Math.max(barWidth, 8)}%` }}>
                  {hftPct > 0 && <div style={{ width: `${hftPct}%`, backgroundColor: 'var(--terminal-chart-hft)', opacity: 0.9 }} title={`HFT: ${fmtNum(t.hftLots)} л`} />}
                  {scPct > 0 && <div style={{ width: `${scPct}%`, backgroundColor: 'var(--terminal-chart-scalper)', opacity: 0.8 }} title={`Скальп: ${fmtNum(t.scalperLots)} л`} />}
                  {imPct > 0 && <div style={{ width: `${imPct}%`, backgroundColor: 'var(--terminal-chart-impulse)', opacity: 0.8 }} title={`Импульс: ${fmtNum(t.impulseLots)} л`} />}
                  {stPct > 0 && <div style={{ width: `${stPct}%`, backgroundColor: 'var(--terminal-chart-structural)', opacity: 0.8 }} title={`Структур: ${fmtNum(t.structuralLots)} л`} />}
                  {acPct > 0 && <div style={{ width: `${acPct}%`, backgroundColor: 'var(--terminal-chart-accumulation)', opacity: 0.8 }} title={`Накоплен: ${fmtNum(t.accumulationLots)} л`} />}
                </div>
                {/* SCORE + confidence mini bar */}
                <div className="flex items-center gap-1 shrink-0">
                  <div className="w-8 h-1.5 bg-[var(--terminal-border)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${confPct}%`, backgroundColor: confPct > 70 ? 'var(--terminal-positive)' : confPct > 40 ? 'var(--terminal-neutral)' : 'var(--terminal-negative)', opacity: 0.7 }} />
                  </div>
                  <span className="text-[7px] font-bold" style={{ color: scoreColor }}>{scoreVal.toFixed(0)}</span>
                </div>
              </div>
              {/* Row 3: patterns tags (filtered by avgConfidence ≥ 0.6, max 4) */}
              {t.patterns.length > 0 && (
                <div className="flex flex-wrap gap-0.5 mt-0.5">
                  {t.patterns
                    .filter(p => {
                      // Фильтр: показываем только паттерны с высокой confidence
                      // Айсберг с confidence < 0.6 — это шум (1000 лотов — не айсберг)
                      const isLowConfIceberg = p === 'Айсберг' && t.avgConfidence < 0.6;
                      return !isLowConfIceberg;
                    })
                    .slice(0, 4)
                    .map(p => {
                      const pIdx = PATTERNS.findIndex(pp => pp.name === p);
                      const cssVar = pIdx >= 0 ? `--terminal-chart-pattern-${pIdx + 1}` : '--terminal-muted';
                      return (
                        <span key={p} className="text-[6px] px-1 py-0 rounded-sm font-mono border" style={{ color: `var(${cssVar})`, borderColor: `color-mix(in srgb, var(${cssVar}) 30%, transparent)`, backgroundColor: `color-mix(in srgb, var(${cssVar}) 12%, transparent)` }}>
                          {p.length > 6 ? p.slice(0, 6) + '.' : p}
                        </span>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
