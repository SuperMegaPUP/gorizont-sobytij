// ─── Layout Store — react-grid-layout state management + side zones ───────────
import { create } from 'zustand';
import type { LayoutItem, Layout } from 'react-grid-layout';

// ─── Layout version — bump to force reset when grid config changes ──────────
export const LAYOUT_VERSION = 18;

// ─── Layout validation: detect stretched/corrupt layouts ────────────────────
// Default lg layout max y + h ≈ 52. If a layout has items with y > 100,
// it was likely corrupted by the noCompactor bug. Reject it.
function isLayoutValid(layouts: Record<string, LayoutItem[]>): boolean {
  for (const [bp, items] of Object.entries(layouts)) {
    if (!Array.isArray(items)) return false;
    const maxRow = bp === 'lg' ? 100 : bp === 'md' ? 120 : 200;
    for (const item of items) {
      if (item.y > maxRow) {
        console.log('[Layout] Rejected stale layout: item', item.i, 'y=', item.y, '>', maxRow, '(bp=' + bp + ')');
        return false;
      }
    }
  }
  return true;
}

// ─── Frame Key type ─────────────────────────────────────────────────────────
export type FrameKey =
  | 'instruments'
  | 'tickers'
  | 'duration'
  | 'orderbook'
  | 'dynamics'
  | 'signals'
  | 'institutional'
  | 'anomalies'
  | 'fearGreed'
  | 'hourlyActivity'
  | 'smartMoney'
  | 'oiDynamics'
  | 'futuresOI'
  | 'top5'
  | 'strategies'
  | 'robotHistory'
  | 'news'
  | 'horizonScanner'
  | 'horizonRadar'
  | 'horizonObserver'
  | 'horizonHeatmap';

export const ALL_FRAME_KEYS: FrameKey[] = [
  'instruments',
  'tickers',
  'duration',
  'orderbook',
  'dynamics',
  'signals',
  'institutional',
  'anomalies',
  'fearGreed',
  'hourlyActivity',
  'smartMoney',
  'oiDynamics',
  'futuresOI',
  'top5',
  'strategies',
  'robotHistory',
  'news',
  'horizonScanner',
  'horizonRadar',
  'horizonObserver',
  'horizonHeatmap',
];

