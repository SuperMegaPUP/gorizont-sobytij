# ТА-КОНТЕКСТ: Технические индикаторы + SignalConvergence + Convergence Score

> Файлы: `src/lib/horizon/ta-context.ts`, `src/lib/horizon/convergence-score.ts`
> Статус: РЕАЛИЗОВАН (Спринт 2 + Спринт 3)
> Обновлён: 2026-04-26

## 5 индикаторов (НЕ входят в BSCI — только контекст)

| Индикатор | Параметр | Диапазон | Зоны | Что показывает |
|-----------|----------|----------|------|---------------|
| RSI(14) | 14 свечей | 0-100 | OVERSOLD <30, NEUTRAL 30-70, OVERBOUGHT >70 | Перепроданность/перекупленность |
| CMF(20) | 20 свечей | -1..+1 | POSITIVE >0.05, NEUTRAL, NEGATIVE <-0.05 | Приток/отток денег |
| CRSI(3) | 3 свечи | 0-100 | OVERSOLD <20, NEUTRAL 20-80, OVERBOUGHT >80 | Краткосрочная перепроданность |
| ATR(14) | 14 свечей | 0-N | COMPRESSED <0.2p, NORMAL, EXPANDED >0.8p | Волатильность (сжатие = прорыв) |
| VWAP | Все сделки | цена | BELOW, AT_VWAP, ABOVE | Позиция цены vs средневзвешенная |

## SignalConvergence Model

```typescript
interface SignalConvergence {
  signal: ConvergenceSignal;           // STRONG_BULL | BULL | NEUTRAL | BEAR | STRONG_BEAR
  divergence: boolean;                 // Есть дивергенция (BSCI ≠ ТА)
  divergenceNote: string;              // Описание для UI
  bsciDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  taDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  convergenceStrength: number;         // 0 = полное расхождение, 1 = полное совпадение
  indicators: TAIndicators;            // Детали 5 индикаторов
}
```

## Логика конвергенции/дивергенции

### Определение TA-направления

Взвешенное голосование 5 индикаторов:
- RSI OVERSOLD → +1.0 bull (перепроданность → отскок)
- RSI OVERBOUGHT → +1.0 bear
- CMF POSITIVE → +1.5 bull (сильный индикатор!)
- CMF NEGATIVE → +1.5 bear
- CRSI OVERSOLD → +0.5 bull (краткосрочный)
- CRSI OVERBOUGHT → +0.5 bear
- VWAP ABOVE → +1.0 bull
- VWAP BELOW → +1.0 bear
- ATR → НЕ голосует (контекстный, не направленный)

Порог: bullScore ≥ 2 и > bearScore × 1.5 → BULLISH (и наоборот)

### Конвергенция vs Дивергенция

| BSCI | ТА | Результат | Значение |
|------|-----|-----------|----------|
| BULL | BULL | STRONG_BULL | ✅ Конвергенция — надёжный бычий |
| BEAR | BEAR | STRONG_BEAR | ✅ Конвергенция — надёжный медвежий |
| BULL | BEAR | BULL + divergence=true | ⚡ Дивергенция — кит накапливает, ТА не видит |
| BEAR | BULL | BEAR + divergence=true | ⚡ Дивергенция — кит распределяет, ТА не видит |
| BULL/BEAR | NEUTRAL | BULL/BEAR + divergence=true | ⚡ Скрытая активность — детекторы видят, ТА нет |

### Дивергенция = самый ценный сигнал

"Кит виден (BSCI), но ТА нет" → скрытая активность крупного игрока.
- BSCI BULL + CMF NEGATIVE → кит покупает тихо (скрытая аккумуляция)
- BSCI BEAR + CMF POSITIVE → кит продаёт тихо (скрытое распределение)
- BSCI > 0.4 + TA NEUTRAL → кит действует, рынок не отреагировал

## Convergence Score 0-10 (`convergence-score.ts`)

Числовой скор конвергенции для signal-generator и UI.

### Расчёт

```
Базовые баллы (5 индикаторов × 0-2 = 0-10):
  +2 = ALIGNED (индикатор согласен с BSCI направлением)
  +1 = NEUTRAL (индикатор не противоречит)
  +0 = DIVERGENT (индикатор ПРОТИВОРЕЧИТ BSCI)

Бонусы:
  +1 — дивергенция (скрытая активность, BSCI ≥ 0.55)
  +1 — ATR-сжатие (прорыв неизбежен)
  +1 — робот-подтверждение (isRobotConfirmed())

Штрафы:
  −2 — СПУФИНГ (hasSpoofing = true, стены ФАЛЬШИВЫЕ)
  −1 — cancel > 80% (cancelRatio > 0.8, ордера отменяются)

Финал: clamp(totalPoints, 0, 10)
```

