'use client';

import { useState } from 'react';
import type { Experiment } from '@/lib/horizon/config/config-schema';

interface ExperimentPanelProps {
  experiments: Experiment[];
  onCreate: (name: string, description: string, config: Record<string, unknown>, tickers: string[]) => Promise<void>;
  onStart: (id: string, controlTickers: string[]) => Promise<void>;
  onComplete: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onPromote: (id: string) => Promise<void>;
}

export function ExperimentPanel({ experiments, onCreate, onStart, onComplete, onCancel, onPromote }: ExperimentPanelProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<'all' | 'draft' | 'running' | 'completed' | 'cancelled'>('all');

  const filtered = experiments.filter((e) => filter === 'all' || e.status === filter);

  const statusColors = {
    draft: 'bg-gray-700 text-gray-300',
    running: 'bg-emerald-700 text-emerald-300',
    completed: 'bg-blue-700 text-blue-300',
    cancelled: 'bg-red-700 text-red-300',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 bg-gray-800 p-1 rounded">
          {(['all', 'draft', 'running', 'completed', 'cancelled'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs rounded ${
                filter === f ? 'bg-cyan-600 text-white' : 'text-gray-400'
              }`}
            >
              {f === 'all' ? 'Все' : f === 'draft' ? 'Черновики' : f === 'running' ? 'Активные' : f === 'completed' ? 'Завершены' : 'Отменены'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-cyan-600 text-white rounded text-sm hover:bg-cyan-500"
        >
          + Новый эксперимент
        </button>
      </div>

      <div className="space-y-3">
        {filtered.map((exp) => (
          <div key={exp.id} className="bg-gray-900 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-sm font-medium text-white">{exp.name}</h3>
                <p className="text-xs text-gray-500">{exp.description}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded ${statusColors[exp.status]}`}>
                {exp.status === 'draft' && 'ЧЕРНОВИК'}
                {exp.status === 'running' && 'АКТИВНЫЙ'}
                {exp.status === 'completed' && 'ЗАВЕРШЁН'}
                {exp.status === 'cancelled' && 'ОТМЕНЁН'}
              </span>
            </div>

            <div className="text-xs text-gray-500 mb-3">
              Тикеры: {exp.tickers.join(', ')}
            </div>

            {exp.status === 'running' && exp.metrics && (
              <div className="flex gap-4 mb-3">
                <div className="bg-gray-800 rounded p-2 text-center">
                  <div className="text-lg font-bold text-white">
                    {Object.values(exp.metrics.experimentTickerAlerts).reduce((a, b) => a + b, 0)}
                  </div>
                  <div className="text-xs text-gray-500">Эксп. алерты</div>
                </div>
                <div className="bg-gray-800 rounded p-2 text-center">
                  <div className="text-lg font-bold text-white">
                    {Object.values(exp.metrics.controlTickerAlerts).reduce((a, b) => a + b, 0)}
                  </div>
                  <div className="text-xs text-gray-500">Контр. алерты</div>
                </div>
              </div>
            )}

            {exp.status === 'completed' && exp.results && (
              <div className="mb-3">
                <span className={`text-xs px-2 py-1 rounded ${
                  exp.results.recommendation === 'promote' ? 'bg-emerald-700 text-emerald-300' :
                  exp.results.recommendation === 'revert' ? 'bg-red-700 text-red-300' :
                  'bg-yellow-700 text-yellow-300'
                }`}>
                  {exp.results.recommendation === 'promote' && '🟢 Рекомендация: ПРОМОУТИРОВАТЬ'}
                  {exp.results.recommendation === 'revert' && '🔴 Рекомендация: ОТКЛОНИТЬ'}
                  {exp.results.recommendation === 'extend' && '🟡 Рекомендация: ПРОДЛИТЬ'}
                </span>
              </div>
            )}

            <div className="flex gap-2">
              {exp.status === 'draft' && (
                <button className="px-3 py-1 bg-emerald-600 text-white text-xs rounded hover:bg-emerald-500">
                  Запустить
                </button>
              )}
              {exp.status === 'running' && (
                <button onClick={() => onComplete(exp.id)} className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-500">
                  Завершить
                </button>
              )}
              {exp.status === 'completed' && exp.results?.recommendation === 'promote' && (
                <button onClick={() => onPromote(exp.id)} className="px-3 py-1 bg-emerald-600 text-white text-xs rounded hover:bg-emerald-500">
                  Промоутировать
                </button>
              )}
              {(exp.status === 'draft' || exp.status === 'running') && (
                <button onClick={() => onCancel(exp.id)} className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-500">
                  Отменить
                </button>
              )}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            Нет экспериментов
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">Новый эксперимент</h3>
            <p className="text-gray-400 text-sm">Форма создания эксперимента (placeholder)</p>
            <button
              onClick={() => setShowCreate(false)}
              className="mt-4 px-4 py-2 bg-gray-700 text-white rounded"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}