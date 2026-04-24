// ─── BSCI Color System — shared utility functions ─────────────────────────
// Used across all Horizon frames for consistent color mapping

export function getBsciColor(bsci: number): { bg: string; border: string; text: string } {
  if (bsci > 0.7) return { bg: 'bg-red-900/50', border: 'border-red-500', text: 'text-red-400' };
  if (bsci > 0.4) return { bg: 'bg-orange-900/50', border: 'border-orange-500', text: 'text-orange-400' };
  if (bsci > 0.2) return { bg: 'bg-yellow-900/50', border: 'border-yellow-500', text: 'text-yellow-400' };
  return { bg: 'bg-green-900/50', border: 'border-green-500', text: 'text-green-400' };
}

export function getBsciEmoji(bsci: number): string {
  if (bsci > 0.7) return '\uD83D\uDD34';
  if (bsci > 0.4) return '\uD83D\uDFE0';
  if (bsci > 0.2) return '\uD83D\uDFE1';
  return '\uD83D\uDFE2';
}

export function getDetectorDot(score: number): { char: string; color: string } {
  if (score > 0.7) return { char: '\uD83D\uDD34', color: 'text-red-400' };    // red pulse
  if (score > 0.4) return { char: '\u25CF', color: 'text-orange-400' };  // orange active
  if (score > 0.2) return { char: '\u25D0', color: 'text-yellow-400' };  // yellow suspicion
  return { char: '\u25CB', color: 'text-gray-600' };                      // gray inactive
}

export function getDirectionArrow(direction: string, confidence: number): { char: string; color: string; bold: boolean } {
  if (direction === 'BULLISH') return { char: '\u25B2', color: 'text-green-400', bold: confidence > 0.7 };
  if (direction === 'BEARISH') return { char: '\u25BC', color: 'text-red-400', bold: confidence > 0.7 };
  return { char: '\u25CF', color: 'text-gray-400', bold: false };
}

export function getBsciLevel(bsci: number): 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' {
  if (bsci > 0.7) return 'RED';
  if (bsci > 0.4) return 'ORANGE';
  if (bsci > 0.2) return 'YELLOW';
  return 'GREEN';
}
