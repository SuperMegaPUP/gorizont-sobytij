'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FileText, RefreshCw, Trash2, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { FrameTooltip } from './FrameTooltip';

// ─── ReportsFrame — UI для AI-отчётов ──────────────────────────────────────
// GET /api/reports → список отчётов
// POST /api/reports → генерация (password: "13420")

interface Report {
  id: string;
  type: 'cron' | 'manual';
  status: 'success' | 'error' | 'pending';
  model: string;
  timestamp: string;
  generatedAt: string;
  preview: string;
  dataSources: string[];
  tradingDay: boolean;
  errorMessage?: string;
}

export function ReportsFrame() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/reports');
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      } else {
        setError('Ошибка загрузки отчётов');
      }
    } catch {
      setError('Сеть недоступна');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
    // Обновляем каждые 5 минут
    const interval = setInterval(fetchReports, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchReports]);

  const generateReport = async () => {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '13420' }),
      });
      if (res.ok) {
        const report = await res.json();
        if (report.status === 'success') {
          setReports((prev) => [report, ...prev].slice(0, 20));
        } else {
          setError(report.errorMessage || 'Ошибка генерации');
          // Обновляем список (ошибочный отчёт тоже сохранён)
          fetchReports();
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Ошибка авторизации');
      }
    } catch {
      setError('Сеть недоступна');
    } finally {
      setGenerating(false);
    }
  };

  const deleteAll = async () => {
    try {
      await fetch('/api/reports', { method: 'DELETE' });
      setReports([]);
    } catch {
      // Тихо
    }
  };

  const statusColor = (s: string) => {
    if (s === 'success') return 'var(--terminal-positive)';
    if (s === 'error') return 'var(--terminal-negative)';
    return 'var(--terminal-warning)';
  };

  const statusLabel = (s: string) => {
    if (s === 'success') return 'ОК';
    if (s === 'error') return 'ОШИБКА';
    return '...';
  };

  const typeLabel = (t: string) => (t === 'cron' ? 'CRON' : 'РУЧН');

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return ts;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <FileText className="w-3 h-3 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">AI-ОТЧЁТЫ</span>
        <span className="text-[8px] text-[var(--terminal-muted)] font-mono ml-auto">{reports.length}</span>
        <FrameTooltip text="AI-отчёты рынка: автоматические (крон) и ручная генерация. Анализирует текущее состояние дашборда через LLM и выдаёт рекомендации. Нажмите кнопку генерации для создания нового отчёта." />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--terminal-border)]/30 shrink-0">
        <button
          onClick={generateReport}
          disabled={generating}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[7px] font-mono font-bold bg-[var(--terminal-accent)]/20 text-[var(--terminal-accent)] hover:bg-[var(--terminal-accent)]/30 transition-colors disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
          {generating ? 'Генерация...' : 'Новый отчёт'}
        </button>
        <button
          onClick={fetchReports}
          disabled={loading}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-mono text-[var(--terminal-muted)] hover:bg-[var(--terminal-surface)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-2 h-2 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {reports.length > 0 && (
          <button
            onClick={deleteAll}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-mono text-[var(--terminal-negative)] hover:bg-[var(--terminal-negative)]/10 transition-colors ml-auto"
          >
            <Trash2 className="w-2 h-2" />
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-2 py-1 text-[7px] font-mono text-[var(--terminal-negative)] bg-[var(--terminal-negative)]/10 shrink-0">
          {error}
        </div>
      )}

      {/* Reports list */}
      <div className="flex-1 overflow-y-auto terminal-scroll">
        {reports.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[9px] text-[var(--terminal-muted)] font-mono">Нет отчётов</p>
          </div>
        ) : (
          <div className="space-y-0">
            {reports.map((r) => {
              const isExpanded = expandedId === r.id;
              return (
                <div key={r.id} className="border-b border-[var(--terminal-border)]/10">
                  {/* Summary row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="text-[7px] font-mono font-bold" style={{ color: statusColor(r.status) }}>
                      {statusLabel(r.status)}
                    </span>
                    <span className="text-[7px] font-mono text-[var(--terminal-muted)]">
                      {typeLabel(r.type)}
                    </span>
                    <span className="text-[7px] font-mono text-[var(--terminal-muted)]">
                      {formatTime(r.generatedAt || r.timestamp)}
                    </span>
                    <span className="ml-auto">
                      {isExpanded ? (
                        <ChevronUp className="w-2.5 h-2.5 text-[var(--terminal-muted)]" />
                      ) : (
                        <ChevronDown className="w-2.5 h-2.5 text-[var(--terminal-muted)]" />
                      )}
                    </span>
                  </button>

                  {/* Preview (always visible) */}
                  {r.status === 'success' && r.preview && !isExpanded && (
                    <div className="px-2 pb-1 text-[7px] font-mono text-[var(--terminal-neutral)] leading-relaxed line-clamp-2">
                      {r.preview}
                    </div>
                  )}

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-2 pb-1.5 space-y-1">
                      {r.status === 'error' && r.errorMessage && (
                        <div className="text-[7px] font-mono text-[var(--terminal-negative)]">
                          Ошибка: {r.errorMessage}
                        </div>
                      )}
                      {r.status === 'success' && r.preview && (
                        <div className="text-[7px] font-mono text-[var(--terminal-neutral)] leading-relaxed whitespace-pre-wrap">
                          {r.preview}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-[6px] font-mono text-[var(--terminal-muted)]">
                        {r.model && <span>Модель: {r.model}</span>}
                        {r.dataSources?.length > 0 && <span>Источники: {r.dataSources.join(', ')}</span>}
                        {r.tradingDay !== undefined && <span>{r.tradingDay ? 'Торговый день' : 'Выходной'}</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
