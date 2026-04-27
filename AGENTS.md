# 🤖 AGENTS.md — Инструкции для AI-агента

> Этот файл читается AI-агентом при начале каждой сессии.
> Он указывает где искать остальной контекст проекта.

---

## БЫСТРЫЙ СТАРТ

Привет! Если ты читаешь этот файл — значит начинаешь работу с проектом **Robot Detector + Горизонт Событий**.

### Где весь контекст?

**ВСЕГДА** начинай с чтения файлов в `/CONTEXT/`:

1. `/CONTEXT/CONTEXT.md` — память AI между сессиями
2. `/CONTEXT/VERSIONING.md` — SemVer, чек-листы, восстановимость
3. `/CONTEXT/FEATURES.md` — что в работе, прогресс
4. `/CONTEXT/HISTORY.md` — хронология сессий
5. `/CONTEXT/ARCHITECTURE.md` — архитектура (будет создано)
6. `/CONTEXT/RITUALS.md` — 8 обязательных ритуалов
7. `/CONTEXT/WORKLOG.md` — лог общения
8. `/CONTEXT/SPECS/v4.2.md` — полная спецификация детекторов v4.2

### Что НЕ делать
- Не создавать новые файлы контекста вне `/CONTEXT/`
- Не редактировать старые файлы `.md` в корне проекта (worklog-*.md) — они архивные
- Не деплоить без прохождения чек-листа в `VERSIONING.md`
- Не забывать обновлять `HISTORY.md` и `WORKLOG.md` в конце сессии

### Ключевые факты
- **PROD:** https://robot-detect-v3.vercel.app
- **LAB:** https://robot-lab-v3.vercel.app
- **Стек:** Next.js 16 + React 19 + TS + Tailwind v4 + Prisma + Redis
- **Деплой:** ТОЛЬКО через Vercel CLI (Git webhook сломан)
- **Тесты:** `npm run test:ci` — обязательно перед деплоем
- **Версия проекта:** 3.2.1 (package.json)
- **Текущий спринт:** 5 — v4.2 (покрытие: 15✅ + 3⚠️ + 53❌)

### Срочные контакты
Если что-то сломалось:
1. Проверить `npm run test:ci`
2. Проверить `npx next build`
3. Откатить последний коммит если нужно
4. Деплой только через Vercel CLI

---

## СТРУКТУРА ПРОЕКТА

```
gorizont-sobytij/
├── CONTEXT/              ← ВЕСЬ контекст здесь
│   ├── CONTEXT.md
│   ├── VERSIONING.md
│   ├── HISTORY.md
│   ├── FEATURES.md
│   ├── ARCHITECTURE.md
│   ├── RITUALS.md
│   ├── WORKLOG.md
│   └── SPECS/
│       └── v4.2.md       ← Полная спецификация
├── src/
│   ├── app/              ← Next.js App Router
│   ├── components/       ← React компоненты
│   ├── lib/              ← Ядро системы
│   │   ├── horizon/      ← Горизонт Событий
│   │   │   ├── detectors/   ← 10 Black Star детекторов
│   │   │   ├── signals/     ← Генератор сигналов
│   │   │   ├── scanner/     ← Scanner rules
│   │   │   └── ...
│   │   ├── store.ts      ← Robot Detector store
│   │   └── ...
│   └── ...
├── tests/                ← Jest тесты
├── prisma/               ← Схема БД
└── .github/workflows/    ← CI/CD
```

---

## РИТУАЛ НАЧАЛА СЕССИИ

```
1. Прочитать /CONTEXT/CONTEXT.md
2. Прочитать /CONTEXT/VERSIONING.md
3. Прочитать /CONTEXT/FEATURES.md
4. Прочитать /CONTEXT/HISTORY.md (последние 3 записи)
5. Прочитать /CONTEXT/ARCHITECTURE.md
6. Прочитать /CONTEXT/RITUALS.md
7. Прочитать /CONTEXT/WORKLOG.md
8. Уточнить у пользователя текущую задачу
```

---

*Последнее обновление: 2026-04-27*
