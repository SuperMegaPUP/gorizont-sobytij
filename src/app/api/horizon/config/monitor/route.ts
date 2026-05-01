import { NextRequest, NextResponse } from 'next/server';
import { getConfigStore } from '@/lib/horizon/config/store-factory';
import { AutoRollbackMonitor } from '@/lib/horizon/config/auto-rollback-monitor';

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET;
  
  if (expectedSecret && cronSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const store = getConfigStore();
    const config = await store.getConfig();
    const rates = await store.getAlertRates(10);
    const currentRate = rates.length > 0 ? rates[rates.length - 1].rate : 0;

    const monitor = new AutoRollbackMonitor(store);
    const event = await monitor.check(config, currentRate);

    return NextResponse.json(
      event
        ? { status: 'rollback_triggered', event }
        : { status: 'healthy' }
    );
  } catch (error) {
    return NextResponse.json({ error: 'Monitor failed' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const store = getConfigStore();
    const config = await store.getConfig();
    const log = await store.getRollbackLog();

    return NextResponse.json({
      sigmaThreshold: config.global.autoRollbackSigma,
      windowMin: config.global.autoRollbackWindowMin,
      recentRollbacks: log.slice(-5),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Status failed' }, { status: 500 });
  }
}