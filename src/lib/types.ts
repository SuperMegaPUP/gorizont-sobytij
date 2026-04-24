// ─── Types ───────────────────────────────────────────────────────────────────

export type Direction = 'buy' | 'sell' | 'mixed';

export interface RobotEvent {
  id: string;
  time: string;
  ts: number;            // UNIX timestamp (ms) для скользящего окна
  ticker: string;
  direction: Direction;
  lots: number;
  buyLots: number;       // реальные лоты покупок из burst (detect-engine)
  sellLots: number;      // реальные лоты продаж из burst (detect-engine)
  pattern: string;
  confidence: number;
  wap: number;
  delta: number;         // DEPRECATED: используйте buyLots - sellLots
  duration: string;
  durationSec: number;  // сырые секунды для бакетов длительности
  percentOfDay: number;
  priceImpact: number;
  spreadImpact: number;
  isNew?: boolean;
  source?: string;
  level?: 'hft' | 'algo' | 'structural';  // Уровень детекции (v2.0)
  levelRu?: string;                         // Русская метка уровня
}

export interface Instrument {
  rank: number;
  ticker: string;
  volume: number;
  turnover: string;
}

export interface TopTicker {
  ticker: string;
  events: number;
  buyLots: number;
  sellLots: number;
  avgConfidence: number;
  score: number;            // Composite Score
}

export interface StrategyItem {
  name: string;
  count: number;
  percentage: number;
  color: string;
}

export interface HourlyData {
  hour: string;
  buy: number;
  sell: number;
}

export interface Anomaly {
  id: string;
  ticker: string;
  direction: Direction;
  lots: number;
  pattern: string;
  confidence?: number;
  percentOfDay?: number;
  priceImpact?: number;
  level?: 'hft' | 'algo' | 'structural';  // уровень детекции (из burst.level)
  ts?: number;           // UNIX ms — время появления
  blinkUntil?: number;   // UNIX ms — до какого времени мигать
}

// ─── Агрегационные интерфейсы для 4 фреймов LIVE RADAR ─────────────────────

export interface TickerAgg {
  ticker: string;
  events: number;
  buyLots: number;
  sellLots: number;
  deltaNet: number;
  totalLots: number;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  score: number;          // Composite Score: aggression × persistence × volumeAnomaly
  avgConfidence: number;
  priceImpact: number;
}

export interface DurationBucket {
  label: string;
  rangeSec: [number, number];
  events: number;
  lots: number;
  avgConfidence: number;
  buyLots: number;
  sellLots: number;
}

export type RobotProfile = 'HFT' | 'СКАЛЬП' | 'ИМПУЛЬС' | 'СТРУКТУР' | 'НАКОПЛ' | 'МУЛЬТИ';

export interface TickerDurationAgg {
  ticker: string;
  events: number;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  buyLots: number;
  sellLots: number;
  deltaNet: number;
  lastTime: string;
  avgConfidence: number;
  hftLots: number;          // 0-3s (v2.0 HFT level)
  scalperLots: number;      // 3-30s
  impulseLots: number;      // 30s-2m
  structuralLots: number;   // 2-10m
  accumulationLots: number; // 10m+
  score: number;            // Activity Score v2: dominanceWeight × aggression × persistence × (0.3 + 0.7 × volumeAnomaly) × algoConfirm × 100
  priceImpact: number;
  patterns: string[];       // уникальные паттерны
  robotProfile: RobotProfile;  // доминирующий тип робота
  algoConfirm: number;      // кросс-подтверждение AlgoPack: 1.0 / 1.2 / 1.3 / 1.5
}

export interface TimeBucket {
  window: string;
  events: number;
  buyLots: number;
  sellLots: number;
  delta: number;
}

export interface Signal {
  id: string;
  ticker: string;
  direction: 'LONG' | 'SHORT';
  events: number;
  lots: number;
  score: number;            // Signal Score v2 [0-100]: concentration × persistence × volumeAnomaly × algoConfirm × 100
  priceImpact: number;
  strength: 'STRONG' | 'MEDIUM' | 'WEAK';
  avgConfidence: number;
  algoConfirm: number;      // Кросс-подтверждение из AlgoPack: 1.0 / 1.2 / 1.3 / 1.5
  ts: number;
}

export interface FutoiGroup {
  pos: number;
  pos_long: number;
  pos_short: number;
  pos_long_num: number;
  pos_short_num: number;
  oi_change_long: number;
  oi_change_short: number;
}

export interface OiSnapshot {
  ts: number;           // UNIX ms
  time: string;        // HH:MM МСК
  yurLong: number;
  yurShort: number;
  fizLong: number;
  fizShort: number;
}

