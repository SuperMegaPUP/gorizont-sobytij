// Контекст фаз MOEX (МСК). Возвращает качество сессии для metadata/алертов.
// ВАЖНО: НЕ используется как множитель BSCI.
export function getSessionQuality(): number {
  const now = new Date();
  const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  const h = msk.getHours(), m = msk.getMinutes();
  const time = h * 60 + m;

  if (time >= 600 && time <= 1125) {
    if (time >= 840 && time <= 845) return 0.2; // клиринг
    return 1.0; // основная сессия
  }
  if ((time >= 590 && time < 600) || (time > 1125 && time <= 1130)) return 0.3; // аукционы
  return 0.15; // ДСВД/ночь (не 0.05, чтобы не убивать UI-читаемость)
}
