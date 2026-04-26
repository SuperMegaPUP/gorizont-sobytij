// ─── Horizon Store — Zustand ──────────────────────────────────────────────
// Состояние вкладки «Горизонт событий»
// Expanded for Phase 5: Scanner, Radar, Heatmap, Selection, TOP 100
//
// v4.1.5: Added exponential backoff + circuit breaker for API polling
// Prevents ERR_CONNECTION_RESET avalanche on Vercel serverless

import { create } from 'zustand';
import type { OrderBookData } from './horizon/calculations/ofi';
import type { CumDeltaResult } from './horizon/calculations/delta';
import type { VPINResult } from './horizon/calculations/vpin';

// ─── API Backoff Manager ──────────────────────────────────────────────────
// Tracks consecutive errors per endpoint and applies exponential backoff

const backoffState: Record<string, { errors: number; backoffMs: number; blockedUntil: number }> = {};

function getBackoff(endpoint: string): { errors: number; backoffMs: number; blockedUntil: number } {
  if (!backoffState[endpoint]) {
    backoffState[endpoint] = { errors: 0, backoffMs: 5000, blockedUntil: 0 };
  }
  return backoffState[endpoint];
}

function recordSuccess(endpoint: string) {
  backoffState[endpoint] = { errors: 0, backoffMs: 5000, blockedUntil: 0 };
}

function recordError(endpoint: string) {
  const state = getBackoff(endpoint);
  state.errors++;
  state.backoffMs = Math.min(state.backoffMs * 2, 60000); // max 60s backoff
  if (state.errors >= 3) {
    // Circuit breaker: block for 2 minutes
    state.blockedUntil = Date.now() + 120000;
  }
}

function isBlocked(endpoint: string): boolean {
  const state = getBackoff(endpoint);
  if (state.blockedUntil > Date.now()) return true;
  if (state.blockedUntil > 0 && state.blockedUntil <= Date.now()) {
    // Block expired, reset
    state.blockedUntil = 0;
    state.errors = 0;
    state.backoffMs = 5000;
  }
  return false;
}

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

// ─── Phase 5 Types ─────────────────────────────────────────────────────────

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
  ofi: number;               // Order Flow Imbalance [-1, 1]
  realtimeOFI?: number;      // Real-time OFI (Cont et al. 2014)
  turnover: number;
  moexTurnover?: number;  // VALTODAY от MOEX
  type: 'FUTURE' | 'STOCK';
  taContext?: {
    signal: 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';
    divergence: boolean;
    divergenceNote: string;
    bsciDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    taDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    convergenceStrength: number;
    indicators: {
      rsi: number;
      rsiZone: string;
      cmf: number;
      cmfZone: string;
      crsi: number;
      crsiZone: string;
      atr: number;
      atrPercentile: number;
      atrZone: string;
      vwap: number;
      vwapDeviation: number;
      vwapZone: string;
    };
  };
  // Convergence Score 0-10
  convergenceScore?: {
    score: number;
    details: Array<{
      indicator: string;
      points: number;
      maxPoints: number;
      alignment: 'ALIGNED' | 'NEUTRAL' | 'DIVERGENT';
      note: string;
    }>;
    divergenceBonus: boolean;
    atrBonus: boolean;
    robotBonus: boolean;
    summary: string;
  };
  // Level-0 Internal Consistency
  consistencyCheck?: {
    hallucinations: string[];
    hasHallucination: boolean;
  };
  // Robot Context (Спринт 3)
  robotContext?: {
    ticker: string;
    robotVolumePct: number;
    robotPatterns: Array<{
      pattern: string;
      patternRu: string;
      level: string;
      count: number;
      totalLots: number;
      direction: string;
      avgConfidence: number;
    }>;
    robotImbalance: number;
    avgRobotOrderSize: number;
    avgHumanOrderSize: number;
    wallScore: number;
    accumScore: number;
    cancelRatio: number;
    disb: number;
    accumDirection: string;
    hasSpoofing: boolean;
    confirmation: number;
    matchedPattern: string;
    matchedDetector: string;
    burstCount: number;
    burstTotalLots: number;
    source: string;
  };
}

export interface RadarDot {
  ticker: string;
  bsci: number;
  alertLevel: string;
  direction: string;
  turnover: number;
  moexTurnover?: number;
  dotSize: number;
  cumDelta: number;
  vpin: number;
  type: 'FUTURE' | 'STOCK';
}

export interface HeatmapCell {
  ticker: string;
  hour: number;
  slotKey?: string;     // "24/04 10" — unique per date+hour
  slotIndex?: number;   // 0-47 position in 48h timeline
  avgBsci: number;
  maxBsci: number;
  alertLevel: string;
  count: number;
}

