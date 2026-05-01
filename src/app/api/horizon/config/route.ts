import { NextRequest, NextResponse } from 'next/server';
import { getConfigStore } from '@/lib/horizon/config/store-factory';
import { getConfigResolver } from '@/lib/horizon/config/config-resolver';
import { validateConfigUpdate } from '@/lib/horizon/config/config-validator';
import { ConfigUpdateRequestSchema } from '@/lib/horizon/config/config-zod';
import { DEFAULT_HORIZON_CONFIG } from '@/lib/horizon/config/default-config';
import type { ConfigUpdateRequest, ConfigUpdateResponse } from '@/lib/horizon/config/config-schema';

export async function GET() {
  try {
    const store = getConfigStore();
    const config = await store.getConfig();
    const freeze = await store.getFreezeState();
    return NextResponse.json({
      config,
      freeze,
      defaults: DEFAULT_HORIZON_CONFIG,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Config fetch failed', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = ConfigUpdateRequestSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid format', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const req: ConfigUpdateRequest = parsed.data;
    const store = getConfigStore();

    const freeze = await store.getFreezeState();
    if (
      freeze.frozen &&
      (!freeze.frozenGroups || freeze.frozenGroups.length === 0 || freeze.frozenGroups.includes(req.group))
    ) {
      return NextResponse.json(
        { error: 'Config is frozen', reason: freeze.reason },
        { status: 403 }
      );
    }

    const sessionId = request.headers.get('x-session-id') || 'anonymous';
    const config = await store.getConfig();
    const maxChanges = config.global.maxChangesPerSession;

    if (await store.getChangeCount(sessionId) >= maxChanges) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const validation = validateConfigUpdate(config, req);
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'Validation failed', errors: validation.errors, warnings: validation.warnings },
        { status: 400 }
      );
    }

    const previousGroup = { ...config[req.group] } as Record<string, unknown>;
    await store.updateGroup(req.group, req.values);
    getConfigResolver(store).invalidateCache();

    const historyId = `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await store.addHistory({
      id: historyId,
      timestamp: new Date().toISOString(),
      userId: sessionId,
      action: 'update',
      group: req.group,
      previousValue: previousGroup,
      newValue: req.values,
      reason: req.reason,
    });

    const newCount = await store.incrementChangeCount(sessionId);

    const response: ConfigUpdateResponse = {
      success: true,
      previousValue: previousGroup,
      newValue: req.values,
      historyId,
      warnings: validation.warnings.map((w) => `${w.field}: ${w.message}`),
      changesRemaining: maxChanges - newCount,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: 'Update failed', details: String(error) },
      { status: 500 }
    );
  }
}