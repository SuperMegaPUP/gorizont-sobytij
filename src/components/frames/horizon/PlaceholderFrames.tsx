// ─── Placeholder components for Phase 5 Horizon frames ────────────────────
// These will be replaced with full implementations in Phase 5.2

'use client';

import React from 'react';

function PlaceholderFrame({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full w-full bg-muted/30 rounded-md border border-dashed border-muted-foreground/20">
      <span className="text-sm text-muted-foreground">{title} — загрузка...</span>
    </div>
  );
}

export function HorizonScannerFrame() {
  return <PlaceholderFrame title="СКАНЕР: Чёрные звёзды" />;
}

export function HorizonRadarFrame() {
  return <PlaceholderFrame title="РАДАР: Карта аномалий" />;
}

export function HorizonObserverFrame() {
  return <PlaceholderFrame title="AI НАБЛЮДАТЕЛЬ" />;
}

export function HorizonHeatmapFrame() {
  return <PlaceholderFrame title="ТЕПЛОВАЯ КАРТА BSCI" />;
}
