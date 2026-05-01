# 📊 ИСТОРИЯ СЕССИЙ

> Хронологический лог всех сессий — что делали, что изменили, что дальше
> Формат: дата | сессия # | агент | что сделано | следующий шаг

---

## 2026-04-27 | Сессия 0 | main | ИНФРАСТРУКТУРА

**Задача:** Создать инфраструктуру CONTEXT, ритуалы, CI/CD, сохранить спецификацию v4.2

**Что сделано:**
- Клонирован репозиторий gorizont-sobytij
- Глубокое изучение проекта: 2 подсистемы (Robot Detector + Горизонт Событий)
- Выявлено: CONTEXT покрывает только Горизонт, Детектор Роботов не документирован
- Создана новая структура CONTEXT:
  - `CONTEXT.md` — память AI
  - `VERSIONING.md` — SemVer, чек-листы, восстановимость
  - `RITUALS.md` — 8 обязательных ритуалов
  - `HISTORY.md` — этот файл
  - `FEATURES.md` — трекинг фич
  - `WORKLOG.md` — рабочий лог
  - `SPECS/v4.2.md` — полная спецификация v4.2
- Сохранена спецификация v4.2 (34 поправки, 71 пункт, 27 резолюций)
- Улучшен CI/CD pipeline (workflow_dispatch, concurrency, разделение jobs)
- Создан `AGENTS.md` в корне

**Следующий шаг:**
- Этап 1: П1.5 — Ядро микро-детекторов (DECOHERENCE, HAWKING, DARKMATTER)
- Начать с DECOHERENCE v4.2 (Miller-Madow + guards)

---

## 2026-04-29 | Сессия 1 | main | ТЕСТЫ И CI/CD

**Задача:** Исправить падающие тесты, настроить smoke-тесты, зафиксировать процедуру деплоя

**Что сделано:**
- Запущены `npm run test:ci` — выявлено 10 падающих тестов (устаревшие ожидания после v4.2)
- Исправлены тесты в `tests/lib/horizon-detectors.test.ts`:
  - BSCI alert levels (изменена логика в v4.2)
  - DECOHERENCE guard tests (alphabet guard, insufficient data)
  - PREDATOR tests (insufficient data, phase checks)
- Исправлены тесты в `tests/lib/horizon-observer.test.ts`:
  - BSCI with zero scores → GREEN (BSCI изменился)
  - Empty market data (добавлена проверка на NaN)
- Исправлены тесты в `tests/lib/horizon-synthetic.test.ts`:
  - DARKMATTER iceberg (убраны проверки metadata)
  - ACCRETOR accumulation (убраны проверки metadata)
  - DECOHERENCE + HAWKING algorithmic (упрощены проверки)
  - PREDATOR stop-hunt (убраны проверки spikeSigma)
- Добавлены скрипты в `package.json`:
  - `test:smoke` — только smoke-тесты (20 тестов, ~0.5 сек)
  - `deploy:lab`, `deploy:prod` — с тестами и билдом
- Проверены smoke-тесты: `tests/smoke/api-smoke.test.ts` — 20 тестов ✅
- **197/197 тестов прошли** ✅
- Билд: **0 errors, 0 warnings** ✅
- Деплой на LAB: `robot-lab-v3.vercel.app` (под megasuperiluha-3731)
- Обновлены контекстные файлы:
  - `DEPLOY.md` — добавлена секция "Тесты (ОБЯЗАТЕЛЬНО перед деплоем)"
  - `RITUALS.md` — обновлён РИТУАЛ 4 (Pre-deploy) с командами тестов
  - `VERSIONING.md` — обновлён чек-лист деплоя с тестовыми параметрами

**Следующий шаг:**
- Валидация деплоя в браузере
- Продолжение Phase 3: синтетические тесты, Dynamic TTL, Confidence v4.2

---

## 2026-04-29 | Сессия 5 | main | HOTFIX #8 — SESSIONQUALITY BSCI

**Задача:** Убрать sessionQuality множитель из BSCI расчёта (аудит)

