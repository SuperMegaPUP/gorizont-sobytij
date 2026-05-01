import { NextRequest, NextResponse } from 'next/server';
import { getConfigStore } from '@/lib/horizon/config/store-factory';
import { ConfigFreezeRequestSchema } from '@/lib/horizon/config/config-zod';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = ConfigFreezeRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid' }, { status: 400 });
    }

    const store = getConfigStore();
    const userId = request.headers.get('x-session-id') || 'anonymous';

    if (parsed.data.freeze) {
      await store.setFreezeState({
        frozen: true,
        frozenAt: new Date().toISOString(),
        frozenBy: userId,
        reason: parsed.data.reason,
        frozenGroups: parsed.data.groups,
      });

      await store.addHistory({
        id: `hist_${Date.now()}_frz`,
        timestamp: new Date().toISOString(),
        userId,
        action: 'freeze',
        group: 'global',
        previousValue: { frozen: false },
        newValue: { frozen: true, groups: parsed.data.groups },
        reason: parsed.data.reason || 'Manual',
      });
    } else {
      await store.setFreezeState({ frozen: false });

      await store.addHistory({
        id: `hist_${Date.now()}_ufz`,
        timestamp: new Date().toISOString(),
        userId,
        action: 'unfreeze',
        group: 'global',
        previousValue: { frozen: true },
        newValue: { frozen: false },
        reason: parsed.data.reason || 'Manual',
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Freeze failed' }, { status: 500 });
  }
}