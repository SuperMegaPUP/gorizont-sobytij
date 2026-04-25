'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useTheme } from '@/lib/theme-context';
import { useDashboardStore } from '@/lib/store';
import type { Direction, RobotEvent, Instrument } from '@/lib/types';
import { getMoscowTime, nextId, isMarketOpen, getMarketStatusText, toMoscowTime } from '@/lib/helpers';
import { TICKERS } from '@/lib/static-data';
import { HelpModal } from '@/components/frames/HelpModal';
import { AIHintModal } from '@/components/AIHintModal';
import { TickerModal } from '@/components/horizon/modals/TickerModal';
import { TimeSliceModal } from '@/components/horizon/modals/TimeSliceModal';
import { Header } from '@/components/frames/Header';
import { DashboardGrid } from '@/components/frames/DashboardGrid';
import { SideZone } from '@/components/frames/SideZone';
import { BottomBar } from '@/components/frames/BottomBar';
import { FramePicker } from '@/components/frames/FramePicker';

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function RobotDetectorTerminal() {
  const addEvent = useDashboardStore((s) => s.addEvent);
  const resetNewFlags = useDashboardStore((s) => s.resetNewFlags);
  const setConnected = useDashboardStore((s) => s.setConnected);
  const setDataSource = useDashboardStore((s) => s.setDataSource);
  const setApiError = useDashboardStore((s) => s.setApiError);
  const updateInstruments = useDashboardStore((s) => s.updateInstruments);
  const loadFromDb = useDashboardStore((s) => s.loadFromDb);
  const updateFutoi = useDashboardStore((s) => s.updateFutoi);
  const pushOiHistory = useDashboardStore((s) => s.pushOiHistory);
  const tickerIndexRef = useRef(0);
  const [showHelp, setShowHelp] = useState(false);
  const [showAIHint, setShowAIHint] = useState(false);

  // ── F2/F3 key handlers ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setShowHelp((prev) => !prev);
      }
      if (e.key === 'F3') {
        e.preventDefault();
        setShowAIHint((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // ── Load accumulated metrics from Redis API (primary) or localStorage (fallback) ──
  useEffect(() => {
    const loadMetrics = async () => {
      try {
        // 1. Пробуем загрузить из Redis API
        const res = await fetch('/api/metrics');
        if (res.ok) {
          const data = await res.json();
          if (data.waveBuckets?.length > 0 || data.fearGreedHistory?.length > 0 || data.anomalies?.length > 0) {
            loadFromDb(data);
            console.log('[Redis API] Loaded metrics:', {
              waves: data.waveBuckets?.length || 0,
              fg: data.fearGreedHistory?.length || 0,
              anomalies: data.anomalies?.length || 0,
              signals: data.signals?.length || 0,
              hourly: data.hourlyActivity?.length || 0,
              oi: data.oiSnapshots?.length || 0,
              source: data.source || 'redis',
            });
            return; // Успешно загрузили из Redis — не нужен localStorage
          }
        }
      } catch (e) {
        console.warn('[Redis API] Load error, falling back to localStorage:', e);
      }

      // 2. Fallback: загружаем из localStorage
      try {
        const date = new Date().toISOString().slice(0, 10);
        const key = `rd_metrics_${date}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          const data = JSON.parse(raw);
          if (data.waveBuckets?.length > 0 || data.fearGreedHistory?.length > 0 || data.anomalies?.length > 0) {
            loadFromDb(data);
            console.log('[localStorage] Loaded metrics (fallback):', {
              waves: data.waveBuckets?.length || 0,
              fg: data.fearGreedHistory?.length || 0,
              anomalies: data.anomalies?.length || 0,
            });
          }
        }
      } catch (e) {
        console.warn('[localStorage] Load error:', e);
      }
    };
    loadMetrics();
  }, [loadFromDb]);

  // ── Periodic persistence: Redis API (primary) + localStorage (fallback) ──
  useEffect(() => {
    const saveMetrics = () => {
      const state = useDashboardStore.getState();
      if (state.totalEvents === 0) return; // Нет данных — не сохраняем

      const date = new Date().toISOString().slice(0, 10);
      const now = Date.now();
      const nowDate = new Date();
      const msk = toMoscowTime(nowDate);
      const timeStr = msk.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

      const data = {
        date,
        waveBuckets: state.timeBuckets.map(b => ({
          window: b.window, events: b.events, buyLots: b.buyLots, sellLots: b.sellLots, delta: b.delta, ts: now,
        })),
        fearGreedIndex: state.fearGreedIndex,
        fearGreedHistory: [{ date, time: timeStr, value: state.fearGreedIndex, buyLots: state.buyLots, sellLots: state.sellLots, ts: now }],
        totalEvents: state.totalEvents,
        buyLots: state.buyLots,
        sellLots: state.sellLots,
        signals: state.signals.map(s => ({
          ticker: s.ticker, direction: s.direction, strength: s.strength,
          events: s.events, lots: s.lots, score: s.score,
          priceImpact: s.priceImpact, avgConfidence: s.avgConfidence, ts: s.ts,
        })),
        hourlyActivity: state.hourlyActivity.map(h => ({ hour: h.hour, buy: h.buy, sell: h.sell })),
        oiSnapshots: Object.entries(state.oiHistory).flatMap(([ticker, snaps]) =>
          snaps.map(s => ({ ticker, time: s.time, yurLong: s.yurLong, yurShort: s.yurShort, fizLong: s.fizLong, fizShort: s.fizShort, ts: s.ts }))
        ),
        anomalies: state.anomalies.map(a => ({
          id: a.id, ticker: a.ticker, direction: a.direction, lots: a.lots, pattern: a.pattern,
          confidence: a.confidence, percentOfDay: a.percentOfDay, priceImpact: a.priceImpact,
          level: a.level, ts: a.ts ?? 0, expireAt: (a.ts ?? 0) + 10 * 60 * 1000,
        })),
        tickerAggs: state.tickerAggs.map(a => ({
          ticker: a.ticker, events: a.events, buyLots: a.buyLots, sellLots: a.sellLots,
          deltaNet: a.deltaNet, totalLots: a.totalLots, score: a.score,
          avgConfidence: a.avgConfidence, priceImpact: a.priceImpact, direction: a.direction, ts: now,
        })),
        // ── Ранее НЕ сохранялись в БД ──
        durationBuckets: state.durationBuckets.map(b => ({
          label: b.label, rangeSec: b.rangeSec, events: b.events, lots: b.lots,
          avgConfidence: b.avgConfidence, buyLots: b.buyLots, sellLots: b.sellLots,
        })),
        tickerDurationAggs: state.tickerDurationAggs.map(a => ({
          ticker: a.ticker, events: a.events, direction: a.direction,
          buyLots: a.buyLots, sellLots: a.sellLots, deltaNet: a.deltaNet,
          lastTime: a.lastTime, avgConfidence: a.avgConfidence,
          hftLots: a.hftLots, scalperLots: a.scalperLots, impulseLots: a.impulseLots,
          structuralLots: a.structuralLots, accumulationLots: a.accumulationLots,
          score: a.score, priceImpact: a.priceImpact, patterns: a.patterns,
        })),
        strategyDistribution: state.strategyDistribution.map(s => ({
          name: s.name, count: s.count, percentage: s.percentage, color: s.color,
        })),
        events: state.events.map(e => ({
          id: e.id, ts: e.ts, ticker: e.ticker, direction: e.direction, lots: e.lots,
          buyLots: e.buyLots, sellLots: e.sellLots, pattern: e.pattern, confidence: e.confidence,
          wap: e.wap, delta: e.delta, duration: e.duration, durationSec: e.durationSec,
          percentOfDay: e.percentOfDay, priceImpact: e.priceImpact, spreadImpact: e.spreadImpact,
          source: e.source, level: e.level, levelRu: e.levelRu, time: e.time,
        })),
      };

      // 1. Сохраняем в Redis API (fire-and-forget, не блокируем UI)
      fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(res => {
        if (res.ok) console.log('[Redis API] Metrics saved');
        else console.warn('[Redis API] Save failed:', res.status);
      }).catch(e => {
        console.warn('[Redis API] Save error:', e.message);
      });

      // 2. Параллельно сохраняем в localStorage как fallback
      try {
        const key = `rd_metrics_${date}`;
        localStorage.setItem(key, JSON.stringify(data));
        // Очищаем данные за прошлые дни (backward iteration — безопасно при removeItem)
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith('rd_metrics_') && k !== key) {
            localStorage.removeItem(k);
          }
        }
      } catch (e) {
        console.warn('[localStorage] Save error:', e);
      }
    };

    const firstSave = setTimeout(saveMetrics, 10 * 1000); // First save after 10 sec
    const interval = setInterval(saveMetrics, 30 * 1000); // Then every 30 sec

    return () => {
      clearTimeout(firstSave);
      clearInterval(interval);
    };
  }, []);

  // ── Check market status on mount and periodically ──
  // Когда рынок открывается, polling useEffect (ниже) автоматически запустится
  useEffect(() => {
    const checkMarket = () => {
      if (!isMarketOpen()) {
        setDataSource('closed');
        setConnected(false);
        setApiError(getMarketStatusText());
      } else {
        // Рынок открыт — сбрасываем ошибку (polling loop подключится сам)
        const ds = useDashboardStore.getState().dataSource;
        if (ds === 'closed') {
          setDataSource('none'); // Сброс — polling loop установит 'api'
          setApiError('');
        }
      }
    };
    checkMarket();
    const interval = setInterval(checkMarket, 60000);
    return () => clearInterval(interval);
  }, [setDataSource, setConnected, setApiError]);

  // ── REST API Polling Loop (replaces WebSocket) ──
  // Работает на Vercel serverless — опрашивает /api/trades + /api/detect
  // Реактивный: перезапускается при изменении состояния рынка
  const dataSource = useDashboardStore((s) => s.dataSource);
  useEffect(() => {
    if (!isMarketOpen()) {
      console.log('[Poll] Market closed, skipping polling');
      return;
    }

    const POLL_INTERVAL = 4000; // 4 секунды между запросами
    let running = true;
    let lastErrorTime = 0;
    let consecutiveErrors = 0;

    const pollTradesAndDetect = async () => {
      if (!running || !isMarketOpen()) return;

      // Динамический список тикеров из TOP-100 по обороту (fallback на TICKERS)
      const instruments = useDashboardStore.getState().instruments;
      const activeTickers = instruments.length > 0
        ? instruments.map(i => i.ticker)
        : TICKERS;

      // Вращаемся по тикерам
      const ticker = activeTickers[tickerIndexRef.current % activeTickers.length];
      tickerIndexRef.current++;

      try {
        // 1. Получаем сделки
        const tradesRes = await fetch(`/api/trades?ticker=${ticker}`);
        if (!tradesRes.ok) {
          consecutiveErrors++;
          return;
        }
        const tradesData = await tradesRes.json();

        if (!tradesData.trades || tradesData.trades.length === 0) {
          consecutiveErrors = 0;
          return;
        }

        // Отмечаем подключение
        consecutiveErrors = 0;
        const ds = useDashboardStore.getState().dataSource;
        if (ds === 'closed' || ds === 'none') {
          setDataSource(tradesData.source === 'tinvest' ? 'tinvest' : 'moex');
          setConnected(true);
          setApiError('');
        }

        // 2. Отправляем на детекцию
        const detectRes = await fetch('/api/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trades: tradesData.trades,
            ticker,
            figi: tradesData.figi || '',
            dailyVolume: (() => {
              const inst = useDashboardStore.getState().instruments.find(i => i.ticker === ticker);
              return inst?.volume || 0;
            })(),
            dailyValue: (() => {
              const inst = useDashboardStore.getState().instruments.find(i => i.ticker === ticker);
              // Парсим turnover строку вида "1.2 млрд" в число
              if (!inst?.turnover || inst.turnover === '-') return 0;
              const match = inst.turnover.match(/([\d.]+)\s*(млн|млрд|тыс)/);
              if (!match) return 0;
              const val = parseFloat(match[1]);
              const mult = match[2] === 'млрд' ? 1e9 : match[2] === 'млн' ? 1e6 : 1e3;
              return val * mult;
            })(),
            source: tradesData.source || 'api',
          }),
        });

        if (!detectRes.ok) {
          consecutiveErrors++;
          return;
        }
        const detectData = await detectRes.json();

        // 3. Добавляем обнаруженные всплески как события (с дедупликацией)
        if (detectData.bursts && detectData.bursts.length > 0) {
          // Получаем существующие windowEvents для проверки дубликатов
          const existingWindow = useDashboardStore.getState().windowEvents;
          for (const burst of detectData.bursts) {
            // Дедупликация: пропускаем если всплеск с таким же tsStart+tsEnd+ticker уже есть в окне
            const burstStartMs = burst.tsStart * 1000;
            const burstEndMs = (burst.tsStart + burst.duration) * 1000;
            const isDuplicate = existingWindow.some(e =>
              e.ticker === (burst.ticker || ticker) &&
              Math.abs(e.ts - burstStartMs) < 2000 &&  // tsStart совпадает (2с толерантность)
              Math.abs((e.ts + (e.durationSec || 0) * 1000) - burstEndMs) < 2000  // tsEnd совпадает
            );
            if (isDuplicate) continue;

            const dir: Direction = burst.direction === 'BUY' ? 'buy' : burst.direction === 'SELL' ? 'sell' : 'mixed';
            const mins = Math.floor(burst.duration / 60);
            const secs = Math.floor(burst.duration % 60);
            const event: RobotEvent = {
              id: nextId(),
              time: getMoscowTime(),
              ts: Date.now(),
              ticker: burst.ticker || ticker,
              direction: dir,
              lots: burst.totalLots || 0,
              buyLots: burst.buyLots || 0,
              sellLots: burst.sellLots || 0,
              pattern: burst.strategyRu || burst.strategy || 'Неизвестный',
              confidence: burst.confidence || 0,
              wap: burst.wap || 0,
              delta: burst.delta || 0,
              duration: `${mins}м ${secs}с`,
              durationSec: burst.duration || 0,
              percentOfDay: burst.lotsPctDaily || 0,
              priceImpact: burst.priceImpactPct || 0,
              spreadImpact: burst.spreadImpact || 0,
              isNew: true,
              source: burst.source || tradesData.source || 'api',
              level: burst.level || 'algo',
              levelRu: burst.levelRu || 'АЛГО',
            };
            addEvent(event);
          }
        }
      } catch (err) {
        consecutiveErrors++;
        const now = Date.now();
        if (consecutiveErrors >= 5 && now - lastErrorTime > 300000) {
          lastErrorTime = now;
          console.error('[Poll] Error:', err);
        }
      }
    };

    // Запускаем polling loop
    const startPolling = async () => {
      while (running) {
        await pollTradesAndDetect();
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      }
    };

    startPolling();

    return () => {
      running = false;
    };
  }, [addEvent, setConnected, setDataSource, setApiError, dataSource]);

  // ── Remove "new" flash from old events ──
  useEffect(() => {
    const flashTimer = setInterval(() => {
      resetNewFlags();
    }, 2000);
    return () => clearInterval(flashTimer);
  }, [resetNewFlags]);

  // ── Expire anomalies periodically (blink + TTL) ──
  useEffect(() => {
    const expireTimer = setInterval(() => {
      useDashboardStore.getState().expireAnomalies();
    }, 30000); // Every 30 seconds
    return () => clearInterval(expireTimer);
  }, []);

  // ── Fetch instruments from MOEX API ──
  useEffect(() => {
    if (!isMarketOpen()) return;

    let lastErrorTime = 0;
    let consecutiveErrors = 0;
    const ERROR_COOLDOWN = 300000; // 5 minutes between error state updates
    const MAX_CONSECUTIVE_ERRORS = 3;

    const fetchInstruments = async () => {
      try {
        const res = await fetch('/api/moex?action=top');
        if (res.ok) {
          const data = await res.json();
          if (data.top && data.top.length > 0) {
            consecutiveErrors = 0; // Reset on success
            const instruments: Instrument[] = data.top.slice(0, 100).map((item: any, i: number) => ({
              rank: i + 1,
              ticker: item.ticker,
              volume: item.volToday || 0,
              turnover: item.valueToday ? `${(item.valueToday / 1e9).toFixed(1)} млрд` : '-',
            }));
            updateInstruments(instruments);

            // Предзагрузка FIGI для TOP-100 тикеров (для T-Invest API)
            const tickersToPreload = instruments.map(i => i.ticker);
            fetch('/api/trades', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tickers: tickersToPreload }),
            }).catch(() => {}); // Тихо — не блокируем UI

            if (isMarketOpen()) {
              const ds = useDashboardStore.getState().dataSource;
              if (ds !== 'ws') {
                setDataSource('api');
                setConnected(true);
              }
              setApiError('');
            }
          } else {
            // MOEX returned OK but no data (possibly outside trading hours for specific instruments)
            consecutiveErrors = 0;
            setApiError('');
          }
        } else {
          consecutiveErrors++;
          const now = Date.now();
          // Only show error to user after multiple consecutive failures and with cooldown
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && now - lastErrorTime > ERROR_COOLDOWN) {
            lastErrorTime = now;
            console.error('[MOEX API] Error fetching instruments:', res.status);
            setApiError('MOEX API временно недоступен');
          }
        }
      } catch (err) {
        consecutiveErrors++;
        const now = Date.now();
        // Only show error after multiple consecutive failures and with cooldown
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && now - lastErrorTime > ERROR_COOLDOWN) {
          lastErrorTime = now;
          console.error('[MOEX API] Network error:', err);
          setApiError('Ошибка сети при подключении к MOEX API');
        }
      }
    };

    fetchInstruments();
    const interval = setInterval(fetchInstruments, 30000); // Every 30 seconds
    return () => clearInterval(interval);
  }, [updateInstruments, setDataSource, setConnected, setApiError]);

  // ── Fetch FUTOI (Open Interest / Smart Money) ──
  // FUTOI данные доступны даже когда рынок закрыт (данные за последний торговый день)
  useEffect(() => {
    const fetchFutoi = async () => {
      try {
        const res = await fetch(`/api/futoi?tickers=MX,Si,RI,BR,GZ,GK,SR,LK,RN`);
        if (res.ok) {
          const data = await res.json();
          if (data.instruments) {
            updateFutoi(data.instruments, data.compositeSMI || 0, data.compositeDirection || 'neutral', data.source || 'none', data.realtime || false);
            pushOiHistory(data.instruments);
          }
        }
      } catch {
        // Тихо — не спамим ошибками
      }
    };

    fetchFutoi();
    const interval = setInterval(fetchFutoi, 120000); // Каждые 2 минуты (OI обновляется после вечернего клиринга)
    return () => clearInterval(interval);
  }, [updateFutoi, pushOiHistory]);



  const { theme } = useTheme();

  return (
    <div className={`h-screen flex flex-col overflow-hidden font-mono theme-${theme}`} style={{ background: 'var(--t-bg)', color: 'var(--t-text)' }}>
      <Header onHelpClick={() => setShowHelp(true)} />
      <div className="flex-1 flex overflow-hidden min-h-0">
        <SideZone side="left" />
        <div className="flex-1 min-w-0 overflow-hidden">
          <DashboardGrid />
        </div>
        <SideZone side="right" />
      </div>
      <BottomBar />
      <FramePicker />
      <AnimatePresence>
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      </AnimatePresence>
      <AIHintModal open={showAIHint} onOpenChange={setShowAIHint} />
      <TickerModal />
      <TimeSliceModal />
    </div>
  );
}
