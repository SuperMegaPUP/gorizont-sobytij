# ДЕТЕКТОРЫ: 10 Black Star детекторов аномалий

> Спецификация v5.0 — ФИНАЛЬНЫЕ ФОРМУЛЫ (заморожены)
> Обновлён: 2026-04-26 (Sprint 5: Trade-based OFI + П2-9 z-score)

## Типы

```typescript
interface DetectorResult {
  detector: string;           // Имя (GRAVITON, DARKMATTER, ...)
  description: string;        // Описание на русском
  score: number;              // 0..1 — сила сигнала
  confidence: number;         // 0..1 — уверенность
  signal: DetectorSignal;     // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  metadata: Record<string, number | string | boolean>;
}
```

## Входные данные

```typescript
interface DetectorInput {
  ticker: string;
  orderbook: OrderBookData;
  orderbookPrev?: OrderBookSnapshot;
  trades: Trade[];
  recentTrades: Trade[];
  ofi: number;                    // OFI — лучшего источника (OB или tradeOFI)
  weightedOFI: number;            // Weighted OFI — лучшего источника
  realtimeOFI?: number;           // Real-time OFI (OB Cont et al. или trade-based Δ)
  tradeOFI?: TradeOFIResult;      // Trade-based OFI — работает без стакана (ДСВД)
  ofiSource?: 'orderbook' | 'trades';  // true = OFI из сделок
  cumDelta: CumDeltaResult;
  vpin: VPINResult;
  prices: number[];
  volumes: number[];
  candles: Candle[];
  crossTickers?: Record<string, { priceChange: number; ofi: number }>;
  rvi?: number;
  // П2-9: Z-score нормализация
  zScorePrices?: number[];       // для CIPHER
  zScoreVolumes?: number[];      // для CIPHER, ACCRETOR
  zScoreIntervals?: number[];    // для CIPHER, HAWKING
  // Data freshness
  staleData?: boolean;           // данные устарели
  staleMinutes?: number;         // возраст свежей сделки
}
```

## ε-ЗАЩИТА (сквозное правило v4)

Во ВСЕ формулы с делением добавить ε=1e-6. Defensive programming — не обсуждается.

## Все 10 детекторов + BSCI

### 1. GRAVITON — Гравитационное линзирование стакана (П2)

**Файл**: `graviton.ts` | **Ключевые входы**: prices, volumes, orderbook

ФИНАЛЬНАЯ ФОРМУЛА v4:

1) Обрезка стакана до 80% объёма (отсекает фантомные стены ММ на периферии):
   - cutoffLevel = min level where cumulative_volume >= 0.8 * totalSideVolume
   - Все расчёты ТОЛЬКО на уровнях [0..cutoffLevel]

2) Центры масс:
   - center_mass_bid = sum(volume_i * price_i) / (sum(volume_i) + ε)
   - center_mass_ask = sum(volume_i * price_i) / (sum(volume_i) + ε)

3) separation = (center_mass_ask - center_mass_bid) / (mid_price + ε)

4) asymmetry = (sum(bid_vol * dist_from_cm_bid) - sum(ask_vol * dist_from_cm_ask)) / (total_vol + ε)

5) detect_walls():
   - wall = уровень где volume > 3 * median_volume_per_level
   - wall_proximity = min(distance_to_wall) / (spread + ε)
   - wall_score = sum(wall_volume * w_depth_k) / (total_side_volume + ε)
   - w_depth_k = exp(-depth_k / (avg_depth + ε))

6) graviton_score = f(separation, asymmetry, wall_score)

### 2. DARKMATTER — Тёмная материя (П1 — критическое)

**Файл**: `darkmatter.ts` | **Ключевые входы**: orderbook, trades, vpin

ФИНАЛЬНАЯ ФОРМУЛА v4:

1) expected_entropy:
   - median_entropy_sessions (пересчитывается ежедневно)
   - Альтернатива v1: expected_entropy = f(avg_depth, spread)

2) darkmatter_entropy_score:
   - observed_entropy = Shannon_entropy(объёмы_по_уровням_стакана)
   - ΔH_norm = (expected_entropy - observed_entropy) / (expected_entropy + ε)
   - observed >= expected → score = 0 (нет аномалии)
   - observed < expected → score = ΔH_norm, диапазон (0, 1]