// ─── Default Layout (24 cols, rowHeight 20px — fine-grained positioning) ───
export const DEFAULT_LAYOUT_ITEMS: Record<string, LayoutItem[]> = {
  lg: [
    { i: 'instruments', x: 0, y: 0, w: 4, h: 32, minW: 1, minH: 2 },
    { i: 'tickers',      x: 4, y: 0, w: 6, h: 16, minW: 1, minH: 2 },
    { i: 'duration',     x: 10, y: 0, w: 4, h: 16, minW: 1, minH: 2 },
    { i: 'orderbook',    x: 14, y: 0, w: 4, h: 16, minW: 1, minH: 2 },
    { i: 'dynamics',     x: 4, y: 16, w: 6, h: 16, minW: 1, minH: 2 },
    { i: 'signals',      x: 10, y: 16, w: 4, h: 16, minW: 1, minH: 2 },
    { i: 'institutional', x: 14, y: 16, w: 4, h: 16, minW: 1, minH: 2 },
    { i: 'anomalies',       x: 18, y: 0, w: 6, h: 6, minW: 1, minH: 2 },
    { i: 'fearGreed',       x: 18, y: 6, w: 3, h: 8, minW: 1, minH: 2 },
    { i: 'hourlyActivity',  x: 21, y: 6, w: 3, h: 8, minW: 1, minH: 2 },
    { i: 'smartMoney',      x: 18, y: 14, w: 3, h: 10, minW: 1, minH: 2 },
    { i: 'oiDynamics',      x: 21, y: 14, w: 3, h: 10, minW: 1, minH: 2 },
    { i: 'futuresOI',       x: 18, y: 24, w: 6, h: 10, minW: 1, minH: 2 },
    { i: 'top5',            x: 18, y: 34, w: 6, h: 10, minW: 1, minH: 2 },
    { i: 'strategies',      x: 18, y: 44, w: 6, h: 8, minW: 1, minH: 2 },
    { i: 'robotHistory',     x: 0, y: 32, w: 6, h: 12, minW: 1, minH: 2 },
    { i: 'news',             x: 6, y: 32, w: 6, h: 12, minW: 1, minH: 2 },
    { i: 'horizonScanner',   x: 0, y: 54, w: 14, h: 10, minW: 10, minH: 6 },
    { i: 'horizonRadar',     x: 14, y: 54, w: 10, h: 10, minW: 6, minH: 6 },
    { i: 'horizonObserver',  x: 0, y: 64, w: 14, h: 6, minW: 8, minH: 4 },
    { i: 'horizonHeatmap',   x: 14, y: 64, w: 10, h: 6, minW: 6, minH: 4 },
  ],
  md: [
    { i: 'instruments', x: 0, y: 0, w: 4, h: 24, minW: 1, minH: 2 },
    { i: 'tickers',     x: 4, y: 0, w: 6, h: 12, minW: 1, minH: 2 },
    { i: 'duration',    x: 10, y: 0, w: 6, h: 12, minW: 1, minH: 2 },
    { i: 'orderbook',   x: 4, y: 12, w: 6, h: 12, minW: 1, minH: 2 },
    { i: 'dynamics',    x: 10, y: 12, w: 6, h: 12, minW: 1, minH: 2 },
    { i: 'signals',     x: 4, y: 24, w: 6, h: 12, minW: 1, minH: 2 },
    { i: 'institutional', x: 10, y: 24, w: 6, h: 12, minW: 1, minH: 2 },
    { i: 'anomalies',       x: 0, y: 36, w: 8, h: 6, minW: 1, minH: 2 },
    { i: 'fearGreed',       x: 0, y: 42, w: 4, h: 8, minW: 1, minH: 2 },
    { i: 'hourlyActivity',  x: 4, y: 42, w: 4, h: 8, minW: 1, minH: 2 },
    { i: 'smartMoney',      x: 8, y: 42, w: 4, h: 10, minW: 1, minH: 2 },
    { i: 'oiDynamics',      x: 12, y: 42, w: 4, h: 10, minW: 1, minH: 2 },
    { i: 'futuresOI',       x: 0, y: 52, w: 8, h: 10, minW: 1, minH: 2 },
    { i: 'top5',            x: 8, y: 52, w: 8, h: 10, minW: 1, minH: 2 },
    { i: 'strategies',      x: 0, y: 62, w: 8, h: 8, minW: 1, minH: 2 },
    { i: 'robotHistory',     x: 8, y: 62, w: 8, h: 10, minW: 1, minH: 2 },
    { i: 'news',             x: 0, y: 72, w: 8, h: 10, minW: 1, minH: 2 },
    { i: 'horizonScanner',   x: 0, y: 82, w: 16, h: 10, minW: 10, minH: 6 },
    { i: 'horizonRadar',     x: 0, y: 92, w: 8, h: 10, minW: 6, minH: 6 },
    { i: 'horizonObserver',  x: 8, y: 92, w: 8, h: 6, minW: 8, minH: 4 },
    { i: 'horizonHeatmap',   x: 0, y: 98, w: 16, h: 6, minW: 6, minH: 4 },
  ],
  sm: [
    { i: 'instruments', x: 0, y: 0, w: 8, h: 16, minW: 1, minH: 2 },
    { i: 'tickers',     x: 0, y: 16, w: 8, h: 12, minW: 1, minH: 2 },
    { i: 'duration',    x: 0, y: 28, w: 8, h: 12, minW: 1, minH: 2 },
    { i: 'dynamics',    x: 0, y: 40, w: 8, h: 12, minW: 1, minH: 2 },
    { i: 'signals',     x: 0, y: 52, w: 8, h: 12, minW: 1, minH: 2 },
    { i: 'orderbook',   x: 0, y: 64, w: 8, h: 12, minW: 1, minH: 2 },
    { i: 'institutional', x: 0, y: 76, w: 8, h: 12, minW: 1, minH: 2 },
    { i: 'anomalies',       x: 0, y: 88, w: 8, h: 6, minW: 1, minH: 2 },
    { i: 'fearGreed',       x: 0, y: 94, w: 4, h: 8, minW: 1, minH: 2 },
    { i: 'hourlyActivity',  x: 4, y: 94, w: 4, h: 8, minW: 1, minH: 2 },
    { i: 'smartMoney',      x: 0, y: 102, w: 4, h: 10, minW: 1, minH: 2 },
    { i: 'oiDynamics',      x: 4, y: 102, w: 4, h: 10, minW: 1, minH: 2 },
    { i: 'futuresOI',       x: 0, y: 112, w: 8, h: 10, minW: 1, minH: 2 },
    { i: 'top5',            x: 0, y: 122, w: 8, h: 10, minW: 1, minH: 2 },
    { i: 'strategies',      x: 0, y: 132, w: 8, h: 8, minW: 1, minH: 2 },
    { i: 'robotHistory',     x: 0, y: 140, w: 8, h: 10, minW: 1, minH: 2 },
    { i: 'news',             x: 0, y: 150, w: 8, h: 10, minW: 1, minH: 2 },
    { i: 'horizonScanner',   x: 0, y: 160, w: 8, h: 10, minW: 4, minH: 6 },
    { i: 'horizonRadar',     x: 0, y: 170, w: 8, h: 8, minW: 4, minH: 4 },
    { i: 'horizonObserver',  x: 0, y: 178, w: 8, h: 6, minW: 4, minH: 4 },
    { i: 'horizonHeatmap',   x: 0, y: 184, w: 8, h: 6, minW: 4, minH: 4 },
  ],
};

