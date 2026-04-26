'use client';

import React, { useEffect, useMemo } from 'react';
import { X, TrendingUp, TrendingDown, Minus, ExternalLink } from 'lucide-react';
import { useHorizonStore } from '@/lib/horizon-store';
import { getBsciEmoji, getBsciLevel, getBsciColor } from '../shared/BSCIColor';
import { DetectorDots } from '../scanner/DetectorDots';

const DETECTOR_NAMES = [
  'GRAVITON', 'DARKMATTER', 'ACCRETOR', 'DECOHERENCE', 'HAWKING',
  'PREDATOR', 'CIPHER', 'ENTANGLE', 'WAVEFUNCTION', 'ATTRACTOR',
] as const;

const DETECTOR_DESCRIPTIONS: Record<string, string> = {
  GRAVITON: 'Гравитационная аномалия — концентрация объёма на одном ценовом уровне',
  DARKMATTER: 'Тёмная материя — скрытая ликвидность за пределами видимого стакана',
  ACCRETOR: 'Аккретор — паттерн накопления через мелкие заявки',
  DECOHERENCE: 'Декогеренция — распад корреляции между ценой и объёмом',
  HAWKING: 'Излучение Хокинга — потенциальный прорыв из узкого диапазона',
  PREDATOR: 'Хищник — агрессивная стратегия крупного игрока',
  CIPHER: 'Шифр — скрытый паттерн в потоке заявок',
  ENTANGLE: 'Запутанность — корреляция с другими инструментами',
  WAVEFUNCTION: 'Волновая функция — циклический паттерн в торговле',
  ATTRACTOR: 'Аттрактор — цена стремится к определённому уровню',
};

