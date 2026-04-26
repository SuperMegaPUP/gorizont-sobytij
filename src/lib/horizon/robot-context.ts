// ─── robot-context.ts ─────────────────────────────────────────────────────────
// Мост между робот-детекцией (Dashboard) и Horizon (BSCI/детекторы)
//
// КОНЦЕПЦИЯ:
//   Робот-данные = ФАКТЫ (что реально происходит на рынке)
//   Детекторы = ГИПОТЕЗЫ (что мы видим в стакане/потоке)
//   Факт + Гипотеза = ПОДТВЕРЖДЕНИЕ → +1 к convergence/10
//
// ИСТОЧНИКИ:
//   1. AlgoPack (obstats + tradestats + orderstats) — стены, накопления, спуфинг
//   2. Burst Detection (detect-engine) — паттерны роботов в сделках
//   3. Объёмный анализ — buy/sell ratio, размер сделок
//
// МЭППИНГ Детектор ↔ Робот-паттерн:
//   CIPHER     ↔ algorithmic (periodic, fixed_volume, layered)
//   ACCRETOR   ↔ accumulator/twap (slow_grinder, absorber)
//   DARKMATTER ↔ iceberg
//   PREDATOR   ↔ aggressive, momentum, sweeper
//   HAWKING    ↔ scalper, market_maker, ping_pong
//
// Спринт 3: Подключение к convergence score + UI

import { detectBurstsMultiLevel, type BurstResult, type TradeInput } from '../detect-engine';
import {
  fetchAlgoPack,
  type ObstatsEntry,
  type TradestatsEntry,
  type OrderstatsEntry,
  type AlgoPackResult,
} from '../moex-algopack';
import redis from '@/lib/redis';

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface RobotContext {
  /** Тикер */
  ticker: string;

  // ── Объёмный анализ ──
  /** Оценочная доля алгоритмического объёма (0-1) */
  robotVolumePct: number;
  /** Обнаруженные робот-паттерны (из burst detection) */
  robotPatterns: RobotPatternInfo[];
  /** Направленный дисбаланс роботов (-1 SELL → +1 BUY) */
  robotImbalance: number;
  /** Средний размер робот-сделки (руб) */
  avgRobotOrderSize: number;
  /** Средний размер человеческой сделки (руб) */
  avgHumanOrderSize: number;

  // ── AlgoPack индикаторы ──
  /** Wall Score (0-100) — сила стены стакана */
  wallScore: number;
  /** Accumulation Score (0-100) — институциональное накопление */
  accumScore: number;
  /** Cancel Ratio (0-1) — доля отменённых ордеров (спуфинг) */
  cancelRatio: number;
  /** MOEX disb — дизбаланс (отрицательный = продажа, положительный = покупка) */
  disb: number;
  /** Направление накопления */
  accumDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
  /** Есть ли спуфинг */
  hasSpoofing: boolean;

  // ── Детектор ↔ Робот ──
  /** Скор подтверждения 0-1 (маппинг детектора на робот-паттерн) */
  confirmation: number;
  /** Какой паттерн подтвердил */
  matchedPattern: string;
  /** Какой детектор подтверждён */
  matchedDetector: string;

  // ── Мета ──
  /** Количество burst'ов обнаружено */
  burstCount: number;
  /** Общее количество burst-лотов */
  burstTotalLots: number;
  /** Источник данных */
  source: 'algopack+burst' | 'algopack' | 'burst' | 'none';
}

export interface RobotPatternInfo {
  /** Имя паттерна (iceberg, scalper, momentum, ...) */
  pattern: string;
  /** Русское название */
  patternRu: string;
  /** Уровень (hft, algo, structural) */
  level: string;
  /** Количество burst'ов с этим паттерном */
  count: number;
  /** Суммарные лоты */
  totalLots: number;
  /** Направление (BUY/SELL/MIXED) */
  direction: 'BUY' | 'SELL' | 'MIXED';
  /** Средняя уверенность */
  avgConfidence: number;
}

