# ДЕПЛОЙ: Процедуры и доступы

> ВНИМАНИЕ: Git Integration webhook сломан. Деплой ТОЛЬКО через Vercel CLI.

## URL-адреса

| Среда | URL | Vercel Project ID |
|-------|-----|-------------------|
| PROD | https://robot-detect-v3.vercel.app/ | (в .vercel/project.json при деплое) |
| LAB | https://robot-lab-v3.vercel.app/ | (project linked) |

## Токен Vercel

> Хранится в `.env.local` (переменная `VERCEL_TOKEN`), НЕ коммитится в git.
> Также доступен в файле `/home/z/my-project/CONTEXT/TOKEN` (в .gitignore).

```bash
# Использование:
npx vercel --prod --token $VERCEL_TOKEN --yes
```

## Деплой LAB

```bash
cd /home/z/my-project
npx vercel --prod --token $VERCEL_TOKEN --yes
```

## Деплой PROD

PROD требует смены projectId в `.vercel/project.json`:

```bash
# 1. Прочитать текущий projectId
CURRENT_PROJECT_ID=$(cat /home/z/my-project/.vercel/project.json | python3 -c "import sys,json; print(json.load(sys.stdin)['projectId'])")

# 2. Заменить на PROD project ID
# PROD_PROJECT_ID = <узнать из Vercel dashboard или API>

# 3. Задеплоить
npx vercel --prod --token $VERCEL_TOKEN --yes

# 4. Вернуть оригинальный projectId
# (чтобы LAB деплой работал)
```

## Правила

1. **ВСЕГДА** катить и в PROD и в LAB
2. **НИКОГДА** не трогать PROD без явного запроса пользователя
3. Перед деплоем — проверить `npm run build` локально
4. После деплоя — проверить URL в браузере

## Переменные окружения (Vercel)

- `DATABASE_URL` — Neon PostgreSQL connection string
- `POSTGRES_URL_NON_POOLING` — Direct connection
- `REDIS_URL` — Upstash/Vercel KV Redis
- `VERCEL_TOKEN` — в GitHub Secrets (но webhook сломан)

## Vercel CLI

```bash
# Установка
npm i -g vercel

# Линковка проекта (один раз)
vercel link --project robot-lab-v3 --token TOKEN

# Деплой
npx vercel --prod --token TOKEN --yes

# Проверка
curl -s https://robot-lab-v3.vercel.app/ | head -20
```

## Известные проблемы

- Git Integration webhook сломан — push в main/lab не триггерит деплой
- VERCEL_TOKEN добавлен в GitHub Secrets, но не помогает
- Единственный рабочий способ — Vercel CLI с токеном