export function TickerModal() {
  const selectedTicker = useHorizonStore((s) => s.selectedTicker);
  const tickerDetail = useHorizonStore((s) => s.tickerDetail);
  const scannerData = useHorizonStore((s) => s.scannerData);
  const observations = useHorizonStore((s) => s.observations);
  const fetchTickerDetail = useHorizonStore((s) => s.fetchTickerDetail);
  const fetchObservations = useHorizonStore((s) => s.fetchObservations);
  const selectTicker = useHorizonStore((s) => s.selectTicker);

  // Fetch detail when ticker changes
  useEffect(() => {
    if (selectedTicker) {
      fetchTickerDetail(selectedTicker);
      fetchObservations(selectedTicker);
    }
  }, [selectedTicker, fetchTickerDetail, fetchObservations]);

  // Find in scanner data as fallback
  const detail = useMemo(() => {
    if (tickerDetail) return tickerDetail;
    if (!selectedTicker) return null;
    return scannerData.find((t) => t.ticker === selectedTicker) || null;
  }, [tickerDetail, scannerData, selectedTicker]);

  if (!selectedTicker || !detail) return null;

  const bsciLevel = getBsciLevel(detail.bsci);
  const bsciColor = getBsciColor(detail.bsci);
  const bsciEmoji = getBsciEmoji(detail.bsci);

  // Sort detectors by score
  const sortedDetectors = DETECTOR_NAMES
    .map((name) => ({ name, score: detail.detectorScores[name] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  const directionIcon = detail.direction === 'BULLISH'
    ? <TrendingUp className="w-4 h-4 text-green-400" />
    : detail.direction === 'BEARISH'
      ? <TrendingDown className="w-4 h-4 text-red-400" />
      : <Minus className="w-4 h-4 text-[var(--terminal-muted)]" />;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--terminal-surface)] border border-[var(--terminal-border)] rounded-lg shadow-2xl w-[640px] max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className={`flex items-center gap-3 px-4 py-3 border-b border-[var(--terminal-border)] ${bsciColor.bg}`}>
          <div className="flex items-center gap-2">
            <span className="text-xl">{bsciEmoji}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-mono text-[var(--terminal-text)] font-bold">{detail.ticker}</span>
                <span className="text-xs font-mono text-[var(--terminal-muted)]">{detail.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-mono font-bold ${bsciColor.text}`}>
                  BSCI {detail.bsci.toFixed(2)}
                </span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                  bsciLevel === 'RED' ? 'bg-red-500/20 text-red-400 border-red-500/40' :
                  bsciLevel === 'ORANGE' ? 'bg-orange-500/20 text-orange-400 border-orange-500/40' :
                  bsciLevel === 'YELLOW' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40' :
                  'bg-green-500/20 text-green-400 border-green-500/40'
                }`}>
                  {bsciLevel}
                </span>
                {directionIcon}
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`text-xs font-mono font-bold ${
              detail.action === 'URGENT' ? 'text-red-400' :
              detail.action === 'ALERT' && detail.convergenceScore?.spoofingPenalty && detail.convergenceScore.score <= 2 ? 'text-red-500' :
              detail.action === 'ALERT' ? 'text-orange-400' : 'text-[var(--terminal-muted)]'
            }`}>
              {detail.action === 'URGENT' ? '🚨 СРОЧНО' : detail.action === 'ALERT' && detail.convergenceScore?.spoofingPenalty && detail.convergenceScore.score <= 2 ? '🚫 МАНИПУЛЯЦИЯ' : detail.action === 'ALERT' ? '⚠️ ВНИМАНИЕ' : '👁️ НАБЛЮДЕНИЕ'}
            </span>
            <button
              onClick={() => selectTicker(null)}
              className="text-[var(--terminal-muted)] hover:text-[var(--terminal-text)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto terminal-scroll p-4 space-y-4">
          {/* BSCI Progress Bar */}
          <div className="space-y-1">
            <div className="w-full h-3 bg-[var(--terminal-border)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  detail.bsci > 0.7 ? 'bg-red-500' :
                  detail.bsci > 0.4 ? 'bg-orange-500' :
                  detail.bsci > 0.2 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(detail.bsci * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* Quick Status */}
          <div className="bg-[var(--terminal-bg)]/50 rounded-lg px-3 py-2 border border-[var(--terminal-border)]/30">
            <div className="text-[10px] font-mono text-[var(--terminal-muted)] mb-1">Быстрый статус</div>
            <div className="text-xs font-mono text-[var(--terminal-text-dim)] leading-relaxed">
              {detail.quickStatus}
            </div>
          </div>

          {/* Metrics Row */}
          <div className="grid grid-cols-5 gap-2">
            {[
              { label: 'VPIN', value: detail.vpin?.toFixed(3) ?? '—' },
              { label: 'CumDelta', value: detail.cumDelta?.toFixed(0) ?? '—' },
              { label: `OFI${(detail as any).ofiSource === 'trades' ? ' 📊' : ''}`, value: detail.ofi !== undefined && detail.ofi !== null ? detail.ofi.toFixed(3) : '—' },
              { label: 'rtOFI', value: (detail as any).realtimeOFI != null ? (detail as any).realtimeOFI.toFixed(2) : '—' },
              { label: 'Оборот', value: detail.turnover ? `${(detail.turnover / 1e6).toFixed(1)}M` : '—' },
            ].map((m) => (
              <div key={m.label} className="bg-[var(--terminal-bg)]/50 rounded-lg px-2 py-1.5 border border-[var(--terminal-border)]/30 text-center">
                <div className="text-[9px] font-mono text-[var(--terminal-muted)]">{m.label}</div>
                <div className="text-sm font-mono text-[var(--terminal-text)] font-bold">{m.value}</div>
              </div>
            ))}
          </div>

          {/* ═══ КОНВЕРГЕНЦИЯ ═══ */}
          {detail.taContext && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-[var(--terminal-muted)]">
                  Конвергенция (детекторы vs ТА)
                </span>
                {/* Convergence Score badge */}
                {detail.convergenceScore && (
                  <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded border ${
                    detail.convergenceScore.score >= 7
                      ? 'bg-green-500/20 text-green-400 border-green-500/40'
                      : detail.convergenceScore.score >= 4
                        ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                        : 'bg-red-500/20 text-red-400 border-red-500/40'
                  }`}>
                    {detail.convergenceScore.score}/10
                  </span>
                )}
              </div>

              {/* Convergence Bar */}
              {detail.convergenceScore && (
                <div className="space-y-1">
                  <div className="w-full h-2.5 bg-[var(--terminal-border)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        detail.convergenceScore.score >= 7 ? 'bg-green-500' :
                        detail.convergenceScore.score >= 4 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${(detail.convergenceScore.score / 10) * 100}%` }}
                    />
                  </div>
                  <div className="text-[8px] font-mono text-[var(--terminal-muted)]">
                    {detail.convergenceScore.summary}
                  </div>
                </div>
              )}

              {/* Direction comparison */}
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-[var(--terminal-muted)]">BSCI:</span>
                <span className={
                  detail.taContext.bsciDirection === 'BULLISH' ? 'text-green-400 font-bold' :
                  detail.taContext.bsciDirection === 'BEARISH' ? 'text-red-400 font-bold' : 'text-[var(--terminal-muted)]'
                }>
                  {detail.taContext.bsciDirection === 'BULLISH' ? '▲ БЫЧИЙ' :
                   detail.taContext.bsciDirection === 'BEARISH' ? '▼ МЕДВЕЖИЙ' : '— НЕЙТРАЛ'}
                </span>
                <span className="text-[var(--terminal-border)]">vs</span>
                <span className="text-[var(--terminal-muted)]">ТА:</span>
                <span className={
                  detail.taContext.taDirection === 'BULLISH' ? 'text-green-400 font-bold' :
                  detail.taContext.taDirection === 'BEARISH' ? 'text-red-400 font-bold' : 'text-[var(--terminal-muted)]'
                }>
                  {detail.taContext.taDirection === 'BULLISH' ? '▲ БЫЧИЙ' :
                   detail.taContext.taDirection === 'BEARISH' ? '▼ МЕДВЕЖИЙ' : '— НЕЙТРАЛ'}
                </span>
                {/* Divergence alert */}
                {detail.taContext.divergence && (
                  <span className="bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-500/40 font-bold">
                    ⚡ ДИВЕРГЕНЦИЯ
                  </span>
                )}
              </div>

              {/* Divergence note */}
              {detail.taContext.divergence && (
                <div className="bg-yellow-500/5 border border-yellow-500/20 rounded px-2.5 py-1.5">
                  <div className="text-[9px] font-mono text-yellow-400 font-bold">Скрытая активность</div>
                  <div className="text-[9px] font-mono text-[var(--terminal-text-dim)]">
                    {detail.taContext.divergenceNote}
                  </div>
                </div>
              )}

              {/* TA Indicators grid */}
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  {
                    label: 'RSI',
                    value: detail.taContext.indicators.rsi.toFixed(1),
                    zone: detail.taContext.indicators.rsiZone,
                    color: detail.taContext.indicators.rsiZone === 'OVERSOLD' ? 'text-green-400'
                         : detail.taContext.indicators.rsiZone === 'OVERBOUGHT' ? 'text-red-400'
                         : 'text-[var(--terminal-text-dim)]',
                    badge: detail.taContext.indicators.rsiZone === 'OVERSOLD' ? 'OS'
                         : detail.taContext.indicators.rsiZone === 'OVERBOUGHT' ? 'OB' : '',
                  },
                  {
                    label: 'CMF',
                    value: detail.taContext.indicators.cmf.toFixed(3),
                    zone: detail.taContext.indicators.cmfZone,
                    color: detail.taContext.indicators.cmfZone === 'POSITIVE' ? 'text-green-400'
                         : detail.taContext.indicators.cmfZone === 'NEGATIVE' ? 'text-red-400'
                         : 'text-[var(--terminal-text-dim)]',
                    badge: detail.taContext.indicators.cmfZone === 'POSITIVE' ? '+' :
                           detail.taContext.indicators.cmfZone === 'NEGATIVE' ? '−' : '',
                  },
                  {
                    label: 'CRSI',
                    value: detail.taContext.indicators.crsi.toFixed(1),
                    zone: detail.taContext.indicators.crsiZone,
                    color: detail.taContext.indicators.crsiZone === 'OVERSOLD' ? 'text-green-400'
                         : detail.taContext.indicators.crsiZone === 'OVERBOUGHT' ? 'text-red-400'
                         : 'text-[var(--terminal-text-dim)]',
                    badge: detail.taContext.indicators.crsiZone === 'OVERSOLD' ? 'OS'
                         : detail.taContext.indicators.crsiZone === 'OVERBOUGHT' ? 'OB' : '',
                  },
                  {
                    label: 'ATR',
                    value: `${(detail.taContext.indicators.atrPercentile * 100).toFixed(0)}%`,
                    zone: detail.taContext.indicators.atrZone,
                    color: detail.taContext.indicators.atrZone === 'COMPRESSED' ? 'text-blue-400'
                         : detail.taContext.indicators.atrZone === 'EXPANDED' ? 'text-orange-400'
                         : 'text-[var(--terminal-text-dim)]',
                    badge: detail.taContext.indicators.atrZone === 'COMPRESSED' ? '⊕' :
                           detail.taContext.indicators.atrZone === 'EXPANDED' ? '⊗' : '',
                  },
                  {
                    label: 'VWAP',
                    value: `${(detail.taContext.indicators.vwapDeviation * 100).toFixed(2)}%`,
                    zone: detail.taContext.indicators.vwapZone,
                    color: detail.taContext.indicators.vwapZone === 'ABOVE' ? 'text-green-400'
                         : detail.taContext.indicators.vwapZone === 'BELOW' ? 'text-red-400'
                         : 'text-[var(--terminal-text-dim)]',
                    badge: detail.taContext.indicators.vwapZone === 'ABOVE' ? '▲' :
                           detail.taContext.indicators.vwapZone === 'BELOW' ? '▼' : '≈',
                  },
                ].map((ind) => (
                  <div key={ind.label} className="bg-[var(--terminal-bg)]/50 rounded px-1.5 py-1 border border-[var(--terminal-border)]/30 text-center">
                    <div className="text-[8px] font-mono text-[var(--terminal-muted)]">{ind.label}</div>
                    <div className={`text-[10px] font-mono font-bold ${ind.color}`}>
                      {ind.value}
                      {ind.badge && <span className="ml-0.5 text-[7px]">{ind.badge}</span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Convergence Score Details (collapsible) */}
              {detail.convergenceScore && detail.convergenceScore.details.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[8px] font-mono text-[var(--terminal-muted)]">Детализация конвергенции</div>
                  {detail.convergenceScore.details.map((d) => (
                    <div key={d.indicator} className="flex items-center gap-1.5 text-[9px] font-mono">
                      <span className={`w-4 text-center font-bold ${
                        d.alignment === 'ALIGNED' ? 'text-green-400' :
                        d.alignment === 'DIVERGENT' ? 'text-red-400' : 'text-[var(--terminal-muted)]'
                      }`}>
                        {d.alignment === 'ALIGNED' ? '✅' : d.alignment === 'DIVERGENT' ? '⚠️' : '—'}
                      </span>
                      <span className="text-[var(--terminal-text)] font-bold w-8">{d.indicator}</span>
                      <span className="text-[var(--terminal-muted)]">{d.points}/{d.maxPoints}</span>
                      <span className="text-[var(--terminal-text-dim)] flex-1 truncate">{d.note}</span>
                    </div>
                  ))}
                  {/* Bonuses */}
                  {(detail.convergenceScore.divergenceBonus || detail.convergenceScore.atrBonus || detail.convergenceScore.robotBonus) && (
                    <div className="flex items-center gap-2 text-[8px] font-mono text-[var(--terminal-muted)] pt-0.5">
                      {detail.convergenceScore.divergenceBonus && <span className="text-yellow-400">+1 дивергенция</span>}
                      {detail.convergenceScore.atrBonus && <span className="text-blue-400">+1 ATR-сжатие</span>}
                      {detail.convergenceScore.robotBonus && <span className="text-cyan-400">+1 роботы</span>}
                    </div>
                  )}
                </div>
              )}

              {/* Level-0: Hallucination warning */}
              {detail.consistencyCheck?.hasHallucination && (
                <div className="bg-red-500/5 border border-red-500/20 rounded px-2.5 py-1.5">
                  <div className="text-[9px] font-mono text-red-400 font-bold">
                    🐛 Галлюцинация детектора
                  </div>
                  <div className="text-[9px] font-mono text-[var(--terminal-text-dim)]">
                    {detail.consistencyCheck.hallucinations.join(', ')} — высокий score без подтверждающих данных. Вес понижен.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ РОБОТ-КОНТЕКСТ (Спринт 3) ═══ */}
          {detail.robotContext && detail.robotContext.source !== 'none' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-[var(--terminal-muted)]">
                  🤖 Робот-контекст
                </span>
                {/* Confirmation badge */}
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                  detail.robotContext.confirmation >= 0.7
                    ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40'
                    : detail.robotContext.confirmation >= 0.4
                      ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                      : 'bg-gray-500/20 text-gray-400 border-gray-500/40'
                }`}>
                  {detail.robotContext.confirmation >= 0.7 ? '✓ Подтверждено' :
                   detail.robotContext.confirmation >= 0.4 ? '△ Частично' : '✗ Слабо'}
                </span>
              </div>

              {/* Robot volume + AlgoPack metrics */}
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: 'Робот %', value: `${(detail.robotContext.robotVolumePct * 100).toFixed(0)}%`, color: detail.robotContext.robotVolumePct > 0.6 ? 'text-cyan-400' : detail.robotContext.robotVolumePct > 0.3 ? 'text-yellow-400' : 'text-[var(--terminal-muted)]' },
                  { label: 'Стена', value: detail.robotContext.wallScore.toFixed(0), color: detail.robotContext.wallScore > 50 ? 'text-orange-400' : 'text-[var(--terminal-text-dim)]' },
                  { label: 'Накопл.', value: detail.robotContext.accumScore.toFixed(0), color: detail.robotContext.accumScore > 50 ? 'text-cyan-400' : 'text-[var(--terminal-text-dim)]' },
                  { label: 'Cancel%', value: `${(detail.robotContext.cancelRatio * 100).toFixed(0)}%`, color: detail.robotContext.cancelRatio > 0.5 ? 'text-red-400' : 'text-[var(--terminal-text-dim)]' },
                ].map((m) => (
                  <div key={m.label} className="bg-[var(--terminal-bg)]/50 rounded px-1.5 py-1 border border-[var(--terminal-border)]/30 text-center">
                    <div className="text-[8px] font-mono text-[var(--terminal-muted)]">{m.label}</div>
                    <div className={`text-[10px] font-mono font-bold ${m.color}`}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Robot direction + imbalance */}
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-[var(--terminal-muted)]">Дисбаланс:</span>
                <span className={
                  detail.robotContext.robotImbalance > 0.2 ? 'text-green-400 font-bold' :
                  detail.robotContext.robotImbalance < -0.2 ? 'text-red-400 font-bold' : 'text-[var(--terminal-muted)]'
                }>
                  {detail.robotContext.robotImbalance > 0.2 ? `▲ BUY ${(detail.robotContext.robotImbalance * 100).toFixed(0)}%` :
                   detail.robotContext.robotImbalance < -0.2 ? `▼ SELL ${(Math.abs(detail.robotContext.robotImbalance) * 100).toFixed(0)}%` :
                   '— нейтрально'}
                </span>
                {detail.robotContext.accumDirection !== 'NEUTRAL' && (
                  <span className="text-[var(--terminal-muted)]">|</span>
                )}
                {detail.robotContext.accumDirection !== 'NEUTRAL' && (
                  <span className={detail.robotContext.accumDirection === 'LONG' ? 'text-green-400' : 'text-red-400'}>
                    Накопл. {detail.robotContext.accumDirection}
                  </span>
                )}
                {detail.robotContext.hasSpoofing && (
                  <>
                    <span className="text-[var(--terminal-muted)]">|</span>
                    <span className="text-red-400 font-bold">⚠ СПУФИНГ</span>
                  </>
                )}
              </div>

              {/* Detected robot patterns */}
              {detail.robotContext.robotPatterns.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[8px] font-mono text-[var(--terminal-muted)]">Обнаруженные паттерны</div>
                  {detail.robotContext.robotPatterns.slice(0, 4).map((p) => (
                    <div key={p.pattern} className="flex items-center gap-1.5 text-[9px] font-mono">
                      <span className={`w-2 h-2 rounded-full ${
                        p.direction === 'BUY' ? 'bg-green-400' :
                        p.direction === 'SELL' ? 'bg-red-400' : 'bg-yellow-400'
                      }`} />
                      <span className="text-[var(--terminal-text)] font-bold">{p.patternRu}</span>
                      <span className="text-[var(--terminal-muted)]">×{p.count}</span>
                      <span className="text-[var(--terminal-muted)]">{p.totalLots} лот</span>
                      <span className="text-[var(--terminal-muted)]">({p.level})</span>
                      {p.avgConfidence > 0.6 && (
                        <span className="text-cyan-400 font-bold">{(p.avgConfidence * 100).toFixed(0)}%</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Detector ↔ Robot match */}
              {detail.robotContext.matchedPattern && (
                <div className={`rounded px-2.5 py-1.5 border ${
                  detail.robotContext.confirmation >= 0.4
                    ? 'bg-cyan-500/5 border-cyan-500/20'
                    : 'bg-gray-500/5 border-gray-500/20'
                }`}>
                  <div className="text-[9px] font-mono text-[var(--terminal-muted)]">
                    Детектор ↔ Робот-паттерн
                  </div>
                  <div className="text-[10px] font-mono">
                    <span className="text-[var(--terminal-text)] font-bold">{detail.robotContext.matchedDetector}</span>
                    <span className="text-[var(--terminal-muted)]"> ↔ </span>
                    <span className={detail.robotContext.confirmation >= 0.4 ? 'text-cyan-400 font-bold' : 'text-[var(--terminal-text-dim)]'}>
                      {detail.robotContext.matchedPattern}
                    </span>
                    <span className="text-[var(--terminal-muted)] ml-1">
                      (confirmation: {detail.robotContext.confirmation.toFixed(2)})
                    </span>
                  </div>
                </div>
              )}

              {/* Burst summary */}
              {detail.robotContext.burstCount > 0 && (
                <div className="text-[8px] font-mono text-[var(--terminal-muted)]">
                  Burst: {detail.robotContext.burstCount} всплесков, {detail.robotContext.burstTotalLots} лот |
                  Средн. робот: {detail.robotContext.avgRobotOrderSize > 0 ? `${(detail.robotContext.avgRobotOrderSize / 1000).toFixed(0)}K₽` : '—'} |
                  Средн. человек: {detail.robotContext.avgHumanOrderSize > 0 ? `${(detail.robotContext.avgHumanOrderSize / 1000).toFixed(0)}K₽` : '—'}
                </div>
              )}
            </div>
          )}

          {/* Detector Scores */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-[var(--terminal-muted)]">Детекторы Чёрных Звёзд</span>
              <DetectorDots scores={detail.detectorScores} />
            </div>
            {sortedDetectors.map(({ name, score }) => (
              <div key={name} className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-[var(--terminal-text)] font-bold">{name}</span>
                    <span className="text-[8px] font-mono text-[var(--terminal-muted)]">
                      {DETECTOR_DESCRIPTIONS[name]?.slice(0, 50) ?? ''}
                    </span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold ${
                    score > 0.7 ? 'text-red-400' :
                    score > 0.4 ? 'text-orange-400' :
                    score > 0.2 ? 'text-yellow-400' : 'text-green-400'
                  }`}>
                    {score.toFixed(2)}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[var(--terminal-border)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      score > 0.7 ? 'bg-red-500' :
                      score > 0.4 ? 'bg-orange-500' :
                      score > 0.2 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(score * 100, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Recent Observations */}
          {observations.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-xs font-mono text-[var(--terminal-muted)]">Последние наблюдения</span>
              {observations.slice(0, 8).map((obs) => (
                <div key={obs.id} className="bg-[var(--terminal-bg)]/50 rounded px-2.5 py-1.5 border border-[var(--terminal-border)]/20">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[8px] font-mono text-[var(--terminal-muted)]">
                      {new Date(obs.timestamp).toLocaleString('ru-RU', {
                        day: '2-digit', month: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    <span className={`text-[8px] font-mono ${
                      obs.bsci > 0.7 ? 'text-red-400' :
                      obs.bsci > 0.4 ? 'text-orange-400' :
                      obs.bsci > 0.2 ? 'text-yellow-400' : 'text-green-400'
                    }`}>
                      BSCI {obs.bsci.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-[var(--terminal-text-dim)] leading-relaxed">
                    {obs.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
