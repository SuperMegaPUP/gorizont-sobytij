import { NextRequest, NextResponse } from 'next/server';

// Календарь неторговых дней MOEX
// GET /api/calendar?from=2026-01-01&till=2026-12-31

export const dynamic = 'force-dynamic';

const MOEX_APIM = 'https://apim.moex.com';
const MOEX_ISS = 'https://iss.moex.com';
const JWT = (process.env.MOEX_JWT || '').trim();

interface CalendarDay {
  date: string;
  stock: { isTraded: boolean; reason: string; sessionDate: string | null };
  futures: { isTraded: boolean; reason: string; sessionDate: string | null };
  currency: { isTraded: boolean; reason: string; sessionDate: string | null };
}

const REASON_MAP: Record<string, string> = {
  H: 'Праздник',
  W: 'Выходной',
  N: 'Торговый день',
  T: 'Перенесённый день',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') || (() => {
    const d = new Date();
    return `${d.getFullYear()}-01-01`;
  })();
  const till = searchParams.get('till') || (() => {
    const d = new Date();
    return `${d.getFullYear()}-12-31`;
  })();

  try {
    // ── Попытка 1: APIM Combined (JWT авторизация) ──
    let data: any = null;

    if (JWT) {
      try {
        const res = await fetch(
          `${MOEX_APIM}/iss/calendars.json?from=${from}&till=${till}&show_all_days=1&iss.only=off_days`,
          {
            headers: { Authorization: `Bearer ${JWT}` },
            cache: 'no-store',
          }
        );
        if (res.ok) data = await res.json();
        else console.warn('Calendar APIM combined status:', res.status);
      } catch (e) { console.warn('Calendar APIM combined error:', e); }
    }

    // ── Попытка 2: ISS Combined (без авторизации, может вернуть HTML) ──
    if (!data) {
      try {
        const res = await fetch(
          `${MOEX_ISS}/iss/calendars.json?from=${from}&till=${till}&show_all_days=1&iss.only=off_days`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('json')) {
            data = await res.json();
          } else {
            console.warn('Calendar ISS returned non-JSON:', ct);
          }
        }
      } catch (e) { console.warn('Calendar ISS combined error:', e); }
    }

    // ── Попытка 3: Отдельные эндпоинты по рынкам ──
    if (!data?.off_days?.data || data.off_days.data.length === 0) {
      console.warn('Calendar: combined returned empty, trying separate endpoints');
      const [stockData, futuresData, currencyData] = await Promise.all([
        fetchMarketCalendar('stock', from, till),
        fetchMarketCalendar('futures', from, till),
        fetchMarketCalendar('currency', from, till),
      ]);

      // Мержим по дате
      const dateMap = new Map<string, CalendarDay>();

      for (const item of stockData) {
        dateMap.set(item.date, {
          date: item.date,
          stock: { isTraded: item.isTraded, reason: item.reason, sessionDate: item.sessionDate },
          futures: { isTraded: true, reason: '', sessionDate: null },
          currency: { isTraded: true, reason: '', sessionDate: null },
        });
      }

      for (const item of futuresData) {
        const existing = dateMap.get(item.date);
        if (existing) {
          existing.futures = { isTraded: item.isTraded, reason: item.reason, sessionDate: item.sessionDate };
        } else {
          dateMap.set(item.date, {
            date: item.date,
            stock: { isTraded: true, reason: '', sessionDate: null },
            futures: { isTraded: item.isTraded, reason: item.reason, sessionDate: item.sessionDate },
            currency: { isTraded: true, reason: '', sessionDate: null },
          });
        }
      }

      for (const item of currencyData) {
        const existing = dateMap.get(item.date);
        if (existing) {
          existing.currency = { isTraded: item.isTraded, reason: item.reason, sessionDate: item.sessionDate };
        } else {
          dateMap.set(item.date, {
            date: item.date,
            stock: { isTraded: true, reason: '', sessionDate: null },
            futures: { isTraded: true, reason: '', sessionDate: null },
            currency: { isTraded: item.isTraded, reason: item.reason, sessionDate: item.sessionDate },
          });
        }
      }

      const days = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      return NextResponse.json({ days, source: 'separate', from, till });
    }

    // ── Парсим combined данные ──
    const columns: string[] = data.off_days.columns || [];
    const rows: any[][] = data.off_days.data || [];
    const days: CalendarDay[] = [];

    for (const row of rows) {
      const obj: any = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });

      days.push({
        date: obj.tradedate || '',
        stock: {
          isTraded: obj.stock_workday === 1,
          reason: REASON_MAP[obj.stock_reason] || obj.stock_reason || '',
          sessionDate: obj.stock_trade_session_date || null,
        },
        futures: {
          isTraded: obj.futures_workday === 1,
          reason: REASON_MAP[obj.futures_reason] || obj.futures_reason || '',
          sessionDate: obj.futures_trade_session_date || null,
        },
        currency: {
          isTraded: obj.currency_workday === 1,
          reason: REASON_MAP[obj.currency_reason] || obj.currency_reason || '',
          sessionDate: obj.currency_trade_session_date || null,
        },
      });
    }

    return NextResponse.json({ days, source: 'combined', from, till });
  } catch (err: any) {
    console.error('Calendar API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function fetchMarketCalendar(
  market: 'stock' | 'futures' | 'currency',
  from: string,
  till: string
): Promise<{ date: string; isTraded: boolean; reason: string; sessionDate: string | null }[]> {
  const endpoints: Record<string, string> = {
    stock: '/iss/calendars/stock.json',
    futures: '/iss/calendars/futures.json',
    currency: '/iss/calendars/currency.json',
  };

  try {
    let data: any = null;
    const path = `${endpoints[market]}?from=${from}&till=${till}&show_all_days=1&iss.only=off_days`;

    // Сначала APIM с JWT
    if (JWT) {
      try {
        const res = await fetch(`${MOEX_APIM}${path}`, {
          headers: { Authorization: `Bearer ${JWT}` },
          cache: 'no-store',
        });
        if (res.ok) data = await res.json();
      } catch { /* fallback */ }
    }

    // Потом ISS без авторизации
    if (!data) {
      try {
        const res = await fetch(`${MOEX_ISS}${path}`, { cache: 'no-store' });
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('json')) {
            data = await res.json();
          }
        }
      } catch { /* ignore */ }
    }

    if (!data?.off_days?.data) return [];

    const columns: string[] = data.off_days.columns || [];
    const rows: any[][] = data.off_days.data || [];

    return rows.map((row) => {
      const obj: any = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return {
        date: obj.tradedate || '',
        isTraded: obj.is_traded === 1,
        reason: REASON_MAP[obj.reason] || obj.reason || '',
        sessionDate: obj.trade_session_date || null,
      };
    });
  } catch {
    return [];
  }
}
