import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';

export const dynamic = 'force-dynamic';

// ─── Redis — serverless DB (same pattern as /api/metrics) ────────
const TTL_SECONDS = 48 * 60 * 60; // 48 hours

// Current layout version — must match layout-store.ts LAYOUT_VERSION
const CURRENT_LAYOUT_VERSION = 12;

interface LayoutData {
  layouts: Record<string, any[]>;
  hiddenFrames: string[];
  layoutVersion?: number;
}

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
      console.error('[LAYOUT] Redis error:', err.message);
      redisClient = null;
      redisError = err.message;
    });

    return redisClient;
  } catch (e: any) {
    console.error('[LAYOUT] Failed to create Redis client:', e.message);
    redisError = e.message;
    return null;
  }
}

const EMPTY_LAYOUT: LayoutData = { layouts: {}, hiddenFrames: [] };

// ─── GET /api/layout — Load saved layout ──────────────────────────

export async function GET(req: NextRequest) {
  try {
    const redis = getRedis();
    if (!redis) {
      return NextResponse.json(EMPTY_LAYOUT);
    }

    const raw = await redis.get('rd_layout');
    if (!raw) {
      return NextResponse.json(EMPTY_LAYOUT);
    }

    const data: LayoutData = JSON.parse(raw);

    // Server-side version check: if Redis data is from an older layout version,
    // delete it and return empty layout. This forces the client to use defaults.
    const storedVersion = data.layoutVersion || 0;
    if (storedVersion < CURRENT_LAYOUT_VERSION) {
      console.log('[LAYOUT GET] Stale version in Redis (' + storedVersion + ' < ' + CURRENT_LAYOUT_VERSION + '), deleting');
      await redis.del('rd_layout');
      return NextResponse.json(EMPTY_LAYOUT);
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[LAYOUT GET] Error:', error.message);
    return NextResponse.json(EMPTY_LAYOUT);
  }
}

// ─── POST /api/layout — Save layout ───────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const redis = getRedis();
    if (!redis) {
      return NextResponse.json({ ok: true, source: 'no-redis' });
    }

    const body: LayoutData = await req.json();

    // Always stamp with current version
    body.layoutVersion = CURRENT_LAYOUT_VERSION;

    await redis.setex('rd_layout', TTL_SECONDS, JSON.stringify(body));

    return NextResponse.json({ ok: true, source: 'redis' });
  } catch (error: any) {
    console.error('[LAYOUT POST] Error:', error.message);
    return NextResponse.json({ ok: true, source: 'error', error: error.message });
  }
}
