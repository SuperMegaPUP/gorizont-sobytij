# 🎯 ТРЕКИНГ ФИЧ

> Фичи с ID, прогрессом, приоритетами
> Обновляется при изменении статуса

---

## ЛЕГЕНДА

| Статус | Обозначение |
|---|---|
| ✅ Готово | Реализовано, протестировано, задеплоено |
| 🔄 В работе | Активно разрабатывается |
| ✅ Ожидает | Запланировано, не начато |
| 🚫 Отложено | Перенесено в П3 / следующий спринт |
| ⚠️ Частично | Часть реализована, часть нет |

---

## СПРИНТ 5: v4.2 (ТЕКУЩИЙ)

### ЭТАП 1: П1.5 — ЯДРО МИКРО-ДЕТЕКТОРОВ

| ID | Фича | Статус | Прогресс | Файлы | Примечание |
|---|---|---|---|---|---|
| F-1A | DECOHERENCE v4.2 | ✅ | 100% | `decoherence.ts` | Miller-Madow, H_max floor, clip [-10,+10], 5 guards |
| F-1B | HAWKING v4.2 | ✅ | 100% | `hawking.ts` | 100ms activity series, adaptive algo_zone, Nyquist clip, FFT/Welch |
| F-1C | DARKMATTER v4.2 | ✅ | 100% | `darkmatter.ts` | 80% cutoff, Miller-Madow, depth<5 guard, iceberg 5% tolerance, exp weight |
| F-1D | Синтетические тесты | ✅ | 100% | `horizon-synthetic.test.ts` | 4 теста: iceberg + accumulator + algorithmic + stop-hunt |

### ЭТАП 2: П2 — СТРУКТУРНЫЕ ДЕТЕКТОРЫ

| ID | Фича | Статус | Прогресс | Файлы | Примечание |
|---|---|---|---|---|---|
| F-2A | PREDATOR v4.2 | ✅ | 100% | `predator.ts` | 5-фазные триггеры, delta_flip FLOW+z-score, ATR-reversion, window_confirm, timeouts |
| F-2B | ATTRACTOR v4.2 | ✅ | 100% | `attractor.ts` | detrended prices, Silverman robust, EMA(spread,10), POC distance guard, regime trigger |
| F-2C | ENTANGLE v4.2 | ✅ | 100% | `entangle.ts` | Bonferroni, intra-ticker only, bid/ask flows, ADF-only |
| F-2D | WAVEFUNCTION v4.2 | ✅ | 100% | `wavefunction.ts` | Student-t obs model, observation vector z, Σ rolling, jitter, stale guard |
| F-2E | GRAVITON v4.2 | ✅ | 100% | `graviton.ts` | COM+walls+sigmoid, ATR-separation, empty side guard, median_depth, cutoffLevel export |
| F-2F | CIPHER v4.2 | ✅ | 100% | `cipher.ts` | Гистерезис, fixed seed, baseline kurtosis MAD |
| F-2G | ACCRETOR v4.2 | ✅ | 100% | `accretor.ts` | Feature normalization DBSCAN |

### ЭТАП 3: ИНТЕГРАЦИЯ И FEEDBACK LOOP

| ID | Фича | Статус | Прогресс | Файлы | Примечание |
|---|---|---|---|---|---|
| F-3A | Dynamic TTL | ✅ | **90%** | `signal-generator.ts` | calculateTTL, calculateExpiresAt, sessionRemaining |
| F-3B | Confidence v4.2 | ✅ | **100%** | `convergence-score.ts` | 5 компонентов, score 0-10, divergence/ATR бонусы |
| F-3C | BSCI-direction correlation | ✅ | 0% | `cron/bsci-correlation.ts` | Новый cron |
| F-3D | Isolated activation | ✅ | 0% | `signal-feedback.ts` | Мягкая weekly коррекция ±5% |
| F-3E | MFE/MAE интеграция | ✅ | **100%** | `signal-feedback.ts` | MFE_MAECalculator класс, MFE/MAE ratio |
| F-3F | Направление сигнала | ✅ | 0% | `signal-generator.ts` | Взвешенное голосование |
| F-3G | Fallback при отсутствии данных | ✅ | 0% | `guards.ts` | Guards для каждого детектора |
| F-3H | Миграция v4.1.5→v4.2 | ✅ | 0% | — | BSCI не сбрасывать, confidence пересчитать |