// ─── Мэппинг Детектор ↔ Робот-паттерн ───────────────────────────────────────

const DETECTOR_PATTERN_MAP: Record<string, string[]> = {
  CIPHER:      ['periodic', 'fixed_volume', 'layered'],
  ACCRETOR:    ['slow_grinder', 'absorber'],
  DARKMATTER:  ['iceberg'],
  PREDATOR:    ['aggressive', 'momentum', 'sweeper'],
  HAWKING:     ['scalper', 'market_maker', 'ping_pong'],
  ATTRACTOR:   ['slow_grinder', 'absorber', 'iceberg'],
  WAVEFUNCTION: ['periodic', 'ping_pong', 'market_maker'],
  GRAVITON:    ['market_maker', 'absorber', 'iceberg'],
  DECOHERENCE: ['aggressive', 'momentum', 'scalper'],
  ENTANGLE:    ['ping_pong', 'periodic', 'market_maker'],
};

// Обратный маппинг: паттерн → детектор
const PATTERN_DETECTOR_MAP: Record<string, string> = {};
for (const [detector, patterns] of Object.entries(DETECTOR_PATTERN_MAP)) {
  for (const pattern of patterns) {
    PATTERN_DETECTOR_MAP[pattern] = detector;
  }
}

// ─── Кэширование AlgoPack ────────────────────────────────────────────────────

const ALGOPACK_CACHE_KEY = 'horizon:algopack:latest';
const ALGOPACK_CACHE_TTL = 300; // 5 минут (AlgoPack обновляется каждые 5 мин)

/**
 * Получить AlgoPack данные с кэшированием в Redis.
 * AlgoPack возвращает ВСЕ тикеры за 1 запрос (~250), поэтому кэшируем целиком.
 */
async function getCachedAlgoPack(): Promise<AlgoPackResult | null> {
  // 1. Проверяем Redis кэш
  try {
    const cached = await redis.get(ALGOPACK_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      // Проверяем свежесть (не старше 5 мин)
      if (parsed && parsed.date === new Date().toISOString().slice(0, 10)) {
        return parsed as AlgoPackResult;
      }
    }
  } catch { /* ignore Redis errors */ }

  // 2. Запрашиваем свежие данные
  try {
    const result = await fetchAlgoPack();
    if (result.source !== 'none' && result.source !== 'error') {
      // Кэшируем в Redis
      try {
        await redis.setex(ALGOPACK_CACHE_KEY, ALGOPACK_CACHE_TTL, JSON.stringify(result));
      } catch { /* ignore Redis write errors */ }
      return result;
    }
  } catch (e: any) {
    console.warn('[robot-context] AlgoPack fetch failed:', e.message);
  }

  return null;
}

/**
 * Найти данные AlgoPack для конкретного тикера
 */
interface AlgoPackTickerData {
  wallScore: number;
  accumScore: number;
  cancelRatio: number;
  disb: number;
  accumDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
  hasSpoofing: boolean;
  spreadBBO: number;
  imbalanceVol: number;
}

function findAlgoPackData(ticker: string, algopack: AlgoPackResult | null): AlgoPackTickerData {
  const empty: AlgoPackTickerData = {
    wallScore: 0, accumScore: 0, cancelRatio: 0, disb: 0,
    accumDirection: 'NEUTRAL', hasSpoofing: false, spreadBBO: 0, imbalanceVol: 0,
  };

  if (!algopack) return empty;

  // Ищем в стенах
  const wall = algopack.walls.find(w => w.secid === ticker);
  const wallScore = wall?.wallScore ?? 0;

  // Ищем в накоплениях
  const accum = algopack.accumulations.find(a => a.secid === ticker);
  const accumScore = accum?.accumulationScore ?? 0;
  const disb = accum?.disb ?? 0;
  const accumDirection = accum?.direction ?? 'NEUTRAL';
  const cancelRatio = accum?.cancelRatio ?? 0;
  const hasSpoofing = algopack.spoofingTickers.includes(ticker);

  return {
    wallScore,
    accumScore,
    cancelRatio,
    disb,
    accumDirection,
    hasSpoofing,
    spreadBBO: wall?.spread_bbo ?? 0,
    imbalanceVol: wall?.imbalance_vol ?? 0,
  };
}

