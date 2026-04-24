'use client';

import React, { useRef, useEffect, useMemo } from 'react';
import { Radio } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import type { Direction } from '@/lib/types';
import { fmtNum, isMarketOpen, getMarketStatusText } from '@/lib/helpers';
import { TickersFrame } from './TickersFrame';
import { DurationFrame } from './DurationFrame';
import { DynamicsFrame } from './DynamicsFrame';
import { SignalsFrame } from './SignalsFrame';
import { OrderbookScannerFrame } from './OrderbookScannerFrame';
import { InstitutionalLocatorFrame } from './InstitutionalLocatorFrame';

export function RadarDashboard() {
  const events = useDashboardStore((s) => s.events);
  const activeFilter = useDashboardStore((s) => s.activeFilter);
  const dataSource = useDashboardStore((s) => s.dataSource);
  const totalEvents = useDashboardStore((s) => s.totalEvents);
  const windowEvents = useDashboardStore((s) => s.windowEvents);
  const updateAlgoPack = useDashboardStore((s) => s.updateAlgoPack);
  const algopack = useDashboardStore((s) => s.algopack);

  // ─── AlgoPack polling (каждые 5 мин — частота обновления MOEX) ───
  const algopackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const fetchAlgoPack = async () => {
      if (!isMarketOpen()) return;
      try {
        const res = await fetch('/api/algopack?action=all&limit=30');
        if (res.ok) {
          const data = await res.json();
          // Получаем TOP-100 тикеры из instruments для фильтрации ликвид/неликвид
          const instruments = useDashboardStore.getState().instruments;
          const topTickers = instruments.map(i => i.ticker);
          updateAlgoPack({
            walls: data.walls || [],
            accumulations: data.accumulations || [],
            spoofingTickers: data.spoofingTickers || [],
            totalTickers: data.totalTickers || 0,
            source: data.source || 'none',
            tradetime: data.tradetime || '',
            date: data.date || '',
            topTickers,
          });
        }
      } catch (e) {
        console.warn('[ALGOPACK] fetch error:', e);
      }
    };

    // Первый запрос сразу
    fetchAlgoPack();

    // Повтор каждые 5 минут
    algopackTimerRef.current = setInterval(fetchAlgoPack, 5 * 60 * 1000);

    return () => {
      if (algopackTimerRef.current) clearInterval(algopackTimerRef.current);
    };
  }, [updateAlgoPack]);

  const filteredEvents = useMemo(() => {
    if (!activeFilter) return events;
    return events.filter((e) => e.direction === activeFilter);
  }, [events, activeFilter]);

  const getDirectionLabel = (d: Direction) => {
    if (d === 'buy') return <span className="text-[var(--terminal-positive)] font-bold">{'\u25B2'} Пок</span>;
    if (d === 'sell') return <span className="text-[var(--terminal-negative)] font-bold">{'\u25BC'} Прод</span>;
    return <span className="text-[var(--terminal-warning)] font-bold">{'\u25CF'} См</span>;
  };

  // АлгоPack источник
  const apSrc = algopack.source !== 'none' ? ` | AP: ${algopack.source}` : '';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <div className="flex items-center gap-2">
          <Radio className={`w-3.5 h-3.5 text-[var(--terminal-positive)] ${totalEvents > 0 ? 'animate-pulse' : ''}`} />
          <h2 className="text-[10px] font-bold text-[var(--terminal-text)] tracking-wide">LIVE RADAR</h2>
          <span className="text-[8px] text-[var(--terminal-muted)] font-mono">Окно: 30 мин | Событий: {totalEvents} | В окне: {windowEvents.length}{apSrc}</span>
        </div>
      </div>

      {/* Last events ticker (compact) */}
      {filteredEvents.length > 0 && (
        <div className="px-2 py-1 border-b border-[var(--terminal-border)]/50 bg-[var(--terminal-bg)] shrink-0 overflow-hidden">
          <div className="flex items-center gap-2 text-[8px] font-mono">
            <span className="text-[var(--terminal-muted)] shrink-0">{'\u25B8'} Последние:</span>
            {filteredEvents.slice(0, 5).map((e) => (
              <span key={e.id} className="whitespace-nowrap">
                <span className="text-[var(--terminal-muted)]">{e.time}</span>{' '}
                <span className="text-[var(--terminal-text)] font-bold">{e.ticker}</span>{' '}
                {getDirectionLabel(e.direction)}{' '}
                <span className="text-[var(--terminal-muted)]">{fmtNum(e.lots)}л</span>{' '}
                <span className="text-[var(--terminal-accent)]">{e.pattern}</span>{' '}
                {e.level && <span className="text-[7px]" style={{ color: e.level === 'hft' ? 'var(--terminal-negative)' : e.level === 'structural' ? 'var(--terminal-warning)' : 'var(--terminal-muted)' }}>{e.levelRu}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 3x2 Grid (6 фреймов) */}
      <div className="flex-1 grid grid-cols-3 grid-rows-2 gap-px bg-[var(--terminal-border)] min-h-0">
        <div className="bg-[var(--terminal-bg)] overflow-hidden">
          <TickersFrame />
        </div>
        <div className="bg-[var(--terminal-bg)] overflow-hidden">
          <DurationFrame />
        </div>
        <div className="bg-[var(--terminal-bg)] overflow-hidden">
          <OrderbookScannerFrame />
        </div>
        <div className="bg-[var(--terminal-bg)] overflow-hidden">
          <DynamicsFrame />
        </div>
        <div className="bg-[var(--terminal-bg)] overflow-hidden">
          <SignalsFrame />
        </div>
        <div className="bg-[var(--terminal-bg)] overflow-hidden">
          <InstitutionalLocatorFrame />
        </div>
      </div>

      {/* Empty state overlay */}
      {totalEvents === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center pointer-events-auto">
            <Radio className="w-8 h-8 text-[var(--terminal-border)] mx-auto mb-3" />
            <p className="text-[11px] text-[var(--terminal-muted)] font-mono">
              {dataSource === 'closed' ? 'Биржа закрыта. Данные появятся в торговые часы.' : 'Ожидание событий от роботов...'}
            </p>
            <p className="text-[9px] text-[var(--terminal-border)] font-mono mt-2">
              {dataSource === 'closed' ? getMarketStatusText() : 'Подключение к источникам данных'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
