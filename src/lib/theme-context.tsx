'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemeName = 'night-owl' | 'shade' | 'fog' | 'warm-sand' | 'soft-gray' | 'dusty-rose' | 'ocean-mist' | 'twilight-purple' | 'muddy-latte' | 'carbon-slate' | 'desert-dusk';

interface ThemeInfo {
  name: ThemeName;
  label: string;
  description: string;
  previewBg: string;
  previewAccent: string;
}

export const THEMES: ThemeInfo[] = [
  {
    name: 'night-owl',
    label: 'NIGHT OWL',
    description: 'Тёмная тема — классический терминал',
    previewBg: '#0a0e17',
    previewAccent: '#4ade80',
  },
  {
    name: 'shade',
    label: 'SHADE',
    description: 'Спокойная тёмная — акценты на важном',
    previewBg: '#121418',
    previewAccent: '#6366f1',
  },
  {
    name: 'fog',
    label: 'FOG',
    description: 'Светлая пастель — мягкий дзен',
    previewBg: '#f8f9fb',
    previewAccent: '#818cf8',
  },
  {
    name: 'warm-sand',
    label: 'WARM SAND',
    description: 'Тёплый песок — землистые природные оттенки',
    previewBg: '#f5efe6',
    previewAccent: '#d4a373',
  },
  {
    name: 'soft-gray',
    label: 'SOFT GRAY',
    description: 'Монохром серый — амбер только для критического',
    previewBg: '#2d3748',
    previewAccent: '#f59e0b',
  },
  {
    name: 'dusty-rose',
    label: 'DUSTY ROSE',
    description: 'Пыльная роза — нежная лавандовая пастель',
    previewBg: '#fdf2f8',
    previewAccent: '#c4b5fd',
  },
  {
    name: 'ocean-mist',
    label: 'OCEAN MIST',
    description: 'Океанский туман — бирюзовые и коралловые тона',
    previewBg: '#1e3a4a',
    previewAccent: '#6ee7b7',
  },
  {
    name: 'twilight-purple',
    label: 'TWILIGHT',
    description: 'Сумеречный фиолетовый — лаванда и персик',
    previewBg: '#2e1065',
    previewAccent: '#a78bfa',
  },
  {
    name: 'muddy-latte',
    label: 'MUDDY LATTE',
    description: 'Кофе с молоком — тёплая пастель потемнее',
    previewBg: '#3e352e',
    previewAccent: '#d4a373',
  },
  {
    name: 'carbon-slate',
    label: 'CARBON SLATE',
    description: 'Карбоновый сланец — холодный серый с бирюзой',
    previewBg: '#1c2526',
    previewAccent: '#5eead4',
  },
  {
    name: 'desert-dusk',
    label: 'DESERT DUSK',
    description: 'Пустынный закат — медь и ржавчина на песке',
    previewBg: '#292018',
    previewAccent: '#c87941',
  },
];

const STORAGE_KEY = 'robot-detector-theme';
const DEFAULT_THEME: ThemeName = 'soft-gray';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  themeInfo: ThemeInfo;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  themeInfo: THEMES[0],
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);
  const [mounted, setMounted] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (saved && THEMES.some(t => t.name === saved)) {
      setThemeState(saved);
    }
    setMounted(true);
  }, []);

  // Apply theme class + dark/light mode to document
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    // Remove all theme classes
    THEMES.forEach(t => root.classList.remove(`theme-${t.name}`));
    // Add current theme class
    root.classList.add(`theme-${theme}`);
    // Toggle dark/light class for shadcn/ui compatibility
    const isDark = theme !== 'fog' && theme !== 'warm-sand' && theme !== 'dusty-rose' && theme !== 'muddy-latte';
    root.classList.toggle('dark', isDark);
  }, [theme, mounted]);

  const setTheme = useCallback((newTheme: ThemeName) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
    // Add transition class for smooth theme change
    document.documentElement.classList.add('theme-transition');
    setTimeout(() => {
      document.documentElement.classList.remove('theme-transition');
    }, 400);
  }, []);

  const themeInfo = THEMES.find(t => t.name === theme) || THEMES[0];

  // Prevent flash of wrong theme
  if (!mounted) {
    return (
      <div className={`theme-${DEFAULT_THEME}`} style={{ visibility: 'hidden' }}>
        {children}
      </div>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themeInfo }}>
      {children}
    </ThemeContext.Provider>
  );
}
