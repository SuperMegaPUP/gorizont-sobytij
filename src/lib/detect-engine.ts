// ─── Robot Detection Engine v2.0 — Чистые функции (тестируемые) ──────────
// Вынесены из api/detect/route.ts для юнит-тестирования
// route.ts использует эти функции через импорт

// ─── Уровни детекции ──────────────────────────────────────────────────────

export type DetectLevel = 'hft' | 'algo' | 'structural';

export interface DetectLevelConfig {
  name: DetectLevel;
  labelRu: string;
  windowSec: number;
  minTrades: number;
  maxAvgInterval: number;
}

export const DETECT_LEVELS: DetectLevelConfig[] = [
  { name: 'hft',         labelRu: 'HFT',       windowSec: 3,   minTrades: 5,  maxAvgInterval: 0.5 },
  { name: 'algo',        labelRu: 'АЛГО',      windowSec: 10,  minTrades: 5,  maxAvgInterval: 2.0 },
  { name: 'structural',  labelRu: 'СТРУКТУР',  windowSec: 120, minTrades: 8,  maxAvgInterval: 5.0 },
];

export const LEVEL_PRIORITY: Record<DetectLevel, number> = { hft: 3, algo: 2, structural: 1 };

export const PATTERN_NAMES: Record<string, string> = {
  periodic: 'Периодический',
  fixed_volume: 'Фиксированный объём',
  layered: 'Слоистый',
  iceberg: 'Айсберг',
  scalper: 'Скальпер',
  momentum: 'Моментум',
  ping_pong: 'Пинг-понг',
  market_maker: 'Маркет-мейкер',
  aggressive: 'Агрессивный',
  slow_grinder: 'Медл. шлифовщик',
  sweeper: 'Зачистчик',
  absorber: 'Поглотитель',
  unknown: 'Неизвестный',
};

// ─── Интерфейсы ───────────────────────────────────────────────────────────

export interface TradeInput {
  timestamp: number;
  price: number;
  lots: number;
  direction: 'BUY' | 'SELL';
}

export interface BurstResult {
  tsStart: number;
  tsEnd: number;
  ticker: string;
  figi: string;
  direction: 'BUY' | 'SELL' | 'MIXED';
  totalLots: number;
  buyLots: number;
  sellLots: number;
  delta: number;
  wap: number;
  duration: number;
  tradeCount: number;
  strategy: string;
  strategyRu: string;
  confidence: number;
  lotsPctDaily: number;
  valuePctDaily: number;
  priceImpactPct: number;
  spreadImpact: number;
  source: string;
  intervalSec: number;
  level: DetectLevel;
  levelRu: string;
}

// ─── Утилиты ──────────────────────────────────────────────────────────────

export function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

export function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── Генераторы тестовых данных ───────────────────────────────────────────

/** Создать серию BUY сделок с заданными параметрами */
export function makeBuyTrades(count: number, opts: {
  startTs?: number;
  intervalSec?: number;
  price?: number;
  lots?: number;
} = {}): TradeInput[] {
  const { startTs = 1000000, intervalSec = 0.1, price = 100, lots = 100 } = opts;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startTs + i * intervalSec,
    price,
    lots,
    direction: 'BUY' as const,
  }));
}

/** Создать серию SELL сделок */
export function makeSellTrades(count: number, opts: {
  startTs?: number;
  intervalSec?: number;
  price?: number;
  lots?: number;
} = {}): TradeInput[] {
  const { startTs = 1000000, intervalSec = 0.1, price = 100, lots = 100 } = opts;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startTs + i * intervalSec,
    price,
    lots,
    direction: 'SELL' as const,
  }));
}

/** Создать чередующиеся BUY/SELL сделки (пинг-понг / MM паттерн) */
export function makeAlternatingTrades(count: number, opts: {
  startTs?: number;
  intervalSec?: number;
  price?: number;
  lots?: number;
} = {}): TradeInput[] {
  const { startTs = 1000000, intervalSec = 0.1, price = 100, lots = 100 } = opts;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startTs + i * intervalSec,
    price,
    lots,
    direction: (i % 2 === 0 ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
  }));
}

/** Создать сделки с одинаковыми объёмами (fixed_volume паттерн) */
export function makeFixedVolumeTrades(count: number, opts: {
  startTs?: number;
  intervalSec?: number;
  price?: number;
  fixedLots?: number;
} = {}): TradeInput[] {
  const { startTs = 1000000, intervalSec = 0.1, price = 100, fixedLots = 50 } = opts;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startTs + i * intervalSec,
    price,
    lots: fixedLots,
    direction: (i % 3 === 0 ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
  }));
}

