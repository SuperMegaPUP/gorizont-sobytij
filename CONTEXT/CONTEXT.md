# 🤖 КОНТЕКСТ ПРОЕКТА: Robot Detector + Горизонт Событий

> Файл памяти AI между сессиями.
> Обновляется в конце каждой сессии.
> Версия контекста: 1.0.0
> Дата создания: 2026-04-27

---

## 1. ЧТО ЭТО ЗА ПРОЕКТ

**Robot Detector v3.2.1 + Горизонт Событий** — платформа детекции алгоритмической торговли на Московской бирже в реальном времени.

- **PROD:** https://robot-detect-v3.vercel.app
- **LAB:** https://robot-lab-v3.vercel.app
- **Репо:** https://github.com/SuperMegaPUP/gorizont-sobytij
- **Стек:** Next.js 16 + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui + Prisma + PostgreSQL + Redis + Vercel

### Две подсистемы:

| Подсистема | Описание | Статус |
|---|---|---|
| **Детектор Роботов** (оригинал) | Burst detection (HFT/ALGO/STRUCT), 13 паттернов, AlgoPack, FUTOI/SMI, Neuro Hint | ✅ Работает |
| **Горизонт Событий** (фаза 5) | 10 Black Star детекторов, BSCI Composite Index, AI Observer, торговые сигналы, виртуальный P&L | 🔄 Переход на v4.2 |

---

## 2. КРИТИЧЕСКИЕ ПАРАМЕТРЫ (НЕ МЕНЯТЬ БЕЗ СОГЛАСОВАНИЯ)

### BSCI
- η = 0.03
- min_w = 0.04
- Σw_k = 1

### Пороги сигналов
- BSCI ≥ 0.55
- convergence ≥ 7
- topDetector ≥ 0.75

### Детектор layers (TTL)
- MICRO: 60 мин (GRAVITON, DARKMATTER, DECOHERENCE, HAWKING)
- MESO: 240 мин (ACCRETOR, PREDATOR, ENTANGLE)
- MACRO: 1440 мин (ATTRACTOR, WAVEFUNCTION, CIPHER)

### MOEX API
- `reversed=1` — КРИТИЧЕСКИЙ параметр для trades.json
- MOEX JWT (не TOKEN!) в env

---

## 3. ТЕКУЩИЙ СПРИНТ

**Спринт 5 — ФИНАЛЬНЫЙ АКЦЕПТОВАННЫЙ ПЛАН v4.2**
- Дата акцепта: 2026-04-27
- Статус: В работе
- Покрытие кода: ~30✅ + 3⚠️ + 38❌ = 71 пункт
- Готово: DECOHERENCE, HAWKING, DARKMATTER, GRAVITON, PREDATOR v4.2
- В работе: ATTRACTOR / ENTANGLE / синтетические тесты (следующий шаг)

Полный план: `/CONTEXT/SPECS/v4.2.md`

---

## 4. АКТУАЛЬНАЯ СТРУКТУРА КОНТЕКСТА

Весь контекст проекта хранится строго в `/CONTEXT/`:

| Файл | Назначение |
|---|---|
| `CONTEXT.md` | Этот файл — память AI между сессиями |
| `VERSIONING.md` | SemVer, чек-листы, гарантии восстановимости |
| `HISTORY.md` | Хронологический лог всех сессий |
| `FEATURES.md` | Трекинг фич с ID, прогрессом, приоритетами |
| `ARCHITECTURE.md` | Концептуальная архитектура |
| `RITUALS.md` | 8 обязательных ритуалов |
| `WORKLOG.md` | Рабочий лог нашего общения с тобой |
| `SPECS/v4.2.md` | Полная спецификация v4.2 |

---

## 5. БЫСТРЫЕ ССЫЛКИ

- Спецификация v4.2: `SPECS/v4.2.md`
- Архитектура: `ARCHITECTURE.md`
- Фичи: `FEATURES.md`
- История: `HISTORY.md`
- Ритуалы: `RITUALS.md`
- Чеклист деплоя: `VERSIONING.md`
- Рабочий лог: `WORKLOG.md`

---

## 6. ПОСЛЕДНИЕ ИЗМЕНЕНИЯ (конец сессии)

