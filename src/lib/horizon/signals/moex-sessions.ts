// ─── moex-sessions.ts — Динамический TTL по расписанию МОЕКС ─────────────────
// v4.1: Фиксированный 4ч TTL — западная логика (24ч рынки), не МОЕКС.
// Сессия МОЕКС: основная 10:00-18:45 (8ч45м), вечерняя 19:00-23:50.
//
// Правила:
//   Основная:  TTL = min(4ч, до закрытия сессии)
//   Вечерняя:  TTL = min(2ч, до закрытия вечерки)
//   Ночью:     TTL = 0 (сигналы не генерируются)

export type MOEXSession = 'MAIN' | 'EVENING' | 'OVERNIGHT' | 'PRE_MARKET';

export interface SessionInfo {
  /** Текущая сессия */
  session: MOEXSession;
  /** Сколько минут до закрытия текущей сессии */
  minutesUntilClose: number;
  /** Сколько минут до открытия следующей сессии (для OVERNIGHT) */
  minutesUntilOpen: number;
  /** Максимум TTL в минутах для текущей сессии */
  maxTTLMinutes: number;
  /** Описание на русском */
  description: string;
}

// ─── Расписание МОЕКС (MSK = UTC+3) ──────────────────────────────────────────

const MAIN_OPEN_HOUR = 10;
const MAIN_OPEN_MIN = 0;
const MAIN_CLOSE_HOUR = 18;
const MAIN_CLOSE_MIN = 45;

const EVENING_OPEN_HOUR = 19;
const EVENING_OPEN_MIN = 0;
const EVENING_CLOSE_HOUR = 23;
const EVENING_CLOSE_MIN = 50;

// Максимальный TTL по сессиям (в минутах)
const MAIN_MAX_TTL = 240;     // 4 часа
const EVENING_MAX_TTL = 120;  // 2 часа

/**
 * Определяет текущую сессию МОЕКС и время до закрытия.
 * Работает в MSK (UTC+3).
 */
