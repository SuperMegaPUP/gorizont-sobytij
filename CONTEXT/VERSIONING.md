# 📜 КОНСТИТУЦИЯ ВЕРСИОННОСТИ

> SemVer, чек-листы, гарантии восстановимости
> Версия документа: 1.0.0

---

## 1. СХЕМА ВЕРСИОНИРОВАНИЯ (SemVer)

```
MAJOR.MINOR.PATCH
```

| Компонент | Когда бампим |
|---|---|
| **MAJOR** | Ломающие изменения API, новая архитектура, сброс BSCI весов |
| **MINOR** | Новые фичи, новые детекторы, новые фреймы UI |
| **PATCH** | Багфиксы, хотфиксы, калибровка порогов, оптимизация |

### Текущие версии
| Система | Версия | Последний релиз |
|---|---|---|
| Robot Detector (проект) | 3.2.1 | — |
| Горизонт Событий (подсистема) | v4.2 | В работе |
| Спецификация детекторов | v4.2 | 2026-04-27 |
| CONTEXT инфраструктура | 1.0.0 | 2026-04-27 |

---

## 2. ВЕТВЛЕНИЕ И КОММИТЫ

### Branch naming
```
feat/<name>     — новая фича
fix/<name>      — багфикс
hotfix/<name>   — срочный хотфикс
refactor/<name> — рефакторинг
spec/<name>     — изменение спецификации
infra/<name>    — инфраструктура
```

### Commit convention
```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `hotfix`, `refactor`, `test`, `docs`, `infra`, `chore`

Примеры:
```
feat(graviton): add ATR-normalized separation scoring
fix(hawking): correct noise_ratio bandwidth calculation
hotfix(bsci): emergency revert η to 0.03
refactor(detectors): extract clampScore to guards.ts
```

---

## 3. ЧЕК-ЛИСТ ДЕПЛОЯ (Pre-Deploy)

### Обязательный порядок
- [ ] 1. Все тесты проходят: `npm run test:ci`
- [ ] 2. Линт чистый: `npm run lint`
- [ ] 3. Билд успешен: `npx next build`
- [ ] 4. PROD деплой через Vercel CLI
- [ ] 5. LAB деплой через Vercel CLI
- [ ] 6. Smoke-test PROD: `curl -s https://robot-detect-v3.vercel.app/ | head -5`
- [ ] 7. Smoke-test LAB: `curl -s https://robot-lab-v3.vercel.app/ | head -5`
- [ ] 8. Проверить API health: `/api/horizon/scanner`
- [ ] 9. Обновить HISTORY.md
- [ ] 10. Обновить WORKLOG.md

### GitHub CI/CD Pipeline
- Test job: lint + test + coverage
- Deploy-LAB: после test, только на push в main
- Deploy-PROD: после deploy-LAB + smoke-test
- Environments: `lab` и `production` с protection rules

---

## 4. ГАРАНТИИ ВОССТАНОВИМОСТИ

### Что нужно для восстановления с нуля
1. **Код:** GitHub repo + `.env` переменные (хранятся у владельца)
2. **БД:** PostgreSQL (Neon) — бэкапы через провайдер
3. **Кэш:** Redis (Upstash/Vercel KV) — TTL-based, восстанавливается
4. **Деплой:** Vercel CLI + `VERCEL_TOKEN`

### Критические env vars
```
DATABASE_URL              # Neon PostgreSQL
POSTGRES_URL_NON_POOLING  # Direct connection
REDIS_URL                 # Upstash/Vercel KV
MOEX_JWT                  # MOEX ISS API JWT
TINVEST_TOKEN             # Tinkoff Invest API
OPENROUTER_API_KEY        # Neuro Hint AI
```

### Восстановление процедура
```bash
# 1. Клонировать репо
git clone https://github.com/SuperMegaPUP/gorizont-sobytij.git

# 2. Установить зависимости
npm ci

# 3. Настроить .env (скопировать из хранилища)
cp .env.production .env.local

# 4. Сгенерировать Prisma клиент
npx prisma generate

# 5. Запустить тесты
npm run test:ci

# 6. Забилдить
npx next build

# 7. Деплой PROD
vercel deploy --prod --token $VERCEL_TOKEN

# 8. Деплой LAB
echo '{"projectId":"prj_Hs520wEKU27KpsqTdqwHeK9ZVsVp",...}' > .vercel/project.json
vercel deploy --prod --token $VERCEL_TOKEN
```

---

## 5. ТЕГИ РЕЛИЗОВ

```bash
# После завершения спринта
git tag -a v4.2.0 -m "Горизонт Событий v4.2: П1+П2 детекторы, dynamic TTL, confidence v4.2"
git push origin v4.2.0
```

---

## 6. DEPLOY NOTES

### Vercel CLI — единственный рабочий способ
Git Integration webhook сломан — push НЕ триггерит автодеплой. Только CLI.

### Переключение PROD ↔ LAB
```bash
# PROD
echo '{"projectId":"prj_eHCVFpiI0gYHrfGNGuXdrUqJN3Bd","orgId":"team_ZroUqWr5FNDvTY9ebB8JfI0f","projectName":"robot-detect-v3"}' > .vercel/project.json

# LAB
echo '{"projectId":"prj_Hs520wEKU27KpsqTdqwHeK9ZVsVp","orgId":"team_ZroUqWr5FNDvTY9ebB8JfI0f","projectName":"robot-lab-v3"}' > .vercel/project.json
```

### Правила деплоя
1. **ВСЕГДА** катить и в PROD и в LAB
2. **НИКОГДА** не трогать PROD без явного запроса пользователя
3. Перед деплоем — `npx next build` локально
4. После деплоя — проверить URL в браузере
5. LAB деплой **меняет** `.vercel/project.json` — **ВСЕГДА** возвращать линк на PROD
6. **НИКОГДА** не создавать новые Vercel проекты

