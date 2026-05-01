import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/api/horizon/health',
  '/api/horizon/scan',
  '/api/horizon/config/monitor',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/api/horizon')) {
    return NextResponse.next();
  }

  if (pathname.includes('/config/monitor') && request.method === 'POST') {
    const cronSecret = request.headers.get('x-cron-secret');
    const expectedSecret = process.env.CRON_SECRET;

    if (expectedSecret && cronSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Cron auth failed' }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/horizon/config')) {
    const token = request.headers.get('x-admin-token');
    if (token && token === process.env.ADMIN_TOKEN) {
      return NextResponse.next();
    }

    const session = request.cookies.get('horizon-session');
    if (session?.value) {
      return NextResponse.next();
    }

    return NextResponse.json(
      { error: 'Auth required', hint: 'Provide x-admin-token or horizon-session cookie' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/horizon/:path*'],
};