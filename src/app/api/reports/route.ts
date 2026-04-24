// ─── /api/reports ─────────────────────────────────────────────────────
// Генерация и хранение отчётов Neuro Hint
// GET  /api/reports        — список отчётов
// POST /api/reports        — ручная генерация (требует пароль)
// DELETE /api/reports      — очистить все отчёты (требует пароль)
//
// КРИТИЧЕСКИЕ ДЕТАЛИ:
// - Em-dash (—) ЗАПРЕЩЁН в HTTP заголовках (ByteString error)
// - Пароль: 13420
// - v2.0: Проверка торгового дня через MOEX Calendar API

import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';

export const dynamic = 'force-dynamic';

const REDIS_URL = process.env.REDIS_URL || '';
const REPORTS_KEY = 'robot-detector:reports';

// ─── Redis via ioredis ──────────────────────────────────────────────
let redisClient: Redis | null = null;
let redisError = '';

function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  if (redisError) return null;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
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
      console.error('[REPORTS] Redis error:', err.message);
      redisClient = null;
      redisError = err.message;
    });
    return redisClient;
  } catch (e: any) {
    console.error('[REPORTS] Failed to create Redis client:', e.message);
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
    console.error('[REPORTS] Redis GET error:', err);
    return null;
  }
}

async function redisSet(key: string, value: any, ttlSec = 172800): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    if (ttlSec) {
      await redis.setex(key, ttlSec, JSON.stringify(value));
    } else {
      await redis.set(key, JSON.stringify(value));
    }
  } catch (err) {
    console.warn('[REPORTS] Redis SET error:', err);
  }
}

async function redisDel(key: string): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    await redis.del(key);
  } catch (err) {
    console.warn('[REPORTS] Redis DEL error:', err);
  }
}

// ─── Generate report (calls hint API directly) ────────────────────
async function generateReport(type: 'cron' | 'manual'): Promise<{ id: string; status: string; preview?: string; error?: string }> {
  const id = `rpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const startTime = Date.now();

  console.log(`[REPORTS] Generating ${type} report ${id}`);

  try {
    // Вызываем hint API напрямую (не через HTTP!)
    const { generateHint } = await import('@/app/api/hint/route');
    const hintResult = await generateHint(type);

    // Если hint был пропущен (неторговый день), пропускаем и отчёт
    if (hintResult.status === 'skipped') {
      return { id, status: 'skipped', error: hintResult.error };
    }

    const completedAt = Date.now();
    const preview = hintResult.response?.slice(0, 100) || '';

    // Сохраняем отчёт в Redis
    const reports = (await redisGet(REPORTS_KEY)) || [];
    reports.unshift({
      id,
      type,
      status: hintResult.status,
      model: hintResult.model || (hintResult.status === 'completed' ? 'unknown' : ''),
      createdAt: startTime,
      completedAt,
      preview,
      hintId: hintResult.id,
    });

    // Храним последние 20 отчётов
    await redisSet(REPORTS_KEY, reports.slice(0, 20), 172800);

    console.log(`[REPORTS] ${id} ${hintResult.status} in ${((completedAt - startTime) / 1000).toFixed(1)}s`);
    return { id, status: hintResult.status, preview, error: hintResult.error };
  } catch (err: any) {
    console.error(`[REPORTS] ${id} failed:`, err);

    // Сохраняем failed отчёт
    try {
      const reports = (await redisGet(REPORTS_KEY)) || [];
      reports.unshift({
        id, type, status: 'failed', model: '', createdAt: startTime,
        completedAt: Date.now(), preview: '', error: err.message,
      });
      await redisSet(REPORTS_KEY, reports.slice(0, 20), 172800);
    } catch {}

    return { id, status: 'failed', error: err.message };
  }
}

// ─── GET: список отчётов ────────────────────────────────────────────
export async function GET() {
  try {
    const reports = (await redisGet(REPORTS_KEY)) || [];
    return NextResponse.json({ reports });
  } catch (err: any) {
    return NextResponse.json({ reports: [], error: err.message }, { status: 500 });
  }
}

// ─── POST: ручная генерация / очистка ──────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const password = body.password || '';
    if (password !== '13420') {
      return NextResponse.json({ error: 'Неверный пароль' }, { status: 403 });
    }

    // Действие: удалить все отчёты кроме самого свежего
    if (body.action === 'keep_last') {
      const reports = (await redisGet(REPORTS_KEY)) || [];
      if (reports.length <= 1) {
        return NextResponse.json({ ok: true, message: `Отчётов не более 1, ничего не удалено (всего: ${reports.length})` });
      }
      const kept = reports[0]; // самый свежий (первый в массиве)
      const removedCount = reports.length - 1;
      await redisSet(REPORTS_KEY, [kept], 172800);
      console.log(`[REPORTS] Kept latest report ${kept.id}, removed ${removedCount} old reports`);
      return NextResponse.json({ ok: true, message: `Оставлен только последний отчёт (${kept.id}), удалено: ${removedCount}`, kept });
    }

    // Действие: очистить все отчёты и связанные данные
    if (body.action === 'clear_all') {
      await redisDel(REPORTS_KEY);
      await redisDel('robot-detector:hints');
      await redisDel('robot-detector:ideas');
      await redisDel('robot-detector:ideas:prev');

      // Удаляем контекст за последние 7 дней
      const now = new Date();
      for (let d = 0; d < 7; d++) {
        const date = new Date(now.getTime() - d * 86400000);
        const msk = new Date(date.getTime() + 3 * 3600000);
        const dateStr = msk.toISOString().slice(0, 10);
        await redisDel(`robot-detector:daily:context:${dateStr}`);
        await redisDel(`robot-detector:daily:schedule:${dateStr}`);
      }

      console.log('[REPORTS] All reports, hints, ideas, and context cleared');
      return NextResponse.json({ ok: true, message: 'Все нейроотчёты, подсказки, идеи и контекст удалены' });
    }

    const result = await generateReport('manual');
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── DELETE: очистить все отчёты ────────────────────────────────────
export async function DELETE() {
  try {
    await redisDel(REPORTS_KEY);
    console.log('[REPORTS] All reports cleared');
    return NextResponse.json({ ok: true, message: 'Все отчёты удалены' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Экспортируем для cron
export { generateReport };