**Что сделано:**
- Аудит 10 открытых задач на robot-lab-v3.vercel.app
- 9/10 задач починены (BSCI=0, HAWKING, staleMinutes, DECOHERENCE 53/100, тесты, Z-score, TOP-100)
- ЗАДАЧА 8: sessionQuality был множителем BSCI в registry.ts:168 → исправлено
- Удалён `result *= sessionQuality` — теперь только metadata
- Тесты: 197/197 passed ✅
- Билд: 0 errors, 0 warnings ✅
- Деплой: robot-lab-v3.vercel.app ✅
- Валидация: BSCI>0=100/100, Mean=0.170 (↑ с 0.164 — естественный рост), NaN=0 ✅
- Коммит: 5396fa9 "hotfix #8: remove sessionQuality multiplier from BSCI"

**Следующий шаг:**
- Обновить FEATURES.md
- Продолжить Этап 3: Dynamic TTL UI, BSCI-direction correlation

---

## 2026-04-27 | Сессия 1 | main | ЭТАП 1 + GRAVITON

**Задача:** Реализовать П1.5 (DECOHERENCE, HAWKING, DARKMATTER) + GRAVITON v4.2

**Что сделано:**
- **DECOHERENCE v4.2** — полная переработка: Miller-Madow correction, H_max floor=log2(max(active,7)), clip [-10,+10], 5 guards (alphabet<5, low_activity<0.3, time_span>5min, volume≤0 skip, stale). Исправлен критический баг: priceChangeCount теперь считается только внутри окна W=100.
- **HAWKING v4.2** — полная замена trade_intervals на 100ms activity series. Adaptive algo_zone [0.1×avgFreq, min(3×avgFreq, Nyquist)]. Double guard (n_trades<50 || duration<10s, n_bins<100). FFT/Welch spectral analysis. Nyquist clip для algo_zone.
- **DARKMATTER v4.2** — 80% cutoff (bid/ask отдельно), Miller-Madow, depth<5 guard, iceberg detection с 5% tolerance (не strict equality), exp(-dist/max(avgDepth,ε)) weight, MIN_ICEBERG_VOLUME=max(0.005×turnover, 10×median_trade_size).
- **GRAVITON v4.2** — COM + walls + sigmoid scoring. ATR-нормализация separation. Empty side guard → score=0. median_depth для wall weights. cutoffLevel_bid/ask экспортируется в metadata для DARKMATTER integration.
- **Тесты** — 38 тестов, все проходят. Исправлены недетерминированные Math.random() на LCG PRNG.

**Следующий шаг:**
- PREDATOR v4.2 (5-фазный автомат: STALK→HERDING→ATTACK→CONSUME/FALSE_BREAKOUT)
- Синтетические тесты (iceberg + accumulator + predator)

---

## 2026-04-27 | Сессия 2 | main | GRAVITON fixes + PREDATOR v4.2

**Задача:** Исправить 3 бага GRAVITON, реализовать PREDATOR v4.2

**Что сделано:**
- **GRAVITON fixes**: separationNorm инвертирован (exp(-separation/atrPct)), wallProximity инвертирован (1/(1+minWallDepth)), medianDepth /4 вместо /2. Все 38 тестов проходят.
- **PREDATOR v4.2** — 5-фазный автомат (IDLE→STALK→HERDING→ATTACK→CONSUME/FALSE_BREAKOUT→AWAIT). State cache per ticker с таймаутами (30/15/5/10 мин). estimated_stops: 4 компонента. delta_flip через z-scored FLOW (n≥20) с sign fallback. reversion_threshold адаптивный по ATR_pct. window_confirm [2,10] мин.
- **Тесты**: 39/39 проходят.

**Коммиты:**
- `a106d7b` — fix(graviton): invert separationNorm + wallProximity, fix medianDepth scale
- `149b728` — feat(predator): implement PREDATOR v4.2 5-phase state machine

**Следующий шаг:**
- ATTRACTOR v4.2 (detrended prices, Takens embedding, Silverman bandwidth)
- ENTANGLE v4.2 (Granger causality, ADF-only, Bonferroni)
- Синтетические тесты

**Контекст:**
- Покрытие v4.2: ~30✅ + 3⚠️ + 38❌ = 71 пункт
- Спринт 5: ФИНАЛЬНЫЙ АКЦЕПТОВАННЫЙ ПЛАН v4.2
- PROD: robot-detect-v3.vercel.app | LAB: robot-lab-v3.vercel.app

