'use client';

import { useState, useEffect } from 'react';
import { TabNav } from './TabNav';
import { StatusBar } from './StatusBar';
import { ConfigPanel } from './ConfigPanel/ConfigPanel';
import { LivePreview } from './LivePreview/LivePreview';
import { ExperimentPanel } from './ExperimentPanel/ExperimentPanel';
import { ConfigHistory } from './ConfigHistory/ConfigHistory';
import type { HorizonDetectorConfig, FreezeState, HorizonHealthStatus, ConfigGroup, Experiment } from '@/lib/horizon/config/config-schema';

type Tab = 'params' | 'preview' | 'experiments' | 'history';

export function ControlPanel() {
  const [config, setConfig] = useState<HorizonDetectorConfig | null>(null);
  const [defaults, setDefaults] = useState<HorizonDetectorConfig | null>(null);
  const [freeze, setFreeze] = useState<FreezeState>({ frozen: false });
  const [health, setHealth] = useState<HorizonHealthStatus | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('params');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(() => `session_${Date.now()}`);
  
  useEffect(() => {
    let cancelled = false;
    
    const load = async () => {
      try {
        const [configRes, healthRes] = await Promise.all([
          fetch('/api/horizon/config', { headers: { 'x-session-id': sessionId } }),
          fetch('/api/horizon/health'),
        ]);
        if (cancelled) return;
        
        if (configRes.ok) {
          const data = await configRes.json();
          if (cancelled) return;
          setConfig(data.config);
          setDefaults(data.defaults);
          setFreeze(data.freeze);
        }
        
        if (healthRes.ok) {
          const healthData = await healthRes.json();
          if (cancelled) return;
          setHealth(healthData);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    
    load();
    return () => { cancelled = true; };
  }, []);

  const refetchAll = async () => {
    try {
      const headers = { 'x-session-id': sessionId };
      const configRes = await fetch('/api/horizon/config', { headers });
      if (configRes.ok) {
        const data = await configRes.json();
        setConfig(data.config);
        setDefaults(data.defaults);
        setFreeze(data.freeze);
      }
      const h = await fetch('/api/horizon/health');
      if (h.ok) setHealth(await h.json());
      const e = await fetch('/api/horizon/config/experiments');
      if (e.ok) setExperiments((await e.json()).experiments);
      const hi = await fetch('/api/horizon/config/history?limit=10');
      if (hi.ok) setHistory((await hi.json()).history);
    } catch (e) { console.error('refetch error', e); }
  };

  const handleUpdate = async (group: ConfigGroup, values: Record<string, unknown>, reason: string) => {
    const res = await fetch('/api/horizon/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ group, values, reason }),
    });
    if (!res.ok) { const err = await res.json(); alert(err.error || 'Update failed'); return; }
    await refetchAll();
  };

  const handleFreeze = async (freezeState: boolean, reason: string) => {
    await fetch('/api/horizon/config/freeze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ freeze: freezeState, reason }),
    });
    await refetchAll();
  };

  const handleRollback = async (historyId: string, reason: string) => {
    await fetch('/api/horizon/config/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ historyId, reason }),
    });
    await refetchAll();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4" />
          <p className="text-gray-400">Загрузка конфигурации...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-red-500 text-4xl mb-4">❌</div>
          <h2 className="text-xl font-semibold text-white mb-2">Ошибка загрузки</h2>
          <p className="text-gray-400 text-sm mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-cyan-600 text-white rounded hover:bg-cyan-500"
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-2">
            ГОРИЗОНТ — Config Control Panel
          </h1>
          <p className="text-gray-500 text-sm">
            v4.3 — {config ? Object.keys(config).length - 1 : 0} групп параметров
          </p>
        </div>

        <StatusBar
          health={health}
          freeze={freeze}
          onFreeze={(f, r) => handleFreeze(f, r)}
          onUnfreeze={(r) => handleFreeze(false, r)}
        />

        <TabNav
          activeTab={activeTab}
          onTabChange={setActiveTab}
          frozen={freeze.frozen}
        />

        {activeTab === 'params' && config && defaults && (
          <ConfigPanel
            config={config}
            defaults={defaults}
            frozen={freeze.frozen}
            onUpdate={handleUpdate}
          />
        )}

        {activeTab === 'preview' && config && (
          <LivePreview config={config} />
        )}

        {activeTab === 'experiments' && (
          <ExperimentPanel
            experiments={experiments}
            onCreate={async (name, description, config, tickers) => {
              await fetch('/api/horizon/config/experiments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
                body: JSON.stringify({ name, description, config, tickers }),
              });
              await fetchData();
            }}
            onStart={async (id, controlTickers) => {
              await fetch(`/api/horizon/config/experiments/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
                body: JSON.stringify({ action: 'start', controlTickers }),
              });
              await fetchData();
            }}
            onComplete={async (id) => {
              await fetch(`/api/horizon/config/experiments/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
                body: JSON.stringify({ action: 'complete' }),
              });
              await fetchData();
            }}
            onCancel={async (id) => {
              await fetch(`/api/horizon/config/experiments/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
                body: JSON.stringify({ action: 'cancel' }),
              });
              await fetchData();
            }}
            onPromote={async (id) => {
              await fetch(`/api/horizon/config/experiments/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
                body: JSON.stringify({ action: 'promote' }),
              });
              await fetchData();
            }}
          />
        )}

        {activeTab === 'history' && (
          <ConfigHistory
            history={history}
            onRollback={handleRollback}
          />
        )}
      </div>
    </div>
  );
}