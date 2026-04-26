# СИГНАЛЫ: Фрейм автоматических торговых рекомендаций

> Статус: СПРОЕКТИРОВАН (Спецификация v4.1 — заморожена)
> Приоритет: Спринт 4 (Фаза 2 — ПОСЛЕ П1 правок)
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

⚠️ ПОСЛЕ П1 правок: пороги 0.55/7 могут быть скорректированы после замера новых BSCI/convergence распределений. Это НЕ меняет архитектуру — меняются только два числа.

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

## Модель TradeSignal (v4.1)

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
  state: 'ACTIVE';
  wavefunction_state: 'ACCUMULATE' | 'DISTRIBUTE' | 'HOLD';
  top_detector: string;
  bsciAtCreation: number;

  // Корреляция (v4.1)
  correlatedWith?: string[];        // ID связанных сигналов
  correlationType?: 'SAME_ISSUER' | 'SAME_SECTOR' | 'SAME_FUND';

  // Время (v4.1 — динамический TTL)
  createdAt: Date;
  expiresAt: Date;           // TTL = calculateTTL(createdAt) — зависит от сессии МОЕКС

  // История (для feedback loop)
  snapshots: SignalSnapshot[];
  result?: 'TARGET' | 'STOP' | 'EXPIRED' | 'DIRECTION_CHANGE';
  close_reason?: string;
  close_price?: number;
  pnl_ticks?: number;
}
```

## Динамический TTL (v4.1)

Фиксированный 4ч TTL — западная логика (24ч рынки), не МОЕКС. Сессия МОЕКС: основная 10:00-18:45 (8ч45м), вечерняя 19:00-23:50.

```typescript
function calculateTTL(now: Date): number {
  const session = getSessionInfo(now);

  if (session === 'MAIN') {
    // Основная сессия: TTL = до закрытия, но не более 4ч
    return Math.min(4 * 60, minutesUntilClose(now));
  }

  if (session === 'EVENING') {
    // Вечерняя: низкая ликвидность, TTL = 2ч макс
    return Math.min(2 * 60, minutesUntilClose(now));
  }

  if (session === 'OVERNIGHT') {
    // Ночью сигнал не генерируем
    return 0;
  }
}
```

Примеры:
- Сигнал в 10:00 → TTL = до 14:00 (4ч)
- Сигнал в 16:00 → TTL = до 18:45 (2ч45м)
- Сигнал в 19:00 → TTL = до 21:00 (2ч)
- Сигнал в 22:00 → TTL = до 23:50 (1ч50м)

## Дедупликация сигналов (v4.1)

Без дедупликации SMLT на 3 сканах подряд = 3 сигнала LONG = мусор.

Правила:
1. Тот же тикер + тот же direction + <TTL → **ОБНОВИТЬ** существующий сигнал
   - Пересчитать entry/stop/target (цена могла измениться)
   - Добавить snapshot в историю
   - НЕ создавать новый signal_id
2. Тот же тикер + сменился direction → **ЗАКРЫТЬ** старый (reason: DIRECTION_CHANGE)
   - Создать новый сигнал с новым signal_id
3. Тот же тикер + TTL истёк → **ЗАКРЫТЬ** (reason: EXPIRED)
   - Новый скан может создать новый сигнал

```typescript
existing = findActiveSignal(ticker, direction);
if (existing && !existing.closed) { updateSignal(existing, newData); return; }
```

## Корреляция сигналов (v4.1)

SBER LONG + SBERP LONG — по сути один сигнал. Не прятать, а показывать связь.

```typescript
interface Signal {
  correlatedWith?: string[];        // ID связанных сигналов
  correlationType?: 'SAME_ISSUER' | 'SAME_SECTOR' | 'SAME_FUND';
}
```

Правила корреляции:
- Тикеры одного эмитента (SBER/SBERP, LKOH/LKOHM и т.д.) → SAME_ISSUER
- Тикеры одного сектора с ENTANGLE > 0.5 → SAME_SECTOR
- Флаг через ENTANGLE детектор → SAME_FUND

В UI: бейдж "🔗 Связано с SBERP" — не блокировать, но предупредить.

## Формула уверенности (v4.1 — условное взвешивание BSCI)

```
bsci_weight = convergence >= 8 ? 20 : convergence < 5 ? 30 : 25;
confidence = BSCI(bsci_weight) + conv(25) + RSI/CRSI(20) + роботы(15) + дивергенция(15)

Разброс: минимальный сигнал → ~45%, идеальный → ~95%

Детализация:
  BSCI: 0-bsci_weight баллов (линейно от 0.55 до 1.0)
  Конвергенция: 0-25 баллов (от 7 до 10)
  RSI/CRSI: 0-20 баллов (экстремумы = больше баллов)
  Роботы: 0-15 баллов (graceful degradation при отсутствии)
  Дивергенция: УСЛОВНАЯ:
    topDetector ≥ 0.85 → +15 (детектор уверен → дивергенция = сила)
    topDetector < 0.85 → −10 (детектор неуверен → дивергенция = риск)
```

Почему условное взвешивание: BSCI и convergence коррелированы (высокий BSCI → больше TA-совпадений → выше convergence). Двойной счёт завышает confidence для ORANGE/RED тикеров. При высокой конвергенции BSCI менее важен (вес 20), при слабой — более важен (вес 30).

## FALSE_BREAKOUT градиент (v4.1 — вместо бинарного порога)

Было: price_reversion >= 0.5 → CONSUME, иначе → FALSE_BREAKOUT. Жёсткий cutoff.

Стало: градиент с confidence_modifier:

```
price_reversion >= 0.7 && delta_flip → CONSUME (confidence_modifier = 1.0)
price_reversion >= 0.4 && < 0.7 && delta_flip → CONSUME (confidence_modifier = price_reversion)
price_reversion >= 0.4 && !delta_flip → CONSUME (confidence_modifier = price_reversion * 0.5)
price_reversion < 0.4 → FALSE_BREAKOUT

