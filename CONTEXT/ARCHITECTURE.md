# АРХИТЕКТУРА: Горизонт Событий

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
runAllDetectors(detectorInput)
   ├── GRAVITON     → DetectorResult { score, signal, confidence, metadata }
   ├── DARKMATTER   → DetectorResult
   ├── ACCRETOR     → DetectorResult
   ├── DECOHERENCE  → DetectorResult
   ├── HAWKING      → DetectorResult
   ├── PREDATOR     → DetectorResult
   ├── CIPHER       → DetectorResult
   ├── ENTANGLE     → DetectorResult
   ├── WAVEFUNCTION → DetectorResult
   └── ATTRACTOR    → DetectorResult
   │
   ▼
Cross-Section Normalization (Z-score по батчу)
   ├── crossSectionNormalize(allScores) → нормализованные DetectorResult[][]
   ├── computeCrossSectionStats() → Redis: horizon:cross-section:stats (TTL 2h)
   └── crossSectionNormalizeSingle() → для одиночных наблюдений vs кэш
   │
   ▼
calcBSCI(normalizedScores, weights)
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
   }
   │
   ▼
Сохранение:
   ├── Redis: horizon:scanner:latest (TTL 1h) / horizon:scanner:top100 (TTL 30min)
   ├── Redis: horizon:scanner:bsci:{ticker} (TTL 1h) — prev BSCI
   ├── Redis: horizon:cross-section:stats (TTL 2h) — z-score статистики
   └── PostgreSQL: bsci_log — батч-инсерт
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
| `horizon:cross-section:stats` | JSON | 2h | Z-score stats {mean, std} per detector |
| `horizon:observe:{ticker}` | JSON | 30m | Last observation per ticker |

### PostgreSQL (постоянное хранение)

| Таблица | Описание |
|---------|----------|
| `observations` | AI наблюдения: BSCI, direction, aiComment, slot, marketSnapshot |
| `detector_scores` | Детекторные скоры за наблюдение (1:many) |
| `bsci_log` | Лог BSCI: ticker, bsci, alertLevel, topDetector |
| `bsci_weights` | Адаптивные веса: detector, weight, accuracy, totalSignals |
| `reports` | Робот-отчёты: ticker, reportType, content, hint |

## BSCI Composite Index

```
BSCI = Σ(w_i × score_i) / Σ(w_i)

Alert Levels:
  GREEN  — BSCI < 0.3   (CALM)
  YELLOW — BSCI 0.3-0.5 (WATCH)
  ORANGE — BSCI 0.5-0.7 (WARNING)
  RED    — BSCI ≥ 0.7   (CRITICAL)

Direction (weighted vote):
  BULLISH if bullWeight > bearWeight × 1.3
  BEARISH if bearWeight > bullWeight × 1.3
  NEUTRAL otherwise

Weights:
  Default: 0.1 (equal, 10 detectors)
  Stored in: bsci_weights table
  Update: manual or calibration (Sprint 5)
```

## Cross-Section Normalization

```
ПРОБЛЕМА:
  ACCRETOR: 0.8-0.99 у 90% тикеров (шум)
  GRAVITON: 0.00 у 98% (мёртвый)
  → BSCI сжимается в 0.08-0.40

РЕШЕНИЕ:
  Для каждого детектора: z = (score - mean) / std
  normalized = clamp(0.5 + z × 0.25, 0, 1)

  z = 0 (среднее) → 0.5
  z = +2 (выброс) → 1.0
  z = -2 (выброс) → 0.0

РЕЗУЛЬТАТ:
  BSCI растягивается до 0.05-0.75
  Появляются ORANGE и RED тикеры

КЭШИРОВАНИЕ:
  Stats (mean, std) → Redis horizon:cross-section:stats (TTL 2h)
  Single-ticker normalization → crossSectionNormalizeSingle() vs кэш
```