3) iceberg_score:
   - Группируем сделки по price_level
   - Ищем consecutive runs одинакового объёма (подряд идущие!)
   - Минимальная длина run: n_consecutive ≥ 3
   - Минимальный объём: levelVolume >= 0.005 * dailyTurnover (0.5% дневного оборота)
   - Если levelVolume < MIN_ICEBERG_VOLUME → iceberg_score_at_level = 0
   - iceberg_score_at_level = n_consecutive_same_vol / n_total_at_level
   - weight = 1 / (1 + distance_from_best)
   - iceberg_score = weighted_average(iceberg_score_at_level)

4) darkmatter_score = 0.5 * darkmatter_entropy_score + 0.5 * iceberg_score

### 3. ACCRETOR — Аккреционный диск (П2)

**Файл**: `accretor.ts` | **Ключевые входы**: trades, cumDelta, volumes

ФИНАЛЬНАЯ ФОРМУЛА v4:

1) Фильтруем сделки: volume < 0.3 * avg_lot_size

2) DBSCAN к множеству {(time, price)} мелких сделок:
   - eps_time = 60 секунд
   - eps_price = 1 tick
   - min_samples = 5
   - Окно: 200 последних сделок
   - Пересчёт: каждые 30 секунд

3) accretor_score = (n_clustered_trades / (n_small_trades + ε)) * cluster_concentration
   - cluster_concentration = avg_cluster_size / (ATR(14) / (tick_size + ε))
   - ATR-нормализация делает метрику сравнимой между тикерами

4) >60% мелких сделок кластеризовано → крупный игрок дробит заявку

5) НЕ дублирует DECOHERENCE: DECOHERENCE = символьный поток (частоты), ACCRETOR = spatial clustering (время+цена)

### 4. DECOHERENCE — Декогеренция (П1 — критическое)

**Файл**: `decoherence.ts` | **Ключевые входы**: prices, cumDelta, ofi

ФИНАЛЬНАЯ ФОРМУЛА v4:

1) Символьный поток:
   - if (price_change > 0) symbol = round(log2(volume)) * +1
   - else if (price_change < 0) symbol = round(log2(volume)) * -1
   - else symbol = round(log2(volume)) * sign(tick_rule_direction)
   - tick_rule_direction из CumDelta — предотвращает ложную «декогерентность» в боковике

2) Алфавит: от -10 до +10 (21 символ, включая 0)

3) Скользящее окно W=100 сделок → частотное распределение символов

4) Shannon entropy: H = -sum(p_i * log2(p_i)) для всех p_i > 0

5) Декогерентность = 1 - (H / H_max), где H_max = log2(21) ≈ 4.39

6) Интерпретация:
   - Высокая → один/несколько символов доминируют → алгоритмическая система
   - Низкая → равномерное распределение → естественный рынок

### 5. HAWKING — Излучение Хокинга (П1 — критическое)

**Файл**: `hawking.ts` | **Ключевые входы**: trades, volumes, ofi

ФИНАЛЬНАЯ ФОРМУЛА v4:

1) trade_intervals = t[i] - t[i-1] для последних N сделок

2) Минимальное окно:
   - n_trades < 50 → hawking_score = 0 (недостаточно данных)
   - 50 ≤ n_trades < 100 → сырой FFT
   - n_trades >= 100 → Welch's method (перекрывающиеся окна + усреднение PSD)

3) Autocorrelation lag 1..20

4) Периодичность = max(|ACF(k)|) для k=2..20

5) noise_ratio = 1 - (peak_power / (median_psd * bandwidth + ε))
   - Сравниваем пик с «фоном», не с общей мощностью — устойчивее к шуму

6) hawking_score = периодичность * (1 - noise_ratio)

7) Частоты 0.5-5 Hz = зона алгоритмической торговли

8) Убрать ВСЕ упоминания WVD из спецификации и комментариев

### 6. PREDATOR — Хищник (П2 estimated_stops + FALSE_BREAKOUT)

**Файл**: `predator.ts` | **Ключевые входы**: trades, cumDelta, orderbook

ФИНАЛЬНАЯ ФОРМУЛА v4:

Основной детектор — aggression_ratio + cumulative delta acceleration (как сейчас)