// ─── TOP-100 Types ─────────────────────────────────────────────────────────

export type ScannerMode = 'core' | 'top100';

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

  // ── TOP-100 ──
  scannerMode: ScannerMode;
  top100Data: ScannerTicker[];
  top100Loading: boolean;
  top100Error: string | null;
  lastTop100Update: number | null;
  marketClosed: boolean;
  sessionInfo: string;

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

  // ── TOP-100 Actions ──
  setScannerMode: (mode: ScannerMode) => void;
  fetchTop100: () => Promise<void>;
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

  // TOP-100
  scannerMode: 'core' as ScannerMode,
  top100Data: [],
  top100Loading: false,
  top100Error: null,
  lastTop100Update: null,
  marketClosed: false,
  sessionInfo: '',
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
    if (isBlocked('scanner')) return;
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

      recordSuccess('scanner');
      set({
        scannerData: json.data || [],
        lastScannerUpdate: Date.now(),
        loading: false,
        marketClosed: json.marketClosed || false,
        sessionInfo: json.sessionInfo || '',
      });
    } catch (error: any) {
      recordError('scanner');
      set({ error: error.message, loading: false });
    }
  },

  // ── Phase 5: Fetch Radar ──────────────────────────────────────────────

  fetchRadar: async () => {
    if (isBlocked('radar')) return;
    try {
      // Always fetch ALL data (core + top100 combined) for radar
      const res = await fetch('/api/horizon/radar?source=all');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      recordSuccess('radar');
      set({ radarData: json.data || [] });
    } catch (error: any) {
      recordError('radar');
      console.warn('[HorizonStore] fetchRadar error:', error.message);
    }
  },

  // ── Phase 5: Fetch Heatmap ────────────────────────────────────────────

  fetchHeatmap: async (hours?: number) => {
    if (isBlocked('heatmap')) return;
    try {
      const url = hours
        ? `/api/horizon/heatmap?hours=${hours}`
        : '/api/horizon/heatmap';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      recordSuccess('heatmap');
      set({
        heatmapData: json.data || [],
        lastHeatmapUpdate: Date.now(),
      });
    } catch (error: any) {
      recordError('heatmap');
      console.warn('[HorizonStore] fetchHeatmap error:', error.message);
    }
  },

  // ── Phase 5: Fetch Ticker Detail ──────────────────────────────────────

  fetchTickerDetail: async (ticker: string) => {
    try {
      // Find in scanner data or top100 data first
      const { scannerData, top100Data } = get();
      const found = scannerData.find((d) => d.ticker === ticker) ||
        top100Data.find((d) => d.ticker === ticker);
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
    if (isBlocked('observations')) return;
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
      recordSuccess('observations');
      set({
        observations: obs,
        lastObservationUpdate: Date.now(),
      });
    } catch (error: any) {
      recordError('observations');
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

  // ── TOP-100 Actions ────────────────────────────────────────────────────

  setScannerMode: (mode) => set({ scannerMode: mode }),

  fetchTop100: async () => {
    if (isBlocked('top100')) { set({ top100Loading: false }); return; }
    set({ top100Loading: true, top100Error: null });
    try {
      // 1. Try GET first (reads from Redis cache)
      let res = await fetch('/api/horizon/top100');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let json = await res.json();

      // 2. If no cached data (scanning in background), wait and retry
      if (!json.data || json.data.length === 0) {
        // If scan was triggered in background, wait 30s and retry
        if (json.scanning) {
          console.log('[HorizonStore] TOP-100 scan started in background, waiting 30s...');
          await new Promise(resolve => setTimeout(resolve, 30000));
          res = await fetch('/api/horizon/top100');
          if (res.ok) json = await res.json();
        }

        // If still no data, try POST directly
        if (!json.data || json.data.length === 0) {
          console.log('[HorizonStore] No cached TOP-100 data, triggering POST scan...');
          const scanRes = await fetch('/api/horizon/top100', { method: 'POST' });
          if (scanRes.ok) {
            json = await scanRes.json();
          } else {
            throw new Error('TOP-100 scan failed');
          }
        }
      }

      recordSuccess('top100');
      set({
        top100Data: json.data || [],
        lastTop100Update: Date.now(),
        top100Loading: false,
        marketClosed: json.marketClosed || false,
        sessionInfo: json.sessionInfo || '',
      });
    } catch (error: any) {
      recordError('top100');
      set({ top100Error: error.message, top100Loading: false });
    }
  },
}));
