import { NextRequest, NextResponse } from 'next/server';
import { getConfigStore } from '@/lib/horizon/config/store-factory';
import { ExperimentEngine } from '@/lib/horizon/config/experiment-engine';
import { CreateExperimentRequestSchema } from '@/lib/horizon/config/config-zod';

export async function GET() {
  const store = getConfigStore();
  return NextResponse.json({ experiments: await store.getExperiments() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateExperimentRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const store = getConfigStore();
    const engine = new ExperimentEngine(store);

    const experiment = await engine.createExperiment({
      name: parsed.data.name,
      description: parsed.data.description,
      createdBy: request.headers.get('x-session-id') || 'anonymous',
      config: parsed.data.config as Partial<import('@/lib/horizon/config/config-schema').HorizonDetectorConfig>,
      tickers: parsed.data.tickers,
    });

    return NextResponse.json({ experiment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Create failed' }, { status: 500 });
  }
}