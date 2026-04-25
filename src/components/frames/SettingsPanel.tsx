'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Settings, X, RotateCcw, Minus, Plus, Type, Check } from 'lucide-react';
import {
  useSettingsStore,
  FONT_OPTIONS,
  FONT_CATEGORY_LABELS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_STEP,
  type FontOption,
} from '@/lib/settings-store';

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontFamily = useSettingsStore((s) => s.setFontFamily);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);

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

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // Group fonts by category
  const categories = Object.keys(FONT_CATEGORY_LABELS) as FontOption['category'][];
  const isDefault = fontFamily === FONT_OPTIONS[0].family && fontSize === FONT_SIZE_DEFAULT;

  const currentFontLabel = FONT_OPTIONS.find((f) => f.family === fontFamily)?.label ?? 'Geist Sans';

  return (
    <div ref={ref} className="relative z-[300]">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer"
        style={{
          background: 'var(--t-surface)',
          border: '1px solid var(--t-border)',
          color: 'var(--t-text-dim)',
        }}
        title="Настройки шрифта"
      >
        <Settings className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="hidden sm:inline">{currentFontLabel}</span>
        <span className="hidden sm:inline" style={{ color: 'var(--t-muted)' }}>{fontSize}px</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-[500] rounded-lg shadow-xl overflow-hidden"
          style={{
            background: 'var(--t-surface)',
            border: '1px solid var(--t-border)',
            minWidth: '280px',
            maxWidth: '320px',
          }}
        >
          {/* ── Header ── */}
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: 'var(--t-border)' }}
          >
            <div className="flex items-center gap-2">
              <Type className="w-3.5 h-3.5" style={{ color: 'var(--t-accent)' }} />
              <span className="text-[11px] font-mono font-bold tracking-wider" style={{ color: 'var(--t-text)' }}>
                НАСТРОЙКИ ШРИФТА
              </span>
            </div>
            <div className="flex items-center gap-1">
              {!isDefault && (
                <button
                  onClick={resetToDefaults}
                  className="p-1 rounded transition-colors cursor-pointer"
                  style={{ color: 'var(--t-warning)' }}
                  title="Сбросить к умолчаниям"
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--t-surface-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded transition-colors cursor-pointer"
                style={{ color: 'var(--t-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--t-surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* ── Font Size ── */}
          <div className="px-3 py-2.5 border-b" style={{ borderColor: 'var(--t-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--t-muted)' }}>
                Размер шрифта
              </span>
              <span
                className="text-[11px] font-mono font-bold"
                style={{ color: 'var(--t-accent)' }}
              >
                {fontSize}px
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFontSize(fontSize - FONT_SIZE_STEP)}
                disabled={fontSize <= FONT_SIZE_MIN}
                className="p-1 rounded transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: 'var(--t-card)',
                  border: '1px solid var(--t-border)',
                  color: 'var(--t-text-dim)',
                }}
              >
                <Minus className="w-3 h-3" />
              </button>
              <div className="flex-1 relative">
                <input
                  type="range"
                  min={FONT_SIZE_MIN}
                  max={FONT_SIZE_MAX}
                  step={FONT_SIZE_STEP}
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, var(--t-accent) ${((fontSize - FONT_SIZE_MIN) / (FONT_SIZE_MAX - FONT_SIZE_MIN)) * 100}%, var(--t-border) ${((fontSize - FONT_SIZE_MIN) / (FONT_SIZE_MAX - FONT_SIZE_MIN)) * 100}%)`,
                    accentColor: 'var(--t-accent)',
                  }}
                />
              </div>
              <button
                onClick={() => setFontSize(fontSize + FONT_SIZE_STEP)}
                disabled={fontSize >= FONT_SIZE_MAX}
                className="p-1 rounded transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: 'var(--t-card)',
                  border: '1px solid var(--t-border)',
                  color: 'var(--t-text-dim)',
                }}
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[8px] font-mono" style={{ color: 'var(--t-muted)' }}>{FONT_SIZE_MIN}px</span>
              <span className="text-[8px] font-mono" style={{ color: 'var(--t-muted)' }}>по умолч. {FONT_SIZE_DEFAULT}px</span>
              <span className="text-[8px] font-mono" style={{ color: 'var(--t-muted)' }}>{FONT_SIZE_MAX}px</span>
            </div>
          </div>

          {/* ── Font Family ── */}
          <div className="py-1.5 max-h-[300px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {categories.map((cat) => {
              const fonts = FONT_OPTIONS.filter((f) => f.category === cat);
              if (fonts.length === 0) return null;
              return (
                <div key={cat}>
                  {/* Category label */}
                  <div
                    className="px-3 py-1.5 text-[9px] font-mono uppercase tracking-widest"
                    style={{ color: 'var(--t-muted)' }}
                  >
                    {FONT_CATEGORY_LABELS[cat]}
                  </div>
                  {/* Font options */}
                  {fonts.map((font) => {
                    const isActive = fontFamily === font.family;
                    return (
                      <button
                        key={font.family}
                        onClick={() => setFontFamily(font.family)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer"
                        style={{
                          background: isActive ? 'var(--t-surface-hover)' : 'transparent',
                          color: isActive ? 'var(--t-text)' : 'var(--t-text-dim)',
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) e.currentTarget.style.background = 'var(--t-surface-hover)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        {/* Check mark */}
                        <span className="w-3.5 flex-shrink-0 flex items-center justify-center">
                          {isActive ? (
                            <Check className="w-3 h-3" style={{ color: 'var(--t-positive)' }} />
                          ) : null}
                        </span>
                        {/* Font preview */}
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-[11px] font-bold" style={{ fontFamily: font.family }}>
                            {font.label}
                          </span>
                          <span
                            className="text-[10px] truncate"
                            style={{ fontFamily: font.family, color: 'var(--t-muted)' }}
                          >
                            {font.preview} — Московской биржи
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* ── Preview ── */}
          <div
            className="px-3 py-2.5 border-t"
            style={{ borderColor: 'var(--t-border)', background: 'var(--t-card)' }}
          >
            <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: 'var(--t-muted)' }}>
              Предпросмотр
            </span>
            <p
              className="mt-1 leading-snug"
              style={{
                fontFamily: fontFamily,
                fontSize: `${fontSize}px`,
                color: 'var(--t-text)',
              }}
            >
              Робот-детектор: алгоритмическая торговля на Московской бирже. BSCI = 0.73
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
