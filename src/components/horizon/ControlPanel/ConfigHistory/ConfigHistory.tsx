'use client';

import { useState } from 'react';
import type { ConfigHistoryEntry } from '@/lib/horizon/config/config-schema';
import { CONFIG_GROUPS_META } from '@/lib/horizon/config/default-config';

interface ConfigHistoryProps {
  history: ConfigHistoryEntry[];
  onRollback: (historyId: string, reason: string) => Promise<void>;
}

export function ConfigHistory({ history, onRollback }: ConfigHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const actionColors = {
    update: 'bg-cyan-700 text-cyan-300',
    rollback: 'bg-orange-700 text-orange-300',
    freeze: 'bg-amber-700 text-amber-300',
    unfreeze: 'bg-emerald-700 text-emerald-300',
    experiment_apply: 'bg-purple-700 text-purple-300',
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' });
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div>
      {history.map((entry) => {
        const isExpanded = expandedId === entry.id;
        const groupMeta = CONFIG_GROUPS_META[entry.group as keyof typeof CONFIG_GROUPS_META];

        return (
          <div key={entry.id} className="bg-gray-900 rounded-lg mb-3 overflow-hidden">
            <button
              onClick={() => setExpandedId(isExpanded ? null : entry.id)}
              className="w-full flex items-center gap-3 p-4 hover:bg-gray-800/50"
            >
              <div className="flex-shrink-0 text-xs text-gray-500 w-20">
                {formatDate(entry.timestamp)} {formatTime(entry.timestamp)}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${actionColors[entry.action]}`}>
                {entry.action === 'update' && 'Обновление'}
                {entry.action === 'rollback' && 'Откат'}
                {entry.action === 'freeze' && 'Заморозка'}
                {entry.action === 'unfreeze' && 'Разморозка'}
                {entry.action === 'experiment_apply' && 'Эксперимент'}
              </span>
              {groupMeta && (
                <span className="text-sm text-gray-300">
                  {groupMeta.icon} {groupMeta.label}
                </span>
              )}
              <span className="text-xs text-gray-500 truncate flex-1 text-left">
                {entry.reason}
              </span>
              <span className="text-xs text-gray-600">{entry.userId}</span>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 border-t border-gray-800">
                <div className="py-3">
                  <h4 className="text-sm font-medium text-gray-300 mb-2">Изменённые параметры</h4>
                  {Object.entries(entry.newValue).map(([key, newVal]) => {
                    const oldVal = entry.previousValue[key];
                    if (oldVal === newVal) return null;
                    return (
                      <div key={key} className="flex items-center gap-2 text-sm py-1">
                        <span className="text-gray-400">{key}:</span>
                        <span className="text-red-400">{String(oldVal)}</span>
                        <span className="text-gray-400">→</span>
                        <span className="text-green-400">{String(newVal)}</span>
                      </div>
                    );
                  })}
                </div>

                {entry.action !== 'rollback' && entry.action !== 'experiment_apply' && (
                  <div className="pt-2 border-t border-gray-800">
                    <button
                      onClick={() => {
                        const reason = prompt('Причина отката:');
                        if (reason) {
                          onRollback(entry.id, reason);
                        }
                      }}
                      className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-500"
                    >
                      ↩ Откатить
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {history.length === 0 && (
        <div className="text-center text-gray-500 py-8">
          История изменений пуста
        </div>
      )}
    </div>
  );
}