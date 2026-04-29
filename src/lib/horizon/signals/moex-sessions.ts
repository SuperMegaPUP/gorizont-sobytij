// ─── moex-sessions.ts — Динамический TTL по расписанию МОЕКС ─────────────────
// v4.1: Фиксированный 4ч TTL — западная логика (24ч рынки), не МОЕКС.
// Сессия МОЕКС: основная 10:00-18:45 (8ч45м), вечерняя 19:00-23:50.
//
// Правила:
//   Основная:  TTL = min(4ч, до закрытия сессии)
//   Вечерняя:  TTL = min(2ч, до закрытия вечерки)
//   Ночью:     TTL = 0 (сигналы не генерируются)

export type MOEXSession = 'MAIN' | 'EVENING' | 'OVERNIGHT' | 'PRE_MARKET' | 'CLEARING';

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

const MAIN_OPEN_HOUR = 7;   // 7:00 MSK
const MAIN_OPEN_MIN = 0;
const MAIN_CLOSE_HOUR = 18;
const MAIN_CLOSE_MIN = 50;  // 18:50 MSK

const EVENING_OPEN_HOUR = 19;
const EVENING_OPEN_MIN = 5;  // 19:05 MSK (после клиринга)
const EVENING_CLOSE_HOUR = 23;
const EVENING_CLOSE_MIN = 50;

const PRE_MARKET_OPEN_HOUR = 6;
const PRE_MARKET_OPEN_MIN = 50;  // 6:50 MSK

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

  // ДСВД: MOEX trades on weekends too!
  // Since March 2025: Дополнительная торговая сессия выходного дня
  // Stocks: 09:50-19:00 MSK, Futures: 09:50-18:50 MSK
  // So we NO LONGER check isWeekend — session is determined by time of day only.

  const preMarketOpen = PRE_MARKET_OPEN_HOUR * 60 + PRE_MARKET_OPEN_MIN;  // 410
  const mainOpen = MAIN_OPEN_HOUR * 60 + MAIN_OPEN_MIN;     // 420 (7:00)
  const mainClose = MAIN_CLOSE_HOUR * 60 + MAIN_CLOSE_MIN;  // 1130 (18:50)
  const eveningOpen = EVENING_OPEN_HOUR * 60 + EVENING_OPEN_MIN;     // 1145 (19:05)
  const eveningClose = EVENING_CLOSE_HOUR * 60 + EVENING_CLOSE_MIN;  // 1430 (23:50)

  // Аукцион открытия: 6:50-6:59
  if (mskMinutes >= preMarketOpen && mskMinutes < mainOpen) {
    const minutesUntilOpen = mainOpen - mskMinutes;
    return {
      session: 'PRE_MARKET',
      minutesUntilClose: 0,
      minutesUntilOpen,
      maxTTLMinutes: 0,
      description: `Аукцион открытия, до открытия ${minutesUntilOpen} мин`,
    };
  }

  // Основная сессия: 7:00 - 18:50 (с учётом клирингов)
  if (mskMinutes >= mainOpen && mskMinutes < mainClose) {
    // Клиринг дневной: 14:00-14:05
    if (mskMinutes >= 840 && mskMinutes < 845) {
      return {
        session: 'CLEARING',
        minutesUntilClose: 845 - mskMinutes,
        minutesUntilOpen: 0,
        maxTTLMinutes: 0,
        description: 'Дневной клиринг, до открытия 5 мин',
      };
    }
    const minutesUntilClose = mainClose - mskMinutes;
    return {
      session: 'MAIN',
      minutesUntilClose,
      minutesUntilOpen: 0,
      maxTTLMinutes: Math.min(MAIN_MAX_TTL, minutesUntilClose),
      description: `Основная сессия, до закрытия ${minutesUntilClose} мин`,
    };
  }

  // Аукцион закрытия: 18:50-18:59
  if (mskMinutes >= mainClose && mskMinutes < 1140) {
    const minutesUntilOpen = 1140 - mskMinutes;
    return {
      session: 'PRE_MARKET',
      minutesUntilClose: 0,
      minutesUntilOpen,
      maxTTLMinutes: 0,
      description: `Аукцион закрытия, до вечерней ${minutesUntilOpen} мин`,
    };
  }

  // Вечерняя сессия: 19:05 - 23:50
  if (mskMinutes >= eveningOpen && mskMinutes < eveningClose) {
    // Клиринг вечерний: 19:00-19:05
    if (mskMinutes >= 1140 && mskMinutes < 1145) {
      return {
        session: 'CLEARING',
        minutesUntilClose: 1145 - mskMinutes,
        minutesUntilOpen: 0,
        maxTTLMinutes: 0,
        description: 'Вечерний клиринг, до открытия 5 мин',
      };
    }
    const minutesUntilClose = eveningClose - mskMinutes;
    return {
      session: 'EVENING',
      minutesUntilClose,
      minutesUntilOpen: 0,
      maxTTLMinutes: Math.min(EVENING_MAX_TTL, minutesUntilClose),
      description: `Вечерняя сессия, до закрытия ${minutesUntilClose} мин`,
    };
  }

  // Ночь: после 23:50 до 6:50
  let minutesUntilOpen: number;
  if (mskMinutes >= eveningClose) {
    minutesUntilOpen = (24 * 60 - mskMinutes) + preMarketOpen;
  } else {
    minutesUntilOpen = preMarketOpen - mskMinutes;
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
