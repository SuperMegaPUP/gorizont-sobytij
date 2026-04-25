# АРХИТЕКТУРА: Горизонт Событий

> Спецификация v4.1

## Пайплайн сканирования

```
МОEX API
   │
   ▼
collectMarketData(ticker)
   ├── Orderbook snapshot
   ├── Recent trades
   ├── OHLCV candles
   └── Market snapshot (mid, spread, RVI)
   │
   ▼
zScoreNormalize(features, window=100)  ← v4.1: сквозная нормализация (П2)
   ├── volume, trade_size, interval → нормализованы
   └── Критично для CIPHER, HAWKING, ACCRETOR
   │
   ▼
runAllDetectors(detectorInput)  ← v4.1: финальные формулы
   ├── GRAVITON     → центры масс + walls + 80% cutoff (П2)
   ├── DARKMATTER   → ΔH_norm + iceberg consecutive + MIN_ICEBERG_VOLUME (П1)
   ├── ACCRETOR     → DBSCAN + ATR-нормализация (П2)
   ├── DECOHERENCE  → символьный поток + tick_rule при ΔP=0 (П1)
   ├── HAWKING      → ACF + Welch при N≥100 + noise_ratio fix (П1)
   ├── PREDATOR     → 5 фаз + FALSE_BREAKOUT + estimated_stops (П2)
   ├── CIPHER       → PCA→ICA двухуровневый + z-score + condition number (П2)
   ├── ENTANGLE     → ADF-тест + Granger lag=3 (П2)
   ├── WAVEFUNCTION → particle filter + ресэмплинг + log-weights (П2)
   └── ATTRACTOR    → Takens + volume_profile + stickiness по spread (П2)
   │
   ▼
Cross-Section Normalization (Z-score по батчу)
   ├── crossSectionNormalize(allScores) → нормализованные DetectorResult[][]
   ├── computeCrossSectionStats() → Redis: horizon:cross-section:stats (TTL 2h)
   └── crossSectionNormalizeSingle() → для одиночных наблюдений vs кэш
   │
   ▼
calcBSCI(normalizedScores, weights)  ← v4.1: η=0.03, min_w=0.04
   ├── BSCI = Σ(w_i × score_i) / Σ(w_i)
   ├── Alert Level: GREEN / YELLOW / ORANGE / RED
   ├── Direction: BULLISH / BEARISH / NEUTRAL
   └── Top Detector
   │
   ▼
calculateTAIndicators(candles, trades, orderbook)
   ├── RSI(14) + zone
   ├── CMF(20) + zone
   ├── CRSI(3) + zone
   ├── ATR(14) + percentile + zone
   └── VWAP + deviation + zone
   │
   ▼
calculateSignalConvergence(bsciDirection, bsciScore, taIndicators)
   ├── Convergence Signal: STRONG_BULL / BULL / NEUTRAL / BEAR / STRONG_BEAR
   ├── Divergence flag: true/false
   ├── Divergence note: string
   └── Convergence strength: 0-1
   │
   ▼
calculateRobotContext(ticker, algopack, detectorScores, topDetector, bsci)
   ├── AlgoPack: стены, накопления, cancel ratio, спуфинг
   ├── Burst Detection: типы активных роботов
   ├── computeRobotConfirmation() → confirmation: 0.1-1.0
   ├── isRobotConfirmed() → порог 0.4
   └── DETECTOR_PATTERN_MAP + DETECTOR_ALGOPACK_MAP
   │
   ▼
calculateConvergenceScore(bsciDir, bsciScore, indicators, hasDivergence, atrCompressed, robotConfirmed, hasSpoofing, cancelRatio)
   ├── База: 5 индикаторов × 0-2 балла = 0-10
   ├── +1 дивергенция, +1 ATR-сжатие, +1 роботы
   ├── −2 СПУФИНГ, −1 cancel>80%
   └── score = clamp(totalPoints, 0, 10)
   │
   ▼
applyScannerRules(scannerInput)
   ├── 10 IF-THEN правил
   ├── Signal: PREDATOR_ACCUM, IMBALANCE_SPIKE, ...
   ├── Action: WATCH / ALERT / URGENT
   └── Quick Status: строка для UI
   │
   ▼
Результат:
   TickerScanResult {
     ticker, name, bsci, alertLevel, direction,
     detectorScores, keySignal, action, quickStatus,
     vpin, cumDelta, ofi, turnover, moexTurnover,
     type: FUTURE|STOCK,
     taContext: SignalConvergence,
     convergenceScore: ConvergenceScoreResult,
     robotContext: RobotContext,
   }
   │
   ▼
Сохранение:
   ├── Redis: horizon:scanner:latest (TTL 1h) / horizon:scanner:top100 (TTL 30min)
   ├── Redis: horizon:scanner:bsci:{ticker} (TTL 1h)
   ├── Redis: horizon:cross-section:stats (TTL 2h)
   ├── Redis: horizon:algopack:{ticker} (TTL 5m)
   └── PostgreSQL: bsci_log — батч-инсерт
```

## Signal Generator Pipeline (Sprint 4 — РЕАЛИЗОВАН)

