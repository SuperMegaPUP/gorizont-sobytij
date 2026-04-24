// ─── Scanner Rules Engine ─────────────────────────────────────────────────
// 10 IF-THEN rules applied on detector results → signal + action WITHOUT LLM
// Pure deterministic logic — no AI, no network calls

// ─── Input / Output Types ─────────────────────────────────────────────────

export interface ScannerInput {
  bsci: number;
  prevBsci: number;
  alertLevel: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  detectorScores: Record<string, number>; // { GRAVITON: 0.72, ... }
  ofi: number;
  cumDelta: number;
  vpin: number;
  turnover: number;
  prevTurnover: number;
}

export interface ScannerResult {
  signal: string;           // PREDATOR_ACCUM, BEARISH_DIVERGENCE, NEUTRAL, etc.
  action: 'WATCH' | 'ALERT' | 'URGENT';
  topDetector: string;
  quickStatus: string;      // Template-generated string like "⚠️ ЧЁРНАЯ ЗВЕЗДА. BSCI 0.81 ▲. 🦈 PRED АТАКА"
}

// ─── Signal Labels (for quickStatus) ──────────────────────────────────────

const SIGNAL_LABELS: Record<string, string> = {
  PREDATOR_ACCUM: '🦈 PRED АТАКА',
  IMBALANCE_SPIKE: '⚡ ИМБАЛАНС',
  LOW_LIQUIDITY_TRAP: '🕳️ ЛОВУШКА ЛИКВ.',
  BREAKOUT_IMMINENT: '💥 ПРОРЫВ',
  BEARISH_DIVERGENCE: '🐻 МЕДВ. ДИВЕРГ.',
  BULLISH_DIVERGENCE: '🐂 БЫЧ. ДИВЕРГ.',
  SMART_MONEY_ACCUM: '💎 УМНЫЕ ДЕНЬГИ',
  INDEPENDENT_MOVE: '🔗 НЕЗАВ. ДВИЖ.',
  INFORMED_TRADING: '👀 ИНС. ТОРГОВЛЯ',
  SIGNAL_FADE: '📉 ЗАТУХАНИЕ',
  NEUTRAL: '—',
};

// ─── Detector short names ─────────────────────────────────────────────────

const DETECTOR_SHORT: Record<string, string> = {
  PREDATOR: 'PRED',
  DARKMATTER: 'DARKM',
  GRAVITON: 'GRAV',
  ATTRACTOR: 'ATTR',
  WAVEFUNCTION: 'WAVE',
  ACCRETOR: 'ACCR',
  DECOHERENCE: 'DECOH',
  HAWKING: 'HAWK',
  CIPHER: 'CIPH',
  ENTANGLE: 'ENT',
};

function getDetectorShort(name: string): string {
  return DETECTOR_SHORT[name] || name.slice(0, 5).toUpperCase();
}

// ─── Quick Status Generator ───────────────────────────────────────────────

function generateQuickStatus(input: ScannerInput, result: ScannerResult): string {
  const { bsci, prevBsci } = input;

  // BSCI trend arrow
  let trend: string;
  if (bsci > prevBsci + 0.05) trend = '▲';
  else if (bsci > prevBsci) trend = '↑';
  else if (bsci < prevBsci - 0.05) trend = '▼';
  else if (bsci < prevBsci) trend = '↓';
  else trend = '→';

  // Verdict based on BSCI level
  let verdict: string;
  if (bsci > 0.7) verdict = '⚠️ ЧЁРНАЯ ЗВЕЗДА';
  else if (bsci >= 0.4) verdict = '🔍 Подозрительно';
  else verdict = '✅ Спокойно';

  // Top detector label
  const topDetLabel = getDetectorShort(result.topDetector);

  // Signal label
  const signalLabel = SIGNAL_LABELS[result.signal] || result.signal;

  return `${verdict}. BSCI ${bsci.toFixed(2)} ${trend}. ${topDetLabel} ${signalLabel}`;
}

// ─── 10 Rules (in priority order) ─────────────────────────────────────────

/**
 * Apply scanner rules to produce a signal and action.
 * Rules are evaluated in priority order; first match wins.
 */
