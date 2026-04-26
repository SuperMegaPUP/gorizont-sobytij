'use client';

import { create } from 'zustand';

/* ═══════════════════════════════════════════════════════════════════════════════
   FONT OPTIONS — curated list of fonts with Russian/Cyrillic support
   ═══════════════════════════════════════════════════════════════════════════════ */

export interface FontOption {
  family: string;          // CSS font-family value
  label: string;           // Display name
  category: 'sans' | 'mono' | 'serif' | 'handwriting';
  preview: string;         // Short preview text
}

export const FONT_OPTIONS: FontOption[] = [
  // Sans-serif
  {
    family: "'Geist Sans', 'Noto Sans SC', sans-serif",
    label: 'Geist Sans',
    category: 'sans',
    preview: 'Aa Бб 123',
  },
  {
    family: "'Noto Sans SC', 'DejaVu Sans', sans-serif",
    label: 'Noto Sans SC',
    category: 'sans',
    preview: 'Aa Бб 123',
  },
  {
    family: "'Liberation Sans', 'Noto Sans SC', sans-serif",
    label: 'Liberation Sans',
    category: 'sans',
    preview: 'Aa Бб 123',
  },
  {
    family: "'Carlito', 'Noto Sans SC', sans-serif",
    label: 'Carlito',
    category: 'sans',
    preview: 'Aa Бб 123',
  },
  // Monospace
  {
    family: "'Geist Mono', 'Sarasa Mono SC', monospace",
    label: 'Geist Mono',
    category: 'mono',
    preview: 'Aa Бб 123',
  },
  {
    family: "'Sarasa Mono SC', 'DejaVu Sans Mono', monospace",
    label: 'Sarasa Mono SC',
    category: 'mono',
    preview: 'Aa Бб 123',
  },
  {
    family: "'Liberation Mono', 'DejaVu Sans Mono', monospace",
    label: 'Liberation Mono',
    category: 'mono',
    preview: 'Aa Бб 123',
  },
  {
    family: "'DejaVu Sans Mono', monospace",
    label: 'DejaVu Sans Mono',
    category: 'mono',
    preview: 'Aa Бб 123',
  },
  // Serif
  {
    family: "'Noto Serif SC', 'DejaVu Serif', serif",
    label: 'Noto Serif SC',
    category: 'serif',
    preview: 'Aa Бб 123',
  },
  {
    family: "'Liberation Serif', 'Noto Serif SC', serif",
    label: 'Liberation Serif',
    category: 'serif',
    preview: 'Aa Бб 123',
  },
  // Handwriting
  {
    family: "'LXGW WenKai', 'Noto Sans SC', cursive",
    label: 'LXGW WenKai',
    category: 'handwriting',
    preview: 'Aa Бб 123',
  },
];

export const FONT_CATEGORY_LABELS: Record<FontOption['category'], string> = {
  sans: 'Гротеск (Sans)',
  mono: 'Моноширинный',
  serif: 'С засечками (Serif)',
  handwriting: 'Рукописный',
};

/* ═══════════════════════════════════════════════════════════════════════════════
   FONT SIZE OPTIONS
   ═══════════════════════════════════════════════════════════════════════════════ */

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 45;
export const FONT_SIZE_DEFAULT = 14;
export const FONT_SIZE_STEP = 1;
export const FONT_SIZE_BASE = 14; // Base size for zoom scale calculation

/* ═══════════════════════════════════════════════════════════════════════════════
   SETTINGS STORE
   ═══════════════════════════════════════════════════════════════════════════════ */

const STORAGE_KEY_FONT = 'robot-detector-font-family';
const STORAGE_KEY_SIZE = 'robot-detector-font-size';

const DEFAULT_FONT_FAMILY = FONT_OPTIONS[0].family; // Geist Sans

interface SettingsState {
  fontFamily: string;
  fontSize: number;
  setFontFamily: (family: string) => void;
  setFontSize: (size: number) => void;
  resetToDefaults: () => void;
}

/**
 * Read persisted settings from localStorage.
 * Returns defaults if window is unavailable (SSR) or if nothing is saved.
 */
function readStorageValues(): { fontFamily: string; fontSize: number } {
  if (typeof window === 'undefined') {
    return { fontFamily: DEFAULT_FONT_FAMILY, fontSize: FONT_SIZE_DEFAULT };
  }
  try {
    const savedFont = localStorage.getItem(STORAGE_KEY_FONT);
    const savedSize = localStorage.getItem(STORAGE_KEY_SIZE);
    const fontFamily = savedFont && FONT_OPTIONS.some(f => f.family === savedFont)
      ? savedFont
      : DEFAULT_FONT_FAMILY;
    const fontSize = savedSize ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, parseInt(savedSize, 10) || FONT_SIZE_DEFAULT))
      : FONT_SIZE_DEFAULT;
    return { fontFamily, fontSize };
  } catch {
    return { fontFamily: DEFAULT_FONT_FAMILY, fontSize: FONT_SIZE_DEFAULT };
  }
}

/*
 * IMPORTANT: The store ALWAYS initializes with default values (no localStorage read).
 * This ensures that the first server-side render and the first client render produce
 * identical output, preventing React hydration error #418.
 *
 * After hydration, `initSettingsFromStorage()` is called in a useEffect, which safely
 * loads the persisted values and updates both the store state and the DOM.
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: FONT_SIZE_DEFAULT,

  setFontFamily: (family: string) => {
    set({ fontFamily: family });
    try { localStorage.setItem(STORAGE_KEY_FONT, family); } catch { /* ignore */ }
    applySettingsToDOM(family, undefined);
  },

  setFontSize: (size: number) => {
    const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size));
    set({ fontSize: clamped });
    try { localStorage.setItem(STORAGE_KEY_SIZE, String(clamped)); } catch { /* ignore */ }
    applySettingsToDOM(undefined, clamped);
  },

  resetToDefaults: () => {
    set({ fontFamily: DEFAULT_FONT_FAMILY, fontSize: FONT_SIZE_DEFAULT });
    try {
      localStorage.setItem(STORAGE_KEY_FONT, DEFAULT_FONT_FAMILY);
      localStorage.setItem(STORAGE_KEY_SIZE, String(FONT_SIZE_DEFAULT));
    } catch { /* ignore */ }
    applySettingsToDOM(DEFAULT_FONT_FAMILY, FONT_SIZE_DEFAULT);
  },
}));

/* ═══════════════════════════════════════════════════════════════════════════════
   APPLY SETTINGS TO DOM — set CSS custom properties on <html>
   ═══════════════════════════════════════════════════════════════════════════════ */

export function applySettingsToDOM(fontFamily?: string, fontSize?: number) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (fontFamily !== undefined) {
    root.style.setProperty('--app-font-family', fontFamily);
  }
  if (fontSize !== undefined) {
    root.style.setProperty('--app-font-size', `${fontSize}px`);
    // Set scale factor so CSS can compute relative font sizes
    const scale = fontSize / FONT_SIZE_BASE;
    root.style.setProperty('--app-font-scale', String(scale));
  }
}

/**
 * Call once on app mount (in useEffect) to apply persisted settings.
 * Updates BOTH the store state and DOM CSS vars so the UI reflects
 * the user's saved preferences after hydration completes safely.
 */
export function initSettingsFromStorage() {
  const { fontFamily, fontSize } = readStorageValues();
  // Update store state (triggers re-render with persisted values)
  useSettingsStore.setState({ fontFamily, fontSize });
  // Update CSS custom properties on <html>
  applySettingsToDOM(fontFamily, fontSize);
}