НОВОЕ: 5-фазный цикл с FALSE_BREAKOUT:
1. STALK — цена приближается к уровню скопления стопов
2. HERDING — мелкие сделки толпы на уровне
3. ATTACK — агрессивный пробой
4. CONSUME — кит выкупает (цена возвращается, CumDelta +)
5. FALSE_BREAKOUT — новостной пробой (цена не возвращается, CumDelta -)

Условие CONSUME vs FALSE_BREAKOUT (v4.1 — градиент вместо бинарного порога):
- price_reversion = (current_price - attack_extreme) / (pre_attack_price - attack_extreme)
- delta_flip = sign(cumDelta_current) ≠ sign(cumDelta_during_attack)
- price_reversion >= 0.7 && delta_flip → CONSUME (полная уверенность, confidence_modifier = 1.0)
- price_reversion >= 0.4 && < 0.7 && delta_flip → CONSUME с пониженным confidence (confidence_modifier = price_reversion)
- price_reversion >= 0.4 && !delta_flip → CONSUME с низким confidence (confidence_modifier = price_reversion * 0.5)
- price_reversion < 0.4 → FALSE_BREAKOUT (новостной пробой)
- confidence_modifier применяется к итоговой формуле confidence:
  final_confidence = confidence_formula_result * confidence_modifier
- В UI: "Stop-hunt (60% уверенности)" вместо бинарного да/нет

НОВОЕ: estimated_stops(level) для signal_generator:
1) volume_cluster_density(level) = sum(volume within ±2 ticks) / (avg_volume_per_tick_range + ε)
2) round_number_bonus(level) = 1 если level кратен 5/10 пунктам, иначе 0
3) recent_breakout_frequency(level) = count(breakouts) / (N + ε)
4) vwap_distance_penalty(level) = 1 - min(|level - VWAP|, max_dist) / (max_dist + ε)

estimated_stops(level) = 0.35 * volume_cluster_density + 0.25 * round_number_bonus + 0.25 * recent_breakout_frequency + 0.15 * vwap_distance_penalty

### 7. CIPHER — Шифр (П2)

**Файл**: `cipher.ts` | **Ключевые входы**: trades (timing, size pattern)

ФИНАЛЬНАЯ ФОРМУЛА v4:

УРОВЕНЬ 1 (быстрый скрининг):
1) features = zScoreNormalize([volume, trade_size, interval], window=100)
2) PCA(n_components=3).fit(features)
3) dominance_ratio = explained_variance_ratio_[0]
4) Если dominance_ratio > 0.6 → алгоритм
5) cipher_quick = dominance_ratio

УРОВЕНЬ 2 (глубокий анализ, только если cipher_quick > 0.5):
1) Проверяем condition number матрицы ковариации:
   - cov_condition > 1000 → skip ICA → cipher_score = cipher_quick
2) ICA на том же normalized matrix, max_iterations=200
3) Если ICA не сошлась → cipher_score = cipher_quick
4) kurtosis = mean(|IC_i|^4) / mean(|IC_i|^2)^2
5) kurtosis > 3 → негауссово → несколько независимых алгоритмов
6) cipher_deep = (cipher_quick + kurtosis_normalized) / 2

Финал: cipher_quick <= 0.5 → cipher_quick; иначе → cipher_deep; ICA fallback → cipher_quick

### 8. ENTANGLE — Запутанность (П2 ADF-фикс, П3 Hilbert)

**Файл**: `entangle.ts` | **Ключевые входы**: crossTickers, prices

ФИНАЛЬНАЯ ФОРМУЛА v4:

v1 (сейчас + ADF-фикс):
1) Перед расчётом ANY correlation/causality — проверить стационарность:
   - augmentedDickeyFullerTest(series)
   - pvalue < 0.05 → стационарно → используем series
   - иначе → первые разности → повторный ADF
   - даже разности нестационарны → entangle_score = 0, skip

2) Granger causality с лагом = 3 (фиксированный для v1)

v2: AIC/BIC для топ-20 пар + Hilbert transform для phase difference

### 9. WAVEFUNCTION — Волновая функция (П2 ресэмплинг, П3 learnable)

**Файл**: `wavefunction.ts` | **Ключевые входы**: prices, volumes, candles

ФИНАЛЬНАЯ ФОРМУЛА v4:

