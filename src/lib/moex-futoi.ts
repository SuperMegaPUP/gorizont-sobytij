import type { FutoiGroup } from './types';

// ─── MOEX FUTOI Library ─────────────────────────────────────────────────────
// Открытый интерес по фьючерсам — 9 фьючерсов с автоматическим fallback
//
// КРИТИЧЕСКИЕ ДЕТАЛИ:
// 1. JWT trimming — Vercel добавляет \n в env vars, нужно .trim()
// 2. APIM FUTOI — pos_short ОТРИЦАТЕЛЬНОЕ число, clgroup = "YUR"/"FIZ"
// 3. Openpositions — open_position_short ПОЛОЖИТЕЛЬНОЕ, is_fiz = 0/1
// 4. ISS Authorized — тот же openpositions но с JWT авторизацией
//
// Fallback chain: APIM → ISS Authorized → Openpositions → ISS Historical

const MOEX_ISS = 'https://iss.moex.com';
const MOEX_APIM = 'https://apim.moex.com/iss';

// Маппинг тикеров для openpositions (бесплатный источник)
const ASSET_CODE_MAP: Record<string, string> = {
  MX: 'MIX',
  Si: 'Si',
  RI: 'RTS',
  BR: 'BR',
  GZ: 'GAZP',   // Газпром
  GK: 'GMKN',   // Норникель
  SR: 'SBER',   // Сбербанк
  LK: 'LKOH',   // Лукойл
  RN: 'ROSN',   // Роснефть
};

// Тикеры для APIM FUTOI (совпадают с отображаемыми)
const FUTOI_TICKER_MAP: Record<string, string> = {
  MX: 'MX',
  Si: 'Si',
  RI: 'RI',
  BR: 'BR',
  GZ: 'GZ',   // Газпром
  GK: 'GK',   // Норникель
  SR: 'SR',   // Сбербанк
  LK: 'LK',   // Лукойл
  RN: 'RN',   // Роснефть
};

export interface FutoiResult {
  ticker: string;
  assetCode: string;
  timestamp: string;
  tradetime: string;
  yur: FutoiGroup;
  fiz: FutoiGroup;
  smi: number;
  smiDirection: string;
}

export const EMPTY_GROUP: FutoiGroup = {
  pos: 0, pos_long: 0, pos_short: 0,
  pos_long_num: 0, pos_short_num: 0,
  oi_change_long: 0, oi_change_short: 0,
};

// ─── JWT Token (with trimming!) ──────────────────────────────────────────
function getJWT(): string {
  const raw = process.env.MOEX_JWT || '';
  // Vercel может добавлять \n в конец env var — ОБЯЗАТЕЛЬНО trim!
  return raw.trim();
}

