import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// In-memory store for robot detection events (resets on redeploy, fine for demo)
interface RobotEvent {
  id: string;
  ts: number;
  ticker: string;
  figi: string;
  direction: 'BUY' | 'SELL' | 'MIXED';
  lots: number;
  pattern: string;
  confidence: number;
  wap: number;
  delta: number;
  duration_sec: number;
  percentOfDay: number;
  priceImpact: number;
  spreadImpact: number;
  source: string;
}

const events: RobotEvent[] = [];
let eventIdCounter = 0;

// GET /api/robot-events — получить все события
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') || '200');
  const direction = searchParams.get('direction');
  const ticker = searchParams.get('ticker');
  const pattern = searchParams.get('pattern');

  let filtered = [...events];
  if (direction) filtered = filtered.filter(e => e.direction === direction);
  if (ticker) filtered = filtered.filter(e => e.ticker === ticker);
  if (pattern) filtered = filtered.filter(e => e.pattern === pattern);

  return NextResponse.json({
    events: filtered.slice(0, limit),
    total: events.length,
    filtered: filtered.length,
  });
}

// POST /api/robot-events — добавить событие (от детектора)
export async function POST(req: NextRequest) {
  const body = await req.json();

  const event: RobotEvent = {
    id: `evt-${++eventIdCounter}`,
    ts: body.ts || Date.now() / 1000,
    ticker: body.ticker || '???',
    figi: body.figi || '',
    direction: body.direction || 'MIXED',
    lots: body.lots || 0,
    pattern: body.pattern || 'unknown',
    confidence: body.confidence || 0,
    wap: body.wap || 0,
    delta: body.delta || 0,
    duration_sec: body.duration_sec || 0,
    percentOfDay: body.percentOfDay || 0,
    priceImpact: body.priceImpact || 0,
    spreadImpact: body.spreadImpact || 0,
    source: body.source || 'tinvest',
  };

  events.unshift(event);
  // Keep max 5000 events in memory
  if (events.length > 5000) events.length = 5000;

  return NextResponse.json({ ok: true, id: event.id, total: events.length });
}
