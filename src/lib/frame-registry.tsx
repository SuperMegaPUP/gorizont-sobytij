// ─── Frame Registry — maps frame keys to components, titles, icons ───────────
'use client';

import React from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock,
  Database,
  History,
  ListOrdered,
  Newspaper,
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