| Дата | Что изменено |
|---|---|
| 2026-04-27 | Создана инфраструктура CONTEXT, сохранена спецификация v4.2 |
| 2026-04-28 | Deploy #4.1b: PREDATOR floor=0.012, priceStallFactor в metadata, 32/100, mean=0.16, BSCI=0.132 |
| 2026-04-28 | Deploy #4: PREDATOR stateless rewrite — 25/100, Mean 0.138, ALERTs 16, BSCI 0.128 |
| 2026-04-28 | Deploy #3.3: DECOHERENCE diagnostics - activeSymbols=13-15 для ликвидных, 55/100=0 для среднеликвидных |
| 2026-04-30 | Сессия: Deploy #5 (z-score normalization), откат из-за пережатия, Deploy LAB→PROD синхронизированы (SHA 1327daa), 9 коммитов запушено в origin/main |
| 2026-04-28 | Deploy #3.2: HAWKING calibration |
| 2026-04-28 | Deploy #3: HAWKING починен (48/100 > 0), PREDATOR/ATTRACTOR fallback на recentTrades, исправлены константы, добавлен metadataMap в API |
| 2026-04-29 | Deploy #3.1: Z-score baselines PoC + session context (7:00-18:50 MSK schedule) + marketClosed fix |
| 2026-04-29 | **Deploy #3.2: TOP100 unified** — единый moex-client, safeJsonFetch (APIM→ISS fallback), убран хардкод |
| 2026-04-29 | **Deploy #3.3: DECOHERENCE fix** — tick_rule fallback, symbol=0 валиден, soft weights, Miller-Madow сохранён |
| 2026-04-29 | **Тесты и CI/CD** — исправлены 10 падающих тестов (197 passed), настроены smoke-тесты (20 passed), обновлены DEPLOY.md, RITUALS.md, VERSIONING.md |
| 2026-04-29 | **HOTFIX v4: moex-client integration** — diag field добавлен в TickerScanResult, STALK metadata (stalkPhase, stalkTriggered, stalkRadius, distanceToStop, stalkProximity) |
| 2026-04-29 | **Deploy #4: PREDATOR STALK** — scale-invariant radius min(1.5*ATR_abs, 3% price), spread floor max(radius, 2*spread), plateau 33→24, BSCI 0.174→0.169 |
| 2026-04-30 | **v4.3-rev3 бэклог добавлен** — 18 задач в FEATURES.md (Sprint 7), TODO обновлён |

---

## 7. ТЕКУЩИЙ СТАТУС — ТЕСТЫ И CI/CD

| Метрика | Значение | Цель |
|---------|----------|------|
| Всего тестов | **197** ✅ | — |
| Passed | **197** ✅ | 100% |
| Smoke-тесты | **20** ✅ | — |
| Билд errors | **0** ✅ | 0 |
| Билд warnings | **0** ✅ | 0 |
| Деплой LAB | ✅ | robot-lab-v3.vercel.app |

### Команды перед деплоем (ЗАФИКСИРОВАНЫ В CONTEXT)

```bash
# 1. Тесты
npm run test:ci

# 2. Билд
rm -rf .next && npm run build

# 3. Деплой LAB (megasuperiluha-3731)
VERCEL_TOKEN=YOUR_TOKEN_HERE \
VERCEL_PROJECT_ID=prj_Hs520wEKU27KpsqTdqwHeK9ZVsVp \
VERCEL_ORG_ID=team_ZroUqWr5FNDvTY9ebB8JfI0f \
npx vercel deploy --prod --yes
```

| Метрика | Значение | Цель |
|---------|----------|------|
| BSCI mean | **0.169** ✅ | 0.05-0.20 |
| BSCI > 0 | **100/100** ✅ | 100 |
| PREDATOR > 0 | **45/100** | - |
| PREDATOR plateau 0.12-0.14 | **24/100** | <5 (was 33) |
| STALK triggered | **54/100** | - |
| DECOHERENCE > 0 | **59/100** ✅ | >15 |
| DECOHERENCE uniqueSymbols | **17** ✅ | ≥1 |

### Что сделано в последних коммитах:

