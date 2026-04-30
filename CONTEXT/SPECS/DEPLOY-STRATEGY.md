# 📋 СТРАТЕГИЯ ДЕПЛОЯ: Локальный стенд → Vercel

Версия: 1.0
Дата: 2026-04-30
Статус: Планирование

---

## 1. ЛОКАЛЬНЫЙ СТЕНД

### 1.1 Инфраструктура

```
┌─────────────────────────────────────────────────────────────┐
│                     ХОСТ (192.168.122.3)                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────────────────────────┐  │
│  │   Docker     │    │   PostgreSQL 16 (5432)           │  │
│  │   Network    │───▶│   - horizon_dev                  │  │
│  │   172.17.0.x │    │   - horizon_test                 │  │
│  │              │    │   - horizon_acceptance           │  │
│  └──────────────┘    │   - horizon_prod_sync             │  │
│                      └──────────────────────────────────┘  │
│  ┌──────────────┐    ┌──────────────────────────────────┐  │
│  │ horizon-dev  │    │   Redis 7 (6379)                 │  │
│  │   :3000      │    │   - requirepass                  │  │
│  └──────────────┘    │   - bind 172.17.0.1              │  │
│                      └──────────────────────────────────┘  │
│  ┌──────────────┐    ┌──────────────────────────────────┐  │
│  │ horizon-test │    │   Cron (detailed_monitor.sh)   │  │
│  │   :3001      │    │   - 100 тикеров                 │  │
│  └──────────────┘    │   - 5MB сплит                   │  │
│                      └──────────────────────────────────┘  │
│  ┌──────────────┐    ┌──────────────────────────────────┐  │
│  │horizon-accpt │    │   ./data/{dev,test,acceptance}  │  │
│  │   :3002      │    │   - изолированные volume        │  │
│  └──────────────┘    └──────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Контуры

| Контур | Порт | БД | Volume | Назначение |
|--------|------|-----|--------|------------|
| dev | 3000 | horizon_dev | ./data/dev | Разработка |
| test | 3001 | horizon_test | ./data/test | Автотесты |
| acceptance | 3002 | horizon_acceptance | ./data/acceptance | Pre-prod валидация |

### 1.3 Управление

```bash
# Скрипт
./docker-manager.sh status
./docker-manager.sh start dev|test|acceptance

# Docker Compose
docker compose up -d
docker compose logs -f dev
```

---

## 2. DEPLOY PIPELINE

### 2.1 Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    CI/CD PIPELINE                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────┐    ┌────────┐    ┌───────────┐    ┌──────────┐  │
│  │  DEV   │───▶│  TEST  │───▶│ACCEPTANCE  │───▶│   LAB    │───▶PROD
│  │локально│    │локально│    │локально    │    │ Vercel   │   │
│  └────────┘    └────────┘    └───────────┘    └──────────┘  │
│      │             │              │               │           │
│      ▼             ▼              ▼               ▼           │
│  1. test:ci   1. build     1. full         1. Git push        │
│  2. docker    2. docker    2. health      2. Vercel          │
│  3. manual    3. curl      3. BSCI        3. smoke           │
│               4. API       4. PREDATOR    4. metrics         │
│                            5. Git push                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Этапы

#### ЭТАП 1: DEV (localhost:3000)
```bash
# 1. Тесты
npm run test:ci

# 2. Билд
docker build -t gorizont-sobytij:dev .

# 3. Запуск
docker run -d -p 3000:3000 --name horizon-dev --env-file .env.dev gorizont-sobytij:dev

# 4. Ручное тестирование
curl http://localhost:3000/api/horizon/observations
```

#### ЭТАП 2: TEST (localhost:3001)
```bash
# 1. Собрать образ
docker build -t gorizont-sobytij:test .

# 2. Запустить
docker run -d -p 3001:3000 --name horizon-test --env-file .env.test gorizont-sobytij:test

# 3. API тесты
curl http://localhost:3001/api/horizon/observations
```

#### ЭТАП 3: ACCEPTANCE (localhost:3002)
```bash
# 1. Health check
for i in {1..30}; do
  curl -sf http://localhost:3002/api/health && break
  sleep 2
done

# 2. Метрики
curl http://localhost:3002/api/horizon/observations | jq '.observations | length'

# 3. Push в Git
git add . && git commit -m "Deploy: $COMMIT_MSG" && git push
```

#### ЭТАП 4: Vercel LAB
```bash
# Автоматический деплой при push в main
# URL: https://robot-lab-v3.vercel.app

# Проверка
curl https://robot-lab-v3.vercel.app/api/health
curl https://robot-lab-v3.vercel.app/api/horizon/observations
```

#### ЭТАП 5: Vercel PROD
```bash
# Вариант 1: Dashboard promote
# Vercel Dashboard → Production Deployments → Promote

