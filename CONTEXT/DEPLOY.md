# ДЕПЛОЙ: Процедуры и доступы

> Обновлён: 2026-04-26 (после HOTFIX v4.1.5)

## URL-адреса

| Среда | URL | Vercel Project | Project ID |
|-------|-----|----------------|------------|
| PROD | https://robot-detect-v3.vercel.app/ | robot-detect-v3 | prj_eHCVFpiI0gYHrfGNGuXdrUqJN3Bd |
| LAB | https://robot-lab-v3.vercel.app/ | robot-lab-v3 | prj_Hs520wEKU27KpsqTdqwHeK9ZVsVp |
| ❌ Удалить | https://my-project-phi-gray.vercel.app/ | my-project-phi-gray | — |

## Токен Vercel

Хранится в `.env` — переменная `VERCEL_TOKEN`.

**ВНИМАНИЕ:** Токен НЕ хранится в этом файле для безопасности (GitHub secret scanning).

## Деплой через Vercel CLI (ЕДИНСТВЕННЫЙ рабочий способ)

Git Integration webhook сломан — push НЕ триггерит автодеплой. Только CLI.

### Деплой PROD

```bash
cd /home/z/my-project

# Убедиться что проект слинкован на PROD
cat .vercel/project.json
# Должно быть: {"projectId":"prj_eHCVFpiI0gYHrfGNGuXdrUqJN3Bd",...,"projectName":"robot-detect-v3"}

# Если нет — переключить:
# echo '{"projectId":"prj_eHCVFpiI0gYHrfGNGuXdrUqJN3Bd","orgId":"team_ZroUqWr5FNDvTY9ebB8JfI0f","projectName":"robot-detect-v3"}' > .vercel/project.json

# Деплой
vercel deploy --prod --token $VERCEL_TOKEN --yes
```

### Деплой LAB

```bash
cd /home/z/my-project

# Переключить на LAB проект
echo '{"projectId":"prj_Hs520wEKU27KpsqTdqwHeK9ZVsVp","orgId":"team_ZroUqWr5FNDvTY9ebB8JfI0f","projectName":"robot-lab-v3"}' > .vercel/project.json

# Деплой
vercel deploy --prod --token $VERCEL_TOKEN --yes

# ОБЯЗАТЕЛЬНО: вернуть линк на PROD
echo '{"projectId":"prj_eHCVFpiI0gYHrfGNGuXdrUqJN3Bd","orgId":"team_ZroUqWr5FNDvTY9ebB8JfI0f","projectName":"robot-detect-v3"}' > .vercel/project.json
```

### Полный деплой (PROD + LAB)

```bash
cd /home/z/my-project

# 1. PROD
vercel deploy --prod --token $VERCEL_TOKEN --yes

# 2. LAB — переключить проект, задеплоить, вернуть PROD
echo '{"projectId":"prj_Hs520wEKU27KpsqTdqwHeK9ZVsVp","orgId":"team_ZroUqWr5FNDvTY9ebB8JfI0f","projectName":"robot-lab-v3"}' > .vercel/project.json
vercel deploy --prod --token $VERCEL_TOKEN --yes
echo '{"projectId":"prj_eHCVFpiI0gYHrfGNGuXdrUqJN3Bd","orgId":"team_ZroUqWr5FNDvTY9ebB8JfI0f","projectName":"robot-detect-v3"}' > .vercel/project.json
```

## Правила

1. **ВСЕГДА** катить и в PROD и в LAB
2. **НИКОГДА** не трогать PROD без явного запроса пользователя
3. Перед деплоем — проверить `npx next build` локально
4. После деплоя — проверить URL в браузере
5. LAB деплой **меняет** `.vercel/project.json` — **ВСЕГДА** возвращать линк на PROD
6. **НИКОГДА** не создавать новые Vercel проекты — только robot-detect-v3 и robot-lab-v3
7. Vercel CLI установлен глобально: `npm install -g vercel`
8. **`reversed=1`** — КРИТИЧЕСКИЙ параметр MOEX ISS. Никогда не убирать из trades.json URL!

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
# Список проектов
vercel projects list --token $VERCEL_TOKEN

# Список деплоев
vercel list --token $VERCEL_TOKEN

# Инспекция проекта
vercel projects inspect robot-detect-v3 --token $VERCEL_TOKEN
vercel projects inspect robot-lab-v3 --token $VERCEL_TOKEN
```

## Известные проблемы

- Git Integration webhook сломан — push в main/lab не триггерит деплой
- Единственный рабочий способ — Vercel CLI с токеном
- `.vercel/project.json` перезаписывается при переключении PROD/LAB — после LAB деплоя нужно вернуть линк на PROD
- Проект `my-project-phi-gray.vercel.app` нужно удалить — был создан по ошибке