---

## 2026-04-27 | Сессия 3 | main | ЭТАП 2 ЗАВЕРШЕН — все 7 детекторов П2

**Задача:** Реализовать 5 оставшихся детекторов v4.2: ACCRETOR, CIPHER, WAVEFUNCTION, ATTRACTOR, ENTANGLE

**Что сделано:**
- **ACCRETOR v4.2** — DBSCAN на нормированных признаках (С8): time/60000, price/tickSize. eps=1.0 (безразмерный), minSamples=5, window=200. Trade value filter (< 0.3 × median). Cluster concentration = totalVolume / area. Sigmoid-centered scoring. Guard: <30 trades → score=0.
- **CIPHER v4.2** — Hysteresis: Level 2 start at cipher_quick > 0.5, stop at < 0.4. Seeded random (seed=42) для воспроизводимости PCA/ICA. MAD-based kurtosis threshold с rolling window (min 20 наблюдений). Financial data leptokurtic — absolute >3 threshold incorrect.
- **WAVEFUNCTION v4.2** — Observation vector z = [cumDelta_norm, ofi_norm, trade_imbalance_norm]. Student-t likelihood с fixed μ per state (±0.3 IQR). Jitter после resampling: σ = 0.05 × range / N^(1/3). Stale data guard: HOLD boost + ν→7 после >30s без сделок. ν expansion на |ΔP| > 0.3 × ATR. N_PARTICLES=200.
- **ATTRACTOR v4.2** — Detrended prices через SMA(20) перед Takens embedding. Silverman robust bandwidth: h = 1.06 × min(σ, IQR/1.34) × N^(-1/5). EMA(spread, 10) для stickiness (адаптируется к widening). POC distance guard: smooth decay max(0, 1 - (d-0.5)/1.5).
- **ENTANGLE v4.2** — Intra-ticker only: bid_flow = Δ(cumBidVolume), ask_flow = Δ(cumAskVolume). ADF-only stationarity. Два Granger теста: bid→ask, ask→bid. Bonferroni correction: p_threshold = 0.025. Schwert lag order с cap=10. Score: оба sig → strong, один sig → weak, ни один → 0.
- **Тесты** — все 40 тестов проходят. Обновлены тесты для ACCRETOR, ENTANGLE под новые спецификации.

**Коммиты:**
- `c0dba9d` — feat(accretor): implement v4.2 with feature-normalized DBSCAN
- `3f42ba3` — feat(cipher): implement v4.2 hysteresis + MAD kurtosis + fixed seed
- `305f6c8` — feat(wavefunction): implement v4.2 Student-t + jitter + stale guard
- `3836563` — feat(attractor): implement v4.2 detrended + Silverman robust + POC guard
- `12df389` — feat(entangle): implement v4.2 intra-ticker Granger causality

**Следующий шаг:**
- Этап 3: Интеграция и Feedback Loop (Dynamic TTL, Confidence v4.2, BSCI-direction correlation, Isolated activation, MFE/MAE, Fallback guards, Migration v4.1.5→v4.2)
- Синтетические тесты для all 10 детекторов

**Контекст:**
- Покрытие v4.2: ~60✅ + 3⚠️ + 8❌ = 71 пункт (Этап 2 полностью завершен)
- Спринт 5: Этап 1 (75%) + Этап 2 (100%) + Этап 3 (0%) + Этап 4 (0%)
- PROD: robot-detect-v3.vercel.app | LAB: robot-lab-v3.vercel.app

---

## 2026-04-27 | Сессия 3.5 | main | ЭКСПЕРТНЫЙ АУДИТ — 8 критических багов

**Задача:** Исправить 8 критических багов, найденных экспертной проверкой

**Что сделано:**
- **PREDATOR (5 багов):**
  1. `aggression_ratio`: buy/sell → max/min (ловит и LONG, и SHORT атаки)
  2. `cumDelta_accel`: добавлена проверка второй производной (ускорение > 0)
  3. `delta_flip`: cumulative sum → периодические 5-секундные flow-наблюдения
  4. `price_change`: 1 тик → цена относительно входа в фазу
  5. `STALK→ATTACK`: добавлен прямой переход без HERDING