# Вариант 2: CLI
VERCEL_TOKEN=xxx VERCEL_PROJECT_ID=xxx VERCEL_ORG_ID=xxx \
npx vercel deploy --prod --yes
```

---

## 3. ПЛАН ИСПРАВЛЕНИЙ

### Фаза 1: Немедленно (~1 час)

| ID | Задача | Команда |
|----|--------|---------|
| 🚨-1 | Создать 4 БД PostgreSQL | `CREATE DATABASE horizon_dev/test/acceptance/prod_sync` |
| 🚨-2 | Redis requirepass | `sed -i 's/# requirepass/requirepass .../' redis.conf` |
| 🚨-3 | Разделить volume | `volumes: ./data/${NODE_ENV}:/app/data` |
| ⚠️-6 | cleanup cron | `find ... -mtime +20 -delete` в crontab |
| 💡-3 | .env.example | Создать шаблон с placeholder'ами |

### Фаза 2: 1 неделя (~4 часа)

| ID | Задача |
|----|--------|
| ⚠️-2 | /api/health endpoint с DB/Redis/MOEX checks |
| ⚠️-1 | prisma migrate deploy в Dockerfile |
| ⚠️-3 | deploy-pipeline.sh с rollback |
| 🔶-3 | .env.base + overlay |

### Фаза 3: 2 недели (~25 часов)

| ID | Задача |
|----|--------|
| 🚨-4 | IStateStore интерфейс (src/lib/horizon/state/) |
| 🚨-5 | UpstashStateStore с Lua scripts |
| 🚨-6 | withRetry wrapper + Neon retry |
| 🚨-7 | Vercel Cron /api/horizon/collect endpoint |
| ⚠️-4 | Timeout guard в collect |

### Фаза 4: 3 недели (~10 часов)

| ID | Задача |
|----|--------|
| ⚠️-5 | Shadow-gate /api/horizon/shadow/status |
| 🔶-5 | Rollback стратегия (3 уровня) |
| 🔶-4 | GitHub Actions CI |

### Фаза 5: 4 недели (~12 часов)

| ID | Задача |
|----|--------|
| 🔶-2 | Vercel Preview parity |
| 🔶-1 | Config API |
| 💡-2 | BSCI дашборд |
| 💡-1 | Docker profiles |
| 💡-4 | promote-to-prod.sh |

---

## 4. BACKLOG V4.3-REV3 (Связанные задачи)

- P0: INFRA — StateManager + Redis persistence (связано с 🚨-4)
- P0: Q-0 — Shadow Mode Framework (связано с ⚠️-5)
- P0: Q-10 — EMA-сглаживание PREDATOR (связано с 🚨-4)

---

## 5. VERCEL vs ЛОКАЛЬНО

| Параметр | DEV/TEST/ACCEPTANCE | Vercel LAB/PROD |
|----------|---------------------|-----------------|
| PostgreSQL | 192.168.122.3:5432 (локальный) | Neon (облачный) |
| Redis | 192.168.122.3:6379 (локальный) | Vercel KV / Upstash |
| Runtime | Постоянный (Docker) | Serverless (функции) |
| State | Stateful (EMA в памяти) | Stateless (восстановление из Redis) |
| Cron | Хост (crontab) | Vercel Cron |
| Logs | Docker logs | Vercel dashboard |

---

## 6. ROLLBACK СТРАТЕГИЯ

| Уровень | Когда | Команда |
|---------|-------|---------|
| Config API Kill | Один детектора сбоит | `curl -X PUT /api/horizon/config/freeze` |
| Vercel Instant | Весь деплой сломан | `npx vercel rollback --prod` |
| Git Revert | Нужен перманентный откат | `git revert && git push` |

---

## 7. МЕТРИКИ ДЛЯ ВАЛИДАЦИИ

| Метрика | Целевое значение | Проверка |
|---------|------------------|-----------|
| BSCI mean | 0.05-0.20 | API /api/horizon/observations |
| BSCI > 0 | 100/100 | API /api/horizon/bsci-history |
| PREDATOR > 0 | >40/100 | API /api/horizon/observations |
| DECOHERENCE > 0 | >15/100 | API /api/horizon/observations |
| Health /api/health | ok | `curl /api/health` |

---

## 8. ССЫЛКИ

- CONTEXT: `/CONTEXT/CONTEXT.md` (секция "6. АРХИТЕКТУРНЫЕ ПРОБЛЕМЫ")
- WORKLOG: `/CONTEXT/WORKLOG.md`
- Docker: `docker-compose.yml`, `docker-manager.sh`