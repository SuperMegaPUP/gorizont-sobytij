'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Bot, RefreshCw, ChevronDown } from 'lucide-react';
import { useHorizonStore } from '@/lib/horizon-store';
import { getBsciEmoji, getBsciLevel } from '../shared/BSCIColor';
import { DirectionArrow } from '../shared/DirectionArrow';
import { DetectorDots } from '../scanner/DetectorDots';

type ViewMode = 'feed' | 'detail';

export function HorizonAIObserverFrame() {
  const observations = useHorizonStore((s) => s.observations);
  const scannerData = useHorizonStore((s) => s.scannerData);
  const selectedTicker = useHorizonStore((s) => s.selectedTicker);
  const tickerDetail = useHorizonStore((s) => s.tickerDetail);
  const fetchObservations = useHorizonStore((s) => s.fetchObservations);
  const fetchTickerDetail = useHorizonStore((s) => s.fetchTickerDetail);
  const fetchScanner = useHorizonStore((s) => s.fetchScanner);
  const selectTicker = useHorizonStore((s) => s.selectTicker);
  const loading = useHorizonStore((s) => s.loading);

  const [view, setView] = useState<ViewMode>('feed');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Initial fetch
  useEffect(() => {
    fetchObservations();
    fetchScanner();
  }, [fetchObservations, fetchScanner]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchObservations();
    }, 60000); // 1 min
    return () => clearInterval(interval);
  }, [autoRefresh, fetchObservations]);

  // When selected ticker changes, switch to detail view
  useEffect(() => {
    if (selectedTicker) {
      fetchTickerDetail(selectedTicker);
      fetchObservations(selectedTicker);
      setView('detail');
    }
  }, [selectedTicker, fetchTickerDetail, fetchObservations]);

  // Feed items: combine scanner quickStatus with observations
  const feedItems = useMemo(() => {
    // Scanner quickStatus items (most recent)
    const scannerItems = scannerData
      .filter((t) => t.bsci > 0.2) // only show suspicious+
      .sort((a, b) => b.bsci - a.bsci)
      .slice(0, 9)
      .map((t) => ({
        id: `scan-${t.ticker}`,
        type: 'scanner' as const,
        ticker: t.ticker,
        name: t.name,
        bsci: t.bsci,
        alertLevel: t.alertLevel,
        direction: t.direction,
        confidence: t.confidence,
        detectorScores: t.detectorScores,
        quickStatus: t.quickStatus,
        action: t.action,
        timestamp: Date.now(),
      }));

    // Observation items
    const obsItems = observations.slice(0, 20).map((o) => ({
      id: o.id,
      type: 'observation' as const,
      ticker: '',
      name: '',
      bsci: o.bsci,
      alertLevel: getBsciLevel(o.bsci),
      direction: 'NEUTRAL',
      confidence: 0,
      detectorScores: {},
      quickStatus: o.text,
      action: 'WATCH' as const,
      timestamp: o.timestamp,
    }));

    return [...scannerItems, ...obsItems];
  }, [scannerData, observations]);

  // Detail view data
  const detailData = useMemo(() => {
    if (!selectedTicker) return null;
    return scannerData.find((t) => t.ticker === selectedTicker) || tickerDetail;
  }, [selectedTicker, scannerData, tickerDetail]);

  const actionStyle = (action: string) => {
    if (action === 'URGENT') return 'text-red-400 font-bold';
    if (action === 'ALERT') return 'text-orange-400';
    return 'text-[var(--terminal-muted)]';
  };

  const alertBadge = (level: string) => {
    const map: Record<string, string> = {
      RED: 'bg-red-500/20 text-red-400 border-red-500/40',
      ORANGE: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
      YELLOW: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
      GREEN: 'bg-green-500/20 text-green-400 border-green-500/40',
    };
    return map[level] || map.GREEN;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <Bot className="w-3 h-3 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide uppercase">
          AI НАБЛЮДАТЕЛЬ
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {/* View toggle */}
          <button
            onClick={() => {
              setView('feed');
              selectTicker(null);
            }}
            className={`text-[6px] font-mono px-1.5 py-0.5 rounded-sm transition-colors ${
              view === 'feed'
                ? 'bg-[var(--terminal-accent)]/20 text-[var(--terminal-accent)] border border-[var(--terminal-accent)]/40'
                : 'text-[var(--terminal-muted)] border border-transparent hover:border-[var(--terminal-border)]'
            }`}
          >
            Лента
          </button>
          <button
            onClick={() => setView('detail')}
            className={`text-[6px] font-mono px-1.5 py-0.5 rounded-sm transition-colors ${
              view === 'detail'
                ? 'bg-[var(--terminal-accent)]/20 text-[var(--terminal-accent)] border border-[var(--terminal-accent)]/40'
                : 'text-[var(--terminal-muted)] border border-transparent hover:border-[var(--terminal-border)]'
            }`}
          >
            Детали
          </button>
          <button
            onClick={() => { fetchScanner(); fetchObservations(); }}
            className="text-[var(--terminal-muted)] hover:text-[var(--terminal-text)] transition-colors"
            title="Обновить"
          >
            <RefreshCw className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto terminal-scroll">
        {view === 'feed' ? (
          /* ── Feed View ── */
          feedItems.length === 0 ? (
            <div className="text-[7px] text-[var(--terminal-muted)] font-mono text-center py-4">
              Нет наблюдений. Запустите сканер.
            </div>
          ) : (
            <div className="divide-y divide-[var(--terminal-border)]/30">
              {feedItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => item.ticker && selectTicker(item.ticker)}
                  className={`px-2 py-1.5 transition-colors ${
                    item.ticker
                      ? 'hover:bg-[var(--terminal-surface-hover)]/50 cursor-pointer'
                      : ''
                  }`}
                >
                  {/* Row 1: Ticker + BSCI + Action */}
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {item.ticker && (
                      <span className="text-[8px] font-mono text-[var(--terminal-text)] font-bold">
                        {item.ticker}
                      </span>
                    )}
                    <span className="text-[7px] font-mono">
                      {getBsciEmoji(item.bsci)}
                    </span>
                    <span className={`text-[7px] font-mono ${
                      item.bsci > 0.7 ? 'text-red-400' :
                      item.bsci > 0.4 ? 'text-orange-400' :
                      item.bsci > 0.2 ? 'text-yellow-400' : 'text-green-400'
                    }`}>
                      {item.bsci.toFixed(2)}
                    </span>
                    <span className={`text-[6px] font-mono px-1 py-px rounded border ${alertBadge(item.alertLevel)}`}>
                      {item.alertLevel}
                    </span>
                    {item.ticker && (
                      <DirectionArrow direction={item.direction} confidence={item.confidence} size={7} />
                    )}
                    <span className={`text-[6px] font-mono ml-auto ${actionStyle(item.action)}`}>
                      {item.action}
                    </span>
                  </div>

                  {/* Row 2: Quick status */}
                  <div className="text-[7px] font-mono text-[var(--terminal-text-dim)] leading-tight mb-0.5">
                    {item.quickStatus}
                  </div>

                  {/* Row 3: Detector dots (if scanner item) */}
                  {item.ticker && Object.keys(item.detectorScores).length > 0 && (
                    <DetectorDots scores={item.detectorScores} />
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          /* ── Detail View ── */
          detailData ? (
            <div className="p-2 space-y-2">
              {/* Ticker header */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-[var(--terminal-text)] font-bold">
                  {detailData.ticker}
                </span>
                <span className="text-[7px] font-mono text-[var(--terminal-muted)]">
                  {detailData.name}
                </span>
              </div>

              {/* BSCI gauge */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[7px] font-mono text-[var(--terminal-muted)]">BSCI</span>
                  <span className={`text-[10px] font-mono font-bold ${
                    detailData.bsci > 0.7 ? 'text-red-400' :
                    detailData.bsci > 0.4 ? 'text-orange-400' :
                    detailData.bsci > 0.2 ? 'text-yellow-400' : 'text-green-400'
                  }`}>
                    {detailData.bsci.toFixed(2)}
                  </span>
                </div>
                <div className="w-full h-2 bg-[var(--terminal-border)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      detailData.bsci > 0.7 ? 'bg-red-500' :
                      detailData.bsci > 0.4 ? 'bg-orange-500' :
                      detailData.bsci > 0.2 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(detailData.bsci * 100, 100)}%` }}
                  />
                </div>
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-2 gap-1">
                {[
                  { label: 'Направление', value: detailData.direction, color: detailData.direction === 'BULLISH' ? 'text-green-400' : detailData.direction === 'BEARISH' ? 'text-red-400' : 'text-[var(--terminal-muted)]' },
                  { label: 'VPIN', value: detailData.vpin?.toFixed(3) ?? '—', color: 'text-[var(--terminal-text)]' },
                  { label: 'CumDelta', value: detailData.cumDelta?.toFixed(0) ?? '—', color: 'text-[var(--terminal-text)]' },
                  { label: 'Действие', value: detailData.action, color: actionStyle(detailData.action) },
                ].map((m) => (
                  <div key={m.label} className="bg-[var(--terminal-surface)]/50 rounded px-1.5 py-1">
                    <div className="text-[6px] font-mono text-[var(--terminal-muted)]">{m.label}</div>
                    <div className={`text-[8px] font-mono font-bold ${m.color}`}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Detector scores */}
              <div className="space-y-1">
                <span className="text-[7px] font-mono text-[var(--terminal-muted)]">Детекторы</span>
                <DetectorDots scores={detailData.detectorScores} />
                {/* Individual detector bars */}
                {Object.entries(detailData.detectorScores)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 5)
                  .map(([name, score]) => (
                    <div key={name} className="flex items-center gap-1.5">
                      <span className="text-[6px] font-mono text-[var(--terminal-muted)] w-10 truncate">{name}</span>
                      <div className="flex-1 h-1 bg-[var(--terminal-border)] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            score > 0.7 ? 'bg-red-500' :
                            score > 0.4 ? 'bg-orange-500' :
                            score > 0.2 ? 'bg-yellow-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(score * 100, 100)}%` }}
                        />
                      </div>
                      <span className={`text-[6px] font-mono ${
                        score > 0.7 ? 'text-red-400' :
                        score > 0.4 ? 'text-orange-400' :
                        score > 0.2 ? 'text-yellow-400' : 'text-green-400'
                      }`}>
                        {score.toFixed(2)}
                      </span>
                    </div>
                  ))}
              </div>

              {/* Quick status */}
              <div className="bg-[var(--terminal-surface)]/50 rounded px-2 py-1.5">
                <div className="text-[6px] font-mono text-[var(--terminal-muted)] mb-0.5">Статус</div>
                <div className="text-[7px] font-mono text-[var(--terminal-text-dim)] leading-tight">
                  {detailData.quickStatus}
                </div>
              </div>

              {/* Observations for this ticker */}
              {observations.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[7px] font-mono text-[var(--terminal-muted)]">Наблюдения</span>
                  {observations.slice(0, 5).map((obs) => (
                    <div key={obs.id} className="bg-[var(--terminal-surface)]/30 rounded px-1.5 py-1">
                      <div className="text-[6px] font-mono text-[var(--terminal-muted)]">
                        {new Date(obs.timestamp).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                      </div>
                      <div className="text-[7px] font-mono text-[var(--terminal-text-dim)]">{obs.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[7px] text-[var(--terminal-muted)] font-mono text-center py-4">
              {selectedTicker
                ? `Загрузка ${selectedTicker}...`
                : 'Выберите тикер в Сканере или Радаре'}
            </div>
          )
        )}
      </div>
    </div>
  );
}
