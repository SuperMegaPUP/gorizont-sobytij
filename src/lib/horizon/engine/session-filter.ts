// Контекст фаз MOEX (МСК). Возвращает качество сессии для metadata/алертов.
// ВАЖНО: НЕ используется как множитель BSCI.
// MOEX: аукцион 7:00-9:55, основная 10:00-18:50, клиринг 14:00-14:05 и 19:00-19:05
export function getSessionQuality(): number {
  const now = new Date();
  const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  const h = msk.getHours(), m = msk.getMinutes();
  const time = h * 60 + m;

  // Аукцион открытия: 7:00-9:55 (420-595)
  if (time >= 420 && time < 600) return 0.3;
  // Основная сессия: 10:00-18:50 (600-1130)
  if (time >= 600 && time <= 1130) {
    if (time >= 840 && time <= 845) return 0.2; // клиринг 14:00-14:05
    return 1.0;
  }
  // Вечерний клиринг: 19:00-19:05 (1140-1145)
  if (time >= 1140 && time <= 1145) return 0.2;
  // Аукцион закрытия: 18:50-19:00 и после 19:05 (1130-1140, 1145-1150)
  if ((time > 1130 && time < 1140) || (time > 1145 && time <= 1150)) return 0.3;
  return 0.15; // Ночь
}
