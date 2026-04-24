// ─── DashboardGrid — react-grid-layout container for all frames ──────────────
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor, noCompactor, type Layout, type LayoutItem } from 'react-grid-layout';
import { useLayoutStore, ALL_FRAME_KEYS, DEFAULT_LAYOUT_ITEMS } from '@/lib/layout-store';
import type { FrameKey } from '@/lib/layout-store';
import { FRAME_REGISTRY, getFrameComponent } from '@/lib/frame-registry';
import { FrameWrapper } from './FrameWrapper';
import { useDashboardStore } from '@/lib/store';
import { isMarketOpen } from '@/lib/helpers';

// ─── Breakpoints & columns ──────────────────────────────────────────────────
const COLS = { lg: 24, md: 16, sm: 8 };
const ROW_HEIGHT = 20;

// ─── Window-based breakpoints (NOT container-based!) ────────────────────────
// Side zone collapse/expand changes container width, but should NOT change
// the breakpoint. Only resizing the browser window should.
const WINDOW_BREAKPOINTS = { lg: 1400, md: 1000, sm: 700 };

function getCurrentBreakpoint(windowWidth: number): string {
  if (windowWidth >= WINDOW_BREAKPOINTS.lg) return 'lg';
  if (windowWidth >= WINDOW_BREAKPOINTS.md) return 'md';
  return 'sm';
}

