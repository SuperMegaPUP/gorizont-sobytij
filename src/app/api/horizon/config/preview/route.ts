import { NextRequest, NextResponse } from 'next/server';
import { getConfigStore } from '@/lib/horizon/config/store-factory';
import { ConfigPreviewRequestSchema } from '@/lib/horizon/config/config-zod';
import type { ConfigPreviewResponse } from '@/lib/horizon/config/config-schema';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = ConfigPreviewRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const store = getConfigStore();
    const config = await store.getConfig();

    const proposedGroupConfig = {
      ...config[parsed.data.group],
      ...parsed.data.values,
    };

    const proposedConfig = {
      ...config,
      [parsed.data.group]: proposedGroupConfig,
    };

    const preview: ConfigPreviewResponse = {
      ticker: parsed.data.ticker,
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