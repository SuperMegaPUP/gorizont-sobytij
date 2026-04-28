// Горизонт Событий — глобальные константы
// Единый источник правды для всех порогов

// BSCI пороги
export const BSCI_ALERT_THRESHOLD = 0.20; // Временный baseline до ROC-калибровки. Финальный порог будет 0.25-0.35
export const BSCI_AWAIT_THRESHOLD = 0.35; // Порог для AWAIT статуса
export const BSCI_MAX_ALERT = 0.70;       // RED alert level
export const BSCI_MIN_ALERT = 0.30;       // YELLOW alert level

// Контекстные фильтры
export const MIN_TRADES_FOR_SESSION_QUALITY = 50;  // Минимум трейдов за 5 мин для достоверного BSCI
export const SPREAD_PENALTY_THRESHOLD = 0.003;     // 0.3% — широкий спред
export const SPREAD_PENALTY_MAX = 0.2;             // Минимальный множитель при очень широком спреде
export const STALE_INTERVALS = 2;                  // Штраф если данные старше 2 интервалов

// Диагностика
export const DEBUG_TICKERS = ['SBER', 'LKOH', 'GAZP', 'MX', 'RNFT'];

// DARKMATTER параметры
export const DARKMATTER_MIN_DELTA_H = 0.03;       // 3% вместо 15% — мягкий порог
export const DARKMATTER_MIN_CUTOFF_DEPTH = 5;    // порог для soft weight

// DECOHERENCE параметры
export const DECOHERENCE_MIN_ACTIVE_SYMBOLS = 5; // порог для soft qualityWeight

// HAWKING параметры
export const HAWKING_MIN_TRADES = 50;           // порог для soft tradeWeight
export const HAWKING_ABSOLUTE_MIN_TRADES = 10; // абсолютный минимум данных
export const HAWKING_FWHM_DENOMINATOR = 15;    // fallback для fwhmNorm до сбора статистики