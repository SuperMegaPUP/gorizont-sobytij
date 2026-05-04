import { NextRequest, NextResponse } from 'next/server';
import { getConfigStore } from '@/lib/horizon/config/store-factory';
import type { ConfigPreviewResponse, ConfigGroup } from '@/lib/horizon/config/config-schema';

const VALID_GROUPS = ['global', 'q10_predator', 'q1_priceControl', 'q8_squeeze', 'q11_rotation', 'q9_preImpulse', 'q12_algorithmic', 'cipher', 'conf'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { group, values, ticker } = body as { group?: string; values?: Record<string, unknown>; ticker?: string };

    if (!group || !VALID_GROUPS.includes(group)) {
      return NextResponse.json(
        { error: 'Invalid group', details: `Group must be one of: ${VALID_GROUPS.join(', ')}` },
        { status: 400 }
      );
    }

    if (!values || typeof values !== 'object') {
      return NextResponse.json({ error: 'Invalid values', details: 'values must be an object' }, { status: 400 });
    }

    if (!ticker || typeof ticker !== 'string') {
      return NextResponse.json({ error: 'Invalid ticker', details: 'ticker is required' }, { status: 400 });
    }

    const store = getConfigStore();
    const config = await store.getConfig();

    const currentGroupConfig = config[group as ConfigGroup];
    if (!currentGroupConfig) {
      return NextResponse.json(
        { error: 'Invalid group', details: `Group '${group}' not found in config` },
        { status: 400 }
      );
    }

    const proposedGroupConfig = {
      ...currentGroupConfig,
      ...values,
    };

    const preview: ConfigPreviewResponse = {
      ticker,
      timestamp: new Date().toISOString(),
      current: {
        alerts: 0,
        topPatterns: [],
        effectiveSignals: {},
      },
      proposed: {
        alerts: 0,
        topPatterns: [],
        effectiveSignals: {},
      },
      slots: [],
      delta: {
        alertsDelta: 0,
        riskLevel: 'low',
        warnings: ['Preview engine placeholder - implement with KV data'],
        affectedDetectors: [],
      },
    };

    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      { error: 'Preview failed', details: String(error) },
      { status: 500 }
    );
  }
}