export function applyScannerRules(input: ScannerInput): ScannerResult {
  const {
    bsci,
    prevBsci,
    detectorScores,
    ofi,
    cumDelta,
    vpin,
    turnover,
    prevTurnover,
    direction,
  } = input;

  // Find top detector
  let topDetector = 'NONE';
  let topScore = 0;
  for (const [name, score] of Object.entries(detectorScores)) {
    if (score > topScore) {
      topScore = score;
      topDetector = name;
    }
  }

  // Normal OFI threshold (absolute)
  const ofiAbs = Math.abs(ofi);
  const normalOfiThreshold = 2; // simplified: 2x normal means |ofi| > 2

  // Rule 1: BSCI>0.7 + PREDATOR top → PREDATOR_ACCUM / URGENT
  if (bsci > 0.7 && topDetector === 'PREDATOR') {
    const result: ScannerResult = {
      signal: 'PREDATOR_ACCUM',
      action: 'URGENT',
      topDetector,
      quickStatus: '',
    };
    result.quickStatus = generateQuickStatus(input, result);
    return result;
  }

  // Rule 2: BSCI>0.5 + |ofi| > 2x normal + DECOHERENCE>0.4 → IMBALANCE_SPIKE / ALERT
  if (bsci > 0.5 && ofiAbs > normalOfiThreshold && (detectorScores.DECOHERENCE ?? 0) > 0.4) {
    const result: ScannerResult = {
      signal: 'IMBALANCE_SPIKE',
      action: 'ALERT',
      topDetector,
      quickStatus: '',
    };
    result.quickStatus = generateQuickStatus(input, result);
    return result;
  }

  // Rule 3: BSCI<0.2 + turnover dropping + VPIN rising → LOW_LIQUIDITY_TRAP / WATCH
  if (bsci < 0.2 && turnover < prevTurnover * 0.8 && vpin > 0.3) {
    const result: ScannerResult = {
      signal: 'LOW_LIQUIDITY_TRAP',
      action: 'WATCH',
      topDetector,
      quickStatus: '',
    };
    result.quickStatus = generateQuickStatus(input, result);
    return result;
  }

  // Rule 4: BSCI 0.4-0.7 + HAWKING>0.5 → BREAKOUT_IMMINENT / ALERT
  if (bsci >= 0.4 && bsci <= 0.7 && (detectorScores.HAWKING ?? 0) > 0.5) {
    const result: ScannerResult = {
      signal: 'BREAKOUT_IMMINENT',
      action: 'ALERT',
      topDetector,
      quickStatus: '',
    };
    result.quickStatus = generateQuickStatus(input, result);
    return result;
  }

  // Rule 5: direction=BEARISH + cumDelta diverging (price up, delta down) → BEARISH_DIVERGENCE / ALERT
  if (direction === 'BEARISH' && cumDelta < 0) {
    const result: ScannerResult = {
      signal: 'BEARISH_DIVERGENCE',
      action: 'ALERT',
      topDetector,
      quickStatus: '',
    };
    result.quickStatus = generateQuickStatus(input, result);
    return result;
  }

  // Rule 6: direction=BULLISH + cumDelta diverging (price down, delta up) → BULLISH_DIVERGENCE / ALERT
  if (direction === 'BULLISH' && cumDelta > 0) {
    const result: ScannerResult = {
      signal: 'BULLISH_DIVERGENCE',
      action: 'ALERT',
      topDetector,
      quickStatus: '',
    };
    result.quickStatus = generateQuickStatus(input, result);
    return result;
  }

  // Rule 7: CIPHER>0.6 + ACCRETOR>0.4 → SMART_MONEY_ACCUM / ALERT
  if ((detectorScores.CIPHER ?? 0) > 0.6 && (detectorScores.ACCRETOR ?? 0) > 0.4) {
    const result: ScannerResult = {
      signal: 'SMART_MONEY_ACCUM',
      action: 'ALERT',
      topDetector,
      quickStatus: '',
    };
    result.quickStatus = generateQuickStatus(input, result);
    return result;
  }

  // Rule 8: ENTANGLE>0.5 → INDEPENDENT_MOVE / WATCH
  if ((detectorScores.ENTANGLE ?? 0) > 0.5) {
    const result: ScannerResult = {
      signal: 'INDEPENDENT_MOVE',
      action: 'WATCH',
      topDetector,
      quickStatus: '',
    };
    result.quickStatus = generateQuickStatus(input, result);
    return result;
  }

  // Rule 9: VPIN>0.7 + DARKMATTER>0.5 → INFORMED_TRADING / ALERT
  if (vpin > 0.7 && (detectorScores.DARKMATTER ?? 0) > 0.5) {
    const result: ScannerResult = {
      signal: 'INFORMED_TRADING',
      action: 'ALERT',
      topDetector,
      quickStatus: '',
    };
    result.quickStatus = generateQuickStatus(input, result);
    return result;
  }

  // Rule 10: BSCI dropped >0.3 from prevBsci → SIGNAL_FADE / WATCH
  if (prevBsci - bsci > 0.3) {
    const result: ScannerResult = {
      signal: 'SIGNAL_FADE',
      action: 'WATCH',
      topDetector,
      quickStatus: '',
    };
    result.quickStatus = generateQuickStatus(input, result);
    return result;
  }

  // Default: NEUTRAL / WATCH
  const result: ScannerResult = {
    signal: 'NEUTRAL',
    action: 'WATCH',
    topDetector,
    quickStatus: '',
  };
  result.quickStatus = generateQuickStatus(input, result);
  return result;
}

// ─── Helper: get previous BSCI from Redis or DB ───────────────────────────

export { generateQuickStatus, DETECTOR_SHORT, SIGNAL_LABELS };
