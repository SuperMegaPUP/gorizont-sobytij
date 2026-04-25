// ─── signal-store.ts — Zustand store для сигналов ───────────────────────────
// Управление состоянием сигналов в UI:
//   - Активные сигналы (REAL-TIME обновление)
//   - История сигналов по тикеру
//   - Фильтры и сортировка
//   - TTL countdown

import { create } from 'zustand';
import type { TradeSignal, SignalType, SignalDirection, SignalState } from './signal-generator';
import type { SignalFeedbackResult } from './signal-feedback';

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface SignalFilters {
  type: SignalType | '';
  direction: SignalDirection | '';
  state: SignalState | '';
  minConfidence: number;
  ticker: string;
}

export type SignalSortBy = 'confidence' | 'convergence' | 'bsci' | 'ttl' | 'createdAt';

// ─── State ───────────────────────────────────────────────────────────────────

export interface SignalStoreState {
  /** Активные сигналы */
  activeSignals: TradeSignal[];
  /** История закрытых сигналов */
  signalHistory: TradeSignal[];
  /** Выбранный сигнал для деталей */
  selectedSignal: TradeSignal | null;
  /** Загрузка */
  loading: boolean;
  /** Ошибка */
  error: string | null;
  /** Фильтры */
  filters: SignalFilters;
  /** Сортировка */
  sortBy: SignalSortBy;
  /** Последнее обновление */
  lastUpdate: number | null;
  /** Feedback статистика */
  feedbackStats: {
    total: number;
    wins: number;
    losses: number;
    expired: number;
    winRate: number;
  } | null;

  // ── Actions ──
  fetchActiveSignals: () => Promise<void>;
  fetchSignalHistory: (ticker?: string) => Promise<void>;
  selectSignal: (signal: TradeSignal | null) => void;
  setFilters: (filters: Partial<SignalFilters>) => void;
  setSortBy: (sortBy: SignalSortBy) => void;
  updateSignal: (signal: TradeSignal) => void;
  removeSignal: (signalId: string) => void;
  reset: () => void;
}

// ─── Initial State ───────────────────────────────────────────────────────────

const initialFilters: SignalFilters = {
  type: '',
  direction: '',
  state: '',
  minConfidence: 0,
  ticker: '',
};

const initialState = {
  activeSignals: [] as TradeSignal[],
  signalHistory: [] as TradeSignal[],
  selectedSignal: null as TradeSignal | null,
  loading: false,
  error: null as string | null,
  filters: initialFilters,
  sortBy: 'confidence' as SignalSortBy,
  lastUpdate: null as number | null,
  feedbackStats: null as SignalStoreState['feedbackStats'],
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useSignalStore = create<SignalStoreState>((set, get) => ({
  ...initialState,

  fetchActiveSignals: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/horizon/signals');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const activeSignals: TradeSignal[] = (json.active || []).map(deserializeSignal);
      const feedbackStats = json.stats || null;

      set({
        activeSignals,
        lastUpdate: Date.now(),
        feedbackStats,
        loading: false,
      });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  fetchSignalHistory: async (ticker?: string) => {
    set({ loading: true, error: null });
    try {
      const url = ticker
        ? `/api/horizon/signals/${ticker}`
        : '/api/horizon/signals?mode=history';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const signalHistory: TradeSignal[] = (json.history || []).map(deserializeSignal);

      set({ signalHistory, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  selectSignal: (signal) => set({ selectedSignal: signal }),

  setFilters: (filters) =>
    set((state) => ({
      filters: { ...state.filters, ...filters },
    })),

  setSortBy: (sortBy) => set({ sortBy }),

  updateSignal: (signal) =>
    set((state) => ({
      activeSignals: state.activeSignals.map((s) =>
        s.signal_id === signal.signal_id ? signal : s,
      ),
      selectedSignal: state.selectedSignal?.signal_id === signal.signal_id
        ? signal
        : state.selectedSignal,
    })),

  removeSignal: (signalId) =>
    set((state) => ({
      activeSignals: state.activeSignals.filter((s) => s.signal_id !== signalId),
      selectedSignal: state.selectedSignal?.signal_id === signalId
        ? null
        : state.selectedSignal,
    })),

  reset: () => set(initialState),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Десериализует сигнал из API ответа (Date строки → Date объекты).
 */
function deserializeSignal(raw: any): TradeSignal {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    expiresAt: new Date(raw.expiresAt),
    snapshots: (raw.snapshots || []).map((s: any) => ({
      ...s,
      timestamp: new Date(s.timestamp),
    })),
  };
}

/**
 * Сериализует сигнал для API запроса (Date объекты → ISO строки).
 */
export function serializeSignal(signal: TradeSignal): any {
  return {
    ...signal,
    createdAt: signal.createdAt.toISOString(),
    expiresAt: signal.expiresAt.toISOString(),
    snapshots: signal.snapshots.map(s => ({
      ...s,
      timestamp: s.timestamp.toISOString(),
    })),
  };
}

// ─── Селекторы ───────────────────────────────────────────────────────────────

/**
 * Фильтрует и сортирует активные сигналы.
 */
export function getFilteredSignals(
  signals: TradeSignal[],
  filters: SignalFilters,
  sortBy: SignalSortBy,
): TradeSignal[] {
  let filtered = [...signals];

  // Фильтрация
  if (filters.type) {
    filtered = filtered.filter(s => s.type === filters.type);
  }
  if (filters.direction) {
    filtered = filtered.filter(s => s.direction === filters.direction);
  }
  if (filters.state) {
    filtered = filtered.filter(s => s.state === filters.state);
  }
  if (filters.minConfidence > 0) {
    filtered = filtered.filter(s => s.confidence >= filters.minConfidence);
  }
  if (filters.ticker) {
    const q = filters.ticker.toUpperCase();
    filtered = filtered.filter(s => s.ticker.toUpperCase().includes(q));
  }

  // Сортировка
  const sortFns: Record<SignalSortBy, (a: TradeSignal, b: TradeSignal) => number> = {
    confidence: (a, b) => b.confidence - a.confidence,
    convergence: (a, b) => b.convergence - a.convergence,
    bsci: (a, b) => b.bsciAtCreation - a.bsciAtCreation,
    ttl: (a, b) => a.expiresAt.getTime() - b.expiresAt.getTime(),
    createdAt: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  };

  filtered.sort(sortFns[sortBy] || sortFns.confidence);

  return filtered;
}

/**
 * Группирует сигналы по типу.
 */
export function groupSignalsByType(signals: TradeSignal[]): Record<SignalType, TradeSignal[]> {
  return {
    LONG: signals.filter(s => s.type === 'LONG'),
    SHORT: signals.filter(s => s.type === 'SHORT'),
    AWAIT: signals.filter(s => s.type === 'AWAIT'),
    BREAKOUT: signals.filter(s => s.type === 'BREAKOUT'),
  };
}
