# СПРИНТ-ПЛАН: Горизонт Событий

> Обновлён: 2026-04-26 (Спецификация v4)
> Текущий спринт: Спринт 4 (СИГНАЛЫ + П1 правки)

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
- [x] UI: робот-контекст + МАНИПУЛЯЦИЯ badge + СПОУФИНГ→СПУФИНГ
- [x] Деплой в PROD и LAB

## Спринт 4 (ТЕКУЩИЙ): СИГНАЛЫ + П1 правки

### Часть А: Сигналы (ядро Спринта 4)

| # | Компонент | Описание | Сложность |
|---|-----------|----------|-----------|
| 1 | `signal-generator.ts` | BSCI≥0.55 + conv≥7 + topDet≥0.75 → LONG/SHORT/AWAIT/BREAKOUT. TTL 4ч. Entry/Stop/Targets через ATR(14). Divergence условный | 🔴 |
| 2 | `level-calculator.ts` | S/R за 30 свечей + estimated_stops (volume_cluster + round_number + breakout_freq + VWAP_dist). Коэфф. 0.35/0.25/0.25/0.15 | 🟡 |
| 3 | `/api/horizon/signals` | GET активные + история по тикеру | 🟡 |
| 4 | `signal-store.ts` | Zustand store для UI | 🟢 |
| 5 | `SignalsFrame.tsx` | LONG/SHORT/AWAIT/BREAKOUT карточки + confidence breakdown | 🔴 |
| 6 | Exit conditions | CumDelta reversal + BSCI drop >0.15 + VPIN spike + PREDATOR FALSE_BREAKOUT | 🟡 |
| 7 | Feedback loop | Виртуальный P&L → SignalFeedbackStore → WIN/LOSS/EXPIRED → корректировка весов | 🟡 |
| 8 | SignalSnapshot | Сохранение снапшота при каждом скане (6/день) | 🟢 |

### Часть Б: П1 Правки детекторов (параллельно с Частью А)

| # | Правка | Что менять | Сложность |
|---|--------|-----------|-----------|
| П1-1 | DARKMATTER | iceberg consecutive + ΔH_norm + MIN_ICEBERG_VOLUME 0.5% + n≥3 + expected_entropy | 🟡 |
| П1-2 | DECOHERENCE | Символьный поток round(log2(vol)*dir) + tick_rule при ΔP=0 | 🟡 |
| П1-3 | HAWKING | Зафиксировать ACF + noise_ratio fix (median_psd) + N≥50 + Welch при N≥100 | 🟢 |
| П1-4 | BSCI | η=0.03 + min_w=0.04 | 🟢 |

### Виртуальный P&L (ключевая концепция Спринта 4)

У нас нет торгующих роботов. Обратная связь через виртуальный P&L:

```
Каждый ACTIVE сигнал:
  entry_price, stop_loss, target, TTL=4ч, direction

Фоновый процесс каждые 5 мин:
  LONG: max(price) >= target → WIN; min(price) <= stop → LOSS; иначе → EXPIRED
  SHORT — зеркально

SignalFeedbackStore → корректировка:
  WAVEFUNCTION: ACCUMULATE→LONG→WIN → +0.01; DISTRIBUTE→LONG→LOSS → -0.01
  BSCI: win_rate > 60% → увеличить вес; < 40% → уменьшить вес
  Только при выборке 30+ сигналов
```

### Формула уверенности (утверждена)

```
confidence = BSCI(25) + conv(25) + RSI/CRSI(20) + роботы(15) + дивергенция(15)
Дивергенция УСЛОВНАЯ:
  topDetector ≥ 0.85 → +15
  topDetector < 0.85 → −10
```

### Условия выхода (расширены для v4)

| Условие | Порог |
|---------|-------|
| CumDelta упал >50% от пика | CUMDELTA_REVERSAL |
| CumDelta сменил знак на 3 свечах | CUMDELTA_REVERSAL |
| BSCI drop >0.15 (было >0.3 до нового порога) | BSCI_DROP |
| VPIN резко вырос (>1.5x) | VPIN_SPIKE |
| Цена < стоп-лосс | PRICE_STOP |
| PREDATOR FALSE_BREAKOUT (price_reversion < 50% OR !delta_flip) | FALSE_BREAKOUT |

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
| П2-6 | PREDATOR | estimated_stops формула + FALSE_BREAKOUT фаза |
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

## Sprint mapping (из спецификации v4)

```
Sprint 4 (текущий): signal-generator + SignalsFrame + П1 + виртуальный P&L feedback store
Sprint 5: Калибровка + win rate + П2 + ROC-анализ порогов + Youden's J
Sprint 6+: П3 + обучение матриц + Hilbert + POC стопы + синтетические тесты + KL-divergence
```
