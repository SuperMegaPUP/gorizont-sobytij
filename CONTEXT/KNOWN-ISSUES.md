# ИЗВЕСТНЫЕ ПРОБЛЕМЫ

> Обновлён: 2026-04-26 (после Sprint 5: Trade-based OFI + П2-9)

## Критические

### OFI=0 при пустом orderbook — ЧАСТИЧНО ИСПРАВЛЕН (Trade-based OFI)
- **Статус**: ЧАСТИЧНО ИСПРАВЛЕН (Sprint 5C — Trade-based OFI реализован)
- **Проявление**: При отсутствии orderbook (ДСВД, выходные) — ISS возвращает HTML
- **Что сделано**: calcTradeOFI() + smart fallback логика — OFI теперь вычисляется из сделок когда стакан пуст
- **Что осталось**: GRAVITON (нужны walls из стакана) и DARKMATTER (нужна entropy стакана) не могут полностью работать без orderbook, но используют tradeOFI как вход
- **Результат**: 3 детектора больше не "мёртвые" при пустом стакане — OFI, частично GRAVITON, частично DARKMATTER
- **См.**: ARCHITECTURE.md — OFI Calculation pipeline

### Средний BSCI ~0.50 (завышен)
- **Статус**: ЧАСТИЧНО ИСПРАВЛЕН
- **Проявление**: BSCI теперь варьируется (0.33-0.68), но среднее всё ещё ~0.50
- **Причина**: Некоторые детекторы (PREDATOR, CIPHER, WAVEFUNCTION) могут давать moderate scores на малых данных
- **Решение**: П2 правки (GRAVITON, ACCRETOR, CIPHER, WAVEFUNCTION) улучшат дискриминацию
- **См.**: DETECTORS.md — П2 приоритеты

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

## Некритические (из спецификации v4)

### Radar CumDelta=0 не по центру
- **Статус**: ИСПРАВЛЕНО (клиент использует `absMaxCD = max(abs(cumDeltas))`, API нормализует cumDelta)
- **Проверка**: cumDelta=0 → normalizedCD=0.5 → по центру ✅

### Коэффициент нормализации
- **Статус**: НЕ ИСПРАВЛЕН
- **Проблема**: 0.25 в cross-section-normalize.ts даёт слабую дискриминацию
- **Решение**: увеличить до 0.4
- **Оценка**: 5 мин

### Фильтр мёртвых тикеров
- **Статус**: ЧАСТИЧНО ИСПРАВЛЕН
- **Сделано**: FIX 9 — BSCI<0.15 → конвергенция 0/10 (вместо 5/10)
- **Осталось**: YNDX, POLY и другие с BSCI≈0 без реальных данных всё ещё попадают в радар
- **Решение**: если все detector scores < 0.15 на протяжении 3+ сессий → `horizon:excluded:{ticker}` (persistent Redis flag)

## Исправленные

### ~~BSCI=0.00 у ВСЕХ тикеров на выходных~~ (ИСПРАВЛЕНО 2026-04-26, HOTFIX v4.1.5)
- **Статус**: ИСПРАВЛЕН
- **Причина 1**: `reversed=1` отсутствовал → MOEX ISS `/trades.json` возвращал FIRST 200 сделок (утренние, устаревшие) вместо LAST 200 (свежие)
- **Причина 2**: `isWeekend` в moex-sessions.ts → сессия не определялась корректно
- **Причина 3**: `canGenerateSignals()` в scan/top100 route → блокировка ВСЕГО сканирования, не только сигналов
- **Причина 4**: `staleData` шорткат → пустой orderbook считался = протухшие данные → все детекторы score=0
- **Исправление (11 фиксов)**:
  - FIX 0: `&reversed=1` добавлен в 6 мест с `/trades.json`
  - FIX 1: `isWeekend` удалён из moex-sessions.ts
  - FIX 2-3: `canGenerateSignals()` убран из scan/route.ts и top100/route.ts
  - FIX 4: `canGenerateSignals()` остался ТОЛЬКО в signal-generator.ts
  - FIX 5: [DATA-DEBUG] логирование в collect-market-data.ts
  - FIX 6: staleData логика — пустой orderbook ≠ stale если trades свежие (<30 мин)
  - FIX 7: progress cache cleanup при раннем возврате
  - FIX 8: HorizonStore — throttle + exponential backoff + circuit breaker
  - FIX 9: Конвергенция при BSCI<0.15 → 0/10 (не 5/10)
  - FIX 10: Радар BSCI ось — jitter горизонтальный + пост-обработка инверсий
- **Результат**: 77/100 тикеров с BSCI > 0 на выходных (было 0/100)

### ~~Конвергенция 5/10 при BSCI=0 и всех детекторах ○~~ (ИСПРАВЛЕНО 2026-04-26, FIX 9)
- **Статус**: ИСПРАВЛЕН
- **Причина**: bsciDirection='NEUTRAL' при BSCI≈0 → каждый ТА-индикатор получал +1 ("не противоречит") → 5/10 из ниоткуда
- **Исправление**: BSCI < 0.15 → конвергенция = 0/10 с пометкой "детекторы неактивны"

### ~~Радар: тикеры с более высоким BSCI ниже по оси Y~~ (ИСПРАВЛЕНО 2026-04-26, FIX 10)
- **Статус**: ИСПРАВЛЕН
- **Причина**: Anti-overlap jitter толкал точки в произвольном направлении (hash-based), не уважая ось BSCI
- **Исправление**: Jitter горизонтальный (вертикальный 15%), ±20px drift limit, пост-обработка инверсий BSCI

