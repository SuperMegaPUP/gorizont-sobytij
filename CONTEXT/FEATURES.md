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
| F-1A | DECOHERENCE v4.2 | ⏳ | 0% | `decoherence.ts` | Miller-Madow, H_max floor, clip, alphabet guard, low_activity guard, time_span guard |
| F-1B | HAWKING v4.2 | ⏳ | 0% | `hawking.ts` | 100ms resampling, adaptive algo zone, double guard, bandwidth |
| F-1C | DARKMATTER v4.2 | ⏳ | 0% | `darkmatter.ts` | 80% cutoff entropy, 5-session median, depth guard, Miller-Madow, MIN_ICEBERG max(), exp weight, 5% tolerance |
| F-1D | Синтетические тесты | ⏳ | 0% | `horizon-synthetic.test.ts` | iceberg + accumulator + predator |

### ЭТАП 2: П2 — СТРУКТУРНЫЕ ДЕТЕКТОРЫ

| ID | Фича | Статус | Прогресс | Файлы | Примечание |
|---|---|---|---|---|---|
| F-2A | PREDATOR v4.2 | ⏳ | 0% | `predator.ts` | 5-фазные триггеры, delta_flip FLOW+z-score, ATR-reversion, window_confirm, timeouts |
| F-2B | ATTRACTOR v4.2 | ⏳ | 0% | `attractor.ts` | detrended prices, Silverman robust, EMA(spread,10), POC distance guard, regime trigger |
| F-2C | ENTANGLE v4.2 | ⏳ | 0% | `entangle.ts` | Bonferroni, intra-ticker only, bid/ask flows, ADF-only |
| F-2D | WAVEFUNCTION v4.2 | ⚠️ | 50% | `wavefunction.ts` | Student-t obs model, observation vector z, Σ rolling, jitter, stale guard |
| F-2E | GRAVITON v4.2 | ⏳ | 0% | `graviton.ts` | COM+walls+sigmoid, ATR-separation, min 3 levels, empty side guard, median_depth |
| F-2F | CIPHER v4.2 | ⏳ | 0% | `cipher.ts` | Гистерезис, fixed seed, baseline kurtosis MAD |
| F-2G | ACCRETOR v4.2 | ⏳ | 0% | `accretor.ts` | Feature normalization DBSCAN |

### ЭТАП 3: ИНТЕГРАЦИЯ И FEEDBACK LOOP

| ID | Фича | Статус | Прогресс | Файлы | Примечание |
|---|---|---|---|---|---|
| F-3A | Dynamic TTL | ⚠️ | 30% | `signal-generator.ts` | TTL_MAP, sessionRemaining |
| F-3B | Confidence v4.2 | ⏳ | 0% | `convergence-score.ts` | 5 компонентов, divergence continuous |
| F-3C | BSCI-direction correlation | ⏳ | 0% | `cron/bsci-correlation.ts` | Новый cron |
| F-3D | Isolated activation | ⏳ | 0% | `signal-feedback.ts` | Мягкая weekly коррекция ±5% |
| F-3E | MFE/MAE интеграция | ⚠️ | 20% | `signal-feedback.ts` | Структура есть, интеграция нет |
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
├─ Этап 1 (П1.5):    0% ████░░░░░░ 4 фичи
├─ Этап 2 (П2):      0% █░░░░░░░░░ 7 фич
├─ Этап 3 (Интеграция): 0% █░░░░░░░░░ 8 фич
└─ Этап 4 (Калибровка): 0% ░░░░░░░░░░ 4 фичи

Всего: 23 фичи, 0✅ 2⚠️ 21⏳ 5🚫
```