export interface FutoiInstrument {
  ticker: string;
  timestamp: string;
  tradetime: string;
  yur: FutoiGroup;
  fiz: FutoiGroup;
  smi: number;
  smiDirection: string;
}

export interface CalendarDay {
  date: string;
  stock: { isTraded: boolean; reason: string; sessionDate: string | null };
  futures: { isTraded: boolean; reason: string; sessionDate: string | null };
  currency: { isTraded: boolean; reason: string; sessionDate: string | null };
}

// ─── AlgoPack интерфейсы (СТАКАН-СКАНЕР + ЛОКАТОР КРУПНЯКА) ──────────────

export interface WallScoreEntry {
  secid: string;
  wallScore: number;
  imbalance_vol: number;
  imbalance_val: number;
  imbalance_vol_bbo: number;
  volDomination: 'BID' | 'ASK';
  volTotal: number;
  valTotal: number;
  spread_bbo: number;
  vwap_b: number;
  vwap_s: number;
  valToday: number;
  tag: 'ТИХО' | 'СРОЧНО';
  tradetime: string;
}

export interface AccumScoreEntry {
  secid: string;
  accumulationScore: number;
  direction: 'LONG' | 'SHORT';
  deltaVal: number;
  deltaVol: number;
  avgTradeSizeB: number;
  avgTradeSizeS: number;
  disb: number;
  cancelRatio: number;
  spoofing: boolean;
  tag: 'ТИХО' | 'СРОЧНО';
  valToday: number;
  tradetime: string;
}

export interface AlgoPackData {
  walls: WallScoreEntry[];
  accumulations: AccumScoreEntry[];
  spoofingTickers: string[];
  totalTickers: number;
  source: string;
  tradetime: string;
  date: string;
  topTickers: string[];  // TOP-100 тикеры для фильтрации ликвид/неликвид
}

export interface DashboardStore {
  events: RobotEvent[];
  windowEvents: RobotEvent[];        // скользящее окно 30 мин
  instruments: Instrument[];
  fearGreedIndex: number;
  topTickers: TopTicker[];
  strategyDistribution: StrategyItem[];
  hourlyActivity: HourlyData[];
  anomalies: Anomaly[];
  activeFilter: Direction | null;
  lastUpdate: string;
  buyLots: number;
  sellLots: number;
  totalEvents: number;
  connected: boolean;
  dataSource: string;
  apiError: string;
  futoiInstruments: FutoiInstrument[];
  compositeSMI: number;
  compositeDirection: string;
  futoiSource: string;        // 'apim_futoi' | 'iss_authorized' | 'openpositions' | 'none'
  futoiRealtime: boolean;     // true = данные за последние 5 мин
  calendarDays: CalendarDay[];
  oiHistory: Record<string, OiSnapshot[]>;  // ключ = тикер (MX, Si, RI, BR)
  // Агрегации для 4 фреймов
  tickerAggs: TickerAgg[];
  durationBuckets: DurationBucket[];
  tickerDurationAggs: TickerDurationAgg[];
  timeBuckets: TimeBucket[];         // 15-минутные окна (было 5 мин)
  signals: Signal[];
  // AlgoPack данные (фреймы 5-6)
  algopack: AlgoPackData;
  // DB: метрики восстановлены из БД
  dbLoaded: boolean;
  dbTradeDate: string;  // YYYY-MM-DD текущий торговый день
  // Методы для DB persistence
  loadFromDb: (data: any) => void;
  setFilter: (filter: Direction | null) => void;
  addEvent: (event: RobotEvent) => void;
  resetNewFlags: () => void;
  setConnected: (v: boolean) => void;
  setDataSource: (v: string) => void;
  setApiError: (v: string) => void;
  updateInstruments: (instruments: Instrument[]) => void;
  updateStats: (stats: Partial<DashboardStore>) => void;
  updateFutoi: (instruments: FutoiInstrument[], compositeSMI: number, compositeDirection: string, source?: string, realtime?: boolean) => void;
  updateCalendar: (days: CalendarDay[]) => void;
  pushOiHistory: (instruments: FutoiInstrument[]) => void;
  updateAlgoPack: (data: AlgoPackData) => void;
  expireAnomalies: () => void;  // Деактивация аномалий по таймауту
}

// Sort helpers for TickersFrame
export type SortCol = 'ticker' | 'events' | 'buyLots' | 'sellLots' | 'deltaNet' | 'direction' | 'score';
export type SortDir = 'asc' | 'desc';
