'use client';

import React from 'react';
import { Database } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { fmtNum, fmtDelta } from '@/lib/helpers';

export function FuturesOIFrame() {
  const futoiInstruments = useDashboardStore((s) => s.futoiInstruments);

  const getSmiColor = (smi: number) => {
    if (smi > 30) return 'var(--terminal-positive)';
    if (smi > 10) return 'color-mix(in srgb, var(--terminal-positive) 65%, var(--terminal-text))';
    if (smi > -10) return 'var(--terminal-warning)';
    if (smi > -30) return 'color-mix(in srgb, var(--terminal-negative) 65%, var(--terminal-text))';
    return 'var(--terminal-negative)';
  };

  return (
    <div className="px-2 py-1.5 border-b border-[var(--terminal-border)] shrink-0">
      <div className="flex items-center gap-1.5 mb-1">
        <Database className="w-2.5 h-2.5 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">ФЬЮЧЕРСЫ: OI</span>
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
        <div className="text-[10px] text-[var(--terminal-muted)] font-mono text-center py-2">Загрузка OI...</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {futoiInstruments.map((inst) => {
            const isDiv = (inst.yur.pos >= 0 && inst.fiz.pos < 0) || (inst.yur.pos < 0 && inst.fiz.pos >= 0);
            return (
              <div key={inst.ticker} className={`rounded border ${isDiv ? 'border-[var(--terminal-warning)]/30 bg-[var(--terminal-warning)]/5' : 'border-[var(--terminal-border)] bg-[var(--terminal-bg)]'} px-2.5 py-2`}>
                {/* Заголовок карточки */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-[var(--terminal-text)]">{inst.ticker}</span>
                  <span className="text-[11px] font-bold font-mono" style={{ color: getSmiColor(inst.smi) }}>
                    SMI {inst.smi > 0 ? '+' : ''}{inst.smi}
                  </span>
                </div>
                {/* Данные: ЮР | ФИЗ */}
                <div className="grid grid-cols-2 gap-x-4 text-[10px] font-mono">
                  {/* Заголовки колонок */}
                  <div className="text-center text-[var(--terminal-accent)] font-bold border-b border-[var(--terminal-border)]/50 pb-1 mb-1">ЮР</div>
                  <div className="text-center text-[var(--terminal-accent)] font-bold border-b border-[var(--terminal-border)]/50 pb-1 mb-1">ФИЗ</div>
                  {/* Лонг */}
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--terminal-muted)]">Лонг</span>
                    <span className="text-[var(--terminal-positive)] text-center">
                      {fmtNum(inst.yur.pos_long)}
                      {inst.yur.oi_change_long !== 0 && <span className="text-[var(--terminal-muted)]"> ({fmtDelta(inst.yur.oi_change_long)})</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--terminal-muted)]">Лонг</span>
                    <span className="text-[var(--terminal-positive)] text-center">
                      {fmtNum(inst.fiz.pos_long)}
                      {inst.fiz.oi_change_long !== 0 && <span className="text-[var(--terminal-muted)]"> ({fmtDelta(inst.fiz.oi_change_long)})</span>}
                    </span>
                  </div>
                  {/* Шорт */}
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--terminal-muted)]">Шорт</span>
                    <span className="text-[var(--terminal-negative)] text-center">
                      {fmtNum(Math.abs(inst.yur.pos_short))}
                      {inst.yur.oi_change_short !== 0 && <span className="text-[var(--terminal-muted)]"> ({fmtDelta(inst.yur.oi_change_short)})</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--terminal-muted)]">Шорт</span>
                    <span className="text-[var(--terminal-negative)] text-center">
                      {fmtNum(Math.abs(inst.fiz.pos_short))}
                      {inst.fiz.oi_change_short !== 0 && <span className="text-[var(--terminal-muted)]"> ({fmtDelta(inst.fiz.oi_change_short)})</span>}
                    </span>
                  </div>
                  {/* Позиция */}
                  <div className="flex items-center justify-between border-t border-[var(--terminal-border)]/30 pt-1 mt-1">
                    <span className="text-[var(--terminal-muted)]">Поз.</span>
                    <span className={inst.yur.pos >= 0 ? 'text-[var(--terminal-positive)]' : 'text-[var(--terminal-negative)]'}>
                      {inst.yur.pos >= 0 ? '▲' : '▼'} {fmtNum(Math.abs(inst.yur.pos))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--terminal-border)]/30 pt-1 mt-1">
                    <span className="text-[var(--terminal-muted)]">Поз.</span>
                    <span className={inst.fiz.pos >= 0 ? 'text-[var(--terminal-positive)]' : 'text-[var(--terminal-negative)]'}>
                      {inst.fiz.pos >= 0 ? '▲' : '▼'} {fmtNum(Math.abs(inst.fiz.pos))}
                    </span>
                  </div>
                </div>
                {/* Дивергенция */}
                {isDiv && (
                  <div className="mt-1.5 text-[8px] font-bold text-[var(--terminal-warning)] bg-[var(--terminal-warning)]/10 rounded px-2 py-0.5 text-center">
                    {'\u26A0'} ДИВЕРГЕНЦИЯ: ЮР {inst.yur.pos >= 0 ? 'ЛОНГ' : 'ШОРТ'} vs ФИЗ {inst.fiz.pos >= 0 ? 'ЛОНГ' : 'ШОРТ'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
