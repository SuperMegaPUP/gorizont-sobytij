// ─── DECOHERENCE — Декогеренция (символьный поток) ──────────────────────────
// Обнаружение алгоритмической торговли через анализ частотного распределения
// символьного потока, построенного из сделок.
//
// v4.1 Формула:
// 1) Символьный поток:
//    - if (price_change > 0) symbol = round(log2(volume)) * +1
//    - else if (price_change < 0) symbol = round(log2(volume)) * -1
//    - else symbol = round(log2(volume)) * sign(tick_rule_direction)
//    - tick_rule_direction из CumDelta — предотвращает ложную «декогерентность» в боковике
//
// 2) Алфавит: от -10 до +10 (21 символ, включая 0)
//
// 3) Скользящее окно W=100 сделок → частотное распределение символов
//
// 4) Shannon entropy: H = -sum(p_i * log2(p_i)) для всех p_i > 0
//
// 5) Декогерентность = 1 - (H / H_max), где H_max = log2(21) ≈ 4.39
//
// 6) Интерпретация:
//    - Высокая → один/несколько символов доминируют → алгоритмическая система
//    - Низкая → равномерное распределение → естественный рынок

import type { DetectorInput, DetectorResult } from './types';

const EPS = 1e-6;
const ALPHABET_SIZE = 21;  // от -10 до +10
const H_MAX = Math.log2(ALPHABET_SIZE); // ≈ 4.39
const WINDOW_SIZE = 100;   // Скользящее окно

// ─── Вспомогательные функции ────────────────────────────────────────────────

/**
 * Shannon entropy для частотного распределения.
 * H = -sum(p_i * log2(p_i)) для всех p_i > 0
 */
