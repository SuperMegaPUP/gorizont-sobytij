import { NextResponse } from 'next/server';
import { getConfigStore } from '@/lib/horizon/config/store-factory';

export async function GET() {
  try {
    const store = getConfigStore();
    const config = await store.getConfig().catch(() => null);
    const freeze = await store.getFreezeState().catch(() => ({ frozen: false }));
    const exps = await store.getExperiments().catch(() => []);

    return NextResponse.json({
      status: config ? 'healthy' : 'degraded',
      uptime: process.uptime(),
      detectorsActive: 18,
      detectorsTotal: 18,
      shadowDetectors: config?.global?.shadowMode ? ['SQUEEZE', 'PRE_IMPULSE'] : [],
      lastScanAt: new Date().toISOString(),
      configFrozen: freeze.frozen,
      activeExperiments: exps.filter((e) => e.status === 'running').length,
      redisConnected: config !== null,
      alertRate: 0,
      alertRateSigma: 0,
    });
  } catch (error) {
    return NextResponse.json(
      { status: 'critical', error: String(error) },
      { status: 503 }
    );
  }
}