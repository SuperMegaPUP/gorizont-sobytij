# 🎯 ТРЕКИНГ ФИЧ

> Фичи с ID, прогрессом, приоритетами
> Обновляется при изменении статуса

---

## ЛЕГЕНДА

| Статус | Обозначение |
|---|---|
| ✅ Готово | Реализовано, протестировано, задеплоено |
| 🔄 В работе | Активно разрабатывается |
| ⏳ Ожидает | Запланировано, не начато |
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
| F-1D | Синтетические тесты | ⏳ | 0% | `horizon-synthetic.test.ts` | iceberg + accumulator + predator |

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
| F-3C | BSCI-direction correlation | ⏳ | 0% | `cron/bsci-correlation.ts` | Новый cron |
| F-3D | Isolated activation | ⏳ | 0% | `signal-feedback.ts` | Мягкая weekly коррекция ±5% |
| F-3E | MFE/MAE интеграция | ✅ | **100%** | `signal-feedback.ts` | MFE_MAECalculator класс, MFE/MAE ratio |
| F-3F | Направление сигнала | ⏳ | 0% | `signal-generator.ts` | Взвешенное голосование |
| F-3G | Fallback при отсутствии данных | ⏳ | 0% | `guards.ts` | Guards для каждого детектора |
| F-3H | Миграция v4.1.5→v4.2 | ⏳ | 0% | — | BSCI не сбрасывать, confidence пересчитать |

### ЭТАП 4: КАЛИБРОВКА И PROD

| ID | Фича | Статус | Прогресс | Файлы | Примечание |
|---|---|---|---|---|---|
| F-4A | Замер распределений | ⏳ | 0% | — | mean BSCI < 0.45, дискриминация > 0.3 |
| F-4B | ROC + Youden's J | ⏳ | 0% | — | Оптимальные пороги |
| F-4C | Обновление порогов | ⏳ | 0% | `signal-generator.ts` | После калибровки |
| F-4D | Деплой + smoke | ⏳ | 0% | — | 0 ошибок, P&L работает, corr > 0.2 |

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
├─ Этап 1 (П1.5):    75% ████████░░ 4 фичи (3✅ 1⏳)
├─ Этап 2 (П2):     100% ██████████ 7 фич (7✅) + 5 багфиксов
├─ Этап 3 (Интеграция): 60% ████████░░ 8 фич (3✅ 5⏳)
│  ├─ F-3A Dynamic TTL: 90% ✅
│  ├─ F-3B Confidence: 100% ✅
│  └─ F-3E MFE/MAE: 100% ✅
├─ P0 HOTFIX (29.04): ✅ TOP100 unified + DECOHERENCE fix
└─ Этап 4 (Калибровка): 0% ░░░░░░░░░░ 4 фичи

Всего: 23 фичи, 13✅ 0⚠️ 5⏳ 5🚫
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
| PREDATOR | 25-32 | ✅ | Stateless rewrite, floor 0.012 |
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

---

## МЁРТВЫЕ ДЕТЕКТОРЫ (2026-04-28) — УСТАРЕЛО

| Детектор | Score | Статус | Диагноз |
|----------|-------|--------|---------|
| HAWKING | 48/100 | ✅ | Починен: добавлен fallback на recentTrades, исправлены periodicityCapped, fwhmNorm |
| PREDATOR | 0/100 | ❌ | State machine в IDLE — нужно отдельно чинить |
| ATTRACTOR | 36/100 | ✅ | Работает: fallback на recentTrades |
| DARKMATTER | 36/100 | ✅ | Работает: ранее починен |

