// ─── /api/hint ─────────────────────────────────────────────────────────
// Neuro Hint — AI-аналитик рынка через OpenRouter
// GET /api/hint       — история подсказок
// POST /api/hint      — сгенерировать новую подсказку
//
// v2.0 RESTORED from proven old host + ioredis driver:
// 1. Торговый календарь через MOEX API (не хардкод!)
// 2. Реальные цены фьючерсов из MOEX ISS FORTS (против выдумывания)
// 3. Контекст дня — нейросеть не противоречит своим прошлым отчётам
// 4. Строгие анти-галлюцинационные правила в промпте
// 5. Дисклеймер в каждом отчёте
// 6. Пропуск генерации в неторговые дни
// 7. Слотовая система: утро (5 идей), день/вечер (трекинг)
// 8. Self-fetch данных дашборда через собственные API
//
// КРИТИЧЕСКИЕ ДЕТАЛИ:
// - Модели (ротация): qwen/qwen3.5-flash-02-23, z-ai/glm-5, qwen/qwen3.6-plus
// - Redis: ioredis, история с TTL 48ч
// - Пароль на ручную генерацию: 13420
// - Em-dash (—) ЗАПРЕЩЁН в HTTP заголовках (ByteString error)

import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // AI generation can take 30-50 seconds

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
// Ротация моделей: каждая получает свой слот дня для разнообразия анализа
const MODELS = [
  'qwen/qwen3.5-flash-02-23',  // Быстрая, проверенная — утренний отчёт
  'z-ai/glm-5',                // GLM-5 — дневной отчёт
  'qwen/qwen3.6-plus',         // Qwen 3.6 Plus — вечерний отчёт
  'qwen/qwen3.5-flash-02-23',  // Финальный отчёт дня — снова проверенная
] as const;

// Выбор модели по слоту (0=утро, 1=день, 2=день15, 3=вечер)
function getModelForSlot(slotIndex: number): string {
  return MODELS[slotIndex % MODELS.length];
}

// Redis via ioredis
const HINT_KEY = 'robot-detector:hints';
const IDEAS_KEY = 'robot-detector:ideas';
const DAILY_CONTEXT_PREFIX = 'robot-detector:daily';

// MOEX
const MOEX_APIM = 'https://apim.moex.com';
const MOEX_ISS = 'https://iss.moex.com';
const MOEX_JWT = () => (process.env.MOEX_JWT || '').trim();

// Наши 9 фьючерсов
const FUTURES_TICKERS = ['MX', 'Si', 'RI', 'BR', 'GZ', 'GK', 'SR', 'LK', 'RN'];

// ─── Redis via ioredis ──────────────────────────────────────────────
let redisClient: Redis | null = null;
let redisError = '';

function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  if (redisError) return null;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[HINT] REDIS_URL not set');
    redisError = 'no-url';
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      connectTimeout: 5000,
      commandTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      tls: redisUrl.startsWith('rediss://') ? {} : undefined,
    });
    redisClient.on('error', (err) => {
      console.error('[HINT] Redis error:', err.message);
      redisClient = null;
      redisError = err.message;
    });
    return redisClient;
  } catch (e: any) {
    console.error('[HINT] Failed to create Redis client:', e.message);
    redisError = e.message;
    return null;
  }
}

async function redisGet(key: string): Promise<any> {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('[HINT] Redis GET error:', err);
    return null;
  }
}

async function redisSet(key: string, value: any, ttlSec = 172800): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) {
      console.warn('[HINT] Redis not available, skipping save for key:', key);
      return;
    }
    if (ttlSec) {
      await redis.setex(key, ttlSec, JSON.stringify(value));
    } else {
      await redis.set(key, JSON.stringify(value));
    }
  } catch (err) {
    console.warn('[HINT] Redis SET error for key:', key, err);
  }
}

async function redisDel(key: string): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    await redis.del(key);
  } catch (err) {
    console.warn('[HINT] Redis DEL error:', err);
  }
}

// ─── Moscow Time Helper ──────────────────────────────────────────────
function getMoscowDate(): Date {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 3 * 3600000);
}

// Формирует ISO-строку в московском времени (UTC+3)
// Используем для timestamp в ответах API, чтобы клиент показывал правильное время
function getMoscowISOString(): string {
  const msk = getMoscowDate();
  const y = msk.getFullYear();
  const mo = String(msk.getMonth() + 1).padStart(2, '0');
  const d = String(msk.getDate()).padStart(2, '0');
  const h = String(msk.getHours()).padStart(2, '0');
  const mi = String(msk.getMinutes()).padStart(2, '0');
  const s = String(msk.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000+03:00`;
}

// Конвертируем epoch ms в ISO-строку московского времени
function msToMoscowISO(ms: number): string {
  const utcMs = ms + new Date(ms).getTimezoneOffset() * 60000;
  const mskMs = utcMs + 3 * 3600000;
  const msk = new Date(mskMs);
  const y = msk.getFullYear();
  const mo = String(msk.getMonth() + 1).padStart(2, '0');
  const d = String(msk.getDate()).padStart(2, '0');
  const h = String(msk.getHours()).padStart(2, '0');
  const mi = String(msk.getMinutes()).padStart(2, '0');
  const s = String(msk.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000+03:00`;
}

// ─── Trading Schedule from MOEX Calendar API ───────────────────────
async function checkTradingDay(): Promise<{
  isTradingDay: boolean;
  reason: string;
  stockTraded: boolean;
  futuresTraded: boolean;
}> {
  const msk = getMoscowDate();
  const dateStr = msk.toISOString().slice(0, 10);

  // Проверяем кеш в Redis
  const cacheKey = `${DAILY_CONTEXT_PREFIX}:schedule:${dateStr}`;
  const cached = await redisGet(cacheKey);
  if (cached) return cached;

  const jwt = MOEX_JWT();

  try {
    let data: any = null;

    // Попытка 1: APIM Combined (JWT авторизация)
    if (jwt) {
      try {
        const res = await fetch(
          `${MOEX_APIM}/iss/calendars.json?from=${dateStr}&till=${dateStr}&show_all_days=1&iss.only=off_days`,
          { headers: { Authorization: `Bearer ${jwt}` }, cache: 'no-store' as RequestCache, signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) data = await res.json();
      } catch {}
    }

    // Попытка 2: ISS Combined (без авторизации)
    if (!data?.off_days?.data) {
      try {
        const res = await fetch(
          `${MOEX_ISS}/iss/calendars.json?from=${dateStr}&till=${dateStr}&show_all_days=1&iss.only=off_days`,
          { cache: 'no-store' as RequestCache, signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('json')) data = await res.json();
        }
      } catch {}
    }

    // Парсим результат
    if (data?.off_days?.data?.length > 0) {
      const columns: string[] = data.off_days.columns || [];
      const rows: any[][] = data.off_days.data || [];

      for (const row of rows) {
        const obj: any = {};
        columns.forEach((col, i) => { obj[col] = row[i]; });

        if (obj.tradedate === dateStr) {
          const REASON_MAP: Record<string, string> = { H: 'Праздник', W: 'Выходной', N: 'Торговый день', T: 'Перенесённый день' };
          const result = {
            isTradingDay: obj.stock_workday === 1,
            reason: REASON_MAP[obj.stock_reason] || obj.stock_reason || '',
            stockTraded: obj.stock_workday === 1,
            futuresTraded: obj.futures_workday === 1,
          };
          await redisSet(cacheKey, result, 86400);
          return result;
        }
      }
    }

    // Попытка 3: Отдельный endpoint для фондового рынка
    try {
      const res = await fetch(
        `${MOEX_ISS}/iss/calendars/stock.json?from=${dateStr}&till=${dateStr}&show_all_days=1&iss.only=off_days`,
        { cache: 'no-store' as RequestCache, signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) {
          const stockData = await res.json();
          const columns: string[] = stockData?.off_days?.columns || [];
          const rows: any[][] = stockData?.off_days?.data || [];

          for (const row of rows) {
            const obj: any = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });

            if (obj.tradedate === dateStr) {
              const result = {
                isTradingDay: obj.is_traded === 1,
                reason: obj.reason || '',
                stockTraded: obj.is_traded === 1,
                futuresTraded: true,
              };
              await redisSet(cacheKey, result, 86400);
              return result;
            }
          }
        }
      }
    } catch {}
  } catch (err) {
    console.warn('[HINT] Calendar API error:', err);
  }

  // Fallback: простой проверка по дню недели
  const day = msk.getDay();
  const isWeekend = day === 0 || day === 6;
  const result = {
    isTradingDay: !isWeekend,
    reason: isWeekend ? 'Выходной (календарь MOEX недоступен)' : '',
    stockTraded: !isWeekend,
    futuresTraded: !isWeekend,
  };
  await redisSet(cacheKey, result, 86400);
  return result;
}