1) Transition matrix фиксированная:
   - [0.7, 0.2, 0.1] ACCUMULATE
   - [0.2, 0.6, 0.2] DISTRIBUTE
   - [0.1, 0.2, 0.7] HOLD

2) Student-t likelihood + Laplace smoothing (как сейчас)

3) ОБЯЗАТЕЛЬНО — Мониторинг вырождения + ресэмплинг:
   - N_eff = 1 / (sum(weights^2) + ε)
   - if (N_eff < 0.5 * n_particles) → systematicResample()

4) ОБЯЗАТЕЛЬНО — Логарифмирование весов:
   - Все операции в лог-пространстве
   - Нормализация через log-sum-exp
   - Предотвращает underflow при длинных окнах

v1.5: Обратная связь по виртуальному P&L (ACCUMULATE→LONG→WIN → +0.01)
v2: EM-алгоритм (минимум 500+ сигналов), адаптивные частицы 200-1000

### 10. ATTRACTOR — Аттрактор (П2)

**Файл**: `attractor.ts` | **Ключевые входы**: orderbook (bid/ask walls)

ФИНАЛЬНАЯ ФОРМУЛА v4:

1) takens_convergence (с авто τ и Silverman bandwidth):
   - d=3 фиксированный, τ — автоматический
   - Авто τ: τ = findFirstZeroACF(price_series) || 5 (раз/час, min=2, max=20)
   - KDE: h = 1.06 * sigma * N^(-1/5) (правило Сильвермана)
   - takens_convergence = концентрация плотности вокруг аттрактора

2) volume_profile_attractor:
   - POC = уровень с максимальным объёмом
   - Если |price-POC|<2 ticks > 60% времени → зона аттрактора

3) price_stickiness:
   - sticky = |price[t] - price[t-1]| < 0.5 * current_spread (НЕ по tick, а по spread)
   - stickiness_ratio = sticky_time / window_length

4) attractor_score = 0.4 * takens_convergence + 0.3 * volume_profile_attractor + 0.3 * price_stickiness

### 11. BSCI — Композитный индекс (П1 η+min_w, П2 decay)

ФИНАЛЬНАЯ ФОРМУЛА v4:

1) w_k(t) = w_k(t-1) + η * (S_k(t) - w_k(t-1)) * w_k(t-1), η = 0.03

2) min_w = 0.04 (повышено с 0.02 для быстрого восстановления «мёртвых» детекторов)

3) Нормализация: sum(w_k) = 1

4) П2: Мягкий daily weight decay:
   - w_k = 0.99 * w_k + 0.01 * (1/K)
   - 1% в день к равновесию → за 100 дней → 63% сдвиг
   - Решает «дрейф весов при длительном флете»

5) L2-регуляризация ОТКЛОНЕНА — противоречит адаптации
6) Accuracy decay ОТКЛОНЁН — двойное замедление при η=0.03

Alert Levels: GREEN < 0.3 | YELLOW 0.3-0.5 | ORANGE 0.5-0.7 | RED ≥ 0.7

## Детектор ↔ Робот-паттерн (DETECTOR_PATTERN_MAP)

| Детектор | Робот-паттерны | AlgoPack |
|----------|---------------|----------|
| GRAVITON | market_maker, absorber, iceberg | wall_score |
| DARKMATTER | iceberg, absorber | wall_score + cancel |
| ACCRETOR | accumulator, slow_grinder | accumulation_score |
| DECOHERENCE | aggressive, momentum, scalper | — |
| HAWKING | scalper, hft, market_maker | — |
| PREDATOR | aggressive, momentum, sweeper | — |
| CIPHER | periodic, fixed_volume, layered | — |
| ENTANGLE | ping_pong, periodic, market_maker | — |
| WAVEFUNCTION | periodic, ping_pong, market_maker | — |
| ATTRACTOR | slow_grinder, absorber, iceberg | wall_score + accumulation_score |

## Scanner Rules (10 IF-THEN)

