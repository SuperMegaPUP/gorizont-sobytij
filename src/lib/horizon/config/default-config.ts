import type { HorizonDetectorConfig, ConfigGroup } from './config-schema';

export const DEFAULT_HORIZON_CONFIG: HorizonDetectorConfig = {
  global: {
    shadowMode: false,
    timezone: 'Europe/Moscow',
    sessionStart: '07:00',
    sessionEnd: '18:50',
    eveningCutoff: '19:05',
    maxChangesPerSession: 5,
    autoRollbackSigma: 3.0,
    autoRollbackWindowMin: 60,
  },
  q10_predator: {
    emaAlpha: 0.3,
    zScoreThreshold: 2.5,
    sessionReset: true,
  },
  q1_priceControl: {
    ofiWindow: 20,
    rtofiWindow: 20,
    divergenceSigma: 2.0,
    ofiMinAbsolute: 0.3,
  },
  q8_squeeze: {
    emaAlpha: 0.4,
    cancelDropThreshold: -0.10,
    cancelLowThreshold: 0.50,
    bsciMax: 0.20,
    vwapDeviationMax: 0.015,
    atrPctMax: 60,
    cancelWindow: 3,
    kvTimeoutMs: 500,
  },
  q11_rotation: {
    scoreThreshold: 5,
    maxScore: 12,
    minTrades: 30,
  },
  q9_preImpulse: {
    tier1VolumeDrop: 0.30,
    tier1CancelPct: 0.70,
    tier2BsciLow: 0.02,
    tier2BsciHigh: 0.15,
    tier2SilenceBars: 10,
    mainSessionOnly: true,
  },
  q12_algorithmic: {
    robotVolThreshold: 0.70,
    robotVolWindow: 30,
    eveningCutoff: '19:05',
  },
  cipher: {
    threshold: 0.50,
    percentilePenaltyEnabled: true,
    cnPenaltyBands: [
      { min: 0, max: 100000, penalty: 0 },
      { min: 100000, max: 500000, penalty: 0.1 },
      { min: 500000, max: 2000000, penalty: 0.25 },
      { min: 2000000, max: 10000000, penalty: 0.5 },
      { min: 10000000, max: Infinity, penalty: 0.75 },
    ],
  },
  conf: {
    enabled: true,
    confidenceFloor: 0.5,
    confidenceCeiling: 2.0,
    factors: {
      cancelRatioWeight: 0.25,
      cipherWeight: 0.20,
      icebergWeight: 0.15,
      sessionPhaseWeight: 0.20,
      dataQualityWeight: 0.20,
    },
  },
};

export interface ConfigGroupMeta {
  key: ConfigGroup;
  label: string;
  icon: string;
  color: string;
  description: string;
  params: Array<{
    key: string;
    label: string;
    type: 'number' | 'string' | 'boolean';
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    description: string;
    category: 'primary' | 'advanced' | 'expert';
  }>;
}