// ─── Market schedule ────────────────────────────────────────────────
async function getMarketSchedule(): Promise<string> {
  const msk = getMoscowDate();
  const day = msk.getDay();
  const hour = msk.getHours();
  const min = msk.getMinutes();
  const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')} МСК`;
  const dateStr = msk.toISOString().slice(0, 10);

  const tradingDayInfo = await checkTradingDay();
  const isTradingDay = tradingDayInfo.isTradingDay;
  const reason = tradingDayInfo.reason;

  let sessionStatus = '';
  let sessionName = '';

  if (!isTradingDay) {
    sessionStatus = `ЗАКРЫТА (${reason || 'неторговый день'})`;
    sessionName = `Неторговый день: ${reason || 'биржа не работает'}`;
  } else if (hour < 6 || (hour === 6 && min < 50)) {
    sessionStatus = 'ЗАКРЫТА (до открытия)';
    sessionName = 'Биржа откроется в 06:50 МСК (премаркет)';
  } else if (hour < 10 || (hour === 9 && min < 50)) {
    sessionStatus = 'ПРЕМАРКЕТ';
    sessionName = 'Премаркет 06:50-09:50 МСК - можно подавать заявки, сделок нет';
  } else if (hour === 9 && min >= 50) {
    sessionStatus = 'ОТКРЫТИЕ';
    sessionName = 'Аукцион открытия 09:50-10:00 МСК';
  } else if (hour < 18 || (hour === 18 && min < 45)) {
    sessionStatus = 'ОТКРЫТА (основная сессия)';
    sessionName = 'Основная торговая сессия 10:00-18:45 МСК - активные торги';
  } else if ((hour === 18 && min >= 45 && min < 50) || (hour === 19 && min < 5)) {
    sessionStatus = 'КЛИРИНГ';
    sessionName = 'Вечерний клиринг 18:45-19:05 МСК - торги приостановлены';
  } else if (hour >= 19 && hour < 23 || (hour === 23 && min <= 50)) {
    sessionStatus = 'ОТКРЫТА (вечерняя сессия)';
    sessionName = 'Вечерняя сессия 19:05-23:50 МСК - пониженная ликвидность';
  } else {
    sessionStatus = 'ЗАКРЫТА (ночь)';
    sessionName = 'Биржа закрыта до следующего торгового дня';
  }

  return `Дата: ${dateStr}\nВремя: ${timeStr}\nТорговый день: ${isTradingDay ? 'ДА' : `НЕТ (${reason})`}\nФР торгуется: ${tradingDayInfo.stockTraded ? 'ДА' : 'НЕТ'}\nФьчерсы торгуются: ${tradingDayInfo.futuresTraded ? 'ДА' : 'НЕТ'}\nСтатус биржи: ${sessionStatus}\nСессия: ${sessionName}`;
}

// ─── Futures Prices from MOEX ISS FORTS ────────────────────────────
interface FuturePrice {
  ticker: string;
  secid: string;
  lastPrice: number | null;
  settlePrice: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  changePercent: number | null;
  volToday: number;
  valToday: number;
}

async function fetchFuturesPrices(): Promise<FuturePrice[]> {
  const jwt = MOEX_JWT();
  const prices: FuturePrice[] = [];

  try {
    let data: any = null;

    // Попытка 1: APIM с JWT авторизацией
    if (jwt) {
      try {
        const res = await fetch(
          `${MOEX_APIM}/iss/engines/futures/markets/forts/securities.json?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,LASTPRICE,SETTLEPRICE,OPEN,LOW,HIGH,VOLTODAY,VALTODAY`,
          { headers: { Authorization: `Bearer ${jwt}` }, cache: 'no-store' as RequestCache, signal: AbortSignal.timeout(10000) }
        );
        if (res.ok) data = await res.json();
      } catch {}
    }

    // Попытка 2: ISS без авторизации
    if (!data?.marketdata?.data) {
      try {
        const res = await fetch(
          `${MOEX_ISS}/iss/engines/futures/markets/forts/securities.json?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,LASTPRICE,SETTLEPRICE,OPEN,LOW,HIGH,VOLTODAY,VALTODAY`,
          { cache: 'no-store' as RequestCache, signal: AbortSignal.timeout(10000) }
        );
        if (res.ok) data = await res.json();
      } catch {}
    }

    if (!data?.marketdata?.data) return prices;

    const columns: string[] = data.marketdata.columns || [];
    const rows: any[][] = data.marketdata.data || [];

    // Группируем по префиксу тикера, берём самый ликвидный контракт (макс VOLTODAY)
    const byPrefix = new Map<string, any>();

    for (const row of rows) {
      const obj: any = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });

      const secid: string = String(obj.SECID || '');
      const volToday = Number(obj.VOLTODAY) || 0;

      for (const prefix of FUTURES_TICKERS) {
        if (secid.startsWith(prefix) && secid.length === prefix.length + 2) {
          const existing = byPrefix.get(prefix);
          if (!existing || volToday > (existing.volToday || 0)) {
            const lastPrice = obj.LASTPRICE != null ? Number(obj.LASTPRICE) : null;
            const settlePrice = obj.SETTLEPRICE != null ? Number(obj.SETTLEPRICE) : null;
            const openPrice = obj.OPEN != null ? Number(obj.OPEN) : null;
            let changePercent: number | null = null;
            if (lastPrice && settlePrice && settlePrice > 0) {
              changePercent = Math.round(((lastPrice - settlePrice) / settlePrice) * 10000) / 100;
            }

            byPrefix.set(prefix, {
              secid,
              lastPrice,
              settlePrice,
              open: openPrice,
              high: obj.HIGH != null ? Number(obj.HIGH) : null,
              low: obj.LOW != null ? Number(obj.LOW) : null,
              changePercent,
              volToday,
              valToday: obj.VALTODAY != null ? Number(obj.VALTODAY) : 0,
            });
          }
          break;
        }
      }
    }

    for (const [ticker, d] of byPrefix) {
      prices.push({ ticker, ...d });
    }
  } catch (err) {
    console.warn('[HINT] Futures prices fetch error:', err);
  }

  return prices;
}

