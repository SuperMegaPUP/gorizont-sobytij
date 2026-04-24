'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Radar } from 'lucide-react';
import { useHorizonStore } from '@/lib/horizon-store';

const ALERT_COLORS: Record<string, string> = {
  GREEN: '#4ade80',
  YELLOW: '#facc15',
  ORANGE: '#fb923c',
  RED: '#f87171',
};

const ALERT_GLOW: Record<string, string> = {
  GREEN: 'rgba(74,222,128,0.3)',
  YELLOW: 'rgba(250,204,21,0.3)',
  ORANGE: 'rgba(251,146,60,0.4)',
  RED: 'rgba(248,113,113,0.5)',
};

interface TooltipInfo {
  ticker: string;
  bsci: number;
  alertLevel: string;
  direction: string;
  x: number;
  y: number;
}

export function HorizonRadarFrame() {
  const radarData = useHorizonStore((s) => s.radarData);
  const fetchRadar = useHorizonStore((s) => s.fetchRadar);
  const selectTicker = useHorizonStore((s) => s.selectTicker);
  const scannerMode = useHorizonStore((s) => s.scannerMode);

  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [dims, setDims] = useState({ w: 400, h: 200 });

  // Fetch on mount + interval + mode change
  useEffect(() => {
    fetchRadar();
    const interval = setInterval(fetchRadar, 30000);
    return () => clearInterval(interval);
  }, [fetchRadar, scannerMode]);

  // Observe size
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.max(width, 100), h: Math.max(height, 60) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute positions
  const dots = useMemo(() => {
    if (radarData.length === 0) return [];

    const padding = 30;
    const chartW = dims.w - padding * 2;
    const chartH = dims.h - padding * 2;

    const cumDeltas = radarData.map((d) => d.cumDelta);
    const vpins = radarData.map((d) => d.vpin);
    const minCD = Math.min(...cumDeltas);
    const maxCD = Math.max(...cumDeltas);
    const minVP = Math.min(...vpins);
    const maxVP = Math.max(...vpins);
    const rangeCD = maxCD - minCD || 1;
    const rangeVP = maxVP - minVP || 1;

    return radarData.map((d) => {
      const cx = padding + ((d.cumDelta - minCD) / rangeCD) * chartW;
      const cy = padding + (1 - (d.vpin - minVP) / rangeVP) * chartH; // inverted: top=low vpin
      // Scale dot size: bsci determines base size (3-18), turnover adds weight
      const bsciFactor = 3 + d.bsci * 15; // 3-18 based on BSCI
      const r = Math.max(3, Math.min(20, bsciFactor));
      const color = ALERT_COLORS[d.alertLevel] || ALERT_COLORS.GREEN;
      const glow = ALERT_GLOW[d.alertLevel] || ALERT_GLOW.GREEN;

      return { ...d, cx, cy, r, color, glow };
    });
  }, [radarData, dims]);

  const centerCD = dims.w / 2;
  const centerVP = dims.h / 2;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <Radar className="w-3 h-3 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide uppercase">
          РАДАР: Карта аномалий
        </span>
        <span className="text-[6px] text-[var(--terminal-muted)] font-mono ml-auto">
          {radarData.length} тикеров {scannerMode === 'top100' ? '(ТОП 100)' : '(все)'}
        </span>
      </div>

      {/* SVG Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <svg ref={svgRef} width="100%" height="100%" className="block">
          {/* Background */}
          <rect width={dims.w} height={dims.h} fill="transparent" />

          {/* Crosshair lines at center */}
          <line
            x1={centerCD} y1={0} x2={centerCD} y2={dims.h}
            stroke="var(--terminal-border)" strokeWidth={0.5} strokeDasharray="3,3"
          />
          <line
            x1={0} y1={centerVP} x2={dims.w} y2={centerVP}
            stroke="var(--terminal-border)" strokeWidth={0.5} strokeDasharray="3,3"
          />

          {/* Axis labels */}
          <text x={dims.w - 4} y={dims.h - 4} textAnchor="end" fill="var(--terminal-muted)" fontSize={7} fontFamily="monospace">
            CumDelta
          </text>
          <text x={4} y={10} textAnchor="start" fill="var(--terminal-muted)" fontSize={7} fontFamily="monospace">
            VPIN
          </text>

          {/* Dots */}
          {dots.map((dot) => (
            <g
              key={dot.ticker}
              onClick={() => selectTicker(dot.ticker)}
              onMouseEnter={() => setTooltip({
                ticker: dot.ticker,
                bsci: dot.bsci,
                alertLevel: dot.alertLevel,
                direction: dot.direction,
                x: dot.cx,
                y: dot.cy,
              })}
              onMouseLeave={() => setTooltip(null)}
              className="cursor-pointer"
            >
              {/* Glow */}
              <circle cx={dot.cx} cy={dot.cy} r={dot.r + 3} fill={dot.glow} />
              {/* Main dot */}
              <circle cx={dot.cx} cy={dot.cy} r={dot.r} fill={dot.color} opacity={0.8} />
              {/* Label for big dots or anomalous tickers */}
              {(dot.r > 10 || dot.bsci > 0.3) && (
                <text
                  x={dot.cx} y={dot.cy}
                  textAnchor="middle" dominantBaseline="central"
                  fill="var(--terminal-bg)" fontSize={6} fontFamily="monospace" fontWeight="bold"
                >
                  {dot.ticker.slice(0, 4)}
                </text>
              )}
            </g>
          ))}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none z-10 bg-[var(--terminal-surface)] border border-[var(--terminal-border)] rounded px-2 py-1 shadow-lg"
            style={{
              left: Math.min(tooltip.x + 10, dims.w - 120),
              top: Math.max(tooltip.y - 40, 4),
            }}
          >
            <div className="text-[7px] font-mono text-[var(--terminal-text)] font-bold">{tooltip.ticker}</div>
            <div className="text-[6px] font-mono text-[var(--terminal-muted)]">
              BSCI: <span className={tooltip.alertLevel === 'RED' ? 'text-red-400' : tooltip.alertLevel === 'ORANGE' ? 'text-orange-400' : tooltip.alertLevel === 'YELLOW' ? 'text-yellow-400' : 'text-green-400'}>
                {tooltip.bsci.toFixed(2)}
              </span>
              {' | '}
              {tooltip.direction}
            </div>
          </div>
        )}

        {radarData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[7px] text-[var(--terminal-muted)] font-mono">
            Нет данных радара
          </div>
        )}
      </div>
    </div>
  );
}
