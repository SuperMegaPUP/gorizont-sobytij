# ИНТЕГРАЦИЯ ДАННЫХ РОБОТОВ

> Статус: РЕАЛИЗОВАН (Спринт 3)
> Файл: `src/lib/horizon/robot-context.ts`
> API: `GET /api/horizon/robot-context?ticker=SMLT`

## Концепция

```
АЛГОПАК (obstats + tradestats + orderstats) ──→ ROBOT CONTEXT ──→ КОНВЕРГЕНЦИЯ
                                                      ↓
                                              +1 робот-подтверждение
                                              −2 спуфинг-штраф
                                              −1 cancel>80% штраф
```

Детекторы (CIPHER, ACCRETOR, DARKMATTER) — это **гипотезы**.
Данные Алгопака — это **факты**.
Связка гипотеза + факт = **подтверждение**.

## Источники данных

### 1. AlgoPack (MOEX API)

| Данные | API | Что даёт |
|--------|-----|----------|
| obstats | `/api/horizon/moex-extended` | Стены (wall_score), дисбалансы (imbalance_vol), BBO proximity |
| tradestats | `/api/horizon/moex-extended` | Направленность (direction), DISB, средний объём сделки |
| orderstats | `/api/horizon/moex-extended` | Cancel ratio, спуфинг-детекция (cancelRatio > 70%) |

### 2. Burst Detection (detect-engine)

| Данные | Файл | Что даёт |
|--------|------|----------|
| Burst patterns | `detect-engine.ts` | Типы активных роботов (scalper, iceberg, momentum и др.) |
| Robot volume | aggregation | % объёма от роботов, направления, средний размер заявки |

## RobotContext Model

```typescript
interface RobotContext {
  ticker: string;
  robotVolumePct: number;        // 0-100 — % объёма от роботов
  wallScore: number;             // 0-100 — сила стены в стакане
  accumScore: number;            // 0-100 — сила накопления
  cancelRatio: number;           // 0-1 — доля отменённых ордеров
  spreadBBO: number;             // Спред на лучшей цене
  imbalanceVol: number;          // -1..+1 — дисбаланс объёма
  accumDirection: 'LONG' | 'SHORT' | 'NEUTRAL';  // Направление накопления
  hasSpoofing: boolean;          // Спуфинг (cancelRatio > 70% + в spoofingTickers)
  patterns: RobotPatternInfo[];  // Детектированные паттерны
  algopackMatch: AlgoPackConfirmation | null;  // Подтверждение через Алгопак
  burstSummary: BurstSummary;    // Сводка burst-детекции
}
```

## DETECTOR_PATTERN_MAP: Детектор ↔ Робот-паттерн

Прямой маппинг (10 детекторов → 11 робот-паттернов):

| Детектор | Робот-паттерны | Логика связи |
|----------|---------------|--------------|
| GRAVITON | market_maker, absorber, iceberg | Гравитация = крупный игрок держит уровень |
| DARKMATTER | iceberg, absorber | Скрытая ликвидность = айсберг-бот |
| ACCRETOR | accumulator, slow_grinder | Аккреция = медленное накопление |
| DECOHERENCE | aggressive, momentum, scalper | Расхождение = агрессивный вход |
| HAWKING | scalper, hft, market_maker | Выброс = HFT/скальперы |
| PREDATOR | aggressive, momentum, sweeper | Хищник = агрессивный маркет-ордер |
| CIPHER | periodic, fixed_volume, layered | Шифр = алгоритмический паттерн |
| ENTANGLE | ping_pong, periodic, market_maker | Запутанность = кросс-тикерная алгоритмика |
| WAVEFUNCTION | periodic, ping_pong, market_maker | Волновая = циклический алгоритм |
| ATTRACTOR | slow_grinder, absorber, iceberg | Аттрактор = стена = крупный игрок |

**PartialMatch** (косвенный маппинг): Если паттерн робота мэтчится с ЛЮБЫМ детектором через обратный маппинг, даётся частичное подтверждение (×0.5).

## AlgoPack Confirmation

