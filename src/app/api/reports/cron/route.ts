// ─── /api/reports/cron ────────────────────────────────────────────────
// Vercel Cron endpoint - вызывается автоматически 4 раза в день
// ВНИМАНИЕ: Не делать self-fetch через HTTP! Вызываем generateReport() напрямую.
//
// Расписание: 05:00, 09:00, 12:00, 17:00 UTC = 08:00, 12:00, 15:00, 20:00 МСК
//
// v2.0: Проверка торгового дня через MOEX Calendar API
// Если сегодня неторговый день (праздник, выходной) - отчёт не формируется.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startTime = Date.now();
  console.log('[CRON] Scheduled report generation started');

  try {
    // Импортируем и вызываем напрямую - НЕ через HTTP!
    const { generateReport } = await import('@/app/api/reports/route');
    const result = await generateReport('cron');

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Если отчёт пропущен (неторговый день) - это не ошибка
    if (result.status === 'skipped') {
      console.log(`[CRON] Report skipped: ${result.error}`);
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: result.error,
        duration: `${duration}s`,
      });
    }

    console.log(`[CRON] Report generation ${result.status} in ${duration}s`);

    return NextResponse.json({
      ok: true,
      reportId: result.id,
      status: result.status,
      duration: `${duration}s`,
      preview: result.preview?.slice(0, 50),
    });
  } catch (err: any) {
    console.error('[CRON] Report generation failed:', err);
    return NextResponse.json({
      ok: false,
      error: err.message,
      duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    }, { status: 500 });
  }
}