/** Создать сделки с периодическими интервалами (periodic паттерн) */
export function makePeriodicTrades(count: number, opts: {
  startTs?: number;
  periodSec?: number;
  price?: number;
  lots?: number;
} = {}): TradeInput[] {
  const { startTs = 1000000, periodSec = 1.0, price = 100, lots = 100 } = opts;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startTs + i * periodSec,
    price,
    lots,
    direction: 'BUY' as const,
  }));
}

/** Создать длинную серию сделок (structural / slow_grinder) */
export function makeLongTrades(count: number, durationSec: number, opts: {
  startTs?: number;
  price?: number;
  lots?: number;
} = {}): TradeInput[] {
  const { startTs = 1000000, price = 100, lots = 50 } = opts;
  const intervalSec = durationSec / Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startTs + i * intervalSec,
    price,
    lots,
    direction: (i % 2 === 0 ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
  }));
}

// ─── Одноуровневая детекция burst ─────────────────────────────────────────

export function detectBurstsAtLevel(
  trades: TradeInput[],
  ticker: string,
  figi: string,
  dailyVolume: number,
  dailyValue: number,
  source: string,
  level: DetectLevelConfig
): BurstResult[] {
  if (trades.length < level.minTrades) return [];

  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const bursts: BurstResult[] = [];
  let burstStart = 0;

  for (let i = 0; i < sorted.length; i++) {
    while (sorted[i].timestamp - sorted[burstStart].timestamp > level.windowSec) {
      burstStart++;
    }
    const windowTrades = sorted.slice(burstStart, i + 1);

    if (windowTrades.length >= level.minTrades) {
      const intervals: number[] = [];
      for (let j = 1; j < windowTrades.length; j++) {
        const dt = windowTrades[j].timestamp - windowTrades[j - 1].timestamp;
        if (dt > 0) intervals.push(dt);
      }
      if (intervals.length > 0) {
        const avgInterval = mean(intervals);
        if (avgInterval < level.maxAvgInterval) {
          let burstEnd = i;
          for (let k = i + 1; k < sorted.length; k++) {
            if (sorted[k].timestamp - sorted[burstStart].timestamp > level.windowSec) break;
            const extWindow = sorted.slice(burstStart, k + 1);
            const extIntervals: number[] = [];
            for (let j = 1; j < extWindow.length; j++) {
              const dt = extWindow[j].timestamp - extWindow[j - 1].timestamp;
              if (dt > 0) extIntervals.push(dt);
            }
            if (extIntervals.length > 0 && mean(extIntervals) < level.maxAvgInterval) {
              burstEnd = k;
            } else {
              break;
            }
          }

          const fullWindowTrades = sorted.slice(burstStart, burstEnd + 1);
          const totalLots = fullWindowTrades.reduce((s, t) => s + t.lots, 0);
          const totalValue = fullWindowTrades.reduce((s, t) => s + t.price * t.lots, 0);
          const buyLots = fullWindowTrades.filter(t => t.direction === 'BUY').reduce((s, t) => s + t.lots, 0);
          const sellLots = fullWindowTrades.filter(t => t.direction === 'SELL').reduce((s, t) => s + t.lots, 0);
          const wap = totalLots > 0 ? totalValue / totalLots : 0;
          const direction = buyLots > sellLots * 1.5 ? 'BUY' : sellLots > buyLots * 1.5 ? 'SELL' : 'MIXED';

          bursts.push({
            tsStart: fullWindowTrades[0].timestamp,
            tsEnd: fullWindowTrades[fullWindowTrades.length - 1].timestamp,
            tradeCount: fullWindowTrades.length,
            totalLots,
            buyLots,
            sellLots,
            delta: buyLots - sellLots,
            wap: Math.round(wap * 100) / 100,
            direction,
            duration: Math.round((fullWindowTrades[fullWindowTrades.length - 1].timestamp - fullWindowTrades[0].timestamp) * 10) / 10,
            ticker,
            figi,
            strategy: '',
            strategyRu: '',
            confidence: 0,
            lotsPctDaily: dailyVolume > 0 ? Math.round(totalLots / dailyVolume * 10000) / 100 : 0,
            valuePctDaily: dailyValue > 0 ? Math.round(totalValue / dailyValue * 10000) / 100 : 0,
            priceImpactPct: 0,
            spreadImpact: 0,
            source,
            intervalSec: 0,
            level: level.name,
            levelRu: level.labelRu,
          });
          burstStart = burstEnd + 1;
          i = burstEnd;
        }
      }
    }
  }

  for (const burst of bursts) {
    classifyBurst(burst, trades, dailyVolume);
  }

  return bursts;
}

// ─── Дедупликация burst'ов между уровнями ─────────────────────────────────

