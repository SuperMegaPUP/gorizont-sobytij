# СПРИНТ-ПЛАН: Горизонт Событий

> Обновлён: 2026-04-25
> Текущий спринт: Спринт 2 (TA-Context)

## Спринт 1 (ЗАВЕРШЁН): Фундамент

- [x] 10 детекторов аномалий (Black Star framework)
- [x] BSCI Composite Index с адаптивными весами
- [x] Scanner Rules Engine (10 IF-THEN правил)
- [x] AI Observer (6 слотов/день, z-ai-web-dev-sdk)
- [x] Сканер UI (core 9 фьючерсов)
- [x] Радар UI (BSCI Y-axis, CumDelta X-axis, квадранты)
- [x] Тепловая карта UI
- [x] TOP-100 акций по VALTODAY
- [x] Кросс-секционная нормализация (z-score)
- [x] Font settings (11 шрифтов, max 45px)
- [x] Деплой pipeline через Vercel CLI

## Спринт 2 (ТЕКУЩИЙ): TA-Context + Конвергенция

- [x] `ta-context.ts` — 5 TA индикаторов (RSI, CMF, CRSI, ATR, VWAP)
- [x] `SignalConvergence` модель
- [x] Конвергенция/дивергенция логика
- [x] Интеграция в scan pipeline (scanTicker шаг 11)
- [x] UI: ConvergenceCell в сканере (▲▲/▲/—/▼/▼▼ + ⚡ + ⊕/⊗ + OS/OB)
- [ ] Уровень 0: внутренняя консистентность детекторов
- [ ] Числовой скор конвергенции 0-10 (для signal-generator)
- [ ] UI: расширенная секция "КОНВЕРГЕНЦИЯ" в карточке тикера (TickerModal)
- [ ] Деплой в PROD и LAB

### Формула уверенности (утверждена для Спринта 4)

```
confidence = BSCI(25) + conv(25) + RSI/CRSI(20) + роботы(15) + дивергенция(15)
Дивергенция УСЛОВНАЯ:
  topDetector ≥ 0.85 → +15
  topDetector < 0.85 → −10
```

### Условия выхода (формализованы для Спринта 4)

| Условие | Порог |
|---------|-------|
| CumDelta упал >50% от пика | CUMDELTA_REVERSAL |
| CumDelta сменил знак на 3 свечах | CUMDELTA_REVERSAL |
| BSCI < 0.30 | BSCI_DROP |
| VPIN резко вырос (>1.5x) | VPIN_SPIKE |
| Цена < стоп-лосс | PRICE_STOP |

## Спринт 2.5: Реверс-инжиниринг дашборда роботов

- [ ] Прочитать код дашборда роботов
- [ ] Найти Redis-ключи и формат данных
- [ ] Определить частоту обновления
- [ ] Задокументировать схему в ROBOT-INTEGRATION.md

## Спринт 3: Robot Context

- [ ] `/api/horizon/robot-context` — GET RobotContext по тикеру
- [ ] `RobotContext` модель + `robotConfirmation()` функция
- [ ] Graceful degradation (нет роботов → без бонуса)
- [ ] +1 к conv/10 при робот-подтверждении top-детектора
- [ ] UI: строка "🤖 РОБОТЫ" в карточке тикера + в Сигналах
- [ ] Деплой в PROD и LAB

## Спринт 4: Сигналы (после 2 + 3)

- [ ] `signal-generator.ts` — логика генерации с исправленной формулой
- [ ] `level-calculator.ts` — расчёт уровней (простой S/R за 30 свечей)
- [ ] `convergence.ts` — скор конвергенции 0-10
- [ ] `signal-store.ts` — zustand store для UI
- [ ] `/api/horizon/signals` — GET активные сигналы
- [ ] `/api/horizon/signals/[ticker]` — GET история по тикеру
- [ ] `SignalsFrame.tsx` — полный UI фрейма
- [ ] `riskRewardRatio` в модели TradeSignal
- [ ] Условия выхода — формализованные пороги
- [ ] Feedback loop: result + pnl в историю
- [ ] SignalSnapshot при каждом скане (6/день)
- [ ] Деплой в PROD и LAB

## Спринт 5: Калибровка (через месяц данных)

- [ ] Win rate по истории сигналов
- [ ] Уровень 0: внутренняя консистентность (детектор vs свои данные)
- [ ] Уровень 1: детектор vs робот-данные
- [ ] Уровень 2: детектор vs робот-данные vs результат сигнала
- [ ] Адаптивные пороги (threshold drift по рыночным режимам)
- [ ] Автоматическая подстройка весов BSCI
