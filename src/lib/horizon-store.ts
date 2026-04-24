// ─── Horizon Store — Zustand ──────────────────────────────────────────────
// Состояние вкладки «Горизонт событий»

import { create } from 'zustand';
import type { OrderBookData } from './horizon/calculations/ofi';
import type { CumDeltaResult } from './horizon/calculations/delta';
import type { VPINResult } from './horizon/calculations/vpin';

export interface HorizonObservation {
  id: string;
  timestamp: number;
  text: string;
  bsci: number;
  model: string;
}

export interface DetectorScore {
  name: string;
  score: number; // 0..1
  timestamp: number;
}

export interface HorizonState {
  /** Активный тикер для анализа */
  activeTicker: string;
  /**OFI значение */
  ofi: number;
  weightedOFI: number;
  /** Cumulative Delta */
  cumDelta: CumDeltaResult;
  /** VPIN */
  vpin: VPINResult;
  /** Стакан */
  orderbook: OrderBookData | null;
  /** BSCI Composite */
  bsci: number;
  /** Detector scores */
  detectors: DetectorScore[];
  /** AI наблюдения */
  observations: HorizonObservation[];
  /** Загрузка */
  loading: boolean;
  /** Ошибка */
  error: string | null;

  // Actions
  setActiveTicker: (ticker: string) => void;
  setOFI: (ofi: number, weighted: number) => void;
  setCumDelta: (delta: CumDeltaResult) => void;
  setVPIN: (vpin: VPINResult) => void;
  setOrderbook: (ob: OrderBookData | null) => void;
  setBSCI: (bsci: number) => void;
  setDetectors: (detectors: DetectorScore[]) => void;
  addObservation: (obs: HorizonObservation) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const EMPTY_CUM_DELTA: CumDeltaResult = {
  delta: 0,
  buyVolume: 0,
  sellVolume: 0,
  totalVolume: 0,
};

const EMPTY_VPIN: VPINResult = {
  vpin: 0,
  toxicity: 'low',
  buckets: 0,
  avgBuyVolume: 0,
  avgSellVolume: 0,
};

const initialState = {
  activeTicker: 'SBER',
  ofi: 0,
  weightedOFI: 0,
  cumDelta: EMPTY_CUM_DELTA,
  vpin: EMPTY_VPIN,
  orderbook: null,
  bsci: 0,
  detectors: [],
  observations: [],
  loading: false,
  error: null,
};

export const useHorizonStore = create<HorizonState>((set) => ({
  ...initialState,

  setActiveTicker: (ticker) => set({ activeTicker: ticker }),
  setOFI: (ofi, weighted) => set({ ofi, weightedOFI: weighted }),
  setCumDelta: (delta) => set({ cumDelta: delta }),
  setVPIN: (vpin) => set({ vpin }),
  setOrderbook: (ob) => set({ orderbook: ob }),
  setBSCI: (bsci) => set({ bsci }),
  setDetectors: (detectors) => set({ detectors }),
  addObservation: (obs) =>
    set((state) => ({
      observations: [obs, ...state.observations].slice(0, 100), // макс 100
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));