// ─── DashboardGrid Component ────────────────────────────────────────────────
export function DashboardGrid() {
  const layouts = useLayoutStore((s) => s.layouts);
  const hiddenFrames = useLayoutStore((s) => s.hiddenFrames);
  const isEditMode = useLayoutStore((s) => s.isEditMode);
  const onLayoutChange = useLayoutStore((s) => s.onLayoutChange);
  const loadFromStorage = useLayoutStore((s) => s.loadFromStorage);
  const loadFromApi = useLayoutStore((s) => s.loadFromApi);
  const leftZone = useLayoutStore((s) => s.leftZone);
  const rightZone = useLayoutStore((s) => s.rightZone);
  const updateAlgoPack = useDashboardStore((s) => s.updateAlgoPack);

  // Auto-measure container width
  const { width, containerRef } = useContainerWidth({ initialWidth: 800 });

  // Determine breakpoint from WINDOW width, not container width.
  // This is the KEY fix: side zones collapsing must not change the breakpoint.
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1400
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const currentBp = getCurrentBreakpoint(windowWidth);

  // Adaptive breakpoints: make the current breakpoint always match the container
  // width by setting its threshold to 0, and all others to 99999.
  // This prevents ResponsiveGridLayout from switching breakpoints when
  // side zones collapse/expand (which changes container width but not window width).
  const adaptiveBreakpoints = useMemo(() => ({
    lg: currentBp === 'lg' ? 0 : 99999,
    md: currentBp === 'md' ? 0 : 99999,
    sm: currentBp === 'sm' ? 0 : 99999,
  }), [currentBp]);

  // Skip layout saves during width transitions (side zone collapse/expand)
  const widthChangeRef = useRef(false);
  const prevWidthRef = useRef(width);

  useEffect(() => {
    if (Math.abs(width - prevWidthRef.current) > 5) {
      widthChangeRef.current = true;
      const timer = setTimeout(() => { widthChangeRef.current = false; }, 500);
      prevWidthRef.current = width;
      return () => clearTimeout(timer);
    }
  }, [width]);

  // Load saved layout on mount: localStorage (sync) → Redis API (async)
  useEffect(() => {
    loadFromStorage();
    loadFromApi();
  }, [loadFromStorage, loadFromApi]);

  // ─── AlgoPack polling ───
  const algopackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const fetchAlgoPack = async () => {
      if (!isMarketOpen()) return;
      try {
        const res = await fetch('/api/algopack?action=all&limit=30');
        if (res.ok) {
          const data = await res.json();
          const instruments = useDashboardStore.getState().instruments;
          const topTickers = instruments.map(i => i.ticker);
          updateAlgoPack({
            walls: data.walls || [],
            accumulations: data.accumulations || [],
            spoofingTickers: data.spoofingTickers || [],
            totalTickers: data.totalTickers || 0,
            source: data.source || 'none',
            tradetime: data.tradetime || '',
            date: data.date || '',
            topTickers,
          });
        }
      } catch (e) {
        console.warn('[ALGOPACK] fetch error:', e);
      }
    };

    fetchAlgoPack();
    algopackTimerRef.current = setInterval(fetchAlgoPack, 5 * 60 * 1000);

    return () => {
      if (algopackTimerRef.current) clearInterval(algopackTimerRef.current);
    };
  }, [updateAlgoPack]);

  // ─── Frame keys in zones ───
  const zoneFrameKeys = useMemo(
    () => new Set([...leftZone.frameKeys, ...rightZone.frameKeys]),
    [leftZone.frameKeys, rightZone.frameKeys],
  );

  // ─── Filter visible frames (not hidden, not in zones) ───
  const visibleFrames = useMemo(
    () => ALL_FRAME_KEYS.filter((k) => !hiddenFrames.includes(k) && !zoneFrameKeys.has(k)),
    [hiddenFrames, zoneFrameKeys],
  );

  // ─── Filtered layouts (remove hidden frames and zone frames) ───
  const filteredLayouts = useMemo(() => {
    const excluded = new Set([...hiddenFrames, ...zoneFrameKeys]);
    const result: Record<string, LayoutItem[]> = {};
    for (const [bp, bpLayouts] of Object.entries(layouts)) {
      result[bp] = bpLayouts.filter((l) => !excluded.has(l.i as FrameKey));
    }
    return result;
  }, [layouts, hiddenFrames, zoneFrameKeys]);

  // ─── Handle layout change (merge hidden/zone frames back) ───
  const handleLayoutChange = useCallback(
    (currentLayout: Layout, allLayouts: Partial<Record<string, Layout>>) => {
      // Skip saves triggered by width changes (side zone collapse/expand)
      if (widthChangeRef.current) return;

      // Merge hidden frames and zone frames back into layouts so they aren't lost
      const excluded = new Set([...hiddenFrames, ...zoneFrameKeys]);
      const mergedLayouts: Record<string, LayoutItem[]> = {};
      for (const [bp, bpLayout] of Object.entries(allLayouts)) {
        if (!bpLayout) continue;
        const excludedInBp = (layouts[bp] || []).filter((l) => excluded.has(l.i as FrameKey));
        mergedLayouts[bp] = [...bpLayout, ...excludedInBp];
      }
      onLayoutChange([...currentLayout], mergedLayouts);
    },
    [layouts, hiddenFrames, zoneFrameKeys, onLayoutChange],
  );

  return (
    <div
      ref={containerRef}
      className={`h-full w-full terminal-scroll ${isEditMode ? 'overflow-auto' : 'overflow-y-auto overflow-x-hidden'}`}
      style={{ background: 'var(--terminal-bg)' }}
    >
      <ResponsiveGridLayout
        width={width}
        className={`dashboard-grid ${isEditMode ? 'edit-mode' : ''}`}
        layouts={filteredLayouts}
        breakpoints={adaptiveBreakpoints}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        compactor={isEditMode ? noCompactor : verticalCompactor}
        margin={[6, 6] as [number, number]}
        containerPadding={[8, 8] as [number, number]}
        dragConfig={{
          enabled: isEditMode,
          handle: '.drag-handle',
          bounded: true,
          threshold: 3,
        }}
        resizeConfig={{
          enabled: isEditMode,
          handles: ['se'] as const,
        }}
        onLayoutChange={handleLayoutChange}
      >
        {visibleFrames.map((key) => {
          const Comp = getFrameComponent(key);
          if (!Comp) return null;
          return (
            <div key={key}>
              <FrameWrapper frameKey={key}>
                <Comp />
              </FrameWrapper>
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}
