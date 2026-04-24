'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Newspaper, RefreshCw, Loader2, ExternalLink } from 'lucide-react';
import { FrameTooltip } from './FrameTooltip';
import { toMoscowTime } from '@/lib/helpers';

// ─── NewsFrame — рыночные новости ──────────────────────────────────────────
// GET /api/news?limit=20

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  category: string;
  relevantTickers: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  market: 'Рынок',
  market_summary: 'Сводка',
  market_structure: 'Структура',
  central_bank: 'ЦБ',
  corporate: 'Корп.',
};

const SOURCE_COLORS: Record<string, string> = {
  MOEX: 'var(--terminal-accent)',
  MOEX_EVENTS: 'var(--terminal-warning)',
  CBR: 'var(--terminal-positive)',
  MARKET_CONTEXT: 'var(--terminal-neutral)',
};

export function NewsFrame() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/news?limit=20&source=all');
      if (res.ok) {
        const data = await res.json();
        // API returns { time, tickers, importance, source, title, summary }
        // Map to component's NewsItem interface
        const mapped = (data.news || []).map((n: any, idx: number) => ({
          id: n.id || `news-${idx}-${n.source}`,
          title: n.title || '',
          summary: n.summary || '',
          source: n.source || '',
          url: n.url || '',
          publishedAt: n.time || n.publishedAt || '',
          category: n.category || (n.importance === 'high' ? 'market' : n.importance === 'medium' ? 'corporate' : 'market'),
          relevantTickers: n.relevantTickers || n.tickers || [],
        }));
        setNews(mapped);
      }
    } catch {
      // Тихо
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
    // Обновляем каждые 5 минут
    const interval = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  const formatTime = (ts: string) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      const msk = toMoscowTime(d);
      return msk.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]/50 shrink-0">
        <Newspaper className="w-3 h-3 text-[var(--terminal-accent)]" />
        <span className="text-[9px] text-[var(--terminal-frame-header)] font-mono font-bold tracking-wide">НОВОСТИ РЫНКА</span>
        <span className="text-[8px] text-[var(--terminal-muted)] font-mono ml-auto">{news.length}</span>
        <FrameTooltip text="Рыночные новости из MOEX и ЦБ РФ. Обновляется каждые 5 минут. Источники: MOEX (новости биржи), CBR (пресс-релизы), Market Context (сводка лидеров оборотов). Тикеры в новостях привязаны к дашборду." />
      </div>

      {/* Refresh button */}
      <div className="flex items-center px-2 py-0.5 border-b border-[var(--terminal-border)]/30 shrink-0">
        <button
          onClick={fetchNews}
          disabled={loading}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-mono text-[var(--terminal-muted)] hover:bg-[var(--terminal-surface)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-2 h-2 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* News list */}
      <div className="flex-1 overflow-y-auto terminal-scroll">
        {news.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[9px] text-[var(--terminal-muted)] font-mono">Нет новостей</p>
          </div>
        ) : loading && news.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-4 h-4 text-[var(--terminal-muted)] animate-spin" />
          </div>
        ) : (
          <div className="space-y-0">
            {news.map((item) => {
              const isExpanded = expandedId === item.id;
              const srcColor = SOURCE_COLORS[item.source] || 'var(--terminal-muted)';
              const catLabel = CATEGORY_LABELS[item.category] || item.category;
              return (
                <div key={item.id} className="border-b border-[var(--terminal-border)]/10">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="w-full text-left px-2 py-1 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="text-[6px] font-mono font-bold px-1 rounded" style={{ color: srcColor, backgroundColor: `${srcColor}15` }}>
                        {item.source}
                      </span>
                      <span className="text-[6px] font-mono text-[var(--terminal-muted)]">{catLabel}</span>
                      <span className="text-[6px] font-mono text-[var(--terminal-muted)] ml-auto">{formatTime(item.publishedAt)}</span>
                    </div>
                    <p className="text-[7px] font-mono text-[var(--terminal-text)] leading-snug line-clamp-2">
                      {item.title}
                    </p>
                    {item.relevantTickers?.length > 0 && (
                      <div className="flex gap-1 mt-0.5">
                        {item.relevantTickers.slice(0, 4).map((t) => (
                          <span key={t} className="text-[6px] font-mono px-0.5 rounded bg-[var(--terminal-accent)]/10 text-[var(--terminal-accent)]">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-2 pb-1.5 space-y-1">
                      {item.summary && item.summary !== item.title && (
                        <p className="text-[7px] font-mono text-[var(--terminal-neutral)] leading-relaxed">
                          {item.summary}
                        </p>
                      )}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-[6px] font-mono text-[var(--terminal-accent)] hover:underline"
                        >
                          <ExternalLink className="w-2 h-2" /> Источник
                        </a>
                      )}
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