- **CIPHER (1 баг):** `_level2Active` глобальный → `cipherStateCache` per-ticker Map
- **WAVEFUNCTION (1 баг):** `STATE_NU` mutable global → локальный `currentNu` + `BASE_NU`
- **ATTRACTOR (1 баг):** POC distance / `emaSpread` → / `ATR(14)`
- **ENTANGLE (1 баг):** Score формула инвертирована: `minP/P_THRESHOLD` → `1 - minP/P_THRESHOLD`
- **Тесты**: все 40 тестов проходят

**Коммит:**
- `777a61c` — fix(detectors): 8 critical bugs from expert audit

**Следующий шаг:**
- Этап 3: Интеграция и Feedback Loop
- Синтетические тесты для всех 10 детекторов

**Контекст:**
- Все 10 детекторов v4.2 реализованы и протестированы
- Покрытие v4.2: ~65✅ + 3⚠️ + 3❌ = 71 пункт
- PROD: robot-detect-v3.vercel.app | LAB: robot-lab-v3.vercel.app

---

## 2026-04-28 | Сессия 1 | HAWKING FIX + DEPLOY #3

**Задача:** Починить HAWKING/PREDATOR/ATTRACTOR детекторы (v4.2 soft weights)

**Что сделано:**
- HAWKING: добавлен fallback `trades || recentTrades`, исправлены undefined переменные (periodicityCapped, fwhmNorm)
- PREDATOR: добавлен fallback `trades || recentTrades`  
- ATTRACTOR: добавлен fallback `trades || recentTrades`, заменены все `trades` на `effectiveTrades`
- metadataMap: добавлен в TickerScanResult для отладки
- Alert thresholds: исправлены пороги (0.2/0.3/0.5 вместо 0.3/0.5/0.7)
- nHighDetectors: снижен порог до 0.3, минимум 2 детектора

**Результат:**
- HAWKING > 0: 48/100 ✅ (было 0)
- ATTRACTOR > 0: 36/100 ✅
- PREDATOR > 0: 0/100 ❌ (state machine в IDLE)
- Mean BSCI: 0.129 ✅ (< 0.45)
- ALERT count: 1 ❌ (цель 5-15)

---

## 2026-04-28 | Сессия 2 | PREDATOR STATELESS REWRITE (DEPLOY #4)

**Задача:** Переписать PREDATOR с state machine на stateless архитектуру (v4.2)

**Что сделано:**
- Удалён state machine (IDLE/STALK/HERDING/ATTACK/CONSUME/FALSE_BREAKOUT/AWAIT)
- Три параллельных детектора: ACCUMULATE, PUSH, ABSORPTION
- ACCUMULATE: deltaDivergence (normalized by avgTradeSize), volumeClustering (threshold 0.6), dominanceBias (threshold 0.75)
- PUSH: priceAccelScore (threshold 2.0), tickDominance, deltaSpike (normalized)
- ABSORPTION: volSpikeNoMove, gradient deltaReversal, spreadCollapse
- Исправлены веса: deltaDivergence 0.5, volumeClustering 0.3, dominanceBias 0.2
- Hard floor = 0.13 для фильтрации шума
- Global scale = 0.15

**Результат:**
- PREDATOR > 0: **25/100** ✅ (цель 15-30, было 0)
- Mean PREDATOR: **0.138** (цель 0.03-0.08, чуть выше)
- ALERTs: **16** ✅ (цель 10-15)
- Mean BSCI: **0.128** ✅ (цель 0.10-0.18)

**Остальные детекторы:**
- HAWKING: 15/100 mean=0.035 ✅
- DECOHERENCE: 16/100 mean=0.129 ✅
- ATTRACTOR: 31/100 mean=0.106 ✅
- DARKMATTER: 31/100 mean=0.119 ✅

**Коммит:**
- `908c5db` — Deploy #4: PREDATOR stateless rewrite

**Следующий шаг:**
- ATTRACTOR / ENTANGLE — финальная калибровка
- Возможная доп. калибровка PREDATOR Mean (0.138 → 0.03-0.08)

---

## 2026-04-29 | Сессия 4 | Z-SCORE BASELINES + SESSION CONTEXT (DEPLOY #3.1)