// ─── Burst Detection для Horizon ─────────────────────────────────────────────

/**
 * Конвертирует сделки из DetectorInput в TradeInput для detect-engine.
 * DetectorInput.trades: { price, quantity, side, time }
 * detect-engine: { timestamp, price, lots, direction }
 */
interface DetectorTrade {
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  time: number | string;
}

function convertTradesForBurst(trades: DetectorTrade[]): TradeInput[] {
  return trades
    .map(t => ({
      timestamp: typeof t.time === 'string' ? new Date(t.time).getTime() / 1000 : t.time,
      price: t.price,
      lots: t.quantity,
      direction: t.side,
    }))
    .filter(t => t.timestamp > 0 && t.price > 0 && t.lots > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Анализирует burst'ы и группирует по паттернам
 */
function analyzeBurstPatterns(bursts: BurstResult[]): {
  patterns: RobotPatternInfo[];
  totalBurstLots: number;
  robotImbalance: number;
} {
  if (bursts.length === 0) {
    return { patterns: [], totalBurstLots: 0, robotImbalance: 0 };
  }

  // Группируем по паттерну
  const patternMap = new Map<string, BurstResult[]>();
  for (const burst of bursts) {
    const key = burst.strategy || 'unknown';
    if (!patternMap.has(key)) patternMap.set(key, []);
    patternMap.get(key)!.push(burst);
  }

  // Конвертируем в RobotPatternInfo
  const PATTERN_NAMES_RU: Record<string, string> = {
    periodic: 'Периодический', fixed_volume: 'Фикс. объём', layered: 'Слоистый',
    iceberg: 'Айсберг', scalper: 'Скальпер', momentum: 'Моментум',
    ping_pong: 'Пинг-понг', market_maker: 'ММ', aggressive: 'Агрессивный',
    slow_grinder: 'Медл. шлифовщик', sweeper: 'Зачистчик', absorber: 'Поглотитель',
    unknown: 'Неизвестный',
  };

  const patterns: RobotPatternInfo[] = [];
  for (const [pattern, patternBursts] of patternMap) {
    const totalLots = patternBursts.reduce((s, b) => s + b.totalLots, 0);
    const buyLots = patternBursts.reduce((s, b) => s + b.buyLots, 0);
    const sellLots = patternBursts.reduce((s, b) => s + b.sellLots, 0);
    const direction = buyLots > sellLots * 1.5 ? 'BUY' : sellLots > buyLots * 1.5 ? 'SELL' : 'MIXED';

    patterns.push({
      pattern,
      patternRu: PATTERN_NAMES_RU[pattern] || pattern,
      level: patternBursts[0]?.level || 'algo',
      count: patternBursts.length,
      totalLots,
      direction,
      avgConfidence: patternBursts.reduce((s, b) => s + b.confidence, 0) / patternBursts.length,
    });
  }

  // Сортируем по totalLots (самые объёмные паттерны первыми)
  patterns.sort((a, b) => b.totalLots - a.totalLots);

  // Общий дисбаланс
  const totalBuy = bursts.reduce((s, b) => s + b.buyLots, 0);
  const totalSell = bursts.reduce((s, b) => s + b.sellLots, 0);
  const totalBurstLots = totalBuy + totalSell;
  const robotImbalance = totalBurstLots > 0
    ? (totalBuy - totalSell) / totalBurstLots
    : 0;

  return { patterns, totalBurstLots, robotImbalance };
}

// ─── Вычисление robotVolumePct ───────────────────────────────────────────────

/**
 * Оценка доли алгоритмического объёма.
 *
 * Формула:
 *   robotVolumePct = clamp(
 *     0.35 × cancelIntensity +      // Высокий cancelRatio = спуфинг/алго
 *     0.35 × burstPct +              // Доля объёма в burst'ах = робот-активность
 *     0.30 × smallTradeAlgoSignal,   // Мелкие сделки при высоком disb = алго
 *     0, 1
 *   )
 *
 * где:
 *   cancelIntensity = min(cancelRatio × 2, 1)     — спуфинг-интенсивность
 *   burstPct = burstVolume / totalTradeVolume       — доля робот-объёма
 *   smallTradeAlgoSignal = disb ? (|disb| × 0.8) : 0 — disb = MOEX metric
 */
function estimateRobotVolumePct(
  cancelRatio: number,
  burstTotalLots: number,
  totalTradeVolume: number,
  disb: number,
): number {
  const cancelIntensity = Math.min(cancelRatio * 2, 1);
  const burstPct = totalTradeVolume > 0 ? Math.min(burstTotalLots / totalTradeVolume, 1) : 0;
  const smallTradeAlgoSignal = Math.abs(disb) > 0 ? Math.min(Math.abs(disb) * 0.8, 1) : 0;

  return Math.min(
    0.35 * cancelIntensity + 0.35 * burstPct + 0.30 * smallTradeAlgoSignal,
    1,
  );
}

// ─── robotConfirmation ───────────────────────────────────────────────────────

/**
 * Вычисляет подтверждение детектора робот-данными.
 *
 * Логика:
 *   1. Находим top-детектор (самый высокий score)
 *   2. Мэппим детектор на робот-паттерн (DETECTOR_PATTERN_MAP)
 *   3. Если паттерн найден → confirmation = f(volume, typeMatch)
 *
 * Шкала:
 *   volume > 60% + typeMatch    → 1.0 (полное подтверждение)
 *   volume > 30% + typeMatch    → 0.7 (сильное подтверждение)
 *   typeMatch + volume < 30%    → 0.5 (мэтч есть, роботов мало)
 *   volume > 60% + partialMatch → 0.6 (косвенный мэтч)
 *   volume > 30% + partialMatch → 0.45 (косвенный, средне роботов)
 *   volume > 60% no match       → 0.4 (роботы есть, но не тот тип)
 *   volume > 30% no match       → 0.25 (слабое)
 *   volume < 30%                → 0.1 (роботов мало)
 */
export interface AlgoPackConfirmation {
  wallScore: number;
  accumScore: number;
  accumDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
  hasSpoofing: boolean;
  cancelRatio: number;
}

// Мэппинг детекторов на AlgoPack-индикаторы
// Когда burst detection не нашёл паттернов (мало сделок),
// AlgoPack всё ещё видит стены и накопления
const DETECTOR_ALGOPACK_MAP: Record<string, ('wall' | 'accum')[]> = {
  ATTRACTOR:   ['accum', 'wall'],   // Цена у уровня + накопление + стена = аттрактор
  ACCRETOR:    ['accum'],           // Накопление через мелкие заявки
  GRAVITON:    ['wall', 'accum'],   // Концентрация объёма = гравитация
  DARKMATTER:  ['wall'],            // Скрытая ликвидность = стена
  PREDATOR:   [],                   // Агрессивная стратегия — не видно в AlgoPack
  HAWKING:    [],                   // VPIN-based — не видно в AlgoPack
  CIPHER:     [],                   // Алгоритмический паттерн — burst only
  WAVEFUNCTION: [],                 // Циклический — burst only
  DECOHERENCE: [],                  // Распад корреляции — burst only
  ENTANGLE:   [],                   // Кросс-тикер — burst only
};

/**
 * Пытается мэтчить детектор с AlgoPack данными.
 * Возвращает { detector, pattern } если мэтч найден, иначе null.
 */
function tryAlgoPackMatch(
  detectorName: string,
  algopack: AlgoPackConfirmation,
): { detector: string; pattern: string } | null {
  const expectedAlgoIndicators = DETECTOR_ALGOPACK_MAP[detectorName] || [];
  if (expectedAlgoIndicators.length === 0) return null;

  let pattern = '';
  if (expectedAlgoIndicators.includes('wall') && algopack.wallScore > 20) {
    pattern = `wall:${algopack.wallScore}`;
  }
  if (expectedAlgoIndicators.includes('accum') && algopack.accumScore > 0) {
    pattern = pattern ? `${pattern}+accum:${algopack.accumScore}` : `accum:${algopack.accumScore}`;
  }

  return pattern ? { detector: detectorName, pattern } : null;
}

export function computeRobotConfirmation(
  topDetectorName: string,
  robotVolumePct: number,
  robotPatterns: RobotPatternInfo[],
  algopack?: AlgoPackConfirmation,
): { confirmation: number; matchedPattern: string; matchedDetector: string } {

  // Ищем мэтч между детектором и обнаруженными паттернами
  const expectedPatterns = DETECTOR_PATTERN_MAP[topDetectorName] || [];
  let matchedPattern = '';
  let matchedDetector = '';
  let typeMatch = false;
  let partialMatch = false;  // косвенный мэтч через обратный маппинг
  let algopackMatch = false; // мэтч через AlgoPack (стена/накопление)

  // 1. Прямой мэтч: топ-детектор → ожидаемый робот-паттерн
  for (const rp of robotPatterns) {
    if (expectedPatterns.includes(rp.pattern)) {
      matchedPattern = rp.pattern;
      matchedDetector = topDetectorName;
      typeMatch = true;
      break;
    }
  }

  // 2. Косвенный мэтч: обнаруженный паттерн → другой детектор
  //    (роботы есть, но подтверждают не топ-детектор, а другой)
  if (!typeMatch && robotPatterns.length > 0) {
    const topPattern = robotPatterns[0]; // уже отсортированы по объёму
    const mappedDetector = PATTERN_DETECTOR_MAP[topPattern.pattern];
    if (mappedDetector) {
      matchedPattern = topPattern.pattern;
      matchedDetector = mappedDetector;
      partialMatch = true;
    }
  }

  // 3. AlgoPack мэтч: стена/накопление подтверждает детектор
  //    Ключевое исправление: когда burst detection не нашёл паттернов
  //    (мало сделок, нет данных), AlgoPack всё ещё видит стены и накопления
  //    Проверяем ВСЕ детекторы с AlgoPack маппингом, не только топовый,
  //    потому что топовый может не иметь AlgoPack мэтча (например WAVEFUNCTION)
  if (!typeMatch && !partialMatch && algopack) {
    // Сначала пробуем топовый детектор
    let found = tryAlgoPackMatch(topDetectorName, algopack);
    if (!found) {
      // Если топовый не мэтчит, пробуем все детекторы с AlgoPack маппингом
      for (const detName of Object.keys(DETECTOR_ALGOPACK_MAP)) {
        const indicators = DETECTOR_ALGOPACK_MAP[detName];
        if (indicators.length === 0) continue;
        found = tryAlgoPackMatch(detName, algopack);
        if (found) break;
      }
    }
    if (found) {
      algopackMatch = true;
      matchedDetector = found.detector;
      matchedPattern = found.pattern;
    }
  }

  // 4. Если нет мэтча вообще, но роботов много — отмечаем детектор
  if (!typeMatch && !partialMatch && !algopackMatch && robotPatterns.length > 0) {
    matchedDetector = topDetectorName;
    matchedPattern = robotPatterns[0]?.pattern || '';
  }

  // Вычисляем confirmation:
  //   typeMatch     = робот-паттерн подтверждает именно этот детектор
  //   partialMatch  = робот-паттерн подтверждает другой детектор (но роботы есть)
  //   algopackMatch = AlgoPack подтверждает детектор (стена/накопление)
  let confirmation: number;
  if (typeMatch && robotVolumePct > 0.6) {
    confirmation = 1.0;   // полное подтверждение: много роботов + тип мэтчится
  } else if (typeMatch && robotVolumePct > 0.3) {
    confirmation = 0.7;   // сильное подтверждение
  } else if (typeMatch) {
    confirmation = 0.5;   // мэтч есть, но роботов мало
  } else if (partialMatch && robotVolumePct > 0.6) {
    confirmation = 0.6;   // косвенный мэтч + много роботов
  } else if (partialMatch && robotVolumePct > 0.3) {
    confirmation = 0.45;  // косвенный, средне роботов
  } else if (algopackMatch && robotVolumePct > 0.3) {
    confirmation = 0.5;   // AlgoPack подтверждает + роботов достаточно
  } else if (algopackMatch) {
    confirmation = 0.35;  // AlgoPack подтверждает, но роботов мало
  } else if (robotVolumePct > 0.6) {
    confirmation = 0.4;   // роботов много, но тип не мэтчится
  } else if (robotVolumePct > 0.3) {
    confirmation = 0.25;  // слабое
  } else {
    confirmation = 0.1;   // роботов мало
  }

  return { confirmation, matchedPattern, matchedDetector };
}

// ─── Главная функция ─────────────────────────────────────────────────────────

/**
 * Вычисляет полный RobotContext для тикера.
 *
 * @param ticker — MOEX тикер (например, 'SBER', 'GAZP')
 * @param trades — Сделки из collectMarketData (для burst detection)
 * @param topDetectorName — Имя детектора с максимальным score
 * @param totalTradeVolume — Общий объём сделок (в лотах)
 */
export async function calculateRobotContext(
  ticker: string,
  trades: DetectorTrade[],
  topDetectorName: string,
  totalTradeVolume: number,
): Promise<RobotContext> {
  let source: RobotContext['source'] = 'none';
  let robotPatterns: RobotPatternInfo[] = [];
  let burstTotalLots = 0;
  let robotImbalance = 0;
  let avgRobotOrderSize = 0;
  let avgHumanOrderSize = 0;
  let burstCount = 0;

  // ── 1. Burst Detection (из наших сделок) ───────────────────────────────
  const tradeInputs = convertTradesForBurst(trades);
  if (tradeInputs.length >= 5) {
    try {
      const bursts = detectBurstsMultiLevel(
        tradeInputs,
        ticker,
        '',  // figi не нужен для анализа паттернов
        totalTradeVolume,
        0,   // dailyValue — approximate
        'horizon-scan',
      );

      burstCount = bursts.length;
      const burstAnalysis = analyzeBurstPatterns(bursts);
      robotPatterns = burstAnalysis.patterns;
      burstTotalLots = burstAnalysis.totalBurstLots;
      robotImbalance = burstAnalysis.robotImbalance;

      // Средний размер робот-сделки (из burst'ов)
      const burstTradeSizes: number[] = [];
      const nonBurstTradeSizes: number[] = [];
      const burstTimestamps = new Set<number>();
      for (const burst of bursts) {
        for (let ts = burst.tsStart; ts <= burst.tsEnd; ts += 0.001) {
          burstTimestamps.add(Math.round(ts * 1000) / 1000);
        }
      }
      for (const trade of tradeInputs) {
        const ts = Math.round(trade.timestamp * 1000) / 1000;
        const size = trade.price * trade.lots;
        if (burstTimestamps.has(ts)) {
          burstTradeSizes.push(size);
        } else {
          nonBurstTradeSizes.push(size);
        }
      }
      avgRobotOrderSize = burstTradeSizes.length > 0
        ? burstTradeSizes.reduce((s, v) => s + v, 0) / burstTradeSizes.length
        : 0;
      avgHumanOrderSize = nonBurstTradeSizes.length > 0
        ? nonBurstTradeSizes.reduce((s, v) => s + v, 0) / nonBurstTradeSizes.length
        : trades.length > 0
          ? trades.reduce((s, t) => s + t.price * t.quantity, 0) / trades.length
          : 0;

      if (burstCount > 0) source = 'burst';
    } catch (e: any) {
      console.warn(`[robot-context] Burst detection failed for ${ticker}:`, e.message);
    }
  }

  // ── 2. AlgoPack (кэшированный) ─────────────────────────────────────────
  let algopackData = await findAlgoPackDataAsync(ticker);
  if (algopackData.wallScore > 0 || algopackData.accumScore > 0) {
    source = source === 'burst' ? 'algopack+burst' : 'algopack';
  }

  // ── 3. robotVolumePct ──────────────────────────────────────────────────
  const robotVolumePct = estimateRobotVolumePct(
    algopackData.cancelRatio,
    burstTotalLots,
    totalTradeVolume,
    algopackData.disb,
  );

  // ── 4. robotConfirmation ───────────────────────────────────────────────
  const { confirmation, matchedPattern, matchedDetector } = computeRobotConfirmation(
    topDetectorName,
    robotVolumePct,
    robotPatterns,
    {
      wallScore: algopackData.wallScore,
      accumScore: algopackData.accumScore,
      accumDirection: algopackData.accumDirection,
      hasSpoofing: algopackData.hasSpoofing,
      cancelRatio: algopackData.cancelRatio,
    },
  );

  return {
    ticker,
    robotVolumePct: Math.round(robotVolumePct * 1000) / 1000,
    robotPatterns,
    robotImbalance: Math.round(robotImbalance * 1000) / 1000,
    avgRobotOrderSize: Math.round(avgRobotOrderSize * 100) / 100,
    avgHumanOrderSize: Math.round(avgHumanOrderSize * 100) / 100,
    wallScore: algopackData.wallScore,
    accumScore: algopackData.accumScore,
    cancelRatio: Math.round(algopackData.cancelRatio * 1000) / 1000,
    disb: Math.round(algopackData.disb * 1000) / 1000,
    accumDirection: algopackData.accumDirection,
    hasSpoofing: algopackData.hasSpoofing,
    confirmation: Math.round(confirmation * 100) / 100,
    matchedPattern,
    matchedDetector,
    burstCount,
    burstTotalLots,
    source,
  };
}

/**
 * Асинхронная версия findAlgoPackData — запрашивает AlgoPack с кэшем
 */
async function findAlgoPackDataAsync(ticker: string): Promise<AlgoPackTickerData> {
  try {
    const algopack = await getCachedAlgoPack();
    return findAlgoPackData(ticker, algopack);
  } catch (e: any) {
    console.warn(`[robot-context] AlgoPack lookup failed for ${ticker}:`, e.message);
    return {
      wallScore: 0, accumScore: 0, cancelRatio: 0, disb: 0,
      accumDirection: 'NEUTRAL', hasSpoofing: false, spreadBBO: 0, imbalanceVol: 0,
    };
  }
}

// ─── Утилита: определить top-детектор ────────────────────────────────────────

/**
 * Находит детектор с максимальным score из мапы detectorScores.
 */
export function findTopDetector(detectorScores: Record<string, number>): string {
  let topName = 'NONE';
  let topScore = 0;
  for (const [name, score] of Object.entries(detectorScores)) {
    if (score > topScore) {
      topScore = score;
      topName = name;
    }
  }
  return topName;
}

// ─── Утилита: определить, подтверждён ли детектор роботами ───────────────────

/**
 * Быстрая проверка: даёт ли RobotContext бонус к convergence/10.
 * Условие: confirmation ≥ 0.4
 *   0.4+ = роботы есть и подтверждены (прямой или косвенный мэтч)
 *   <0.4 = роботов мало или паттерн неизвестен
 */
export function isRobotConfirmed(robotContext: RobotContext | null | undefined): boolean {
  if (!robotContext) return false;
  return robotContext.confirmation >= 0.4;
}
