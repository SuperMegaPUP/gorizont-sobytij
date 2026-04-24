'use client';

import React, { useState, useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { FrameTooltip } from './FrameTooltip';
import { useDashboardStore } from '@/lib/store';
import { fmtNum, fmtDelta } from '@/lib/helpers';
import type { SortCol, SortDir } from '@/lib/types';

function SortArrow({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol; sortDir: SortDir }) {
  if (sortCol !== col) return <span className="text-[#475569]/40 ml-0.5">{'\u2195'}</span>;
  return <span className="text-[var(--terminal-accent)] ml-0.5">{sortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>;
}

export function TickersFrame() {
  const tickerAggs = useDashboardStore((s) => s.tickerAggs);
  const dataSource = useDashboardStore((s) => s.dataSource);
  const [rowTip, setRowTip] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortCol(col);
      setSortDir(col === 'ticker' ? 'asc' : 'desc');
    }
  };

  const sortedAggs = useMemo(() => {
    const arr = [...tickerAggs];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortCol) {
        case 'ticker': return dir * a.ticker.localeCompare(b.ticker);
        case 'events': return dir * (a.events - b.events);
        case 'buyLots': return dir * (a.buyLots - b.buyLots);
        case 'sellLots': return dir * (a.sellLots - b.sellLots);
        case 'deltaNet': return dir * (a.deltaNet - b.deltaNet);
        case 'direction': return dir * a.direction.localeCompare(b.direction);
        case 'score': return dir * (a.score - b.score);
        default: return 0;
      }
    });
    return arr;
  }, [tickerAggs, sortCol, sortDir]);

  if (tickerAggs.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50">
          <TrendingUp className="w-3 h-3 text-[var(--terminal-accent)]" />
          <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">ТИКЕРЫ: Давление</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[9px] text-[var(--terminal-muted)] font-mono">{dataSource === 'closed' ? 'Биржа закрыта' : 'Ожидание данных...'}</p>
        </div>
      </div>
    );
  }

  const maxScore = Math.max(...tickerAggs.map(t => t.score), 0.01);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <TrendingUp className="w-3 h-3 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">ТИКЕРЫ: Давление</span>
        <span className="text-[8px] text-[var(--terminal-muted)] font-mono ml-auto">{tickerAggs.length} тикеров</span>
        <FrameTooltip text="Показывает давление роботов по каждому тикеру за 30 минут. SCORE (Composite Score) = aggression × persistence × volumeAnomaly. Aggression — насколько одностороннее давление (0=нейтрально, 1=чисто в одну сторону). Persistence — устойчивость программы (6+ событий = максимум). VolumeAnomaly — аномалия объёма относительно медианы по всем тикерам. SCORE не зависит от оборота дня, времени суток или новостей. Пок — давление покупок, Прод — давление продаж. Кликните на заголовок столбца для сортировки." />
      </div>
      <div className="flex-1 overflow-y-auto terminal-scroll">
        <div className="grid grid-cols-[40px_24px_1fr_1fr_48px_40px_1fr] gap-0.5 px-2 py-1 text-[7px] text-[var(--terminal-muted)] font-mono border-b border-[var(--terminal-border)]/50 sticky top-0 bg-[var(--terminal-bg)] z-10">
          <span className="cursor-pointer hover:text-[var(--terminal-accent)] transition-colors select-none" onClick={() => handleSort('ticker')}>Тикер<SortArrow col="ticker" sortCol={sortCol} sortDir={sortDir} /></span>
          <span className="text-center cursor-pointer hover:text-[var(--terminal-accent)] transition-colors select-none" onClick={() => handleSort('events')}>Соб<SortArrow col="events" sortCol={sortCol} sortDir={sortDir} /></span>
          <span className="text-right cursor-pointer hover:text-[var(--terminal-accent)] transition-colors select-none" onClick={() => handleSort('buyLots')}>Покуп.<SortArrow col="buyLots" sortCol={sortCol} sortDir={sortDir} /></span>
          <span className="text-right cursor-pointer hover:text-[var(--terminal-accent)] transition-colors select-none" onClick={() => handleSort('sellLots')}>Прод.<SortArrow col="sellLots" sortCol={sortCol} sortDir={sortDir} /></span>
          <span className="text-right cursor-pointer hover:text-[var(--terminal-accent)] transition-colors select-none" onClick={() => handleSort('deltaNet')}>Дельта<SortArrow col="deltaNet" sortCol={sortCol} sortDir={sortDir} /></span>
          <span className="cursor-pointer hover:text-[var(--terminal-accent)] transition-colors select-none" onClick={() => handleSort('direction')}>Напр<SortArrow col="direction" sortCol={sortCol} sortDir={sortDir} /></span>
          <span className="text-center cursor-pointer hover:text-[var(--terminal-accent)] transition-colors select-none" onClick={() => handleSort('score')}>SCORE<SortArrow col="score" sortCol={sortCol} sortDir={sortDir} /></span>
        </div>
        {sortedAggs.map((t) => {
          const scorePct = maxScore > 0 ? (t.score / maxScore) * 100 : 0;
          const dirColor = t.direction === 'LONG' ? 'text-[var(--terminal-positive)]' : t.direction === 'SHORT' ? 'text-[var(--terminal-negative)]' : 'text-[var(--terminal-neutral)]';
          const dirIcon = t.direction === 'LONG' ? '\u25B2' : t.direction === 'SHORT' ? '\u25BC' : '\u25CF';
          const barColor = t.direction === 'LONG' ? 'var(--terminal-positive)' : t.direction === 'SHORT' ? 'var(--terminal-negative)' : 'var(--terminal-neutral)';
          // Цвет SCORE: высокий = яркий, низкий = тусклый
          const scoreColor = t.score > maxScore * 0.6 ? 'text-[var(--terminal-accent)]' : t.score > maxScore * 0.3 ? 'text-[var(--terminal-text)]' : 'text-[var(--terminal-muted)]';
          return (
            <div
              key={t.ticker}
              className="grid grid-cols-[40px_24px_1fr_1fr_48px_40px_1fr] gap-0.5 px-2 py-1 text-[8px] font-mono border-b border-[var(--terminal-border)]/20 hover:bg-white/[0.02] transition-colors cursor-help"
              onMouseEnter={() => setRowTip(t.ticker)}
              onMouseLeave={() => setRowTip(null)}
            >
              <span className="text-[var(--terminal-text)] font-bold">{t.ticker}</span>
              <span className="text-[var(--terminal-muted)] text-center">{t.events}</span>
              <span className="text-[var(--terminal-positive)] text-right">{fmtNum(t.buyLots)}</span>
              <span className="text-[var(--terminal-negative)] text-right">{fmtNum(t.sellLots)}</span>
              <span className={`text-right font-bold ${t.deltaNet >= 0 ? 'text-[var(--terminal-positive)]' : 'text-[var(--terminal-negative)]'}`}>{fmtDelta(t.deltaNet)}</span>
              <span className={`${dirColor} font-bold`}>{dirIcon} {t.direction === 'LONG' ? 'Пок' : t.direction === 'SHORT' ? 'Прод' : 'Нтр'}</span>
              <div className="flex items-center gap-1">
                <div className="flex-1 h-2 bg-[var(--terminal-border)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(scorePct, 3)}%`, backgroundColor: barColor, opacity: 0.7 }}
                  />
                </div>
                <span className={`text-[7px] w-6 text-right font-bold ${scoreColor}`}>{(t.score ?? 0).toFixed(1)}</span>
              </div>
            </div>
          );
        })}
        {/* Шкала SCORE */}
        <div className="px-2 py-1 border-t border-[var(--terminal-border)]/30 bg-[var(--terminal-bg)] shrink-0">
          <div className="flex items-center gap-1 text-[6px] font-mono text-[#475569]">
            <span>SCORE:</span>
            <div className="flex-1 flex items-center">
              <div className="flex-1 h-1 bg-gradient-to-r from-[var(--terminal-border)] via-[var(--terminal-accent)]/25 to-[var(--terminal-accent)] rounded-full" />
            </div>
            <span>0 — {(maxScore ?? 0).toFixed(1)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
