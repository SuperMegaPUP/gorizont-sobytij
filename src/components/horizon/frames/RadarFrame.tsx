'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Radar } from 'lucide-react';
import { useHorizonStore } from '@/lib/horizon-store';

// ─── BSCI Quadrant Thresholds ──────────────────────────────────────────────
// Пороги BSCI для разделения квадрантов и линий на радаре
const BSCI_QUADRANT_THRESHOLD = [0.2, 0.4, 0.7] as const;
const BSCI_THRESHOLD_COLORS = ['#facc15', '#fb923c', '#f87171'] as const; // YELLOW, ORANGE, RED

// ─── Alert Colors ──────────────────────────────────────────────────────────
const ALERT_COLORS: Record<string, string> = {
  GREEN: '#4ade80',
  YELLOW: '#facc15',
  ORANGE: '#fb923c',
  RED: '#f87171',
};
const ALERT_GLOW: Record<string, string> = {
  GREEN: 'rgba(74,222,128,0.2)',
  YELLOW: 'rgba(250,204,21,0.3)',
  ORANGE: 'rgba(251,146,60,0.4)',
  RED: 'rgba(248,113,113,0.5)',
};

interface TooltipInfo {
  ticker: string;
  bsci: number;
  vpin: number;
  cumDelta: number;
  alertLevel: string;
  direction: string;
  isFuture: boolean;
  x: number;
  y: number;
}

interface ComputedDot {
  ticker: string;
  bsci: number;
  alertLevel: string;
  direction: string;
  turnover: number;
  cumDelta: number;
  vpin: number;
  cx: number;
  cy: number;
  r: number;
  color: string;
  glow: string;
  isFuture: boolean;
  type: 'FUTURE' | 'STOCK';
}

// Simple hash for deterministic jitter
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

