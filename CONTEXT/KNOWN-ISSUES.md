# ИЗВЕСТНЫЕ ПРОБЛЕМЫ

## Критические

### React error #418: "Only plain objects can be passed to Client Components"
- **Статус**: НЕ ИСПРАВЛЕН
- **Проявление**: При передаче `text` prop в Client Component
- **Workaround**: Font store инициализируется с дефолтами, SettingsInitializer обновляет после гидратации
- **Файлы**: `src/lib/settings-store.ts`, `src/components/SettingsInitializer.tsx`

### Git Integration webhook сломан
- **Статус**: НЕ ИСПРАВЛЕН
- **Проявление**: Push в main/lab не триггерит автоматический деплой
- **Workaround**: Деплой через Vercel CLI с токеном
- **См.**: DEPLOY.md

## Средние

### ~~OFI = 0.0 у ВСЕХ тикеров~~ (ИСПРАВЛЕНО)
- **Статус**: ИСПРАВЛЕН
- **Причина**: MOEX ISS API возвращает `orderbook.bid`/`orderbook.ask` (ЕДИНСТВЕННОЕ число), а код использовал `orderbook.bids`/`orderbook.asks` (множественное) → `undefined` → `[]` → OFI=0
- **Дополнительно**: Добавлен Real-time OFI (Cont et al. 2014) через Redis-кеш предыдущего снапшота стакана
- **Файлы**: `collect-market-data.ts`, `moex-extended/route.ts`, `detectors/types.ts`, `scan/route.ts`

### ACCRETOR шум (до нормализации)
- **Статус**: ИСПРАВЛЕН кросс-секционной нормализацией
- **Было**: 0.8-0.99 у 90% тикеров → BSCI сжимался в 0.08-0.40
- **Стало**: Z-score нормализация растягивает BSCI до 0.05-0.75

### ATTRACTOR галлюцинации на мёртвых тикерах
- **Статус**: ЧАСТИЧНО (нормализация помогает, но корень не устранён)
- **Пример**: SGZH — нулевой оборот, ATTRACTOR 0.70
- **Решение**: Уровень 0 внутренней консистентности (Спринт 2)
- **См.**: CALIBRATION.md

### BSCI не дискриминировал (до нормализации)
- **Статус**: ИСПРАВЛЕН
- **Было**: 73/74 тикеров в зоне 0.08-0.40
- **Стало**: BSCI растянут до 0.05-0.75, есть ORANGE/RED

### ~~Робот-контекст "✗ Нет данных" при наличии данных~~ (ИСПРАВЛЕНО)
- **Статус**: ИСПРАВЛЕН
- **Причина**: ATTRACTOR (и 4 других детектора) отсутствовали в `DETECTOR_PATTERN_MAP` → `expectedPatterns = []` → `typeMatch = false` → `confirmation = 0.3` → порог `isRobotConfirmed()` = 0.5 не пройден → UI показывал "✗ Нет данных"
- **Пример**: SMLT — 54% роботов, cancel 91%, спуфинг, ATTRACTOR = топ-детектор → confirmation = 0.3 → "Нет данных"
- **Исправление**:
  1. Добавлены ATTRACTOR, WAVEFUNCTION, GRAVITON, DECOHERENCE, ENTANGLE в `DETECTOR_PATTERN_MAP`
  2. Добавлен `partialMatch` (косвенный мэтч через обратный маппинг) → повышает confirmation
  3. Порог `isRobotConfirmed()` снижен с 0.5 до 0.4
  4. UI: "✗ Нет данных" → "✗ Слабо" (более точная формулировка)
- **Файлы**: `robot-context.ts`, `TickerModal.tsx`, `ScannerFrame.tsx`

### ~~Спуфинг не влиял на конвергенцию~~ (ИСПРАВЛЕНО)
- **Статус**: ИСПРАВЛЕН
- **Проблема**: BSCI бычий + спуфинг → стена ФАЛЬШИВАЯ → сигнал должен быть медвежьим, но convergence не учитывал манипуляцию
- **Исправление**:
  1. `hasSpoofing` → −2 балла к convergence score
  2. `cancelRatio > 0.8` → −1 балл к convergence score
  3. Score ограничен снизу нулём (не может быть отрицательным)
- **Эффект**: SMLT: 4/10 → 1/10 (−2 спуфинг, −1 cancel>80%) → НЕ входить
- **Файлы**: `convergence-score.ts`, `scan/route.ts`, `ScannerFrame.tsx`

## Низкие

### TOP-100 сканирование медленное
- **Статус**: ПРИНЯТО КАК ОГРАНИЧЕНИЕ
- **Время**: ~2-3 минуты на 100 тикеров
- **Кэширование**: Redis TTL 30min
- **Batch size**: 20 параллельно, 300ms задержка между батчами

### Формула уверенности в сканере упрощённая
- **Статус**: ЗАПЛАНИРОВАН ПЕРЕСМОТР (Спринт 4)
- **Сейчас**: max confidence из detectorScores
- **Будет**: BSCI(25) + conv(25) + RSI/CRSI(20) + роботы(15) + дивергенция(15)
