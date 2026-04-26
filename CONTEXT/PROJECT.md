# ПРОЕКТ: Горизонт Событий (Event Horizon)

> Обновлён: 2026-04-26 (Sprint 5: Trade-based OFI + П2-9)

## Общая информация

**Название**: Горизонт Событий — система обнаружения аномалий на рынке MOEX
**Домен**: Финансовый анализ, обнаружение скрытых крупных игроков ("чёрных звёзд")
**Язык**: Русский (UI, комментарии, AI-промпты)

## URL-адреса

| Среда | URL | Vercel Project | Project ID |
|-------|-----|---------------|------------|
| PROD | https://robot-detect-v3.vercel.app/ | robot-detect-v3 | prj_eHCVFpiI0gYHrfGNGuXdrUqJN3Bd |
| LAB | https://robot-lab-v3.vercel.app/ | robot-lab-v3 | prj_Hs520wEKU27KpsqTdqwHeK9ZVsVp |

## Технологический стек

| Слой | Технология | Версия |
|------|-----------|--------|
| Framework | Next.js | 16.1.3 |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS v4 + CSS Variables | 4.x |
| State | Zustand | latest |
| Database | PostgreSQL (Neon) + Prisma ORM | latest |
| Cache | Redis (ioredis) — Upstash/Vercel KV | latest |
| AI | z-ai-web-dev-sdk (GLM chat completions) | latest |
| Deploy | Vercel CLI (Git Integration сломан) | 52.0.0 |
| UI Kit | shadcn/ui | latest |
| Tests | Jest — 177 тестов, 10 suites | latest |

## Структура проекта

```
src/
├── app/
│   ├── api/
│   │   ├── horizon/
│   │   │   ├── scan/route.ts         — POST: batch scanner (core 9 / top 100) + signal generation
│   │   │   ├── scanner/route.ts      — GET: cached scanner results
│   │   │   ├── radar/route.ts        — GET: radar dots (core + top100)
│   │   │   ├── heatmap/route.ts      — GET: heatmap cells
│   │   │   ├── top100/route.ts       — GET/POST: TOP-100 (инкрементальное сканирование)
│   │   │   ├── observe/route.ts      — POST: AI Observer single ticker
│   │   │   ├── observations/route.ts — GET: observation history
│   │   │   ├── bsci-history/route.ts — GET: BSCI history chart
│   │   │   ├── indicators/route.ts   — GET: detector indicators
│   │   │   ├── accuracy/route.ts     — GET: accuracy metrics
│   │   │   ├── moex-extended/route.ts— GET: MOEX extended data
│   │   │   ├── robot-context/route.ts— GET: Robot context per ticker
│   │   │   └── signals/route.ts      — GET: active signals
│   │   ├── detect/route.ts           — Original detect engine
│   │   ├── moex/route.ts             — MOEX data fetcher
│   │   ├── algopack/route.ts         — MOEX Algopack
│   │   ├── futoi/route.ts            — MOEX FUTOI
│   │   ├── robot-events/route.ts     — Robot events
│   │   └── ...
│   ├── globals.css                   — CSS vars: --app-font-family, --app-font-size, --app-font-scale
│   ├── layout.tsx                    — Root layout
│   └── page.tsx                      — Main page
├── lib/
│   ├── horizon/
│   │   ├── detectors/
│   │   │   ├── types.ts             — DetectorResult, DetectorInput, DETECTOR_NAMES
│   │   │   ├── registry.ts          — ALL_DETECTORS, runAllDetectors(), calcBSCI()
│   │   │   ├── cross-section-normalize.ts — Z-score нормализация
│   │   │   ├── graviton.ts / darkmatter.ts / accretor.ts / ...
│   │   │   └── index.ts
│   │   ├── bsci/
│   │   │   ├── init-weights.ts      — Инициализация весов (run once)
│   │   │   └── save-observation.ts  — Save to PG + Redis
│   │   ├── calculations/
│   │   │   ├── delta.ts             — Cumulative Delta
│   │   │   ├── ofi.ts               — Order Flow Imbalance + Real-time OFI + Trade-based OFI
│   │   │   ├── vpin.ts              — Volume-synchronized VPIN
│   │   │   └── index.ts
│   │   ├── scanner/
│   │   │   └── rules.ts             — 10 IF-THEN scanner rules
│   │   ├── observer/
│   │   │   ├── collect-market-data.ts — Market data collector (+ fastMode для TOP-100 + Trade-based OFI fallback + z-score)
│   │   │   └── generate-observation.ts — AI Observer orchestrator
│   │   ├── signals/
│   │   │   ├── signal-generator.ts  — Генерация сигналов (confidence + пороги + дедуп)
│   │   │   ├── level-calculator.ts  — Расчёт S/R + entry/stop/target
│   │   │   ├── signal-store.ts      — Zustand store + Redis сериализация
│   │   │   ├── signal-feedback.ts   — Виртуальный P&L + feedback loop
│   │   │   └── moex-sessions.ts     — Сессии МОЕКС + calculateTTL
│   │   ├── ta-context.ts            — 5 TA indicators + SignalConvergence
│   │   ├── convergence-score.ts     — Convergence score 0-10 + бонусы + штрафы
│   │   ├── robot-context.ts         — Robot context bridge (AlgoPack + Burst → Horizon)
│   │   └── internal-consistency.ts  — Level-0 consistency check (hallucination detection)
│   ├── horizon-store.ts             — Zustand: Scanner, Radar, Heatmap, TOP-100, Signals
│   ├── settings-store.ts            — Font settings (11 options, max 45px)
│   ├── redis.ts                     — ioredis singleton
│   ├── db.ts                        — Prisma singleton
│   └── ...
├── components/
│   ├── horizon/
│   │   ├── frames/
│   │   │   ├── ScannerFrame.tsx     — СКАНЕР (core 9 / top 100) + ConvergenceCell
│   │   │   ├── RadarFrame.tsx       — РАДАР (BSCI Y-axis, CumDelta X-axis)
│   │   │   ├── HeatmapFrame.tsx     — ТЕПЛОВАЯ КАРТА
│   │   │   ├── AIObserverFrame.tsx  — AI НАБЛЮДАТЕЛЬ
│   │   │   └── SignalsFrame.tsx     — СИГНАЛЫ (Sprint 4)
│   │   ├── scanner/
│   │   │   └── DetectorDots.tsx     — 10-dot detector visualisation
│   │   ├── shared/
│   │   │   ├── DirectionArrow.tsx   — ▲/▼ arrow
│   │   │   └── BSCIColor.ts         — BSCI→color mapping
│   │   └── modals/
│   │       ├── TickerModal.tsx      — Тикер детальная карточка (BSCI + конвергенция + роботы + OFI)
│   │       └── TimeSliceModal.tsx   — Срез по времени
│   ├── frames/
│   │   ├── SignalsFrame.tsx         — СИГНАЛЫ (main tab shell)
│   │   └── ...                      — Other frames
│   ├── SettingsInitializer.tsx       — Font init after hydration
│   └── ui/                          — shadcn/ui components
└── stores/                           — (unused — store in lib/)
```

