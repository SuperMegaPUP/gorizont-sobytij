import { NextRequest, NextResponse } from 'next/server';
import { getConfigStore } from '@/lib/horizon/config/store-factory';
import { getConfigResolver } from '@/lib/horizon/config/config-resolver';
import { ConfigRollbackRequestSchema } from '@/lib/horizon/config/config-zod';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = ConfigRollbackRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid' }, { status: 400 });
    }

    const store = getConfigStore();
    const history = await store.getHistory(500);
    const entry = history.find((h) => h.id === parsed.data.historyId);

    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const currentConfig = await store.getConfig();
    const prevGroup = { ...currentConfig[entry.group] } as Record<string, unknown>;

    await store.updateGroup(entry.group, entry.previousValue);
    getConfigResolver(store).invalidateCache();

    await store.addHistory({
      id: `hist_${Date.now()}_rb`,
      timestamp: new Date().toISOString(),
      userId: request.headers.get('x-session-id') || 'anonymous',
      action: 'rollback',
      group: entry.group,
      previousValue: prevGroup,
      newValue: entry.previousValue,
      reason: `Rollback to ${parsed.data.historyId}: ${parsed.data.reason}`,
    });

    return NextResponse.json({
      success: true,
      rolledBackTo: parsed.data.historyId,
      group: entry.group,
      restoredValues: entry.previousValue,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Rollback failed' }, { status: 500 });
  }
}