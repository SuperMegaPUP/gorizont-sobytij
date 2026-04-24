'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Loader2, Database, Key, X, FileDown, Clock, ChevronRight, Sparkles, FileText } from 'lucide-react';

interface HintRecord {
  id: string;
  ts: number;
  date: string;
  time: string;
  content: string;
  model?: string;
}

interface AIHintModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ModalTab = 'generate' | 'history' | 'view';

export function AIHintModal({ open, onOpenChange }: AIHintModalProps) {
  const passwordRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<ModalTab>('generate');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentHint, setCurrentHint] = useState<HintRecord | null>(null);
  const [savedHints, setSavedHints] = useState<HintRecord[]>([]);
  const [savingPdf, setSavingPdf] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'F3') {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      loadSavedHintsSilent();
      if (currentHint) {
        setActiveTab('view');
      } else {
        setActiveTab('generate');
      }
    }
  }, [open]);

  const loadSavedHintsSilent = async () => {
    try {
      const res = await fetch('/api/hint');
      const data = await res.json();
      if (data.hints && data.hints.length > 0) {
        setSavedHints(
          data.hints.map((h: any) => ({
            id: h.id || `hint-${Date.now()}`,
            ts: h.ts || new Date(h.generatedAt || h.timestamp).getTime(),
            date: (h.generatedAt || h.timestamp || '').slice(0, 10),
            time: (h.generatedAt || h.timestamp || '').slice(11, 19),
            content: h.hint || '',
            model: h.model || '',
          }))
        );
      }
    } catch { /* silent */ }
  };

  const generateHint = async () => {
    const password = passwordRef.current?.value || '';
    if (!password) {
      setError('Введите пароль для генерации отчёта');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Ошибка генерации');
        return;
      }
      setCurrentHint({
        id: data.id || `hint-${Date.now()}`,
        ts: Date.now(),
        date: (data.timestamp || new Date().toISOString()).slice(0, 10),
        time: (data.timestamp || new Date().toISOString()).slice(11, 19),
        content: data.hint || '',
        model: data.model || '',
      });
      setActiveTab('view');
      loadSavedHintsSilent();
    } catch {
      setError('Ошибка сети при генерации подсказки');
    } finally {
      setLoading(false);
    }
  };

  const selectHint = (h: HintRecord) => {
    setCurrentHint(h);
    setActiveTab('view');
  };

  const loadHistory = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/hint');
      const data = await res.json();
      if (data.hints && data.hints.length > 0) {
        const records = data.hints.map((h: any) => ({
          id: h.id || `hint-${h.ts || Date.now()}`,
          ts: h.ts || new Date(h.generatedAt || h.timestamp).getTime(),
          date: (h.generatedAt || h.timestamp || '').slice(0, 10),
          time: (h.generatedAt || h.timestamp || '').slice(11, 19),
          content: h.hint || '',
          model: h.model || '',
        }));
        setSavedHints(records);
        if (!currentHint) setCurrentHint(records[0]);
      } else {
        setSavedHints([]);
        setError('Сохранённых отчётов нет');
      }
    } catch {
      setError('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  const saveAsPdf = useCallback(async () => {
    if (!currentHint) return;
    setSavingPdf(true);
    try {
      const content = currentHint.content;
      const dateStr = currentHint.date;
      const timeStr = currentHint.time;
      const html = [
        '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">',
        '<title>Нейро-подсказка — ', dateStr, ' ', timeStr, '</title>',
        '<style>',
        'body{font-family:Inter,-apple-system,sans-serif;background:#0a0e14;color:#c5cdd8;padding:40px;max-width:800px;margin:0 auto;line-height:1.7}',
        '.header{border-bottom:2px solid #00e5a0;padding-bottom:16px;margin-bottom:24px}',
        '.header-title{font-size:20px;font-weight:700;color:#00e5a0}',
        '.header-meta{font-size:12px;color:#6b7b8d;font-family:monospace}',
        '.content{font-size:14px;white-space:pre-wrap;word-break:break-word}',
        '.content h2{color:#00e5a0;font-size:16px;font-weight:700;margin:20px 0 8px 0}',
        '.content strong{color:#e0e6ed}',
        '.footer{margin-top:32px;padding-top:16px;border-top:1px solid #1a2233;font-size:11px;color:#4a5568;text-align:center;font-family:monospace}',
        '@media print{body{background:white;color:#1a1a1a}.header{border-color:#00a876}.header-title{color:#00a876}.content h2{color:#00a876}.content strong{color:#1a1a1a}}',
        '</style></head><body>',
        '<div class="header"><div class="header-title">НЕЙРО-ПОДСКАЗКА</div>',
        '<div class="header-meta">', dateStr, ' ', timeStr, ' МСК | Robot Detector by SuperPups</div></div>',
        '<div class="content">', escapeHtml(content), '</div>',
        '<div class="footer">Robot Detector Terminal — AI-анализ давления роботов на MOEX</div>',
        '</body></html>',
      ].join('');

      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => { printWindow.print(); }, 1000);
      }
    } catch (err) {
      console.error('[PDF] Save error:', err);
    } finally {
      setSavingPdf(false);
    }
  }, [currentHint]);

  function escapeHtml(md: string): string {
    return md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3 style="color:#f0b429;font-size:14px;font-weight:600;margin:16px 0 6px 0">$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code style="color:#ff6b8a;background:rgba(255,107,138,0.1);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:12px">$1</code>')
      .replace(/\n/g, '<br/>');
  }

  function renderMarkdown(md: string): React.ReactNode {
    const lines = md.split('\n');
    const el: React.ReactNode[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('## ')) {
        el.push(<h2 key={i} className="text-[var(--terminal-accent)] text-[11px] font-bold mt-3 mb-1 tracking-wide flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--terminal-accent)]" />{line.slice(3).replace(/\*\*/g, '')}</h2>);
      } else if (line.startsWith('### ')) {
        el.push(<h3 key={i} className="text-[var(--terminal-warning)] text-[10px] font-bold mt-2 mb-0.5 tracking-wide">{line.slice(4).replace(/\*\*/g, '')}</h3>);
      } else if (line.trim() === '') {
        el.push(<div key={i} className="h-1.5" />);
      } else {
        el.push(<p key={i} className="text-[9px] leading-[1.6] text-[var(--terminal-text)]">{formatInline(line)}</p>);
      }
    }
    return el;
  }

  function formatInline(text: string): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let ki = 0;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) parts.push(<span key={ki++}>{text.slice(last, m.index)}</span>);
      if (m[2]) parts.push(<strong key={ki++} className="text-[var(--terminal-text)] font-bold">{m[2]}</strong>);
      else if (m[3]) parts.push(<em key={ki++} className="text-[var(--terminal-warning)]">{m[3]}</em>);
      else if (m[4]) parts.push(<code key={ki++} className="text-[var(--terminal-negative)] bg-[var(--terminal-negative)]/10 px-0.5 rounded text-[8px]">{m[4]}</code>);
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(<span key={ki++}>{text.slice(last)}</span>);
    return parts;
  }

  if (!open || !mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="bg-[var(--terminal-bg)] border border-[var(--terminal-border)] rounded-lg max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)] shrink-0">
          <div className="flex items-center gap-3">
            <Brain className="w-5 h-5 text-[var(--terminal-accent)]" />
            <h2 className="text-sm font-bold text-[var(--terminal-text)] tracking-wide">НЕЙРО-АНАЛИЗ</h2>
          </div>
          <div className="flex items-center gap-3">
            {currentHint && activeTab === 'view' && (
              <button onClick={saveAsPdf} disabled={savingPdf} className="flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-bold bg-[var(--terminal-positive)]/15 text-[var(--terminal-positive)] border border-[var(--terminal-positive)]/30 hover:bg-[var(--terminal-positive)]/25 transition-colors cursor-pointer disabled:opacity-40">
                <FileDown className="w-3 h-3" />
                {savingPdf ? '...' : 'PDF'}
              </button>
            )}
            <span className="text-[9px] text-[var(--terminal-muted)] font-mono">F3 / Esc</span>
            <button onClick={() => onOpenChange(false)} className="text-[var(--terminal-muted)] hover:text-[var(--terminal-text)] transition-colors p-1 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--terminal-border)] overflow-x-auto shrink-0 min-h-[40px]">
          <button onClick={() => setActiveTab('generate')} className={`px-4 py-2.5 text-xs font-bold font-mono transition-colors whitespace-nowrap cursor-pointer ${activeTab === 'generate' ? 'text-[var(--terminal-accent)] border-b-2 border-[var(--terminal-accent)] bg-[var(--terminal-accent)]/5' : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]'}`}>
            <Sparkles className="w-3 h-3 inline mr-1" />ГЕНЕРАЦИЯ
          </button>
          <button onClick={() => { setActiveTab('history'); loadHistory(); }} className={`px-4 py-2.5 text-xs font-bold font-mono transition-colors whitespace-nowrap cursor-pointer ${activeTab === 'history' ? 'text-[var(--terminal-warning)] border-b-2 border-[var(--terminal-warning)] bg-[var(--terminal-warning)]/5' : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]'}`}>
            <Database className="w-3 h-3 inline mr-1" />ИСТОРИЯ
          </button>
          {currentHint && (
            <button onClick={() => setActiveTab('view')} className={`px-4 py-2.5 text-xs font-bold font-mono transition-colors whitespace-nowrap cursor-pointer ${activeTab === 'view' ? 'text-[var(--terminal-positive)] border-b-2 border-[var(--terminal-positive)] bg-[var(--terminal-positive)]/5' : 'text-[var(--terminal-muted)] hover:text-[var(--terminal-text)]'}`}>
              <FileText className="w-3 h-3 inline mr-1" />ОТЧЁТ
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto terminal-scroll p-5">

          {activeTab === 'generate' && (
            <div className="space-y-4">
              <p className="text-[10px] text-[var(--terminal-muted)]">
                AI-генерация рыночного анализа на основе данных MOEX FUTOI, AlgoPack, T-Invest и метрик дашборда.
              </p>

              {/* Password */}
              <div className="border border-[var(--terminal-warning)]/30 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-warning)]/10 border-b border-[var(--terminal-warning)]/20">
                  <Key className="w-3.5 h-3.5 text-[var(--terminal-warning)]" />
                  <span className="text-sm font-bold text-[var(--terminal-text)]">Авторизация</span>
                  <span className="text-[8px] text-[var(--terminal-muted)] ml-1">Введите пароль для доступа к генерации</span>
                </div>
                <div className="px-4 py-3 flex items-center gap-3">
                  <input
                    ref={passwordRef}
                    type="password"
                    defaultValue=""
                    placeholder="Пароль доступа"
                    className="flex-1 bg-[var(--terminal-surface)] border border-[var(--terminal-border)]/50 rounded px-3 py-1.5 text-[10px] text-[var(--terminal-text)] font-mono placeholder:text-[var(--terminal-muted)] focus:outline-none focus:border-[var(--terminal-accent)]/50"
                    onKeyDown={(e) => { if (e.key === 'Enter') generateHint(); }}
                  />
                  <button onClick={generateHint} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[9px] font-bold bg-[var(--terminal-accent)]/15 text-[var(--terminal-accent)] border border-[var(--terminal-accent)]/30 hover:bg-[var(--terminal-accent)]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                    {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {loading ? 'Генерация...' : 'Сгенерировать'}
                  </button>
                </div>
              </div>

              {loading && (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <Brain className="w-10 h-10 text-[var(--terminal-accent)] animate-pulse mx-auto mb-3" />
                    <p className="text-[10px] text-[var(--terminal-accent)] font-bold">Нейро-анализ рыночных данных...</p>
                    <p className="text-[8px] text-[var(--terminal-muted)] mt-1">Собираем данные из MOEX, AlgoPack, T-Invest</p>
                  </div>
                </div>
              )}

              {error && <div className="px-3 py-2 rounded-md bg-[var(--terminal-negative)]/10 text-[var(--terminal-negative)] text-[9px] border border-[var(--terminal-negative)]/20">{error}</div>}

              {!loading && savedHints.length > 0 && (
                <div className="border border-[var(--terminal-border)] rounded-md overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--terminal-surface)] border-b border-[var(--terminal-border)]">
                    <Clock className="w-3.5 h-3.5 text-[var(--terminal-muted)]" />
                    <span className="text-sm font-bold text-[var(--terminal-text)]">Последние отчёты</span>
                  </div>
                  <div className="px-4 py-2 space-y-1">
                    {savedHints.slice(0, 5).map((h) => (
                      <button key={h.id} onClick={() => selectHint(h)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--terminal-surface)]/60 transition-colors cursor-pointer text-left">
                        <Clock className="w-3 h-3 text-[var(--terminal-muted)] shrink-0" />
                        <span className="text-[9px] text-[var(--terminal-accent)] font-mono">{h.date} {h.time}</span>
                        <span className="text-[8px] text-[var(--terminal-muted)] truncate flex-1">{h.content.slice(0, 60)}...</span>
                        <ChevronRight className="w-3 h-3 text-[var(--terminal-muted)] shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-4">
              <p className="text-[10px] text-[var(--terminal-muted)]">
                Ранее сгенерированные нейро-отчёты, сохранённые в Redis.
              </p>
              {loading && <div className="flex items-center justify-center py-8"><Loader2 className="w-8 h-8 text-[var(--terminal-accent)] animate-spin" /></div>}
              {!loading && savedHints.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8">
                  <Database className="w-8 h-8 text-[var(--terminal-border)] mb-2" />
                  <p className="text-[10px] text-[var(--terminal-muted)]">Нет сохранённых отчётов</p>
                </div>
              )}
              {!loading && savedHints.length > 0 && (
                <div className="space-y-1.5">
                  {savedHints.map((h) => (
                    <button key={h.id} onClick={() => selectHint(h)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors cursor-pointer text-left border ${h.id === currentHint?.id ? 'border-[var(--terminal-accent)]/40 bg-[var(--terminal-accent)]/10' : 'border-[var(--terminal-border)]/30 hover:bg-[var(--terminal-surface)]/60'}`}>
                      <FileText className="w-3.5 h-3.5 text-[var(--terminal-accent)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[9px] text-[var(--terminal-accent)] font-mono font-bold">{h.date} {h.time} МСК</div>
                        <div className="text-[8px] text-[var(--terminal-muted)] truncate">{h.content.slice(0, 100)}...</div>
                      </div>
                      <ChevronRight className="w-3 h-3 text-[var(--terminal-muted)] shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              {error && activeTab === 'history' && <div className="px-3 py-2 rounded-md bg-[var(--terminal-negative)]/10 text-[var(--terminal-negative)] text-[9px] border border-[var(--terminal-negative)]/20">{error}</div>}
            </div>
          )}

          {activeTab === 'view' && currentHint && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[8px] text-[var(--terminal-muted)] font-mono">
                <Clock className="w-3 h-3" />
                <span className="text-[var(--terminal-accent)]">{currentHint.date} {currentHint.time}</span>
                <span>МСК</span>
                {currentHint.model && (<><span className="text-[var(--terminal-border)]">|</span><span>{currentHint.model}</span></>)}
              </div>
              <div className="bg-[var(--terminal-surface)]/30 border border-[var(--terminal-border)]/20 rounded-md p-4 space-y-0">
                {renderMarkdown(currentHint.content)}
              </div>
              {savedHints.length > 1 && (
                <div className="space-y-1">
                  <span className="text-[7px] text-[var(--terminal-muted)] font-bold uppercase tracking-wider">Другие отчёты ({savedHints.length})</span>
                  <div className="flex gap-1 flex-wrap">
                    {savedHints.filter(h => h.id !== currentHint?.id).slice(0, 8).map((h) => (
                      <button key={h.id} onClick={() => selectHint(h)} className="flex items-center gap-1 px-2 py-0.5 rounded text-[7px] font-mono bg-[var(--terminal-surface)]/50 hover:bg-[var(--terminal-surface)] text-[var(--terminal-muted)] hover:text-[var(--terminal-accent)] transition-colors cursor-pointer">
                        <Clock className="w-2 h-2" />{h.time}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'view' && !currentHint && (
            <div className="flex flex-col items-center justify-center py-8">
              <Brain className="w-8 h-8 text-[var(--terminal-border)] mb-2" />
              <p className="text-[10px] text-[var(--terminal-muted)]">Нет выбранного отчёта</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