function shannonEntropy(frequencies: Map<number, number>, total: number): number {
  if (total < EPS) return 0;

  let entropy = 0;
  for (const count of frequencies.values()) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

/**
 * tick_rule_direction: определяем направление сделки при нулевом изменении цены.
 * Используем CumDelta как контекст — если CumDelta > 0, значит покупки доминируют,
// следовательно сделка скорее покупка.
 */
function getTickRuleDirection(cumDelta: number, ofi: number): number {
  // Приоритет: CumDelta — более «честный» индикатор
  if (Math.abs(cumDelta) > EPS) {
    return Math.sign(cumDelta);
  }
  // Fallback: OFI
  if (Math.abs(ofi) > EPS) {
    return Math.sign(ofi);
  }
  // Нет данных — нейтрально
  return 0;
}

/**
 * Преобразует сделку в символ.
 * symbol = round(log2(volume)) * direction
 * direction = sign(price_change), или tick_rule при ΔP=0
 */
function tradeToSymbol(
  volume: number,
  priceChange: number,
  tickRuleDirection: number
): number {
  if (volume <= 0) return 0;

  const logVol = Math.round(Math.log2(volume + EPS));
  // Ограничиваем до ±10 (алфавит -10..+10)
  const clampedLogVol = Math.min(10, Math.max(0, logVol));

  let direction: number;
  if (priceChange > 0) {
    direction = 1;
  } else if (priceChange < 0) {
    direction = -1;
  } else {
    // ΔP = 0: используем tick_rule_direction
    direction = tickRuleDirection;
  }

  const symbol = clampedLogVol * direction;
  // Ограничиваем до диапазона [-10, +10]
  return Math.min(10, Math.max(-10, symbol));
}

// ─── Главный детектор ──────────────────────────────────────────────────────

export function detectDecoherence(input: DetectorInput): DetectorResult {
  const { ofi, cumDelta, prices, trades, recentTrades } = input;
  const metadata: Record<string, number | string | boolean> = {};

  // Нужны сделки с ценами для построения символьного потока
  const allTrades = trades && trades.length > 0 ? trades : recentTrades;

  if (allTrades.length < 10) {
    metadata.insufficientTrades = true;
    return {
      detector: 'DECOHERENCE',
      description: 'Декогеренция — символьный поток (мало сделок)',
      score: 0,
      confidence: 0,
      signal: 'NEUTRAL',
      metadata,
    };
  }

  // ─── 1. Строим символьный поток ────────────────────────────────────────

  const tickRuleDir = getTickRuleDirection(cumDelta.delta, ofi);
  const symbols: number[] = [];

  for (let i = 0; i < allTrades.length; i++) {
    const priceChange = i > 0
      ? (allTrades[i].price - allTrades[i - 1].price)
      : 0;

    const symbol = tradeToSymbol(
      allTrades[i].quantity,
      priceChange,
      tickRuleDir
    );
    symbols.push(symbol);
  }

  metadata.totalSymbols = symbols.length;

  // ─── 2. Скользящее окно W=100 → частотное распределение ────────────────

  // Берём последние WINDOW_SIZE символов
  const windowSymbols = symbols.slice(-WINDOW_SIZE);
  const windowSize = windowSymbols.length;

  // Считаем частоты символов
  const frequencies = new Map<number, number>();
  for (const sym of windowSymbols) {
    frequencies.set(sym, (frequencies.get(sym) || 0) + 1);
  }

  metadata.uniqueSymbols = frequencies.size;
  metadata.windowSize = windowSize;

  // ─── 3. Shannon entropy ────────────────────────────────────────────────

  const observedEntropy = shannonEntropy(frequencies, windowSize);

  metadata.observedEntropy = Math.round(observedEntropy * 1000) / 1000;
  metadata.hMax = Math.round(H_MAX * 1000) / 1000;

  // ─── 4. Декогерентность = 1 - (H / H_max) ────────────────────────────

  // Высокая декогерентность → один/несколько символов доминируют → алгоритм
  // Низкая декогерентность → равномерное распределение → естественный рынок
  let decoherence = 0;
  if (H_MAX > EPS) {
    decoherence = 1 - (observedEntropy / H_MAX);
  }

  decoherence = Math.min(1, Math.max(0, decoherence));

  metadata.decoherence = Math.round(decoherence * 1000) / 1000;

  // ─── 5. Дополнительные метрики ─────────────────────────────────────────

  // Доминантный символ (самый частый)
  let dominantSymbol = 0;
  let dominantFreq = 0;
  for (const [sym, count] of frequencies) {
    if (count > dominantFreq) {
      dominantFreq = count;
      dominantSymbol = sym;
    }
  }

  const dominantRatio = dominantFreq / (windowSize + EPS);
  metadata.dominantSymbol = dominantSymbol;
  metadata.dominantRatio = Math.round(dominantRatio * 1000) / 1000;

  // Top-3 символа по частоте
  const sorted = [...frequencies.entries()].sort((a, b) => b[1] - a[1]);
  const top3Ratio = sorted.slice(0, 3).reduce((s, e) => s + e[1], 0) / (windowSize + EPS);
  metadata.top3Ratio = Math.round(top3Ratio * 1000) / 1000;

  // tick_rule_usage: сколько раз использовался tick_rule (ΔP=0)
  const tickRuleUsages = symbols.filter(s => s !== 0).length;
  metadata.tickRuleInfluence = Math.round(tickRuleDir * 100) / 100;

  // ─── 6. Score ──────────────────────────────────────────────────────────

  // Основной score = декогерентность (0-1)
  // Если доминантный символ > 30% — усиливаем (явный алгоритм)
  // Если top-3 > 60% — ещё усиливаем (концентрация)
  let score = decoherence;

  if (dominantRatio > 0.3) {
    score = Math.min(1, score * 1.15);
  }
  if (top3Ratio > 0.6) {
    score = Math.min(1, score * 1.1);
  }

  // ─── 7. Signal direction ───────────────────────────────────────────────

  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';

  if (score > 0.2) {
    // Определяем направление по доминантному символу
    if (dominantSymbol > 0) {
      signal = 'BULLISH';
    } else if (dominantSymbol < 0) {
      signal = 'BEARISH';
    } else {
      // Доминантный символ = 0 (нейтральный), используем CumDelta
      signal = cumDelta.delta > 0 ? 'BULLISH' : cumDelta.delta < 0 ? 'BEARISH' : 'NEUTRAL';
    }
  }

  const confidence = score > 0.2
    ? Math.min(1, (decoherence + dominantRatio) / 1.5)
    : 0;

  // Сохраняем legacy-поля для обратной совместимости
  metadata.flowDivergence = ofi !== 0 && cumDelta.delta !== 0
    && Math.sign(ofi) !== Math.sign(cumDelta.delta);
  metadata.ofiDir = Math.sign(ofi);
  metadata.deltaDir = Math.sign(cumDelta.delta);

  return {
    detector: 'DECOHERENCE',
    description: 'Декогеренция — символьный поток (Shannon entropy)',
    score: Math.round(score * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    signal,
    metadata,
  };
}
