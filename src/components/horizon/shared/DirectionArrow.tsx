'use client';

import React from 'react';
import { getDirectionArrow } from './BSCIColor';

interface DirectionArrowProps {
  direction: string;
  confidence: number;
  size?: number;
}

export function DirectionArrow({ direction, confidence, size = 9 }: DirectionArrowProps) {
  const { char, color, bold } = getDirectionArrow(direction, confidence);

  return (
    <span
      className={`font-mono ${color} ${bold ? 'font-bold' : ''}`}
      style={{ fontSize: `${size}px` }}
    >
      {char}
    </span>
  );
}
