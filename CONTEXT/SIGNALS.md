# СИГНАЛЫ: Фрейм автоматических торговых рекомендаций

> Статус: СПРОЕКТИРОВАН (Спецификация v4)
> Приоритет: Спринт 4
> Файлы: `src/lib/horizon/signals/`, `src/components/horizon/frames/SignalsFrame.tsx`

## Порог генерации сигнала

Сигнал появляется ТОЛЬКО при одновременном выполнении ВСЕХ условий:

```
ПОРОГ ГЕНЕРАЦИИ:
├── BSCI ≥ 0.55 (ORANGE или выше)
├── Конвергенция ≥ 7/10 (детекторы + ТА + роботы − штрафы)
├── Явная дивергенция (детектор ≠ ТА)
└── Top-детектор ≥ 0.75

Если хоть одно не выполнено → НЕТ сигнала (тишина)
Редкость = ценность
```

### Влияние спуфинг-штрафов на порог

Спуфинг-штрафы (−2 за hasSpoofing, −1 за cancel>80%) могут снизить конвергенцию ниже порога 7/10. Это **правильное** поведение — спуфинг = манипуляция → сигнал ненадёжен.

## Типы сигналов

| Тип | Иконка | Условие | Горизонт |
|-----|--------|---------|----------|
| ЛОНГ | 🟢 | BSCI≥0.55 + direction=BULL + conv≥7 | Дни |
| ШОРТ | 🔴 | BSCI≥0.55 + direction=BEAR + conv≥7 | Дни |
| ОЖИДАНИЕ | ⏳ | BSCI≥0.45 + conv<7 | Ждать подтверждения |
| ПРОРЫВ | ⚡ | BSCI≥0.55 + HAWKING≥0.7 + ATR сжат | Часы |
| МАНИПУЛЯЦИЯ | 🚫 | conv≤2 + hasSpoofing | НЕ ВХОДИТЬ |

## Модель TradeSignal (v4)

```typescript
interface TradeSignal {
  signal_id: string;
  ticker: string;
  type: 'LONG' | 'SHORT' | 'AWAIT' | 'BREAKOUT';
  confidence: number;        // 0-100%
  convergence: number;       // 0-10

  // Уровни
  entry_price: number;             // цена на момент сигнала
  entryZone: [number, number];     // диапазон входа (±0.3 ATR)
  stopLoss: number;                // стоп (support/resistance ±0.5 ATR)
  targets: [number, number, number]; // Т1(+2ATR), Т2(+3.5ATR), Т3(S/R)
  riskRewardRatio: number;         // T1 / stop-distance (≥2:1 = качественный)

  // Обоснование
  trigger: string;           // "DECOHERENCE 1.00 — кит ворвался"
  confirmations: string[];   // ✅ подтверждающие факторы
  divergences: string[];     // ⚠️ противоречия (САМЫЕ ЦЕННЫЕ!)

  // Управление
  exitConditions: ExitCondition[];  // формализованные условия выхода

  // Метаданные
  direction: 'LONG' | 'SHORT';
  state: 'ACTIVE';           // Все новые сигналы = ACTIVE
  wavefunction_state: 'ACCUMULATE' | 'DISTRIBUTE' | 'HOLD';
  top_detector: string;
  bsciAtCreation: number;

  // Время
  createdAt: Date;
  expiresAt: Date;           // TTL = 4 часа

  // История (для feedback loop)
  snapshots: SignalSnapshot[];
  result?: 'TARGET' | 'STOP' | 'EXPIRED';
  close_price?: number;
  pnl_ticks?: number;
}
```

## Виртуальный P&L — обратная связь без роботов

У нас нет торгующих роботов. Обратная связь через виртуальный P&L:

### Механизм

Каждый ACTIVE сигнал содержит entry_price, stop_loss, target, TTL=4ч, direction.

Фоновый процесс каждые 5 минут проверяет все ACTIVE сигналы:
1. Запрашивает текущую цену тикера
2. Для LONG: если max(price за TTL) >= target → WIN; если min(price) <= stop → LOSS; иначе → EXPIRED
3. Для SHORT — зеркально
4. Закрывает сигнал, записывает result + pnl_ticks

### SignalFeedbackStore

```typescript
interface SignalResult {
  signal_id: string;
  ticker: string;
  direction: 'LONG' | 'SHORT' | 'BREAKOUT' | 'AWAIT';
  entry_price: number;
  stop_loss: number;
  target: number;
  generated_at: timestamp;
  wavefunction_state: 'ACCUMULATE' | 'DISTRIBUTE' | 'HOLD';
  top_detector: string;
  bsci: number;
  convergence: number;
  closed_at: timestamp;
  close_reason: 'TARGET' | 'STOP' | 'EXPIRED';
  close_price: number;
  pnl_ticks: number;
  result: 'WIN' | 'LOSS' | 'EXPIRED';
}
```

### Обратная связь для WAVEFUNCTION

- LONG по ACCUMULATE → WIN → усиливаем ACCUMULATE→LONG на +0.01
- LONG по DISTRIBUTE → LOSS → ослабляем DISTRIBUTE→LONG на -0.01
- Не корректируем по одному сигналу. Только при win_rate < 40% на выборке 30+ сигналов.

### Обратная связь для BSCI весов

- Раз в неделю: win_rate по каждому top_detector
- Детектор с win_rate > 60% → увеличить вес
- Детектор с win_rate < 40% → уменьшить вес

## Формула уверенности (ИСПРАВЛЕННАЯ, v4)

