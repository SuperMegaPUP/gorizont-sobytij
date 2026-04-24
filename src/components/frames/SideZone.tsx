// ─── SideZone — collapsible sidebar zone (left or right) ──────────────────────
'use client';

import React, { useCallback, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, PanelRight, X } from 'lucide-react';
import { useLayoutStore } from '@/lib/layout-store';
import type { FrameKey } from '@/lib/layout-store';
import { getFrameComponent, getFrameTitle } from '@/lib/frame-registry';
import { FrameWrapper } from './FrameWrapper';

interface SideZoneProps {
  side: 'left' | 'right';
}

// Minimum height for a frame in the zone (px)
const MIN_FRAME_H = 60;

export function SideZone({ side }: SideZoneProps) {
  const zone = useLayoutStore((s) => side === 'left' ? s.leftZone : s.rightZone);
  const isEditMode = useLayoutStore((s) => s.isEditMode);
  const toggleZoneCollapse = useLayoutStore((s) => s.toggleZoneCollapse);
  const setZoneWidth = useLayoutStore((s) => s.setZoneWidth);
  const setZoneFrameHeight = useLayoutStore((s) => s.setZoneFrameHeight);
  const moveFrameToGrid = useLayoutStore((s) => s.moveFrameToGrid);
  const hideFrame = useLayoutStore((s) => s.hideFrame);

  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Frame height resize ref
  const frameResizeRef = useRef<{ key: FrameKey; startY: number; startH: number } | null>(null);

  // Handle zone width resize drag — always available
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeRef.current = { startX: e.clientX, startWidth: zone.width };

    const handleMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = side === 'left'
        ? ev.clientX - resizeRef.current.startX
        : resizeRef.current.startX - ev.clientX;
      const newWidth = Math.max(180, Math.min(500, resizeRef.current.startWidth + delta));
      setZoneWidth(side, newWidth);
    };

    const handleUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [side, zone.width, setZoneWidth]);

  // Handle frame vertical resize drag — only in edit mode
  const handleFrameResizeStart = useCallback((e: React.MouseEvent, key: FrameKey) => {
    if (!isEditMode) return;
    e.preventDefault();
    e.stopPropagation();
    const currentH = zone.frameHeights?.[key] || 200;
    frameResizeRef.current = { key, startY: e.clientY, startH: currentH };

    const handleMove = (ev: MouseEvent) => {
      if (!frameResizeRef.current) return;
      const delta = ev.clientY - frameResizeRef.current.startY;
      const newH = Math.max(MIN_FRAME_H, frameResizeRef.current.startH + delta);
      setZoneFrameHeight(side, frameResizeRef.current.key, newH);
    };

    const handleUp = () => {
      frameResizeRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [isEditMode, side, zone.frameHeights, setZoneFrameHeight]);

  const isCollapsed = zone.collapsed;
  const hasFrames = zone.frameKeys.length > 0;

  // Collapsed: thin strip with expand button
  if (isCollapsed) {
    return (
      <div
        className="shrink-0 min-w-0 flex flex-col items-center py-2 cursor-pointer border-[var(--terminal-frame-border)] hover:bg-[var(--terminal-surface)]/30 transition-colors overflow-hidden"
        style={{ width: '28px', [side === 'left' ? 'borderRight' : 'borderLeft']: '1px solid var(--terminal-frame-border)' }}
        onClick={() => toggleZoneCollapse(side)}
        title="Развернуть зону"
      >
        {side === 'left'
          ? <ChevronRight className="w-3 h-3 text-[var(--terminal-muted)]" />
          : <ChevronLeft className="w-3 h-3 text-[var(--terminal-muted)]" />
        }
        {/* Show frame titles vertically when collapsed */}
        {hasFrames && zone.frameKeys.map(key => (
          <div
            key={key}
            className="mt-1 text-[7px] text-[var(--terminal-frame-header)] font-mono tracking-wider uppercase whitespace-nowrap"
            style={{
              writingMode: 'vertical-rl',
              textOrientation: 'mixed',
              transform: side === 'left' ? 'rotate(180deg)' : 'none',
            }}
          >
            {getFrameTitle(key)}
          </div>
        ))}
      </div>
    );
  }

  // No frames and not in edit mode: don't show
  if (!hasFrames && !isEditMode) {
    return null;
  }

  // Expanded zone — relative for inner edge resize handle
  return (
    <div
      className={`shrink-0 min-w-0 flex flex-col overflow-hidden border-[var(--terminal-frame-border)] bg-[var(--terminal-bg)] relative ${side === 'left' ? 'border-r' : 'border-l'}`}
      style={{ width: `${zone.width}px` }}
    >
      {/* Zone header */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1 border-b border-[var(--terminal-frame-border)] bg-[var(--terminal-surface)]/30">
        <span className="text-[8px] text-[var(--terminal-frame-header)] font-mono uppercase tracking-wider">
          {side === 'left' ? 'Зона слева' : 'Зона справа'}
        </span>
        <span className="text-[7px] text-[var(--terminal-muted)] font-mono ml-auto">
          {hasFrames ? `${zone.frameKeys.length} фр.` : ''}
        </span>
        {/* Collapse toggle */}
        <button
          className="p-0.5 rounded-sm hover:bg-[var(--terminal-accent)]/20 text-[var(--terminal-muted)] hover:text-[var(--terminal-accent)] transition-colors"
          onClick={() => toggleZoneCollapse(side)}
          title="Свернуть зону"
        >
          {side === 'left'
            ? <ChevronLeft className="w-3 h-3" />
            : <ChevronRight className="w-3 h-3" />
          }
        </button>
      </div>

      {/* Zone frames — vertical stack, no top strip */}
      <div className="flex-1 overflow-y-auto terminal-scroll">
        {zone.frameKeys.map((key) => {
          const Comp = getFrameComponent(key);
          if (!Comp) return null;
          const frameH = zone.frameHeights?.[key] || 200;
          return (
            <div
              key={key}
              className="relative border-b border-[var(--terminal-frame-border)]/30"
              style={{ height: `${frameH}px`, minHeight: `${MIN_FRAME_H}px` }}
            >
              {/* Frame content fills the entire height */}
              <div className="h-full overflow-hidden">
                <FrameWrapper frameKey={key} zoneSide={side}>
                  <Comp />
                </FrameWrapper>
              </div>
              {/* Bottom-right corner resize handle — edit mode only */}
              {isEditMode && (
                <div
                  className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10"
                  onMouseDown={(e) => handleFrameResizeStart(e, key)}
                  title="Изменить размер"
                >
                  <svg viewBox="0 0 10 10" className="w-full h-full text-[var(--terminal-muted)] opacity-40 hover:opacity-100 transition-opacity">
                    <line x1="9" y1="5" x2="5" y2="9" stroke="currentColor" strokeWidth="0.8" />
                    <line x1="9" y1="2" x2="2" y2="9" stroke="currentColor" strokeWidth="0.8" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
        {/* Empty state in edit mode */}
        {!hasFrames && isEditMode && (
          <div className="flex flex-col items-center justify-center h-20 text-[8px] text-[var(--terminal-muted)] font-mono">
            <PanelRight className="w-4 h-4 mb-1 opacity-40" />
            <span>Переместите фрейм</span>
            <span>в зону кнопкой</span>
          </div>
        )}
      </div>

      {/* Zone frame management — edit mode */}
      {isEditMode && hasFrames && (
        <div className="shrink-0 px-2 py-1 border-t border-[var(--terminal-frame-border)]/30 bg-[var(--terminal-surface)]/20 space-y-0.5">
          {zone.frameKeys.map(key => (
            <div key={key} className="flex items-center gap-1 text-[7px] font-mono text-[var(--terminal-muted)]">
              <span className="truncate flex-1 text-[var(--terminal-text)]">{getFrameTitle(key)}</span>
              <button
                className="p-0.5 rounded-sm hover:bg-[var(--terminal-accent)]/20 text-[var(--terminal-accent)]"
                onClick={() => moveFrameToGrid(key)}
                title="Вернуть на сетку"
              >
                <PanelRight className="w-2.5 h-2.5" style={{ transform: side === 'left' ? 'scaleX(-1)' : 'none' }} />
              </button>
              <button
                className="p-0.5 rounded-sm hover:bg-[var(--terminal-negative)]/20 text-[var(--terminal-negative)]"
                onClick={() => hideFrame(key)}
                title="Скрыть"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Inner edge resize handle — always visible for horizontal resize */}
      <div
        className={`absolute top-0 bottom-0 ${side === 'left' ? 'right-0' : 'left-0'} w-1.5 cursor-col-resize hover:bg-[var(--terminal-accent)]/20 active:bg-[var(--terminal-accent)]/30 transition-colors z-20`}
        onMouseDown={handleResizeStart}
        title="Изменить ширину зоны"
      />
    </div>
  );
}
