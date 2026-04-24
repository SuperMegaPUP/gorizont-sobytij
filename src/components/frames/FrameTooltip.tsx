'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';

/**
 * FrameTooltip — портал-тултип для фреймов.
 * Рендерится через React Portal в document.body,
 * поэтому не обрезается overflow:hidden на FrameWrapper.
 *
 * Использование:
 * <FrameTooltip text="Подсказка..." />
 * <FrameTooltip text="Подсказка..." accentColor="var(--terminal-warning)" />
 */
interface FrameTooltipProps {
  text: string;
  /** CSS-цвет акцента иконки при ховере. По умолчанию var(--terminal-accent) */
  accentColor?: string;
  /** Ширина тултипа в px. По умолчанию 256 (w-64) */
  width?: number;
}

export function FrameTooltip({ text, accentColor = 'var(--terminal-accent)', width = 256 }: FrameTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const iconRef = useRef<SVGSVGElement>(null);

  const updatePos = useCallback(() => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    const x = rect.right - width;
    const y = rect.bottom + 4;
    const clampedX = Math.max(4, Math.min(x, window.innerWidth - width - 4));
    const clampedY = Math.max(4, y);
    setPos({ x: clampedX, y: clampedY });
  }, [width]);

  const handleEnter = useCallback(() => {
    setVisible(true);
    requestAnimationFrame(updatePos);
  }, [updatePos]);

  const handleLeave = useCallback(() => {
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [visible, updatePos]);

  return (
    <>
      <HelpCircle
        ref={iconRef}
        className="frame-tooltip-icon w-3 h-3 text-[var(--terminal-muted)] cursor-help transition-colors"
        style={{ '--tt-accent': accentColor } as React.CSSProperties}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      />
      {visible && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed p-2 bg-[var(--terminal-surface)] border border-[var(--terminal-border)] rounded-lg shadow-xl text-[8px] text-[var(--terminal-neutral)] font-mono leading-relaxed z-[9999]"
          style={{ left: pos.x, top: pos.y, width, pointerEvents: 'none' }}
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
}
