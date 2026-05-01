'use client';

import { useState } from 'react';
import { GroupCard } from './GroupCard';
import { CONFIG_GROUPS_META, CONFIG_GROUP_ORDER } from '@/lib/horizon/config/default-config';
import type { HorizonDetectorConfig, ConfigGroup } from '@/lib/horizon/config/config-schema';

interface ConfigPanelProps {
  config: HorizonDetectorConfig;
  defaults: HorizonDetectorConfig;
  frozen: boolean;
  onUpdate: (group: ConfigGroup, values: Record<string, unknown>, reason: string) => Promise<void>;
}

export function ConfigPanel({ config, defaults, frozen, onUpdate }: ConfigPanelProps) {
  const [filter, setFilter] = useState<'all' | 'primary' | 'advanced' | 'expert'>('all');
  const [search, setSearch] = useState('');
  const [pendingChanges, setPendingChanges] = useState<Record<ConfigGroup, Record<string, unknown>>>({});

  const handleChange = (group: ConfigGroup, key: string, value: number | string | boolean) => {
    setPendingChanges((prev) => ({
      ...prev,
      [group]: { ...prev[group], [key]: value },
    }));
  };

  const handleApply = async (group: ConfigGroup) => {
    const changes = pendingChanges[group];
    if (changes) {
      await onUpdate(group, changes, 'UI изменение');
      setPendingChanges((prev) => {
        const next = { ...prev };
        delete next[group];
        return next;
      });
    }
  };

  const handleReset = (group: ConfigGroup) => {
    setPendingChanges((prev) => {
      const next = { ...prev };
      delete next[group];
      return next;
    });
  };

  const filteredGroups = CONFIG_GROUP_ORDER.filter((group) => {
    const meta = CONFIG_GROUPS_META[group];
    if (filter !== 'all') {
      const hasCategory = meta.params.some((p) => p.category === filter);
      if (!hasCategory) return false;
    }
    if (search) {
      const searchLower = search.toLowerCase();
      return (
        meta.label.toLowerCase().includes(searchLower) ||
        meta.description.toLowerCase().includes(searchLower) ||
        meta.params.some((p) => p.label.toLowerCase().includes(searchLower))
      );
    }
    return true;
  });

  return (
    <div>
      <div className="flex gap-4 mb-4">
        <input
          type="text"
          placeholder="Поиск параметров..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-gray-800 text-white px-4 py-2 rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
        />
        <div className="flex gap-1 bg-gray-800 p-1 rounded">
          {(['all', 'primary', 'advanced', 'expert'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs rounded ${
                filter === f ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {f === 'all' ? 'Все' : f === 'primary' ? 'Осн' : f === 'advanced' ? 'Расш' : 'Эксп'}
            </button>
          ))}
        </div>
      </div>

      {Object.keys(pendingChanges).length > 0 && (
        <div className="bg-cyan-900/30 border border-cyan-700 rounded-lg p-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-cyan-300">
            Несохранённые изменения в {Object.keys(pendingChanges).length} группах
          </span>
          <button
            onClick={() => setPendingChanges({})}
            className="text-sm text-gray-400 hover:text-white"
          >
            Сбросить все
          </button>
        </div>
      )}

      {filteredGroups.map((group) => {
        const meta = CONFIG_GROUPS_META[group];
        const currentValues = { ...defaults[group], ...pendingChanges[group] };

        return (
          <GroupCard
            key={group}
            meta={meta}
            values={currentValues}
            defaults={defaults[group]}
            frozen={frozen}
            onChange={(key, value) => handleChange(group, key, value)}
            onApply={() => handleApply(group)}
            onReset={() => handleReset(group)}
          />
        );
      })}
    </div>
  );
}