// ─── Smart Money Index Calculation v2 ───────────────────────────────────
// Формула v2:
//   SMI = (0.30 × position + 0.30 × momentum + 0.20 × concentration + 0.20 × divergence) × 100
//
// position:     направление и сила net-позиции юрлиц (как в v1)
// momentum:     ИЗМЕНЕНИЕ OI — наращивают или закрывают? Ключевой сигнал!
// concentration: сколько юрлиц на доминирующей стороне
// divergence:   расхождение юр vs физ (учитывает и слабую дивергенцию)
//
// momentum — главный новый компонент:
//   Если юрлица нарастили лонги (oi_change_long > 0) → бычий импульс
//   Если юрлица закрывают лонги (oi_change_long < 0) → медвежий сигнал
//   Это опережающий индикатор — OI меняется ДО цены
export function calculateSMI(yur: FutoiGroup, fiz: FutoiGroup): { smi: number; direction: string } {
  const totalOI = Math.abs(yur.pos_long) + Math.abs(yur.pos_short) + Math.abs(fiz.pos_long) + Math.abs(fiz.pos_short);
  if (totalOI === 0) return { smi: 0, direction: 'neutral' };

  // 1. Position: направление и сила net-позиции юрлиц (из v1)
  const yurDirection = yur.pos >= 0 ? 1 : -1;
  const yurStrength = Math.min(Math.abs(yur.pos) / (totalOI / 2), 1);
  const position = yurDirection * yurStrength;

  // 2. Momentum: изменение OI — главный новый компонент
  //    oi_change_long > 0 → наращивают лонги (бычий)
  //    oi_change_short > 0 → наращивают шорты (медвежий)
  //    Нормализуем к общему OI чтобы не зависеть от абсолютных значений
  let momentum = 0;
  const oiChangeLong = yur.oi_change_long || 0;
  const oiChangeShort = yur.oi_change_short || 0;
  const totalChange = Math.abs(oiChangeLong) + Math.abs(oiChangeShort);
  if (totalChange > 0) {
    // Знак: наращивание лонгов = +1, наращивание шортов = -1
    const netChange = oiChangeLong - oiChangeShort;
    // Сила: нормализуем к размеру позиции юрлиц (не к общему OI)
    const yurTotalPos = Math.abs(yur.pos_long) + Math.abs(yur.pos_short);
    const changeStrength = yurTotalPos > 0 ? Math.min(Math.abs(netChange) / yurTotalPos, 1) : 0;
    momentum = (netChange >= 0 ? 1 : -1) * changeStrength;
  }

  // 3. Concentration: концентрация юрлиц на доминирующей стороне (из v1)
  const yurTotal = yur.pos_long_num + yur.pos_short_num;
  let concentration = 0;
  if (yurTotal > 0) {
    const ratio = yur.pos >= 0 ? yur.pos_long_num / yurTotal : yur.pos_short_num / yurTotal;
    concentration = ratio * 2 - 1;
  }

  // 4. Divergence v2: расхождение юр vs физ (учитываем и слабую дивергенцию)
  //    В v1 учитывалась только полная дивергенция (разные стороны)
  //    В v2: расхождение = разница направлений, даже если обе в одну сторону
  let divergence = 0;
  const yurSign = yur.pos >= 0 ? 1 : -1;
  const fizSign = fiz.pos >= 0 ? 1 : -1;
  const yurMag = Math.abs(yur.pos) / (totalOI / 2);
  const fizMag = Math.abs(fiz.pos) / (totalOI / 2);
  // Полная дивергенция (разные стороны) — самый сильный сигнал
  if (yurSign !== fizSign) {
    divergence = yurSign * Math.min(yurMag + fizMag, 1);
  } else {
    // Слабая дивергенция: обе в одну сторону, но юрлица сильнее
    // Если юрлица в лонг И физики в лонг, но юрлица сильнее — это подтверждение
    // Если физики сильнее — это предупреждение (толпа впереди)
    const diff = yurMag - fizMag;
    divergence = yurSign * Math.min(Math.abs(diff), 1) * 0.5; // ослабленная
  }

  const smi = (0.30 * position + 0.30 * momentum + 0.20 * concentration + 0.20 * divergence) * 100;
  const clampedSMI = Math.max(-100, Math.min(100, Math.round(smi * 10) / 10));

  let smiDirection = 'neutral';
  if (clampedSMI > 30) smiDirection = 'bullish';
  else if (clampedSMI > 10) smiDirection = 'slightly_bullish';
  else if (clampedSMI < -30) smiDirection = 'bearish';
  else if (clampedSMI < -10) smiDirection = 'slightly_bearish';

  return { smi: clampedSMI, direction: smiDirection };
}

export function hasRealData(result: FutoiResult): boolean {
  return result.yur.pos_long > 0 || result.yur.pos_short > 0 ||
         result.fiz.pos_long > 0 || result.fiz.pos_short > 0;
}