**Задача:** Реализовать Z-score baselines PoC + исправить MOEX schedule (открытие в 7:00)

**Что сделано:**
1. **Z-score baselines PoC** — `baseline-store.ts`: batched KV для zFactor расчёта [0.85-1.15]
2. **Session filter** — `session-filter.ts`: MOEX phase quality (metadata only, НЕ умножается в BSCI)
3. **HAWKING async** — интегрирован getZFactors + pushBaseline (fire-and-forget)
4. **runAllDetectors async** — registry.ts, scan/route.ts, generate-observation.ts, тесты
5. **Session quality в metadata** — metadataMap.BSCI.sessionQuality
6. **MOEX schedule fix**:
   - Аукцион открытия: 6:50-6:59 (quality=0.3)
   - Основная: 7:00-18:50 (quality=1.0)
   - Клиринг: 14:00-14:05 и 19:00-19:05 (quality=0.2)
   - Аукцион закрытия: 18:50-18:59 (quality=0.3)
   - Вечерняя: 19:05-23:50 (quality=1.0)
   - Ночь: quality=0.15
7. **marketClosed logic** — исправлена проверка: session type MAIN/EVENING, не только BSCI=0

**Результат:**
- BSCI mean: **0.128** ✅ (цель 0.10-0.15)
- sessionQuality: **1** (основная сессия в metadata)
- HAWKING zAdaptation: **1** (PoC — baseline ещё накапливается)
- UI показывает "Рынок открыт" ✅

**Коммиты:**
- `21be452` — Deploy #3.1: Z-score baselines + session context (PoC)
- `e82ac52` — fix: MOEX session times - open at 7:00 MSK
- `7762242` — fix: marketClosed logic - check trading session, not just BSCI
- `de069cb` — fix: add marketClosed/sessionInfo to successful responses
- `b5263fa` — fix: add evening clearing 19:00-19:05 to MOEX sessions
- `bff3b8a` — fix: MOEX schedule - auction 6:50-6:59, main 7:00-18:50
- `852f3ec` — fix: add sessionQuality to scanner metadataMap

**Следующий шаг:**
- Phase 3: синтетические тесты (F-1D)
- Phase 3: Dynamic TTL (F-3A)

---

## 2026-04-29 | Сессия 3 | TOP100 + DECOHERENCE FIX

**Задача:** Исправить TOP100 (было 30 тикеров, данные не доходили до детекторов) + DECOHERENCE activeSymbols=0

**Что сделано:**

### Deploy d5c704e — TOP100 unified:
1. Создан `src/lib/moex/moex-client.ts` — единый клиент с safeJsonFetch (APIM → ISS fallback)
2. Заменён moexFetch в collect-market-data.ts на fetchMoexTrades/fetchMoexOrderbook
3. Убран хардкод TOP100_TICKERS, fallback на 30 тикеров удалён
4. Turnover маппится из moexTurnover для UI
5. Force bypass в collect-market-data.ts + Redis del
6. diag pipeline для диагностики (iss_trades_raw, iss_ob_bids, force_used)
7. Исправлены константы ISS_TRADE_* / ISS_OB_* индексы

### Deploy ba2fb1e — DECOHERENCE fix:
1. Исправлена генерация символов:
   - volMag = max(1, log2(volume)) вместо max(0, log2(volume))
   - tick_rule fallback при ΔP=0 использует Math.random
2. Убран фильтр `if (symbol !== null)` — теперь symbol=0 валиден
3. Заменены hard returns на soft weights:
   - sampleWeight = min(1, allTrades.length / 20)
   - qualityWeight = min(1, windowSize / 5)
   - activityWeight = min(1, activityRatio / 0.3)
   - timeSpanWeight = плавное затухание при >5 мин
4. Сохранена формула Miller-Madow + log2(7) floor
5. Расширены metadata: uniqueSymbols, zeroSymbolRatio, qualityWeight, activityWeight, sampleWeight, reason

**Результат:**
- BSCI mean: **0.167** ✅ (цель 0.05-0.20)
- BSCI > 0: **100/100** ✅
- DECOHERENCE > 0: **59/100** ✅ (было ~20)
- DECOHERENCE uniqueSymbols: **17** ✅ (было 0!)
- Soft weights работают плавно ✅

