// ─── Black Star Detector Framework ────────────────────────────────────────
// Типы и интерфейсы для 10 детекторов аномалий «Горизонт Событий»
// Каждый детектор — чистая функция: данные → DetectorResult

import type { OrderBookData, OrderBookSnapshot } from '../calculations/ofi';
import type { Trade, CumDeltaResult } from '../calculations/delta';
import type { Candle, VPINResult } from '../calculations/vpin';

// ─── Результат детектора ──────────────────────────────────────────────────

export type DetectorSignal = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface DetectorResult {
  /** Имя детектора (GRAVITON, DARKMATTER, ...) */
  detector: string;
  /** Описание на русском */
  description: string;
  /** Score 0..1 — сила сигнала (0 = нет аномалии, 1 = максимальная) */
  score: number;
  /** Уверенность в сигнале 0..1 */
  confidence: number;
  /** Направление сигнала */
  signal: DetectorSignal;
  /** Дополнительные метаданные (для аналитики) */
  metadata: Record<string, number | string | boolean>;
}

// ─── Входные данные для детекторов ────────────────────────────────────────

export interface DetectorInput {
  ticker: string;

  // Стакан
  orderbook: OrderBookData;
  orderbookPrev?: OrderBookSnapshot;

  // Сделки
  trades: Trade[];
  recentTrades: Trade[];  // Последние N сделок (для быстрого анализа)

  // Индикаторы (предрассчитанные)
  ofi: number;             // Простой OFI
  weightedOFI: number;     // Взвешенный OFI
  cumDelta: CumDeltaResult;
  vpin: VPINResult;

  // Ценовой ряд
  prices: number[];        // Последние N цен (закрытия)
  volumes: number[];       // Последние N объёмов
  candles: Candle[];       // Последние свечи

  // Кросс-тикер данные (для ENTANGLE)
  crossTickers?: Record<string, {
    priceChange: number;   // % изменение за период
    ofi: number;
  }>;

  // Волатильность
  rvi?: number;            // Russian Volatility Index
}

// ─── Интерфейс детектора ──────────────────────────────────────────────────

export interface IDetector {
  name: string;
  description: string;
  detect(input: DetectorInput): DetectorResult;
}

// ─── 10 имён детекторов ──────────────────────────────────────────────────

export const DETECTOR_NAMES = [
  'GRAVITON',
  'DARKMATTER',
  'ACCRETOR',
  'DECOHERENCE',
  'HAWKING',
  'PREDATOR',
  'CIPHER',
  'ENTANGLE',
  'WAVEFUNCTION',
  'ATTRACTOR',
] as const;

export type DetectorName = typeof DETECTOR_NAMES[number];
