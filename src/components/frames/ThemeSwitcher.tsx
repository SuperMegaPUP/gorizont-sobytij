'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useTheme, THEMES, ThemeName } from '@/lib/theme-context';

export function ThemeSwitcher() {
  const { theme, setTheme, themeInfo } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative z-[300]">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-colors"
        style={{
          background: 'var(--t-surface)',
          border: '1px solid var(--t-border)',
          color: 'var(--t-text-dim)',
        }}
        title={themeInfo.description}
      >
        {/* Theme preview dot */}
        <span
          className="inline-block w-2.5 h-2.5 rounded-full border"
          style={{
            background: themeInfo.previewAccent,
            borderColor: 'var(--t-border)',
          }}
        />
        <span>{themeInfo.label}</span>
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-[500] rounded-lg overflow-y-auto shadow-xl"
          style={{
            background: 'var(--t-surface)',
            border: '1px solid var(--t-border)',
            minWidth: '200px',
            maxHeight: '360px',
          }}
        >
          {THEMES.map(t => (
            <button
              key={t.name}
              onClick={() => { setTheme(t.name); setOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
              style={{
                background: theme === t.name ? 'var(--t-surface-hover)' : 'transparent',
                color: theme === t.name ? 'var(--t-text)' : 'var(--t-text-dim)',
              }}
              onMouseEnter={e => {
                if (theme !== t.name) (e.currentTarget.style.background = 'var(--t-surface-hover)');
              }}
              onMouseLeave={e => {
                if (theme !== t.name) (e.currentTarget.style.background = 'transparent');
              }}
            >
              {/* Mini theme preview */}
              <span
                className="flex-shrink-0 w-7 h-5 rounded border flex items-center justify-center"
                style={{
                  background: t.previewBg,
                  borderColor: 'var(--t-border)',
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: t.previewAccent }}
                />
              </span>
              <div className="flex flex-col">
                <span className="text-[11px] font-mono font-bold tracking-wider">{t.label}</span>
                <span className="text-[9px]" style={{ color: 'var(--t-muted)' }}>{t.description}</span>
              </div>
              {theme === t.name && (
                <svg className="w-3.5 h-3.5 ml-auto flex-shrink-0" style={{ color: 'var(--t-positive)' }} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