### ~~ERR_CONNECTION_RESET — HorizonStore флудит Vercel serverless~~ (ИСПРАВЛЕНО 2026-04-26, FIX 8)
- **Статус**: ИСПРАВЛЕН
- **Причина**: 6+ параллельных polling запросов → Vercel serverless connection limits
- **Исправление**: Sequential polling, exponential backoff, circuit breaker (3 ошибки → 2 мин пауза)

### ~~ТОП 100 не грузился — только 9 фьючерсов~~ (ИСПРАВЛЕНО 2026-04-26)
- **Статус**: ИСПРАВЛЕН
- **Причина 1**: Сканирование 100 тикеров таймаутилось на Vercel (5 мин лимит)
- **Причина 2**: Динамический fetch тикеров с MOEX не работал как fallback
- **Исправление**: Инкрементальное сканирование + per-ticker timeout + fastMode + TTL 7200

### ~~OFI всегда = 0.0 (первоначальный баг)~~ (ИСПРАВЛЕНО)
- **Статус**: ИСПРАВЛЕН
- **Причина**: MOEX ISS API возвращает `orderbook.bid`/`orderbook.ask` (ЕДИНСТВЕННОЕ число), а код использовал `orderbook.bids`/`orderbook.asks` (множественное) → undefined → [] → OFI=0
- **Дополнительно**: Добавлен Real-time OFI (Cont et al. 2014) через Redis-кеш предыдущего снапшота стакана
- **Остаток**: OFI=0 на выходных при отсутствии orderbook → см. Trade-based OFI в Sprint 5

### ~~BSCI идентичный 0.52 у всех тикеров~~ (ИСПРАВЛЕНО 2026-04-25)
- **Статус**: ИСПРАВЛЕН
- **Причина**: Новые P1 детекторы возвращали ~0.5 fallback значения когда нет trade data
- **Исправление**: DARKMATTER (trades<10 → score=0), DECOHERENCE (trades<20 → score=0), HAWKING (n_trades<50 → score=0)

### ~~Робот-контекст "✗ Нет данных" при наличии данных~~ (ИСПРАВЛЕНО)
- **Статус**: ИСПРАВЛЕН (Спринт 3)
- **Исправление**: Все 10 детекторов в DETECTOR_PATTERN_MAP + partialMatch + порог 0.4

### ~~Спуфинг не влиял на конвергенцию~~ (ИСПРАВЛЕНО)
- **Статус**: ИСПРАВЛЕН (Спринт 3)
- **Исправление**: hasSpoofing → −2, cancelRatio>80% → −1 к convergence score

## Архитектурные решения

### Детекторы всегда запускаются (даже в выходные/ночь)
- **Принцип**: `scanTicker()` ВСЕГДА запускает все 10 детекторов, даже если рынок закрыт
- `canGenerateSignals()` проверка НЕ должна быть в scanTicker — только в генерации сигналов
- `staleData` флаг информационный — НЕ шорткат для обхода детекторов
- В выходные/ночь: BSCI ≈ 0 (спокойно), все детекторы вернут низкие скоры → GREEN
- Это ПРАВИЛЬНО: нет данных = нет аномалии = GREEN (не 0.5 fallback!)

### `reversed=1` — КРИТИЧЕСКИЙ параметр MOEX ISS
- MOEX ISS `/trades.json` без `reversed=1` возвращает ПЕРВЫЕ 200 сделок (утренние, устаревшие)
- С `reversed=1` → ПОСЛЕДНИЕ 200 сделок (свежие, релевантные)
- Добавлен во ВСЕ 6 мест: scan, top100, moex, moex-extended, trades, collect-market-data
- **Никогда не убирать!**

### Пустой orderbook ≠ stale данные
- ISS возвращает HTML вместо orderbook на выходных — это API ограничение, не закрытый рынок
- Если trades свежие (<30 мин) — данные актуальны, даже если orderbook пуст
- staleData = true ТОЛЬКО если: trades>30 мин ИЛИ (нет trades И нет orderbook)

## Низкие

### TOP-100 сканирование медленное
- **Статус**: УЛУЧШЕНО (было: таймаут; стало: 2-4 мин с инкрементальным кэшированием)
- **Время**: ~2-4 минуты на 100 тикеров (зависит от MOEX API)
- **Кэширование**: Redis TTL 120 мин, инкрементальный прогресс 10 мин
- **Cron**: каждые 3 часа в торговые дни

### Детекторы требуют доработки по спецификации v5
- **DARKMATTER** (П1, ✅): expected_entropy + iceberg consecutive + MIN_ICEBERG_VOLUME
- **DECOHERENCE** (П1, ✅): символьный поток + tick_rule при ΔP=0
- **HAWKING** (П1, ✅): Welch PSD + noise_ratio fix + N≥50
- **BSCI** (П1, ✅): η=0.03, min_w=0.04
- **GRAVITON** (П2): экспоненциальная модель → центры масс + walls
- **ACCRETOR** (П2): угловые сектора → DBSCAN
- **CIPHER** (П2): нет z-score перед PCA (входные данные готовы ✅), нет condition number check
- **ATTRACTOR** (П2): галлюцинации на мёртвых тикерах → stickiness по spread + volume_profile
- **ENTANGLE** (П2): нет ADF-теста стационарности
- **PREDATOR** (П2): нет FALSE_BREAKOUT градиента, нет estimated_stops
- **WAVEFUNCTION** (П2): нет ресэмплинга, нет log-weights → PF вырождается
- **z-score pipeline** (П2-9, ✅): zScorePrices + zScoreVolumes + zScoreIntervals в DetectorInput
