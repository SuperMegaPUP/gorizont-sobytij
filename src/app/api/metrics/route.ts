import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';

export const dynamic = 'force-dynamic';

// ─── Redis — serverless DB ──────────────────────────────────────
// Поддерживаемые env vars:
//   1. REDIS_URL (авто-детект: redis:// или rediss://)
//   2. UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (через @upstash/redis)
//   3. KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV)
//   4. POSTGRES_URL (Neon Postgres)

// TTL — 7 дней (данные хранятся для аналитики, отображение фильтруется по 30 мин в store)
const TTL_SECONDS = 7 * 24 * 60 * 60;

interface MetricsData {
  date: string;
  waveBuckets: any[];
  fearGreedIndex?: number;
  fearGreedHistory: any[];
  signals: any[];
  hourlyActivity: any[];
  oiSnapshots: any[];
  anomalies: any[];
  tickerAggs: any[];
  durationBuckets: any[];
  tickerDurationAggs: any[];
  strategyDistribution: any[];
  events: any[];             // Последние 50 событий для восстановления ленты
}

// ─── Redis клиент ───────────────────────────────────────────────
let redisClient: Redis | null = null;
let redisError = '';

function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  if (redisError) return null; // Не повторяем попытку если уже упало

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[METRICS] REDIS_URL not set');
    redisError = 'no-url';
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      connectTimeout: 5000,
      commandTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Не ретраить — Vercel serverless не ждёт
      tls: redisUrl.startsWith('rediss://') ? {} : undefined,
    });

    redisClient.on('error', (err) => {
      console.error('[METRICS] Redis error:', err.message);
      redisClient = null;
      redisError = err.message;
    });

    return redisClient;
  } catch (e: any) {
    console.error('[METRICS] Failed to create Redis client:', e.message);
    redisError = e.message;
    return null;
  }
}

// ─── GET /api/metrics — Загрузка накопленных метрик ────────────