```
TickerScanResult (из сканера)
   │
   ▼
signal-generator.ts
   ├── Проверка порогов: BSCI≥0.55 AND conv≥7 AND topDet≥0.75
   ├── Дедупликация: findActiveSignal(ticker, direction)
   ├── Если НЕ проходит → НЕТ сигнала (тишина)
   │
   ▼ (если проходит)
   level-calculator.ts
   ├── S/R за 30 свечей
   ├── estimated_stops(level) из PREDATOR
   ├── entryZone = [price ± 0.3×ATR]
   ├── stopLoss = nearest S/R ± 0.5×ATR
   └── T1/T2/T3 через ATR
   │
   ▼ (v4.1: условное взвешивание BSCI)
   bsci_weight = convergence >= 8 ? 20 : convergence < 5 ? 30 : 25
   confidence = BSCI(bsci_weight) + conv(25) + RSI/CRSI(20) + роботы(15) + дивергенция(15)
   │
   ▼
TradeSignal {
   type: LONG/SHORT/AWAIT/BREAKOUT,
   state: ACTIVE,
   wavefunction_state: ACCUMULATE/DISTRIBUTE/HOLD,
   TTL: calculateTTL(createdAt) — динамический по сессии МОЕКС,
   correlatedWith: [...],
   exitConditions: [...]
}
   │
   ▼
Сохранение:
   ├── Redis: horizon:signals:active (TTL = dynamic)
   ├── PostgreSQL: signals — постоянное хранение
   └── SignalSnapshot при каждой P&L проверке (~100/день)
```

## Виртуальный P&L (Sprint 4 — РЕАЛИЗОВАН)

```
Cron каждые 5 минут → checkActiveSignals()
   ├── Запрос текущей цены тикера
   ├── LONG: max(price)>=target → WIN; min(price)<=stop → LOSS; иначе EXPIRED
   ├── SHORT — зеркально
   ├── Дедупликация: обновить существующий вместо создания нового
   │
   ▼
Закрытие сигнала:
   ├── state → CLOSED
   ├── close_reason: TARGET | STOP | EXPIRED | DIRECTION_CHANGE
   ├── close_price, pnl_ticks
   └── result: WIN | LOSS | EXPIRED
   │
   ▼
SignalSnapshot (v4.1 — при каждой P&L проверке):
   ├── { timestamp, price, bsci, convergence, topDetector, topDetectorScore, pnl_unrealized, wavefunction_state }
   └── ~100 записей/день/тикер
   │
   ▼
SignalFeedbackStore → обратная связь:
   ├── WAVEFUNCTION: ACCUMULATE→WIN → +0.01 к переходу
   ├── BSCI: weekly win_rate → корректировка весов
   └── Минимум 30+ сигналов для корректировки
```

## AI Observer (6 раз/день)

```
Cron/Manual → generateObservation(ticker, slot?)
   ├── Slot auto-detect (MSK time):
   │   08:00 — Предрыночный скан
   │   10:30 — Утренний паттерн
   │   12:00 — Полуденной обзор
   │   15:00 — Предзакрытие
   │   17:00 — Вечерняя сессия
   │   20:00 — Итоги дня
   │
   ├── collectMarketData()
   ├── crossSectionNormalizeSingle() vs Redis cache
   ├── runAllDetectors()
   ├── calcBSCI()
   ├── AI Commentary (z-ai-web-dev-sdk, temperature=0.7, max_tokens=500)
   │   └── Fallback: auto-generated comment without AI
   └── saveObservation() → PG (Observation + DetectorScore) + Redis
```

## Хранилища данных

### Redis (горячий кэш)

| Ключ | Тип | TTL | Описание |
|------|-----|-----|----------|
| `horizon:scanner:latest` | JSON | 1h | Core 9 scanner results |
| `horizon:scanner:top100` | JSON | 30m | TOP-100 scanner results |
| `horizon:scanner:bsci:{ticker}` | String | 1h | Previous BSCI per ticker |
| `horizon:cross-section:stats` | JSON | 2h | Z-score stats per detector |
| `horizon:observe:{ticker}` | JSON | 30m | Last observation per ticker |
| `horizon:algopack:{ticker}` | JSON | 5m | AlgoPack data per ticker |
| `horizon:signals:active` | JSON | dynamic | Active trade signals (Sprint 4, TTL = calculateTTL) |

### PostgreSQL (постоянное хранение)

| Таблица | Описание |
|---------|----------|
| `observations` | AI наблюдения: BSCI, direction, aiComment, slot, marketSnapshot |
| `detector_scores` | Детекторные скоры за наблюдение (1:many) |
| `bsci_log` | Лог BSCI: ticker, bsci, alertLevel, topDetector |
| `bsci_weights` | Адаптивные веса: detector, weight, accuracy, totalSignals |
| `reports` | Робот-отчёты: ticker, reportType, content, hint |
| `signals` | Торговые сигналы + результат + виртуальный P&L (Sprint 4) |

## BSCI Composite Index (v4)

```
w_k(t) = w_k(t-1) + η × (S_k(t) - w_k(t-1)) × w_k(t-1)
η = 0.03 (снижено с 0.1)
min_w = 0.04 (повышено с 0.02)
Нормализация: Σ(w_k) = 1

П2: Daily weight decay = 0.99 × w + 0.01/K

Alert Levels:
  GREEN  — BSCI < 0.3
  YELLOW — BSCI 0.3-0.5
  ORANGE — BSCI 0.5-0.7
  RED    — BSCI ≥ 0.7

Direction: BULLISH / BEARISH / NEUTRAL (weighted vote)
```
