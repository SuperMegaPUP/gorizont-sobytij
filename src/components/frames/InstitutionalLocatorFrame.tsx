'use client';

import React, { useState, useMemo } from 'react';
import { TrendingUp, ShieldAlert } from 'lucide-react';
import { FrameTooltip } from './FrameTooltip';
import { useDashboardStore } from '@/lib/store';
import { fmtNum } from '@/lib/helpers';

// ─── Фрейм 6: ЛОКАТОР КРУПНЯКА (Institutional Accumulation Detector) ────
// Две вкладки: ЛИКВИД (накопления) + СПУФИНГ (детекция спуфинга)

export function InstitutionalLocatorFrame() {
  const algopack = useDashboardStore((s) => s.algopack);
  const accumulations = algopack.accumulations;
  const spoofingTickers = algopack.spoofingTickers;
  const topTickers = algopack.topTickers;
  const walls = algopack.walls;
  const hasData = accumulations.length > 0 || spoofingTickers.length > 0;
  const [activeSection, setActiveSection] = useState<'liquid' | 'spoofing'>('liquid');

  // Ликвидные накопления
  const liquidAccum = useMemo(() => accumulations.filter(a => topTickers.includes(a.secid)), [accumulations, topTickers]);

  // Спуфинг-детали (из SpoofingTab логики)
  const spoofingDetails = useMemo(() => {
    return spoofingTickers.map(ticker => {
      const accum = accumulations.find(a => a.secid === ticker && a.spoofing);
      const wall = walls.find(w => w.secid === ticker);
      const isLiquid = topTickers.includes(ticker);
      return { ticker, accum, wall, isLiquid };
    });
  }, [spoofingTickers, accumulations, walls, topTickers]);

  // Спуфинг тикеры для футера вкладки ЛИКВИД
  const liquidSpoofing = spoofingTickers.filter(t => topTickers.includes(t));

  const fmtVal = (v: number): string => {
    const abs = Math.abs(v);
    if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toFixed(0);
  };

  const fmtAvgTrade = (v: number): string => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toFixed(0);
  };

  return (
    <div className="flex flex-col h-full text-[8px] font-mono">
      {/* Header */}
      <div className="px-2 py-1 border-b border-[var(--terminal-border)]/50 flex items-center justify-between shrink-0 bg-[var(--terminal-surface)]/30">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-3 h-3 text-[var(--terminal-accent)]" />
          <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">ЛОКАТОР КРУПНЯКА</span>
        </div>
        <div className="flex items-center gap-2">
          {algopack.source !== 'none' && (
            <span className="text-[7px] text-[var(--terminal-muted)]">
              {algopack.tradetime ? `${algopack.tradetime.slice(0,5)} МСК` : ''}
            </span>
          )}
          <span className={`text-[7px] px-1 rounded ${algopack.source === 'algopack' ? 'bg-[var(--terminal-accent)]/10 text-[var(--terminal-accent)]' : 'bg-[var(--terminal-muted)]/10 text-[var(--terminal-muted)]'}`}>
            {algopack.source === 'algopack' ? 'LIVE' : algopack.source === 'partial' ? 'ЧАСТЬ' : '—'}
          </span>
          <FrameTooltip text="Детектор крупного капитала по ЛИКВИДНЫМ тикерам Мосбиржи через AlgoPack. Вкладка ЛИКВИД: накопления с accumulation_score. Вкладка СПУФИНГ: тикеры с cancelRatio > 70% (отмены заявок). Стены: wall_score из obstats. ТИХО = тихое накопление лимитниками. СРОЧНО = агрессивный маркет-ордерный напор." width={300} />
        </div>
      </div>

      {/* Мини-табы: ЛИКВИД / СПУФИНГ */}
      <div className="flex border-b border-[var(--terminal-border)]/30 shrink-0">
        <button
          onClick={() => setActiveSection('liquid')}
          className={`flex-1 px-2 py-1 text-[7px] font-bold transition-colors ${
            activeSection === 'liquid'
              ? 'text-[var(--terminal-accent)] border-b-2 border-[var(--terminal-accent)] bg-[var(--terminal-accent)]/5'
              : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]'
          }`}
        >
          ЛИКВИД ({liquidAccum.length})
        </button>
        <button
          onClick={() => setActiveSection('spoofing')}
          className={`flex-1 px-2 py-1 text-[7px] font-bold transition-colors ${
            activeSection === 'spoofing'
              ? 'text-[var(--terminal-negative)] border-b-2 border-[var(--terminal-negative)] bg-[var(--terminal-negative)]/5'
              : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]'
          }`}
        >
          СПУФИНГ ({spoofingTickers.length})
        </button>
      </div>

      {/* === Вкладка ЛИКВИД === */}
      {activeSection === 'liquid' && (
        <>
          {/* Column headers */}
          <div className="grid grid-cols-[8px_36px_22px_1fr_42px_32px] gap-0.5 px-2 py-0.5 text-[7px] text-[var(--terminal-muted)] border-b border-[var(--terminal-border)]/30 sticky top-0 bg-[var(--terminal-bg)] z-10">
            <span>#</span>
            <span>Тикер</span>
            <span>Напр</span>
            <span>Накопл.</span>
            <span>Ср.сд</span>
            <span>Тег</span>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto terminal-scroll">
            {!hasData || liquidAccum.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <TrendingUp className="w-5 h-5 text-[var(--terminal-border)] mx-auto mb-1" />
                  <p className="text-[8px] text-[var(--terminal-muted)]">
                    {algopack.source === 'none' ? 'Загрузка данных...' : 'Нет признаков накопления'}
                  </p>
                  <p className="text-[7px] text-[var(--terminal-border)] mt-0.5">AlgoPack tradestats + orderstats</p>
                </div>
              </div>
            ) : (
              liquidAccum.map((a, i) => {
                const barPct = Math.min(a.accumulationScore, 100);
                const isLONG = a.direction === 'LONG';
                const barColor = isLONG
                  ? 'from-[var(--terminal-accent)]/80 to-[var(--terminal-accent)]/20'
                  : 'from-[var(--terminal-negative)]/80 to-[var(--terminal-negative)]/20';
                const tagColor = a.tag === 'СРОЧНО'
                  ? 'bg-[var(--terminal-negative)]/15 text-[var(--terminal-negative)]'
                  : 'bg-[var(--terminal-positive)]/10 text-[var(--terminal-positive)]';
                const isSpoof = a.spoofing;

                return (
                  <div
                    key={a.secid}
                    className={`grid grid-cols-[8px_36px_22px_1fr_42px_32px] gap-0.5 px-2 py-1 border-b border-[var(--terminal-border)]/10 hover:bg-white/[0.02] transition-colors cursor-help ${isSpoof ? 'bg-[var(--terminal-negative)]/5' : ''}`}
                    title={`${a.secid} | ${isLONG ? 'LONG' : 'SHORT'} | Дельта: ${fmtVal(a.deltaVal)} руб | Дельта: ${fmtNum(a.deltaVol)} лотов | DISB: ${a.disb.toFixed(3)} | Cancel ratio: ${(a.cancelRatio * 100).toFixed(0)}%${isSpoof ? ' | ⚠ СПОФИНГ' : ''} | Оборот: ${fmtVal(a.valToday)}`}
                  >
                    <span className="text-[var(--terminal-muted)]">{i + 1}</span>
                    <span className={`font-bold ${isLONG ? 'text-[var(--terminal-accent)]' : 'text-[var(--terminal-negative)]'}`}>
                      {a.secid}
                      {isSpoof && <span className="text-[var(--terminal-negative)] ml-0.5">{'\u26A0'}</span>}
                    </span>
                    <span className={isLONG ? 'text-[var(--terminal-positive)]' : 'text-[var(--terminal-negative)]'}>
                      {isLONG ? '▲' : '▼'}
                    </span>
                    <div className="flex items-center">
                      <div className="w-full h-2.5 bg-[var(--terminal-border)]/50 rounded-sm overflow-hidden relative">
                        <div
                          className={`h-full bg-gradient-to-r ${barColor} rounded-sm transition-all duration-700`}
                          style={{ width: `${Math.max(barPct, 5)}%` }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-[6px] text-white/80 font-bold">
                          {a.accumulationScore.toFixed(0)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[var(--terminal-neutral)]">{fmtAvgTrade((a.avgTradeSizeB + a.avgTradeSizeS) / 2)}</span>
                    <span className={`text-[7px] px-0.5 rounded ${tagColor} text-center`}>
                      {a.tag}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-2 py-0.5 border-t border-[var(--terminal-border)]/30 text-[7px] text-[var(--terminal-muted)] shrink-0">
            {liquidSpoofing.length > 0 && (
              <span className="text-[var(--terminal-negative)]/80">
                {'\u26A0'} Спуфинг: {liquidSpoofing.slice(0, 4).join(', ')}
                {liquidSpoofing.length > 4 && ` +${liquidSpoofing.length - 4}`}
              </span>
            )}
            {liquidSpoofing.length === 0 && hasData && (
              <span>Ликвидные: {liquidAccum.length} | TOP-100</span>
            )}
            {!hasData && <span>5 мин AlgoPack</span>}
          </div>
        </>
      )}

      {/* === Вкладка СПУФИНГ === */}
      {activeSection === 'spoofing' && (
        <>
          {/* Column headers */}
          <div className="grid grid-cols-[36px_22px_1fr_42px_40px] gap-0.5 px-2 py-0.5 text-[7px] text-[var(--terminal-muted)] border-b border-[var(--terminal-border)]/30 sticky top-0 bg-[var(--terminal-bg)] z-10">
            <span>Тикер</span>
            <span>Напр</span>
            <span>Стена</span>
            <span>Cancel%</span>
            <span>Тег</span>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto terminal-scroll">
            {spoofingTickers.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <ShieldAlert className="w-5 h-5 text-[var(--terminal-border)] mx-auto mb-1" />
                  <p className="text-[8px] text-[var(--terminal-muted)]">
                    {algopack.source === 'none' ? 'Загрузка данных...' : 'Спуфинг не обнаружен'}
                  </p>
                  <p className="text-[7px] text-[var(--terminal-border)] mt-0.5">AlgoPack orderstats каждые 5 мин</p>
                </div>
              </div>
            ) : (
              spoofingDetails.map((detail) => {
                const { ticker, accum, wall, isLiquid } = detail;
                const isLONG = accum?.direction === 'LONG';
                const dirColor = isLONG ? 'var(--terminal-positive)' : 'var(--terminal-negative)';
                const dirIcon = isLONG ? '\u25B2' : '\u25BC';
                const tagColor = isLiquid
                  ? 'bg-[var(--terminal-negative)]/15 text-[var(--terminal-negative)]'
                  : 'bg-[var(--terminal-warning)]/10 text-[var(--terminal-warning)]';

                return (
                  <div
                    key={ticker}
                    className="grid grid-cols-[36px_22px_1fr_42px_40px] gap-0.5 px-2 py-1 border-b border-[var(--terminal-border)]/10 hover:bg-white/[0.02] transition-colors bg-[var(--terminal-negative)]/3"
                    title={`${ticker} | Спуфинг обнаружен | Cancel ratio: ${accum ? (accum.cancelRatio * 100).toFixed(0) + '%' : '?'} | ${isLiquid ? 'ЛИКВИД' : 'НЕЛИКВИД'} | DISB: ${accum?.disb?.toFixed(3) || '?'} | Дельта: ${accum ? fmtVal(accum.deltaVal) + ' руб' : '?'}`}
                  >
                    <span className="font-bold text-[var(--terminal-negative)]">
                      {ticker}
                      <span className="text-[5px] ml-0.5">{'\u26A0'}</span>
                    </span>
                    <span style={{ color: dirColor }}>
                      {dirIcon}
                    </span>
                    <div className="flex items-center">
                      {wall ? (
                        <div className="w-full h-2 bg-[var(--terminal-border)]/50 rounded-sm overflow-hidden relative">
                          <div
                            className={`h-full rounded-sm ${wall.volDomination === 'BID' ? 'bg-[var(--terminal-positive)]/60' : 'bg-[var(--terminal-negative)]/60'}`}
                            style={{ width: `${Math.min(wall.wallScore, 100)}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-[5px] text-white/80 font-bold">
                            {wall.wallScore.toFixed(0)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[var(--terminal-muted)] text-[6px]">—</span>
                      )}
                    </div>
                    <span className="text-[var(--terminal-negative)]">
                      {accum ? `${(accum.cancelRatio * 100).toFixed(0)}%` : '—'}
                    </span>
                    <span className={`text-[7px] px-0.5 rounded ${tagColor} text-center`}>
                      {isLiquid ? 'ЛИКВ' : 'НЕЛИК'}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-2 py-0.5 border-t border-[var(--terminal-border)]/30 text-[7px] text-[var(--terminal-muted)] shrink-0">
            {spoofingTickers.length > 0 ? (
              <span className="text-[var(--terminal-negative)]/80">
                {'\u26A0'} Спуфинг: {spoofingTickers.slice(0, 6).join(', ')}
                {spoofingTickers.length > 6 && ` +${spoofingTickers.length - 6}`}
              </span>
            ) : (
              <span>5 мин AlgoPack | cancelRatio &gt; 70%</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