// ─── Источник 1: MOEX APIM FUTOI (платный, с авторизацией) ─────────────
// Реальные данные каждые 5 минут!
// Колонки: sess_id, seqnum, tradedate, tradetime, ticker, clgroup,
//          pos, pos_long, pos_short, pos_long_num, pos_short_num, systime, trade_session_date
// clgroup = "YUR" | "FIZ"
// pos_short — ОТРИЦАТЕЛЬНОЕ число
// Берём ПЕРВУЮ строку каждого clgroup (самую свежую по seqnum)
export async function fetchFromApim(ticker: string): Promise<{ result: FutoiResult | null; debug?: any }> {
  const jwt = getJWT();
  if (!jwt) return { result: null, debug: { error: 'no_jwt' } };

  const futoiTicker = FUTOI_TICKER_MAP[ticker] || ticker;
  const url = `${MOEX_APIM}/analyticalproducts/futoi/securities/${futoiTicker}.json?iss.meta=off`;

  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'User-Agent': 'robot-detector-terminal/1.0',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      console.warn(`[FUTOI] APIM returned ${res.status} for ${futoiTicker}`);
      return { result: null, debug: { status: res.status, url } };
    }

    const data = await res.json();
    const columns: string[] = data?.futoi?.columns || [];
    const rows: any[][] = data?.futoi?.data || [];

    if (rows.length === 0) {
      console.warn(`[FUTOI] APIM: no rows for ${futoiTicker}`);
      return { result: null, debug: { rows: 0 } };
    }

    // Собираем ВСЕ строки по clgroup (нужны минимум 2 для OI change)
    const yurRows: any[][] = [];
    const fizRows: any[][] = [];

    for (const row of rows) {
      const obj: any = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      if (obj.ERROR_MESSAGE) continue;

      const clgroup: string = String(obj.clgroup || '').toUpperCase();
      if (clgroup === 'YUR') yurRows.push(row);
      else if (clgroup === 'FIZ') fizRows.push(row);
    }

    // Парсим первую (самую свежую) строку каждого clgroup
    let yur: FutoiGroup = { ...EMPTY_GROUP };
    let fiz: FutoiGroup = { ...EMPTY_GROUP };
    let timestamp = '';
    let tradetime = '';

    const parseRow = (row: any[]): { pos: number; pos_long: number; pos_short: number; pos_long_num: number; pos_short_num: number } => {
      const obj: any = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      const posLong = Math.abs(Number(obj.pos_long) || 0);
      const posShort = Math.abs(Number(obj.pos_short) || 0);
      const pos = Number(obj.pos) || (posLong - posShort);
      if (!timestamp && obj.tradedate) timestamp = String(obj.tradedate);
      if (!tradetime && obj.tradetime) tradetime = String(obj.tradetime);
      return { pos, pos_long: posLong, pos_short: posShort, pos_long_num: Number(obj.pos_long_num) || 0, pos_short_num: Number(obj.pos_short_num) || 0 };
    };

    if (yurRows.length > 0) {
      const parsed = parseRow(yurRows[0]);
      yur = { ...parsed, oi_change_long: 0, oi_change_short: 0 };
    }
    if (fizRows.length > 0) {
      const parsed = parseRow(fizRows[0]);
      fiz = { ...parsed, oi_change_long: 0, oi_change_short: 0 };
    }

    // OI change — разница между самой свежей (первая) и самой старой (последняя) записью
    if (yurRows.length >= 2) {
      const oldestObj: any = {};
      columns.forEach((col, i) => { oldestObj[col] = yurRows[yurRows.length - 1][i]; });
      yur.oi_change_long = yur.pos_long - Math.abs(Number(oldestObj.pos_long) || 0);
      yur.oi_change_short = yur.pos_short - Math.abs(Number(oldestObj.pos_short) || 0);
    }
    if (fizRows.length >= 2) {
      const oldestObj: any = {};
      columns.forEach((col, i) => { oldestObj[col] = fizRows[fizRows.length - 1][i]; });
      fiz.oi_change_long = fiz.pos_long - Math.abs(Number(oldestObj.pos_long) || 0);
      fiz.oi_change_short = fiz.pos_short - Math.abs(Number(oldestObj.pos_short) || 0);
    }

    const { smi, direction: smiDirection } = calculateSMI(yur, fiz);
    const result: FutoiResult = {
      ticker,
      assetCode: futoiTicker,
      timestamp,
      tradetime,
      yur,
      fiz,
      smi,
      smiDirection,
    };

    if (!hasRealData(result)) {
      console.warn(`[FUTOI] APIM: all zeros for ${futoiTicker}`);
      return { result: null, debug: { zeros: true } };
    }

    return { result };
  } catch (err) {
    console.warn(`[FUTOI] APIM fetch error for ${futoiTicker}:`, err);
    return { result: null, debug: { error: String(err) } };
  }
}

