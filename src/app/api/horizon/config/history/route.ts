import { NextRequest, NextResponse } from 'next/server';
import { getConfigStore } from '@/lib/horizon/config/store-factory';

export async function GET(request: NextRequest) {
  try {
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50', 10);
    const store = getConfigStore();
    const history = await store.getHistory(limit);
    return NextResponse.json({ history, total: history.length });
  } catch (error) {
    return NextResponse.json({ error: 'History failed' }, { status: 500 });
  }
}