Для детекторов с прямыми AlgoPack-индикаторами:

| Детектор | AlgoPack индикатор | Условие |
|----------|--------------------|---------|
| ATTRACTOR | wall_score ≥ 30 | Стена в стакане подтверждает аттрактор |
| ACCRETOR | accumulation_score ≥ 20 | Накопление подтверждает аккрецию |
| GRAVITON | wall_score ≥ 20 | Стена подтверждает гравитацию |
| DARKMATTER | wall_score + high cancel | Скрытая ликвидность + айсберг |

Для PREDATOR, HAWKING, CIPHER, WAVEFUNCTION, DECOHERENCE, ENTANGLE — только burst-based подтверждение (нет прямого AlgoPack-индикатора).

## computeRobotConfirmation()

```typescript
function computeRobotConfirmation(
  topDetector: string,
  robotContext: RobotContext
): number {
  // Базовая оценка 0.1 (всегда есть минимум)
  let confirmation = 0.1;

  // 1. TypeMatch: топ-детектор ↔ паттерны роботов (прямой маппинг)
  if (typeMatch) confirmation += 0.35;

  // 2. PartialMatch: обратный маппинг (косвенный)
  if (partialMatch && !typeMatch) confirmation += 0.15;

  // 3. Robot volume boost
  if (robotVolumePct > 60) confirmation += 0.25;
  else if (robotVolumePct > 30) confirmation += 0.15;

  // 4. AlgoPack confirmation (wall/accum match)
  if (algopackMatch) confirmation += 0.2;

  // Cap at 1.0
  return Math.min(confirmation, 1.0);
}
```

**Пример**: ATTRACTOR + wall:30.5 + accum:4.2 → confirmation = 0.50

## isRobotConfirmed()

```typescript
function isRobotConfirmed(robotContext: RobotContext): boolean {
  return robotContext.confirmation >= 0.4;  // Порог снижен с 0.5 → 0.4
}
```

| confirmation | UI статус |
|-------------|-----------|
| ≥ 0.4 | △ Частично / ✅ Подтверждено |
| < 0.4 | ✗ Слабо |

## Влияние на конвергенцию

| Фактор | Балл | Условие |
|--------|------|---------|
| Робот-подтверждение | +1 | `isRobotConfirmed() === true` |
| Спуфинг | −2 | `hasSpoofing === true` (cancelRatio > 70%) |
| Cancel > 80% | −1 | `cancelRatio > 0.8` |

**Пример расчёта**: SMLT
- База: 4/10 (RSI=1, CMF=0, CRSI=2, VWAP=0, ATR=1)
- +1 роботы (△ Частично, confirmation=0.50)
- −2 СПУФИНГ (hasSpoofing=true)
- −1 cancel>80% (cancelRatio=0.91)
- **Итого: 2/10** → 🚫 МАНИПУЛЯЦИЯ

## UI: Карточка тикера (TickerModal)

Секция "🤖 Робот-контекст":
```
Робот %: 54%
Стена: 31
Накопл.: 4
Cancel%: 91%
Дисбаланс: — нейтрально | Накопл. SHORT | ⚠ СПУФИНГ
Детектор ↔ Робот-паттерн:
  ATTRACTOR ↔ wall:30.5+accum:4.2 (confirmation: 0.50)
```

Action badge при спуфинге:
- ALERT + spoofingPenalty + conv≤2 → `🚫 МАНИПУЛЯЦИЯ` (красный)
- Обычный ALERT → `⚠️ ВНИМАНИЕ` (оранжевый)
- URGENT → `🚨 СРОЧНО` (красный)

## UI: Сканер (ScannerFrame)

ConvergenceCell — компактная ячейка:
- 🤖 — робот-подтверждение (+1)
- 🚫 — спуфинг-штраф (−2)
- ⚠ — cancel>80% (−1)

## Кэширование

AlgoPack данные кэшируются в Redis:
- Ключ: `horizon:algopack:{ticker}`
- TTL: 5 минут
- Обновление: при каждом скане тикера