// Collapsed layout: keep width, reduce height to minimal bar
const COLLAPSED_H = 2; // 2 rows = 40px — enough for thin header bar

// ─── Side Zone ─────────────────────────────────────────────────────────────
export interface ZoneState {
  width: number;
  collapsed: boolean;
  frameKeys: FrameKey[];
  frameHeights: Record<string, number>;
}

export const DEFAULT_ZONE: ZoneState = {
  width: 280,
  collapsed: true,  // Collapsed by default — no frames inside
  frameKeys: [],
  frameHeights: {},
};

// ─── Layout Store Interface ─────────────────────────────────────────────────
export interface LayoutStore {
  // Edit mode
  isEditMode: boolean;
  toggleEditMode: () => void;
  setEditMode: (v: boolean) => void;

  // Current layouts per breakpoint
  layouts: Record<string, LayoutItem[]>;
  setLayouts: (layouts: Record<string, LayoutItem[]>) => void;
  onLayoutChange: (currentLayout: LayoutItem[], allLayouts: Record<string, LayoutItem[]>) => void;

  // Hidden frames (removed from grid but not deleted)
  hiddenFrames: FrameKey[];
  showFrame: (key: FrameKey) => void;
  hideFrame: (key: FrameKey) => void;

  // Collapsed frames (vertically collapsed — height reduced to minimal bar)
  collapsedFrames: FrameKey[];
  toggleCollapse: (key: FrameKey) => void;

  // Original sizes before collapse — keyed by "frameKey_bp" for per-breakpoint storage
  originalSizes: Record<string, { w: number; h: number; x: number; y: number }>;

  // Side zones
  leftZone: ZoneState;
  rightZone: ZoneState;
  setZoneWidth: (side: 'left' | 'right', width: number) => void;
  setZoneFrameHeight: (side: 'left' | 'right', frameKey: FrameKey, height: number) => void;
  toggleZoneCollapse: (side: 'left' | 'right') => void;
  moveFrameToZone: (frameKey: FrameKey, side: 'left' | 'right') => void;
  moveFrameToGrid: (frameKey: FrameKey) => void;
  reorderZoneFrame: (frameKey: FrameKey, side: 'left' | 'right', direction: 'up' | 'down') => void;

  // Rescale layouts when container width changes (side zone collapse/expand)
  rescaleLayouts: (scale: number) => void;

  // Reset to default
  resetLayout: () => void;

  // Persist
  saveToStorage: () => void;
  loadFromStorage: () => void;
  loadFromApi: () => Promise<void>;
  saveToApi: () => void;
}

const LAYOUT_STORAGE_KEY = 'robot-detector-layout';
const LAYOUT_VERSION_KEY = 'robot-detector-layout-version';

// ─── Helper: key for per-breakpoint originalSizes ────────────────────────────
function origKey(frameKey: string, bp: string): string {
  return `${frameKey}_${bp}`;
}