export function HorizonRadarFrame() {
  const radarData = useHorizonStore((s) => s.radarData);
  const fetchRadar = useHorizonStore((s) => s.fetchRadar);
  const selectTicker = useHorizonStore((s) => s.selectTicker);

  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [dims, setDims] = useState({ w: 400, h: 300 });
  const [mounted, setMounted] = useState(false);

  // Fetch on mount + interval
  useEffect(() => {
    setMounted(true);
    fetchRadar();
    const interval = setInterval(fetchRadar, 60000); // 60s — increased from 30s to reduce Vercel load
    return () => clearInterval(interval);
  }, [fetchRadar]);

  // Observe size
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.max(width, 200), h: Math.max(height, 100) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute dot positions with anti-overlap jitter
  const dots: ComputedDot[] = useMemo(() => {
    if (radarData.length === 0) return [];

    const padX = 40;
    const padY = 25;
    const chartW = dims.w - padX * 2;
    const chartH = dims.h - padY * 2;

    // Symmetric CumDelta scale: 0 is always at center
    const cumDeltas = radarData.map((d) => d.cumDelta);
    const absMaxCD = Math.max(...cumDeltas.map(Math.abs), 1);

    // BSCI is already 0..1 — use as-is for Y-axis
    // Y: 0 (bottom) → 1 (top), BSCI goes up

    // First pass: compute base positions
    const positions = radarData.map((d) => {
      const isFuture = d.type === 'FUTURE';
      // BSCI-based radius: futures get +2 boost for visibility
      const bsciFactor = 3 + d.bsci * 15 + (isFuture ? 2 : 0);
      const r = Math.max(4, Math.min(22, bsciFactor));

      // X: CumDelta symmetric — 0 at center
      const normalizedCD = (d.cumDelta / absMaxCD + 1) / 2; // -1..1 → 0..1, 0→0.5
      const baseCx = padX + normalizedCD * chartW;

      // Y: BSCI — higher BSCI = higher on chart
      const baseCy = padY + (1 - d.bsci) * chartH;

      return {
        ...d,
        baseCx,
        baseCy,
        r,
        color: ALERT_COLORS[d.alertLevel] || ALERT_COLORS.GREEN,
        glow: ALERT_GLOW[d.alertLevel] || ALERT_GLOW.GREEN,
        isFuture,
      };
    });

    // Second pass: resolve overlaps with deterministic jitter
    const resolved: ComputedDot[] = [];
    for (let i = 0; i < positions.length; i++) {
      const dot = positions[i];
      let cx = dot.baseCx;
      let cy = dot.baseCy;

      // Check overlap with all previously-resolved dots
      for (let j = 0; j < resolved.length; j++) {
        const prev = resolved[j];
        const dx = cx - prev.cx;
        const dy = cy - prev.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = dot.r + prev.r + 2; // 2px gap

        if (dist < minDist) {
          // Push outward using hash-based direction for determinism
          const hash = simpleHash(dot.ticker);
          const angle = (hash % 360) * (Math.PI / 180);
          const push = (minDist - dist) + 3;
          cx += Math.cos(angle) * push;
          cy += Math.sin(angle) * push;
        }
      }

      // Clamp to chart area
      cx = Math.max(padX + dot.r, Math.min(dims.w - padX - dot.r, cx));
      cy = Math.max(padY + dot.r, Math.min(dims.h - padY - dot.r, cy));

      resolved.push({ ...dot, cx, cy });
    }

    return resolved;
  }, [radarData, dims]);

  const centerX = dims.w / 2;

  // Count by alert level and type
  const alertCounts = useMemo(() => {
    const counts = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0, futures: 0, stocks: 0 };
    for (const d of dots) {
      counts[d.alertLevel] = (counts[d.alertLevel] || 0) + 1;
      if (d.isFuture) counts.futures++;
      else counts.stocks++;
    }
    return counts;
  }, [dots]);

  // Which dots get labels
  const shouldShowLabel = (dot: ComputedDot) => {
    return dot.isFuture || dot.bsci > 0.2 || dot.r > 8;
  };

  // BSCI threshold Y positions
  const padY = 25;
  const chartH = dims.h - padY * 2;
  const thresholdLines = BSCI_QUADRANT_THRESHOLD.map((thresh, i) => ({
    y: padY + (1 - thresh) * chartH,
    color: BSCI_THRESHOLD_COLORS[i],
    label: String(thresh),
  }));

  // CumDelta = 0 line Y position (center of chart)
  const cumDeltaZeroX = dims.w / 2;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <Radar className="w-3 h-3 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide uppercase">
          РАДАР: Карта аномалий
        </span>
        <span className="text-[6px] text-[var(--terminal-muted)] font-mono ml-1">
          {dots.length} тик.
        </span>
        {/* Alert summary pills */}
        <div className="ml-auto flex items-center gap-1">
          {alertCounts.RED > 0 && (
            <span className="text-[5px] font-mono px-1 py-0.5 rounded-sm bg-red-500/20 text-red-400">
              {alertCounts.RED} кр
            </span>
          )}
          {alertCounts.ORANGE > 0 && (
            <span className="text-[5px] font-mono px-1 py-0.5 rounded-sm bg-orange-500/20 text-orange-400">
              {alertCounts.ORANGE} орж
            </span>
          )}
          {alertCounts.YELLOW > 0 && (
            <span className="text-[5px] font-mono px-1 py-0.5 rounded-sm bg-yellow-500/20 text-yellow-400">
              {alertCounts.YELLOW} жлт
            </span>
          )}
          <span className="text-[5px] font-mono text-cyan-400">
            {alertCounts.futures}F + {alertCounts.stocks}S
          </span>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="flex-1 relative overflow-hidden">
        {!mounted ? (
          <div className="absolute inset-0 flex items-center justify-center text-[7px] text-[var(--terminal-muted)] font-mono">
            Загрузка...
          </div>
        ) : (
        <svg ref={svgRef} width="100%" height="100%" className="block">
          {/* Quadrant backgrounds based on BSCI threshold (0.4) as primary divider */}
          {/* Top: BSCI > 0.4 (high anomaly zone) */}
          <rect x={0} y={0} width={dims.w} height={padY + (1 - 0.4) * chartH}
            fill="rgba(248,113,113,0.03)" />
          {/* Bottom: BSCI < 0.4 (calm zone) */}
          <rect x={0} y={padY + (1 - 0.4) * chartH} width={dims.w} height={dims.h}
            fill="rgba(74,222,128,0.02)" />

          {/* BSCI threshold dashed lines */}
          {thresholdLines.map((line, i) => (
            <g key={`thresh-${i}`}>
              <line
                x1={0} y1={line.y} x2={dims.w} y2={line.y}
                stroke={line.color} strokeWidth={0.5} strokeDasharray="6,4"
                opacity={0.5}
              />
              <text
                x={dims.w - 4} y={line.y - 2}
                textAnchor="end" dominantBaseline="auto"
                fill={line.color} fontSize={5} fontFamily="monospace" opacity={0.7}
              >
                BSCI {line.label}
              </text>
            </g>
          ))}

          {/* CumDelta = 0 vertical line (center) */}
          <line
            x1={cumDeltaZeroX} y1={0} x2={cumDeltaZeroX} y2={dims.h}
            stroke="var(--terminal-border)" strokeWidth={0.5} strokeDasharray="4,4"
          />

          {/* Quadrant labels (based on BSCI threshold 0.4 as divider) */}
          {/* Top-left: High BSCI + Neg CumDelta = АККУМУЛЯЦИЯ */}
          <text x={cumDeltaZeroX / 2} y={14} textAnchor="middle"
            fill="var(--terminal-muted)" fontSize={6} fontFamily="monospace" opacity={0.6}>
            АККУМУЛ.
          </text>
          {/* Top-right: High BSCI + Pos CumDelta = БЫЧИЙ */}
          <text x={cumDeltaZeroX + cumDeltaZeroX / 2} y={14} textAnchor="middle"
            fill="var(--terminal-muted)" fontSize={6} fontFamily="monospace" opacity={0.6}>
            БЫЧИЙ
          </text>
          {/* Bottom-left: Low BSCI + Neg CumDelta = МЕДВЕЖИЙ */}
          <text x={cumDeltaZeroX / 2} y={dims.h - 6} textAnchor="middle"
            fill="var(--terminal-muted)" fontSize={6} fontFamily="monospace" opacity={0.6}>
            МЕДВЕЖИЙ
          </text>
          {/* Bottom-right: Low BSCI + Pos CumDelta = АНОМАЛИЯ */}
          <text x={cumDeltaZeroX + cumDeltaZeroX / 2} y={dims.h - 6} textAnchor="middle"
            fill="var(--terminal-muted)" fontSize={6} fontFamily="monospace" opacity={0.6}>
            АНОМАЛИЯ
          </text>

          {/* Axis labels */}
          <text x={dims.w - 6} y={dims.h / 2 - 4} textAnchor="end"
            fill="var(--terminal-muted)" fontSize={6} fontFamily="monospace" opacity={0.8}>
            CumDelta &rarr;
          </text>
          <text x={4} y={padY + 4} textAnchor="start"
            fill="var(--terminal-muted)" fontSize={6} fontFamily="monospace" opacity={0.8}>
            BSCI
          </text>

          {/* Dots — render GREEN first (back), RED last (front) */}
          {[...dots]
            .sort((a, b) => {
              const order: Record<string, number> = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };
              return (order[a.alertLevel] || 0) - (order[b.alertLevel] || 0);
            })
            .map((dot) => (
              <g
                key={dot.ticker}
                onClick={() => selectTicker(dot.ticker)}
                onMouseEnter={() => setTooltip({
                  ticker: dot.ticker,
                  bsci: dot.bsci,
                  vpin: dot.vpin,
                  cumDelta: dot.cumDelta,
                  alertLevel: dot.alertLevel,
                  direction: dot.direction,
                  isFuture: dot.isFuture,
                  x: dot.cx,
                  y: dot.cy,
                })}
                onMouseLeave={() => setTooltip(null)}
                className="cursor-pointer"
              >
                {/* Glow */}
                <circle cx={dot.cx} cy={dot.cy} r={dot.r + 4} fill={dot.glow} />
                {/* Main dot */}
                <circle
                  cx={dot.cx} cy={dot.cy} r={dot.r}
                  fill={dot.color} opacity={0.85}
                  stroke={dot.isFuture ? 'rgba(0,220,255,0.6)' : 'none'}
                  strokeWidth={dot.isFuture ? 1.5 : 0}
                />
                {/* Pulsation for high-BSCI outliers (>0.7) */}
                {dot.bsci > 0.7 && (
                  <circle
                    cx={dot.cx} cy={dot.cy} r={dot.r}
                    fill="none" stroke={dot.color} strokeWidth={1}
                    opacity={0.6}
                  >
                    <animate attributeName="r" from={dot.r} to={dot.r + 6} dur="1.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" from={0.6} to={0} dur="1.5s" repeatCount="indefinite" />
                  </circle>
                )}
                {/* Label */}
                {shouldShowLabel(dot) && (
                  <text
                    x={dot.cx} y={dot.cy - dot.r - 3}
                    textAnchor="middle" dominantBaseline="auto"
                    fill={dot.isFuture ? '#22d3ee' : 'var(--terminal-text)'}
                    fontSize={dot.isFuture ? 7 : 6}
                    fontFamily="monospace"
                    fontWeight={dot.isFuture ? 'bold' : 'normal'}
                  >
                    {dot.ticker.slice(0, 5)}
                  </text>
                )}
              </g>
            ))}
        </svg>
        )}

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none z-10 bg-[var(--terminal-surface)] border border-[var(--terminal-border)] rounded px-2 py-1.5 shadow-lg"
            style={{
              left: Math.min(tooltip.x + 12, dims.w - 160),
              top: Math.max(tooltip.y - 60, 4),
            }}
          >
            <div className="flex items-center gap-1">
              <span className="text-[7px] font-mono text-[var(--terminal-text)] font-bold">{tooltip.ticker}</span>
              {tooltip.isFuture && (
                <span className="text-[5px] font-mono px-1 py-0.5 rounded-sm bg-cyan-500/20 text-cyan-400">ФЬЮЧ</span>
              )}
            </div>
            <div className="text-[6px] font-mono text-[var(--terminal-muted)] mt-0.5">
              BSCI: <span className={
                tooltip.alertLevel === 'RED' ? 'text-red-400' :
                tooltip.alertLevel === 'ORANGE' ? 'text-orange-400' :
                tooltip.alertLevel === 'YELLOW' ? 'text-yellow-400' : 'text-green-400'
              }>
                {tooltip.bsci.toFixed(3)}
              </span>
            </div>
            <div className="text-[6px] font-mono text-[var(--terminal-muted)]">
              VPIN: {tooltip.vpin.toFixed(3)} | CumDelta: {tooltip.cumDelta.toFixed(3)}
            </div>
            <div className="text-[6px] font-mono text-[var(--terminal-muted)]">
              <span className={tooltip.direction === 'BULLISH' ? 'text-green-400' : tooltip.direction === 'BEARISH' ? 'text-red-400' : 'text-[var(--terminal-muted)]'}>
                {tooltip.direction === 'BULLISH' ? '▲ БЫЧИЙ' : tooltip.direction === 'BEARISH' ? '▼ МЕДВЕЖИЙ' : '● НЕЙТРАЛ'}
              </span>
            </div>
          </div>
        )}

        {radarData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[7px] text-[var(--terminal-muted)] font-mono">
            Нет данных радара. Запустите сканер.
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 px-2 py-1 border-t border-[var(--terminal-border)]/30 shrink-0">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full border border-cyan-400/60 bg-transparent" />
          <span className="text-[5px] font-mono text-[var(--terminal-muted)]">Фьючерс</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-[var(--terminal-text)]/50" />
          <span className="text-[5px] font-mono text-[var(--terminal-muted)]">Акция</span>
        </div>
        <span className="text-[var(--terminal-border)] mx-0.5">|</span>
        <div className="flex items-center gap-1">
          <div className="w-4 h-0 border-t border-dashed border-yellow-400/50" />
          <span className="text-[5px] font-mono text-[var(--terminal-muted)]">0.2</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-0 border-t border-dashed border-orange-400/50" />
          <span className="text-[5px] font-mono text-[var(--terminal-muted)]">0.4</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-0 border-t border-dashed border-red-400/50" />
          <span className="text-[5px] font-mono text-[var(--terminal-muted)]">0.7</span>
        </div>
        <span className="text-[var(--terminal-border)] mx-0.5">|</span>
        {[
          { color: 'bg-green-500/50', label: 'CALM' },
          { color: 'bg-yellow-500/50', label: 'WATCH' },
          { color: 'bg-orange-500/50', label: 'ALERT' },
          { color: 'bg-red-500/50', label: 'CRIT' },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-0.5">
            <div className={`w-1.5 h-1.5 rounded-full ${l.color}`} />
            <span className="text-[5px] font-mono text-[var(--terminal-muted)]">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
