// ─── Detectors — экспорт ──────────────────────────────────────────────────

export type { DetectorInput, DetectorResult, DetectorSignal, DetectorName, IDetector } from './types';
export { DETECTOR_NAMES } from './types';

export { detectGraviton } from './graviton';
export { detectDarkmatter } from './darkmatter';
export { detectAccretor } from './accretor';
export { detectDecoherence } from './decoherence';
export { detectHawking } from './hawking';
export { detectPredator, resetPredatorState } from './predator';
export { detectCipher } from './cipher';
export { detectEntangle } from './entangle';
export { detectWavefunction } from './wavefunction';
export { detectAttractor } from './attractor';

export { ALL_DETECTORS, runAllDetectors, runDetector, calcBSCI } from './registry';
export type { BSCIResult, BSCIContext } from './registry';

export { checkGuards, stalePenalty, safeDivide, clampScore } from './guards';
export type { GuardInput } from './guards';
