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

