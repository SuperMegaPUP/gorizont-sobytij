'use client';

import { useState } from 'react';
import type { HorizonHealthStatus, FreezeState } from '@/lib/horizon/config/config-schema';

interface StatusBarProps {
  health: HorizonHealthStatus | null;
  freeze: FreezeState;
  onFreeze: (freeze: boolean, reason: string) => void;
  onUnfreeze: (reason: string) => void;
}

export function StatusBar({ health, freeze, onFreeze, onUnfreeze }: StatusBarProps) {
  const [showFreezeModal, setShowFreezeModal] = useState(false);
  const [reason, setReason] = useState('');

  const handleFreeze = () => {
    if (reason.trim()) {
      onFreeze(true, reason);
      setReason('');
      setShowFreezeModal(false);
    }
  };

  const handleUnfreeze = () => {
    if (reason.trim()) {
      onUnfreeze(reason);
      setReason('');
      setShowFreezeModal(false);
    }
  };

  const statusColor = health?.status === 'healthy' ? 'bg-emerald-500' 
    : health?.status === 'degraded' ? 'bg-amber-500' 
    : 'bg-red-500';

  return (
    <div className="flex items-center justify-between bg-gray-900 px-4 py-2 rounded-lg mb-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-sm text-gray-300">
            {health?.status || 'loading'}
          </span>
        </div>
        <span className="text-xs text-gray-500">
          {health?.detectorsActive || 18}/{health?.detectorsTotal || 18} det
        </span>
        {health?.activeExperiments ? (
          <span className="text-xs text-gray-500">
            {health.activeExperiments} exp
          </span>
        ) : null}
        <span className={`text-xs ${health?.redisConnected ? 'text-emerald-500' : 'text-red-500'}`}>
          Redis {health?.redisConnected ? 'OK' : 'N/A'}
        </span>
      </div>

      <button
        onClick={() => setShowFreezeModal(true)}
        className={`px-3 py-1 rounded text-sm ${
          freeze.frozen
            ? 'bg-amber-900 text-amber-300 hover:bg-amber-800'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        }`}
      >
        {freeze.frozen ? '🔓 Разморозить' : '🔒 Заморозить'}
      </button>

      {showFreezeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">
              {freeze.frozen ? '🔓 Разморозить конфиг?' : '🔒 Заморозить конфиг?'}
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              {freeze.frozen
                ? 'Изменения конфигурации снова будут разрешены.'
                : 'Все изменения конфигурации будут заблокированы.'}
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина (обязательно)"
              className="w-full bg-gray-700 text-white rounded p-2 mb-4 text-sm"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowFreezeModal(false);
                  setReason('');
                }}
                className="flex-1 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
              >
                Отмена
              </button>
              <button
                onClick={freeze.frozen ? handleUnfreeze : handleFreeze}
                disabled={!reason.trim()}
                className={`flex-1 py-2 rounded ${
                  freeze.frozen
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                    : 'bg-amber-600 text-white hover:bg-amber-500'
                } disabled:opacity-50`}
              >
                {freeze.frozen ? 'Разморозить' : 'Заморозить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}