| # | Условие | Сигнал | Action |
|---|---------|--------|--------|
| 1 | BSCI>0.7 + PREDATOR top | PREDATOR_ACCUM | URGENT |
| 2 | BSCI>0.5 + \|OFI\|>2x + DECOHERENCE>0.4 | IMBALANCE_SPIKE | ALERT |
| 3 | BSCI<0.2 + turnover↓ + VPIN↑ | LOW_LIQUIDITY_TRAP | WATCH |
| 4 | BSCI 0.4-0.7 + HAWKING>0.5 | BREAKOUT_IMMINENT | ALERT |
| 5 | direction=BEAR + cumDelta<0 | BEARISH_DIVERGENCE | ALERT |
| 6 | direction=BULL + cumDelta>0 | BULLISH_DIVERGENCE | ALERT |
| 7 | CIPHER>0.6 + ACCRETOR>0.4 | SMART_MONEY_ACCUM | ALERT |
| 8 | ENTANGLE>0.5 | INDEPENDENT_MOVE | WATCH |
| 9 | VPIN>0.7 + DARKMATTER>0.5 | INFORMED_TRADING | ALERT |
| 10 | prevBsci - bsci > 0.3 | SIGNAL_FADE | WATCH |

## Приоритеты реализации

| Приоритет | Детекторы | Когда |
|-----------|----------|-------|
| П1 (критическое) | DARKMATTER, DECOHERENCE, HAWKING, BSCI(η+min_w) | Sprint 4 (✅ ВЫПОЛНЕНО) |
| П2 (структурные) | GRAVITON, ACCRETOR, CIPHER, ATTRACTOR, ENTANGLE, PREDATOR, WAVEFUNCTION, BSCI(decay) | Sprint 5 |
| П2-9 (сквозная) | z-score нормализация в data pipeline | Sprint 5 (✅ ВЫПОЛНЕНО) |
| П3 (продвинутые) | WAVEFUNCTION(learnable), ENTANGLE(Hilbert), PREDATOR(POC), ATTRACTOR(FNN) | Sprint 6+ |

## Сквозные изменения

- **ε=1e-6** во всех делениях (обязательно)
- **z-score нормализация** в data pipeline для CIPHER, HAWKING, ACCRETOR (П2-9 ✅ РЕАЛИЗОВАНО)
- **Trade-based OFI** — fallback при отсутствии стакана (Sprint 5C ✅ РЕАЛИЗОВАНО)
- **Синтетические тест-сценарии** (П3): iceberg, accumulator, predator, algorithm, coordinated, regime_change
- **KL-divergence мониторинг** (П3): weekly drift > 0.15 → заморозка адаптации

## Состояние и известные проблемы

- **ACCRETOR**: До нормализации давал 0.8-0.99 (шум). После cross-section norm — дискриминирует. v4: DBSCAN вместо угловых секторов (П2)
- **GRAVITON**: Часто 0.00 — "мёртвый". v4: центры масс + walls вместо экспоненциальной модели (П2). Trade-based OFI помогает при пустом стакане
- **DECOHERENCE**: ✅ П1 ВЫПОЛНЕНО — символьный поток + tick_rule при ΔP=0 + Shannon entropy
- **DARKMATTER**: ✅ П1 ВЫПОЛНЕНО — ΔH_norm + iceberg consecutive + MIN_ICEBERG_VOLUME + trades<10→0. Trade-based OFI помогает при пустом стакане
- **HAWKING**: ✅ П1 ВЫПОЛНЕНО — Welch PSD + noise_ratio fix + N≥50 минимум + trades<50→0
- **BSCI**: ✅ П1 ВЫПОЛНЕНО — η=0.03 + min_w=0.04
- **CIPHER**: Нет z-score перед PCA. v4: обязательная нормализация + condition number check (П2). z-score ВХОДНЫЕ данные готовы (П2-9 ✅)
- **ATTRACTOR**: Галлюцинации на мёртвых тикерах. v4: stickiness по spread + volume_profile + Takens (П2)
- **PREDATOR**: Нет FALSE_BREAKOUT градиента. v4: 5-фазный цикл + estimated_stops (П2)
- **WAVEFUNCTION**: Нет ресэмплинга. v4: N_eff мониторинг + log-weights (П2)
- **ENTANGLE**: Нет ADF-теста. v4: стационарность перед Granger (П2)
- **Trade-based OFI**: ✅ РЕАЛИЗОВАНО (Sprint 5C) — calcTradeOFI() + smart fallback + Δ(tradeOFI) для rtOFI
