import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { prisma, prismaQuery } from '@/lib/db';
import { createStateStore } from '@/lib/horizon/state/factory';

export const maxDuration = 60;

const TIMEOUT_MS = 45000;
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request) {
  const startTime = Date.now();

  const authHeader = request.headers.get('authorization');
  const url = new URL(request.url);
  const isCron = url.searchParams.get('cron') === 'true';

  if (isCron && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const dbOk = await prismaQuery(() => prisma.$queryRaw`SELECT 1`);
    if (!dbOk) throw new Error('Database not available');

    const stateStore = createStateStore();
    const stateStoreOk = await stateStore.ping();

    const tickers = ['SBER', 'GAZP', 'LKOH', 'YNDX', 'MGNT'];
    const results: any[] = [];

    for (const ticker of tickers) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        console.warn(`⚠️ Collect timeout after ${results.length} tickers`);
        break;
      }

      const result = {
        ticker,
        timestamp: new Date().toISOString(),
        stateStoreWorking: stateStoreOk,
      };
      results.push(result);
    }

    return NextResponse.json({
      status: 'ok',
      tickersProcessed: results.length,
      tickersTotal: tickers.length,
      elapsedMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Collect error:', error);
    return NextResponse.json(
      { status: 'error', error: error.message, elapsedMs: Date.now() - startTime },
      { status: 500 }
    );
  }
}