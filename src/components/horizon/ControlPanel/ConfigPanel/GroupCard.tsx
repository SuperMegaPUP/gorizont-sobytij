'use client';

import { useState } from 'react';
import type { ConfigGroupMeta } from '@/lib/horizon/config/default-config';

interface GroupCardProps {
  meta: ConfigGroupMeta;
  values: Record<string, number | string | boolean>;
  defaults: Record<string, number | string | boolean>;
  frozen: boolean;
  onChange: (key: string, value: number | string | boolean) => void;
  onApply: () => void;
  onReset: () => void;
}

export function GroupCard({ meta, values, defaults, frozen, onChange, onApply, onReset }: GroupCardProps) {
  const [expanded, setExpanded] = useState(true);

  const hasChanges = Object.keys(values).some((k) => values[k] !== defaults[k]);

  return (
    <div className="bg-gray-900 rounded-lg mb-4 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{meta.icon}</span>
          <div className="text-left">
            <h3 className="text-sm font-medium text-gray-200">{meta.label}</h3>
            <p className="text-xs text-gray-500">{meta.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {frozen && (
            <span className="text-xs bg-amber-900 text-amber-300 px-2 py-0.5 rounded">
              FROZEN
            </span>
          )}
          {hasChanges && (
            <span className="text-xs bg-cyan-900 text-cyan-300 px-2 py-0.5 rounded">
              ИЗМЕНЕНО
            </span>
          )}
          <span className="text-gray-400 text-lg">{expanded ? '▼' : '▶'}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {meta.params.map((param) => {
            const value = values[param.key] ?? defaults[param.key];
            const isChanged = value !== defaults[param.key];

            if (param.type === 'boolean') {
              return (
                <div key={param.key} className="py-3 border-b border-gray-800 last:border-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-gray-200 font-medium">{param.label}</span>
                      {param.description && (
                        <p className="text-xs text-gray-500 mt-0.5">{param.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => onChange(param.key, !value)}
                      disabled={frozen}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        value ? 'bg-cyan-600' : 'bg-gray-700'
                      } ${frozen ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                          value ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              );
            }

            if (param.type === 'number') {
              return (
                <div key={param.key} className="py-3 border-b border-gray-800 last:border-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-200 font-medium">{param.label}</span>
                      {param.category !== 'primary' && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          param.category === 'advanced' ? 'bg-blue-900/50 text-blue-400' : 'bg-red-900/50 text-red-400'
                        }`}>
                          {param.category === 'advanced' ? 'A' : 'E'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${isChanged ? 'text-cyan-400' : 'text-gray-400'}`}>
                        {value}{param.unit || ''}
                      </span>
                      {isChanged && (
                        <span className="text-xs text-gray-500">(было {defaults[param.key]})</span>
                      )}
                    </div>
                  </div>
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={value as number}
                    disabled={frozen}
                    onChange={(e) => onChange(param.key, parseFloat(e.target.value))}
                    className="w-full h-1 rounded-lg appearance-none bg-gray-700 cursor-pointer disabled:opacity-50"
                  />
                  {param.description && (
                    <p className="text-xs text-gray-500 mt-1">{param.description}</p>
                  )}
                </div>
              );
            }

            return (
              <div key={param.key} className="py-3 border-b border-gray-800 last:border-0">
                <div className="mb-1">
                  <span className="text-sm text-gray-200 font-medium">{param.label}</span>
                </div>
                <input
                  type="text"
                  value={value as string}
                  disabled={frozen}
                  onChange={(e) => onChange(param.key, e.target.value)}
                  className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 disabled:opacity-50"
                />
                {param.description && (
                  <p className="text-xs text-gray-500 mt-1">{param.description}</p>
                )}
              </div>
            );
          })}

          {hasChanges && (
            <div className="mt-4 flex gap-2">
              <button
                onClick={onApply}
                disabled={frozen}
                className="flex-1 py-2 bg-cyan-600 text-white rounded text-sm hover:bg-cyan-500 disabled:opacity-50"
              >
                Применить изменения
              </button>
              <button
                onClick={onReset}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded text-sm hover:bg-gray-600"
              >
                Сбросить
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}