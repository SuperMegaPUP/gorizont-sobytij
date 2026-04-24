'use client';

import React, { useState, useMemo } from 'react';
import { Shield, Database } from 'lucide-react';
import { FrameTooltip } from './FrameTooltip';
import { useDashboardStore } from '@/lib/store';

// ─── Фрейм 5: СТАКАН-СКАНЕР (Orderbook Wall Scanner) ─────────────────────

export function OrderbookScannerFrame() {
  const algopack = useDashboardStore((s) => s.algopack);
  const walls = algopack.walls;
  const topTickers = algopack.topTickers;
  const hasData = walls.length > 0;
  const [activeSection, setActiveSection] = useState<'liquid' | 'nonliquid'>('liquid');

  // Разделяем стены на ликвидные и неликвидные
  const liquidWalls = useMemo(() => walls.filter(w => topTickers.includes(w.secid)), [walls, topTickers]);
  const nonLiquidWalls = useMemo(() => walls.filter(w => !topTickers.includes(w.secid)), [walls, topTickers]);
  const displayWalls = activeSection === 'liquid' ? liquidWalls : nonLiquidWalls;

  const fmtVal = (v: number): string => {
    const abs = Math.abs(v);
    if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toFixed(0);
  };

  const fmtSpread = (v: number): string => {
    if (v <= 0) return '-';
    if (v < 1) return `${(v * 100).toFixed(1)}%`;
    return `${v.toFixed(2)}`;
  };

  return (
    <div className="flex flex-col h-full text-[8px] font-mono">
      {/* Header */}
      <div className="px-2 py-1 border-b border-[var(--terminal-border)]/50 flex items-center justify-between shrink-0 bg-[var(--terminal-surface)]/30">
        <div className="flex items-center gap-1.5">
          <Shield className="w-3 h-3 text-[var(--terminal-warning)]" />
          <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">СТАКАН-СКАНЕР</span>
        </div>
        <div className="flex items-center gap-2">
          {algopack.source !== 'none' && (
            <span className="text-[7px] text-[var(--terminal-muted)]">
              {algopack.tradetime ? `${algopack.tradetime.slice(0,5)} МСК` : ''}
            </span>
          )}
          <span className={`text-[7px] px-1 rounded ${algopack.source === 'algopack' ? 'bg-[var(--terminal-positive)]/10 text-[var(--terminal-positive)]' : 'bg-[var(--terminal-muted)]/10 text-[var(--terminal-muted)]'}`}>
            {algopack.source === 'algopack' ? 'LIVE' : algopack.source === 'partial' ? 'ЧАСТЬ' : '—'}
          </span>
          <FrameTooltip text="СТАКАН-СКАНЕР v2 — дисбалансы в стакане заявок через MOEX AlgoPack (obstats). wallScore = imbalanceStrength × bboProximity × volumeScale × (1 - spreadPenalty). imbalanceStrength = |imbalance_vol| (0-1) — сила дисбаланса по объёму. bboProximity = 0.3 + 0.7 × |imbalance_vol_bbo| — стена на BBO = срочнее. volumeScale = log(1 + valTotal/medianVal) — масштаб в рублях. spreadPenalty = min(spread_bbo/50, 0.8) — штраф за широкий спред. Фильтр: оборот ≥ 50М, спред < 50, |imbalance_vol| ≥ 0.05. Абсолютная шкала (rawScore × 200, cap 100): 90+ = мощнейшая стена, 50+ = значимая, 20+ = умеренная. ТИХО = стена глубоко (|bbo_imb| < 0.3), СРОЧНО = стена на лучшей цене (≥ 0.3). BID = покупатель, ASK = продавец. Участвует в algoConfirm для АКТИВНОСТЬ и СИГНАЛЫ (×1.2)." accentColor="var(--terminal-warning)" width={340} />
        </div>
      </div>

      {/* Мини-табы: ЛИКВИД / НЕЛИКВИД */}
      <div className="flex border-b border-[var(--terminal-border)]/30 shrink-0">
        <button
          onClick={() => setActiveSection('liquid')}
          className={`flex-1 px-2 py-1 text-[7px] font-bold transition-colors ${
            activeSection === 'liquid'
              ? 'text-[var(--terminal-accent)] border-b-2 border-[var(--terminal-accent)] bg-[var(--terminal-accent)]/5'
              : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]'
          }`}
        >
          ЛИКВИД ({liquidWalls.length})
        </button>
        <button
          onClick={() => setActiveSection('nonliquid')}
          className={`flex-1 px-2 py-1 text-[7px] font-bold transition-colors ${
            activeSection === 'nonliquid'
              ? 'text-[var(--terminal-warning)] border-b-2 border-[var(--terminal-warning)] bg-[var(--terminal-warning)]/5'
              : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]'
          }`}
        >
          НЕЛИКВИД ({nonLiquidWalls.length})
        </button>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[8px_36px_1fr_52px_40px_32px] gap-0.5 px-2 py-0.5 text-[7px] text-[var(--terminal-muted)] border-b border-[var(--terminal-border)]/30 sticky top-0 bg-[var(--terminal-bg)] z-10">
        <span>#</span>
        <span>Тикер</span>
        <span>Стена</span>
        <span>Объём</span>
        <span>Спред</span>
        <span>Тег</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto terminal-scroll">
        {!hasData ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Database className="w-5 h-5 text-[var(--terminal-border)] mx-auto mb-1" />
              <p className="text-[8px] text-[var(--terminal-muted)]">
                {algopack.source === 'none' ? 'Загрузка данных...' : 'Нет аномалий стакана'}
              </p>
              <p className="text-[7px] text-[var(--terminal-border)] mt-0.5">AlgoPack obstats каждые 5 мин</p>
            </div>
          </div>
        ) : displayWalls.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Database className="w-4 h-4 text-[var(--terminal-border)] mx-auto mb-1" />
              <p className="text-[8px] text-[var(--terminal-muted)]">
                {activeSection === 'liquid' ? 'Нет стен у ликвидных бумаг' : 'Нет стен у неликвидных бумаг'}
              </p>
            </div>
          </div>
        ) : (
          displayWalls.map((w, i) => {
            const barPct = Math.min(w.wallScore, 100);
            const isBID = w.volDomination === 'BID';
            const barColor = isBID
              ? 'from-[var(--terminal-positive)]/80 to-[var(--terminal-positive)]/20'
              : 'from-[var(--terminal-negative)]/80 to-[var(--terminal-negative)]/20';
            const tagColor = w.tag === 'СРОЧНО'
              ? 'bg-[var(--terminal-negative)]/15 text-[var(--terminal-negative)]'
              : 'bg-[var(--terminal-positive)]/10 text-[var(--terminal-positive)]';

            return (
              <div
                key={w.secid}
                className="grid grid-cols-[8px_36px_1fr_52px_40px_32px] gap-0.5 px-2 py-1 border-b border-[var(--terminal-border)]/10 hover:bg-white/[0.02] transition-colors cursor-help group"
                title={`${w.secid} | Стена: ${isBID ? 'BID' : 'ASK'} | Imbalance vol: ${w.imbalance_vol.toFixed(2)} | Imbalance val: ${fmtVal(w.imbalance_val)} | BBO imbalance: ${w.imbalance_vol_bbo.toFixed(2)} | VWAP bid: ${w.vwap_b.toFixed(2)} | VWAP ask: ${w.vwap_s.toFixed(2)} | Оборот: ${fmtVal(w.valToday)}`}
              >
                <span className="text-[var(--terminal-muted)]">{i + 1}</span>
                <span className={`font-bold ${isBID ? 'text-[var(--terminal-positive)]' : 'text-[var(--terminal-negative)]'}`}>{w.secid}</span>
                <div className="flex items-center">
                  <div className="w-full h-2.5 bg-[var(--terminal-border)]/50 rounded-sm overflow-hidden relative">
                    <div
                      className={`h-full bg-gradient-to-r ${barColor} rounded-sm transition-all duration-700`}
                      style={{ width: `${Math.max(barPct, 5)}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[6px] text-white/80 font-bold">
                      {w.wallScore.toFixed(0)}
                    </span>
                  </div>
                </div>
                <span className="text-[var(--terminal-neutral)]">{fmtVal(w.valTotal)}</span>
                <span className="text-[var(--terminal-muted)]">{fmtSpread(w.spread_bbo)}</span>
                <span className={`text-[7px] px-0.5 rounded ${tagColor} text-center`}>
                  {w.tag}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      {hasData && (
        <div className="px-2 py-0.5 border-t border-[var(--terminal-border)]/30 text-[7px] text-[var(--terminal-muted)] shrink-0">
          {activeSection === 'liquid'
            ? `Ликвидные: ${liquidWalls.length} стен | TOP-100`
            : `Неликвиды: ${nonLiquidWalls.length} стен | фильтр: 50М+ оборот`}
          {' | '}Всего тикеров: {algopack.totalTickers}
        </div>
      )}
    </div>
  );
}