**d5c704e (TOP100 unified):**
1. Создан `src/lib/moex/moex-client.ts` — единый клиент с safeJsonFetch
2. APIM → ISS fallback логика
3. Убран хардкод TOP100_TICKERS, fallback на 30 тикеров удалён
4. Turnover маппится из moexTurnover для UI
5. Force bypass в collect-market-data.ts
6. diag pipeline для диагностики

**ba2fb1e (DECOHERENCE fix):**
1. Исправлена генерация символов: volMag = max(1, log2(volume)) вместо log2(volume)
2. tick_rule fallback при ΔP=0 (Math.random при отсутствии tickRuleDirection)
3. Убран фильтр `if (symbol !== null)` — теперь symbol=0 валиден
4. Soft weights вместо hard returns: qualityWeight, activityWeight, sampleWeight, timeSpanWeight
5. Сохранена формула Miller-Madow + log2(7) floor
6. Расширены metadata для диагностики

### MOEX расписание (актуальное):
- Аукцион открытия: 6:50-6:59 (quality=0.3)
- Основная: 7:00-18:50 (quality=1.0)
- Клиринг: 14:00-14:05 и 19:00-19:05 (quality=0.2)
- Вечерняя: 19:05-23:50 (quality=1.0)
- Ночь: quality=0.15

### PREDATOR STALK (Deploy #4):
- Scale-invariant radius: `min(1.5 * ATR_abs, 3% price)` — NO /100 division!
- Spread floor: `max(radius, 2 * spread)` for microstructural noise filter
- Stop level: `midPrice - 2 * ATR` (proxy for support/resistance)
- STALK triggered: distanceToStop <= effectiveRadius
- Semantic proximity: `1 - distanceToStop/effectiveRadius` (1=close, 0=far)
- Metadata fields: stalkPhase, stalkTriggered, stalkRadius, distanceToStop, stalkProximity
- Result: Plateau reduced 33→24, BSCI stable at 0.169

### Статус: ✅ PRODUCTION-READY

### TODO:

#### v4.2 (Завершить):
- [x] Phase 3: синтетические тесты (F-1D)
- [x] Phase 3: Dynamic TTL (F-3A)
- [x] Phase 3: Confidence v4.2 (F-3B)

#### v4.3-rev3 (Новые):
- [ ] P0: INFRA — StateManager + Redis persistence (сохраняет EMA/окна между вызовами)
- [ ] P0: Q-0 — Shadow Mode Framework (валидация без влияния на алерты)
- [ ] P0: Q-10 — EMA-сглаживание PREDATOR (убирает стробирование 0↔0.88)
- [ ] P1: Q-1 — OFI/rtOFI detectPriceControl (выявляет фальшивые продажи/покупки)
- [ ] P1: Q-8 — SQUEEZE_ALERT + EMA(Cancel%) DROP (ловит разгрузку стакана перед импульсом)
- [ ] P1: Q-11 — ROTATION_DETECTOR (определяет перекладку позиции крупняка)
- [ ] P2: Q-9 — PRE_IMPULSE_SILENCE (TIER 1/2) (предупреждает о манипуляторе перед импульсом)
- [ ] P2: Q-12 — Algorithmic Reset (ловит сброс робота перед новым циклом)
- [ ] P2: CIPHER — Перцентильный CN-штраф (отсекает структурный шум PCA)
- [ ] P3: CONF — Confidence Multiplier (честная уверенность при HFT-войнах)
- [ ] P3: Q-4 — ICEBERG Direction (эвристика направления айсбергов)
- [ ] P3: Q-7 — DISTRIBUTION детектор (защищает розницу от Pump&Dump)
- [ ] P4: Q-2 — ACCRETOR калибровка порогов (эмпирическая шкала)
- [ ] P4: Q-3 — PHASE_SHIFT v2 (интеграция PREDATOR + Cancel%)
- [ ] P4: Q-5 — SPOOF модуль (aggressive vs passive спуфинг)
- [ ] P4: Q-6 — ENTANGLE soft p-value (уход от бинарности)
- [ ] BUG: A-3 — Volume Bug board fallback (исправление оборотов для TQPI/SMAL)

