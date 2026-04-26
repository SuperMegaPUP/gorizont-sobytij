# СИГНАЛЫ: Фрейм автоматических торговых рекомендаций

> Статус: РЕАЛИЗОВАН (Спринт 4, Спецификация v4.1)
> Обновлён: 2026-04-26
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
  entry_price: number;
  entryZone: [number, number];     // ±0.3 ATR
  stopLoss: number;                // S/R ± 0.5 ATR
  targets: [number, number, number]; // T1(+2ATR), Т2(+3.5ATR), Т3(S/R)
  riskRewardRatio: number;         // ≥2:1 = качественный

  // Обоснование
  trigger: string;           // "DECOHERENCE 1.00 — кит ворвался"
  confirmations: string[];   // ✅ подтверждающие факторы
  divergences: string[];     // ⚠️ противоречия

  // Управление
  exitConditions: ExitCondition[];

  // Метаданные
  direction: 'LONG' | 'SHORT';
  state: 'ACTIVE';
  wavefunction_state: 'ACCUMULATE' | 'DISTRIBUTE' | 'HOLD';
  top_detector: string;
  bsciAtCreation: number;

  // Корреляция (v4.1)
  correlatedWith?: string[];
  correlationType?: 'SAME_ISSUER' | 'SAME_SECTOR' | 'SAME_FUND';

  // Время (v4.1 — динамический TTL)
  createdAt: Date;
  expiresAt: Date;           // TTL = calculateTTL(createdAt)

  // История
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
    return Math.min(4 * 60, minutesUntilClose(now));
  }
  if (session === 'EVENING') {
    return Math.min(2 * 60, minutesUntilClose(now));
  }
  if (session === 'OVERNIGHT') {
    return 0;
  }
}
```

## Дедупликация сигналов (v4.1)

1. Тот же тикер + тот же direction + <TTL → **ОБНОВИТЬ** существующий сигнал
2. Тот же тикер + сменился direction → **ЗАКРЫТЬ** старый (reason: DIRECTION_CHANGE)
3. Тот же тикер + TTL истёк → **ЗАКРЫТЬ** (reason: EXPIRED)

## Корреляция сигналов (v4.1)

```typescript
interface Signal {
  correlatedWith?: string[];
  correlationType?: 'SAME_ISSUER' | 'SAME_SECTOR' | 'SAME_FUND';
}
```

Правила: SBER/SBERP → SAME_ISSUER; тикеры одного сектора с ENTANGLE>0.5 → SAME_SECTOR; ENTANGLE-флаг → SAME_FUND. В UI: бейдж "🔗 Связано с SBERP".

## Формула уверенности (v4.1 — условное взвешивание BSCI)

```
bsci_weight = convergence >= 8 ? 20 : convergence < 5 ? 30 : 25;
confidence = BSCI(bsci_weight) + conv(25) + RSI/CRSI(20) + роботы(15) + дивергенция(15)

Детализация:
  BSCI: 0-bsci_weight баллов (линейно от 0.55 до 1.0)
  Конвергенция: 0-25 баллов (от 7 до 10)
  RSI/CRSI: 0-20 баллов (экстремумы = больше баллов)
  Роботы: 0-15 баллов (graceful degradation при отсутствии)
  Дивергенция: УСЛОВНАЯ:
    topDetector ≥ 0.85 → +15
    topDetector < 0.85 → −10
```

## FALSE_BREAKOUT градиент (v4.1)

```
price_reversion >= 0.7 && delta_flip → CONSUME (confidence_modifier = 1.0)
price_reversion >= 0.4 && < 0.7 && delta_flip → CONSUME (confidence_modifier = price_reversion)
price_reversion >= 0.4 && !delta_flip → CONSUME (confidence_modifier = price_reversion * 0.5)
price_reversion < 0.4 → FALSE_BREAKOUT

final_confidence = confidence_formula_result * confidence_modifier
```

## Виртуальный P&L — обратная связь без роботов

### Механизм

1. Фоновый процесс каждые 5 минут проверяет все ACTIVE сигналы
2. Запрашивает текущую цену тикера
3. Для LONG: если max(price)>=target → WIN; min(price)<=stop → LOSS; иначе EXPIRED
4. Для SHORT — зеркально
5. Закрывает сигнал, записывает result + pnl_ticks

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

## SignalSnapshot (v4.1)

```typescript
interface SignalSnapshot {
  signal_id: string;
  timestamp: Date;
  price: number;
  bsci: number;
  convergence: number;
  topDetector: number;
  topDetectorScore: number;
  pnl_unrealized: number;
  wavefunction_state: string;
}
```

~100 записей/день/тикер при каждой P&L проверке.

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
| PREDATOR FALSE_BREAKOUT | градиент: reversion<0.4 → FALSE_BREAKOUT; ≥0.4 → CONSUME | FALSE_BREAKOUT |

## Файлы (Спринт 4 — РЕАЛИЗОВАНЫ)

```
src/lib/horizon/signals/
├── signal-generator.ts      — ✅ логика генерации (confidence + пороги + дедупликация + TTL)
├── level-calculator.ts      — ✅ расчёт уровней + estimated_stops
├── signal-store.ts          — ✅ zustand store + Redis сериализация
├── signal-feedback.ts       — ✅ SignalFeedbackStore + виртуальный P&L
└── moex-sessions.ts         — ✅ утилиты для сессий МОЕКС (calculateTTL, getSessionInfo)

src/app/api/horizon/signals/
└── route.ts                 — ✅ GET активные сигналы

src/components/horizon/frames/
└── SignalsFrame.tsx         — ✅ UI фрейма + корреляция бейджи
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
