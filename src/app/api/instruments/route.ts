import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MOEX_JWT = process.env.MOEX_JWT;

// ─── Статический маппинг ticker → FIGI для Tinkoff API ────────────────────
// Обновлять раз в месяц (FIGI не меняются часто)
const FIGI_MAP: Record<string, string> = {
  SBER: 'BBG004730N88',
  GAZP: 'BBG004716R88',
  LKOH: 'BBG004720LK0',
  GMKN: 'BBG004YKBDH2',
  NVTK: 'BBG00475KKY6',
  ROSN: 'BBG004716RP6',
  YNDX: 'BBG006L8G4H1',
  VTBR: 'BBG004730ZJ6',
  PLZL: 'BBG004S681W1',
  MOEX: 'BBG004730JJ88',
  MGNT: 'BBG004S68CP95',
  MTSS: 'BBG004730ZZ98',
  ALRS: 'BBG004S68B31',
  CHMF: 'BBG004S686M5',
  NLMK: 'BBG004S68707',
  POLY: 'BBG004DXK2H3',
  TATN: 'BBG0049MHP94',
  SNGS: 'BBG0047315Y93',
  SNGSP: 'BBG0047316R86',
  RUAL: 'BBG004F00V53',
  FIVE: 'BBG004RVN5H3',
  PHOR: 'BBG004S689Z3',
  IRAO: 'BBG00475KHZ4',
  OZON: 'BBG004F5FBN0',
  AFKS: 'BBG004S685G5',
  RTKM: 'BBG004731484',
  PIKK: 'BBG004S68CT84',
  GNLK: 'BBG004S68BW6',
  FEES: 'BBG004730RPX3',
  MAGN: 'BBG004S68BRH7',
  // ... остальные по необходимости
};

interface Instrument {
  ticker: string;
  figi: string;
  lot: number;
  name: string;
  board: string;
  dailyValue: number;   // оборот за день
  dailyVolume: number;  // объём в лотах
  price: number;
  changePct: number;
}

export async function GET() {
  try {
    // MOEX ISS: TOP акций по обороту на Т+ рынке
    const url = 'https://iss.moex.com/iss/statistics/engines/stock/markets/shares/turnovers.json';
    const headers: Record<string, string> = {};
    if (MOEX_JWT) headers['Authorization'] = `Bearer ${MOEX_JWT}`;

    const resp = await fetch(url, { headers, next: { revalidate: 0 } });
    if (!resp.ok) throw new Error(`MOEX turnovers: ${resp.status}`);

    const json = await resp.json();
    const turnovers = json.turnovers || json.data || [];

    // Парсим — MOEX возвращает массив массивов
    const columns = turnovers.columns || [];
    const data = turnovers.data || [];

    const tickerIdx = columns.indexOf('SECID');
    const boardIdx = columns.indexOf('BOARDID');
    const valueIdx = columns.indexOf('VALTODAY');
    const volIdx = columns.indexOf('VOLTODAY');
    const priceIdx = columns.indexOf('MARKETPRICE');
    const nameIdx = columns.indexOf('SHORTNAME');

    const instruments: Instrument[] = data
      .filter((row: any[]) => {
        // Только Т+ рынок (TQBR)
        const board = row[boardIdx];
        return board === 'TQBR';
      })
      .sort((a: any[], b: any[]) => (b[valueIdx] || 0) - (a[valueIdx] || 0)) // по обороту ↓
      .slice(0, 100)  // TOP 100
      .map((row: any[]) => {
        const ticker = row[tickerIdx] || '';
        return {
          ticker,
          figi: FIGI_MAP[ticker] || '',  // FIGI из статического маппинга
          lot: 1,    // MOEX turnovers не даёт лотность
          name: row[nameIdx] || row[tickerIdx] || '',
          board: row[boardIdx] || 'TQBR',
          dailyValue: Number(row[valueIdx]) || 0,
          dailyVolume: Number(row[volIdx]) || 0,
          price: Number(row[priceIdx]) || 0,
          changePct: 0,  // Нужно отдельный запрос
        };
      });

    return NextResponse.json({
      instruments,
      count: instruments.length,
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('instruments error:', error.message);
    return NextResponse.json(
      { error: error.message, instruments: [] },
      { status: 500 }
    );
  }
}
