# ИНТЕГРАЦИЯ ДАННЫХ РОБОТОВ

> Статус: СПРОЕКТИРОВАН (не реализован)
> Приоритет: Спринт 3 (после TA-context)
> Предпосылка: Спринт 2.5 — реверс-инжиниринг дашборда роботов

## Концепция

```
ДАШБОРД (роботы) ──→ КОНТЕКСТ ──→ ГОРИЗОНТ СОБЫТИЙ
                         ↓
                    УСИЛЕНИЕ СИГНАЛОВ
```

Текущие детекторы (CIPHER, ACCRETOR, DARKMATTER) — это **гипотезы**.
Данные роботов — это **факты**.
Связка гипотеза + факт = **подтверждение**.

## Что брать из дашборда

| Поле | Тип | Описание |
|------|-----|----------|
| `robotVolumePct` | 0-100 | % объёма от роботов |
| `robotTypes` | string[] | Типы активных роботов (accumulator, momentum, iceberg, scalper, ...) |
| `robotImbalance` | -1..+1 | Роботы покупают (+) или продают (−) |
| `avgRobotOrderSize` | number | Средний размер заявки робота |
| `avgHumanOrderSize` | number | Средний размер заявки человека |

## Как использовать

### 1. Подтверждение детекторов

| Детектор | Робот-тип | Подтверждение |
|----------|-----------|---------------|
| CIPHER | Любой алгоритмический | ✅ Алгоритм подтверждён |
| ACCRETOR | accumulator-бот | ✅ Накопление подтверждено |
| DARKMATTER | iceberg-бот | ✅ Засада подтверждена |
| MOMENTUM | momentum-бот | ✅ Импульс подтверждён |
| HAWKING | scalper-бот | ✅ Всплеск подтверждён |

### 2. Усиление конвергенции

```
+1 балл к conv/10 если робот-данные подтверждают top-детектор
→ вместо 8/10 может быть 9/10 или 10/10
```

### 3. Повышение уверенности сигнала

```
+15% к confidence при полном робот-подтверждении
Graceful degradation: нет роботов → без бонуса (сигнал не умирает)
```

### 4. Критическая проверка (калибровка)

```
CIPHER 1.0 + Робот-объём 72% → ✅ детектор работает
CIPHER 1.0 + Робот-объём 12% → ⚠️ ложное срабатывание или человек имитирует
CIPHER 0.3 + Робот-объём 85% → 🐛 баг детектора
```

## RobotContext Model

```typescript
interface RobotContext {
  ticker: string;
  robotVolumePct: number;       // 0-100
  robotTypes: string[];         // ['accumulator', 'momentum', 'iceberg']
  robotImbalance: number;       // -1..+1 (покупают/продают)
  avgRobotOrderSize: number;
  avgHumanOrderSize: number;
  timestamp: Date;
}

function robotConfirmation(topDetector: string, robotCtx: RobotContext): number {
  // 0 = нет подтверждения, 1 = полное подтверждение
  const DETECTOR_ROBOT_MAP: Record<string, string[]> = {
    CIPHER: ['algorithmic'],
    ACCRETOR: ['accumulator', 'twap'],
    DARKMATTER: ['iceberg'],
    PREDATOR: ['momentum', 'aggressive'],
    HAWKING: ['scalper', 'hft'],
  };

  const expectedTypes = DETECTOR_ROBOT_MAP[topDetector] || [];
  const match = robotCtx.robotTypes.some(t => expectedTypes.includes(t));

  if (!match) return 0;
  if (robotCtx.robotVolumePct > 60) return 1.0;
  if (robotCtx.robotVolumePct > 30) return 0.7;
  return 0.3;
}
```

## API

```
GET /api/horizon/robot-context?ticker=MTLR
→ RobotContext | null (null если данных нет — graceful degradation)
```

## UI

В карточке тикера + в фрейме Сигналы:

```
🤖 РОБОТЫ: 62% объёма
▲ Покупают  ▼ Продают
Типы: 📊 накопитель  🎯 моментум

🔗 ПОДТВЕРЖДЕНИЕ:
ACCRETOR ✅ накопитель-бот активен
PREDATOR ✅ моментум-робот в деле
CIPHER  ✅ 62% алгоритмический объём
```

## Пример: с роботами vs без

```
БЕЗ роботов:
  MTLR: BSCI 0.63, conv 8/10, уверенность 82%

С роботами:
  MTLR: BSCI 0.63, conv 10/10, уверенность 94%
    + Робот-подтверждение: CIPHER ✅ (62% роботов)
    + Робот-подтверждение: ACCRETOR ✅ (accumulator-бот активен)
    + Робот-дисбаланс: +0.7 (роботы покупают)
    = УВЕРЕННОСТЬ 82% → 94%
```

## Спринт 2.5: Реверс-инжиниринг дашборда

**ПЕРЕД Спринтом 3** — 1 час на:

1. Прочитать код дашборда роботов
2. Найти Redis-ключи и формат данных
3. Определить частоту обновления
4. Задокументировать схему в этом файле

## Риски

1. **Зависимость от источника**: Если дашборд перестанет обновляться — graceful degradation
2. **Робот-классификатор может ошибаться**: Поэтому бонус ≤ 15%
3. **robotImbalance шумный**: Использовать rolling window 30-60 мин, не мгновенное значение