export function deduplicateBursts(bursts: BurstResult[]): BurstResult[] {
  if (bursts.length <= 1) return bursts;

  const sorted = [...bursts].sort(
    (a, b) => (LEVEL_PRIORITY[b.level] - LEVEL_PRIORITY[a.level]) || (a.tsStart - b.tsStart)
  );

  const kept: BurstResult[] = [];

  for (const burst of sorted) {
    const overlaps = kept.some(k => {
      if (k.ticker !== burst.ticker) return false;
      const overlapStart = Math.max(k.tsStart, burst.tsStart);
      const overlapEnd = Math.min(k.tsEnd, burst.tsEnd);
      if (overlapEnd <= overlapStart) return false;
      const burstDur = burst.tsEnd - burst.tsStart || 0.1;
      return (overlapEnd - overlapStart) / burstDur > 0.5;
    });
    if (!overlaps) {
      kept.push(burst);
    }
  }

  return kept;
}

// ─── Многоуровневая детекция (точка входа) ────────────────────────────────

export function detectBurstsMultiLevel(
  trades: TradeInput[],
  ticker: string,
  figi: string,
  dailyVolume: number,
  dailyValue: number,
  source: string
): BurstResult[] {
  if (trades.length < 5) return [];

  const allBursts: BurstResult[] = [];

  for (const level of DETECT_LEVELS) {
    const levelBursts = detectBurstsAtLevel(
      trades, ticker, figi, dailyVolume, dailyValue, source, level
    );
    allBursts.push(...levelBursts);
  }

  return deduplicateBursts(allBursts);
}

// ─── Классификация паттернов (уровне-зависимая) ──────────────────────────

