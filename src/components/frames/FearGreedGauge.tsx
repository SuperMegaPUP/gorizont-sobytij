'use client';

import React, { useMemo } from 'react';

export function FearGreedGauge({ value }: { value: number }) {
  const angle = useMemo(() => (value / 100) * 180 - 90, [value]);
  const label = useMemo(() => {
    if (value < 30) return 'СТРАХ';
    if (value < 45) return 'Умеренный страх';
    if (value < 55) return 'Нейтрально';
    if (value < 70) return 'Умеренная жадность';
    return 'ЖАДНОСТЬ';
  }, [value]);
  const labelColor = useMemo(() => {
    if (value < 30) return 'var(--terminal-critical)';
    if (value < 45) return 'var(--terminal-warning)';
    if (value < 55) return 'var(--terminal-neutral)';
    if (value < 70) return 'var(--terminal-positive)';
    return 'var(--terminal-positive)';
  }, [value]);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" className="w-full max-w-[220px]">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--terminal-border)" strokeWidth="14" strokeLinecap="round" />
        <path d="M 20 100 A 80 80 0 0 1 44 40" fill="none" stroke="var(--terminal-critical)" strokeWidth="14" strokeLinecap="round" opacity="0.7" />
        <path d="M 44 40 A 80 80 0 0 1 68 24" fill="none" stroke="var(--terminal-warning)" strokeWidth="14" strokeLinecap="round" opacity="0.7" />
        <path d="M 68 24 A 80 80 0 0 1 100 20" fill="none" stroke="var(--terminal-neutral)" strokeWidth="14" strokeLinecap="round" opacity="0.7" />
        <path d="M 100 20 A 80 80 0 0 1 132 24" fill="none" stroke="var(--terminal-positive)" strokeWidth="14" strokeLinecap="round" opacity="0.7" />
        <path d="M 132 24 A 80 80 0 0 1 180 100" fill="none" stroke="var(--terminal-positive)" strokeWidth="14" strokeLinecap="round" opacity="0.7" />
        <g className="gauge-needle" style={{ transform: `rotate(${angle}deg)`, transformOrigin: '100px 100px' }}>
          <line x1="100" y1="100" x2="100" y2="30" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="100" cy="100" r="5" fill="#ffffff" />
          <circle cx="100" cy="100" r="3" fill="var(--terminal-bg)" />
        </g>
        <text x="100" y="88" textAnchor="middle" fill="var(--terminal-text)" fontSize="20" fontFamily="monospace" fontWeight="bold">
          {value.toFixed(1)}
        </text>
      </svg>
      <div className="text-center mt-1">
        <span className="text-sm font-bold" style={{ color: labelColor }}>{label}</span>
      </div>
    </div>
  );
}
