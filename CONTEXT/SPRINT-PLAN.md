# СПРИНТ-ПЛАН: Горизонт Событий

> Обновлён: 2026-04-26
> Текущий спринт: Спринт 4 (Сигналы)

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

## Спринт 2 (ЗАВЕРШЁН): TA-Context + Конвергенция

- [x] `ta-context.ts` — 5 TA индикаторов (RSI, CMF, CRSI, ATR, VWAP)
- [x] `SignalConvergence` модель
- [x] Конвергенция/дивергенция логика
- [x] Интеграция в scan pipeline (scanTicker шаг 11)
- [x] UI: ConvergenceCell в сканере (▲▲/▲/—/▼/▼▼ + ⚡ + ⊕/⊗ + OS/OB)
- [x] Числовой скор конвергенции 0-10 (`convergence-score.ts`)
- [x] UI: расширенная секция "КОНВЕРГЕНЦИЯ" в карточке тикера (TickerModal)
- [x] Деплой в PROD и LAB

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

## Спринт 3 (ЗАВЕРШЁН): Robot Context

- [x] `robot-context.ts` — мост detect-engine + AlgoPack → Horizon
- [x] `DETECTOR_PATTERN_MAP` — 10 детекторов ↔ 11 робот-паттернов (прямое + обратное маппинг)
- [x] `DETECTOR_ALGOPACK_MAP` — маппинг на AlgoPack wall/accum индикаторы
- [x] `computeRobotConfirmation()` — оценка 0.1–1.0 (typeMatch + partialMatch + algopackMatch)
- [x] `isRobotConfirmed()` — порог 0.4 (снижен с 0.5)
- [x] Graceful degradation (нет роботов → без бонуса)
- [x] +1 к conv/10 при робот-подтверждении
- [x] Спуфинг-штрафы: hasSpoofing → −2, cancelRatio>80% → −1
- [x] UI: секция "🤖 Робот-контекст" в карточке тикера (объём%, стена, накопл., cancel%, дисбаланс, спуфинг, детектор↔паттерн)
- [x] UI: ConvergenceCell в сканере (🤖 роботы, 🚫 спуфинг, ⚠ cancel>80%)
- [x] UI: Action label "🚫 МАНИПУЛЯЦИЯ" при ALERT + спуфинг + conv≤2
- [x] Исправление: СПОУФИНГ → СПУФИНГ (орфография)
- [x] Деплой в PROD и LAB

### Ключевые файлы Спринта 3

| Файл | Назначение |
|------|-----------|
| `src/lib/horizon/robot-context.ts` | RobotContext model, confirmation logic, AlgoPack bridge |
| `src/lib/horizon/convergence-score.ts` | Convergence score 0-10 + бонусы + спуфинг-штрафы |
| `src/app/api/horizon/scan/route.ts` | Передача hasSpoofing/cancelRatio в convergence |
| `src/components/horizon/modals/TickerModal.tsx` | UI: робот-контекст + МАНИПУЛЯЦИЯ badge |
| `src/components/horizon/frames/ScannerFrame.tsx` | UI: ConvergenceCell с иконками штрафов |

## Спринт 4 (ТЕКУЩИЙ): Сигналы

- [ ] `signal-generator.ts` — логика генерации с исправленной формулой
- [ ] `level-calculator.ts` — расчёт уровней (простой S/R за 30 свечей)
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