### ЭТАП 4: КАЛИБРОВКА И PROD

| ID | Фича | Статус | Прогресс | Файлы | Примечание |
|---|---|---|---|---|---|
| F-4A | Замер распределений | ✅ | 0% | — | mean BSCI < 0.45, дискриминация > 0.3 |
| F-4B | ROC + Youden's J | ✅ | 0% | — | Оптимальные пороги |
| F-4C | Обновление порогов | ✅ | 0% | `signal-generator.ts` | После калибровки |
| F-4D | Деплой + smoke | ✅ | 0% | — | 0 ошибок, P&L работает, corr > 0.2 |

---

## СПРИНТ 6+: П3 (ОТЛОЖЕНО)

| ID | Фича | Статус | Примечание |
|---|---|---|---|
| F-5A | WAVEFUNCTION learnable matrix | 🚫 | Минимум 500+ сигналов |
| F-5B | ENTANGLE Hilbert+AIC/BIC | 🚫 | Сложность |
| F-5C | PREDATOR volume POC | 🚫 | Зависит от signal-generator v2 |
| F-5D | KL-divergence мониторинг | 🚳 | Сложность |
| F-5E | ACCRETOR streaming DBSCAN | 🚫 | Сложность |

---

## СВОДКА ПРОГРЕССА

```
Спринт 5: v4.2
├─ Этап 1 (П1.5):    100% ██████████ 4 фичи (4✅)
├─ Этап 2 (П2):     100% ██████████ 7 фич (7✅) + 5 багфиксов
├─ Этап 3 (Интеграция): 60% ████████░░ 8 фич (3✅ 5✅)
│  ├─ F-3A Dynamic TTL: 90% ✅
│  ├─ F-3B Confidence: 100% ✅
│  └─ F-3E MFE/MAE: 100% ✅
├─ P0 HOTFIX:
│  ├─ #3.2 TOP100 unified ✅
│  ├─ #3.3 DECOHERENCE fix ✅
│  ├─ #7 Тесты CI/CD (197 passed) ✅
│  ├─ #8 sessionQuality BSCI (BSCI mean 0.170) ✅
│  ├─ v4 moex-client + diag ✅
│  └─ #4 PREDATOR STALK (plateau 33→24, BSCI 0.169) ✅
└─ Этап 4 (Калибровка): 0% ░░░░░░░░░░ 4 фичи

Всего: 23 фичи, 14✅ 0⚠️ 5✅ 4🚫
```

---

## ДЕТЕКТОРЫ v4.2 СТАТУС (2026-04-29)

| Детектор | > 0 /100 | Статус | Notes |
|----------|----------|--------|-------|
| GRAVITON | 78 | ✅ | Работает |
| DARKMATTER | 35 | ✅ | Работает |
| ACCRETOR | 46 | ✅ | Работает |
| DECOHERENCE | **59** | ✅ | **Исправлено!** soft weights, uniqueSymbols=17 |
| HAWKING | 16-24 | ✅ | zAdaptation PoC, floor 0.015 |
| PREDATOR | **45** | ✅ | STALK added, plateau 33→24 |
| CIPHER | 73 | ✅ | Работает |
| ENTANGLE | 14 | ✅ | Работает |
| WAVEFUNCTION | 78 | ✅ | Работает |
| ATTRACTOR | 30 | ✅ | Работает |

### Deploy #3.2 (2026-04-29):
- TOP100 unified: moex-client.ts, safeJsonFetch (APIM→ISS fallback)
- Убран хардкод TOP100_TICKERS
- Turnover маппится из moexTurnover
- Force bypass + diag pipeline
- BSCI mean: **0.167** ✅

