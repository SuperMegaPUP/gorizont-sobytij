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
| 2026-04-28 | Deploy #3: HAWKING починен (48/100 > 0), PREDATOR/ATTRACTOR fallback на recentTrades, исправлены константы, добавлен metadataMap в API |

---

## 7. ТЕКУЩИЙ СТАТУС DEPLOY #3

| Метрика | Текущее | Цель |
|---------|---------|------|
| ALERT count | 1 | 5-15 |
| Mean BSCI | 0.129 | < 0.45 ✅ |
| HAWKING > 0 | 48/100 | ✅ Починен |
| PREDATOR > 0 | 0/100 | State machine в IDLE |
| ATTRACTOR > 0 | 36/100 | ✅ Работает |

### Исправления в Deploy #3:
1. **HAWKING**: добавлен fallback `trades || recentTrades`, исправлены undefined переменные (periodicityCapped, fwhmNorm)
2. **PREDATOR**: добавлен fallback `trades || recentTrades`
3. **ATTRACTOR**: добавлен fallback `trades || recentTrades` + заменены все `trades` на `effectiveTrades`
4. **metadataMap**: добавлен в TickerScanResult для отладки
5. **Alert thresholds**: исправлены пороги alertLevel (0.2/0.3/0.5 вместо 0.3/0.5/0.7)