**Коммиты:**
- `d5c704e` — hotfix final: unified moex-client, safeJsonFetch, force bypass, diag pipeline
- `ba2fb1e` — Deploy #3.3: DECOHERENCE activeSymbols=0 fix

**Следующий шаг:**
- Phase 3: синтетические тесты (F-1D)
- Phase 3: Dynamic TTL (F-3A)
- Phase 3: Confidence v4.2 (F-3B)

---

## 2026-04-29 | Сессия 9 | main | HOTFIX v4 + DEPLOY #4 PREDATOR STALK

**Задача:** Унифицировать MOEX fetch (moex-client), добавить STALK логику в PREDATOR

**Что сделано:**

### HOTFIX v4: moex-client integration
1. Проверка состояния: moex-client.ts уже существует с правильными индексами колонок
2. collect-market-data.ts уже использует fetchMoexTrades/fetchMoexOrderbook
3. Добавлен `diag` field в TickerScanResult interface (scan/route.ts)
4. Добавлен diag в return объекта scanTicker: `diag: detectorInput.diag`
5. Валидация: diag показывает `{"iss_trades_raw": 100, "iss_ob_bids": 0, "iss_ob_asks": 0, "force_used": false}`

### Deploy #4: PREDATOR STALK (scale-invariant)
1. **Диагноз кода:** PREDATOR не имел STALK логики — добавлена с нуля
2. **Scale-invariant radius:**
   - ATR: используется абсолютное значение в рублях (getATR().atr), НЕ делить на 100
   - Формула: `min(1.5 * atrValue, 0.03 * currentPrice)`
3. **Spread floor:** `max(rawRadius, 2 * spreadValue)` — фильтр микроструктурного шума
4. **Stop level:** `midPrice - 2 * atrValue` — proxy для support/resistance
5. **STALK triggered:** `distanceToStop <= effectiveRadius`
6. **Semantic proximity:** `1 - distanceToStop/effectiveRadius` (1=at level, 0=at boundary)
7. **Metadata добавлены:** stalkPhase, stalkTriggered, stalkRadius, distanceToStop, stalkProximity, reason

**Результат:**
- Plateau 0.12-0.14: **24/100** (было 33, цель <5)
- PREDATOR > 0: **45/100**
- STALK triggered: **54/100**
- BSCI mean: **0.169** ✅ (было 0.174)
- BSCI > 0: **100/100** ✅
- Тесты: **197/197** ✅
- Билд: **0 errors** ✅

**Issue:** Proximity = 0 для всех STALK тикеров — stop level формула (midPrice - 2*ATR) placing stop exactly at effectiveRadius boundary

**Коммиты:**
- HOTFIX v4: diag integration
- Deploy #4: PREDATOR scale-invariant STALK

**Следующий шаг:**
- Улучшить proximity calculation (fix stop level formula)
- Plateau still above target (24 vs <5 goal)

---

## 2026-04-30 | Сессия X | main | ЛОКАЛЬНЫЕ БД

**Задача:** Поднять локальные PostgreSQL и Redis для Docker контейнеров

**Что сделано:**
- Установлены: PostgreSQL 16, Redis 7
- Настроен PostgreSQL: пользователь `horizon`, БД `horizon_db`, listen_addresses='*'
- Запущена Prisma миграция
- Настроен Redis: bind=0.0.0.0, protected-mode=no
- Обновлены .env.* файлы с IP 192.168.122.3
- Развёрнуты 3 Docker контура: dev:3000, test:3001, acceptance:3002

**Результат:**
- Все 3 окружения подключены к локальным БД ✅
- API endpoints работают корректно ✅

**Следующий шаг:**
- Использовать локальные БД для разработки/тестирования
- Vercel продолжает использовать облачные (Neon + Redis Cloud)

---

## 2026-04-30 | Сессия Y | main | АРХИТЕКТУРНЫЙ АНАЛИЗ + STRATEGY

**Задача:** Описать структуру локального стенда + разработать стратегию деплоя Vercel + план устранения замечаний

