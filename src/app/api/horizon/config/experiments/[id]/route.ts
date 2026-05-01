import { NextRequest, NextResponse } from 'next/server';
import { getConfigStore } from '@/lib/horizon/config/store-factory';
import { ExperimentEngine } from '@/lib/horizon/config/experiment-engine';
import { ExperimentActionRequestSchema } from '@/lib/horizon/config/config-zod';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const store = getConfigStore();
  const exp = (await store.getExperiments()).find((e) => e.id === params.id);

  return exp
    ? NextResponse.json({ experiment: exp })
    : NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const parsed = ExperimentActionRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid' }, { status: 400 });
    }

    const store = getConfigStore();
    const engine = new ExperimentEngine(store);

    switch (parsed.data.action) {
      case 'start':
        return NextResponse.json({
          experiment: await engine.startExperiment(params.id, parsed.data.controlTickers ?? []),
        });
      case 'complete':
        return NextResponse.json({
          experiment: await engine.completeExperiment(params.id),
        });
      case 'cancel':
        return NextResponse.json({
          experiment: await engine.cancelExperiment(params.id),
        });
      case 'promote':
        return NextResponse.json({
          success: true,
          config: await engine.promoteExperiment(params.id),
        });
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}