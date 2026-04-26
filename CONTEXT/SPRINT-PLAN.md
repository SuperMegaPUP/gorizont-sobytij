# СПРИНТ-ПЛАН: Горизонт Событий

> Обновлён: 2026-04-26 (Sprint 5: Trade-based OFI + П2-9 z-score)
> Текущий спринт: Спринт 5 — В ПРОЦЕССЕ (5C + П2-9 выполнены, 5A/5B/5D остаются)

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

## Спринт 4 (ЗАВЕРШЁН): СИГНАЛЫ + П1 правки + bugfix'ы + HOTFIX v4.1.5

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

### Bugfix'ы Sprint 4 (ВЫПОЛНЕНЫ) ✅

| # | Баг | Статус |
|---|-----|--------|
| BF-1 | BSCI идентичный 0.52 у всех тикеров | ✅ Fallback values → 0 при нет данных |
| BF-2 | OFI всегда = 0.0 | ✅ Добавлены поля ofi/realtimeOFI, точность .toFixed(3) |
| BF-3 | ТОП 100 не грузился — только 9 фьючерсов | ✅ Инкрементальное сканирование + fastMode |
| BF-4 | Деплой на wrong Vercel project | ✅ Токен + Vercel CLI напрямую |

### HOTFIX v4.1.5 (ВЫПОЛНЕН) ✅ — BSCI=0.00 на выходных

| # | Фикс | Описание | Статус |
|---|------|----------|--------|
| FIX 0 | `reversed=1` | MOEX ISS `/trades.json` — LAST 200 сделок вместо FIRST 200 | ✅ 6 мест |
| FIX 1 | isWeekend удалён | Сессия определяется ТОЛЬКО по времени суток | ✅ |
| FIX 2 | canGenerateSignals убран из scan | Блокировка только генерации сигналов, не детекторов | ✅ |
| FIX 3 | canGenerateSignals убран из top100 | + TTL 1800→7200 + hasRealData + progress cleanup | ✅ |
| FIX 4 | canGenerateSignals только в signal-generator | Очистка неиспользуемых импортов | ✅ |
| FIX 5 | [DATA-DEBUG] логирование | В collect-market-data.ts | ✅ |
| FIX 6 | staleData логика | Пустой orderbook ≠ stale если trades свежие (<30 мин) | ✅ |
| FIX 7 | Progress cache cleanup | При раннем возврате в top100/route.ts | ✅ |
| FIX 8 | HorizonStore polling | Throttle + exponential backoff + circuit breaker | ✅ |
| FIX 9 | Конвергенция при BSCI≈0 | BSCI < 0.15 → conv = 0/10 (не 5/10 из ниоткуда) | ✅ |
| FIX 10 | Радар BSCI ось | Jitter горизонтальный + ±20px drift limit + post-process инверсии | ✅ |

**Результат**: 77/100 тикеров с BSCI > 0 на выходных (было 0/100).

### ОСТАТОК СпРИНТА 4 (не блокирует Sprint 5)

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 4R-1 | Radar CumDelta=0 по центру | `absMaxCD = max(abs(minCD), abs(maxCD))` | ⬜ |
| 4R-2 | Нормализация 0.25→0.4 | В cross-section-normalize.ts | ⬜ |
| 4R-3 | Калибровка порогов | Замер BSCI/conv распределений при открытой сессии, скорректировать пороги | ⬜ |
| 4R-4 | Мёртвые тикеры persistent flag | Redis `horizon:excluded:{ticker}` при scores<0.15 на 3+ сканах | ⬜ |

### Формула уверенности (v4.1 — условное взвешивание BSCI)

```
bsci_weight = convergence >= 8 ? 20 : convergence < 5 ? 30 : 25;
confidence = BSCI(bsci_weight) + conv(25) + RSI/CRSI(20) + роботы(15) + дивергенция(15)

Дивергенция УСЛОВНАЯ:
  topDetector ≥ 0.85 → +15
  topDetector < 0.85 → −10
```

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

### Дедупликация сигналов (v4.1)

1. Тот же тикер + тот же direction + <TTL → ОБНОВИТЬ существующий сигнал
2. Тот же тикер + сменился direction → ЗАКРЫТЬ старый (reason: DIRECTION_CHANGE), создать новый
3. Тот же тикер + TTL истёк → ЗАКРЫТЬ (reason: EXPIRED), новый скан может создать новый

### Корреляция сигналов (v4.1)

```
interface Signal {
  correlatedWith?: string[];
  correlationType?: 'SAME_ISSUER' | 'SAME_SECTOR' | 'SAME_FUND';
}
```

