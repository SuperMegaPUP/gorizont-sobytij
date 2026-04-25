// ─── convergence-score.ts ─────────────────────────────────────────────────────
// Числовой скор конвергенции 0-10
//
// Оценивает насколько детекторы BSCI и ТА-индикаторы согласованы.
// Каждый из 5 ТА-индикаторов может дать +0-2 балла:
//   +2: полное совпадение с BSCI направлением
//   +1: нейтральный ТА (не противоречит)
//   +0: противоречие (дивергенция)
//
// Бонусы:
//   +1 за явную дивергенцию (кит виден, ТА нет → скрытая активность = ценность)
//   +1 за ATR-сжатие (прорыв imminent) — в будущем: +1 за робот-подтверждение
//
// Максимум = 10 (5×2 + бонусы)

import type { TAIndicators } from './ta-context';

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface ConvergenceScoreResult {
  /** Итоговый скор 0-10 */
  score: number;
  /** Детализация по каждому индикатору */
  details: ConvergenceDetail[];
  /** Есть ли бонус за дивергенцию */
  divergenceBonus: boolean;
  /** Есть ли бонус за ATR-сжатие */
  atrBonus: boolean;
  /** Место для робот-бонуса (Спринт 3) */
  robotBonus: boolean;
  /** Человекочитаемое резюме */
  summary: string;
}

export interface ConvergenceDetail {
  indicator: string;       // 'RSI', 'CMF', 'CRSI', 'ATR', 'VWAP'
  points: number;          // 0, 1, или 2
  maxPoints: number;       // всегда 2
  alignment: 'ALIGNED' | 'NEUTRAL' | 'DIVERGENT';
  note: string;
}

// ─── Главная функция ─────────────────────────────────────────────────────────

/**
 * Вычисляет скор конвергенции 0-10 на основе BSCI-направления и ТА-индикаторов.
 *
 * @param bsciDirection — направление из детекторов
 * @param bsciScore — значение BSCI (для определения силы)
 * @param indicators — вычисленные TA индикаторы
 * @param hasDivergence — есть ли дивергенция (из SignalConvergence)
 * @param atrCompressed — сжат ли ATR (прорыв imminent)
 * @param robotConfirmed — подтверждён ли роботами (Спринт 3, default false)
 */
export function calculateConvergenceScore(
  bsciDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  bsciScore: number,
  indicators: TAIndicators,
  hasDivergence: boolean = false,
  atrCompressed: boolean = false,
  robotConfirmed: boolean = false,
): ConvergenceScoreResult {
  const details: ConvergenceDetail[] = [];
  let totalPoints = 0;

  // ─── RSI(14) — макс 2 балла ────────────────────────────────────────────
  const rsiDetail = scoreRSI(bsciDirection, indicators);
  details.push(rsiDetail);
  totalPoints += rsiDetail.points;

  // ─── CMF(20) — макс 2 балла ────────────────────────────────────────────
  const cmfDetail = scoreCMF(bsciDirection, indicators);
  details.push(cmfDetail);
  totalPoints += cmfDetail.points;

  // ─── CRSI(3) — макс 2 балла ────────────────────────────────────────────
  const crsiDetail = scoreCRSI(bsciDirection, indicators);
  details.push(crsiDetail);
  totalPoints += crsiDetail.points;

  // ─── VWAP — макс 2 балла ───────────────────────────────────────────────
  const vwapDetail = scoreVWAP(bsciDirection, indicators);
  details.push(vwapDetail);
  totalPoints += vwapDetail.points;

  // ─── ATR — макс 2 балла (контекстный, не направленный) ─────────────────
  const atrDetail = scoreATR(bsciScore, indicators);
  details.push(atrDetail);
  totalPoints += atrDetail.points;

  // ─── Бонусы ─────────────────────────────────────────────────────────────
  let divergenceBonus = false;
  let atrBonus = false;
  let robotBonus = false;

  // +1 за дивергенцию (кит виден, ТА нет → скрытая активность = ЦЕННОСТЬ)
  if (hasDivergence && bsciScore >= 0.55) {
    totalPoints += 1;
    divergenceBonus = true;
  }

  // +1 за ATR-сжатие (прорыв imminent, повышает ценность сигнала)
  if (atrCompressed) {
    totalPoints += 1;
    atrBonus = true;
  }

  // +1 за робот-подтверждение (Спринт 3)
  if (robotConfirmed) {
    totalPoints += 1;
    robotBonus = true;
  }

  // Ограничиваем максимум 10
  const score = Math.min(10, totalPoints);

  // Резюме
  const aligned = details.filter(d => d.alignment === 'ALIGNED').length;
  const divergent = details.filter(d => d.alignment === 'DIVERGENT').length;
  let summary = `${aligned}/5 совпадений`;
  if (divergent > 0) summary += `, ${divergent} дивергенций`;
  if (divergenceBonus) summary += ', +1 скрытая активность';
  if (atrBonus) summary += ', +1 ATR-сжатие';
  if (robotBonus) summary += ', +1 роботы';
  summary += ` = ${score}/10`;

  return {
    score,
    details,
    divergenceBonus,
    atrBonus,
    robotBonus,
    summary,
  };
}