export function getSessionInfo(now: Date = new Date()): SessionInfo {
  // MSK = UTC+3
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const mskH = (utcH + 3) % 24;
  const mskM = utcM;
  const mskMinutes = mskH * 60 + mskM;

  // MOEX trades Monday-Friday only!
  // getUTCDay(): 0=Sunday, 1=Monday, ..., 6=Saturday
  // MSK day = same as UTC day for most hours (UTC+3 only shifts the hour)
  const utcDay = now.getUTCDay();
  // Adjust for MSK date boundary: if MSK hour wrapped past midnight, day advances
  const mskDayRaw = (utcH + 3) >= 24 ? (utcDay + 1) % 7 : utcDay;
  const isWeekend = mskDayRaw === 0 || mskDayRaw === 6; // Sunday or Saturday

  const mainOpen = MAIN_OPEN_HOUR * 60 + MAIN_OPEN_MIN;     // 600
  const mainClose = MAIN_CLOSE_HOUR * 60 + MAIN_CLOSE_MIN;  // 1125
  const eveningOpen = EVENING_OPEN_HOUR * 60 + EVENING_OPEN_MIN;     // 1140
  const eveningClose = EVENING_CLOSE_HOUR * 60 + EVENING_CLOSE_MIN;  // 1430

  // Основная сессия: 10:00 - 18:45 (Пн-Пт только!)
  if (!isWeekend && mskMinutes >= mainOpen && mskMinutes < mainClose) {
    const minutesUntilClose = mainClose - mskMinutes;
    return {
      session: 'MAIN',
      minutesUntilClose,
      minutesUntilOpen: 0,
      maxTTLMinutes: Math.min(MAIN_MAX_TTL, minutesUntilClose),
      description: `Основная сессия, до закрытия ${minutesUntilClose} мин`,
    };
  }

  // Вечерняя сессия: 19:00 - 23:50 (Пн-Пт только!)
  if (!isWeekend && mskMinutes >= eveningOpen && mskMinutes < eveningClose) {
    const minutesUntilClose = eveningClose - mskMinutes;
    return {
      session: 'EVENING',
      minutesUntilClose,
      minutesUntilOpen: 0,
      maxTTLMinutes: Math.min(EVENING_MAX_TTL, minutesUntilClose),
      description: `Вечерняя сессия, до закрытия ${minutesUntilClose} мин`,
    };
  }

  // Предрынок: 09:00 - 09:59 (Пн-Пт)
  if (!isWeekend && mskMinutes >= 540 && mskMinutes < mainOpen) {
    const minutesUntilOpen = mainOpen - mskMinutes;
    return {
      session: 'PRE_MARKET',
      minutesUntilClose: 0,
      minutesUntilOpen,
      maxTTLMinutes: 0, // Нет торговли — нет сигналов
      description: `Предрынок, до открытия ${minutesUntilOpen} мин`,
    };
  }

  // Перерыв: 18:45 - 19:00 (Пн-Пт)
  if (!isWeekend && mskMinutes >= mainClose && mskMinutes < eveningOpen) {
    const minutesUntilOpen = eveningOpen - mskMinutes;
    return {
      session: 'OVERNIGHT',
      minutesUntilClose: 0,
      minutesUntilOpen,
      maxTTLMinutes: 0,
      description: `Перерыв между сессиями, до вечерней ${minutesUntilOpen} мин`,
    };
  }

  // Ночь: 23:50 - 10:00 ИЛИ выходной (Сб, Вс)
  let minutesUntilOpen: number;
  if (isWeekend) {
    // Выходной: считаем до ближайшего Пн 10:00
    const daysUntilMonday = mskDayRaw === 6 ? 2 : 1; // Сб→2 дня, Вс→1 день
    minutesUntilOpen = daysUntilMonday * 24 * 60 - mskMinutes + mainOpen;
    return {
      session: 'OVERNIGHT',
      minutesUntilClose: 0,
      minutesUntilOpen,
      maxTTLMinutes: 0,
      description: `Выходной, до открытия ${minutesUntilOpen} мин`,
    };
  } else if (mskMinutes >= eveningClose) {
    // После закрытия вечерки до полуночи → завтра 10:00
    minutesUntilOpen = (24 * 60 - mskMinutes) + mainOpen;
  } else {
    // До 10:00 (ночь)
    minutesUntilOpen = mainOpen - mskMinutes;
  }

  return {
    session: 'OVERNIGHT',
    minutesUntilClose: 0,
    minutesUntilOpen,
    maxTTLMinutes: 0,
    description: `Ночь, до открытия ${minutesUntilOpen} мин`,
  };
}

/**
 * Вычисляет динамический TTL для сигнала в минутах.
 *
 * Примеры:
 *   Сигнал в 10:00 → TTL = 240 мин (4ч)
 *   Сигнал в 16:00 → TTL = 165 мин (до 18:45)
 *   Сигнал в 19:00 → TTL = 120 мин (2ч)
 *   Сигнал в 22:00 → TTL = 110 мин (до 23:50)
 *   Сигнал ночью  → TTL = 0 (нет сигналов)
 */
export function calculateTTL(now: Date = new Date()): number {
  const info = getSessionInfo(now);
  return info.maxTTLMinutes;
}

/**
 * Вычисляет expiresAt для сигнала на основе динамического TTL.
 */
export function calculateExpiresAt(createdAt: Date = new Date()): Date {
  const ttlMinutes = calculateTTL(createdAt);
  if (ttlMinutes === 0) {
    // Если ночью — ставим TTL до открытия + 4ч (сигнал отложится)
    // Но лучше просто не генерировать сигналы ночью
    return createdAt; // немедленный экспайр
  }
  return new Date(createdAt.getTime() + ttlMinutes * 60 * 1000);
}

/**
 * Проверяет, можно ли генерировать сигналы в данный момент.
 */
export function canGenerateSignals(now: Date = new Date()): boolean {
  const info = getSessionInfo(now);
  return info.session === 'MAIN' || info.session === 'EVENING';
}

/**
 * Форматирует оставшийся TTL в читаемый вид (М:СС или Ч:ММ:СС).
 */
export function formatTTLRemaining(expiresAt: Date, now: Date = new Date()): string {
  const remaining = expiresAt.getTime() - now.getTime();
  if (remaining <= 0) return 'Истёк';

  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
