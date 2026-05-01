'use client';

import { useState, useRef, useEffect } from 'react';
import { CONFIG_GROUPS_META, CONFIG_GROUP_ORDER } from '@/lib/horizon/config/default-config';
import type { ConfigGroup, HorizonDetectorConfig, ConfigPreviewResponse } from '@/lib/horizon/config/config-schema';

interface LivePreviewProps {
  config: HorizonDetectorConfig;
}

export function LivePreview({ config }: LivePreviewProps) {
  const [group, setGroup] = useState<ConfigGroup>('q8_squeeze');
  const [ticker, setTicker] = useState('GAZP');
  const [proposedValues, setProposedValues] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<ConfigPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const meta = CONFIG_GROUPS_META[group];
  const currentValues = config[group] as Record<string, number>;

  const handleValueChange = (key: string, value: number) => {
    setProposedValues((prev) => ({ ...prev, [key]: value }));

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      runPreview();
    }, 800);
  };

  const runPreview = async () => {
    if (Object.keys(proposedValues).length === 0) return;

    setLoading(true);
    try {
      const res = await fetch('/api/horizon/config/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group,
          values: proposedValues,
          ticker,
        }),
      });
      const data = await res.json();
      setPreview(data);
    } catch (err) {
      console.error('Preview failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const riskColors = {
    low: 'bg-emerald-900 text-emerald-300 border-emerald-700',
    medium: 'bg-yellow-900 text-yellow-300 border-yellow-700',
    high: 'bg-orange-900 text-orange-300 border-orange-700',
    critical: 'bg-red-900 text-red-300 border-red-700',
  };

  return (
    <div>
      <div className="flex gap-4 mb-6">
        <select
          value={group}
          onChange={(e) => {
            setGroup(e.target.value as ConfigGroup);
            setProposedValues({});
            setPreview(null);
          }}
          className="bg-gray-800 text-white px-4 py-2 rounded border border-gray-700"
        >
          {CONFIG_GROUP_ORDER.map((g) => (
            <option key={g} value={g}>
              {CONFIG_GROUPS_META[g].icon} {CONFIG_GROUPS_META[g].label}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Тикер"
          className="bg-gray-800 text-white px-4 py-2 rounded border border-gray-700 w-24"
        />

        <button
          onClick={runPreview}
          disabled={loading || Object.keys(proposedValues).length === 0}
          className="px-4 py-2 bg-cyan-600 text-white rounded hover:bg-cyan-500 disabled:opacity-50"
        >
          {loading ? '⏳ Расчёт...' : 'Запустить Preview'}
        </button>
      </div>

      <div className="bg-gray-900 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-gray-300 mb-4">Предлагаемые значения</h3>
        {meta.params.map((param) => {
          if (param.type !== 'number') return null;
          const current = currentValues[param.key] as number;
          const proposed = proposedValues[param.key] ?? current;

          return (
            <div key={param.key} className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-400">{param.label}</span>
                <span className="text-xs text-gray-500">
                  Текущее: {current}
                </span>
              </div>
              <input
                type="range"
                min={param.min}
                max={param.max}
                step={param.step}
                value={proposed}
                onChange={(e) => handleValueChange(param.key, parseFloat(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>{param.min}</span>
                <span className="text-cyan-400 font-medium">{proposed}</span>
                <span>{param.max}</span>
              </div>
            </div>
          );
        })}
      </div>

      {preview && (
        <div className={`rounded-lg p-4 border ${riskColors[preview.delta.riskLevel]}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">
              {preview.delta.riskLevel === 'low' && '✅ НИЗКИЙ РИСК'}
              {preview.delta.riskLevel === 'medium' && '⚠️ СРЕДНИЙ РИСК'}
              {preview.delta.riskLevel === 'high' && '🚨 ВЫСОКИЙ РИСК'}
              {preview.delta.riskLevel === 'critical' && '🔴 КРИТИЧЕСКИЙ РИСК'}
            </h3>
            <span className="text-lg font-bold">
              Δ {preview.delta.alertsDelta > 0 ? '+' : ''}{preview.delta.alertsDelta} алертов
            </span>
          </div>

          {preview.delta.warnings.length > 0 && (
            <div className="mb-4">
              {preview.delta.warnings.map((w, i) => (
                <p key={i} className="text-sm text-gray-300">• {w}</p>
              ))}
            </div>
          )}

          {preview.delta.affectedDetectors.length > 0 && (
            <p className="text-sm text-gray-400">
              Затронуты: {preview.delta.affectedDetectors.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}