```
confidence = BSCI(25) + conv(25) + RSI/CRSI(20) + роботы(15) + дивергенция(15) = 100

Разброс: минимальный сигнал → ~45%, идеальный → ~95%

Детализация:
  BSCI: 0-25 баллов (линейно от 0.55 до 1.0)
  Конвергенция: 0-25 баллов (от 7 до 10)
  RSI/CRSI: 0-20 баллов (экстремумы = больше баллов)
  Роботы: 0-15 баллов (graceful degradation при отсутствии)
  Дивергенция: УСЛОВНАЯ:
    topDetector ≥ 0.85 → +15 (детектор уверен → дивергенция = сила)
    topDetector < 0.85 → −10 (детектор неуверен → дивергенция = риск)
```

## Жизненный цикл сигнала

```
ГЕНЕРАЦИЯ          АКТИВНЫЙ           ЗАКРЫТИЕ
                                   
BSCI ≥ 0.55  ──→  state=ACTIVE  ──→  Один из вариантов:
Conv ≥ 7          Проверка           ✅ TARGET — цена достигла Т1/Т2/Т3
TopDet ≥ 0.75     каждые 5 мин       🔴 STOP — цена пробила стоп
                  TTL = 4 часа       ⏰ EXPIRED — истёк срок
                  6 снапшотов/день   🚫 FALSE_BREAKOUT — новостной пробой
                                     
                                      → ПЕРЕХОДИТ В ИСТОРИЮ
                                        с result, close_price, pnl_ticks
```

## Формализованные условия выхода (v4)

| Условие | Порог | Тип |
|---------|-------|-----|
| CumDelta упал >50% от пика | cumDelta < peakCumDelta × 0.5 | CUMDELTA_REVERSAL |
| CumDelta сменил знак на 3 свечах | sign(cumDelta) ≠ sign(prevCumDelta) × 3 | CUMDELTA_REVERSAL |
| BSCI drop >0.15 | bsci < bsciAtCreation - 0.15 | BSCI_DROP |
| VPIN резко вырос | vpin > prevVpin × 1.5 | VPIN_SPIKE |
| Цена < стоп-лосс | price < stopLoss | PRICE_STOP |
| PREDATOR FALSE_BREAKOUT | price_reversion < 50% OR !delta_flip | FALSE_BREAKOUT |

## Расчёт уровней (level-calculator.ts)

### Entry/Stop/Targets через ATR(14)

```
Для ЛОНГ:
  entryZone = [currentPrice ± 0.3 × ATR]
  stopLoss = nearestSupport − 0.5 × ATR
  T1 = currentPrice + 2 × ATR
  T2 = currentPrice + 3.5 × ATR
  T3 = nearestResistance

Для ШОРТ:
  entryZone = [currentPrice ± 0.3 × ATR]
  stopLoss = nearestResistance + 0.5 × ATR
  T1 = currentPrice − 2 × ATR
  T2 = currentPrice − 3.5 × ATR
  T3 = nearestSupport
```

### Support/Resistance за 30 свечей

- Локальные экстремумы с объёмом > 1.5× средний
- Группировка в кластеры ±0.5 ATR
- Сортировка по объёму

### estimated_stops (из PREDATOR v4)

Для расчёта стоп-уровней через estimated_stops(level):

1) volume_cluster_density(level) = sum(volume within ±2 ticks) / (avg_volume_per_tick_range + ε)
2) round_number_bonus(level) = 1 если level кратен 5/10 пунктам, иначе 0
3) recent_breakout_frequency(level) = count(breakouts) / (N + ε)
4) vwap_distance_penalty(level) = 1 - min(|level - VWAP|, max_dist) / (max_dist + ε)

```
estimated_stops(level) = 
  0.35 × volume_cluster_density +
  0.25 × round_number_bonus +
  0.25 × recent_breakout_frequency +
  0.15 × vwap_distance_penalty
```

Коэффициенты начальные, калибруются в Sprint 5.

## НОВЫЕ ФАЙЛЫ (Спринт 4)

```
src/lib/horizon/signals/
├── signal-generator.ts      — логика генерации (формула confidence + пороги)
├── level-calculator.ts      — расчёт уровней + estimated_stops
├── signal-store.ts          — zustand store для UI
└── signal-feedback.ts       — SignalFeedbackStore + виртуальный P&L

src/app/api/horizon/signals/
├── route.ts                 — GET активные сигналы
└── [ticker]/route.ts        — GET история сигналов по тикеру

src/components/horizon/frames/
└── SignalsFrame.tsx         — UI фрейма
```

## Принципы дизайна сигналов

1. **НЕ СОВЕТНИК** — не добавлять sizing позиции (юридическая граница)
2. **riskRewardRatio** — метрика качества сигнала, не рекомендация
3. **R:R ≥ 2:1** — минимальный порог для качественного сигнала
4. **Тишина = норма** — большинство сканов не генерирует сигналы
5. **ОЖИДАНИЕ** — промежуточный статус (система "чует", но не готова)
6. **МАНИПУЛЯЦИЯ** — спуфинг обнаружен, конвергенция ≤ 2, вход опасен
7. **FALSE_BREAKOUT** — новостной пробой, не stop-hunt → AWAIT
8. **Виртуальный P&L** — обратная связь без роботов, без денег
9. **Спуфинг-фильтр** — штрафы конвергенции автоматически блокируют ненадёжные сигналы
10. **Feedback loop** — каждый сигнал получает result + pnl_ticks для калибровки
