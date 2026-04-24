'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Radar } from 'lucide-react';
import { useHorizonStore } from '@/lib/horizon-store';

// ─── Core 9 futures short codes ────────────────────────────────────────────
const CORE_TICKERS = new Set(['MX', 'Si', 'RI', 'BR', 'GZ', 'GK', 'SR', 'LK', 'RN']);

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
  alertLevel: string;
  direction: string;
  isCore: boolean;
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
  isCore: boolean;
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

  // Fetch on mount + interval
  useEffect(() => {
    fetchRadar();
    const interval = setInterval(fetchRadar, 30000);
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

    // Normalize cumDelta and vpin to 0..1
    const cumDeltas = radarData.map((d) => d.cumDelta);
    const vpins = radarData.map((d) => d.vpin);
    const minCD = Math.min(...cumDeltas);
    const maxCD = Math.max(...cumDeltas);
    const minVP = Math.min(...vpins);
    const maxVP = Math.max(...vpins);
    const rangeCD = maxCD - minCD || 1;
    const rangeVP = maxVP - minVP || 1;

    // First pass: compute base positions
    const positions = radarData.map((d) => {
      const isCore = CORE_TICKERS.has(d.ticker);
      // BSCI-based radius: core futures get +2 boost for visibility
      const bsciFactor = 3 + d.bsci * 15 + (isCore ? 2 : 0);
      const r = Math.max(4, Math.min(22, bsciFactor));

      const baseCx = padX + ((d.cumDelta - minCD) / rangeCD) * chartW;
      const baseCy = padY + (1 - (d.vpin - minVP) / rangeVP) * chartH;

      return {
        ...d,
        baseCx,
        baseCy,
        r,
        color: ALERT_COLORS[d.alertLevel] || ALERT_COLORS.GREEN,
        glow: ALERT_GLOW[d.alertLevel] || ALERT_GLOW.GREEN,
        isCore,
      };
    });

    // Second pass: resolve overlaps with deterministic jitter
    const resolved = positions.map((dot, i) => {
      let cx = dot.baseCx;
      let cy = dot.baseCy;

      // Check overlap with all previous dots
      for (let j = 0; j < i; j++) {
        const prev = resolved[j];
        if (!prev) continue;
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

      return { ...dot, cx, cy };
    });

    return resolved;
  }, [radarData, dims]);

  const centerX = dims.w / 2;
  const centerY = dims.h / 2;

  // Count by alert level
  const alertCounts = useMemo(() => {
    const counts = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0, core: 0, stocks: 0 };
    for (const d of dots) {
      counts[d.alertLevel] = (counts[d.alertLevel] || 0) + 1;
      if (d.isCore) counts.core++;
      else counts.stocks++;
    }
    return counts;
  }, [dots]);

  // Which dots get labels
  const shouldShowLabel = (dot: ComputedDot) => {
    return dot.isCore || dot.bsci > 0.25 || dot.r > 8;
  };

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
            {alertCounts.core}F + {alertCounts.stocks}S
          </span>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <svg ref={svgRef} width="100%" height="100%" className="block">
          {/* Quadrant backgrounds */}
          <rect x={0} y={0} width={centerX} height={centerY}
            fill="rgba(74,222,128,0.03)" /> {/* Top-left: Low VPIN, Neg Delta (Bull accumulation) */}
          <rect x={centerX} y={0} width={centerX} height={centerY}
            fill="rgba(248,113,113,0.03)" /> {/* Top-right: Low VPIN, Pos Delta (Bull run) */}
          <rect x={0} y={centerY} width={centerX} height={centerY}
            fill="rgba(250,204,21,0.03)" /> {/* Bottom-left: High VPIN, Neg Delta (Bear distribution) */}
          <rect x={centerX} y={centerY} width={centerX} height={centerY}
            fill="rgba(251,146,60,0.03)" /> {/* Bottom-right: High VPIN, Pos Delta (Anomalous) */}

          {/* Crosshair lines at center */}
          <line
            x1={centerX} y1={0} x2={centerX} y2={dims.h}
            stroke="var(--terminal-border)" strokeWidth={0.5} strokeDasharray="4,4"
          />
          <line
            x1={0} y1={centerY} x2={dims.w} y2={centerY}
            stroke="var(--terminal-border)" strokeWidth={0.5} strokeDasharray="4,4"
          />

          {/* Quadrant labels */}
          <text x={centerX / 2} y={14} textAnchor="middle"
            fill="var(--terminal-muted)" fontSize={6} fontFamily="monospace" opacity={0.6}>
            АККУМУЛ. ▲
          </text>
          <text x={centerX + centerX / 2} y={14} textAnchor="middle"
            fill="var(--terminal-muted)" fontSize={6} fontFamily="monospace" opacity={0.6}>
            БЫЧИЙ ▲
          </text>
          <text x={centerX / 2} y={dims.h - 6} textAnchor="middle"
            fill="var(--terminal-muted)" fontSize={6} fontFamily="monospace" opacity={0.6}>
            МЕДВЕЖИЙ ▼
          </text>
          <text x={centerX + centerX / 2} y={dims.h - 6} textAnchor="middle"
            fill="var(--terminal-muted)" fontSize={6} fontFamily="monospace" opacity={0.6}>
            АНОМАЛИЯ ⚡
          </text>

          {/* Axis labels */}
          <text x={dims.w - 6} y={centerY - 4} textAnchor="end"
            fill="var(--terminal-muted)" fontSize={6} fontFamily="monospace" opacity={0.8}>
            CumDelta →
          </text>
          <text x={4} y={centerY - 4} textAnchor="start"
            fill="var(--terminal-muted)" fontSize={6} fontFamily="monospace" opacity={0.8}>
            VPIN ↑
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
                  alertLevel: dot.alertLevel,
                  direction: dot.direction,
                  isCore: dot.isCore,
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
                  stroke={dot.isCore ? 'rgba(0,220,255,0.6)' : 'none'}
                  strokeWidth={dot.isCore ? 1.5 : 0}
                />
                {/* Label */}
                {shouldShowLabel(dot) && (
                  <text
                    x={dot.cx} y={dot.cy - dot.r - 3}
                    textAnchor="middle" dominantBaseline="auto"
                    fill={dot.isCore ? '#22d3ee' : 'var(--terminal-text)'}
                    fontSize={dot.isCore ? 7 : 6}
                    fontFamily="monospace"
                    fontWeight={dot.isCore ? 'bold' : 'normal'}
                  >
                    {dot.ticker.slice(0, 5)}
                  </text>
                )}
              </g>
            ))}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none z-10 bg-[var(--terminal-surface)] border border-[var(--terminal-border)] rounded px-2 py-1.5 shadow-lg"
            style={{
              left: Math.min(tooltip.x + 12, dims.w - 140),
              top: Math.max(tooltip.y - 50, 4),
            }}
          >
            <div className="flex items-center gap-1">
              <span className="text-[7px] font-mono text-[var(--terminal-text)] font-bold">{tooltip.ticker}</span>
              {tooltip.isCore && (
                <span className="text-[5px] font-mono px-1 py-0.5 rounded-sm bg-cyan-500/20 text-cyan-400">ФЬЮЧ</span>
              )}
            </div>
            <div className="text-[6px] font-mono text-[var(--terminal-muted)]">
              BSCI: <span className={
                tooltip.alertLevel === 'RED' ? 'text-red-400' :
                tooltip.alertLevel === 'ORANGE' ? 'text-orange-400' :
                tooltip.alertLevel === 'YELLOW' ? 'text-yellow-400' : 'text-green-400'
              }>
                {tooltip.bsci.toFixed(3)}
              </span>
              {' | '}
              <span className={tooltip.direction === 'BULLISH' ? 'text-green-400' : tooltip.direction === 'BEARISH' ? 'text-red-400' : 'text-[var(--terminal-muted)]'}>
                {tooltip.direction === 'BULLISH' ? '▲' : tooltip.direction === 'BEARISH' ? '▼' : '●'}
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
