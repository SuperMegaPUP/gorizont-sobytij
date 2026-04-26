# ДЕПЛОЙ: Процедуры и доступы

> ВНИМАНИЕ: Git Integration webhook сломан. Деплой ТОЛЬКО через Vercel CLI.

## URL-адреса

| Среда | URL | Vercel Project |
|-------|-----|----------------|
| PROD | https://robot-detect-v3.vercel.app/ | robot-detect-v3 |
| LAB | https://robot-lab-v3.vercel.app/ | robot-lab-v3 |

## Токен Vercel

Хранится в двух местах:
1. `.env` — переменная `VERCEL_TOKEN`
2. `CONTEXT/TOKEN` — резервная копия (в .gitignore)

```bash
# Чтение токена:
TOKEN=$(grep VERCEL_TOKEN /home/z/my-project/.env | cut -d= -f2)
# ИЛИ
TOKEN=$(cat /home/z/my-project/CONTEXT/TOKEN)
```

## Деплой PROD

```bash
cd /home/z/my-project

# 1. Убедиться что проект слинкован на PROD
npx vercel link --yes --project=robot-detect-v3 --token $TOKEN

# 2. Деплой
npx vercel --prod --token $TOKEN --yes
```

## Деплой LAB

```bash
cd /home/z/my-project

# 1. Слинковать на LAB
npx vercel link --yes --project=robot-lab-v3 --token $TOKEN

# 2. Деплой
npx vercel --prod --token $TOKEN --yes

# 3. Вернуть линк на PROD (чтобы следующий деплой шёл в PROD)
npx vercel link --yes --project=robot-detect-v3 --token $TOKEN
```

## Полный деплой (PROD + LAB)

```bash
cd /home/z/my-project
TOKEN=$(grep VERCEL_TOKEN .env | cut -d= -f2)

# PROD
npx vercel --prod --token $TOKEN --yes

# LAB
npx vercel link --yes --project=robot-lab-v3 --token $TOKEN
npx vercel --prod --token $TOKEN --yes

# Вернуть линк на PROD
npx vercel link --yes --project=robot-detect-v3 --token $TOKEN
```

## Правила

1. **ВСЕГДА** катить и в PROD и в LAB
2. **НИКОГДА** не трогать PROD без явного запроса пользователя
3. Перед деплоем — проверить `npm run build` локально (177 тестов)
4. После деплоя — проверить URL в браузере
5. LAB деплой **меняет** `.vercel/project.json` — всегда возвращать линк на PROD

## Переменные окружения (Vercel)

| Переменная | Описание |
|-----------|----------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `POSTGRES_URL_NON_POOLING` | Direct connection |
| `REDIS_URL` | Upstash/Vercel KV Redis |
| `MOEX_JWT` | MOEX ISS API JWT-токен |
| `TINVEST_TOKEN` | Tinkoff Invest API токен |

## Проверка деплоя

```bash
# PROD
curl -s https://robot-detect-v3.vercel.app/ | head -5

# LAB
curl -s https://robot-lab-v3.vercel.app/ | head -5

# API health check
curl -s https://robot-detect-v3.vercel.app/api/horizon/scanner | head -20
```

## Vercel CLI полезные команды

```bash
# Версия
npx vercel --version

# Список деплоев
npx vercel ls --token $TOKEN

# Инспекция деплоя
npx vercel inspect <url> --token $TOKEN
```

## Известные проблемы

- Git Integration webhook сломан — push в main/lab не триггерит деплой
- VERCEL_TOKEN добавлен в GitHub Secrets, но не помогает
- Единственный рабочий способ — Vercel CLI с токеном
- `.vercel/project.json` перезаписывается при `vercel link` — после LAB деплоя нужно вернуть линк на PROD
