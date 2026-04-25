# ПРОЕКТ: Горизонт Событий (Event Horizon)

## Общая информация

**Название**: Горизонт Событий — система обнаружения аномалий на рынке фьючерсов MOEX
**Домен**: Финансовый анализ, обнаружение скрытых крупных игроков ("чёрных звёзд")
**Язык**: Русский (UI, комментарии, AI-промпты)

## URL-адреса

| Среда | URL | Vercel Project | Branch |
|-------|-----|---------------|--------|
| PROD | https://robot-detect-v3.vercel.app/ | robot-detect-v3 | main |
| LAB | https://robot-lab-v3.vercel.app/ | robot-lab-v3 | lab |

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
| Deploy | Vercel CLI (Git Integration сломан) | latest |
| UI Kit | shadcn/ui | latest |

## Структура проекта

```
src/
├── app/
│   ├── api/
│   │   ├── horizon/
│   │   │   ├── scan/route.ts         — POST: batch scanner (core 9 / top 100)
│   │   │   ├── scanner/route.ts      — GET: cached scanner results
│   │   │   ├── radar/route.ts        — GET: radar dots (core + top100)
│   │   │   ├── heatmap/route.ts      — GET: heatmap cells
│   │   │   ├── top100/route.ts       — GET/POST: TOP-100 by VALTODAY
│   │   │   ├── observe/route.ts      — POST: AI Observer single ticker
│   │   │   ├── observations/route.ts — GET: observation history
│   │   │   ├── bsci-history/route.ts — GET: BSCI history chart
│   │   │   ├── indicators/route.ts   — GET: detector indicators
│   │   │   ├── accuracy/route.ts     — GET: accuracy metrics
│   │   │   └── moex-extended/route.ts— GET: MOEX extended data
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
│   │   │   ├── ofi.ts               — Order Flow Imbalance
│   │   │   ├── vpin.ts              — Volume-synchronized VPIN
│   │   │   └── index.ts
│   │   ├── scanner/
│   │   │   └── rules.ts             — 10 IF-THEN scanner rules
│   │   ├── observer/
│   │   │   ├── collect-market-data.ts — Market data collector
│   │   │   └── generate-observation.ts — AI Observer orchestrator
│   │   └── ta-context.ts            — 5 TA indicators + SignalConvergence
│   ├── horizon-store.ts             — Zustand: Scanner, Radar, Heatmap, TOP-100
│   ├── settings-store.ts            — Font settings (11 options, max 45px)
│   ├── redis.ts                     — ioredis singleton
│   ├── db.ts                        — Prisma singleton
│   └── ...
├── components/
│   ├── horizon/
│   │   ├── frames/
│   │   │   ├── ScannerFrame.tsx     — СКАНЕР (core 9 / top 100)
│   │   │   ├── RadarFrame.tsx       — РАДАР (BSCI Y-axis, CumDelta X-axis)
│   │   │   ├── HeatmapFrame.tsx     — ТЕПЛОВАЯ КАРТА
│   │   │   └── AIObserverFrame.tsx  — AI НАБЛЮДАТЕЛЬ
│   │   ├── scanner/
│   │   │   └── DetectorDots.tsx     — 10-dot detector visualisation
│   │   ├── shared/
│   │   │   ├── DirectionArrow.tsx   — ▲/▼ arrow
│   │   │   └── BSCIColor.ts         — BSCI→color mapping
│   │   └── modals/
│   │       ├── TickerModal.tsx      — Тикер детальная карточка
│   │       └── TimeSliceModal.tsx   — Срез по времени
│   ├── frames/
│   │   ├── SignalsFrame.tsx         — СИГНАЛЫ (existing shell)
│   │   └── ...                      — Other frames
│   ├── SettingsInitializer.tsx       — Font init after hydration
│   └── ui/                          — shadcn/ui components
└── stores/                           — (unused — store in lib/)
```

## Правила деплоя

1. **ВСЕГДА** катить изменения и в PROD и в LAB
2. **НИКОГДА** не трогать PROD без явного запроса пользователя
3. Git Integration webhook сломан — деплой только через Vercel CLI
4. LAB: `npx vercel --prod --token TOKEN --yes` (project linked)
5. PROD: временно сменить `.vercel/project.json` projectId, задеплоить, вернуть

## Шрифты

- 11 опций (4 sans, 4 mono, 2 serif, 1 handwriting)
- FONT_SIZE_MIN = 10, FONT_SIZE_MAX = 45, DEFAULT = 14
- Zustand store + localStorage, CSS vars на `<html>`
- SettingsInitializer — после гидратации (fix React #418)

## Известные баги

- **React error #418**: "Only plain objects can be passed to Client Components" с `text` prop — НЕ ИСПРАВЛЕН
- **Git Integration**: webhook сломан, деплой только через CLI