### Deploy #3.3 (2026-04-29):
- DECOHERENCE fix: tick_rule fallback, symbol=0 валиден
- Soft weights: qualityWeight, activityWeight, sampleWeight, timeSpanWeight
- Miller-Madow формула сохранена
- uniqueSymbols: **17** ✅ (было 0!)

### Deploy #4 (2026-04-29):
- PREDATOR STALK: scale-invariant radius min(1.5*ATR_abs, 3% price)
- Spread floor: max(radius, 2*spread) для микроструктурного шума
- Stop level: midPrice - 2*ATR (proxy)
- Semantic proximity gradient
- Metadata: stalkPhase, stalkTriggered, stalkRadius, distanceToStop, stalkProximity
- **Результат**: plateau 33→24, BSCI 0.169 ✅
- **Issue**: proximity = 0 (stop level формула требует улучшения)

---

## ИНФРАСТРУКТУРА (2026-04-29)

| ID | Фича | Статус | Прогресс | Примечание |
|---|---|---|---|---|
| INF-1 | Smoke-тесты | ✅ | 100% | 20 тестов: MOEX_TOKEN, force-dynamic, файлы, revalidate |
| INF-2 | Тесты CI pipeline | ✅ | 100% | 197 тестов, все passed |
| INF-3 | Pre-deploy чек-лист | ✅ | 100% | DEPLOY.md, RITUALS.md, VERSIONING.md обновлены |
| INF-4 | Деплой скрипты | ✅ | 100% | test:smoke, deploy:lab, deploy:prod в package.json |

---

## СПРИНТ 7: v4.3-rev3 (Production-Ready)

> Базовая версия: v4.2 (frozen core)
> Принцип: Не менять ядро детекторов. BSCI — read-only. Вся логика через post-processing, effectiveSignal, StateManager и Shadow Mode.
> Статус: Готов к реализации. Строгая приоритизация по эмпирике (GAZP×4, X5, LKOH, IRAO, SBER, CBOM).

### 🏗 АРХИТЕКТУРНЫЙ КОНТРАКТ

| Правило | Реализация | Зачем |
|---------|------------|-------|
| BSCI не мутируется | Остаётся чистым взвешенным индексом детекторов v4.2 | Сохраняет историческую сравнимость, защищает от каскадных искажений |
| effectiveSignal | bsci × confidenceMultiplier × contextBonus | Единственный источник для alertLevel, рубрикатора и UI |
| StateManager | Redis/KV персистентность (horizon:state:{ticker}:{key}, TTL=1 сессия) | Решает stateless-природу Vercel |
| Shadow Mode | 2-3 сессии вычисления без влияния на алерты | Страховка от регрессии |
| Адаптивные пороги | σ-нормировка, перцентили, cross-section фильтрация | Уход от хардкода |

---

### 🟠 P0: ФУНДАМЕНТ И СТРАХОВКА

| ID | Задача | Кратко | Статус | Эмпирика |
|----|--------|--------|--------|----------|
| INFRA | StateManager + Redis persistence | Сохраняет EMA/окна между вызовами | ✅ | Vercel cold start уничтожает окна/EMA |
| Q-0 | Shadow Mode Framework | Валидация без влияния на алерты | ✅ | Провал Deploy #5 из-за отсутствия тени |
| Q-10 | EMA-сглаживание PREDATOR | Убирает стробирование 0↔0.88 | ✅ | GAZP: стробирование, 22 флипа |

---

### 🔴 P1: ЯДРО КОНТРОЛЯ ЦЕНЫ И ТРИГГЕРЫ

| ID | Задача | Кратко | Статус | Эмпирика |
|----|--------|--------|--------|----------|
| Q-1 | OFI/rtOFI detectPriceControl | Выявляет фальшивые продажи/покупки | ✅ | X5 Δ=1.314, LKOH Δ=0.68 |
| Q-8 | SQUEEZE_ALERT + EMA(Cancel%) DROP | Ловит разгрузку стакана перед импульсом | ✅ | GAZP: Cancel% 90%→0% = +2.4% |

