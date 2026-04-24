// ─── Helpers ─────────────────────────────────────────────────────────────────

export function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU');
}

export function fmtDelta(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${fmtNum(n)}` : fmtNum(n);
}

export function fmtImpact(n: number): string {
  return n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`;
}

// ─── Moscow Timezone helpers ─────────────────────────────────────────────────

/** Конвертировать Date в MSK (UTC+3) */
export function toMoscowTime(date: Date): Date {
  return new Date(date.getTime() + (3 * 60 + date.getTimezoneOffset()) * 60000);
}

export function getMoscowTime(): string {
  const msk = toMoscowTime(new Date());
  return msk.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** ISO-8601 строка в MSK (YYYY-MM-DDTHH:mm:ss+03:00) — для API и Redis */
export function getMoscowISOString(): string {
  const msk = toMoscowTime(new Date());
  return msk.toISOString().replace('Z', '+03:00');
}

/** Миллисекунды → ISO-8601 MSK строка */
export function msToMoscowISO(ms: number): string {
  const msk = toMoscowTime(new Date(ms));
  return msk.toISOString().replace('Z', '+03:00');
}

// Уникальный ID с защитой от cold-start коллизий
let eventIdCounter = Date.now(); // Начинаем с timestamp — уникально даже после cold start
export function nextId(): string {
  eventIdCounter += 1;
  return `evt-${eventIdCounter}`;
}

// ─── Market Hours Check ─────────────────────────────────────────────────────

// ─── Lot Splitting Helper ────────────────────────────────────────────────────
import type { RobotEvent } from './types';

/** Корректный расчёт buy/sell лотов с fallback.
 *  Гарантирует buyLots + sellLots = e.lots (устраняет расхождение при нечётных mixed)
 *  Единый хелпер — используется в addEvent, loadFromDb и везде где нужно splitLots
 */
export function splitLots(e: RobotEvent): [number, number] {
  if ((e.buyLots || 0) > 0 || (e.sellLots || 0) > 0) return [e.buyLots || 0, e.sellLots || 0];
  if (e.direction === 'buy') return [e.lots, 0];
  if (e.direction === 'sell') return [0, e.lots];
  // mixed: floor для sell, остаток для buy
  const s = Math.floor(e.lots * 0.5);
  return [e.lots - s, s];
}

export function isMarketOpen(): boolean {
  // MOEX: будни 06:50–23:49:59 МСК, выходные 09:50–18:59:59 МСК
  // Источник: https://www.moex.com/s1167
  const msk = toMoscowTime(new Date());
  const day = msk.getDay();
  const hours = msk.getHours();
  const minutes = msk.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  const isWeekend = day === 0 || day === 6;
  if (isWeekend) {
    // Выходные: 09:50 — 18:59:59 МСК
    return totalMinutes >= 590 && totalMinutes < 1140; // 09:50=590, 19:00=1140
  }
  // Будни: 06:50 — 23:49:59 МСК
  return totalMinutes >= 410 && totalMinutes < 1430; // 06:50=410, 23:50=1430
}

export function getMarketStatusText(): string {
  // MOEX: будни 06:50–23:49:59, выходные 09:50–18:59:59
  const msk = toMoscowTime(new Date());
  const day = msk.getDay();
  const totalMinutes = msk.getHours() * 60 + msk.getMinutes();
  const isWeekend = day === 0 || day === 6;
  // Определяем завтрашний день для корректного времени открытия
  const tomorrow = new Date(msk.getTime() + 24 * 60 * 60000);
  const tomorrowIsWeekend = tomorrow.getDay() === 0 || tomorrow.getDay() === 6;
  const tomorrowOpenStr = tomorrowIsWeekend ? '09:50' : '06:50';
  const tomorrowOpenMin = tomorrowIsWeekend ? 590 : 410;
  if (isWeekend) {
    if (totalMinutes < 590) return `Биржа откроется в 09:50 МСК (через ${590 - totalMinutes} мин)`;
    if (totalMinutes >= 1140) return `Биржа закрыта (с 19:00 МСК, откроется завтра в ${tomorrowOpenStr} МСК)`;
    return 'Биржа открыта (выходной день)';
  }
  if (totalMinutes < 410) return `Биржа откроется в 06:50 МСК (через ${410 - totalMinutes} мин)`;
  if (totalMinutes >= 1430) return `Биржа закрыта (с 23:50 МСК, откроется завтра в ${tomorrowOpenStr} МСК)`;
  return 'Биржа открыта';
}