// ─── Determine report slot ──────────────────────────────────────────
function getReportSlot(): { slot: 'morning' | 'midday' | 'afternoon' | 'evening'; isFirstOfDay: boolean; slotIndex: number } {
  const msk = getMoscowDate();
  const hour = msk.getHours();

  if (hour < 10) return { slot: 'morning', isFirstOfDay: true, slotIndex: 0 };
  if (hour < 14) return { slot: 'midday', isFirstOfDay: false, slotIndex: 1 };
  if (hour < 17) return { slot: 'afternoon', isFirstOfDay: false, slotIndex: 2 };
  return { slot: 'evening', isFirstOfDay: false, slotIndex: 3 };
}

// ─── Fetch news directly from MOEX + Finam (fallback when /api/news fails) ────
async function fetchNewsDirectly(sections: string[]): Promise<void> {
  sections.push('\n=== НОВОСТИ РЫНКА (получены напрямую из источников - ОБЯЗАТЕЛЬНО учти!) ===');
  let newsCount = 0;

  try {
    // MOEX ISS News
    const moexRes = await fetch('https://iss.moex.com/iss/sitenews.json?iss.meta=off&limit=15', {
      cache: 'no-store' as RequestCache, signal: AbortSignal.timeout(5000),
    });
    if (moexRes.ok) {
      const data = await moexRes.json();
      const columns: string[] = data?.sitenews?.columns || [];
      const rows: any[][] = data?.sitenews?.data || [];
      for (const row of rows) {
        const obj: any = {};
        columns.forEach((col, i) => { obj[col] = row[i]; });
        const title = obj.title || '';
        if (title) {
          sections.push(`[MOEX] ${title}`);
          newsCount++;
        }
      }
    }
  } catch (err) { console.warn('[HINT] Direct MOEX news fetch error:', err); }

  try {
    // Finam RSS
    const finamRes = await fetch('https://www.finam.ru/analysis/conews/rsspoint/', {
      cache: 'no-store' as RequestCache, signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RobotDetector/1.0)' },
    });
    if (finamRes.ok) {
      const text = await finamRes.text();
      const itemRegex = /<item[\s\S]*?<\/item>/gi;
      const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i;
      const items = text.match(itemRegex) || [];
      for (const item of items.slice(0, 15)) {
        const titleMatch = item.match(titleRegex);
        const title = (titleMatch?.[1] || titleMatch?.[2] || '').trim()
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        if (title) {
          sections.push(`[FINAM] ${title}`);
          newsCount++;
        }
      }
    }
  } catch (err) { console.warn('[HINT] Direct Finam news fetch error:', err); }

  if (newsCount === 0) {
    sections.push('Важных новостей пока нет.');
  } else {
    sections.push(`\nВсего новостей: ${newsCount}. Проанализируй каждую и свяжи с техникой!`);
  }
}