final_confidence = confidence_formula_result * confidence_modifier
```

В UI: трейдер видит "Stop-hunt (60% уверенности)" вместо бинарного да/нет.

## Виртуальный P&L — обратная связь без роботов

У нас нет торгующих роботов. Обратная связь через виртуальный P&L:

### Механизм

Каждый ACTIVE сигнал содержит entry_price, stop_loss, target, TTL (динамический), direction.

Фоновый процесс каждые 5 минут проверяет все ACTIVE сигналы:
1. Запрашивает текущую цену тикера
2. Для LONG: если max(price за TTL) >= target → WIN; если min(price) <= stop → LOSS; иначе → EXPIRED
3. Для SHORT — зеркально
4. Закрывает сигнал, записывает result + pnl_ticks
5. Делает snapshot (v4.1 — при каждой проверке)

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
  close_reason: 'TARGET' | 'STOP' | 'EXPIRED' | 'DIRECTION_CHANGE';
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

## SignalSnapshot (v4.1 — при каждой P&L проверке)

Было: 6 snapshots/день = 4 точки за TTL 4ч — мало для отслеживания BSCI drop>0.15.

Стало: snapshot при каждой P&L проверке (каждые 5 мин) = ~100/день для ACTIVE сигналов.

```typescript
interface SignalSnapshot {
  signal_id: string;
  timestamp: Date;
  price: number;
  bsci: number;
  convergence: number;
  topDetector: number;
  topDetectorScore: number;
  pnl_unrealized: number;     // в тиках от entry
  wavefunction_state: string;
}
```

Это просто числа, не тяжело. Redis легко переварит ~100 записей/день/тикер.

## Жизненный цикл сигнала

```
ГЕНЕРАЦИЯ          АКТИВНЫЙ           ЗАКРЫТИЕ

BSCI ≥ 0.55  ──→  state=ACTIVE  ──→  Один из вариантов:
Conv ≥ 7          Проверка           ✅ TARGET — цена достигла Т1/Т2/Т3
TopDet ≥ 0.75     каждые 5 мин       🔴 STOP — цена пробила стоп
                  TTL = dynamic      ⏰ EXPIRED — истёк срок
                  Snapshot/5мин      🚫 FALSE_BREAKOUT — новостной пробой
                  Дедупликация       🔄 DIRECTION_CHANGE — сменилось направление

                                      → ПЕРЕХОДИТ В ИСТОРИЮ
                                        с result, close_price, pnl_ticks
```

## Формализованные условия выхода (v4.1)

| Условие | Порог | Тип |
|---------|-------|-----|
| CumDelta упал >50% от пика | cumDelta < peakCumDelta × 0.5 | CUMDELTA_REVERSAL |
| CumDelta сменил знак на 3 свечах | sign(cumDelta) ≠ sign(prevCumDelta) × 3 | CUMDELTA_REVERSAL |
| BSCI drop >0.15 | bsci < bsciAtCreation - 0.15 | BSCI_DROP |
| VPIN резко вырос | vpin > prevVpin × 1.5 | VPIN_SPIKE |
| Цена < стоп-лосс | price < stopLoss | PRICE_STOP |
| PREDATOR FALSE_BREAKOUT | градиент: reversion<0.4 → FALSE_BREAKOUT; ≥0.4 → CONSUME с modifier | FALSE_BREAKOUT |

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
├── signal-generator.ts      — логика генерации (формула confidence + пороги + дедупликация + динамический TTL)
├── level-calculator.ts      — расчёт уровней + estimated_stops
├── signal-store.ts          — zustand store для UI
├── signal-feedback.ts       — SignalFeedbackStore + виртуальный P&L
└── moex-sessions.ts         — утилиты для сессий МОЕКС (calculateTTL, getSessionInfo)

src/app/api/horizon/signals/
├── route.ts                 — GET активные сигналы
└── [ticker]/route.ts        — GET история сигналов по тикеру

src/components/horizon/frames/
└── SignalsFrame.tsx         — UI фрейма + корреляция бейджи
```

## Принципы дизайна сигналов

1. **НЕ СОВЕТНИК** — не добавлять sizing позиции (юридическая граница)
2. **riskRewardRatio** — метрика качества сигнала, не рекомендация
3. **R:R ≥ 2:1** — минимальный порог для качественного сигнала
4. **Тишина = норма** — большинство сканов не генерирует сигналы
5. **ОЖИДАНИЕ** — промежуточный статус (система "чует", но не готова)
6. **МАНИПУЛЯЦИЯ** — спуфинг обнаружен, конвергенция ≤ 2, вход опасен
7. **FALSE_BREAKOUT градиент** — вместо бинарного да/нет, confidence_modifier
8. **Виртуальный P&L** — обратная связь без роботов, без денег
9. **Спуфинг-фильтр** — штрафы конвергенции автоматически блокируют ненадёжные сигналы
10. **Feedback loop** — каждый сигнал получает result + pnl_ticks для калибровки
11. **Динамический TTL** — сигнал живёт пока рынок открыт, адаптирован под сессии МОЕКС
12. **Дедупликация** — обновление, не размножение сигналов
13. **Корреляция** — предупреждать о связанных сигналах, не блокировать
14. **Условное взвешивание BSCI** — при высокой конвергенции BSCI менее важен