export const CONFIG_GROUPS_META: Record<ConfigGroup, ConfigGroupMeta> = {
  global: {
    key: 'global',
    label: 'Глобальные',
    icon: '🌐',
    color: '#6366f1',
    description: 'Глобальные параметры системы',
    params: [
      { key: 'shadowMode', label: 'Shadow Mode', type: 'boolean', description: 'Новые детекторы логируют, не влияя на алерты', category: 'advanced' },
      { key: 'timezone', label: 'Часовой пояс', type: 'string', description: 'Часовой пояс для расписания сессий', category: 'primary' },
      { key: 'sessionStart', label: 'Начало сессии', type: 'string', description: 'Время начала основной сессии (HH:MM)', category: 'primary' },
      { key: 'sessionEnd', label: 'Конец сессии', type: 'string', description: 'Время окончания основной сессии (HH:MM)', category: 'primary' },
      { key: 'eveningCutoff', label: 'Вечерний cutoff', type: 'string', description: 'Время окончания вечерней сессии (HH:MM)', category: 'advanced' },
      { key: 'maxChangesPerSession', label: 'Макс. изменений/сессию', type: 'number', min: 1, max: 20, step: 1, description: 'Rate limit на изменения в сессии', category: 'primary' },
      { key: 'autoRollbackSigma', label: 'Auto-rollback σ', type: 'number', min: 1.0, max: 5.0, step: 0.1, description: 'Порог σ для авто-отката', category: 'advanced' },
      { key: 'autoRollbackWindowMin', label: 'Auto-rollback окно (мин)', type: 'number', min: 5, max: 1440, step: 5, description: 'Окно мониторинга для авто-отката', category: 'expert' },
    ],
  },
  q10_predator: {
    key: 'q10_predator',
    label: 'Q-10 PREDATOR EMA',
    icon: '🦅',
    color: '#ef4444',
    description: 'Сглаживание EMA для PREDATOR',
    params: [
      { key: 'emaAlpha', label: 'EMA Alpha', type: 'number', min: 0.05, max: 0.95, step: 0.05, description: 'Коэффициент сглаживания', category: 'primary' },
      { key: 'zScoreThreshold', label: 'Z-score порог', type: 'number', min: 1.0, max: 4.0, step: 0.1, description: 'Порог всплеска', category: 'primary' },
      { key: 'sessionReset', label: 'Сброс EMA за сессию', type: 'boolean', description: 'Очищать EMA при новой сессии', category: 'advanced' },
    ],
  },
  q1_priceControl: {
    key: 'q1_priceControl',
    label: 'Q-1 Price Control',
    icon: '⚖️',
    color: '#f59e0b',
    description: 'OFI/rtOFI дивергенция и подавление цены',
    params: [
      { key: 'ofiWindow', label: 'OFI окно', type: 'number', min: 5, max: 60, step: 5, description: 'σ-нормировка OFI', category: 'primary' },
      { key: 'rtofiWindow', label: 'rtOFI окно', type: 'number', min: 5, max: 60, step: 5, description: 'σ-нормировка rtOFI', category: 'primary' },
      { key: 'divergenceSigma', label: 'Дивергенция σ', type: 'number', min: 1.0, max: 4.0, step: 0.1, description: 'Множитель порога расхождения', category: 'primary' },
      { key: 'ofiMinAbsolute', label: 'OFI минимум', type: 'number', min: 0.1, max: 1.0, step: 0.05, description: 'Мин. |OFI| для триггера', category: 'advanced' },
    ],
  },
  q8_squeeze: {
    key: 'q8_squeeze',
    label: 'Q-8 SQUEEZE ALERT',
    icon: '🫧',
    color: '#06b6d4',
    description: 'Сжатие: низкая волатильность + падение Cancel%',
    params: [
      { key: 'emaAlpha', label: 'EMA Alpha Cancel%', type: 'number', min: 0.1, max: 0.9, step: 0.05, description: 'Сглаживание EMA для Cancel%', category: 'primary' },
      { key: 'cancelDropThreshold', label: 'Cancel% DROP', type: 'number', min: -0.30, max: -0.02, step: 0.01, description: 'Δ EMA для trending_down', category: 'primary' },
      { key: 'cancelLowThreshold', label: 'Cancel% низкий', type: 'number', min: 0.20, max: 0.80, step: 0.05, description: 'Абсолютный порог', category: 'primary' },
      { key: 'bsciMax', label: 'BSCI макс', type: 'number', min: 0.05, max: 0.40, step: 0.01, description: 'Верхняя граница BSCI', category: 'primary' },
      { key: 'vwapDeviationMax', label: 'VWAP макс', type: 'number', min: 0.005, max: 0.05, step: 0.005, description: 'Макс. отклонение от VWAP', category: 'advanced' },
      { key: 'atrPctMax', label: 'ATR перцентиль', type: 'number', min: 20, max: 90, step: 5, unit: '%', description: 'Макс. ATR перцентиль', category: 'primary' },
      { key: 'cancelWindow', label: 'Cancel rolling', type: 'number', min: 1, max: 10, step: 1, description: 'Rolling window', category: 'advanced' },
      { key: 'kvTimeoutMs', label: 'KV Timeout', type: 'number', min: 200, max: 2000, step: 100, unit: 'мс', description: 'Timeout EMA read из KV', category: 'expert' },
    ],
  },
  q11_rotation: {
    key: 'q11_rotation',
    label: 'Q-11 ROTATION',
    icon: '🔄',
    color: '#8b5cf6',
    description: 'Скоринговая система вращения ордеров',
    params: [
      { key: 'scoreThreshold', label: 'Порог баллов', type: 'number', min: 3, max: 10, step: 1, description: 'Мин. баллов для ROTATION', category: 'primary' },
      { key: 'maxScore', label: 'Макс. баллов', type: 'number', min: 8, max: 20, step: 1, description: 'Максимально возможный', category: 'advanced' },
      { key: 'minTrades', label: 'Мин. сделок', type: 'number', min: 20, max: 100, step: 10, description: 'Мин. сделок в окне', category: 'advanced' },
    ],
  },
  q9_preImpulse: {
    key: 'q9_preImpulse',
    label: 'Q-9 PRE-IMPULSE',
    icon: '⚡',
    color: '#f97316',
    description: 'Тишина перед импульсом: Tier 1 + Tier 2',
    params: [
      { key: 'tier1VolumeDrop', label: 'Tier1 объём', type: 'number', min: 0.10, max: 0.60, step: 0.05, description: 'Порог падения объёма', category: 'primary' },
      { key: 'tier1CancelPct', label: 'Tier1 Cancel%', type: 'number', min: 0.50, max: 0.99, step: 0.05, description: 'Порог Cancel%', category: 'primary' },
      { key: 'tier2BsciLow', label: 'Tier2 BSCI низ', type: 'number', min: 0.01, max: 0.10, step: 0.01, description: 'Нижняя граница BSCI', category: 'primary' },
      { key: 'tier2BsciHigh', label: 'Tier2 BSCI верх', type: 'number', min: 0.10, max: 0.30, step: 0.01, description: 'Верхняя граница BSCI', category: 'primary' },
      { key: 'tier2SilenceBars', label: 'Tier2 баров тишины', type: 'number', min: 5, max: 30, step: 1, description: 'Мин. баров молчания', category: 'advanced' },
      { key: 'mainSessionOnly', label: 'Только основная', type: 'boolean', description: 'Фаза MAIN только', category: 'advanced' },
    ],
  },
  q12_algorithmic: {
    key: 'q12_algorithmic',
    label: 'Q-12 ALGORITHMIC RESET',
    icon: '🤖',
    color: '#14b8a6',
    description: 'Алгоритмический сброс: robotVol + evening guard',
    params: [
      { key: 'robotVolThreshold', label: 'Robot Vol порог', type: 'number', min: 0.40, max: 0.95, step: 0.05, description: 'Доля робот-объёма', category: 'primary' },
      { key: 'robotVolWindow', label: 'Robot Vol окно', type: 'number', min: 10, max: 60, step: 5, description: 'Окно расчёта', category: 'advanced' },
      { key: 'eveningCutoff', label: 'Evening cutoff', type: 'string', description: 'HH:MM cutoff', category: 'expert' },
    ],
  },
  cipher: {
    key: 'cipher',
    label: 'CIPHER',
    icon: '🔐',
    color: '#ec4899',
    description: 'Шифр: порог + CN перцентильный штраф',
    params: [
      { key: 'threshold', label: 'Порог обнаружения', type: 'number', min: 0.30, max: 0.80, step: 0.05, description: 'Мин. CIPHER для триггера', category: 'primary' },
      { key: 'percentilePenaltyEnabled', label: 'CN штраф', type: 'boolean', description: 'Перцентильный штраф за крупный CN', category: 'primary' },
    ],
  },
  conf: {
    key: 'conf',
    label: 'CONFIDENCE → effectiveSignal',
    icon: '🎯',
    color: '#10b981',
    description: 'Confidence множитель → effectiveSignal (НЕ мутирует BSCI!)',
    params: [
      { key: 'enabled', label: 'Включён', type: 'boolean', description: 'Применять confidence multiplier', category: 'primary' },
      { key: 'confidenceFloor', label: 'Мин. множитель', type: 'number', min: 0.1, max: 1.0, step: 0.1, description: 'Нижняя граница', category: 'primary' },
      { key: 'confidenceCeiling', label: 'Макс. множитель', type: 'number', min: 1.0, max: 3.0, step: 0.1, description: 'Верхняя граница', category: 'primary' },
      { key: 'factors.cancelRatioWeight', label: 'CancelRatio вес', type: 'number', min: 0, max: 0.5, step: 0.05, description: 'Вес Cancel% в confidence', category: 'advanced' },
      { key: 'factors.cipherWeight', label: 'CIPHER вес', type: 'number', min: 0, max: 0.5, step: 0.05, description: 'Вес CIPHER в confidence', category: 'advanced' },
      { key: 'factors.icebergWeight', label: 'Iceberg вес', type: 'number', min: 0, max: 0.5, step: 0.05, description: 'Вес Iceberg в confidence', category: 'advanced' },
      { key: 'factors.sessionPhaseWeight', label: 'Session вес', type: 'number', min: 0, max: 0.5, step: 0.05, description: 'Вес фазы сессии', category: 'advanced' },
      { key: 'factors.dataQualityWeight', label: 'DataQuality вес', type: 'number', min: 0, max: 0.5, step: 0.05, description: 'Вес качества данных', category: 'advanced' },
    ],
  },
};

export const CONFIG_GROUP_ORDER: ConfigGroup[] = [
  'global', 'q10_predator', 'q1_priceControl', 'q8_squeeze',
  'q11_rotation', 'q9_preImpulse', 'q12_algorithmic', 'cipher', 'conf',
];