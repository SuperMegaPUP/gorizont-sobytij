import type { HorizonDetectorConfig, ConfigGroup, ConfigValidationResult, ConfigUpdateRequest } from './config-schema';
import { CONFIG_GROUPS_META } from './default-config';
import { ConfigUpdateRequestSchema } from './config-zod';

export function validateConfigUpdate(
  config: HorizonDetectorConfig,
  request: ConfigUpdateRequest
): ConfigValidationResult {
  const errors: Array<{ field: string; message: string; value: unknown; constraint: string }> = [];
  const warnings: Array<{ field: string; message: string }> = [];

  const zodResult = ConfigUpdateRequestSchema.safeParse(request);
  if (!zodResult.success) {
    for (const issue of zodResult.error.issues) {
      errors.push({
        field: issue.path.join('.'),
        message: issue.message,
        value: undefined,
        constraint: issue.code,
      });
    }
    return { valid: false, errors, warnings };
  }

  const { group, values } = request;
  const currentGroup = config[group] as Record<string, unknown>;

  for (const [key, value] of Object.entries(values)) {
    const paramMeta = CONFIG_GROUPS_META[group]?.params.find((p) => p.key === key);
    if (!paramMeta) {
      errors.push({
        field: key,
        message: `Unknown parameter: ${key}`,
        value,
        constraint: 'must be known parameter',
      });
      continue;
    }

    if (paramMeta.type === 'number' && typeof value === 'number') {
      if (paramMeta.min !== undefined && value < paramMeta.min) {
        errors.push({
          field: key,
          message: `Value ${value} below minimum ${paramMeta.min}`,
          value,
          constraint: `min=${paramMeta.min}`,
        });
      }
      if (paramMeta.max !== undefined && value > paramMeta.max) {
        errors.push({
          field: key,
          message: `Value ${value} above maximum ${paramMeta.max}`,
          value,
          constraint: `max=${paramMeta.max}`,
        });
      }

      const currentVal = currentGroup[key];
      if (typeof currentVal === 'number' && currentVal !== 0) {
        const pctChange = Math.abs((value - currentVal) / currentVal);
        if (pctChange > 0.5) {
          warnings.push({
            field: key,
            message: `Изменение >50%: ${currentVal} → ${value} (${(pctChange * 100).toFixed(0)}%)`,
          });
        }
      }
    }
  }

  if (group === 'conf') {
    const weightKeys = Object.keys(values).filter((k) => k.startsWith('factors.'));
    if (weightKeys.length > 0) {
      const newFactors = { ...config.conf.factors };
      for (const wk of weightKeys) {
        const fk = wk.replace('factors.', '') as keyof typeof newFactors;
        if (fk in newFactors && typeof values[wk] === 'number') {
          (newFactors as Record<string, number>)[fk] = values[wk] as number;
        }
      }
      const totalWeight = Object.values(newFactors).reduce((a, b) => a + b, 0);
      if (Math.abs(totalWeight - 1.0) > 0.15) {
        errors.push({
          field: 'factors',
          message: `Сумма весов = ${totalWeight.toFixed(2)}, должна быть ~1.0`,
          value: totalWeight,
          constraint: 'sum ≈ 1.0',
        });
      }
    }
  }

  if (group === 'cipher' && typeof values.threshold === 'number' && values.threshold < 0.4) {
    warnings.push({
      field: 'threshold',
      message: 'Низкий CIPHER порог — возможен рост ложных срабатываний',
    });
  }
  if (group === 'conf' && typeof values.confidenceCeiling === 'number' && values.confidenceCeiling > 2.0) {
    warnings.push({
      field: 'confidenceCeiling',
      message: 'Высокий confidence ceiling — effectiveSignal может выйти за диапазон',
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function shouldAutoRollback(
  baselineAlertRate: number,
  currentAlertRate: number,
  baselineStd: number,
  sigmaThreshold: number
): { rollback: boolean; observedSigma: number } {
  if (baselineStd === 0) return { rollback: false, observedSigma: 0 };
  
  const observedSigma = Math.abs(currentAlertRate - baselineAlertRate) / baselineStd;
  return { rollback: observedSigma > sigmaThreshold, observedSigma };
}

export function configDiff(
  previous: Record<string, unknown>,
  next: Record<string, unknown>
): Array<{ key: string; from: unknown; to: unknown }> {
  return Object.keys(next)
    .filter((key) => previous[key] !== next[key])
    .map((key) => ({ key, from: previous[key], to: next[key] }));
}