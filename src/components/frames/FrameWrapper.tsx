// ─── FrameWrapper — thin control bar + vertical collapse + zone buttons ──────
'use client';

import React, { useCallback } from 'react';
import { GripVertical, X, ChevronDown, PanelLeft, PanelRight, ArrowLeftRight, ChevronUp, ChevronDown as ChevronDownIcon } from 'lucide-react';
import { useLayoutStore } from '@/lib/layout-store';
import type { FrameKey } from '@/lib/layout-store';
import { getFrameTitle } from '@/lib/frame-registry';

interface FrameWrapperProps {
  frameKey: FrameKey;
  children: React.ReactNode;
  /** When rendered inside a SideZone, this is the side ('left'|'right'). null when in main grid. */
  zoneSide?: 'left' | 'right';
}

export function FrameWrapper({ frameKey, children, zoneSide }: FrameWrapperProps) {
  const isEditMode = useLayoutStore((s) => s.isEditMode);
  const hideFrame = useLayoutStore((s) => s.hideFrame);
  const collapsedFrames = useLayoutStore((s) => s.collapsedFrames);
  const toggleCollapse = useLayoutStore((s) => s.toggleCollapse);
  const moveFrameToZone = useLayoutStore((s) => s.moveFrameToZone);
  const moveFrameToGrid = useLayoutStore((s) => s.moveFrameToGrid);
  const reorderZoneFrame = useLayoutStore((s) => s.reorderZoneFrame);
  const leftZone = useLayoutStore((s) => s.leftZone);
  const rightZone = useLayoutStore((s) => s.rightZone);
  const isCollapsed = collapsedFrames.includes(frameKey);
  const isInZone = !!zoneSide || leftZone.frameKeys.includes(frameKey) || rightZone.frameKeys.includes(frameKey);
  const title = getFrameTitle(frameKey);

  // Zone info for reorder buttons
  const zone = zoneSide === 'left' ? leftZone : zoneSide === 'right' ? rightZone : null;
  const zoneIdx = zone ? zone.frameKeys.indexOf(frameKey) : -1;

  const handleCollapseToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggleCollapse(frameKey);
  }, [frameKey, toggleCollapse]);

  const handleHide = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    hideFrame(frameKey);
  }, [frameKey, hideFrame]);

  const handleMoveToGrid = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    moveFrameToGrid(frameKey);
  }, [frameKey, moveFrameToGrid]);

  // Collapsed: show minimal bar with expand button
  if (isCollapsed) {
    return (
      <div
        className="flex items-center h-full px-2 bg-[var(--terminal-surface)]/30 border border-[var(--terminal-frame-border)] rounded-md cursor-pointer hover:bg-[var(--terminal-surface)]/50 transition-colors"
        onClick={handleCollapseToggle}
        title={`${title} — нажмите чтобы развернуть`}
      >
        <ChevronDown className="w-2.5 h-2.5 text-[var(--terminal-accent)] shrink-0 rotate-180" />
        <span className="text-[8px] text-[var(--terminal-frame-header)] font-mono ml-1 truncate uppercase tracking-wide">
          {title}
        </span>
      </div>
    );
  }

  // Normal: thin control bar at top
  // IMPORTANT: When in a zone (zoneSide is set), never apply 'drag-handle' class
  // because that class is for react-grid-layout drag in the main grid only.
  // Applying it in a zone causes a crash when dragging frames over each other.
  return (
    <div
      className={`flex flex-col h-full overflow-hidden rounded-md border border-[var(--terminal-frame-border)] bg-[var(--terminal-bg)] transition-shadow duration-200 ${
        isEditMode
          ? 'shadow-[0_2px_12px_rgba(0,0,0,0.3)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.5)]'
          : 'shadow-[0_1px_3px_rgba(0,0,0,0.2)]'
      }`}
    >
      {/* Accent line at top */}
      <div
        className="shrink-0 h-[2px] w-full"
        style={{ background: `linear-gradient(90deg, var(--terminal-accent) 0%, transparent 100%)` }}
      />

      {/* Ultra-thin control bar — only buttons, no title text */}
      <div
        className={`shrink-0 flex items-center gap-0.5 px-1 py-[1px] select-none ${
          isEditMode && !isInZone
            ? 'drag-handle cursor-grab active:cursor-grabbing bg-[var(--terminal-surface)]/70 border-b border-[var(--terminal-frame-border)]'
            : 'bg-[var(--terminal-surface)]/15'
        }`}
        onDoubleClick={() => toggleCollapse(frameKey)}
      >
        {isEditMode && !isInZone && (
          <GripVertical className="w-2.5 h-2.5 text-[var(--terminal-accent)] shrink-0" />
        )}
        {/* Collapse button — always visible */}
        <button
          className="p-[1px] rounded-sm hover:bg-[var(--terminal-accent)]/20 text-[var(--terminal-muted)] hover:text-[var(--terminal-accent)] transition-colors"
          onClick={handleCollapseToggle}
          title={`Свернуть «${title}»`}
        >
          <ChevronDown className="w-2.5 h-2.5" />
        </button>

        {/* ─── Zone-specific buttons ─── */}
        {isInZone ? (
          <>
            {/* Reorder up/down — edit mode only, when in zone */}
            {isEditMode && zoneSide && zone && (
              <>
                <button
                  className="p-[1px] rounded-sm hover:bg-[var(--terminal-accent)]/20 text-[var(--terminal-muted)] hover:text-[var(--terminal-accent)] transition-colors disabled:opacity-20 disabled:cursor-default"
                  onClick={(e) => { e.stopPropagation(); reorderZoneFrame(frameKey, zoneSide, 'up'); }}
                  disabled={zoneIdx <= 0}
                  title="Выше"
                >
                  <ChevronUp className="w-2.5 h-2.5" />
                </button>
                <button
                  className="p-[1px] rounded-sm hover:bg-[var(--terminal-accent)]/20 text-[var(--terminal-muted)] hover:text-[var(--terminal-accent)] transition-colors disabled:opacity-20 disabled:cursor-default"
                  onClick={(e) => { e.stopPropagation(); reorderZoneFrame(frameKey, zoneSide, 'down'); }}
                  disabled={zoneIdx < 0 || zoneIdx >= zone.frameKeys.length - 1}
                  title="Ниже"
                >
                  <ChevronDownIcon className="w-2.5 h-2.5" />
                </button>
              </>
            )}
            {/* Move back to grid — edit mode only, when in zone */}
            {isEditMode && (
              <button
                className="p-[1px] rounded-sm hover:bg-[var(--terminal-accent)]/20 text-[var(--terminal-muted)] hover:text-[var(--terminal-accent)] transition-colors"
                onClick={handleMoveToGrid}
                title="Вернуть на сетку"
              >
                <ArrowLeftRight className="w-2.5 h-2.5" />
              </button>
            )}
          </>
        ) : (
          <>
            {/* Zone buttons — edit mode only, for frames NOT in zones */}
            {isEditMode && (
              <>
                <button
                  className="p-[1px] rounded-sm hover:bg-[var(--terminal-accent)]/20 text-[var(--terminal-muted)] hover:text-[var(--terminal-accent)] transition-colors"
                  onClick={(e) => { e.stopPropagation(); moveFrameToZone(frameKey, 'left'); }}
                  title="В зону слева"
                >
                  <PanelLeft className="w-2.5 h-2.5" />
                </button>
                <button
                  className="p-[1px] rounded-sm hover:bg-[var(--terminal-accent)]/20 text-[var(--terminal-muted)] hover:text-[var(--terminal-accent)] transition-colors"
                  onClick={(e) => { e.stopPropagation(); moveFrameToZone(frameKey, 'right'); }}
                  title="В зону справа"
                >
                  <PanelRight className="w-2.5 h-2.5" />
                </button>
              </>
            )}
          </>
        )}

        {/* Close (hide) button — edit mode only */}
        {isEditMode && (
          <button
            className="p-[1px] rounded-sm hover:bg-[var(--terminal-negative)]/20 text-[var(--terminal-muted)] hover:text-[var(--terminal-negative)] transition-colors ml-auto"
            onClick={handleHide}
            title="Скрыть фрейм"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        )}
      </div>

      {/* Frame content */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