Правила: SBER/SBERP → SAME_ISSUER; тикеры одного сектора с ENTANGLE>0.5 → SAME_SECTOR; ENTANGLE-флаг → SAME_FUND. В UI: бейдж "🔗 Связано с SBERP".

### FALSE_BREAKOUT градиент (v4.1)

```
price_reversion >= 0.7 && delta_flip → CONSUME (confidence_modifier = 1.0)
price_reversion >= 0.4 && < 0.7 && delta_flip → CONSUME (confidence_modifier = price_reversion)
price_reversion >= 0.4 && !delta_flip → CONSUME (confidence_modifier = price_reversion * 0.5)
price_reversion < 0.4 → FALSE_BREAKOUT
```

### Условия выхода (v4.1)

| Условие | Порог | Тип |
|---------|-------|-----|
| CumDelta упал >50% от пика | cumDelta < peakCumDelta × 0.5 | CUMDELTA_REVERSAL |
| CumDelta сменил знак на 3 свечах | sign(cumDelta) ≠ sign(prevCumDelta) × 3 | CUMDELTA_REVERSAL |
| BSCI drop >0.15 | bsci < bsciAtCreation - 0.15 | BSCI_DROP |
| VPIN резко вырос | vpin > prevVpin × 1.5 | VPIN_SPIKE |
| Цена < стоп-лосс | price < stopLoss | PRICE_STOP |
| PREDATOR FALSE_BREAKOUT | градиент: reversion<0.4 → FALSE_BREAKOUT; reversion≥0.4 → CONSUME | FALSE_BREAKOUT |

## Спринт 5: Калибровка + П2 структурные улучшения + Trade-based OFI

### 5A. Калибровка (3 уровня)

- [ ] Win rate по истории сигналов (через виртуальный P&L)
- [ ] ROC-анализ порогов + Youden's J
- [ ] Уровень 0: внутренняя консистентность (детектор vs свои данные)
- [ ] Уровень 1: детектор vs робот-данные
- [ ] Уровень 2: детектор vs робот-данные vs результат сигнала
- [ ] Адаптивные пороги: threshold = baseThreshold + volatilityAdjustment (VIX/RVI + среднерыночный BSCI)
- [ ] Динамическое окно верификации BSCI через ATR (из спецификации v4 п.7)

### 5B. П2 Структурные улучшения детекторов

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
| П2-9 | Сквозная | z-score нормализация в data pipeline для всех детекторов | ✅ РЕАЛИЗОВАНО |

### 5C. Trade-based OFI (✅ РЕАЛИЗОВАН — 3 детектора живы без orderbook)

> **Проблема**: OFI (Order Flow Imbalance) раньше считался ТОЛЬКО из orderbook.
> На выходных ISS возвращает HTML вместо orderbook, APIM/JWT ненадёжён.
> Без orderbook мёртвые: GRAVITON, DARKMATTER, и сам OFI.
> **Решение**: Trade-based OFI — вычисление OFI из потока сделок без orderbook.

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 5C-1 | Trade-based OFI алгоритм | calcTradeOFI(): BUYSELL классификация → ofi = (V_buy-V_sell)/(V_buy+V_sell). Weighted: time-decay exp(-α×age). Near-term: последние 50 сделок | ✅ |
| 5C-2 | Smart fallback логика | OB пустой → tradeOFI; stale+trades → tradeOFI; \|tradeOFI\|>0.001 но OB-OFI≈0 и trades≥10 → tradeOFI; иначе OB-OFI. ofiSource='trades'\|'orderbook' | ✅ |
| 5C-3 | Интеграция в collect-market-data | tradeOFI, ofiSource в DetectorInput. Детекторы автоматически используют лучший источник | ✅ |
| 5C-4 | Trade-based rtOFI | При пустом стакане: Δ(tradeOFI) между двумя окнами сделок (prev/cur halves) | ✅ |
| 5C-5 | UI: источник OFI | Показывать "OFI (trades)" vs "OFI (orderbook)" в карточке тикера | ⬜ |

### 5D. Валидация П2

| # | Задача | Описание |
|---|--------|----------|
| 5D-1 | Сравнение до/после П2 | Замер BSCI distribution до и после П2 правок → среднее должно сместиться ниже 0.50 |
| 5D-2 | Дискриминация детекторов | Для каждого детектора: скор на высоколиквидных vs низколиквидных |
| 5D-3 | Перекалибровка порогов сигналов | После П2 правок — заново замерить распределения и скорректировать пороги |

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