// ─── Скоринг отдельных индикаторов ──────────────────────────────────────────

function scoreRSI(
  bsciDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  indicators: TAIndicators,
): ConvergenceDetail {
  // RSI oversold + BSCI bullish = конвергенция (оба ждут отскок)
  // RSI overbought + BSCI bearish = конвергенция (оба ждут отклонение)

  if (bsciDirection === 'BULLISH') {
    if (indicators.rsiZone === 'OVERSOLD') {
      return { indicator: 'RSI', points: 2, maxPoints: 2, alignment: 'ALIGNED',
        note: `RSI ${indicators.rsi.toFixed(1)} перепроданность → бычий отскок совпадает с BSCI` };
    }
    if (indicators.rsiZone === 'NEUTRAL') {
      return { indicator: 'RSI', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
        note: `RSI ${indicators.rsi.toFixed(1)} нейтральный — не противоречит BSCI BULL` };
    }
    // OVERBOUGHT + BULL = дивергенция
    return { indicator: 'RSI', points: 0, maxPoints: 2, alignment: 'DIVERGENT',
      note: `RSI ${indicators.rsi.toFixed(1)} перекупленность противоречит BSCI BULL → дивергенция!` };
  }

  if (bsciDirection === 'BEARISH') {
    if (indicators.rsiZone === 'OVERBOUGHT') {
      return { indicator: 'RSI', points: 2, maxPoints: 2, alignment: 'ALIGNED',
        note: `RSI ${indicators.rsi.toFixed(1)} перекупленность → медвежий разворот совпадает с BSCI` };
    }
    if (indicators.rsiZone === 'NEUTRAL') {
      return { indicator: 'RSI', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
        note: `RSI ${indicators.rsi.toFixed(1)} нейтральный — не противоречит BSCI BEAR` };
    }
    return { indicator: 'RSI', points: 0, maxPoints: 2, alignment: 'DIVERGENT',
      note: `RSI ${indicators.rsi.toFixed(1)} перепроданность противоречит BSCI BEAR → дивергенция!` };
  }

  // NEUTRAL BSCI
  return { indicator: 'RSI', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
    note: `RSI ${indicators.rsi.toFixed(1)} — BSCI нейтральный, совпадение не определено` };
}

function scoreCMF(
  bsciDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  indicators: TAIndicators,
): ConvergenceDetail {
  // CMF — сильный индикатор притока/оттока денег

  if (bsciDirection === 'BULLISH') {
    if (indicators.cmfZone === 'POSITIVE') {
      return { indicator: 'CMF', points: 2, maxPoints: 2, alignment: 'ALIGNED',
        note: `CMF ${indicators.cmf.toFixed(3)} позитивный → деньги втекают, совпадает с BSCI BULL` };
    }
    if (indicators.cmfZone === 'NEUTRAL') {
      return { indicator: 'CMF', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
        note: `CMF ${indicators.cmf.toFixed(3)} нейтральный — не противоречит BSCI BULL` };
    }
    return { indicator: 'CMF', points: 0, maxPoints: 2, alignment: 'DIVERGENT',
      note: `CMF ${indicators.cmf.toFixed(3)} негативный → деньги утекают, ПРОТИВОРЕЧИТ BSCI BULL!` };
  }

  if (bsciDirection === 'BEARISH') {
    if (indicators.cmfZone === 'NEGATIVE') {
      return { indicator: 'CMF', points: 2, maxPoints: 2, alignment: 'ALIGNED',
        note: `CMF ${indicators.cmf.toFixed(3)} негативный → деньги утекают, совпадает с BSCI BEAR` };
    }
    if (indicators.cmfZone === 'NEUTRAL') {
      return { indicator: 'CMF', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
        note: `CMF ${indicators.cmf.toFixed(3)} нейтральный — не противоречит BSCI BEAR` };
    }
    return { indicator: 'CMF', points: 0, maxPoints: 2, alignment: 'DIVERGENT',
      note: `CMF ${indicators.cmf.toFixed(3)} позитивный → деньги втекают, ПРОТИВОРЕЧИТ BSCI BEAR!` };
  }

  return { indicator: 'CMF', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
    note: `CMF ${indicators.cmf.toFixed(3)} — BSCI нейтральный` };
}

