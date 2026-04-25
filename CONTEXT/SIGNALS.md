# СИГНАЛЫ: Фрейм автоматических торговых рекомендаций

> Статус: СПРОЕКТИРОВАН (не реализован)
> Приоритет: Спринт 4 (после TA-context и Robot-context)
> Файлы: `src/lib/horizon/signals/`, `src/components/horizon/frames/SignalsFrame.tsx`

## Порог генерации сигнала

Сигнал появляется ТОЛЬКО при одновременном выполнении ВСЕХ условий:

```
ПОРОГ ГЕНЕРАЦИИ:
├── BSCI ≥ 0.55 (ORANGE или выше)
├── Конвергенция ≥ 7/10 (детекторы + ТА)
├── Явная дивергенция (детектор ≠ ТА)
└── Top-детектор ≥ 0.75

Если хоть одно не выполнено → НЕТ сигнала (тишина)
Редкость = ценность
```

## Типы сигналов

| Тип | Иконка | Условие | Горизонт |
|-----|--------|---------|----------|
| ЛОНГ | 🟢 | BSCI≥0.55 + direction=BULL + conv≥7 | Дни |
| ШОРТ | 🔴 | BSCI≥0.55 + direction=BEAR + conv≥7 | Дни |
| ОЖИДАНИЕ | ⏳ | BSCI≥0.45 + conv<7 | Ждать подтверждения |
| ПРОРЫВ | ⚡ | BSCI≥0.55 + HAWKING≥0.7 + ATR сжат | Часы |

## Модель TradeSignal

```typescript
interface TradeSignal {
  ticker: string;
  type: 'LONG' | 'SHORT' | 'AWAIT' | 'BREAKOUT';
  confidence: number;        // 0-100% (ИСПРАВЛЕННАЯ ФОРМУЛА)
  convergence: number;       // 0-10

  // Уровни
  entryZone: [number, number];   // диапазон входа (±0.3 ATR)
  stopLoss: number;              // стоп (support/resistance ±0.5 ATR)
  targets: [number, number, number]; // Т1(+2ATR), Т2(+3.5ATR), Т3(S/R)
  riskRewardRatio: number;       // T1 / stop-distance (≥2:1 = качественный)

  // Обоснование
  trigger: string;           // "DECOHERENCE 1.00 — кит ворвался"
  confirmations: string[];   // ✅ подтверждающие факторы
  divergences: string[];     // ⚠️ противоречия (САМЫЕ ЦЕННЫЕ!)

  // Управление
  exitConditions: ExitCondition[];  // формализованные условия выхода

  // Метаданные
  createdAt: Date;
  expiresAt: Date;           // 4 часа TTL
  bsciAtCreation: number;

  // История (для feedback loop)
  snapshots: SignalSnapshot[];
  result?: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'EXPIRED' | 'BSCI_DIED';
  pnl?: number;              // +% или -%
}

interface ExitCondition {
  type: 'CUMDELTA_REVERSAL' | 'BSCI_DROP' | 'PRICE_STOP' | 'VPIN_SPIKE';
  description: string;
  threshold: number;         // конкретный порог
  triggered: boolean;
}

interface SignalSnapshot {
  timestamp: Date;           // при каждом скане (6/день)
  bsci: number;
  confidence: number;
  cumDelta: number;
  price: number;
}
```

## Формула уверенности (ИСПРАВЛЕННАЯ)

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
                                   
BSCI ≥ 0.55  ──→  Показан в UI  ──→  Один из вариантов:
Conv ≥ 7          Живёт 4 часа       ✅ Цена достигла Т1/Т2/Т3
                  Обновляется         🔴 Цена пробила стоп
                  при сканах          ⏰ Истёк срок (4 часа)
                  (6 снапшотов/день)  📉 BSCI < 0.30 (кит ушёл)
                                     
                                      → ПЕРЕХОДИТ В ИСТОРИЮ
                                        с result и pnl
```

## Формализованные условия выхода

| Условие | Порог | Тип |
|---------|-------|-----|
| CumDelta упал >50% от пика | cumDelta < peakCumDelta × 0.5 | CUMDELTA_REVERSAL |
| CumDelta сменил знак на 3 свечах | sign(cumDelta) ≠ sign(prevCumDelta) × 3 | CUMDELTA_REVERSAL |
| BSCI < 0.30 | bsci < 0.30 | BSCI_DROP |
| VPIN резко вырос | vpin > prevVpin × 1.5 | VPIN_SPIKE |
| Цена < стоп-лосс | price < stopLoss | PRICE_STOP |

## Расчёт уровней (level-calculator.ts)

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

Support/Resistance: простой алгоритм за 30 свечей
  Локальные экстремумы с объёмом > 1.5× средний
  Группировка в кластеры ±0.5 ATR
  Сортировка по объёму
```

## НОВЫЕ ФАЙЛЫ (Спринт 4)

```
src/lib/horizon/signals/
├── signal-generator.ts      — логика генерации
├── level-calculator.ts      — расчёт уровней входа/выхода
├── convergence.ts           — скор конвергенции 0-10
└── signal-store.ts          — zustand store для UI

src/app/api/horizon/signals/
├── route.ts                 — GET активные сигналы
└── [ticker]/route.ts        — GET история сигналов по тикеру

src/components/horizon/frames/
└── SignalsFrame.tsx         — UI фрейма (существует shell)
```

## Принципы дизайна сигналов

1. **НЕ СОВЕТНИК** — не добавлять sizing позиции (юридическая граница)
2. **riskRewardRatio** — метрика качества сигнала, не рекомендация
3. **R:R ≥ 2:1** — минимальный порог для качественного сигнала
4. **Тишина = норма** — большинство сканов не генерируют сигналы
5. **ОЖИДАНИЕ** — промежуточный статус (система "чует", но не готова)
6. **Feedback loop** — каждый сигнал получает result + pnl для калибровки
