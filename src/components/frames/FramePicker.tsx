// ─── FramePicker — panel to add hidden frames back (edit mode) ───────────────
'use client';

import React from 'react';
import { Plus, LayoutGrid } from 'lucide-react';
import { useLayoutStore, ALL_FRAME_KEYS, DEFAULT_LAYOUT_ITEMS } from '@/lib/layout-store';
import type { FrameKey } from '@/lib/layout-store';
import { FRAME_REGISTRY } from '@/lib/frame-registry';

export function FramePicker() {
  const isEditMode = useLayoutStore((s) => s.isEditMode);
  const hiddenFrames = useLayoutStore((s) => s.hiddenFrames);
  const showFrame = useLayoutStore((s) => s.showFrame);

  if (!isEditMode || hiddenFrames.length === 0) return null;

  return (
    <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--terminal-accent)]/40 bg-[var(--terminal-surface)]/95 backdrop-blur-sm shadow-lg">
      <LayoutGrid className="w-3.5 h-3.5 text-[var(--terminal-accent)] shrink-0" />
      <span className="text-[9px] font-bold text-[var(--terminal-muted)] uppercase tracking-wide">Скрытые:</span>
      {hiddenFrames.map((key) => {
        const def = FRAME_REGISTRY.find((f) => f.key === key);
        if (!def) return null;
        const Icon = def.icon;
        return (
          <button
            key={key}
            onClick={() => showFrame(key)}
            className="flex items-center gap-1 px-2 py-1 text-[8px] font-bold rounded border border-[var(--terminal-accent)]/30 bg-[var(--terminal-accent)]/10 text-[var(--terminal-accent)] hover:bg-[var(--terminal-accent)]/25 transition-colors"
          >
            <Icon className="w-3 h-3" />
            {def.title}
            <Plus className="w-2.5 h-2.5" />
          </button>
        );
      })}
    </div>
  );
}