export async function GET(req: NextRequest) {
  try {
    const redis = getRedis();
    if (!redis) {
      return NextResponse.json({
        date: new Date().toISOString().slice(0, 10),
        waveBuckets: [],
        fearGreedIndex: undefined,
        fearGreedHistory: [],
        signals: [],
        hourlyActivity: [],
        oiSnapshots: [],
        anomalies: [],
        tickerAggs: [],
        durationBuckets: [],
        tickerDurationAggs: [],
        strategyDistribution: [],
        events: [],
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const key = `metrics:${today}`;

    const raw = await redis.get(key);
    if (!raw) {
      return NextResponse.json({
        date: today,
        waveBuckets: [],
        fearGreedIndex: undefined,
        fearGreedHistory: [],
        signals: [],
        hourlyActivity: [],
        oiSnapshots: [],
        anomalies: [],
        tickerAggs: [],
        durationBuckets: [],
        tickerDurationAggs: [],
        strategyDistribution: [],
        events: [],
      });
    }

    const data: MetricsData = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[METRICS GET] Error:', error.message);
    return NextResponse.json({
      date: new Date().toISOString().slice(0, 10),
      waveBuckets: [],
      fearGreedIndex: undefined,
      fearGreedHistory: [],
      signals: [],
      hourlyActivity: [],
      oiSnapshots: [],
      anomalies: [],
      tickerAggs: [],
      durationBuckets: [],
      tickerDurationAggs: [],
      strategyDistribution: [],
      events: [],
    });
  }
}

// ─── POST /api/metrics — Сохранение метрик ────────────────────

export async function POST(req: NextRequest) {
  try {
    const redis = getRedis();
    if (!redis) {
      return NextResponse.json({ ok: true, source: 'no-redis' });
    }

    const body = await req.json();
    const date = body.date || new Date().toISOString().slice(0, 10);
    const key = `metrics:${date}`;

    // Читаем существующие данные для merge (чтобы не терять waveBuckets/анномалии от других сессий)
    let existing: MetricsData | null = null;
    try {
      const raw = await redis.get(key);
      if (raw) existing = JSON.parse(raw);
    } catch { /* ignore parse errors */ }

    let merged = body;
    if (existing) {
      // Merge waveBuckets: объединяем по ключу window, берём максимум events/lots
      const wbMap = new Map<string, any>();
      for (const b of (existing.waveBuckets || [])) wbMap.set(b.window, b);
      for (const b of (body.waveBuckets || [])) {
        const cur = wbMap.get(b.window);
        if (cur) {
          cur.events = Math.max(cur.events, b.events);
          cur.buyLots = Math.max(cur.buyLots, b.buyLots);
          cur.sellLots = Math.max(cur.sellLots, b.sellLots);
          cur.delta = b.delta;  // Последний delta — самый актуальный
        } else {
          wbMap.set(b.window, b);
        }
      }
      merged.waveBuckets = Array.from(wbMap.values());

      // Больше FG/totalEvents из существующих и новых
      merged.fearGreedIndex = body.fearGreedIndex ?? existing.fearGreedIndex;
      merged.buyLots = Math.max(body.buyLots || 0, existing.buyLots || 0);
      merged.sellLots = Math.max(body.sellLots || 0, existing.sellLots || 0);
      merged.totalEvents = Math.max(body.totalEvents || 0, existing.totalEvents || 0);

      // Merge hourlyActivity: объединяем по ключу hour, суммируем buy/sell
      const haMap = new Map<string, any>();
      for (const h of (existing.hourlyActivity || [])) haMap.set(h.hour, h);
      for (const h of (body.hourlyActivity || [])) {
        const cur = haMap.get(h.hour);
        if (cur) {
          cur.buy = Math.max(cur.buy || 0, h.buy || 0);
          cur.sell = Math.max(cur.sell || 0, h.sell || 0);
        } else {
          haMap.set(h.hour, h);
        }
      }
      merged.hourlyActivity = Array.from(haMap.values());

      // Merge oiSnapshots: по ключу ticker+time, берём последнее
      const oiMap = new Map<string, any>();
      for (const s of (existing.oiSnapshots || [])) oiMap.set(`${s.ticker}:${s.time}`, s);
      for (const s of (body.oiSnapshots || [])) oiMap.set(`${s.ticker}:${s.time}`, s);  // Новое перезаписывает старое
      merged.oiSnapshots = Array.from(oiMap.values());

      // Merge anomalies: по id, новые перезаписывают старые + добавляют новые
      const anMap = new Map<string, any>();
      for (const a of (existing.anomalies || [])) anMap.set(a.id, a);
      for (const a of (body.anomalies || [])) anMap.set(a.id, a);
      merged.anomalies = Array.from(anMap.values());

      // Merge tickerAggs: по ticker, берём максимум (новое актуальнее)
      const taMap = new Map<string, any>();
      for (const a of (existing.tickerAggs || [])) taMap.set(a.ticker, a);
      for (const a of (body.tickerAggs || [])) taMap.set(a.ticker, a);  // Новое перезаписывает
      merged.tickerAggs = Array.from(taMap.values());

      // Merge durationBuckets: по label, берём максимум
      const dbMap = new Map<string, any>();
      for (const b of (existing.durationBuckets || [])) dbMap.set(b.label, b);
      for (const b of (body.durationBuckets || [])) {
        const cur = dbMap.get(b.label);
        if (cur) {
          cur.events = Math.max(cur.events || 0, b.events || 0);
          cur.lots = Math.max(cur.lots || 0, b.lots || 0);
          cur.buyLots = Math.max(cur.buyLots || 0, b.buyLots || 0);
          cur.sellLots = Math.max(cur.sellLots || 0, b.sellLots || 0);
        } else {
          dbMap.set(b.label, b);
        }
      }
      merged.durationBuckets = Array.from(dbMap.values());

      // Merge tickerDurationAggs: по ticker, новое перезаписывает
      const tdMap = new Map<string, any>();
      for (const a of (existing.tickerDurationAggs || [])) tdMap.set(a.ticker, a);
      for (const a of (body.tickerDurationAggs || [])) tdMap.set(a.ticker, a);
      merged.tickerDurationAggs = Array.from(tdMap.values());

      // Merge strategyDistribution: по name, берём максимум count
      const sdMap = new Map<string, any>();
      for (const s of (existing.strategyDistribution || [])) sdMap.set(s.name, s);
      for (const s of (body.strategyDistribution || [])) {
        const cur = sdMap.get(s.name);
        if (cur) {
          cur.count = Math.max(cur.count || 0, s.count || 0);
        } else {
          sdMap.set(s.name, s);
        }
      }
      merged.strategyDistribution = Array.from(sdMap.values());

      // Merge signals: накапливаем все сигналы для аналитики (ключ = id + ts для уникальности)
      // Не перезаписываем старые — они нужны для исторической аналитики
      const sigMap = new Map<string, any>();
      for (const s of (existing.signals || [])) {
        const key = s.id || `${s.ticker}-${s.direction}`;
        sigMap.set(key, s);  // Старые из БД
      }
      for (const s of (body.signals || [])) {
        const key = s.id || `${s.ticker}-${s.direction}`;
        sigMap.set(key, s);  // Новые перезаписывают тот же id (обновление)
      }
      // Ограничиваем размер: оставляем последние 200 сигналов (сортировка по ts)
      const allSignals = Array.from(sigMap.values())
        .sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0))
        .slice(0, 200);
      merged.signals = allSignals;

      // Events: берём из нового (они актуальнее, последние 50)
      merged.events = body.events || existing.events || [];
    }

    // Сохраняем с TTL
    await redis.setex(key, TTL_SECONDS, JSON.stringify(merged));

    return NextResponse.json({ ok: true, source: 'redis' });
  } catch (error: any) {
    console.error('[METRICS POST] Error:', error.message);
    return NextResponse.json({ ok: true, source: 'error', error: error.message });
  }
}
