import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MOEX_JWT = process.env.MOEX_JWT;

// Статический маппинг FIGI для Tinkoff API (обновляется редко)
const FIGI_MAP: Record<string, string> = {
  SBER: 'BBG004730N88', SBERP: 'BBG0047315Y7',
  GAZP: 'BBG004716R88', LKOH: 'BBG004720LK0',
  GMKN: 'BBG004YKBDH2', NVTK: 'BBG00475KKY6',
  ROSN: 'BBG004716RP6', YNDX: 'BBG006L8G4H1',
  VTBR: 'BBG004730ZJ6', PLZL: 'BBG004S681W1',
  MOEX: 'BBG004730JJ88', MGNT: 'BBG004S68BV8',
  TATN: 'BBG004S686K9', ALRS: 'BBG004S68B31',
  CHMF: 'BBG00475TCK0', NLMK: 'BBG004S687B1',
  POLY: 'BBG004HQ0KW1', SNGS: 'BBG004S685V1',
  SNGSP: 'BBG004S685W9', RUAL: 'BBG008F2T0P2',
  OZON: 'BBG00R3QT8W4', FIVE: 'BBG00J6P4C29',
  AFKS: 'BBG004S686N5', PIKK: 'BBG00475KBD8',
  RTKM: 'BBG004S683B1', MTLR: 'BBG004S686M7',
  IRAO: 'BBG004S68641', FEES: 'BBG004S689Z8',
  TRNFP: 'BBG004S68CT8', Magnit: 'BBG00J6P4C29',
  PHOR: 'BBG00B3XVQD1', TCSG: 'BBG00QPXN5G1',
  FIXP: 'BBG00T9K0FV1', VKCO: 'BBG00Y0R6P91',
  HEAD: 'BBG00VHK0S36', SELG: 'BBG00RPR0MZ0',
  SPBE: 'BBG00R2PLQ89', SGZH: 'BBG00SBWQW92',
  LENT: 'BBG00V0VM8L7', RNFT: 'BBG00VSK0QF9',
};

interface Instrument {
  ticker: string;
  figi: string;
  lot: number;
  name: string;
  shortName: string;
  board: string;
  dailyValue: number;
  dailyVolume: number;
  price: number;
  prevPrice: number;
  changePct: number;
  marketCap: number;
}

export async function GET() {
  try {
    const headers: Record<string, string> = {};
    if (MOEX_JWT) headers['Authorization'] = `Bearer ${MOEX_JWT}`;

    // MOEX ISS: обороты на рынке акций Т+
    const url = 'https://iss.moex.com/iss/statistics/engines/stock/markets/shares/turnovers.json?iss.meta=off&iss.only=turnovers&turnovers.columns=SECID,BOARDID,SHORTNAME,VALTODAY,VOLTODAY,MARKETPRICE,PREVPRICE,ISSUECAPITALIZATION';

    const resp = await fetch(url, { headers, next: { revalidate: 0 } });
    if (!resp.ok) throw new Error(`MOEX turnovers: ${resp.status}`);

    const json = await resp.json();
    const turnovers = json.turnovers || {};
    const columns: string[] = turnovers.columns || [];
    const data: any[][] = turnovers.data || [];

    const idx = (name: string) => columns.indexOf(name);
    const tickerI = idx('SECID');
    const boardI = idx('BOARDID');
    const shortNameI = idx('SHORTNAME');
    const valueI = idx('VALTODAY');
    const volI = idx('VOLTODAY');
    const priceI = idx('MARKETPRICE');
    const prevI = idx('PREVPRICE');
    const capI = idx('ISSUECAPITALIZATION');

    const instruments: Instrument[] = data
      .filter((row) => row[boardI] === 'TQBR')           // Только Т+ рынок
      .filter((row) => (Number(row[valueI]) || 0) > 0)    // Есть оборот
      .sort((a, b) => (Number(b[valueI]) || 0) - (Number(a[valueI]) || 0)) // По обороту ↓
      .slice(0, 100)                                       // TOP 100
      .map((row) => {
        const ticker = String(row[tickerI] || '');
        const price = Number(row[priceI]) || 0;
        const prevPrice = Number(row[prevI]) || 0;
        const changePct = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;

        return {
          ticker,
          figi: FIGI_MAP[ticker] || '',
          lot: 1,
          name: String(row[shortNameI] || ticker),
          shortName: String(row[shortNameI] || ticker),
          board: 'TQBR',
          dailyValue: Number(row[valueI]) || 0,
          dailyVolume: Number(row[volI]) || 0,
          price,
          prevPrice,
          changePct: Math.round(changePct * 100) / 100,
          marketCap: Number(row[capI]) || 0,
        };
      });

    return NextResponse.json({
      instruments,
      count: instruments.length,
      timestamp: new Date().toISOString(),
      source: 'moex-iss',
    });

  } catch (error: any) {
    console.error('[instruments] error:', error.message);
    return NextResponse.json(
      { error: error.message, instruments: [], count: 0 },
      { status: 500 }
    );
  }
}
