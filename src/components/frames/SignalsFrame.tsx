'use client';

import React, { useState } from 'react';
import { Zap } from 'lucide-react';
import { FrameTooltip } from './FrameTooltip';
import { useDashboardStore } from '@/lib/store';
import { fmtNum, fmtImpact } from '@/lib/helpers';

// Фрейм 4: СИГНАЛЫ v2 — Концентрация силы (графический эквалайзер)
// SCORE [0-100]: concentration × persistence × volumeAnomaly × algoConfirm × 100
// algoConfirm: кросс-подтверждение из AlgoPack (СТАКАН × 1.2, ЛОКАТОР × 1.3, оба × 1.5)
export function SignalsFrame() {
  const signals = useDashboardStore((s) => s.signals);
  const tickerAggs = useDashboardStore((s) => s.tickerAggs);
  const dataSource = useDashboardStore((s) => s.dataSource);
  const [tooltipInfo, setTooltipInfo] = useState<{ id: string; text: string } | null>(null);

  // Потенциальные: 3 события, но SCORE < 25 (ещё не достигли порога СРЕДНИЙ)
  const weakSignals = tickerAggs.filter(t => t.events >= 3 && t.totalLots >= 5000).slice(0, 3);

  // Максимальное значение для шкалы эквалайзера
  const maxSignalLots = Math.max(...signals.map(s => s.lots), 1);
  const maxSignalScore = Math.max(...signals.map(s => s.score), 1);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <Zap className="w-3 h-3 text-[var(--terminal-warning)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">СИГНАЛЫ: Концентрация силы</span>
        <span className="text-[8px] text-[var(--terminal-muted)] font-mono ml-auto">{signals.length} сигн.</span>
        <FrameTooltip text="СИГНАЛЫ v2 — концентрация робот-силы в одном направлении за 30 мин. SCORE [0-100] = concentration × persistence × (0.3 + 0.7 × volumeAnomaly) × algoConfirm × 100. concentration = |deltaNet|/totalLots — направленная концентрация. persistence = min(events/8, 1) — устойчивость (8+ соб = 1.0). volumeAnomaly = log(1 + avgLots/median) — аномалия объёма. algoConfirm — кросс-подтверждение AlgoPack: ×1.2 (СТАКАН-СКАНЕР), ×1.3 (ЛОКАТОР КРУПНЯКА), ×1.5 (оба). СИЛЬНЫЙ: SCORE ≥ 50 + 5+ событий. СРЕДНИЙ: SCORE ≥ 25 + 3+ событий. Фильтр: 5000+ лотов + 3+ события. ★ = AlgoPack подтверждает направление. Абсолютная шкала: 90-100 = мощнейший сигнал, 50-89 = значимый, 25-49 = умеренный." />
      </div>
      <div className="flex-1 overflow-y-auto terminal-scroll">
        {signals.length === 0 && weakSignals.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[9px] text-[var(--terminal-muted)] font-mono">{dataSource === 'closed' ? 'Биржа закрыта' : 'Накопление данных...'}</p>
          </div>
        ) : (
          <>
            {/* ─── Graphic Equalizer View ─── */}
            {signals.length > 0 && (
              <div className="px-2 pt-2 pb-1">
                {/* Equalizer bars container */}
                <div className="flex items-end gap-[3px] h-[70px] bg-[var(--terminal-bg)]/50 rounded p-1.5">
                  {signals.slice(0, 16).map((s) => {
                    const isStrong = s.strength === 'STRONG';
                    const isLong = s.direction === 'LONG';
                    // Высота по SCORE (абсолютная шкала), не по лотам
                    const heightPct = maxSignalScore > 0 ? (s.score / maxSignalScore) * 100 : 0;
                    const baseColor = isLong ? 'var(--terminal-positive)' : 'var(--terminal-negative)';
                    const glowColor = isLong ? 'var(--terminal-positive)40' : 'var(--terminal-negative)40';
                    const confAlpha = 0.4 + (s.avgConfidence ?? 0) * 0.6; // 0.4-1.0
                    const hasAlgoConfirm = (s.algoConfirm ?? 1) > 1.0;
                    const confirmLabel = (s.algoConfirm ?? 1) >= 1.5 ? '++' : (s.algoConfirm ?? 1) >= 1.3 ? '+' : (s.algoConfirm ?? 1) >= 1.2 ? '+' : '';
                    return (
                      <div
                        key={s.id}
                        className="flex-1 min-w-[12px] max-w-[26px] flex flex-col items-center justify-end h-full cursor-help relative group"
                        onMouseEnter={() => setTooltipInfo({ id: s.id, text: `${s.ticker} ${s.direction} | ${s.strength} | ${s.events} соб | ${fmtNum(s.lots)} л | SCORE: ${(s.score ?? 0).toFixed(1)} | Ув: ${((s.avgConfidence ?? 0) * 100).toFixed(0)}% | AlgoConfirm: ×${(s.algoConfirm ?? 1).toFixed(1)} | Цена: ${fmtImpact(s.priceImpact)}` })}
                        onMouseLeave={() => setTooltipInfo(null)}
                      >
                        {/* Ticker label on top of bar — adaptive, max 8 chars */}
                        <span className="text-[6px] font-mono font-bold mb-0.5 whitespace-nowrap" style={{ color: baseColor, opacity: 0.8, fontSize: s.ticker.length > 5 ? '5px' : undefined }}>
                          {s.ticker.slice(0, 8)}{hasAlgoConfirm ? confirmLabel : ''}
                        </span>
                        {/* The equalizer bar with segments */}
                        <div className="w-full rounded-t-sm relative" style={{ height: `${Math.max(heightPct, 8)}%` }}>
                          {/* Glow effect */}
                          <div className="absolute inset-0 rounded-t-sm" style={{ backgroundColor: glowColor, filter: isStrong ? 'blur(3px)' : 'none' }} />
                          {/* Main bar with frequency bands (3 segments) */}
                          <div className="relative flex flex-col justify-end h-full rounded-t-sm overflow-hidden">
                            {/* Bottom band: core volume */}
                            <div className="w-full" style={{ height: '60%', backgroundColor: baseColor, opacity: confAlpha }} />
                            {/* Middle band: medium intensity */}
                            <div className="w-full" style={{ height: '25%', backgroundColor: baseColor, opacity: confAlpha * 0.6 }} />
                            {/* Top band: peak (flicker) */}
                            <div className="w-full" style={{ height: '15%', backgroundColor: baseColor, opacity: confAlpha * 0.3 }} />
                          </div>
                          {/* Strength indicator dot */}
                          <div className="absolute -top-1 left-1/2 -translate-x-1/2">
                            {isStrong && <span className="block w-1.5 h-1.5 rounded-full bg-[var(--terminal-warning)] animate-pulse" />}
                          </div>
                          {/* AlgoPack confirm star */}
                          {hasAlgoConfirm && (
                            <div className="absolute -top-1 right-0">
                              <span className="text-[5px] text-[var(--terminal-accent)]">★</span>
                            </div>
                          )}
                        </div>
                        {/* Direction arrow below bar */}
                        <span className="text-[6px] mt-0.5" style={{ color: baseColor }}>
                          {isLong ? '\u25B2' : '\u25BC'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {/* Floating tooltip */}
                {tooltipInfo && (
                  <div className="mt-1 px-2 py-1 bg-[var(--terminal-surface)] border border-[var(--terminal-border)] rounded text-[7px] text-[var(--terminal-neutral)] font-mono">
                    {tooltipInfo.text}
                  </div>
                )}
              </div>
            )}
            {/* ─── Compact signal list (below equalizer) ─── */}
            {signals.length > 0 && (
              <div className="px-2 pb-1">
                <div className="space-y-0.5">
                  {signals.slice(0, 6).map((s) => {
                    const isStrong = s.strength === 'STRONG';
                    const isLong = s.direction === 'LONG';
                    const baseColor = isLong ? 'var(--terminal-positive)' : 'var(--terminal-negative)';
                    const bgColor = isLong ? 'var(--terminal-positive)08' : 'var(--terminal-negative)08';
                    const strengthIcon = isStrong ? '\u26A1' : '\u26A0';
                    const strengthLabel = isStrong ? 'СИЛ' : 'СРЕД';
                    const hasAlgoConfirm = (s.algoConfirm ?? 1) > 1.0;
                    return (
                      <div key={s.id} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[7px] font-mono" style={{ backgroundColor: bgColor }}>
                        <span style={{ color: baseColor }}>{strengthIcon} {strengthLabel}</span>
                        <span className="text-[var(--terminal-text)] font-bold">{s.ticker}</span>
                        {hasAlgoConfirm && <span className="text-[var(--terminal-accent)]" title={`AlgoConfirm: ×${(s.algoConfirm ?? 1).toFixed(1)}`}>★</span>}
                        <span className="text-[var(--terminal-muted)]">{s.events}с</span>
                        <span className="text-[var(--terminal-muted)]">{fmtNum(s.lots)}л</span>
                        <span className="text-[var(--terminal-text)] font-bold">{(s.score ?? 0).toFixed(1)}</span>
                        <span className={s.priceImpact >= 0 ? 'text-[var(--terminal-positive)]' : 'text-[var(--terminal-negative)]'}>{fmtImpact(s.priceImpact)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Potential signals (observation) — 3 events but score < 25 */}
            {weakSignals.length > 0 && (
              <>
                <div className="px-2 py-0.5 text-[7px] text-[var(--terminal-muted)] font-mono border-t border-[var(--terminal-border)]/30 mt-1">
                  Потенциальные (наблюдение):
                </div>
                {weakSignals.map(t => (
                  <div key={t.ticker} className="mx-2 my-0.5 px-2 py-0.5 rounded bg-[var(--terminal-border)]/10 text-[8px] font-mono">
                    <span className="text-[var(--terminal-muted)]">{t.ticker}</span>
                    <span className={`ml-2`} style={{ color: t.direction === 'LONG' ? 'var(--terminal-positive)' : t.direction === 'SHORT' ? 'var(--terminal-negative)' : 'var(--terminal-warning)', opacity: 0.6 }}>
                      {t.direction === 'LONG' ? '\u25B2' : t.direction === 'SHORT' ? '\u25BC' : '\u25CF'} {t.direction}
                    </span>
                    <span className="text-[var(--terminal-muted)] ml-2">{t.events} соб / {fmtNum(t.totalLots)} л</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
