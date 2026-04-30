import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createStateStore } from '@/lib/horizon/state/factory';

export const dynamic = 'force-dynamic';

interface HealthCheck {
  status: 'ok' | 'error' | 'degraded';
  latencyMs?: number;
  error?: string;
}

export async function GET() {
  const checks: Record<string, HealthCheck> = {};
  const startTime = Date.now();

  // 1. PostgreSQL
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = {
      status: 'ok',
      latencyMs: Date.now() - dbStart,
    };
  } catch (error: any) {
    checks.database = {
      status: 'error',
      error: error.message?.substring(0, 100),
    };
  }

  // 2. Redis / KV
  try {
    const redisStart = Date.now();
    const store = createStateStore();
    const pingOk = await store.ping();
    checks.redis = {
      status: pingOk ? 'ok' : 'error',
      latencyMs: Date.now() - redisStart,
    };
  } catch (error: any) {
    checks.redis = {
      status: 'error',
      error: error.message?.substring(0, 100),
    };
  }

  // 3. MOEX API (light check)
  try {
    const moexStart = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('https://iss.moex.com/iss/index.json', {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    checks.moex = {
      status: response.ok ? 'ok' : 'error',
      latencyMs: Date.now() - moexStart,
    };
  } catch (error: any) {
    checks.moex = {
      status: 'error',
      error: error.name === 'AbortError' ? 'timeout' : error.message?.substring(0, 100),
    };
  }

  const allOk = Object.values(checks).every(c => c.status === 'ok');
  const hasErrors = Object.values(checks).some(c => c.status === 'error');

  return NextResponse.json(
    {
      status: allOk ? 'ok' : hasErrors ? 'error' : 'degraded',
      checks,
      version: process.env.npm_package_version || '3.2.1',
      env: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      totalLatencyMs: Date.now() - startTime,
    },
    { status: allOk ? 200 : hasErrors ? 503 : 200 }
  );
}