| Q-11 | ROTATION_DETECTOR (scoring) | Определяет перекладку позиции крупняка | ✅ | X5: айсберги BUY + шлифовщик SELL |
---

### 🟡 P2: КЛАССИФИКАТОРЫ ТИШИНЫ И ШУМА

| ID | Задача | Кратко | Статус | Эмпирика |
|----|--------|--------|--------|----------|
| Q-9 | PRE_IMPULSE_SILENCE (TIER 1/2) | Предупреждает о манипуляторе перед импульсом | ✅ | GAZP: BSCI 0.07 + CIPHER=0.00 |
| Q-12 | Algorithmic Reset (robotVol) | Ловит сброс робота перед новым циклом | ✅ | GAZP: robotVol 77%→30% |
| CIPHER | Перцентильный CN-штраф | Отсекает структурный шум PCA | ✅ | X5/GAZP: CN=1M-30M |

---

### 🟢 P3: УВЕРЕННОСТЬ, НАПРАВЛЕНИЕ, РАСПРЕДЕЛЕНИЕ

| ID | Задача | Кратко | Статус | Эмпирика |
|----|--------|--------|--------|----------|
| CONF | Confidence Multiplier | Честная уверенность при HFT-войнах | ✅ | X5: Robot 80% + Cancel 99% |
| Q-4 | ICEBERG Direction | Эвристика направления айсбергов | ✅ | X5/IRAO: видит "×7", но не направление |
| Q-7 | DISTRIBUTION детектор | Защищает розницу от Pump&Dump | ✅ | IRAO: Pump & Dump |

---

### 🔵 P4: КАЛИБРОВКА И УТОЧНЕНИЯ

| ID | Задача | Кратко | Статус | Эмпирика |
|----|--------|--------|--------|----------|
| Q-2 | ACCRETOR калибровка | Эмпирическая шкала 0.2-1.0 | ✅ | LKOH: ACCRETOR=1.00 |
| Q-3 | PHASE_SHIFT v2 | Интеграция PREDATOR + Cancel% | ✅ | X5: PREDATOR 0.85 + Cancel 99% |
| Q-5 | SPOOF модуль | aggressive vs passive спуфинг | ✅ | X5: Cancel 99% + SELL 61% |
| Q-6 | ENTANGLE soft p-value | Уход от бинарности 0/0.30 | ✅ | Случайные корреляции |

---

### 🐛 BUG: A-3 — Volume Bug (Board Fallback)

| ID | Задача | Кратко | Статус | Эмпирика |
|----|--------|--------|--------|----------|
| A-3 | Volume Bug: board fallback | Исправление оборотов для TQPI/SMAL | ✅ | MSRS: 0.0M vs терминал 60M |

---

### 📊 ДОРОЖНАЯ КАРТА ДЕПЛОЕВ

| Этап | Компоненты | Критерий перехода |
|------|------------|-------------------|
| #5.5 | INFRA, Q-0, Q-10, Q-1, Q-8, Q-11 | Shadow Mode: 2-3 сессии, precision > 60%, FPR < 25% |
| #6 | Промоут валидированных P0/P1 | Rollback gates не сработали, BSCI стабильно |
| #7 | Q-9, Q-12, CIPHER fix | Ложные < 10/день, CIPHER_eff стабилен |
| #8 | CONF, Q-4, Q-7, A-3 | effectiveSignal честен, iceberg direction >60% accuracy |
| #9 | Q-2, Q-3, Q-5, Q-6 | Полная гранулярность, уход от бинарности |

---

## МЁРТВЫЕ ДЕТЕКТОРЫ (2026-04-28) — УСТАРЕЛО

| Детектор | Score | Статус | Диагноз |
|----------|-------|--------|---------|
| HAWKING | 48/100 | ✅ | Починен: добавлен fallback на recentTrades, исправлены periodicityCapped, fwhmNorm |
| PREDATOR | 0/100 | ❌ | State machine в IDLE — нужно отдельно чинить |
| ATTRACTOR | 36/100 | ✅ | Работает: fallback на recentTrades |
| DARKMATTER | 36/100 | ✅ | Работает: ранее починен |