// ─── Fetch dashboard data for prompt (PARALLEL self-fetch!) ────
async function fetchDashboardData(): Promise<string> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL || 'https://robot-detect-v3.vercel.app';

  const sections: string[] = [];

  // Запускаем ВСЕ запросы параллельно — сокращаем время с ~30 сек до ~8 сек
  const fetchOpts: RequestInit = { cache: 'no-store' as RequestCache, signal: AbortSignal.timeout(8000) };

  const [futoiResult, algoResult, newsResult, tickResult, futuresResult] = await Promise.allSettled([
    fetch(`${baseUrl}/api/futoi?tickers=MX,Si,RI,BR,GZ,GK,SR,LK,RN`, fetchOpts).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`${baseUrl}/api/algopack?action=all&limit=10`, fetchOpts).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`${baseUrl}/api/news?limit=25`, fetchOpts).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`${baseUrl}/api/tickers`, fetchOpts).then(r => r.ok ? r.json() : null).catch(() => null),
    fetchFuturesPrices(),
  ]);

  // ─── FUTOI + SMI ───
  try {
    const futoi = futoiResult.status === 'fulfilled' ? futoiResult.value : null;
    if (futoi) {
      sections.push('=== OPEN INTEREST (ФЬЮЧЕРСЫ) ===');
      for (const inst of (futoi.instruments || [])) {
        sections.push(
          `${inst.ticker}: ЮЛ лонг=${inst.yur?.pos_long || 0}, ЮЛ шорт=${Math.abs(inst.yur?.pos_short || 0)}, ` +
          `ФЛ лонг=${inst.fiz?.pos_long || 0}, ФЛ шорт=${Math.abs(inst.fiz?.pos_short || 0)}, ` +
          `SMI=${inst.smi || 0} (${inst.smiDirection || 'neutral'})`
        );
      }
      sections.push(`Composite SMI: ${futoi.compositeSMI || 0} (${futoi.compositeDirection || 'neutral'})`);
      sections.push(`Источник: ${futoi.source || 'none'}`);
    }
  } catch (err) { console.warn('[HINT] FUTOI parse error:', err); }

  // ─── AlgoPack (стены + накопления) ───
  try {
    const algo = algoResult.status === 'fulfilled' ? algoResult.value : null;
    if (algo) {
      sections.push('\n=== СТАКАН-СКАНЕР (ТОП-10 стен) ===');
      for (const w of (algo.walls || []).slice(0, 10)) {
        sections.push(`${w.secid}: ${w.side || w.volDomination} ${w.volume} лотов, цена=${w.price}, score=${w.wallScore || '?'}`);
      }
      sections.push('\n=== ЛОКАТОР КРУПНЯКА (ТОП-10 накоплений) ===');
      for (const a of (algo.accumulations || []).slice(0, 10)) {
        sections.push(`${a.secid}: ${a.direction} накопление, volume=${a.volume}, score=${a.accumScore || '?'}`);
      }
    }
  } catch (err) { console.warn('[HINT] AlgoPack parse error:', err); }

  // ─── Новости ───
  try {
    const news = newsResult.status === 'fulfilled' ? newsResult.value : null;
    if (news && (news.news || []).length > 0) {
      const important = (news.news || []).filter((n: any) => n.importance !== 'low');
      sections.push('\n=== НОВОСТИ РЫНКА (последние важные - ОБЯЗАТЕЛЬНО учти при анализе!) ===');
      if (important.length === 0) {
        sections.push('Важных новостей пока нет.');
      }
      for (const n of important.slice(0, 20)) {
        const tickers = n.tickers?.length > 0 ? ` [${n.tickers.join(',')}]` : '';
        const time = n.time ? ` (${n.time.slice(11, 16)} МСК)` : '';
        const summary = n.summary ? ` - ${n.summary}` : '';
        sections.push(`[${n.importance.toUpperCase()}] ${n.title}${tickers}${time}${summary}`);
      }
      sections.push(`\nВсего важных новостей: ${important.length}. Проанализируй каждую и свяжи с техникой!`);
    } else {
      // Fallback: fetch news directly from MOEX + Finam
      await fetchNewsDirectly(sections);
    }
  } catch (err) {
    console.warn('[HINT] News parse error:', err);
    await fetchNewsDirectly(sections);
  }

  // ─── Тикеры справочник ───
  try {
    const tick = tickResult.status === 'fulfilled' ? tickResult.value : null;
    if (tick) {
      sections.push('\n=== СПРАВОЧНИК ТИКЕРОВ (ФЬЮЧЕРСЫ) ===');
      for (const f of (tick.futures || [])) {
        sections.push(`${f.ticker} = ${f.name} (базовый актив: ${f.underlying}, сектор: ${f.sector}, лот: ${f.lotSize})`);
      }
      sections.push('\nМаппинг акция -> фьючерс:');
      for (const [stock, fut] of Object.entries(tick.stockToFutures || {})) {
        sections.push(`  ${stock} -> ${fut}`);
      }
      sections.push('\nТОП-20 акций по обороту:');
      for (const s of (tick.stocks || []).slice(0, 20)) {
        sections.push(`  ${s.ticker} = ${s.name} (${s.sector})`);
      }
    }
  } catch (err) { console.warn('[HINT] Tickers parse error:', err); }

  // ─── РЕАЛЬНЫЕ ЦЕНЫ ФЬЮЧЕРСОВ (КРИТИЧЕСКИ ВАЖНО!) ───
  const futuresPrices = futuresResult.status === 'fulfilled' ? futuresResult.value : [];
  if (futuresPrices.length > 0) {
    sections.push('\n=== АКТУАЛЬНЫЕ КОТИРОВКИ ФЬЮЧЕРСОВ (РЕАЛЬНЫЕ ДАННЫЕ!) ===');
    sections.push('ВНИМАНИЕ: Это РЕАЛЬНЫЕ цены с Московской биржи. Используй ТОЛЬКО эти значения!');
    sections.push('Если цены нет в этом списке - НЕ УПОМИНАЙ её вообще!\n');

    for (const fp of futuresPrices) {
      const lastStr = fp.lastPrice != null ? fp.lastPrice.toLocaleString('ru-RU') : 'нет данных';
      const settleStr = fp.settlePrice != null ? fp.settlePrice.toLocaleString('ru-RU') : 'нет данных';
      const openStr = fp.open != null ? fp.open.toLocaleString('ru-RU') : 'нет данных';
      const highStr = fp.high != null ? fp.high.toLocaleString('ru-RU') : 'нет данных';
      const lowStr = fp.low != null ? fp.low.toLocaleString('ru-RU') : 'нет данных';
      const changeStr = fp.changePercent != null ? `${fp.changePercent > 0 ? '+' : ''}${fp.changePercent}%` : '';

      sections.push(
        `${fp.ticker} (${fp.secid}): Последняя=${lastStr}, Расчётная=${settleStr}, ` +
        `Открытие=${openStr}, Макс=${highStr}, Мин=${lowStr}, ` +
        `Изменение=${changeStr}, Оборот=${(fp.valToday / 1e6).toFixed(1)}М руб, ` +
        `Объём=${fp.volToday.toLocaleString('ru-RU')} контрактов`
      );
    }
  } else {
    sections.push('\n=== АКТУАЛЬНЫЕ КОТИРОВКИ ФЬЮЧЕРСОВ ===');
    sections.push('ЦЕНЫ НЕДОСТУПНЫ! Не упоминай никакие конкретные котировки в отчёте!');
    sections.push('Если не знаешь цену - так и скажи "нет данных", НЕ ВЫДУМЫВАЙ!');
  }

  // ─── Dashboard Metrics из Redis ───
  try {
    const msk = getMoscowDate();
    const today = msk.toISOString().slice(0, 10);
    const metricsRaw = await redisGet(`metrics:${today}`);
    if (metricsRaw) {
      const m = metricsRaw;
      sections.push('\n=== МЕТРИКИ ДАШБОРДА (ROBOT DETECTOR) ===');
      sections.push(`Fear&Greed индекс: ${m.fearGreedIndex ?? 'N/A'}`);
      sections.push(`Всего событий роботной активности: ${m.totalEvents ?? 0}`);
      sections.push(`Buy лотов: ${(m.buyLots ?? 0).toLocaleString('ru-RU')}, Sell лотов: ${(m.sellLots ?? 0).toLocaleString('ru-RU')}`);
      sections.push(`Сигналов активно: ${m.signals?.length ?? 0}`);
      sections.push(`Аномалий активно: ${m.anomalies?.length ?? 0}`);
      sections.push(`Тикеров с роботами: ${m.tickerAggs?.length ?? 0}`);

      if (m.tickerAggs?.length > 0) {
        sections.push('\nТОП-10 роботных тикеров (давление роботов):');
        m.tickerAggs.slice(0, 10).forEach((t: any) => {
          const delta = t.deltaNet > 0 ? `+${t.deltaNet}` : `${t.deltaNet}`;
          const dir = t.deltaNet > 0 ? 'ПОКУПКА' : t.deltaNet < 0 ? 'ПРОДАЖА' : 'НЕЙТРАЛЬНО';
          sections.push(`  ${t.ticker}: events=${t.events}, delta=${delta}, direction=${dir}, score=${t.score?.toFixed(2) ?? 'N/A'}`);
        });
      }

      if (m.strategyDistribution?.length > 0) {
        sections.push('\nРаспределение стратегий роботов:');
        m.strategyDistribution.forEach((s: any) => {
          sections.push(`  ${s.name}: ${s.count} событий`);
        });
      }

      if (m.anomalies?.length > 0) {
        sections.push('\nАктивные аномалии:');
        m.anomalies.slice(0, 10).forEach((a: any) => {
          sections.push(`  ${a.ticker ?? 'N/A'}: ${a.type ?? a.pattern ?? 'аномалия'}, level=${a.level ?? a.levelRu ?? 'N/A'}, confidence=${a.confidence?.toFixed(2) ?? 'N/A'}`);
        });
      }

      if (m.signals?.length > 0) {
        sections.push('\nАктивные сигналы:');
        m.signals.slice(0, 10).forEach((s: any) => {
          sections.push(`  ${s.ticker ?? 'N/A'}: ${s.direction ?? s.type ?? 'сигнал'}, score=${s.score?.toFixed(2) ?? 'N/A'}`);
        });
      }
    }
  } catch (err) { console.warn('[HINT] Dashboard metrics fetch error:', err); }

  return sections.join('\n');
}

