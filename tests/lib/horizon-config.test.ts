import {
  validateConfigUpdate,
  shouldAutoRollback,
  configDiff,
} from '@/lib/horizon/config/config-validator';
import {
  ConfigUpdateRequestSchema,
  HorizonDetectorConfigSchema,
  CONFIG_GROUP_ENUM,
} from '@/lib/horizon/config/config-zod';
import { DEFAULT_HORIZON_CONFIG, CONFIG_GROUPS_META } from '@/lib/horizon/config/default-config';
import {
  computeConfidenceMultiplier,
  applyConfidenceMultiplier,
} from '@/lib/horizon/config/conf-multiplier';
import { MemoryConfigStore } from '@/lib/horizon/config/config-redis';
import { ConfigResolver } from '@/lib/horizon/config/config-resolver';
import type { CONFConfigSchema } from '@/lib/horizon/config/config-schema';

describe('Config Schema Validation', () => {
  describe('CONFIG_GROUP_ENUM', () => {
    it('should contain all expected groups', () => {
      const expected = [
        'global',
        'q10_predator',
        'q1_priceControl',
        'q8_squeeze',
        'q11_rotation',
        'q9_preImpulse',
        'q12_algorithmic',
        'cipher',
        'conf',
      ];
      expected.forEach((group) => {
        expect(CONFIG_GROUP_ENUM.options).toContain(group);
      });
    });
  });

  describe('ConfigUpdateRequestSchema', () => {
    it('should validate correct update request', () => {
      const valid = {
        group: 'q8_squeeze',
        values: { emaAlpha: 0.35, bsciMax: 0.15 },
        reason: 'Test change',
      };
      expect(ConfigUpdateRequestSchema.safeParse(valid).success).toBe(true);
    });

    it('should reject invalid group', () => {
      const invalid = {
        group: 'invalid_group',
        values: { emaAlpha: 0.35 },
        reason: 'Test',
      };
      expect(ConfigUpdateRequestSchema.safeParse(invalid).success).toBe(false);
    });

    it('should reject short reason', () => {
      const invalid = {
        group: 'q8_squeeze',
        values: { emaAlpha: 0.35 },
        reason: 'ab',
      };
      expect(ConfigUpdateRequestSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('HorizonDetectorConfigSchema', () => {
    it('should validate default config', () => {
      expect(HorizonDetectorConfigSchema.safeParse(DEFAULT_HORIZON_CONFIG).success).toBe(true);
    });

    it('should reject invalid confidence weights', () => {
      const invalid = {
        ...DEFAULT_HORIZON_CONFIG,
        conf: {
          ...DEFAULT_HORIZON_CONFIG.conf,
          factors: {
            cancelRatioWeight: 1.0,
            cipherWeight: 1.0,
            icebergWeight: 1.0,
            sessionPhaseWeight: 1.0,
            dataQualityWeight: 1.0,
          },
        },
      };
      expect(HorizonDetectorConfigSchema.safeParse(invalid).success).toBe(false);
    });
  });
});

describe('Config Validator', () => {
  describe('validateConfigUpdate', () => {
    it('should validate valid update', () => {
      const result = validateConfigUpdate(DEFAULT_HORIZON_CONFIG, {
        group: 'q8_squeeze',
        values: { emaAlpha: 0.35 },
        reason: 'Test',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect unknown parameter', () => {
      const result = validateConfigUpdate(DEFAULT_HORIZON_CONFIG, {
        group: 'q8_squeeze',
        values: { unknownParam: 123 },
        reason: 'Test',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'unknownParam')).toBe(true);
    });

    it('should detect >50% change and add warning', () => {
      const result = validateConfigUpdate(DEFAULT_HORIZON_CONFIG, {
        group: 'q8_squeeze',
        values: { emaAlpha: 0.1 }, // 0.4 -> 0.1 is 75% change
        reason: 'Test',
      });
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.field === 'emaAlpha')).toBe(true);
    });

    it('should detect low CIPHER threshold warning', () => {
      const result = validateConfigUpdate(DEFAULT_HORIZON_CONFIG, {
        group: 'cipher',
        values: { threshold: 0.3 },
        reason: 'Test',
      });
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.field === 'threshold')).toBe(true);
    });

    it('should detect invalid confidence weights', () => {
      const result = validateConfigUpdate(DEFAULT_HORIZON_CONFIG, {
        group: 'conf',
        values: {
          'factors.cancelRatioWeight': 0.5,
          'factors.cipherWeight': 0.5,
          'factors.icebergWeight': 0.5,
          'factors.sessionPhaseWeight': 0.5,
          'factors.dataQualityWeight': 0.5,
        },
        reason: 'Test',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'factors')).toBe(true);
    });
  });

  describe('shouldAutoRollback', () => {
    it('should not rollback when sigma below threshold', () => {
      const result = shouldAutoRollback(50, 55, 10, 3.0);
      expect(result.rollback).toBe(false);
      expect(result.observedSigma).toBe(0.5);
    });

    it('should rollback when sigma above threshold', () => {
      const result = shouldAutoRollback(50, 100, 10, 3.0);
      expect(result.rollback).toBe(true);
      expect(result.observedSigma).toBe(5.0);
    });

    it('should not rollback when std is zero', () => {
      const result = shouldAutoRollback(50, 100, 0, 3.0);
      expect(result.rollback).toBe(false);
      expect(result.observedSigma).toBe(0);
    });
  });

  describe('configDiff', () => {
    it('should return changed fields', () => {
      const prev = { a: 1, b: 2, c: 3 };
      const next = { a: 1, b: 5, c: 3 };
      const diff = configDiff(prev, next);
      expect(diff).toHaveLength(1);
      expect(diff[0]).toEqual({ key: 'b', from: 2, to: 5 });
    });

    it('should return empty for identical objects', () => {
      const obj = { a: 1, b: 2 };
      const diff = configDiff(obj, obj);
      expect(diff).toHaveLength(0);
    });
  });
});

describe('Confidence Multiplier', () => {
  const confConfig: CONFConfigSchema = {
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
  };

  describe('computeConfidenceMultiplier', () => {
    it('should return 1.0 when disabled', () => {
      const disabled = { ...confConfig, enabled: false };
      const slotData = { cancelRatio: 0.5, cipherScore: 0.5, icebergCount: 3, tradeCount: 30 };
      expect(computeConfidenceMultiplier(slotData, disabled)).toBe(1.0);
    });

    it('should apply multiplier correctly', () => {
      const slotData = { cancelRatio: 0.5, cipherScore: 0.5, icebergCount: 3, tradeCount: 30 };
      const result = computeConfidenceMultiplier(slotData, confConfig);
      expect(result).toBeGreaterThanOrEqual(0.5);
      expect(result).toBeLessThanOrEqual(2.0);
    });

    it('should respect floor', () => {
      const lowFloorConfig = { ...confConfig, confidenceFloor: 0.9 };
      const slotData = { cancelRatio: 0.99, cipherScore: 0, icebergCount: 0, tradeCount: 5 };
      const result = computeConfidenceMultiplier(slotData, lowFloorConfig);
      expect(result).toBeGreaterThanOrEqual(0.9);
    });

    it('should respect ceiling', () => {
      const highCeilingConfig = { ...confConfig, confidenceCeiling: 1.1 };
      const slotData = { cancelRatio: 0, cipherScore: 1, icebergCount: 10, tradeCount: 100 };
      const result = computeConfidenceMultiplier(slotData, highCeilingConfig);
      expect(result).toBeLessThanOrEqual(1.1);
    });
  });

  describe('applyConfidenceMultiplier', () => {
    it('should return original BSCI when disabled', () => {
      const disabled = { ...confConfig, enabled: false };
      const slotData = { cancelRatio: 0.5, cipherScore: 0.5, icebergCount: 3, tradeCount: 30 };
      expect(applyConfidenceMultiplier(0.75, slotData, disabled)).toBe(0.75);
    });

    it('should multiply BSCI by confidence', () => {
      const slotData = { cancelRatio: 0.5, cipherScore: 0.5, icebergCount: 3, tradeCount: 30 };
      const result = applyConfidenceMultiplier(0.75, slotData, confConfig);
      expect(result).not.toBe(0.75);
      expect(result).toBeCloseTo(0.75 * computeConfidenceMultiplier(slotData, confConfig), 3);
    });
  });
});

describe('Config Resolver', () => {
  let store: MemoryConfigStore;
  let resolver: ConfigResolver;

  beforeEach(() => {
    store = new MemoryConfigStore();
    resolver = new ConfigResolver(store);
  });

  describe('resolve()', () => {
    it('should return runtime config', async () => {
      const runtime = await resolver.resolve();
      expect(runtime).toHaveProperty('global');
      expect(runtime).toHaveProperty('q8_squeeze');
      expect(runtime).toHaveProperty('conf');
    });

    it('should cache results', async () => {
      const first = await resolver.resolve();
      const second = await resolver.resolve();
      expect(first).toBe(second);
    });
  });

  describe('invalidateCache()', () => {
    it('should force new resolution', async () => {
      const first = await resolver.resolve();
      resolver.invalidateCache();
      const second = await resolver.resolve();
      expect(first).not.toBe(second);
    });
  });

  describe('resolveGroup()', () => {
    it('should resolve specific group', async () => {
      const group = await resolver.resolveGroup('q8_squeeze');
      expect(group).toHaveProperty('emaAlpha');
      expect(group).toHaveProperty('bsciMax');
    });
  });
});

describe('Config Groups Meta', () => {
  describe('CONFIG_GROUPS_META', () => {
    it('should have all groups', () => {
      const groups = [
        'global',
        'q10_predator',
        'q1_priceControl',
        'q8_squeeze',
        'q11_rotation',
        'q9_preImpulse',
        'q12_algorithmic',
        'cipher',
        'conf',
      ];
      groups.forEach((group) => {
        expect(CONFIG_GROUPS_META[group as keyof typeof CONFIG_GROUPS_META]).toBeDefined();
      });
    });

    it('should have valid UI metadata', () => {
      Object.values(CONFIG_GROUPS_META).forEach((meta) => {
        expect(meta.label).toBeDefined();
        expect(meta.icon).toBeDefined();
        expect(meta.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(meta.params).toBeDefined();
        expect(meta.params.length).toBeGreaterThan(0);
      });
    });
  });
});