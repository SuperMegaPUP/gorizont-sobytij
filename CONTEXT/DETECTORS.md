# ДЕТЕКТОРЫ: 10 Black Star детекторов аномалий

## Типы

```typescript
interface DetectorResult {
  detector: string;           // Имя (GRAVITON, DARKMATTER, ...)
  description: string;        // Описание на русском
  score: number;              // 0..1 — сила сигнала
  confidence: number;         // 0..1 — уверенность
  signal: DetectorSignal;     // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  metadata: Record<string, number | string | boolean>;
}
```

## Входные данные

```typescript
interface DetectorInput {
  ticker: string;
  orderbook: OrderBookData;
  orderbookPrev?: OrderBookSnapshot;
  trades: Trade[];
  recentTrades: Trade[];
  ofi: number;
  weightedOFI: number;
  cumDelta: CumDeltaResult;
  vpin: VPINResult;
  prices: number[];
  volumes: number[];
  candles: Candle[];
  crossTickers?: Record<string, { priceChange: number; ofi: number }>;
  rvi?: number;
}
```

## Все 10 детекторов

| # | Имя | Файл | Что ищет | Ключевые входы |
|---|-----|------|----------|----------------|
| 1 | GRAVITON | graviton.ts | Гравитационная линза — ценовое притяжение к уровню | prices, volumes, orderbook |
| 2 | DARKMATTER | darkmatter.ts | Тёмная материя — скрытая ликвидность (айсберги) | orderbook, trades, vpin |
| 3 | ACCRETOR | accretor.ts | Аккреция — мелкое консистентное накопление | trades, cumDelta, volumes |
| 4 | DECOHERENCE | decoherence.ts | Декогеренция — расхождение цены и объёма | prices, cumDelta, ofi |
| 5 | HAWKING | hawking.ts | Излучение Хокинга — резкий выброс активности | trades, volumes, ofi |
| 6 | PREDATOR | predator.ts | Хищник — агрессия крупного игрока | trades, cumDelta, orderbook |
| 7 | CIPHER | cipher.ts | Шифр — алгоритмический паттерн | trades (timing, size pattern) |
| 8 | ENTANGLE | entangle.ts | Запутанность — корреляция с другими тикерами | crossTickers, prices |
| 9 | WAVEFUNCTION | wavefunction.ts | Волновая функция — осцилляция цены/объёма | prices, volumes, candles |
| 10 | ATTRACTOR | attractor.ts | Аттрактор — стена в стакане | orderbook (bid/ask walls) |

## Регистрация

```typescript
// registry.ts
const ALL_DETECTORS = [
  { name: 'GRAVITON',     detect: detectGraviton },
  { name: 'DARKMATTER',   detect: detectDarkmatter },
  { name: 'ACCRETOR',     detect: detectAccretor },
  { name: 'DECOHERENCE',  detect: detectDecoherence },
  { name: 'HAWKING',      detect: detectHawking },
  { name: 'PREDATOR',     detect: detectPredator },
  { name: 'CIPHER',       detect: detectCipher },
  { name: 'ENTANGLE',     detect: detectEntangle },
  { name: 'WAVEFUNCTION', detect: detectWavefunction },
  { name: 'ATTRACTOR',    detect: detectAttractor },
];
```

## Scanner Rules (10 IF-THEN)

| # | Условие | Сигнал | Action |
|---|---------|--------|--------|
| 1 | BSCI>0.7 + PREDATOR top | PREDATOR_ACCUM | URGENT |
| 2 | BSCI>0.5 + \|OFI\|>2x + DECOHERENCE>0.4 | IMBALANCE_SPIKE | ALERT |
| 3 | BSCI<0.2 + turnover↓ + VPIN↑ | LOW_LIQUIDITY_TRAP | WATCH |
| 4 | BSCI 0.4-0.7 + HAWKING>0.5 | BREAKOUT_IMMINENT | ALERT |
| 5 | direction=BEAR + cumDelta<0 | BEARISH_DIVERGENCE | ALERT |
| 6 | direction=BULL + cumDelta>0 | BULLISH_DIVERGENCE | ALERT |
| 7 | CIPHER>0.6 + ACCRETOR>0.4 | SMART_MONEY_ACCUM | ALERT |
| 8 | ENTANGLE>0.5 | INDEPENDENT_MOVE | WATCH |
| 9 | VPIN>0.7 + DARKMATTER>0.5 | INFORMED_TRADING | ALERT |
| 10 | prevBsci - bsci > 0.3 | SIGNAL_FADE | WATCH |

## Детектор ↔ Робот-паттерн (DETECTOR_PATTERN_MAP)

Каждый детектор привязан к робот-паттернам для подтверждения сигналов:

| Детектор | Робот-паттерны | AlgoPack |
|----------|---------------|----------|
| GRAVITON | market_maker, absorber, iceberg | wall_score |
| DARKMATTER | iceberg, absorber | wall_score + cancel |
| ACCRETOR | accumulator, slow_grinder | accumulation_score |
| DECOHERENCE | aggressive, momentum, scalper | — |
| HAWKING | scalper, hft, market_maker | — |
| PREDATOR | aggressive, momentum, sweeper | — |
| CIPHER | periodic, fixed_volume, layered | — |
| ENTANGLE | ping_pong, periodic, market_maker | — |
| WAVEFUNCTION | periodic, ping_pong, market_maker | — |
| ATTRACTOR | slow_grinder, absorber, iceberg | wall_score + accumulation_score |

Подробности → ROBOT-INTEGRATION.md

## Состояние и известные проблемы

- **ACCRETOR**: До нормализации давал 0.8-0.99 для 90% тикеров (шум). После cross-section norm — дискриминирует
- **GRAVITON**: Часто 0.00 — "мёртвый" детектор. Z-score нормализация вытягивает
- **ATTRACTOR**: На тикерах с нулевым оборотом (SGZH) давал ложные 0.70 → решается Уровнем 0 (внутренняя консистентность)
- **Все 10 детекторов**: Теперь имеют маппинг на робот-паттерны (Спринт 3) → см. DETECTOR_PATTERN_MAP