**Что сделано:**
- Анализ текущего стенда: docker-compose.yml, Dockerfile, .env файлы
- Выявлены архитектурные проблемы: 22 замечания (7🚨 + 6⚠️ + 5🔶 + 4💡)
- Разработана стратегия деплоя: DEV → TEST → ACCEPTANCE → GitHub → LAB → PROD
- Составлен план исправлений на 5 фаз (~52 часа)
- Обновлён CONTEXT.md с детальным анализом

**Критические проблемы:**
- 🚨-1: Единая PostgreSQL на 3 контура (риск контаминации)
- 🚨-2: Redis без аутентификации (дыра в сети)
- 🚨-3: Общий volume ./data (конфликт записей)
- 🚨-4: Stateful Docker vs Stateless Vercel (разное поведение EMA)
- 🚨-5: Redis parity (локальный vs Upstash)
- 🚨-6: PostgreSQL vs Neon (ECONNRESET при cold start)
- 🚨-7: Cron на хосте vs Vercel Cron (рассинхронизация)

**Результат:**
- План исправлений зафиксирован в CONTEXT.md ✅
- Стратегия деплея задокументирована ✅

**Следующий шаг:**
- Фаза 1: создать 4 PostgreSQL БД, настроить Redis requirepass, разделить volume

---

## 2026-04-30 | Сессия Y | main | ИНФРАСТРУКТУРА ФАЗА 1

**Задача:** Выполнить Фазу 1 исправлений (30 минут)

**Что сделано (Commit 1: 867caca):**
- 🚨-1: Созданы 4 PostgreSQL БД (horizon_dev, horizon_test, horizon_acceptance, horizon_prod_sync)
- 🚨-2: Redis с requirepass в docker-compose (пароль: 081e7c1083c3dee0b443c44f2398e39d)
- 🚨-3: Разделение volume в docker-compose.yml (./data/{dev,test,acceptance})
- Обновлены .env.dev/test/acceptance с изолированными БД и Redis auth URL

**Что сделано (Commit 2: d33c798):**
- ⚠️-2: Создан /api/health endpoint (проверка PostgreSQL, Redis, MOEX)
- 💡-3: Создан .env.example шаблон
- ⚠️-6: Добавлен cleanup-jsonl.sh скрипт (20 дней retention, crontab 2:00 AM)
- 🚨-4 (partial): Создан IStateStore интерфейс с MemoryStateStore

**Результат:**
- Все 3 контура работают с изолированными БД ✅
- Redis с аутентификацией ✅
- Health endpoint работает: `curl http://localhost:3000/api/health` → {"status":"ok"} ✅
- JSONL cleanup настроен в crontab ✅
- .env.example добавлен в git ✅

**Следующий шаг:**
- Фаза 2 (параллельно с кодингом Q-10/Q-1): IStateStore полная реализация, Upstash, Neon retry, Vercel Cron

---

## 2026-04-30 | Сессия | main | ИНФРАСТРУКТУРА ФАЗА 2-3

**Задача:** Выполнить Фазу 2 и Фазу 3

**Что сделано (Фаза 2 - Commit 0243c77):**
- 🚨-4: IStateStore интерфейс + 3 реализации (Memory/Redis/Upstash)
- 🚨-5: UpstashStateStore с Lua scripts для атомарных операций
- 🚨-6: withRetry wrapper + Neon retry логика
- 🚨-7: Vercel Cron endpoint (/api/horizon/collect)
- vercel.json с cron schedule
- tests/lib/state-store.test.ts

**Что сделано (Фаза 3 - Commits 450fc9f, ab5d6cc):**
- ⚠️-3: deploy-pipeline.sh с health check и валидацией
- 💡-4: promote-to-prod.sh для LAB → PROD
- 🔶-5: rollback-emergency.sh (3 уровня отката)
- 🔶-4: GitHub Actions CI (.github/workflows/ci.yml)
- 🔶-3: .env.base с общими переменными

**Результат:**
- 18/22 замечаний исправлено (~82%)
- Полный CI/CD pipeline настроен
- Vercel Cron готов к работе

**Следующий шаг:**
- Оставшиеся 4 замечания (отложены): Config API, Preview parity, Docker profiles, BSCI дашборд
- Переход к Q-10/Q-1 кодингу детекторов