// ─── Helper: modify layout items for collapsed/expanded state ────────────────
// Now saves/restores sizes per-breakpoint (key = "frameKey_bp")
function applyCollapseToLayouts(
  layouts: Record<string, LayoutItem[]>,
  key: FrameKey,
  isCollapsing: boolean,
  originalSizes: Record<string, { w: number; h: number; x: number; y: number }>,
): { newLayouts: Record<string, LayoutItem[]>; newOriginalSizes: Record<string, { w: number; h: number; x: number; y: number }> } {
  const newLayouts: Record<string, LayoutItem[]> = {};
  const newOriginalSizes = { ...originalSizes };

  for (const [bp, items] of Object.entries(layouts)) {
    const ok = origKey(key, bp);
    const newItems = items.map(item => {
      if (item.i !== key) return item;

      if (isCollapsing) {
        // Save original size per-breakpoint
        newOriginalSizes[ok] = { w: item.w, h: item.h, x: item.x, y: item.y };
        // Keep width and position, just reduce height
        return { ...item, h: COLLAPSED_H, minH: 1 };
      } else {
        // Restore original size per-breakpoint
        const orig = originalSizes[ok];
        if (orig) {
          delete newOriginalSizes[ok];
          return { ...item, w: orig.w, h: orig.h, x: orig.x, y: orig.y, minH: 2 };
        }
        return item;
      }
    });
    newLayouts[bp] = newItems;
  }

  return { newLayouts, newOriginalSizes };
}

// ─── Get all frame keys currently in zones ──────────────────────────────────
function getZoneFrameKeys(leftZone: ZoneState, rightZone: ZoneState): FrameKey[] {
  return [...leftZone.frameKeys, ...rightZone.frameKeys];
}

