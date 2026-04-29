// Контекст фаз MOEX (МСК). Возвращает качество сессии для metadata/алертов.
// ВАЖНО: НЕ используется как множитель BSCI.
// MOEX: аукцион открытия 6:50-6:59, основная 7:00-18:50, клиринг 14:00-14:05 и 19:00-19:05, аукцион закрытия 18:50-18:59, вечерняя 19:00-23:50
export function getSessionQuality(): number {
  const now = new Date();
  const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  const h = msk.getHours(), m = msk.getMinutes();
  const time = h * 60 + m;

  // Аукцион открытия: 6:50-6:59 (410-419)
  if (time >= 410 && time < 420) return 0.3;
  // Основная сессия: 7:00-14:00 (420-840)
  if (time >= 420 && time < 840) return 1.0;
  // Клиринг дневной: 14:00-14:05 (840-845)
  if (time >= 840 && time < 845) return 0.2;
  // Основная сессия: 14:05-18:50 (845-1130)
  if (time >= 845 && time < 1130) return 1.0;
  // Аукцион закрытия: 18:50-18:59 (1130-1139)
  if (time >= 1130 && time < 1140) return 0.3;
  // Клиринг вечерний: 19:00-19:05 (1140-1145)
  if (time >= 1140 && time < 1145) return 0.2;
  // Вечерняя сессия: 19:05-23:50 (1145-1430)
  if (time >= 1145 && time < 1430) return 1.0;
  return 0.15; // Ночь
}
