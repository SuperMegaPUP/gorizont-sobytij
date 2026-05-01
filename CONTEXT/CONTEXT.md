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
- Docker: `docker-compose.yml`, `docker-manager.sh`

---

## 5. DOCKER (ЛОКАЛЬНЫЙ ЗАПУСК)

### Контуры
| Контур | Порт | Назначение |
|--------|------|------------|
| dev | 3000 | Разработка, отладка |
| test | 3001 | Автотесты |
| acceptance | 3002 | Ручное тестирование перед Vercel |

### Управление
```bash
# Скрипт управления
./docker-manager.sh status        # Показать статус
./docker-manager.sh start dev     # Запустить dev
./docker-manager.sh start test   # Запустить test
./docker-manager.sh start acceptance # Запустить acceptance
./docker-manager.sh stop dev     # Остановить
./docker-manager.sh clean         # Остановить все

# Или через docker compose
docker compose -f docker-compose.yml up -d
docker ps
```

### Файлы
- `Dockerfile` — образ для Node.js 20 Alpine
- `docker-compose.yml` — 3 сервиса
- `.env.dev`, `.env.test`, `.env.acceptance` — переменные для каждого контура

### Локальные БД
| Сервис | Хост | Порт | БД | Пользователь |
|--------|------|------|-----|--------------|
| PostgreSQL | 192.168.122.3 | 5432 | horizon_db | horizon |
| Redis | 192.168.122.3 | 6379 | - | - |

Подключение: Prisma + Redis client работают внутри контейнеров через IP хоста.

---

## 6. АРХИТЕКТУРНЫЕ ПРОБЛЕМЫ (Анализ #3 - 01.05.2025)

### 🚨 КРИТИЧЕСКИЕ (7 штук, 35-50 часов)

| ID | Проблема | Решение | Приоритет |
|----|----------|----------|-----------|
| 🚨-1 | **Единая PostgreSQL на 3 контура** — риск контаминации данных | Создать 4 БД: horizon_dev, horizon_test, horizon_acceptance, horizon_prod_sync | **Срочно** |
| 🚨-2 | **Redis без аутентификации** — дыра в локальной сети | requirepass + bind 172.17.0.1 | **Срочно** |
| 🚨-3 | **Общий volume ./data** — конфликт параллельных записей | Разделить на ./data/{dev,test,acceptance} | **Срочно** |
| 🚨-4 | **Stateful Docker vs Stateless Vercel** — разное поведение EMA/окон | IStateStore интерфейс + 3 реализации (Redis/Upstash/Memory) | Deploy #5.5 |
| 🚨-5 | **Redis parity** — локальный Redis 7 vs Vercel KV (Upstash) | UpstashStateStore с Lua scripts | Deploy #5.5 |
| 🚨-6 | **PostgreSQL vs Neon** — ECONNRESET при cold start | withRetry wrapper + pgbouncer в connection string | Deploy #5.5 |
| 🚨-7 | **Cron на хосте vs Vercel Cron** — рассинхронизированные данные | Vercel Cron endpoint единым источником, локальный — только JSONL | Deploy #5.5 |

### ⚠️ ВЫСОКИЕ (6 штук, 12-18 часов)

| ID | Проблема | Решение |
|----|----------|---------|
| ⚠️-1 | Нет Prisma Migrations в пайплайне | Добавить в Dockerfile: `npx prisma migrate deploy` |
| ⚠️-2 | Нет /api/health эндпоинта | Создать health route с DB/Redis/MOEX checks |
| ⚠️-3 | Нет отката в deploy-pipeline.sh | Добавить trap cleanup + health gate |
| ⚠️-4 | Vercel Cron hard timeout (10/60 сек) | Timeout guard + chunking (2 cron по 50 тикеров) |
| ⚠️-5 | Shadow-gate не интегрирован в acceptance | Интегрировать в pipeline |
| ⚠️-6 | Нет cleanup cron для JSONL | Добавить в crontab: `find ... -mtime +20 -delete` |

### 🔶 СРЕДНИЕ (5 штук, 8-12 часов)

| ID | Проблема | Решение |
|----|----------|---------|
| 🔶-1 | Нет Config API / UI Control Panel интеграции | Redis seed + миграции config_history, experiments |
| 🔶-2 | Vercel Preview Deployments не используются для parity | Добавить parity-check этап |
| 🔶-3 | .env дублирование — 3 файла | .env.base + overlay (dev/test/acceptance) |
| 🔶-4 | Нет GitHub Actions CI | lint + typecheck + prisma validate + unit tests |
| 🔶-5 | Rollback стратегия отсутствует | 3 уровня: Config API kill / Vercel rollback / Git revert |