export function classifyBurst(burst: BurstResult, allTrades: TradeInput[], dailyVolume = 0) {
  const scores: Record<string, number> = {};
  const duration = burst.duration;  // Реальная длительность (может быть 0 для мгновенных всплесков)
  const effectiveDuration = duration || (burst.tradeCount > 1 ? 0.001 : 1);  // 1мс для multi-trade, 1с для single
  const level = burst.level;

  // ── Айсберг: адаптивные пороги + ценовой критерий ──
  // Используем переданный dailyVolume вместо восстановления из округлённого lotsPctDaily
  const dailyVol = dailyVolume > 0 ? dailyVolume : (burst.lotsPctDaily > 0 ? burst.totalLots / (burst.lotsPctDaily / 100) : 0);
  // volPctDaily тождественно равен lotsPctDaily при наличии dailyVolume, иначе используем lotsPctDaily напрямую
  const volPctDaily = burst.lotsPctDaily;
  const burstTrades = allTrades.filter(t => t.timestamp >= burst.tsStart && t.timestamp <= burst.tsEnd);
  const prices = burstTrades.map(t => t.price);
  // O(n) расчёт моды вместо O(n² log n)
  const priceFreq = new Map<number, number>();
  for (const p of prices) priceFreq.set(p, (priceFreq.get(p) || 0) + 1);
  let modePrice = 0;
  let modeFreq = 0;
  for (const [p, f] of priceFreq) { if (f > modeFreq) { modeFreq = f; modePrice = p; } }
  const priceUniformity = prices.length > 0 && modePrice > 0
    ? prices.filter(p => Math.abs(p - modePrice) / modePrice < 0.001).length / prices.length
    : 0;

  // ── Реальный priceImpactPct: на основе движения цены внутри всплеска ──
  if (prices.length >= 2) {
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const priceChange = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
    burst.priceImpactPct = Math.round(priceChange * 100) / 100;
    // spreadImpact: разница между max и min ценой (волатильность внутри всплеска)
    const maxP = Math.max(...prices);
    const minP = Math.min(...prices);
    const spreadPct = minP > 0 ? ((maxP - minP) / minP) * 100 : 0;
    burst.spreadImpact = Math.round((burst.direction === 'BUY' ? -1 : burst.direction === 'SELL' ? 1 : 0) * spreadPct * 100) / 100;
  } else {
    burst.priceImpactPct = 0;
    burst.spreadImpact = 0;
  }

  if (priceUniformity > 0.8 && burst.totalLots > 1000) {
    scores.iceberg = 0.9;
  } else if (dailyVol > 0 && volPctDaily > 1) {
    scores.iceberg = 0.8;
  } else if (dailyVol > 0 && volPctDaily > 0.3) {
    scores.iceberg = 0.4;
  } else if (burst.totalLots > 5000) {
    scores.iceberg = 0.8;
  } else if (burst.totalLots > 1000) {
    scores.iceberg = 0.4;
  }

  // ── Скальпер: ТОЛЬКО на HFT уровне ──
  if (level === 'hft') {
    const tps = burst.tradeCount / effectiveDuration;
    scores.scalper = tps > 2 ? 0.9 : tps > 1 ? 0.5 : 0;
  }

  // ── Моментум: на АЛГО и СТРУКТУР уровнях ──
  if (level === 'algo' || level === 'structural') {
    if (dailyVol > 0 && volPctDaily > 0.2) {
      scores.momentum = 0.7;
    } else if (burst.totalLots > 500) {
      scores.momentum = 0.7;
    }
  }

  // ── Пинг-понг: MIXED + дельта мала ──
  if (burst.direction === 'MIXED') {
    scores.ping_pong = Math.abs(burst.delta) < burst.totalLots * 0.1 ? 0.8 : 0.4;
  }

  // ── Маркет-мейкер: flipRate + дельта мала ──
  {
    const dirChanges = burstTrades.length > 1 ? burstTrades.slice(1).reduce((cnt, t, idx) =>
      t.direction !== burstTrades[idx].direction ? cnt + 1 : cnt, 0) : 0;
    const flipRate = burstTrades.length > 1 ? dirChanges / (burstTrades.length - 1) : 0;

    if (flipRate > 0.4 && Math.abs(burst.delta) < burst.totalLots * 0.2) {
      scores.market_maker = 0.85;
    } else if (Math.abs(burst.delta) < burst.totalLots * 0.15) {
      scores.market_maker = 0.5;
    } else if (flipRate > 0.3 && Math.abs(burst.delta) < burst.totalLots * 0.3) {
      scores.market_maker = 0.4;
    }
  }

  // ── Агрессивный: доминирует одно направление ──
  if (Math.abs(burst.delta) > burst.totalLots * 0.7) {
    scores.aggressive = 0.6;
  }

  // ── Периодический: Коэфф. вариации интервалов (из burstTrades, не allTrades) ──
  const sorted = [...burstTrades].sort((a, b) => a.timestamp - b.timestamp);
  const recentIntervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const dt = sorted[i].timestamp - sorted[i - 1].timestamp;
    if (dt > 0) recentIntervals.push(dt);
  }
  if (recentIntervals.length >= 5) {
    const m = mean(recentIntervals);
    const cv = m > 0 ? stdev(recentIntervals) / m : 999;
    if (cv < 0.15) scores.periodic = 0.8;
    else if (cv < 0.3) scores.periodic = 0.4;
    burst.intervalSec = Math.round(m * 1000) / 1000;
  }

  // ── Фиксированный объём (из burstTrades, не allTrades) ──
  const volumes = burstTrades.map(t => t.lots);
  const freq: Record<number, number> = {};
  for (const v of volumes) freq[v] = (freq[v] || 0) + 1;
  const maxFreq = Math.max(...Object.values(freq));
  if (volumes.length > 0 && maxFreq / volumes.length > 0.4) scores.fixed_volume = 0.8;

  // ── Зачистчик: большой объём + существенное ценовое воздействие ──
  if (Math.abs(burst.priceImpactPct) > 0.1 && burst.totalLots > (dailyVol > 0 ? dailyVol * 0.0005 : 500)) {
    scores.sweeper = Math.abs(burst.priceImpactPct) > 0.5 ? 0.8 : Math.abs(burst.priceImpactPct) > 0.2 ? 0.6 : 0;
  }

  // ── Поглотитель: большой объём при МАЛОМ ценовом воздействии (поглощает поток) ──
  {
    const absThreshold = dailyVol > 0 ? dailyVol * 0.001 : 100;
    if (burst.totalLots > absThreshold && Math.abs(burst.priceImpactPct) < 0.05) {
      scores.absorber = dailyVol > 0 ? 0.7 : 0.6;
    }
  }

  // ── Медленный шлифовщик: ТОЛЬКО STRUCTURAL ──
  if (level === 'structural') {
    scores.slow_grinder = effectiveDuration > 60 ? 0.85 : effectiveDuration > 30 ? 0.55 : 0;
  }

  // ── Слоистый ──
  if (volumes.length >= 5) {
    const medVol = median(volumes);
    const roundUnit = Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.max(medVol, 1)))));
    const tiers = volumes.map(v => Math.round(v / roundUnit) * roundUnit);
    const tierFreq: Record<number, number> = {};
    for (const t of tiers) tierFreq[t] = (tierFreq[t] || 0) + 1;
    const maxTierFreq = Math.max(...Object.values(tierFreq));
    if (maxTierFreq / tiers.length > 0.5) scores.layered = 0.7;
  }

  // ── Выбор лучшего паттерна ──
  let bestStrategy = 'unknown';
  let bestScore = 0;  // 0 вместо 0.1 — неизвестный паттерн должен иметь confidence=0
  for (const [strategy, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestStrategy = strategy;
    }
  }

  burst.strategy = bestStrategy;
  burst.strategyRu = PATTERN_NAMES[bestStrategy] || bestStrategy;
  burst.confidence = Math.round(Math.min(bestScore, 1) * 100) / 100;
  // priceImpactPct и spreadImpact уже вычислены из реальных ценовых данных выше
}
