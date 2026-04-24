'use client';

import React, { useEffect, useState } from 'react';
import { Bot, Brain, Clock, HelpCircle, LayoutGrid, RotateCcw, WifiOff } from 'lucide-react';
import { useDashboardStore } from '@/lib/store';
import { useLayoutStore } from '@/lib/layout-store';
import { getMoscowTime } from '@/lib/helpers';
import { ThemeSwitcher } from './ThemeSwitcher';
import { AIHintModal } from '@/components/AIHintModal';

export function Header({ onHelpClick }: { onHelpClick: () => void }) {
  const connected = useDashboardStore((s) => s.connected);
  const dataSource = useDashboardStore((s) => s.dataSource);

  const isEditMode = useLayoutStore((s) => s.isEditMode);
  const toggleEditMode = useLayoutStore((s) => s.toggleEditMode);
  const resetLayout = useLayoutStore((s) => s.resetLayout);
  const [time, setTime] = React.useState(getMoscowTime());
  const [showAIHint, setShowAIHint] = useState(false);

  // F3 key handler — toggle AI hint modal
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        setShowAIHint((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setTime(getMoscowTime()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="relative z-[200] flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[var(--terminal-border)] bg-[var(--terminal-bg)]/90 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Bot className="w-5 h-5 text-[var(--terminal-positive)] shrink-0" />
        <div>
          <h1 className="text-xs sm:text-sm font-bold tracking-wider text-[var(--terminal-text)] font-mono whitespace-nowrap">
            {'\uD83E\uDD16'} ROBOT DETECTOR by SuperPUPS
          </h1>
          <p className="text-[9px] sm:text-[10px] text-[var(--terminal-muted)]">
            Детекция алгоритмической торговли в реальном времени
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-1.5 text-[9px] text-[var(--terminal-muted)] font-mono">
          <button onClick={onHelpClick} className="px-1.5 py-0.5 rounded bg-[var(--terminal-accent)]/10 text-[var(--terminal-accent)] border border-[var(--terminal-accent)]/30 hover:bg-[var(--terminal-accent)]/25 cursor-pointer transition-colors flex items-center gap-1">
            <HelpCircle className="w-3 h-3" />[F2] Справка
          </button>
          <button onClick={() => setShowAIHint(true)} className="px-1.5 py-0.5 rounded bg-[var(--terminal-warning)]/10 text-[var(--terminal-warning)] border border-[var(--terminal-warning)]/30 hover:bg-[var(--terminal-warning)]/25 cursor-pointer transition-colors flex items-center gap-1">
            <Brain className="w-3 h-3" />[F3] Нейро
          </button>
          <button onClick={toggleEditMode} className={`px-1.5 py-0.5 rounded border cursor-pointer transition-colors flex items-center gap-1 ${isEditMode ? 'bg-[var(--terminal-accent)]/30 text-[var(--terminal-accent)] border-[var(--terminal-accent)]' : 'bg-[var(--terminal-accent)]/10 text-[var(--terminal-accent)] border-[var(--terminal-accent)]/30 hover:bg-[var(--terminal-accent)]/25'}`}>
            <LayoutGrid className="w-3 h-3" />{isEditMode ? 'Редактор' : 'Layout'}
          </button>
          {isEditMode && (
            <button onClick={resetLayout} className="px-1.5 py-0.5 rounded bg-[var(--terminal-warning)]/10 text-[var(--terminal-warning)] border border-[var(--terminal-warning)]/30 hover:bg-[var(--terminal-warning)]/25 cursor-pointer transition-colors flex items-center gap-1">
              <RotateCcw className="w-3 h-3" />Сброс
            </button>
          )}
        </div>
        <ThemeSwitcher />
        <div className="flex items-center gap-2" suppressHydrationWarning>
          {connected ? (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[var(--terminal-positive)] animate-pulse" />
              <span className="text-[10px] font-bold text-[var(--terminal-positive)] font-mono">LIVE</span>
              <span className="text-[8px] text-[var(--terminal-muted)] font-mono ml-1">({dataSource === 'ws' ? 'WebSocket' : 'API'})</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <WifiOff className="w-3 h-3 text-[var(--terminal-negative)]" />
              <span className="text-[10px] font-bold text-[var(--terminal-negative)] font-mono">{dataSource === 'closed' ? 'БИРЖА ЗАКРЫТА' : 'ОЖИДАНИЕ ДАННЫХ'}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--terminal-muted)] font-mono">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-[var(--terminal-text)]" suppressHydrationWarning>{time} МСК</span>
        </div>
      </div>
      <AIHintModal open={showAIHint} onOpenChange={setShowAIHint} />
    </header>
  );
}