// ─── Get daily context (previous reports today) ─────────────────────
async function getDailyContext(): Promise<string> {
  const msk = getMoscowDate();
  const dateStr = msk.toISOString().slice(0, 10);
  const contextKey = `${DAILY_CONTEXT_PREFIX}:context:${dateStr}`;

  const context = await redisGet(contextKey);
  if (!context || !context.summaries || context.summaries.length === 0) {
    return '';
  }

  const parts: string[] = [];
  for (const summary of context.summaries) {
    parts.push(`[${summary.slot?.toUpperCase() || 'ОТЧЁТ'}] ${summary.text}`);
  }

  return parts.join('\n\n');
}

// ─── Save daily context after report ────────────────────────────────
async function saveDailyContext(slot: string, responseText: string): Promise<void> {
  const msk = getMoscowDate();
  const dateStr = msk.toISOString().slice(0, 10);
  const contextKey = `${DAILY_CONTEXT_PREFIX}:context:${dateStr}`;

  // Извлекаем резюме (секция "Резюме")
  let summary = '';
  const resumeMatch = responseText.match(/## Резюме[\s\S]*$/i)
    || responseText.match(/\*\*Резюме\*\*[\s\S]*$/i);

  if (resumeMatch) {
    summary = resumeMatch[0].replace(/^##\s*Резюме\s*/i, '').replace(/^\*\*Резюме\*\*\s*/i, '').trim();
  } else {
    // Fallback: берём последние 3 абзаца
    const paragraphs = responseText.split('\n\n').filter(p => p.trim().length > 20);
    summary = paragraphs.slice(-3).join(' ').trim();
  }

  // Ограничиваем длину контекста
  if (summary.length > 500) {
    summary = summary.slice(0, 500) + '...';
  }

  const context = (await redisGet(contextKey)) || { date: dateStr, summaries: [] };
  context.summaries.push({ slot, text: summary, timestamp: Date.now() });

  // Храним максимум 6 отчётов за день
  await redisSet(contextKey, { date: dateStr, summaries: context.summaries.slice(-6) }, 86400);
}

// ─── DISCLAIMER ─────────────────────────────────────────────────────
const DISCLAIMER = `\n\n---\n*ДИСКЛЕЙМЕР: Данный отчёт сгенерирован нейросетью Neuro Hint на основе данных Robot Detector Московской биржи. Все высказывания являются результатом алгоритмического анализа и НЕ являются индивидуальными инвестиционными рекомендациями (ИИР). Торговля на фондовом рынке сопряжена с высоким уровнем риска, включая возможность потери всего инвестированного капитала. Прошлые результаты не гарантируют будущих. Перед принятием торговых решений проконсультируйтесь с финансовым советником.*`;

// ─── Build system prompt ────────────────────────────────────────────
async function buildSystemPrompt(
  slot: 'morning' | 'midday' | 'afternoon' | 'evening',
  isFirstOfDay: boolean,
  previousIdeas: any[] | null,
  dailyContext: string
): Promise<string> {
  const marketSchedule = await getMarketSchedule();
  const msk = getMoscowDate();
  const dateStr = msk.toISOString().slice(0, 10);

  let prompt = `Ты - Neuro Hint, AI-аналитик Российского фондового рынка для внутридневных трейдеров.
Анализируй данные Robot Detector (робот-детектор Московской биржи) и давай конкретные торговые рекомендации.
Пиши как профессионал для профессионалов - живо, но без панибратства. Используй рыночный сленг уместно: "лонги", "шорты", "давят", "набирают позицию", "сбрасывают", "откупают". Не используй жаргон вроде "красиво набирают" или "жёстко продавили" - это звучит непрофессионально.

=== ГРАФИК РАБОТЫ БИРЖИ (из MOEX Calendar API) ===
${marketSchedule}

ВАЖНО: Всегда учитывай статус биржи при анализе!
- Если биржа ЗАКРЫТА - анализируй данные ЗАКРЫТИЯ и давай прогноз НА ОТКРЫТИЕ
- Если биржа ОТКРЫТА - анализируй текущую сессию
- Вечерняя сессия имеет НИЗКУЮ ликвидность - учитывай это
- Клиринг (18:45-19:05) - торги приостановлены
- Расписание торгов получено через API MOEX, учитывай праздники и переносы!

=== АБСОЛЮТНЫЙ ЗАПРЕТ НА ВЫДУМЫВАНИЕ ДАННЫХ (КРИТИЧЕСКИ ВАЖНО!) ===
1. НИКОГДА НЕ ВЫДУМЫВАЙ КОТИРОВКИ! Если в разделе данных есть реальные цены - используй ТОЛЬКО их.
2. Если реальной цены тикера нет в данных - НЕ УПОМИНАЙ никакую цену для этого тикера вообще!
3. НИКОГДА НЕ ПРИДУМЫВАЙ значения OI, SMI, объёмов или других метрик - используй ТОЛЬКО то, что есть в разделе данных.
4. Если данных недостаточно - честно напиши "данных недостаточно для анализа" вместо того, чтобы выдумывать.
5. ЛЮБОЕ число в отчёте должно быть взято из раздела данных ниже. Если ты не видишь число в данных - НЕ ИСПОЛЬЗУЙ его!
6. ВСЕГДА пиши текст на РУССКОМ языке кириллицей. НЕ используй английскую раскладку для русских слов.
7. Если пишешь цену или уровень - ОН ДОЛЖЕН БЫТЬ в предоставленных данных. Нет цены в данных = не указывай уровень.

=== КОТИРОВКИ: КАК РАБОТАТЬ С "ПОСЛЕДНЕЙ" ЦЕНОЙ (КРИТИЧЕСКИ ВАЖНО!) ===
В данных есть два типа цен: "Последняя" (Last) и "Расчётная" (Settle).
- "Последняя" = цена последней РЕАЛЬНОЙ сделки. Если сделок нет (вечерняя сессия, клиринг, выходной) = "нет данных".
- "Расчётная" = цена клиринга, обновляется на каждом клире. ВСЕГДА доступна для торгуемых контрактов.
ПРАВИЛА:
1. Если "Последняя" есть - ИСПОЛЬЗУЙ ЕЁ как текущую цену (она точнее расчётной).
2. Если "Последняя" = "нет данных", но "Расчётная" есть - используй РАСЧЁТНУЮ как ближайший ориентир цены. УКАЖИ в отчёте: "по расчётной цене (Последняя недоступна - нет сделок)".
3. Если ОБЕ цены = "нет данных" - НЕ УПОМИНАЙ цену для этого тикера.
4. НИКОГДА НЕ ВЫДУМЫВАЙ цену, если обе недоступны!

=== СПРАВОЧНИК ФЬЮЧЕРСОВ (КРИТИЧЕСКИ ВАЖНО!) ===
НИКОГДА НЕ ПУТАЙ ТИКЕРЫ! Это разные инструменты:
- MX = Фьючерс на Индекс Мосбиржи (IMOEX), сектор: Индекс, лот: 1
- Si = Фьючерс на Доллар/Рубль (USD/RUB), сектор: Валюта, лот: 1000
- RI = Фьючерс на Индекс РТС (RTSI), сектор: Индекс, лот: 1
- BR = Фьючерс на нефть Brent, сектор: Нефть/Газ, лот: 10
- GZ = Фьючерс на Газпром (базовый актив: GAZP), сектор: Нефть/Газ, лот: 100
- GK = Фьючерс на Норникель (базовый актив: GMKN), сектор: Металлургия, лот: 5
- SR = Фьючерс на Сбербанк (базовый актив: SBER), сектор: Банки, лот: 100
- LK = Фьючерс на Лукойл (базовый актив: LKOH), сектор: Нефть/Газ, лот: 10
- RN = Фьючерс на Роснефть (базовый актив: ROSN), сектор: Нефть/Газ, лот: 100

Маппинг акция -> фьючерс: SBER->SR, GAZP->GZ, LKOH->LK, ROSN->RN, GMKN->GK
SR - это ФЬЮЧЕРС НА СБЕРБАНК, а НЕ фьючерс на рубль!
Si - это ФЬЮЧЕРС НА ДОЛЛАР/РУБЛЬ, а НЕ фьючерс на Сбербанк!
GZ - это ФЬЮЧЕРС НА ГАЗПРОМ, а НЕ фьючерс на золото!`;

  // ─── Контекст предыдущих отчётов за день ───
  if (dailyContext) {
    prompt += `

=== КОНТЕКСТ: ТВОИ ПРЕДЫДУЩИЕ ОТЧЁТЫ ЗА СЕГОДНЯ (${dateStr}) ===
${dailyContext}

КРИТИЧЕСКИ ВАЖНО: Не противоречь своим предыдущим отчётам!
- Если ты указал направление рынка или ключевые уровни ранее - продолжай эту логику, если данные не изменились кардинально
- Если данные РЕАЛЬНО изменились - честно отметь смену позиции и объясни причину
- Если утренняя идея ещё актуальна - подтверди это, не выдвигай противоположную без веских причин
- Если утренняя идея отработала или отменена - честно скажи об этом`;
  }

  prompt += `

=== ФОРМАТ ОТЧЁТА ===`;

  if (isFirstOfDay) {
    prompt += `
СЕЙЧАС УТРЕННИЙ ОТЧЁТ (${dateStr}). Это ПЕРВЫЙ отчёт дня.
Ты ДОЛЖЕН сформировать ровно 3 торговые идеи на сегодняшний день.

Структура отчёта:
## Общая картина рынка
(Краткий обзор - 2-3 абзаца: тренд, настроение, ключевые уровни. ИСПОЛЬЗУЙ ТОЛЬКО реальные цены из данных!)

## Динамика за ночь / премаркет
(Что произошло с момента закрытия вчерашней вечерней сессии, как менялся OI, F&G, SMI)

## Ключевые сигналы и тикеры
(ТОП-5 сигналов от роботов с анализом: тикер, направление, score, объём, интерпретация)

## Алгоритмическая активность
(Какие стратегии доминируют, аномалии, спуфинг, манипуляции)

## Новости и фундаментальный контекст
(ОБЯЗАТЕЛЬНО проанализируй новости из раздела данных! Свяжи каждую важную новость с технической картиной: какие тикеры затронуты, что уже отыграно рынком, а что нет. Если новостей мало - укажи это явно.)

## Дивергенции и противоречия
(Где OI противоречит цене, где SMI противоречит F&G, где новости противоречат технике)

## Торговые идеи на сегодня (3 ИДЕИ)
Сформируй ровно 3 конкретных внутридневных торговых идеи. Выбирай только САМЫЕ убедительные, с чётким обоснованием и высокой вероятностью отработки. Качество важнее количества! Формат каждой:
**Идея N. [НАПРАВЛЕНИЕ] [ТИКЕР] - [Краткое название]**
- Обоснование: (почему именно эта идея, связь данных и новостей)
- Уровень входа: (конкретная цена из реальных данных или условие)
- Цель: (фиксация прибыли)
- Стоп-лосс: (где идея отменяется)
- Вес: (1-5 звёзд - уверенность в идее)

Идеи только для ВНУТРИДНЕВНОЙ торговли! Не давайте позиционных идей! 3 идеи = максимальный фокус, каждая идея должна быть "железобетонной".

После Резюме добавь одну остроумную трейдерскую шутку-прибаутку, которая отражает контекст сегодняшнего рынка. Шутка должна быть остроумной, бить в самое живое, можно с лёгким матом если уместно. Это должна быть одна короткая фраза-перл, которую трейдер перескажет коллегам. Без цензуры - как в курилке ММВБ. Формат: курсив в двойных кавычках, без заголовка! Пример: _"Si сегодня такой же нервный, как тёща перед дивидендами"_. Не используй этот пример дословно - придумай свою в контексте СЕГОДНЯШНЕГО рынка!`;

    // Если есть вчерашние идеи - добавляем секцию анализа
    const prevIdeasList = Array.isArray(previousIdeas) ? previousIdeas : (previousIdeas?.ideas || []);
    if (prevIdeasList.length > 0) {
      prompt += `

## Анализ вчерашних идей
Проанализируй КАЖДУЮ из вчерашних идей:
- Сработала ли идея? (да/частично/нет)
- Почему сработала или не сработала? (со ссылкой на конкретные данные)
- Какой был бы результат при входе по рекомендации?
Это поможет улучшить качество будущих рекомендаций.

Вчерашние идеи:
${prevIdeasList.map((idea: any, i: number) => `${i + 1}. ${typeof idea === 'string' ? idea : idea.text || idea}`).join('\n')}`;
    }
  } else {
    // Дневные отчёты - только трекинг идей, без новых
    prompt += `
СЕЙЧАС ${slot === 'midday' ? 'ДНЕВНОЙ' : slot === 'afternoon' ? 'ДНЕВНОЙ (15:00)' : 'ВЕЧЕРНИЙ'} ОТЧЁТ (${dateStr}).
ВНИМАНИЕ: Это НЕ утренний отчёт. Новые торговые идеи НЕ формируются!
Только отслеживание утренних идей и комментарий по текущей ситуации.

Структура отчёта:
## Общая картина рынка
(Краткое обновление - 1-2 абзаца: что изменилось с утра. ИСПОЛЬЗУЙ ТОЛЬКО реальные цены!)

## Что изменилось с утреннего отчёта
(Динамика F&G, SMI, OI, ключевые сдвиги)

## Обновлённые сигналы
(ТОП-5 текущих сигналов - могли измениться с утра)

## Изменения в алгоритмической активности
(Новые паттерны, аномалии, которых не было утром)

## Трекинг утренних идей (КРИТИЧЕСКИ ВАЖНО!)
Отслеживай КАЖДУЮ из утренних идей по следующему формату:
**Идея N [ТИКЕР]** - Статус: [АКТУАЛЬНА / ЧАСТИЧНО ОТРАБОТАЛА / ОТМЕНЕНА / ПОЛНОСТЬЮ ОТРАБОТАЛА]
- Что произошло с ценой: (конкретные цифры из реальных данных!)
- Текущая рекомендация: [ДЕРЖАТЬ / ЗАКРЫТЬ / ПЕРЕВЕРНУТЬСЯ / ПЕРЕЙТИ В БЕЗУБЫТОК]
- Корректировка уровней: (если нужно - новые стоп/цель с обоснованием)

Утренние идеи на сегодня:
${(() => { const list = Array.isArray(previousIdeas) ? previousIdeas : (previousIdeas?.ideas || []); return list.length > 0 ? list.map((idea: any, i: number) => `${i + 1}. ${typeof idea === 'string' ? idea : idea.text || idea}`).join('\n') : 'Утренние идеи не найдены - проанализируй текущую ситуацию и расскажи, какие тикеры сейчас наиболее интересны'; })()}

НЕ ФОРМИРУЙ НОВЫЕ ТОРГОВЫЕ ИДЕИ! Только трекинг существующих!${slot === 'evening' ? `

После Резюме добавь одну остроумную трейдерскую шутку-прибаутку, которая подытоживает сегодняшний день на рынке. Шутка должна быть остроумной, бить в самое живое, можно с лёгким матом если уместно. Это должна быть одна короткая фраза-перл, которую трейдер перескажет коллегам. Без цензуры - как в курилке ММВБ. Подытожь день с юмором! Формат: курсив в двойных кавычках, без заголовка! Пример: _"Сегодняшний рынок как свидание с экспой - хотел красивый лонг, а получил маржин-колл"_. Не используй этот пример дословно - придумай свою в контексте СЕГОДНЯШНЕГО рынка и как прошёл день!` : ''}`;
  }

  prompt += `

## Резюме
(2-3 предложения - главное, что нужно знать трейдеру прямо сейчас)

ВНИМАНИЕ: НЕ пиши дисклеймер, предупреждение об ИИР или юридические оговорки! Дисклеймер добавляется автоматически системой. Если напишешь дисклеймер сам - он задвоится!

=== ПРАВИЛА АНАЛИЗА ===
1. ВСЕГДА проверяй тикер перед упоминанием! SR = фьючерс на Сбербанк, Si = фьючерс на доллар/рубль
2. Учитывай статус биржи - если закрыта, говори "прогноз на открытие"
3. НЕ ВЫДУМЫВАЙ ДАННЫЕ - используй только то, что есть в разделе данных! Это самое важное правило!
4. Конкретика, не вода - цифры, уровни, проценты (только из реальных данных!)
5. ОБЯЗАТЕЛЬНО анализируй новости из раздела данных! Это КРИТИЧЕСКИ ВАЖНО! Без новостного контекста анализ бесполезен. Связывай КАЖДУЮ важную новость с технической картиной. Если в данных есть новости - ты ДОЛЖЕН их обсудить в секции "Новости и фундаментальный контекст". Игнорирование новостей = некачественный отчёт
6. Отмечай дивергенции - это самые ценные сигналы для трейдеров
7. Если данных мало (рынок закрыт, нет сделок) - честно скажи об этом
8. Не противоречь своим предыдущим отчётам за день (если данные не изменились кардинально)
9. ВСЕГДА используй реальные цены из раздела "АКТУАЛЬНЫЕ КОТИРОВКИ ФЬЮЧЕРСОВ" для указания уровней входа/цели/стопа
10. НЕ используй эмодзи в заголовках разделов.
11. НЕ пиши дисклеймер, предупреждение об ИИР или юридические оговорки - они добавляются автоматически! Если добавишь сам - будет задвоение!
12. В КАЖДОМ отчёте ОБЯЗАТЕЛЬНО упомяни ключевые новости из раздела данных и их влияние на рынок. Даже если новостей мало - обсуди те что есть. Отчёт без анализа новостей считается неполным.

Формат: Markdown, русский язык. Будь точным и конкретным. Качество анализа важнее объёма.`;

  return prompt;
}

// ─── Extract ideas from AI response ─────────────────────────────────
function extractIdeas(response: string): string[] {
  const ideas: string[] = [];
  // Ищем блок "Торговые идеи"
  const ideasSection = response.match(/## Торговые идеи[\s\S]*?(?=## |$)/i)
    || response.match(/Торговые идеи на сегодня[\s\S]*?(?=## |$)/i);

  if (ideasSection) {
    // Разбиваем по "Идея N" или "**Идея N"
    const ideaMatches = ideasSection[0].match(/\*?\*?Идея \d+[\s\S]*?(?=\*?\*?Идея \d+|$)/gi) || [];
    for (const m of ideaMatches) {
      ideas.push(m.trim().replace(/^\*+\s*/, '').replace(/\*+$/, ''));
    }
  }

  return ideas.slice(0, 3);
}

// ─── Generate hint ──────────────────────────────────────────────────
async function generateHint(reportType: 'cron' | 'manual'): Promise<{ id: string; status: string; response?: string; error?: string; model?: string }> {
  const id = `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const startTime = Date.now();

  console.log(`[HINT] Generating ${reportType} hint ${id}`);

  try {
    // ─── Проверяем, торговый ли сегодня день ───
    const tradingDayInfo = await checkTradingDay();
    if (!tradingDayInfo.isTradingDay && !tradingDayInfo.futuresTraded) {
      const reason = tradingDayInfo.reason || 'неторговый день';
      console.log(`[HINT] Skipping report: non-trading day (${reason})`);
      return {
        id,
        status: 'skipped',
        error: `Неторговый день: ${reason}. Отчёт не формируется.`,
      };
    }

    const { slot, isFirstOfDay, slotIndex } = getReportSlot();
    const selectedModel = getModelForSlot(slotIndex);
    console.log(`[HINT] Slot: ${slot} (${slotIndex}), Model: ${selectedModel}`);

    // Запускаем ВСЕ данные параллельно — идеи + контекст + дашборд
    const ideasKey = isFirstOfDay ? IDEAS_KEY + ':prev' : IDEAS_KEY;
    const [previousIdeasResult, dailyContextResult, dashboardDataResult] = await Promise.allSettled([
      redisGet(ideasKey),
      getDailyContext(),
      fetchDashboardData(),
    ]);

    const previousIdeas = previousIdeasResult.status === 'fulfilled' ? previousIdeasResult.value : null;
    const dailyContext = dailyContextResult.status === 'fulfilled' ? dailyContextResult.value : '';
    const dashboardData = dashboardDataResult.status === 'fulfilled' ? dashboardDataResult.value : '';

    // Строим промпт
    const systemPrompt = await buildSystemPrompt(slot, isFirstOfDay, previousIdeas, dailyContext);

    // Вызываем OpenRouter
    const response = await fetch(OPENROUTER_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer': 'https://robot-detect-v3.vercel.app',
        'X-Title': 'Robot Detector - Neuro Hint',
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Проанализируй текущую ситуацию на рынке.\n\n${dashboardData}` },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[HINT] OpenRouter error ${response.status}:`, errText);
      return { id, status: 'failed', error: `OpenRouter ${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';

    if (!content) {
      return { id, status: 'failed', error: 'Empty response from AI' };
    }

    // ─── Добавляем дисклеймер ───
    content += DISCLAIMER;

    const completedAt = Date.now();
    const duration = ((completedAt - startTime) / 1000).toFixed(1);

    // Извлекаем идеи из утреннего отчёта
    if (isFirstOfDay) {
      const ideas = extractIdeas(content);
      if (ideas.length > 0) {
        // Сохраняем текущие утренние идеи как "предыдущие" для завтра
        const currentIdeas = await redisGet(IDEAS_KEY);
        if (currentIdeas) {
          await redisSet(IDEAS_KEY + ':prev', currentIdeas, 86400);
        }
        // Сохраняем новые утренние идеи
        await redisSet(IDEAS_KEY, { date: getMoscowDate().toISOString().slice(0, 10), ideas, slot: 'morning' }, 86400);
        console.log(`[HINT] Saved ${ideas.length} morning ideas`);
      }
    }

    // ─── Сохраняем контекст дня (резюме отчёта) ───
    await saveDailyContext(slot, content);

    // Сохраняем в историю
    const history = (await redisGet(HINT_KEY)) || [];
    history.unshift({
      id,
      status: 'completed',
      response: content,
      model: selectedModel,
      createdAt: startTime,
      completedAt,
      duration: `${duration}s`,
      slot: slot,
    });
    // Храним последние 20 подсказок
    await redisSet(HINT_KEY, history.slice(0, 20), 172800); // 48ч TTL

    console.log(`[HINT] ${id} completed in ${duration}s, ${content.length} chars, model: ${selectedModel}`);
    return { id, status: 'completed', response: content, model: selectedModel };
  } catch (err: any) {
    console.error(`[HINT] ${id} failed:`, err);
    return { id, status: 'failed', error: err.message };
  }
}

// ─── GET: история подсказок ──────────────────────────────────────────
export async function GET() {
  try {
    const history = (await redisGet(HINT_KEY)) || [];
    // Map to the format expected by AIHintModal
    const hints = history.map((h: any) => ({
      id: h.id || `hint-${h.createdAt || Date.now()}`,
      hint: h.response || '',
      model: h.model || '',
      generatedAt: h.createdAt ? msToMoscowISO(h.createdAt) : getMoscowISOString(),
      timestamp: h.createdAt ? msToMoscowISO(h.createdAt) : getMoscowISOString(),
      slot: h.slot || '',
      duration: h.duration || '',
    }));
    return NextResponse.json({ hints });
  } catch (err: any) {
    return NextResponse.json({ hints: [], error: err.message }, { status: 500 });
  }
}

// ─── POST: генерация подсказки / очистка ────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const password = String(body.password || '').trim();

    if (password !== '13420') {
      console.warn('[HINT] Password check failed, received:', JSON.stringify(password));
      return NextResponse.json({ error: 'Неверный пароль' }, { status: 403 });
    }

    // Действие: очистить все отчёты
    if (body.action === 'clear_all') {
      await redisDel(HINT_KEY);
      await redisDel(IDEAS_KEY);
      await redisDel(IDEAS_KEY + ':prev');

      // Удаляем все daily-context ключи
      for (let d = 0; d < 7; d++) {
        const date = new Date(Date.now() - d * 86400000);
        const msk = new Date(date.getTime() + 3 * 3600000);
        const dateStr = msk.toISOString().slice(0, 10);
        await redisDel(`${DAILY_CONTEXT_PREFIX}:context:${dateStr}`);
        await redisDel(`${DAILY_CONTEXT_PREFIX}:schedule:${dateStr}`);
      }

      // Также чистим ключ отчётов (из reports/route.ts)
      await redisDel('robot-detector:reports');

      console.log('[HINT] All reports, hints, and context cleared');
      return NextResponse.json({ ok: true, message: 'Все нейроотчёты, подсказки и контекст удалены' });
    }

    // Действие: сгенерировать подсказку
    const result = await generateHint('manual');

    // Если ошибка или пропуск - возвращаем JSON
    if (result.status !== 'completed') {
      return NextResponse.json(result);
    }

    // Возвращаем JSON с полным отчётом
    return NextResponse.json({
      id: result.id,
      hint: result.response || '',
      model: result.model || getModelForSlot(getReportSlot().slotIndex),
      slot: getReportSlot().slot,
      timestamp: getMoscowISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Экспортируем generateHint для cron
export { generateHint };