## Правила деплоя

1. **ВСЕГДА** катить изменения и в PROD и в LAB
2. **НИКОГДА** не трогать PROD без явного запроса пользователя
3. Git Integration webhook сломан — деплой только через Vercel CLI
4. Токен: использовать из env переменной VERCEL_TOKEN
5. PROD: `vercel deploy --prod --token $TOKEN --yes`
6. LAB: переключить `.vercel/project.json` → задеплоить → вернуть PROD
7. **НИКОГДА** не создавать новые Vercel проекты

## Шрифты

- 11 опций (4 sans, 4 mono, 2 serif, 1 handwriting)
- FONT_SIZE_MIN = 10, FONT_SIZE_MAX = 45, DEFAULT = 14
- Zustand store + localStorage, CSS vars на `<html>`
- SettingsInitializer — после гидратации (fix React #418)

## Текущий статус спринтов

| Спринт | Статус | Описание |
|--------|--------|----------|
| Sprint 1 | ✅ ЗАВЕРШЁН | Фундамент: 10 детекторов + BSCI + Scanner + UI |
| Sprint 2 | ✅ ЗАВЕРШЁН | TA-Context + Конвергенция |
| Sprint 3 | ✅ ЗАВЕРШЁН | Robot Context |
| Sprint 4 | ✅ ЗАВЕРШЁН | СИГНАЛЫ + П1 правки + bugfix'ы + HOTFIX v4.1.5 (калибровка порогов осталась) |
| Sprint 5 | 🔧 В ПРОЦЕССЕ | Калибровка + П2 + Trade-based OFI (5C частично готов, П2-9 готов) |
| Sprint 6+ | 📋 ЗАПЛАНИРОВАН | П3 продвинутые улучшения |