// ─── Источник 2: ISS Openpositions с JWT авторизацией ────────────────────
// Тот же endpoint что и бесплатный openpositions, но с авторизацией
// Может вернуть более свежие данные
export async function fetchFromIssAuthorized(ticker: string): Promise<FutoiResult | null> {
  const jwt = getJWT();
  if (!jwt) return null;

  const assetCode = ASSET_CODE_MAP[ticker] || ticker;

  try {
    const res = await fetch(
      `${MOEX_APIM}/iss/statistics/engines/futures/markets/forts/openpositions/${assetCode}.json?iss.meta=off`,
      {
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'User-Agent': 'robot-detector-terminal/1.0',
        },
        cache: 'no-store',
      }
    );

    if (!res.ok) return null;

    return parseOpenpositionsResponse(ticker, assetCode, await res.json());
  } catch {
    return null;
  }
}

// ─── Источник 3: ISS Openpositions (бесплатный, без авторизации) ─────────
// Данные за последний торговый день
export async function fetchFromOpenpositions(ticker: string): Promise<FutoiResult | null> {
  const assetCode = ASSET_CODE_MAP[ticker] || ticker;

  try {
    const res = await fetch(
      `${MOEX_ISS}/iss/statistics/engines/futures/markets/forts/openpositions/${assetCode}.json?iss.meta=off`,
      { cache: 'no-store' }
    );

    if (!res.ok) return null;

    return parseOpenpositionsResponse(ticker, assetCode, await res.json());
  } catch {
    return null;
  }
}

// ─── Парсинг openpositions ответа ────────────────────────────────────────
function parseOpenpositionsResponse(ticker: string, assetCode: string, data: any): FutoiResult | null {
  const columns: string[] = data?.open_positions?.columns || [];
  const rows: any[][] = data?.open_positions?.data || [];

  if (rows.length === 0) return null;

  let yur: FutoiGroup = { ...EMPTY_GROUP };
  let fiz: FutoiGroup = { ...EMPTY_GROUP };
  let timestamp = '';

  for (const row of rows) {
    const obj: any = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });

    const posLong = Number(obj.open_position_long) || 0;
    const posShort = Number(obj.open_position_short) || 0;

    const group: FutoiGroup = {
      pos: posLong - posShort,
      pos_long: posLong,
      pos_short: posShort,
      pos_long_num: Number(obj.persons_long) || 0,
      pos_short_num: Number(obj.persons_short) || 0,
      oi_change_long: Number(obj.oichange_long) || 0,
      oi_change_short: Number(obj.oichange_short) || 0,
    };

    if (obj.is_fiz === 0) yur = group;
    else if (obj.is_fiz === 1) fiz = group;

    if (!timestamp && obj.tradedate) timestamp = String(obj.tradedate);
  }

  const { smi, direction: smiDirection } = calculateSMI(yur, fiz);
  return { ticker, assetCode, timestamp, tradetime: '', yur, fiz, smi, smiDirection };
}

// ─── Основная функция: fetchFutoi с полным fallback chain ────────────────
export async function fetchFutoi(ticker: string): Promise<{ result: FutoiResult; source: string; realtime: boolean }> {
  // 1. APIM FUTOI (real-time, каждые 5 мин)
  const apim = await fetchFromApim(ticker);
  if (apim.result && hasRealData(apim.result)) {
    return { result: apim.result, source: 'apim_futoi', realtime: true };
  }

  // 2. ISS Authorized (с JWT, может быть свежее чем бесплатный)
  const issAuth = await fetchFromIssAuthorized(ticker);
  if (issAuth && hasRealData(issAuth)) {
    return { result: issAuth, source: 'iss_authorized', realtime: false };
  }

  // 3. ISS Openpositions (бесплатный, последний торговый день)
  const openpos = await fetchFromOpenpositions(ticker);
  if (openpos && hasRealData(openpos)) {
    return { result: openpos, source: 'openpositions', realtime: false };
  }

  // 4. Fallback — пустой результат
  const assetCode = ASSET_CODE_MAP[ticker] || ticker;
  return {
    result: {
      ticker,
      assetCode,
      timestamp: '',
      tradetime: '',
      yur: { ...EMPTY_GROUP },
      fiz: { ...EMPTY_GROUP },
      smi: 0,
      smiDirection: 'no_data',
    },
    source: 'none',
    realtime: false,
  };
}