function scoreCRSI(
  bsciDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  indicators: TAIndicators,
): ConvergenceDetail {
  // CRSI — краткосрочный, аналогичен RSI но с другими порогами

  if (bsciDirection === 'BULLISH') {
    if (indicators.crsiZone === 'OVERSOLD') {
      return { indicator: 'CRSI', points: 2, maxPoints: 2, alignment: 'ALIGNED',
        note: `CRSI ${indicators.crsi.toFixed(1)} экстремальная перепроданность → бычий отскок` };
    }
    if (indicators.crsiZone === 'NEUTRAL') {
      return { indicator: 'CRSI', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
        note: `CRSI ${indicators.crsi.toFixed(1)} нейтральный` };
    }
    return { indicator: 'CRSI', points: 0, maxPoints: 2, alignment: 'DIVERGENT',
      note: `CRSI ${indicators.crsi.toFixed(1)} перекупленность противоречит BSCI BULL` };
  }

  if (bsciDirection === 'BEARISH') {
    if (indicators.crsiZone === 'OVERBOUGHT') {
      return { indicator: 'CRSI', points: 2, maxPoints: 2, alignment: 'ALIGNED',
        note: `CRSI ${indicators.crsi.toFixed(1)} экстремальная перекупленность → медвежий разворот` };
    }
    if (indicators.crsiZone === 'NEUTRAL') {
      return { indicator: 'CRSI', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
        note: `CRSI ${indicators.crsi.toFixed(1)} нейтральный` };
    }
    return { indicator: 'CRSI', points: 0, maxPoints: 2, alignment: 'DIVERGENT',
      note: `CRSI ${indicators.crsi.toFixed(1)} перепроданность противоречит BSCI BEAR` };
  }

  return { indicator: 'CRSI', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
    note: `CRSI ${indicators.crsi.toFixed(1)} — BSCI нейтральный` };
}

function scoreVWAP(
  bsciDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  indicators: TAIndicators,
): ConvergenceDetail {
  // VWAP: цена выше VWAP = бычий, ниже = медвежий

  if (bsciDirection === 'BULLISH') {
    if (indicators.vwapZone === 'ABOVE') {
      return { indicator: 'VWAP', points: 2, maxPoints: 2, alignment: 'ALIGNED',
        note: `Цена выше VWAP (+${(indicators.vwapDeviation * 100).toFixed(2)}%) → совпадает с BSCI BULL` };
    }
    if (indicators.vwapZone === 'AT_VWAP') {
      return { indicator: 'VWAP', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
        note: `Цена у VWAP (${(indicators.vwapDeviation * 100).toFixed(2)}%) — не противоречит` };
    }
    return { indicator: 'VWAP', points: 0, maxPoints: 2, alignment: 'DIVERGENT',
      note: `Цена ниже VWAP (${(indicators.vwapDeviation * 100).toFixed(2)}%) → ПРОТИВОРЕЧИТ BSCI BULL!` };
  }

  if (bsciDirection === 'BEARISH') {
    if (indicators.vwapZone === 'BELOW') {
      return { indicator: 'VWAP', points: 2, maxPoints: 2, alignment: 'ALIGNED',
        note: `Цена ниже VWAP (${(indicators.vwapDeviation * 100).toFixed(2)}%) → совпадает с BSCI BEAR` };
    }
    if (indicators.vwapZone === 'AT_VWAP') {
      return { indicator: 'VWAP', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
        note: `Цена у VWAP (${(indicators.vwapDeviation * 100).toFixed(2)}%) — не противоречит` };
    }
    return { indicator: 'VWAP', points: 0, maxPoints: 2, alignment: 'DIVERGENT',
      note: `Цена выше VWAP (+${(indicators.vwapDeviation * 100).toFixed(2)}%) → ПРОТИВОРЕЧИТ BSCI BEAR!` };
  }

  return { indicator: 'VWAP', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
    note: `VWAP отклонение ${(indicators.vwapDeviation * 100).toFixed(2)}% — BSCI нейтральный` };
}

function scoreATR(
  bsciScore: number,
  indicators: TAIndicators,
): ConvergenceDetail {
  // ATR — контекстный индикатор, не указывает направление.
  // Даёт баллы за наличие волатильности (подтверждает, что данные значимы).
  // ATR COMPRESSED + высокий BSCI = прорыв imminent (самый ценный сигнал)

  if (indicators.atrZone === 'COMPRESSED') {
    // Сжатие → прорыв imminent. Если BSCI высокий — это очень ценно
    if (bsciScore >= 0.55) {
      return { indicator: 'ATR', points: 2, maxPoints: 2, alignment: 'ALIGNED',
        note: `ATR сжат (${(indicators.atrPercentile * 100).toFixed(0)}%) + BSCI высокий → ПРОРЫВ IMMINENT!` };
    }
    return { indicator: 'ATR', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
      note: `ATR сжат (${(indicators.atrPercentile * 100).toFixed(0)}%) — ожидается прорыв, но BSCI низкий` };
  }

  if (indicators.atrZone === 'EXPANDED') {
    // Расширенная волатильность — движение уже идёт, данные значимы
    return { indicator: 'ATR', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
      note: `ATR расширен (${(indicators.atrPercentile * 100).toFixed(0)}%) — волатильность подтверждена` };
  }

  // NORMAL
  return { indicator: 'ATR', points: 1, maxPoints: 2, alignment: 'NEUTRAL',
    note: `ATR нормальный (${(indicators.atrPercentile * 100).toFixed(0)}%)` };
}
