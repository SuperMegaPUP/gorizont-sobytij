import { create } from 'zustand';
import type { DashboardStore, RobotEvent, TickerAgg, TickerDurationAgg, RobotProfile, OiSnapshot, Signal, FutoiInstrument, Direction } from './types';
import { PATTERNS } from './static-data';
import { toMoscowTime, splitLots } from './helpers';

// ─── Константы аномалий ───
const ANOMALY_BLINK_MS = 60 * 1000;     // 1 минута мигания
const ANOMALY_TTL_MS = 10 * 60 * 1000;  // 10 минут жизни в дашборде

// ─── Хелпер: пересчёт сигналов из tickerAggs (v2) ─────────────────────────
// Используется при useLoadedAggs=true, когда windowEvts пустые
//
// СИГНАЛЫ v2: абсолютная шкала [0,100] + AlgoPack кросс-подтверждение
// signalScore = concentration × persistence × (0.3 + 0.7 × volumeAnomaly) × algoConfirm × 100
// Фильтры: events >= 3, totalLots >= 5000
// Классификация по SCORE: СИЛЬНЫЙ >= 50, СРЕДНИЙ >= 25
function recalcSignalsFromAggs(
  aggs: TickerAgg[],
  nowMs: number,
  algopackWalls: import('./types').WallScoreEntry[] = [],
  algopackAccumulations: import('./types').AccumScoreEntry[] = [],
): Signal[] {
  // Медиана avgLotsPerEvent для volumeAnomaly
  const avgLotsArr = aggs.filter(t => t.events > 0).map(t => t.totalLots / t.events).sort((a, b) => a - b);
  const medianAvgLots = avgLotsArr.length > 0 ? avgLotsArr[Math.floor(avgLotsArr.length / 2)] : 1;

  // Индекс AlgoPack по тикеру для кросс-подтверждения
  const wallMap = new Map<string, import('./types').WallScoreEntry>();
  for (const w of algopackWalls) wallMap.set(w.secid, w);
  const accumMap = new Map<string, import('./types').AccumScoreEntry>();
  for (const a of algopackAccumulations) accumMap.set(a.secid, a);

  const result: Signal[] = [];
  for (const t of aggs) {
    if (t.events < 3) continue;
    const total = t.buyLots + t.sellLots;
    if (total < 5000) continue; // Фильтр: минимум 5000 лотов для статистической значимости
    const deltaPct = total > 0 ? ((t.buyLots - t.sellLots) / total) * 100 : 0;
    if (deltaPct === 0) continue;
    const dir: 'LONG' | 'SHORT' = deltaPct > 0 ? 'LONG' : 'SHORT';

    // concentration: направленная концентрация силы (0-1)
    const concentration = total > 0 ? Math.abs(t.deltaNet) / total : 0;
    // persistence: устойчивость программы (8+ событий = 1.0)
    const persistence = Math.min(t.events / 8, 1);
    // volumeAnomaly: аномалия объёма относительно медианы
    const avgLots = t.events > 0 ? t.totalLots / t.events : 0;
    const volumeAnomaly = medianAvgLots > 0 ? Math.log(1 + avgLots / medianAvgLots) / Math.log(11) : 0;

    // algoConfirm: кросс-подтверждение из AlgoPack
    let algoConfirm = 1.0;
    const wall = wallMap.get(t.ticker);
    const accum = accumMap.get(t.ticker);
    const wallConfirms = wall && (
      (dir === 'LONG' && wall.volDomination === 'BID') ||
      (dir === 'SHORT' && wall.volDomination === 'ASK')
    );
    const accumConfirms = accum && (
      (dir === 'LONG' && accum.direction === 'LONG') ||
      (dir === 'SHORT' && accum.direction === 'SHORT')
    );
    if (wallConfirms && accumConfirms) algoConfirm = 1.5;       // Оба подтверждают
    else if (accumConfirms) algoConfirm = 1.3;                   // ЛОКАТОР подтверждает
    else if (wallConfirms) algoConfirm = 1.2;                    // СТАКАН подтверждает

    // Signal Score v2: абсолютная шкала [0, 100]
    const rawScore = concentration * persistence * (0.3 + 0.7 * volumeAnomaly) * algoConfirm;
    const signalScore = Math.min(Math.round(rawScore * 100 * 10) / 10, 100);

    // Классификация по SCORE (не по жёстким порогам)
    let strength: 'STRONG' | 'MEDIUM' | 'WEAK' = 'WEAK';
    if (signalScore >= 50 && t.events >= 5) strength = 'STRONG';
    else if (signalScore >= 25 && t.events >= 3) strength = 'MEDIUM';

    if (strength !== 'WEAK') {
      result.push({
        id: `sig-${t.ticker}-${dir}`, ticker: t.ticker, direction: dir,
        events: t.events, lots: dir === 'LONG' ? t.buyLots : t.sellLots, score: signalScore,
        priceImpact: t.priceImpact, strength, avgConfidence: t.avgConfidence,
        algoConfirm, ts: nowMs,
      });
    }
  }
  return result;
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  events: [],
  windowEvents: [],
  instruments: [],
  fearGreedIndex: 50,
  topTickers: [],
  strategyDistribution: [],
  hourlyActivity: [],
  anomalies: [],
  activeFilter: null,
  lastUpdate: '--:--:--',
  buyLots: 0,
  sellLots: 0,
  totalEvents: 0,
  connected: false,
  dataSource: 'none',
  apiError: '',
  futoiInstruments: [],
  compositeSMI: 0,
  compositeDirection: 'neutral',
  futoiSource: 'none',
  futoiRealtime: false,
  calendarDays: [],
  oiHistory: {},
  tickerAggs: [],
  durationBuckets: [],
  tickerDurationAggs: [],
  timeBuckets: [],
  signals: [],
  // AlgoPack (СТАКАН-СКАНЕР + ЛОКАТОР КРУПНЯКА)
  algopack: { walls: [], accumulations: [], spoofingTickers: [], totalTickers: 0, source: 'none', tradetime: '', date: '', topTickers: [] },
  // DB fields
  dbLoaded: false,
  dbTradeDate: '',
  // Загрузка метрик из БД при старте
  loadFromDb: (data) => set((state) => {
    const updates: Partial<DashboardStore> = { dbLoaded: true };
    // Проверяем свежесть: не загружаем данные за прошлый день
    const today = new Date().toISOString().slice(0, 10);
    if (data.date && data.date !== today) {
      console.warn(`[loadFromDb] Stale data for ${data.date}, skipping (today: ${today})`);
      return { dbLoaded: true };
    }
    if (data.date) updates.dbTradeDate = data.date;
    // Волна (5-минутные бакеты) — фильтруем: только за последние 4 часа, без будущих окон
    if (data.waveBuckets?.length > 0) {
      const now = new Date();
      const msk = toMoscowTime(now);
      const curHour = msk.getHours();
      const curMin5 = Math.floor(msk.getMinutes() / 5) * 5;
      const currentWindowNum = curHour * 60 + curMin5; // текущее окно в минутах от начала дня
      const fourHoursAgoNum = currentWindowNum - 4 * 60;

      updates.timeBuckets = data.waveBuckets
        .map((b: any) => ({
          window: b.window, events: b.events, buyLots: b.buyLots, sellLots: b.sellLots, delta: b.delta,
        }))
        .filter(b => {
          const [h, m] = b.window.split(':').map(Number);
          const bucketNum = h * 60 + m;
          // Только бакеты за последние 4 часа и не в будущем
          return bucketNum >= fourHoursAgoNum && bucketNum <= currentWindowNum;
        })
        .sort((a, b) => a.window.localeCompare(b.window))
        .slice(-48);
    }
    // Fear & Greed
    if (data.fearGreedIndex !== undefined) updates.fearGreedIndex = data.fearGreedIndex;
    // Восстановление buyLots/sellLots — приоритетно из прямых полей, fallback из FG снапшота
    if (data.buyLots > 0 || data.sellLots > 0) {
      updates.buyLots = data.buyLots;
      updates.sellLots = data.sellLots;
    } else if (data.fearGreedHistory?.length > 0) {
      const lastFGSnap = data.fearGreedHistory[data.fearGreedHistory.length - 1];
      if (lastFGSnap.buyLots > 0 || lastFGSnap.sellLots > 0) {
        updates.buyLots = lastFGSnap.buyLots;
        updates.sellLots = lastFGSnap.sellLots;
      }
    }
    // totalEvents — приоритетно из прямого поля, fallback из tickerAggs
    if (data.totalEvents > 0) {
      updates.totalEvents = data.totalEvents;
    } else if (data.tickerAggs?.length > 0) {
      updates.totalEvents = data.tickerAggs.reduce((sum: number, a: any) => sum + (a.events || 0), 0);
    }
    // Сигналы v2 — показываем только за последние 30 мин (старые неактуальны для трейдеров)
    // В БД сигналы хранятся 7 дней для аналитики, но в дашборде — только свежие
    if (data.signals?.length > 0) {
      const now = Date.now();
      updates.signals = data.signals
        .filter((s: any) => now - s.ts < 30 * 60 * 1000)  // 30 мин TTL для отображения
        .map((s: any) => ({
          id: s.id || `sig-${s.ticker}-${s.direction}`, ticker: s.ticker, direction: s.direction,
          events: s.events, lots: s.lots, score: s.score ?? 0, priceImpact: s.priceImpact,
          strength: s.strength, avgConfidence: s.avgConfidence ?? 0,
          algoConfirm: s.algoConfirm ?? 1.0, ts: s.ts,
        }));
    }
    // Если сигналов нет в БД, но есть tickerAggs — пересчитываем сигналы из агрегаций (v2)
    if ((!updates.signals || (updates.signals as Signal[]).length === 0) && data.tickerAggs?.length > 0) {
      const nowMs = Date.now();
      const recalcSignals = recalcSignalsFromAggs(
        data.tickerAggs, nowMs,
        state.algopack.walls, state.algopack.accumulations,
      );
      if (recalcSignals.length > 0) updates.signals = recalcSignals;
    }
    // Часовая активность
    if (data.hourlyActivity?.length > 0) {
      updates.hourlyActivity = data.hourlyActivity.map((h: any) => ({ hour: h.hour, buy: h.buy, sell: h.sell }));
    }
    // OI история
    if (data.oiSnapshots?.length > 0) {
      const oiHist: Record<string, OiSnapshot[]> = { ...state.oiHistory };
      for (const snap of data.oiSnapshots) {
        const arr = oiHist[snap.ticker] || [];
        arr.push({ ts: snap.ts, time: snap.time, yurLong: snap.yurLong, yurShort: snap.yurShort, fizLong: snap.fizLong, fizShort: snap.fizShort });
        oiHist[snap.ticker] = arr;
      }
      updates.oiHistory = oiHist;
    }
    // Аномалии
    if (data.anomalies?.length > 0) {
      const now = Date.now();
      updates.anomalies = data.anomalies.map((a: any) => ({
        id: a.id, ticker: a.ticker, direction: a.direction, lots: a.lots, pattern: a.pattern,
        confidence: a.confidence, percentOfDay: a.percentOfDay, priceImpact: a.priceImpact,
        level: a.level, ts: a.ts, blinkUntil: a.ts + 60 * 1000,  // Мигаем 1 мин от момента создания
      }));
    }
    // TickerAggs
    if (data.tickerAggs?.length > 0) {
      updates.tickerAggs = data.tickerAggs.map((a: any) => ({
        ticker: a.ticker, events: a.events, buyLots: a.buyLots, sellLots: a.sellLots,
        deltaNet: a.deltaNet, totalLots: a.totalLots, direction: a.direction as 'LONG' | 'SHORT' | 'NEUTRAL',
        score: a.score || a.influence || 0, avgConfidence: a.avgConfidence, priceImpact: a.priceImpact,
      }));
    }
    // DurationBuckets (ранее НЕ восстанавливались из БД)
    if (data.durationBuckets?.length > 0) {
      updates.durationBuckets = data.durationBuckets.map((b: any) => ({
        label: b.label, rangeSec: b.rangeSec || [0, Infinity], events: b.events,
        lots: b.lots, avgConfidence: b.avgConfidence, buyLots: b.buyLots, sellLots: b.sellLots,
      }));
    }
    // TickerDurationAggs — восстановление с новыми полями v2
    if (data.tickerDurationAggs?.length > 0) {
      updates.tickerDurationAggs = data.tickerDurationAggs.map((a: any) => ({
        ticker: a.ticker, events: a.events, direction: (a.direction || 'NEUTRAL') as 'LONG' | 'SHORT' | 'NEUTRAL',
        buyLots: a.buyLots, sellLots: a.sellLots, deltaNet: a.deltaNet,
        lastTime: a.lastTime || '', avgConfidence: a.avgConfidence,
        hftLots: a.hftLots || 0, scalperLots: a.scalperLots || 0, impulseLots: a.impulseLots || 0,
        structuralLots: a.structuralLots || 0, accumulationLots: a.accumulationLots || 0,
        score: a.score || a.influence || 0, priceImpact: a.priceImpact || 0, patterns: a.patterns || [],
        robotProfile: a.robotProfile || 'МУЛЬТИ', algoConfirm: a.algoConfirm ?? 1.0,
      }));
    }
    // StrategyDistribution (ранее НЕ восстанавливалась из БД)
    if (data.strategyDistribution?.length > 0) {
      updates.strategyDistribution = data.strategyDistribution.map((s: any) => ({
        name: s.name, count: s.count, percentage: s.percentage, color: s.color,
      }));
    }
    // Events — последние 50 событий для восстановления ленты (ранее НЕ сохранялись)
    if (data.events?.length > 0) {
      const nowMs = Date.now();
      updates.events = data.events.map((e: any) => ({
        id: e.id, ts: e.ts, ticker: e.ticker, direction: e.direction as Direction,
        lots: e.lots, buyLots: e.buyLots || 0, sellLots: e.sellLots || 0,
        pattern: e.pattern, confidence: e.confidence, wap: e.wap, delta: e.delta,
        duration: e.duration, durationSec: e.durationSec, percentOfDay: e.percentOfDay,
        priceImpact: e.priceImpact, spreadImpact: e.spreadImpact,
        source: e.source, level: e.level, levelRu: e.levelRu, time: e.time,
        isNew: false,  // При восстановлении не мигаем
      }));
      // Восстанавливаем windowEvents из тех же событий (30-мин окно)
      const windowMs = 30 * 60 * 1000;
      updates.windowEvents = (updates.events as RobotEvent[]).filter((e: RobotEvent) => (nowMs - e.ts) < windowMs);
    }
    return updates;
  }),
  setFilter: (filter) => set({ activeFilter: filter }),
  setConnected: (v) => set({ connected: v }),
  setDataSource: (v) => set({ dataSource: v }),
  setApiError: (v) => set({ apiError: v }),
  updateInstruments: (instruments) => set({ instruments }),
  updateStats: (stats) => set(stats),
  updateFutoi: (instruments, compositeSMI, compositeDirection, source, realtime) => set({ futoiInstruments: instruments, compositeSMI, compositeDirection, futoiSource: source || 'none', futoiRealtime: realtime || false }),
  updateCalendar: (days) => set({ calendarDays: days }),
  pushOiHistory: (instruments) => set((state) => {
    const nowDate = new Date();
    const msk = toMoscowTime(nowDate);
    const timeStr = msk.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const MAX_POINTS = 180; // ~6 часов при polling каждые 2 мин
    const newHistory: Record<string, OiSnapshot[]> = { ...state.oiHistory };
    for (const inst of instruments) {
      const snap: OiSnapshot = {
        ts: nowDate.getTime(),
        time: timeStr,
        yurLong: inst.yur.pos_long,
        yurShort: Math.abs(inst.yur.pos_short),
        fizLong: inst.fiz.pos_long,
        fizShort: Math.abs(inst.fiz.pos_short),
      };
      const arr = [...(newHistory[inst.ticker] || []), snap];
      // Убираем дубли по времени (одна точка в минуту)
      const deduped = arr.filter((s, i) => i === 0 || s.time !== arr[i - 1].time);
      newHistory[inst.ticker] = deduped.slice(-MAX_POINTS);
    }
    return { oiHistory: newHistory };
  }),
  updateAlgoPack: (data) => set({ algopack: data }),
  addEvent: (event) =>
    set((state) => {
      const nowMs = Date.now();
      const WINDOW_MS = 30 * 60 * 1000; // 30 минут

      // ─── 1. Display events (последние 50) ───
      const newEvents = [event, ...state.events].slice(0, 50);

      // ─── 2. Sliding window (30 мин) ───
      let windowEvts = [event, ...state.windowEvents].filter(e => (nowMs - e.ts) < WINDOW_MS);

      // Если данных в окне мало и есть загруженные из БД агрегации — сохраняем их
      // (addEvent пересчитывает из windowEvents, но после loadFromDb окно пустое)
      const useLoadedAggs = windowEvts.length < 3 && state.dbLoaded && state.tickerAggs.length > 0;

      // ─── 3. Агрегация по тикерам (Фрейм 1) ───
      const tickerMap = new Map<string, TickerAgg>();
      for (const e of windowEvts) {
        const [eBuy, eSell] = splitLots(e);
        const existing = tickerMap.get(e.ticker);
        if (existing) {
          existing.events += 1;
          existing.buyLots += eBuy;
          existing.sellLots += eSell;
          existing.deltaNet += eBuy - eSell;
          existing.totalLots += eBuy + eSell;  // eBuy + eSell = e.lots (гарантируется выше)
          existing.avgConfidence = (existing.avgConfidence * (existing.events - 1) + e.confidence) / existing.events;
          existing.priceImpact += e.priceImpact;
        } else {
          tickerMap.set(e.ticker, {
            ticker: e.ticker, events: 1, buyLots: eBuy, sellLots: eSell,
            deltaNet: eBuy - eSell, totalLots: eBuy + eSell, direction: 'NEUTRAL',
            score: 0, avgConfidence: e.confidence, priceImpact: e.priceImpact,
          });
        }
      }
      const tickerAggs = Array.from(tickerMap.values()).map(t => {
        const total = t.buyLots + t.sellLots;
        const deltaPct = total > 0 ? ((t.buyLots - t.sellLots) / total) * 100 : 0;
        return { ...t, direction: deltaPct > 10 ? 'LONG' as const : deltaPct < -10 ? 'SHORT' as const : 'NEUTRAL' as const };
      });

      // ─── 3b. Composite Score — замена % влияния ───
      // Score = aggression × persistence × (0.3 + 0.7 × volumeAnomaly)
      // aggression:   |deltaNet| / totalLots — направленная агрессия (0..1)
      // persistence:  min(events / 6, 1) — устойчивость программы (6+ событий = 1.0)
      // volumeAnomaly: log(1 + avgLotsPerEvent / medianAvgLots) — аномалия объёма
      // Не зависит от VOLTODAY, времени дня или новостей!
      const avgLotsArr = tickerAggs.filter(t => t.events > 0).map(t => t.totalLots / t.events).sort((a, b) => a - b);
      const medianAvgLots = avgLotsArr.length > 0 ? avgLotsArr[Math.floor(avgLotsArr.length / 2)] : 1;
      for (const t of tickerAggs) {
        const total = t.buyLots + t.sellLots;
        const aggression = total > 0 ? Math.abs(t.deltaNet) / total : 0;
        const persistence = Math.min(t.events / 6, 1);
        const avgLots = t.events > 0 ? t.totalLots / t.events : 0;
        const volAnomaly = medianAvgLots > 0 ? Math.log(1 + avgLots / medianAvgLots) / Math.log(11) : 0; // нормализуем: 10x=1.0
        t.score = Math.round(aggression * persistence * (0.3 + 0.7 * volAnomaly) * 100) / 100;
      }
      tickerAggs.sort((a, b) => b.score - a.score);

      // ─── 4. Бакеты длительности (Фрейм 2) — 5 уровней v2.0 ───
      const bucketDefs: { label: string; rangeSec: [number, number] }[] = [
        { label: '0-3с HFT', rangeSec: [0, 3] },
        { label: '3-30с Скальп', rangeSec: [3, 30] },
        { label: '30с-2м Импульс', rangeSec: [30, 120] },
        { label: '2-10м Структур', rangeSec: [120, 600] },
        { label: '10+м Накоплен', rangeSec: [600, Infinity] },
      ];
      const durationBuckets = bucketDefs.map(def => {
        const bEvts = windowEvts.filter(e => e.durationSec >= def.rangeSec[0] && e.durationSec < def.rangeSec[1]);
        let bBuy = 0, bSell = 0;
        for (const e of bEvts) { const [b, s] = splitLots(e); bBuy += b; bSell += s; }
        return {
          label: def.label, rangeSec: def.rangeSec, events: bEvts.length,
          lots: bBuy + bSell,
          avgConfidence: bEvts.length > 0 ? bEvts.reduce((s, e) => s + e.confidence, 0) / bEvts.length : 0,
          buyLots: bBuy, sellLots: bSell,
        };
      });

      // ─── 4b. Агрегация по тикерам + длительность (Фрейм 2 переработка) ───
      const tdMap = new Map<string, TickerDurationAgg>();
      for (const e of windowEvts) {
        const [eBuy, eSell] = splitLots(e);
        const existing = tdMap.get(e.ticker);
        // Классифицируем лот по длительности (5 уровней v2.0)
        const isHft = e.durationSec < 3;
        const isScalper = e.durationSec >= 3 && e.durationSec < 30;
        const isImpulse = e.durationSec >= 30 && e.durationSec < 120;
        const isStructural = e.durationSec >= 120 && e.durationSec < 600;
        const isAccumulation = e.durationSec >= 600;
        if (existing) {
          existing.events += 1;
          existing.buyLots += eBuy;
          existing.sellLots += eSell;
          existing.deltaNet += eBuy - eSell;
          existing.avgConfidence = (existing.avgConfidence * (existing.events - 1) + e.confidence) / existing.events;
          existing.priceImpact += e.priceImpact;
          if (isHft) existing.hftLots += eBuy + eSell;
          if (isScalper) existing.scalperLots += eBuy + eSell;
          if (isImpulse) existing.impulseLots += eBuy + eSell;
          if (isStructural) existing.structuralLots += eBuy + eSell;
          if (isAccumulation) existing.accumulationLots += eBuy + eSell;
          if (e.ts > (existing as any)._lastTs) { existing.lastTime = e.time; (existing as any)._lastTs = e.ts; }
          if (!existing.patterns.includes(e.pattern)) existing.patterns.push(e.pattern);
        } else {
          tdMap.set(e.ticker, {
            ticker: e.ticker, events: 1, buyLots: eBuy, sellLots: eSell,
            deltaNet: eBuy - eSell, direction: 'NEUTRAL', lastTime: e.time,
            avgConfidence: e.confidence,
            hftLots: isHft ? eBuy + eSell : 0,
            scalperLots: isScalper ? eBuy + eSell : 0,
            impulseLots: isImpulse ? eBuy + eSell : 0,
            structuralLots: isStructural ? eBuy + eSell : 0,
            accumulationLots: isAccumulation ? eBuy + eSell : 0,
            score: 0, priceImpact: e.priceImpact,
            patterns: [e.pattern],
            _lastTs: e.ts,
          } as any);
        }
      }
      const tickerDurationAggsRaw = Array.from(tdMap.values()).map(t => {
        const total = t.buyLots + t.sellLots;
        const deltaPct = total > 0 ? ((t.buyLots - t.sellLots) / total) * 100 : 0;
        // Порог направления 20% (было 10%) — 55/45 уже не "Пок"
        const dir: 'LONG' | 'SHORT' | 'NEUTRAL' = deltaPct > 20 ? 'LONG' : deltaPct < -20 ? 'SHORT' : 'NEUTRAL';
        const clean = { ...t, direction: dir };
        delete (clean as any)._lastTs;
        return clean as TickerDurationAgg & { _lastTs?: number };
      });

      // ─── Activity Score v2: dominanceWeight × aggression × persistence × (0.3 + 0.7 × volumeAnomaly) × algoConfirm × 100 ───
      // + фильтр ликвидности: events >= 3, totalLots >= 5000
      // + профиль робота: HFT / СКАЛЬП / ИМПУЛЬС / СТРУКТУР / НАКОПЛ / МУЛЬТИ

      // АлgoPack индекс для кросс-подтверждения
      const wallMapTd = new Map<string, import('./types').WallScoreEntry>();
      for (const w of state.algopack.walls) wallMapTd.set(w.secid, w);
      const accumMapTd = new Map<string, import('./types').AccumScoreEntry>();
      for (const a of state.algopack.accumulations) accumMapTd.set(a.secid, a);

      // Медиана avgLots для volumeAnomaly
      const tdAvgLots = tickerDurationAggsRaw.filter(t => t.events > 0).map(t => (t.buyLots + t.sellLots) / t.events).sort((a, b) => a - b);
      const tdMedian = tdAvgLots.length > 0 ? tdAvgLots[Math.floor(tdAvgLots.length / 2)] : 1;

      const tickerDurationAggs: TickerDurationAgg[] = [];
      for (const t of tickerDurationAggsRaw) {
        const total = t.buyLots + t.sellLots;

        // Фильтр ликвидности: минимум 3 события и 5000 лотов
        if (t.events < 3) continue;
        if (total < 5000) continue;

        // aggression: направленная агрессия (0-1)
        const aggression = total > 0 ? Math.abs(t.deltaNet) / total : 0;
        // persistence: устойчивость программы (6+ событий = 1.0)
        const persistence = Math.min(t.events / 6, 1);
        // volumeAnomaly: аномалия объёма
        const avgLots = t.events > 0 ? total / t.events : 0;
        const volAnomaly = tdMedian > 0 ? Math.log(1 + avgLots / tdMedian) / Math.log(11) : 0;

        // dominanceWeight: доминирование одного типа робота (0.5–1.0)
        const hftPct = total > 0 ? t.hftLots / total : 0;
        const scalperPct = total > 0 ? t.scalperLots / total : 0;
        const impulsePct = total > 0 ? t.impulseLots / total : 0;
        const structuralPct = total > 0 ? t.structuralLots / total : 0;
        const accumPct = total > 0 ? t.accumulationLots / total : 0;
        const maxPct = Math.max(hftPct, scalperPct, impulsePct, structuralPct, accumPct);
        const dominanceWeight = 0.5 + 0.5 * maxPct;

        // robotProfile: авто-классификация доминирующего типа
        let robotProfile: RobotProfile = 'МУЛЬТИ';
        const above20 = [hftPct, scalperPct, impulsePct, structuralPct, accumPct].filter(p => p >= 0.2).length;
        if (above20 >= 2) {
          robotProfile = 'МУЛЬТИ'; // Несколько типов ≥ 20%
        } else if (hftPct >= 0.5) {
          robotProfile = 'HFT';
        } else if (scalperPct >= 0.5) {
          robotProfile = 'СКАЛЬП';
        } else if (impulsePct >= 0.3) {
          robotProfile = 'ИМПУЛЬС';
        } else if (structuralPct >= 0.3) {
          robotProfile = 'СТРУКТУР';
        } else if (accumPct >= 0.3) {
          robotProfile = 'НАКОПЛ';
        }

        // algoConfirm: кросс-подтверждение из AlgoPack (как в СИГНАЛЫ)
        let algoConfirm = 1.0;
        const wall = wallMapTd.get(t.ticker);
        const accum = accumMapTd.get(t.ticker);
        const isBuy = t.buyLots > t.sellLots;
        const wallConfirms = wall && (
          (isBuy && wall.volDomination === 'BID') ||
          (!isBuy && wall.volDomination === 'ASK')
        );
        const accumConfirms = accum && (
          (isBuy && accum.direction === 'LONG') ||
          (!isBuy && accum.direction === 'SHORT')
        );
        if (wallConfirms && accumConfirms) algoConfirm = 1.5;
        else if (accumConfirms) algoConfirm = 1.3;
        else if (wallConfirms) algoConfirm = 1.2;

        // Activity Score v2
        const rawScore = dominanceWeight * aggression * persistence * (0.3 + 0.7 * volAnomaly) * algoConfirm;
        const activityScore = Math.min(Math.round(rawScore * 100 * 10) / 10, 100);

        tickerDurationAggs.push({
          ...t,
          score: activityScore,
          robotProfile,
          algoConfirm,
        });
      }
      tickerDurationAggs.sort((a, b) => b.score - a.score);

      // ─── 5. Временные бакеты 5 мин (Фрейм 3) — инкрементальное обновление ───
      const now = new Date();
      const msk = toMoscowTime(now);
      const curHour = msk.getHours();
      const curMin5 = Math.floor(msk.getMinutes() / 5) * 5;
      const currentWindow = `${String(curHour).padStart(2, '0')}:${String(curMin5).padStart(2, '0')}`;

      // Инкрементальное обновление: обновляем только текущий 5-минутный бакет
      const [eBuy5, eSell5] = splitLots(event);
      const existingBuckets = [...state.timeBuckets];
      const curIdx = existingBuckets.findIndex(b => b.window === currentWindow);
      if (curIdx >= 0) {
        existingBuckets[curIdx] = {
          ...existingBuckets[curIdx],
          events: existingBuckets[curIdx].events + 1,
          buyLots: existingBuckets[curIdx].buyLots + eBuy5,
          sellLots: existingBuckets[curIdx].sellLots + eSell5,
          delta: existingBuckets[curIdx].delta + eBuy5 - eSell5,
        };
      } else {
        existingBuckets.push({
          window: currentWindow, events: 1, buyLots: eBuy5, sellLots: eSell5, delta: eBuy5 - eSell5,
        });
      }
      // Показываем последние 4 часа (48 бакетов по 5 мин), отсортированные по времени
      // Фильтруем: только за последние 4 часа, без будущих окон
      const currentWindowNum = curHour * 60 + curMin5;
      const fourHoursAgoNum = currentWindowNum - 4 * 60;
      const timeBuckets = existingBuckets
        .filter(b => {
          const [h, m] = b.window.split(':').map(Number);
          const bucketNum = h * 60 + m;
          // Бакет за последние 4 часа И не в будущем (с допускном для перехода через полночь)
          if (bucketNum > currentWindowNum) return false; // Будущее — отсекаем
          return bucketNum >= fourHoursAgoNum || bucketNum + 1440 >= fourHoursAgoNum; // +24ч для перехода через полночь
        })
        .sort((a, b) => a.window.localeCompare(b.window))
        .slice(-48);

      // ─── 6. Сигналы v2 (Фрейм 4) — пересчёт из текущих агрегаций ───
      // signalScore = concentration × persistence × (0.3 + 0.7 × volumeAnomaly) × algoConfirm × 100
      // Фильтры: events >= 3, totalLots >= 5000
      // Классификация по SCORE: СИЛЬНЫЙ >= 50, СРЕДНИЙ >= 25

      // Индекс AlgoPack по тикеру для кросс-подтверждения
      const wallMapSig = new Map<string, import('./types').WallScoreEntry>();
      for (const w of state.algopack.walls) wallMapSig.set(w.secid, w);
      const accumMapSig = new Map<string, import('./types').AccumScoreEntry>();
      for (const a of state.algopack.accumulations) accumMapSig.set(a.secid, a);

      let signals: Signal[] = [];
      for (const t of tickerAggs) {
        if (t.events < 3) continue;
        const total = t.buyLots + t.sellLots;
        if (total < 5000) continue; // Фильтр: минимум 5000 лотов
        const deltaPct = total > 0 ? ((t.buyLots - t.sellLots) / total) * 100 : 0;
        if (deltaPct === 0) continue;
        const dir: 'LONG' | 'SHORT' = deltaPct > 0 ? 'LONG' : 'SHORT';

        // concentration: направленная концентрация силы (0-1)
        const concentration = total > 0 ? Math.abs(t.deltaNet) / total : 0;
        // persistence: устойчивость программы (8+ событий = 1.0)
        const persistence = Math.min(t.events / 8, 1);
        // volumeAnomaly: аномалия объёма относительно медианы
        const avgLots = t.events > 0 ? t.totalLots / t.events : 0;
        const volAnomaly = medianAvgLots > 0 ? Math.log(1 + avgLots / medianAvgLots) / Math.log(11) : 0;

        // algoConfirm: кросс-подтверждение из AlgoPack
        let algoConfirm = 1.0;
        const wall = wallMapSig.get(t.ticker);
        const accum = accumMapSig.get(t.ticker);
        const wallConfirms = wall && (
          (dir === 'LONG' && wall.volDomination === 'BID') ||
          (dir === 'SHORT' && wall.volDomination === 'ASK')
        );
        const accumConfirms = accum && (
          (dir === 'LONG' && accum.direction === 'LONG') ||
          (dir === 'SHORT' && accum.direction === 'SHORT')
        );
        if (wallConfirms && accumConfirms) algoConfirm = 1.5;       // Оба подтверждают
        else if (accumConfirms) algoConfirm = 1.3;                   // ЛОКАТОР подтверждает
        else if (wallConfirms) algoConfirm = 1.2;                    // СТАКАН подтверждает

        // Signal Score v2: абсолютная шкала [0, 100]
        const rawSigScore = concentration * persistence * (0.3 + 0.7 * volAnomaly) * algoConfirm;
        const signalScore = Math.min(Math.round(rawSigScore * 100 * 10) / 10, 100);

        // Классификация по SCORE (не по жёстким порогам)
        let strength: 'STRONG' | 'MEDIUM' | 'WEAK' = 'WEAK';
        if (signalScore >= 50 && t.events >= 5) strength = 'STRONG';
        else if (signalScore >= 25 && t.events >= 3) strength = 'MEDIUM';

        if (strength !== 'WEAK') {
          signals.push({
            id: `sig-${t.ticker}-${dir}`, ticker: t.ticker, direction: dir,
            events: t.events, lots: dir === 'LONG' ? t.buyLots : t.sellLots, score: signalScore,
            priceImpact: t.priceImpact, strength, avgConfidence: t.avgConfidence,
            algoConfirm, ts: nowMs,
          });
        }
      }
      // Убираем старые сигналы (> 30 мин)
      signals = signals.filter(s => (nowMs - s.ts) < 30 * 60 * 1000);
      signals.sort((a, b) => b.score - a.score || b.lots - a.lots);

      // ─── 7. Fear & Greed v2 — взвешенный по marketWeight + futuresConfirm ───
      //
      // Формула v2:
      //   effectiveConf = confidence × futuresConfirmMultiplier
      //   w = (effectiveConf + 0.5 + anomalyBonus) × marketWeight
      //   weightedBuy  += buyLots  × w
      //   weightedSell += sellLots × w
      //
      // marketWeight: лог-шкала от оборота тикера (VOLTODAY).
      //   Неликвиды ≈ 0.3, голубые фишки ≈ 2.5–3.0
      //
      // futuresConfirmMultiplier: индекс доверия через фьючерсы.
      //   Фьючерс подтверждает → ×1.3 (сильнее доверяем)
      //   Фьючерс нейтрален    → ×1.0 (без изменений)
      //   Фьючерс противоречит → ×0.7 (дивергенция, обман)
      //   MX (рыночный)        → ×1.15 / ×0.85 (слабее, но широкий)
      //
      // Важно: фьючерс НЕ добавляет свои лоты — только модулирует confidence.
      // Это исключает задвоение силы (фьючерс + акция = одно движение).

      // 7a. Pre-compute marketWeight из instruments (VOLTODAY)
      const volArr = state.instruments.map(i => i.volume).filter(v => v > 0);
      const medianVol = volArr.length > 0
        ? volArr.sort((a, b) => a - b)[Math.floor(volArr.length / 2)]
        : 1;
      const marketWeightCache = new Map<string, number>();
      for (const inst of state.instruments) {
        if (inst.volume > 0) {
          // 0.3 (микро) → ~3.0 (гигант), лог-шкала
          const mw = 0.3 + 0.7 * Math.log(1 + inst.volume / medianVol);
          marketWeightCache.set(inst.ticker, Math.min(mw, 3.0));
        }
      }

      // 7b. Маппинг: акция → соответствующий фьючерс (точечный)
      const STOCK_TO_FUTURES: Record<string, string> = {
        SBER: 'SR', GAZP: 'GZ', LKOH: 'LK', ROSN: 'RN', GMKN: 'GK',
      };
      // Маппинг: фьючерс → SMI (из futoiInstruments)
      const futuresSMI = new Map<string, number>();
      for (const inst of state.futoiInstruments) {
        if (inst.smiDirection !== 'no_data') {
          futuresSMI.set(inst.ticker, inst.smi);
        }
      }

      // 7c. Определяем futuresConfirmMultiplier для события
      const getFuturesConfirm = (ticker: string, isBuy: boolean): number => {
        // 1. Проверяем точечный фьючерс (SR→SBER и т.д.)
        const specificFut = STOCK_TO_FUTURES[ticker];
        if (specificFut) {
          const smi = futuresSMI.get(specificFut);
          if (smi !== undefined) {
            const futBullish = smi > 10;
            const futBearish = smi < -10;
            if ((isBuy && futBullish) || (!isBuy && futBearish)) return 1.3;   // подтверждение
            if ((isBuy && futBearish) || (!isBuy && futBullish)) return 0.7;   // дивергенция
          }
        }
        // 2. Проверяем MX как рыночный индикатор (слабее, но широкий)
        const mxSmi = futuresSMI.get('MX');
        if (mxSmi !== undefined) {
          const mxBullish = mxSmi > 10;
          const mxBearish = mxSmi < -10;
          if ((isBuy && mxBullish) || (!isBuy && mxBearish)) return 1.15;      // рыночное подтверждение
          if ((isBuy && mxBearish) || (!isBuy && mxBullish)) return 0.85;      // рыночная дивергенция
        }
        return 1.0; // нейтрально
      };

      // 7d. Основной расчёт FG
      let weightedBuy = 0, weightedSell = 0;
      for (const e of windowEvts) {
        const [fgBuy, fgSell] = splitLots(e);

        // Определяем доминирующее направление для futures confirm
        const isBuy = fgBuy >= fgSell;

        // Effective confidence с futures-подтверждением
        const confirmMult = getFuturesConfirm(e.ticker, isBuy);
        const effectiveConf = e.confidence * confirmMult;

        // Аномалия-бонус (как раньше)
        const anomalyBonus = effectiveConf > 0.85 ? 0.5 : 0;

        // Market weight (оборот тикера)
        const mw = marketWeightCache.get(e.ticker) || 1.0;

        // Итоговый вес
        const w = (effectiveConf + 0.5 + anomalyBonus) * mw;

        weightedBuy += fgBuy * w;
        weightedSell += fgSell * w;
      }

      const totalW = weightedBuy + weightedSell;
      const rawFG = totalW > 0 ? (weightedBuy / totalW) * 100 : 50;
      // Чистая EMA без двойного подсчёта momentum
      const alpha = 0.15; // EMA — скорость реакции
      const newFG = Math.max(0, Math.min(100, alpha * rawFG + (1 - alpha) * state.fearGreedIndex));

      // ─── 8. Совместимость с правой панелью ───
      const topTickerMap = new Map<string, import('./types').TopTicker>();
      for (const t of tickerAggs) {
        topTickerMap.set(t.ticker, {
          ticker: t.ticker, events: t.events, buyLots: t.buyLots, sellLots: t.sellLots,
          avgConfidence: t.avgConfidence, score: t.score,
        });
      }
      const newTopTickers = Array.from(topTickerMap.values()).sort((a, b) => b.score - a.score || b.events - a.events).slice(0, 5);

      // Часовая активность (вычисляем до branch аномалий)
      const hourKey = event.time.slice(0, 2); // "HH" — часовая гранулярность
      const newHourly = [...state.hourlyActivity];
      const hIdx = newHourly.findIndex(h => h.hour === hourKey);
      if (hIdx >= 0) {
        newHourly[hIdx].buy += eBuy5;
        newHourly[hIdx].sell += eSell5;
      } else {
        newHourly.push({ hour: hourKey, buy: eBuy5, sell: eSell5 });
      }

      const newBuy = state.buyLots + eBuy5;
      const newSell = state.sellLots + eSell5;

      // Стратегии — считаем лоты из 30-мин окна, не накапливаем бесконечно
      const stratMap = new Map<string, import('./types').StrategyItem>();
      for (const e of windowEvts) {
        const patName = e.pattern;
        const patColor = PATTERNS.find(p => p.name === patName)?.color || '#94a3b8';
        const eventLots = e.lots || 0;
        const se = stratMap.get(patName);
        if (se) { se.count += eventLots; } else { stratMap.set(patName, { name: patName, count: eventLots, percentage: 0, color: patColor }); }
      }
      const totalStrat = Array.from(stratMap.values()).reduce((s, v) => s + v.count, 0);
      const newStrategy = Array.from(stratMap.values()).map(s => ({ ...s, percentage: totalStrat > 0 ? parseFloat(((s.count / totalStrat) * 100).toFixed(1)) : 0 })).sort((a, b) => b.count - a.count);

      // Аномалии — мигание 1 мин, держим 10 мин (константы определены в начале store)
      const newAnomalies = [...state.anomalies];
      if (event.confidence > 0.85 && event.percentOfDay > 0.5) {
        newAnomalies.unshift({
          id: event.id, ticker: event.ticker, direction: event.direction, lots: event.lots,
          pattern: event.pattern, confidence: event.confidence, percentOfDay: event.percentOfDay,
          priceImpact: event.priceImpact, level: event.level, ts: nowMs,
          blinkUntil: nowMs + ANOMALY_BLINK_MS,  // Мигаем 1 мин
        });
        // Сначала фильтруем по TTL, потом обрезаем до 10 — так не теряем свежие аномалии
        const cutoff = nowMs - ANOMALY_TTL_MS;
        const filtered = newAnomalies.filter(a => !a.ts || a.ts > cutoff);
        const capped = filtered.slice(0, 10);
        return {
          events: newEvents, windowEvents: windowEvts, totalEvents: state.totalEvents + 1,
          buyLots: newBuy, sellLots: newSell, fearGreedIndex: newFG, lastUpdate: event.time,
          topTickers: newTopTickers, strategyDistribution: newStrategy, anomalies: capped, hourlyActivity: newHourly,
          tickerAggs: useLoadedAggs ? state.tickerAggs : tickerAggs,
          durationBuckets: useLoadedAggs ? state.durationBuckets : durationBuckets,
          tickerDurationAggs: useLoadedAggs ? state.tickerDurationAggs : tickerDurationAggs,
          timeBuckets, signals: useLoadedAggs ? recalcSignalsFromAggs(state.tickerAggs, nowMs, state.algopack.walls, state.algopack.accumulations) : signals,
        };
      }

      // Фильтруем устаревшие аномалии (TTL = 10 мин)
      const anomalyCutoff = nowMs - 10 * 60 * 1000;
      const cleanAnomalies = newAnomalies.filter(a => !a.ts || a.ts > anomalyCutoff);

      return {
        events: newEvents, windowEvents: windowEvts, totalEvents: state.totalEvents + 1,
        buyLots: newBuy, sellLots: newSell, fearGreedIndex: newFG, lastUpdate: event.time,
        topTickers: newTopTickers, strategyDistribution: newStrategy, anomalies: cleanAnomalies, hourlyActivity: newHourly,
        tickerAggs: useLoadedAggs ? state.tickerAggs : tickerAggs,
        durationBuckets: useLoadedAggs ? state.durationBuckets : durationBuckets,
        tickerDurationAggs: useLoadedAggs ? state.tickerDurationAggs : tickerDurationAggs,
        timeBuckets, signals: useLoadedAggs ? recalcSignalsFromAggs(state.tickerAggs, nowMs) : signals,
      };
    }),
  resetNewFlags: () =>
    set((state) => ({
      events: state.events.map((e) => ({ ...e, isNew: false })),
    })),
  expireAnomalies: () =>
    set((state) => {
      const now = Date.now();
      const filtered = state.anomalies.filter(a => !a.ts || (now - a.ts) < ANOMALY_TTL_MS);
      if (filtered.length !== state.anomalies.length) {
        return { anomalies: filtered };
      }
      return {};
    }),
}));