// ─── Helper: remove frame from zones ────────────────────────────────────────
function removeFromZones(leftZone: ZoneState, rightZone: ZoneState, frameKey: FrameKey) {
  return {
    newLeft: { ...leftZone, frameKeys: leftZone.frameKeys.filter(k => k !== frameKey) },
    newRight: { ...rightZone, frameKeys: rightZone.frameKeys.filter(k => k !== frameKey) },
  };
}

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  isEditMode: false,
  toggleEditMode: () => set((s) => ({ isEditMode: !s.isEditMode })),
  setEditMode: (v) => set({ isEditMode: v }),

  layouts: DEFAULT_LAYOUT_ITEMS,
  setLayouts: (layouts) => set({ layouts }),

  onLayoutChange: (currentLayout, allLayouts) => {
    set({ layouts: allLayouts });
    get().saveToStorage();
    get().saveToApi();
  },

  hiddenFrames: [],
  showFrame: (key) => set((s) => ({
    hiddenFrames: s.hiddenFrames.filter((k) => k !== key),
  })),
  // hideFrame also removes frame from zones so X button works in side panel
  hideFrame: (key) => {
    const { leftZone, rightZone } = get();
    const { newLeft, newRight } = removeFromZones(leftZone, rightZone, key);
    set((s) => ({
      hiddenFrames: [...s.hiddenFrames, key],
      leftZone: newLeft,
      rightZone: newRight,
    }));
    get().saveToStorage();
    get().saveToApi();
  },

  collapsedFrames: [],
  toggleCollapse: (key) => {
    const { layouts, collapsedFrames, originalSizes } = get();
    const isCollapsing = !collapsedFrames.includes(key);

    const { newLayouts, newOriginalSizes } = applyCollapseToLayouts(
      layouts, key, isCollapsing, originalSizes
    );

    set({
      layouts: newLayouts,
      collapsedFrames: isCollapsing
        ? [...collapsedFrames, key]
        : collapsedFrames.filter((k) => k !== key),
      originalSizes: newOriginalSizes,
    });

    get().saveToStorage();
    get().saveToApi();
  },

  originalSizes: {},

  // ─── Side zones ────────────────────────────────────────────────────────
  leftZone: { ...DEFAULT_ZONE },
  rightZone: { ...DEFAULT_ZONE },

  setZoneWidth: (side, width) => {
    const clamped = Math.max(180, Math.min(500, width));
    if (side === 'left') {
      set((s) => ({ leftZone: { ...s.leftZone, width: clamped } }));
    } else {
      set((s) => ({ rightZone: { ...s.rightZone, width: clamped } }));
    }
    get().saveToStorage();
  },

  setZoneFrameHeight: (side, frameKey, height) => {
    const clamped = Math.max(60, height);
    if (side === 'left') {
      set((s) => ({ leftZone: { ...s.leftZone, frameHeights: { ...s.leftZone.frameHeights, [frameKey]: clamped } } }));
    } else {
      set((s) => ({ rightZone: { ...s.rightZone, frameHeights: { ...s.rightZone.frameHeights, [frameKey]: clamped } } }));
    }
    get().saveToStorage();
  },

  toggleZoneCollapse: (side) => {
    if (side === 'left') {
      set((s) => ({ leftZone: { ...s.leftZone, collapsed: !s.leftZone.collapsed } }));
    } else {
      set((s) => ({ rightZone: { ...s.rightZone, collapsed: !s.rightZone.collapsed } }));
    }
    get().saveToStorage();
    get().saveToApi();
  },

  moveFrameToZone: (frameKey, side) => {
    const { leftZone, rightZone } = get();

    // Remove from other zone if already there
    const newLeft = { ...leftZone, frameKeys: leftZone.frameKeys.filter(k => k !== frameKey) };
    const newRight = { ...rightZone, frameKeys: rightZone.frameKeys.filter(k => k !== frameKey) };

    // Add to target zone
    if (side === 'left') {
      newLeft.frameKeys = [...newLeft.frameKeys, frameKey];
    } else {
      newRight.frameKeys = [...newRight.frameKeys, frameKey];
    }

    set({ leftZone: newLeft, rightZone: newRight });
    get().saveToStorage();
    get().saveToApi();
  },

  moveFrameToGrid: (frameKey) => {
    const { leftZone, rightZone, layouts } = get();

    // Remove from zones
    const newLeft = { ...leftZone, frameKeys: leftZone.frameKeys.filter(k => k !== frameKey) };
    const newRight = { ...rightZone, frameKeys: rightZone.frameKeys.filter(k => k !== frameKey) };

    // Add back to grid layout with default position
    const newLayouts: Record<string, LayoutItem[]> = {};
    for (const [bp, items] of Object.entries(layouts)) {
      const exists = items.some(item => item.i === frameKey);
      if (!exists) {
        // Find default position from DEFAULT_LAYOUT_ITEMS
        const defaultItem = DEFAULT_LAYOUT_ITEMS[bp]?.find(item => item.i === frameKey);
        if (defaultItem) {
          newLayouts[bp] = [...items, { ...defaultItem }];
        } else {
          // Place at bottom of grid
          const maxY = items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
          const cols = bp === 'lg' ? 24 : bp === 'md' ? 16 : 8;
          newLayouts[bp] = [...items, { i: frameKey, x: 0, y: maxY, w: Math.min(6, cols), h: 10, minW: 1, minH: 2 }];
        }
      } else {
        newLayouts[bp] = items;
      }
    }

    set({ leftZone: newLeft, rightZone: newRight, layouts: newLayouts });
    get().saveToStorage();
    get().saveToApi();
  },

  // ─── Reorder frames within a zone (move up/down) ──────────────────────
  reorderZoneFrame: (frameKey, side, direction) => {
    const zone = side === 'left' ? get().leftZone : get().rightZone;
    const keys = [...zone.frameKeys];
    const idx = keys.indexOf(frameKey);
    if (idx === -1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= keys.length) return;

    // Swap
    [keys[idx], keys[targetIdx]] = [keys[targetIdx], keys[idx]];

    if (side === 'left') {
      set((s) => ({ leftZone: { ...s.leftZone, frameKeys: keys } }));
    } else {
      set((s) => ({ rightZone: { ...s.rightZone, frameKeys: keys } }));
    }
    get().saveToStorage();
    get().saveToApi();
  },

  // ─── Rescale layouts when container width changes ────────────────────────
  rescaleLayouts: (scale: number) => {
    const { layouts } = get();
    const newLayouts: Record<string, LayoutItem[]> = {};

    for (const [bp, items] of Object.entries(layouts)) {
      const maxCols = bp === 'lg' ? 24 : bp === 'md' ? 16 : 8;
      newLayouts[bp] = items.map(item => {
        const newW = Math.max(item.minW || 1, Math.min(maxCols, Math.round(item.w * scale)));
        const newX = Math.max(0, Math.min(maxCols - newW, Math.round(item.x * scale)));
        return { ...item, w: newW, x: newX };
      });
    }

    set({ layouts: newLayouts });
    get().saveToStorage();
  },

  resetLayout: () => {
    set({
      layouts: DEFAULT_LAYOUT_ITEMS,
      hiddenFrames: [],
      collapsedFrames: [],
      originalSizes: {},
      leftZone: { ...DEFAULT_ZONE },
      rightZone: { ...DEFAULT_ZONE },
    });
    get().saveToStorage();
    get().saveToApi();
  },

  saveToStorage: () => {
    try {
      const { layouts, hiddenFrames, collapsedFrames, originalSizes, leftZone, rightZone } = get();
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
        layouts,
        hiddenFrames,
        collapsedFrames,
        originalSizes,
        leftZone,
        rightZone,
      }));
    } catch {
      // localStorage quota or private browsing — ignore
    }
  },

  loadFromStorage: () => {
    try {
      const savedVersion = localStorage.getItem(LAYOUT_VERSION_KEY);
      if (savedVersion && Number(savedVersion) < LAYOUT_VERSION) {
        console.log('[Layout] Grid config changed (v' + savedVersion + ' → v' + LAYOUT_VERSION + '), resetting layouts');
        localStorage.removeItem(LAYOUT_STORAGE_KEY);
        localStorage.setItem(LAYOUT_VERSION_KEY, String(LAYOUT_VERSION));
        return;
      }
      if (!savedVersion) {
        localStorage.setItem(LAYOUT_VERSION_KEY, String(LAYOUT_VERSION));
      }
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.layouts && isLayoutValid(data.layouts)) {
          set({ layouts: data.layouts });
        } else if (data.layouts) {
          // Stale/corrupt layout data — clear and use defaults
          console.log('[Layout] localStorage layouts are corrupt/stretched, resetting to defaults');
          localStorage.removeItem(LAYOUT_STORAGE_KEY);
        }
        if (data.hiddenFrames) set({ hiddenFrames: data.hiddenFrames });
        if (data.collapsedFrames) set({ collapsedFrames: data.collapsedFrames });
        if (data.originalSizes) set({ originalSizes: data.originalSizes });
        if (data.leftZone) set({ leftZone: data.leftZone });
        if (data.rightZone) set({ rightZone: data.rightZone });
      }
    } catch {
      // Corrupt data — use defaults
    }
  },

  loadFromApi: async () => {
    try {
      const res = await fetch('/api/layout');
      if (res.ok) {
        const data = await res.json();
        // If API data is from an older layout version (or has no version), ignore it
        // (stale stretched layouts from noCompactor, etc.)
        const apiVer = data.layoutVersion || 0;
        if (apiVer < LAYOUT_VERSION) {
          console.log('[Layout API] Stale layout version (' + apiVer + ' < ' + LAYOUT_VERSION + '), skipping');
          return;
        }
        // Validate layout data — reject stretched/corrupt layouts
        if (data.layouts && !isLayoutValid(data.layouts)) {
          console.log('[Layout API] API layouts are corrupt/stretched, skipping');
          return;
        }
        if (data.layouts && Object.keys(data.layouts).length > 0) {
          set({ layouts: data.layouts });
        }
        if (data.hiddenFrames && data.hiddenFrames.length > 0) {
          set({ hiddenFrames: data.hiddenFrames });
        }
        if (data.collapsedFrames && data.collapsedFrames.length > 0) {
          set({ collapsedFrames: data.collapsedFrames });
        }
        if (data.originalSizes) {
          set({ originalSizes: data.originalSizes });
        }
        if (data.leftZone) {
          set({ leftZone: data.leftZone });
        }
        if (data.rightZone) {
          set({ rightZone: data.rightZone });
        }
        get().saveToStorage();
      }
    } catch {
      // API not available — localStorage is the fallback
    }
  },

  saveToApi: (() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        const { layouts, hiddenFrames, collapsedFrames, originalSizes, leftZone, rightZone } = get();
        fetch('/api/layout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            layouts,
            hiddenFrames,
            collapsedFrames,
            originalSizes,
            leftZone,
            rightZone,
            layoutVersion: LAYOUT_VERSION,
          }),
        }).catch(() => {});
      }, 1000);
    };
  })(),
}));

// ─── Helper: get frame keys that are in zones ──────────────────────────────
export function getZoneFrameKeysFromStore(): FrameKey[] {
  const { leftZone, rightZone } = useLayoutStore.getState();
  return getZoneFrameKeys(leftZone, rightZone);
}
