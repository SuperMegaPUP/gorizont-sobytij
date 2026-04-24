// ─── Horizon Store — Zustand ──────────────────────────────────────────────
// Состояние вкладки «Горизонт событий»
// Expanded for Phase 5: Scanner, Radar, Heatmap, Selection

import { create } from 'zustand';
import type { OrderBookData } from './horizon/calculations/ofi';
import type { CumDeltaResult } from './horizon/calculations/delta';
import type { VPINResult } from './horizon/calculations/vpin';

// ─── Original Types ────────────────────────────────────────────────────────

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

// ─── New Phase 5 Types ─────────────────────────────────────────────────────

export interface ScannerTicker {
  ticker: string;
  name: string;
  bsci: number;
  alertLevel: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  detectorScores: Record<string, number>;
  keySignal: string;
  action: 'WATCH' | 'ALERT' | 'URGENT';
  quickStatus: string;
  vpin: number;
  cumDelta: number;
  turnover: number;
}

export interface RadarDot {
  ticker: string;
  bsci: number;
  alertLevel: string;
  direction: string;
  turnover: number;
  dotSize: number;
  cumDelta: number;
  vpin: number;
}

export interface HeatmapCell {
  ticker: string;
  hour: number;
  avgBsci: number;
  maxBsci: number;
  alertLevel: string;
  count: number;
}

// ─── State Interface ───────────────────────────────────────────────────────

export interface HorizonState {
  /** Активный тикер для анализа */
  activeTicker: string;
  /** OFI значение */
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

  // ── Phase 5: Scanner ──
  scannerData: ScannerTicker[];
  scannerFilters: { alertLevel: string; direction: string; layer: string };
  scannerSortBy: 'bsci' | 'vpin' | 'delta' | 'turnover';

  // ── Phase 5: Radar ──
  radarData: RadarDot[];

  // ── Phase 5: Heatmap ──
  heatmapData: HeatmapCell[];

  // ── Phase 5: Selection ──
  selectedTicker: string | null;
  selectedTimeSlice: { ticker: string; hour: number } | null;

  // ── Phase 5: Ticker detail (for modal) ──
  tickerDetail: ScannerTicker | null;

  // ── Phase 5: Last update timestamps ──
  lastScannerUpdate: number | null;
  lastObservationUpdate: number | null;
  lastHeatmapUpdate: number | null;

  // ── Original Actions ──
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

  // ── Phase 5: New Actions ──
  fetchScanner: () => Promise<void>;
  fetchRadar: () => Promise<void>;
  fetchHeatmap: (hours?: number) => Promise<void>;
  fetchTickerDetail: (ticker: string) => Promise<void>;
  fetchObservations: (ticker?: string) => Promise<void>;
  setScannerFilters: (filters: Partial<HorizonState['scannerFilters']>) => void;
  setScannerSortBy: (sortBy: HorizonState['scannerSortBy']) => void;
  selectTicker: (ticker: string | null) => void;
  selectTimeSlice: (slice: { ticker: string; hour: number } | null) => void;
}

// ─── Empty Defaults ────────────────────────────────────────────────────────

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

// ─── Initial State ─────────────────────────────────────────────────────────

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

  // Phase 5
  scannerData: [],
  scannerFilters: { alertLevel: '', direction: '', layer: '' },
  scannerSortBy: 'bsci' as const,
  radarData: [],
  heatmapData: [],
  selectedTicker: null,
  selectedTimeSlice: null,
  tickerDetail: null,
  lastScannerUpdate: null,
  lastObservationUpdate: null,
  lastHeatmapUpdate: null,
};

// ─── Store ─────────────────────────────────────────────────────────────────

