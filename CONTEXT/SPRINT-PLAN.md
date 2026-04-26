# СПРИНТ-ПЛАН: Горизонт Событий

> Обновлён: 2026-04-26 (Спецификация v4.1 — заморожена)
> Текущий спринт: Спринт 4 (П1 правки → СИГНАЛЫ → Feedback+UI)
> ВАЖНО: П1 СТРОГО ДО signal-generator! Порядок изменён в v4.1.

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

## Спринт 3 (ЗАВЕРШЁН): Robot Context

- [x] `robot-context.ts` — мост detect-engine + AlgoPack → Horizon
- [x] `DETECTOR_PATTERN_MAP` — 10 детекторов ↔ 11 робот-паттернов
- [x] `DETECTOR_ALGOPACK_MAP` — маппинг на AlgoPack wall/accum индикаторы
- [x] `computeRobotConfirmation()` — оценка 0.1–1.0
- [x] `isRobotConfirmed()` — порог 0.4 (снижен с 0.5)
- [x] Спуфинг-штрафы: hasSpoofing → −2, cancelRatio>80% → −1
- [x] UI: робот-контекст + МАНИПУЛЯЦИЯ badge + СПУФИНГ→СПУФИНГ
- [x] Деплой в PROD и LAB

## Спринт 4 (ТЕКУЩИЙ): СИГНАЛЫ

### ПОРЯДОК v4.1: Параметризованные пороги — можно строить ПАРАЛЛЕЛЬНО

П1 правки уже реализованы в коде (BSCI η=0.03+min_w=0.04, HAWKING Welch PSD, DARKMATTER iceberg consecutive, DECOHERENCE symbolic stream). Пороги сигналов параметризованы как константы (`SIGNAL_BSCI_THRESHOLD`, `SIGNAL_CONV_THRESHOLD`) — подправим одной строкой после замера.

### Фаза 1 (ВЫПОЛНЕНА): П1 правки детекторов ✅

| # | Правка | Статус |
|---|--------|--------|
| П1-1 | BSCI η=0.03 + min_w=0.04 | ✅ Реализовано в save-observation.ts |
| П1-2 | HAWKING: noise_ratio fix + Welch PSD + N≥50 | ✅ Реализовано в hawking.ts |
| П1-3 | DARKMATTER: ΔH_norm + iceberg consecutive + MIN_ICEBERG_VOLUME | ✅ Реализовано в darkmatter.ts |
| П1-4 | DECOHERENCE: symbolic stream + tick_rule при ΔP=0 | ✅ Реализовано в decoherence.ts |

### Фаза 2 (ВЫПОЛНЕНА): Signal core ✅

| # | Компонент | Файл | Статус |
|---|-----------|------|--------|
| 2-0 | Динамический TTL по МОЕКС | `signals/moex-sessions.ts` | ✅ |
| 2-1 | level-calculator.ts | `signals/level-calculator.ts` | ✅ |
| 2-2 | signal-generator.ts | `signals/signal-generator.ts` | ✅ |
| 2-3 | signal-feedback.ts | `signals/signal-feedback.ts` | ✅ |
| 2-4 | signal-store.ts | `signals/signal-store.ts` | ✅ |
| 2-5 | /api/horizon/signals | `api/horizon/signals/route.ts` | ✅ |
| 2-6 | Интеграция в scan route | `api/horizon/scan/route.ts` | ✅ |
| 2-7 | Exit conditions (встроены в signal-generator + feedback) | — | ✅ |
| 2-8 | Корреляция SAME_ISSUER (встроена в signal-generator) | — | ✅ |

### Фаза 3 (ВЫПОЛНЕНА): Feedback + UI ✅

| # | Компонент | Файл | Статус |
|---|-----------|------|--------|
| 3-1 | SignalsFrame.tsx | `components/horizon/frames/SignalsFrame.tsx` | ✅ |
| 3-2 | Frame Registry + Layout Store | `lib/frame-registry.tsx`, `lib/layout-store.ts` | ✅ |
| 3-3 | Virtual P&L + SignalFeedbackStore (в signal-feedback.ts) | — | ✅ |
| 3-4 | SignalSnapshot при каждой P&L проверке | — | ✅ |

### КОГДА ОТКРОЕТСЯ СЕССИЯ:
→ Замерить BSCI/convergence распределения
→ Скорректировать SIGNAL_BSCI_THRESHOLD и SIGNAL_CONV_THRESHOLD если нужно
→ Это 5 минут работы

### Формула уверенности (v4.1 — условное взвешивание BSCI)

```
bsci_weight = convergence >= 8 ? 20 : convergence < 5 ? 30 : 25;
confidence = BSCI(bsci_weight) + conv(25) + RSI/CRSI(20) + роботы(15) + дивергенция(15)

Дивергенция УСЛОВНАЯ:
  topDetector ≥ 0.85 → +15
  topDetector < 0.85 → −10
```

Почему условное взвешивание: BSCI и convergence коррелированы (высокий BSCI → больше TA-совпадений → выше convergence). Двойной счёт завышает confidence для ORANGE/RED тикеров. Решение: при высокой конвергенции BSCI менее важен (вес 20), при слабой — более важен как «есть ли аномалия» (вес 30).

### Динамический TTL (v4.1 — вместо фиксированного 4ч)

