# ТА-КОНТЕКСТ: Технические индикаторы + SignalConvergence

> Файл: `src/lib/horizon/ta-context.ts`
> Статус: РЕАЛИЗОВАН (Спринт 2)

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

## Интеграция в scan pipeline

```typescript
// В scanTicker() — шаг 11
const taIndicators = calculateTAIndicators(candles, trades, orderbook);
const taContext = calculateSignalConvergence(bsciDirection, bsciScore, taIndicators);

// Результат включён в TickerScanResult.taContext
```

## UI: Секция "Конвергенция" в сканере

- В таблице сканера: колонка "Конверг." с ConvergenceCell
- ▲▲ STRONG_BULL / ▲ BULL / — NEUTRAL / ▼ BEAR / ▼▼ STRONG_BEAR
- ⚡ маркер дивергенции (жёлтый)
- ⊕ ATR COMPRESSED / ⊗ ATR EXPANDED
- OS (RSI oversold) / OB (RSI overbought)
- Строка с `border-l-2 border-l-yellow-500/60` при divergence=true

## Что НЕ сделано (перенесено в Спринт 4)

- Числовой скор конвергенции 0-10 (для signal-generator)
- Робот-подтверждение (+1 к conv/10)
- Уровень 0 внутренней консистентности (детектор vs свои данные)
