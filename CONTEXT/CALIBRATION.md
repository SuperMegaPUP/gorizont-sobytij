# КАЛИБРОВКА: Трёхуровневая система + Виртуальный P&L + KL-divergence

> Статус: Спецификация v4 (заморожена)
> Приоритет: Sprint 5 (после Signal Generator)

## Концепция

Детекторы — это модели, которые могут ошибаться. Калибровка — механизм
самоулучшения системы через сравнение предсказаний с реальностью.

Реальность = виртуальный P&L (не роботы, не деньги).

## Уровень 0: Внутренняя консистентность (детектор vs сам себя)

**Бесплатный** — не требует внешних данных.

```
if (topDetector.score ≥ 0.75) {
  const supportingData = check([
    cumDelta !== ≈0,        // есть реальное движение дельты
    vpin > threshold,       // есть информированная торговля
    volume > avgVolume,     // объём выше среднего
  ]);

  if (supportingData < 2/3) {
    // Детектор уверен, но данных мало → ГАЛЛЮЦИНАЦИЯ
    detectorWeight *= 0.5;  // понижаем вес в BSCI
    // или: confidence -= 20;
  }
}
```

**Ловит**: SGZH с нулевым оборотом и ATTRACTOR 0.70, мёртвые тикеры,
галлюцинации на пустых данных.

## Уровень 1: Детектор vs робот-данные (быстрая калибровка)

**Требует**: Robot Context (реализован в Sprint 3)

```
CIPHER 1.0 + Робот-объём 72% → ✅ CIPHER подтверждён
CIPHER 1.0 + Робот-объём 12% → ⚠️ CIPHER возможно ошибается
CIPHER 0.3 + Робот-объём 85% → 🐛 CIPHER не видит алгоритм → баг
```

**Действие**: Логируем расхождения. Через 100 случаев → корректируем пороги CIPHER.

## Уровень 2: Детектор vs результат сигнала (истинная калибровка)

**Требует**: Виртуальный P&L (Sprint 4)

```
Если CIPHER + роботы согласны, но сигнал в минус → оба ошиблись
Если CIPHER + роботы расходятся, а сигнал в плюс → CIPHER прав, роботы врут
Если CIPHER + роботы согласны, и сигнал в плюс → ✅ подтверждено
```

**Результат сигнала — окончательная истина.** Робот-данные — промежуточная.

## Виртуальный P&L как источник калибровки

Фоновый процесс проверяет ACTIVE сигналы каждые 5 мин:
- LONG: max(price) >= target → WIN; min(price) <= stop → LOSS; иначе → EXPIRED
- SHORT — зеркально

Результат → SignalFeedbackStore:
- signal_id, ticker, direction, entry_price, stop_loss, target
- wavefunction_state, top_detector, bsci, convergence
- closed_at, close_reason, close_price, pnl_ticks, result

### Обратная связь для WAVEFUNCTION

- LONG по ACCUMULATE → WIN → +0.01 к ACCUMULATE→LONG
- LONG по DISTRIBUTE → LOSS → -0.01 к DISTRIBUTE→LONG
- Только при win_rate < 40% на выборке 30+ сигналов

### Обратная связь для BSCI весов

- Раз в неделю: win_rate по каждому top_detector
- win_rate > 60% → увеличить вес
- win_rate < 40% → уменьшить вес

## Двухуровневая калибровка весов BSCI

```
После N сигналов с известным результатом:

  accuracy(detector) = correctSignals / totalSignals

  if (accuracy > 0.7) weight *= 1.1    // награда
  if (accuracy < 0.4) weight *= 0.8    // штраф
  if (accuracy 0.4-0.7) weight = const  // нейтрал

  Нормализация: Σ(weight_i) = 1, min(weight) = 0.04 (v4)
```

## Win Rate и метрики (Sprint 5)

После месяца данных можно ответить:

- "Из 40 сигналов 24 достигли Т1 = 60% win rate"
- "CIPHER-сигналы точнее ACCRETOR-сигналов на 15%"
- "ЛОНГ-сигналы точнее ШОРТ-сигналов"
- "Дивергенция-усиленные сигналы точнее обычных"
- "ACCUMULATE→LONG точнее DISTRIBUTE→LONG"

## ROC-анализ порогов + Youden's J (Sprint 5)

Для каждого порога (BSCI, convergence, top_detector):
- Строим ROC-кривую по истории сигналов
- Youden's J = Sensitivity + Specificity - 1
- Оптимальный порог = максимум J

## Адаптивные пороги (threshold drift)

```
Фиксированный BSCI ≥ 0.55 означает разное в разные рыночные режимы:
  Спокойный день: 0.55 = реальная аномалия
  Волатильный день (ФРС, геополитика): 0.55 = норма

Решение (Sprint 5):
  threshold = baseThreshold + volatilityAdjustment
  где volatilityAdjustment зависит от VIX/RVI и среднерыночного BSCI
```

## KL-divergence мониторинг концептуального дрейфа (П3)

Еженедельный расчёт KL-divergence между распределениями scores:

```
weekly_drift = klDivergence(
  scoreDistribution(prevWeek),
  scoreDistribution(thisWeek)
)

if (weekly_drift > 0.15) {
  alert("Концептуальный дрейф! Пересмотреть калибровку детекторов.")
  freezeWeightAdaptation = true;  // Заморозить адаптацию BSCI весов
}
```

При дрейфе > 0.15 — заморозить адаптацию до ручного аудита.

## Синтетические тест-сценарии (П3)

Генерировать искусственные сценарии с известным расположением «кита»:

```typescript
test_scenarios = [
  {
    name: "iceberg",
    description: "Скрытый крупный ордер, дробное исполнение",
    setup: { hidden_order: { level: 280, vol: 50000, visible: 100 } },
    expected: { DARKMATTER: 0.7, GRAVITON: 0.5 }
  },
  {
    name: "accumulator",
    description: "Крупный игрок медленно набирает позицию мелкими сделками",
    setup: { small_trades: { n: 500, vol: 5, price_range: "1tick", direction: "BUY" } },
    expected: { ACCRETOR: 0.8, DECOHERENCE: 0.6 }
  },
  {
    name: "predator",
    description: "Агрессивные продажи, пробой уровня, выкуп стопов",
    setup: { aggressive_sweeps: { n: 10, vol: 1000, direction: "SELL" } },
    expected: { PREDATOR: 0.9, HAWKING: 0.5 }
  },
  {
    name: "algorithm",
    description: "Периодические сделки с фиксированной частотой",
    setup: { repeating_pattern: { period_ms: 200, vol: 50, dir: +1 } },
    expected: { CIPHER: 0.7, HAWKING: 0.6, DECOHERENCE: 0.5 }
  },
  {
    name: "coordinated",
    description: "Одновременные покупки в нескольких бумагах одним фондом",
    setup: { simultaneous_orders: { n_assets: 3, vol_per_asset: 200, direction: "BUY" } },
    expected: { ENTANGLE: 0.7, PREDATOR: 0.4 }
  },
  {
    name: "regime_change",
    description: "Резкая смена волатильности — рынок переходит в новый режим",
    setup: { sudden_volatility_shift: { from: "calm", to: "volatile", multiplier: 5 } },
    expected: { ATTRACTOR: 0.8, DECOHERENCE: 0.7 }
  }
]
```

Для каждого сценария: если детектор не достигает expected → калибровка параметров.