### 💡 НИЗКИЕ (4 штука, 8-10 часов)

| ID | Проблема | Решение |
|----|----------|---------|
| 💡-1 | Docker Compose не унифицирован | YAML anchors + profiles |
| 💡-2 | Нет BSCI HTML-дашборда | JSONL агрегатор |
| 💡-3 | Нет .env.example в git | Создать шаблон с placeholder'ами |
| 💡-4 | Vercel promote не автоматизирован | promote-to-prod.sh с gate-проверкой |

---

### 📅 ПЛАН ИСПРАВЛЕНИЙ

**Фаза 1 (немедленно, ~1 час):**
- 🚨-1: Создать 4 PostgreSQL БД
- 🚨-2: Redis requirepass
- 🚨-3: Разделить volume
- ⚠️-6: JSONL cleanup cron
- 💡-3: .env.example

**Фаза 2 (1 неделя, ~4 часа):**
- ⚠️-2: /api/health endpoint
- ⚠️-1: Prisma migrations в пайплайне
- ⚠️-3: deploy-pipeline.sh с rollback
- 🔶-3: .env.base + overlay

**Фаза 3 (2 недели, ~25 часов):**
- 🚨-4: IStateStore абстракция
- 🚨-5: UpstashStateStore
- 🚨-6: withRetry + Neon retry
- 🚨-7: Vercel Cron endpoint
- ⚠️-4: Timeout guard

**Фаза 4 (3 недели, ~10 часов):**
- ⚠️-5: Shadow-gate интеграция
- 🔶-5: Rollback стратегия
- 🔶-4: GitHub Actions CI

**Фаза 5 (4 недели, ~12 часов):**
- 🔶-2: Preview parity
- 🔶-1: Config API
- 💡-2: BSCI дашборд
- 💡-1: Docker profiles
- 💡-4: Vercel promote automation

---

### 🔄 DEPLOY STRATEGY: DEV → TEST → ACCEPTANCE → LAB → PROD

```
DEV (локально:3000) ──▶ TEST (локально:3001) ──▶ ACCEPTANCE (локально:3002)
        │                        │                        │
   npm run test:ci          docker build             full regression
   docker run (3000)        docker run (3001)         health check
   manual testing           API tests                 BSCI/PREDATOR metrics
                                                  │
                                                  ▼
                                           GitHub Push
                                                  │
                                                  ▼
                                    Vercel LAB (auto-deploy)
                                                  │
                                                  ▼
                                          Smoke tests + metrics
                                                  │
                                                  ▼
                                    Vercel PROD (promote)
```

---

## 7. ПОСЛЕДНИЕ ИЗМЕНЕНИЯ (конец сессии)

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
| 2026-04-30 | **Docker локально развёрнут** — 3 контура (dev/test/acceptance), порты 3000/3001/3002, docker-manager.sh |
| 2026-04-30 | **Локальные БД подняты** — PostgreSQL (192.168.122.3:5432, horizon_db) + Redis (192.168.122.3:6379), настроен listen_addresses='*', protected-mode=no |
| 2026-04-30 | **Анализ #3: Архитектурные проблемы** — 22 замечания (7🚨 + 6⚠️ + 5🔶 + 4💡), план исправлений на 5 фаз (~52 часа), стратегия деплоя DEV→TEST→ACCEPTANCE→LAB→PROD |
| 2026-04-30 | **Фаза 1 инфраструктуры выполнена** — 867caca (4 БД, Redis auth, volumes), d33c798 (/api/health, .env.example, cleanup cron) |
| 2026-04-30 | **Фаза 2 выполнена** — 0243c77 (IStateStore: Memory/Redis/Upstash, withRetry, Vercel Cron) |
| 2026-04-30 | **Фаза 3 выполнена** — 450fc9f, ab5d6cc (deploy-pipeline, CI, rollback, .env.base) |

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
- [ ] P0: INFRA — StateManager + Redis persistence (сохраняет EMA/окна между вызовами) ✅
- [x] P0: Q-0 — Shadow Mode Framework (валидация без влияния на алерты) ✅
- [x] P0: Q-10 — EMA-сглаживание PREDATOR (убирает стробирование 0↔0.88) ✅
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