export const useHorizonStore = create<HorizonState>((set, get) => ({
  ...initialState,

  // ── Original Actions ──────────────────────────────────────────────────

  setActiveTicker: (ticker) => set({ activeTicker: ticker }),
  setOFI: (ofi, weighted) => set({ ofi, weightedOFI: weighted }),
  setCumDelta: (delta) => set({ cumDelta: delta }),
  setVPIN: (vpin) => set({ vpin }),
  setOrderbook: (ob) => set({ orderbook: ob }),
  setBSCI: (bsci) => set({ bsci }),
  setDetectors: (detectors) => set({ detectors }),
  addObservation: (obs) =>
    set((state) => ({
      observations: [obs, ...state.observations].slice(0, 100),
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),

  // ── Phase 5: Fetch Scanner ────────────────────────────────────────────

  fetchScanner: async () => {
    set({ loading: true, error: null });
    try {
      // 1. Try GET first (reads from Redis cache)
      let res = await fetch('/api/horizon/scanner');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let json = await res.json();

      // 2. If no cached data, trigger a POST scan
      if (!json.data || json.data.length === 0) {
        console.log('[HorizonStore] No cached scanner data, triggering POST scan...');
        const scanRes = await fetch('/api/horizon/scan', { method: 'POST' });
        if (scanRes.ok) {
          json = await scanRes.json();
        }
      }

      set({
        scannerData: json.data || [],
        lastScannerUpdate: Date.now(),
        loading: false,
      });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  // ── Phase 5: Fetch Radar ──────────────────────────────────────────────

  fetchRadar: async () => {
    try {
      let res = await fetch('/api/horizon/radar');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let json = await res.json();

      // If no radar data, trigger scan first then retry
      if (!json.data || json.data.length === 0) {
        console.log('[HorizonStore] No radar data, triggering scan...');
        await fetch('/api/horizon/scan', { method: 'POST' });
        res = await fetch('/api/horizon/radar');
        if (res.ok) json = await res.json();
      }

      set({ radarData: json.data || [] });
    } catch (error: any) {
      console.warn('[HorizonStore] fetchRadar error:', error.message);
    }
  },

  // ── Phase 5: Fetch Heatmap ────────────────────────────────────────────

  fetchHeatmap: async (hours?: number) => {
    try {
      const url = hours
        ? `/api/horizon/heatmap?hours=${hours}`
        : '/api/horizon/heatmap';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      set({
        heatmapData: json.data || [],
        lastHeatmapUpdate: Date.now(),
      });
    } catch (error: any) {
      console.warn('[HorizonStore] fetchHeatmap error:', error.message);
    }
  },

  // ── Phase 5: Fetch Ticker Detail ──────────────────────────────────────

  fetchTickerDetail: async (ticker: string) => {
    try {
      // Find in scanner data first
      const { scannerData } = get();
      const found = scannerData.find((d) => d.ticker === ticker);
      if (found) {
        set({ tickerDetail: found });
        return;
      }
      // Fallback: fetch from scanner API
      const res = await fetch('/api/horizon/scanner');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const detail = (json.data || []).find(
        (d: ScannerTicker) => d.ticker === ticker,
      );
      set({ tickerDetail: detail || null });
    } catch (error: any) {
      console.warn('[HorizonStore] fetchTickerDetail error:', error.message);
    }
  },

  // ── Phase 5: Fetch Observations ───────────────────────────────────────

  fetchObservations: async (ticker?: string) => {
    try {
      const t = ticker || get().activeTicker;
      const res = await fetch(`/api/horizon/observations?ticker=${t}&limit=20`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const obs: HorizonObservation[] = (json.observations || []).map(
        (o: any) => ({
          id: o.id,
          timestamp: new Date(o.timestamp).getTime(),
          text: o.aiComment || `BSCI ${o.bsci} (${o.alertLevel})`,
          bsci: o.bsci,
          model: 'horizon',
        }),
      );
      set({
        observations: obs,
        lastObservationUpdate: Date.now(),
      });
    } catch (error: any) {
      console.warn('[HorizonStore] fetchObservations error:', error.message);
    }
  },

  // ── Phase 5: Set Scanner Filters ──────────────────────────────────────

  setScannerFilters: (filters) =>
    set((state) => ({
      scannerFilters: { ...state.scannerFilters, ...filters },
    })),

  // ── Phase 5: Set Scanner Sort ─────────────────────────────────────────

  setScannerSortBy: (sortBy) => set({ scannerSortBy: sortBy }),

  // ── Phase 5: Select Ticker ────────────────────────────────────────────

  selectTicker: (ticker) => set({ selectedTicker: ticker }),

  // ── Phase 5: Select Time Slice ────────────────────────────────────────

  selectTimeSlice: (slice) => set({ selectedTimeSlice: slice }),
}));
