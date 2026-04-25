// ─── Frame Registry — maps frame keys to components, titles, icons ───────────
'use client';

import React from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Clock,
  Database,
  Grid3x3,
  History,
  ListOrdered,
  Newspaper,
  Radar,
  Radio,
  Shield,
  TrendingUp,
  Zap,
  ScanSearch,
  UserSearch,
} from 'lucide-react';
import type { FrameKey } from './layout-store';

import { InstrumentsPanel } from '@/components/frames/InstrumentsPanel';
import { TickersFrame } from '@/components/frames/TickersFrame';
import { DurationFrame } from '@/components/frames/DurationFrame';
import { OrderbookScannerFrame } from '@/components/frames/OrderbookScannerFrame';
import { DynamicsFrame } from '@/components/frames/DynamicsFrame';
import { SignalsFrame } from '@/components/frames/SignalsFrame';
import { InstitutionalLocatorFrame } from '@/components/frames/InstitutionalLocatorFrame';
import { AnomaliesFrame } from '@/components/frames/AnomaliesFrame';
import { FearGreedFrame } from '@/components/frames/FearGreedFrame';
import { HourlyActivityFrame } from '@/components/frames/HourlyActivityFrame';
import { SmartMoneyFrame } from '@/components/frames/SmartMoneyFrame';
import { OiDynamicsFrame } from '@/components/frames/OiDynamicsFrame';
import { FuturesOIFrame } from '@/components/frames/FuturesOIFrame';
import { Top5Frame } from '@/components/frames/Top5Frame';
import { StrategiesFrame } from '@/components/frames/StrategiesFrame';
import { RobotHistoryFrame } from '@/components/frames/RobotHistoryFrame';
import { NewsFrame } from '@/components/frames/NewsFrame';
import { HorizonScannerFrame } from '@/components/horizon/frames/ScannerFrame';
import { HorizonRadarFrame } from '@/components/horizon/frames/RadarFrame';
import { HorizonAIObserverFrame } from '@/components/horizon/frames/AIObserverFrame';
import { HorizonHeatmapFrame } from '@/components/horizon/frames/HeatmapFrame';
import { SignalsFrame as HorizonSignalsFrame } from '@/components/horizon/frames/SignalsFrame';

// ─── Frame definition ────────────────────────────────────────────────────────
export interface FrameDefinition {
  key: FrameKey;
  title: string;
  icon: React.ElementType;
  component: React.ComponentType;
  removable: boolean; // some frames (instruments) should not be easily removed
}

// ─── Registry ────────────────────────────────────────────────────────────────
// Titles match the internal frame headings — no duplication
export const FRAME_REGISTRY: FrameDefinition[] = [
  {
    key: 'instruments',
    title: 'ТОП-100 ИНСТРУМЕНТЫ',
    icon: ListOrdered,
    component: InstrumentsPanel,
    removable: true,
  },
  {
    key: 'tickers',
    title: 'ТИКЕРЫ: Давление (30 мин)',
    icon: Radio,
    component: TickersFrame,
    removable: true,
  },
  {
    key: 'duration',
    title: 'АКТИВНОСТЬ: Роботы по тикерам',
    icon: Clock,
    component: DurationFrame,
    removable: true,
  },
  {
    key: 'orderbook',
    title: 'СТАКАН-СКАНЕР: Стены',
    icon: ScanSearch,
    component: OrderbookScannerFrame,
    removable: true,
  },
  {
    key: 'dynamics',
    title: 'ДИНАМИКА: Волна л/ш',
    icon: Activity,
    component: DynamicsFrame,
    removable: true,
  },
  {
    key: 'signals',
    title: 'СИГНАЛЫ: Концентрация силы',
    icon: BarChart3,
    component: SignalsFrame,
    removable: true,
  },
  {
    key: 'institutional',
    title: 'ЛОКАТОР КРУПНЯКА: Накопления',
    icon: UserSearch,
    component: InstitutionalLocatorFrame,
    removable: true,
  },
  {
    key: 'anomalies',
    title: 'АНОМАЛИИ',
    icon: AlertTriangle,
    component: AnomaliesFrame,
    removable: true,
  },
  {
    key: 'fearGreed',
    title: 'ИНДЕКС СТРАХА И ЖАДНОСТИ',
    icon: Shield,
    component: FearGreedFrame,
    removable: true,
  },
  {
    key: 'hourlyActivity',
    title: 'АКТИВНОСТЬ ПО ЧАСАМ',
    icon: Clock,
    component: HourlyActivityFrame,
    removable: true,
  },
  {
    key: 'smartMoney',
    title: 'SMART MONEY INDEX',
    icon: TrendingUp,
    component: SmartMoneyFrame,
    removable: true,
  },
  {
    key: 'oiDynamics',
    title: 'OI ДИНАМИКА',
    icon: Activity,
    component: OiDynamicsFrame,
    removable: true,
  },
  {
    key: 'futuresOI',
    title: 'ФЬЮЧЕРСЫ: OI',
    icon: Database,
    component: FuturesOIFrame,
    removable: true,
  },
  {
    key: 'top5',
    title: 'ТОП-5 ИНСТРУМЕНТОВ',
    icon: Zap,
    component: Top5Frame,
    removable: true,
  },
  {
    key: 'strategies',
    title: 'СТРАТЕГИИ: Распределение',
    icon: Activity,
    component: StrategiesFrame,
    removable: true,
  },
  {
    key: 'robotHistory',
    title: 'ИСТОРИЯ: Роботы',
    icon: History,
    component: RobotHistoryFrame,
    removable: true,
  },
  {
    key: 'news',
    title: 'НОВОСТИ РЫНКА',
    icon: Newspaper,
    component: NewsFrame,
    removable: true,
  },
  {
    key: 'horizonScanner',
    title: 'СКАНЕР: Чёрные звёзды',
    icon: ScanSearch,
    component: HorizonScannerFrame,
    removable: true,
  },
  {
    key: 'horizonRadar',
    title: 'РАДАР: Карта аномалий',
    icon: Radar,
    component: HorizonRadarFrame,
    removable: true,
  },
  {
    key: 'horizonObserver',
    title: 'AI НАБЛЮДАТЕЛЬ',
    icon: Bot,
    component: HorizonAIObserverFrame,
    removable: true,
  },
  {
    key: 'horizonHeatmap',
    title: 'ТЕПЛОВАЯ КАРТА BSCI',
    icon: Grid3x3,
    component: HorizonHeatmapFrame,
    removable: true,
  },
  {
    key: 'horizonSignals',
    title: 'СИГНАЛЫ: Торговые рекомендации',
    icon: Zap,
    component: HorizonSignalsFrame,
    removable: true,
  },
];

// ─── Lookup helpers ──────────────────────────────────────────────────────────
const REGISTRY_MAP = new Map(FRAME_REGISTRY.map((f) => [f.key, f]));

export function getFrameDef(key: FrameKey): FrameDefinition | undefined {
  return REGISTRY_MAP.get(key);
}

export function getFrameComponent(key: FrameKey): React.ComponentType | null {
  return REGISTRY_MAP.get(key)?.component ?? null;
}

export function getFrameTitle(key: FrameKey): string {
  return REGISTRY_MAP.get(key)?.title ?? key;
}