```
function calculateTTL(now: Date): number {
  const session = getSessionInfo(now);

  if (session === 'MAIN') {
    // Основная сессия: TTL = до закрытия, но не более 4ч
    return min(4 * 60, minutesUntilClose());
  }
  if (session === 'EVENING') {
    // Вечерняя: низкая ликвидность, TTL = 2ч макс
    return min(2 * 60, minutesUntilClose());
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

### Дедупликация сигналов (v4.1)

1. Тот же тикер + тот же direction + <TTL → ОБНОВИТЬ существующий сигнал (пересчитать entry/stop/target, добавить snapshot, НЕ создавать новый signal_id)
2. Тот же тикер + сменился direction → ЗАКРЫТЬ старый (reason: DIRECTION_CHANGE), создать новый
3. Тот же тикер + TTL истёк → ЗАКРЫТЬ (reason: EXPIRED), новый скан может создать новый

### Корреляция сигналов (v4.1)

```
interface Signal {
  correlatedWith?: string[];
  correlationType?: 'SAME_ISSUER' | 'SAME_SECTOR' | 'SAME_FUND';
}
```

Правила: SBER/SBERP → SAME_ISSUER; тикеры одного сектора с ENTANGLE>0.5 → SAME_SECTOR; ENTANGLE-флаг → SAME_FUND. В UI: бейдж "🔗 Связано с SBERP" — не блокировать, но предупредить.

### FALSE_BREAKOUT градиент (v4.1 — вместо бинарного порога)

```
price_reversion >= 0.7 && delta_flip → CONSUME (confidence_modifier = 1.0)
price_reversion >= 0.4 && < 0.7 && delta_flip → CONSUME (confidence_modifier = price_reversion)
price_reversion >= 0.4 && !delta_flip → CONSUME (confidence_modifier = price_reversion * 0.5)
price_reversion < 0.4 → FALSE_BREAKOUT

final_confidence = confidence_formula_result * confidence_modifier
```

### SignalSnapshot при каждой P&L проверке (v4.1)

```
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

~100 записей/день/тикер вместо 6. Redis легко переварит.

### Условия выхода (обновлены для v4.1)

| Условие | Порог | Тип |
|---------|-------|-----|
| CumDelta упал >50% от пика | cumDelta < peakCumDelta × 0.5 | CUMDELTA_REVERSAL |
| CumDelta сменил знак на 3 свечах | sign(cumDelta) ≠ sign(prevCumDelta) × 3 | CUMDELTA_REVERSAL |
| BSCI drop >0.15 | bsci < bsciAtCreation - 0.15 | BSCI_DROP |
| VPIN резко вырос | vpin > prevVpin × 1.5 | VPIN_SPIKE |
| Цена < стоп-лосс | price < stopLoss | PRICE_STOP |
| PREDATOR FALSE_BREAKOUT | градиент: reversion<0.4 → FALSE_BREAKOUT; reversion≥0.4 → CONSUME с confidence_modifier | FALSE_BREAKOUT |

## Спринт 5: Калибровка + П2 структурные улучшения

### Калибровка

- [ ] Win rate по истории сигналов (через виртуальный P&L)
- [ ] ROC-анализ порогов + Youden's J
- [ ] Уровень 0: внутренняя консистентность (детектор vs свои данные)
- [ ] Уровень 1: детектор vs робот-данные
- [ ] Уровень 2: детектор vs робот-данные vs результат сигнала

### П2 Структурные улучшения детекторов

| # | Правка | Описание |
|---|--------|----------|
| П2-1 | GRAVITON | Центры масс bid/ask + detect_walls + depth-вес + 80% объём cutoff + ε=1e-6 |
| П2-2 | ACCRETOR | DBSCAN (классический, окно 200, 30сек) + ATR-нормализация concentration |
| П2-3 | CIPHER | Двухуровневый PCA→ICA + z-score перед PCA + ICA fallback + condition number check |
| П2-4 | ATTRACTOR | Takens + volume_profile + stickiness + Silverman bandwidth + авто τ через ACF + stickiness по 0.5*spread |
| П2-5 | ENTANGLE | ADF-тест стационарности перед Granger |
| П2-6 | PREDATOR | estimated_stops формула + FALSE_BREAKOUT градиент (часть П1 уже в v4.1) |
| П2-7 | WAVEFUNCTION | Ресэмплинг при N_eff < 0.5*n_particles + log-weights (ОБЯЗАТЕЛЬНО) |
| П2-8 | BSCI | Мягкий daily weight decay (w = 0.99*w + 0.01/K) |
| П2-9 | Сквозная | z-score нормализация в data pipeline для всех детекторов |

## Спринт 6+: П3 Продвинутые

| # | Правка | Описание |
|---|--------|----------|
| П3-1 | WAVEFUNCTION | Learnable transition matrix + адаптивные частицы 200-1000 |
| П3-2 | ENTANGLE | Hilbert transform + AIC/BIC лаг-селекция для топ-20 пар |
| П3-3 | PREDATOR | Volume POC для стоп-уровней |
| П3-4 | Синтетика | Тест-сценарии (iceberg, accumulator, predator, algorithm, coordinated, regime_change) |
| П3-5 | KL-divergence | Еженедельный мониторинг концептуального дрейфа + заморозка адаптации при drift > 0.15 |
| П3-6 | ACCRETOR | Streaming DBSCAN с инкрементальным обновлением |
| П3-7 | ATTRACTOR | FNN для автоматического выбора d |
| П3-8 | BSCI | Динамическое окно верификации через ATR |

## Sprint mapping (v4.1)

```
Sprint 4 (текущий):
  Фаза 1: П1 правки (BSCI η+min_w, HAWKING, DARKMATTER, DECOHERENCE)
  → замер BSCI/convergence распределений → калибровка порогов
  Фаза 2: signal-generator + level-calculator + signal-store + exit conditions
  Фаза 3: virtual P&L + SignalSnapshot + корреляция + SignalsFrame.tsx

Sprint 5: Калибровка + win rate + П2 + ROC-анализ порогов + Youden's J
Sprint 6+: П3 + обучение матриц + Hilbert + POC стопы + синтетические тесты + KL-divergence
```