### Детали по индикаторам

| Индикатор | +2 (ALIGNED) | +1 (NEUTRAL) | +0 (DIVERGENT) |
|-----------|-------------|-------------|----------------|
| RSI(14) | RSI зона совпадает с BSCI (oversold+BULL, overbought+BEAR) | RSI нейтральный (30-70) | RSI зона противоречит BSCI |
| CMF(20) | CMF знак совпадает с BSCI (positive+BULL, negative+BEAR) | CMF нейтральный (-0.05..0.05) | CMF знак противоречит BSCI |
| CRSI(3) | CRSI зона совпадает с BSCI | CRSI нейтральный | CRSI зона противоречит BSCI |
| VWAP | Цена по ту же сторону VWAP что и BSCI | Цена у VWAP | Цена по другую сторону |
| ATR | ATR сжат + BSCI ≥ 0.55 (прорыв неизбежен) | ATR расширен или нормальный | ATR сжат + BSCI < 0.55 (нет прорыва) |

### ConvergenceScoreResult

```typescript
interface ConvergenceScoreResult {
  score: number;              // 0-10
  details: ConvergenceDetail[];  // По каждому индикатору
  summary: string;            // "1/5 совпадений, 2 дивергенций, +1 роботы, −2 СПУФИНГ, −1 cancel>80% = 2/10"
  divergenceBonus: boolean;   // +1 за скрытую активность
  atrBonus: boolean;          // +1 за ATR-сжатие
  robotBonus: boolean;        // +1 за робот-подтверждение
  spoofingPenalty: boolean;   // −2 за спуфинг
  cancelPenalty: boolean;     // −1 за cancel>80%
}
```

### Пример: SMLT

| Компонент | Балл |
|-----------|------|
| RSI 31.2 (нейтральный) | +1 |
| CMF -0.464 (ПРОТИВОРЕЧИТ BSCI BULL) | +0 |
| CRSI 10.6 (перепроданность → отскок) | +2 |
| VWAP -0.30% (ПРОТИВОРЕЧИТ BSCI BULL) | +0 |
| ATR 90% расширен | +1 |
| **База** | **4** |
| +1 роботы (△ Частично, confirmation=0.50) | +1 |
| −2 СПУФИНГ | −2 |
| −1 cancel>80% | −1 |
| **Итого** | **2/10** 🚫 МАНИПУЛЯЦИЯ |

## Порядок вычислений

1. Суммируются 5 индикаторных баллов → `totalPoints` (0-10)
2. Применяются бонусы: +1 дивергенция, +1 ATR, +1 роботы
3. Применяются штрафы: −2 спуфинг, −1 cancel>80%
4. `score = clamp(totalPoints, 0, 10)`

**Важно**: Штрафы применяются ПОСЛЕ бонусов. Робот-бонус (+1) может частично компенсировать спуфинг-штраф (−2), но не полностью.

## UI: Секция "Конвергенция" в карточке тикера

- Скор 2/10 с красным бейджем (0-3 красный, 4-6 жёлтый, 7-10 зелёный)
- Прогресс-бар с цветом
- Summary строка: "1/5 совпадений, 2 дивергенций, +1 роботы, −2 СПУФИНГ, −1 cancel>80% = 2/10"
- Детализация по каждому индикатору (✅/⚠️/— + пояснение)
- Бонусы: "+1 роботы" (голубой), "+1 дивергенция" (жёлтый), "+1 ATR-сжатие" (синий)
- Штрафы: "−2 СПУФИНГ" (красный), "−1 cancel>80%" (оранжевый)

## UI: ConvergenceCell в сканере

Компактная ячейка в таблице:
- Скор X/10
- Направление: ▲▲/▲/—/▼/▼▼
- ⚡ дивергенция
- 🤖 робот-подтверждение
- 🚫 спуфинг-штраф
- ⚠ cancel>80% штраф
- ⊕/⊗ ATR зона
- OS/OB RSI зона

## Интеграция в scan pipeline

```typescript
// В scanTicker() — шаги 11-14
const taIndicators = calculateTAIndicators(candles, trades, orderbook);           // Шаг 11
const taContext = calculateSignalConvergence(bsciDirection, bsciScore, taIndicators); // Шаг 12
const robotContext = await calculateRobotContext(ticker, algopack, detectorScores, topDetector, bsci); // Шаг 13
const convergenceScore = calculateConvergenceScore(                                // Шаг 14
  bsciDirection, bsciScore, taIndicators,
  taContext.divergence, atrCompressed,
  isRobotConfirmed(robotContext),
  robotContext?.hasSpoofing ?? false,
  robotContext?.cancelRatio ?? 0,
);
```
