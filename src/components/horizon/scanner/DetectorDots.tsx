'use client';

import React from 'react';
import { getDetectorDot } from '../shared/BSCIColor';

// 10 detectors in fixed order
const DETECTOR_ORDER = [
  { key: 'GRAVITON', short: 'G' },
  { key: 'DARKMATTER', short: 'D' },
  { key: 'ACCRETOR', short: 'A' },
  { key: 'DECOHERENCE', short: 'Dc' },
  { key: 'HAWKING', short: 'H' },
  { key: 'PREDATOR', short: 'P' },
  { key: 'CIPHER', short: 'C' },
  { key: 'ENTANGLE', short: 'E' },
  { key: 'WAVEFUNCTION', short: 'W' },
  { key: 'ATTRACTOR', short: 'At' },
];

interface DetectorDotsProps {
  scores: Record<string, number>;
}

export function DetectorDots({ scores }: DetectorDotsProps) {
  return (
    <div className="flex gap-px items-end">
      {DETECTOR_ORDER.map((det) => {
        const score = scores[det.key] ?? 0;
        const { char, color } = getDetectorDot(score);
        return (
          <div key={det.key} className="flex flex-col items-center" title={`${det.key}: ${score.toFixed(2)}`}>
            <span className={`font-mono leading-none ${color}`} style={{ fontSize: '6px' }}>
              {char}
            </span>
            <span className="font-mono text-[5px] text-[var(--terminal-muted)] leading-none mt-px">
              {det.short}
            </span>
          </div>
        );
      })}
    </div>
  );
}
