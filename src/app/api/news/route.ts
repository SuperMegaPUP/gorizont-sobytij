// ─── /api/news ─────────────────────────────────────────────────────────
// Агрегатор новостей: MOEX ISS + Finam RSS
// Фильтрация по важности (High/Medium/Low) — только H/M доходят до AI
//
// GET /api/news?limit=50

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface NewsItem {
  source: string;
  title: string;
  summary: string;
  time: string;
  tickers: string[];
  importance: 'high' | 'medium' | 'low';
}

// Ключевые слова для определения важности
const HIGH_KEYWORDS = [
  'санкци', 'дивиденд', 'ставк', 'ЦБ', 'инфляц', 'ВВП', 'война', 'мирн',
  'переговор', 'OPEC', 'ОПЕК', 'нефт', 'Brent', 'ключевая ставка',
  'снижени', 'повышени', 'рекорд', 'кризис', 'дефолт', 'эмбарго',
  'размещени', 'IPO', 'SPO', 'допэмисси',
];

const MEDIUM_KEYWORDS = [
  'отчет', 'прибыл', 'выручк', 'EBITDA', 'рекомендац', 'рейтинг',
  'совет директор', 'набсовет', 'годово', 'квартал', 'сделк',
  'покупк', 'продаж', 'слияни', 'поглощен',
];

// Извлечение тикеров из текста
const TICKER_PATTERN = /\b([A-Z]{2,6})\b/g;
const KNOWN_TICKERS = new Set([
  'SBER', 'GAZP', 'LKOH', 'GMKN', 'YDEX', 'VTBR', 'ROSN', 'PLZL', 'MGNT',
  'NVTK', 'SNGS', 'SNGSP', 'TATN', 'TATNP', 'ALRS', 'CHMF', 'NLMK', 'RUAL',
  'OZON', 'TCSG', 'FIVE', 'MOEX', 'SIBN', 'AFKS', 'MTLR', 'IRAO', 'PHOR',
  'FLOT', 'LENT', 'SGZH', 'PIKK', 'RTKM', 'HYDR', 'FEES', 'MAGN', 'LSRG',
  'SELG', 'VKCO', 'HEAD', 'SMLT', 'AFLT', 'CBOM', 'POSI', 'BANE', 'BANEP',
  'EUTR', 'IVAT', 'WUSH', 'RNFT', 'UGLD', 'SVCB', 'FIXR', 'MSRS',
  'MX', 'Si', 'RI', 'BR', 'GZ', 'GK', 'SR', 'LK', 'RN',
]);

function extractTickers(text: string): string[] {
  const matches = text.match(TICKER_PATTERN) || [];
  return [...new Set(matches.filter(m => KNOWN_TICKERS.has(m)))];
}

function classifyImportance(title: string, summary: string): 'high' | 'medium' | 'low' {
  const text = (title + ' ' + summary).toLowerCase();
  if (HIGH_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) return 'high';
  if (MEDIUM_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) return 'medium';
  return 'low';
}

// ─── Источник 1: MOEX ISS News ────────────────────────────────────────
async function fetchMoexNews(): Promise<NewsItem[]> {
  const results: NewsItem[] = [];
  try {
    const url = 'https://iss.moex.com/iss/sitenews.json?iss.meta=off&limit=20';
    const res = await fetch(url, { cache: 'no-store' as RequestCache, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return results;

    const data = await res.json();
    const columns: string[] = data?.sitenews?.columns || [];
    const rows: any[][] = data?.sitenews?.data || [];

    for (const row of rows) {
      const obj: any = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      const title = obj.title || '';
      const summary = '';
      results.push({
        source: 'moex',
        title,
        summary,
        time: obj.published_at ? new Date(obj.published_at).toISOString() : new Date().toISOString(),
        tickers: extractTickers(title),
        importance: classifyImportance(title, summary),
      });
    }
  } catch (err) {
    console.warn('[NEWS] MOEX fetch error:', err);
  }
  return results;
}

// ─── Источник 2: Finam RSS ───────────────────────────────────────────
async function fetchFinamNews(): Promise<NewsItem[]> {
  const results: NewsItem[] = [];
  try {
    const url = 'https://www.finam.ru/analysis/conews/rsspoint/';
    const res = await fetch(url, {
      cache: 'no-store' as RequestCache,
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RobotDetector/1.0)' },
    });
    if (!res.ok) return results;

    const text = await res.text();
    // Простой парсер RSS
    const itemRegex = /<item[\s\S]*?<\/item>/gi;
    const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i;
    const descRegex = /<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/i;
    const dateRegex = /<pubDate>(.*?)<\/pubDate>/i;

    const items = text.match(itemRegex) || [];
    for (const item of items.slice(0, 35)) {
      const titleMatch = item.match(titleRegex);
      const descMatch = item.match(descRegex);
      const dateMatch = item.match(dateRegex);

      const title = (titleMatch?.[1] || titleMatch?.[2] || '').trim();
      const summary = (descMatch?.[1] || descMatch?.[2] || '').trim();
      const pubDate = dateMatch?.[1] || '';

      if (!title) continue;

      let time = new Date().toISOString();
      if (pubDate) {
        const parsed = Date.parse(pubDate);
        if (!isNaN(parsed)) time = new Date(parsed).toISOString();
      }

      results.push({
        source: 'finam',
        title: title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        summary: summary.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(0, 300),
        time,
        tickers: extractTickers(title + ' ' + summary),
        importance: classifyImportance(title, summary),
      });
    }
  } catch (err) {
    console.warn('[NEWS] Finam fetch error:', err);
  }
  return results;
}

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 50, 100);

  try {
    const [moexNews, finamNews] = await Promise.all([
      fetchMoexNews(),
      fetchFinamNews(),
    ]);

    // Объединяем и сортируем по времени (новые сверху)
    const allNews = [...moexNews, ...finamNews]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, limit);

    // Считаем по источникам
    const moexCount = allNews.filter(n => n.source === 'moex').length;
    const finamCount = allNews.filter(n => n.source === 'finam').length;

    return NextResponse.json({
      news: allNews,
      total: allNews.length,
      cached: false,
      sources: { moex: moexCount, moexEvents: 0, finam: finamCount },
    });
  } catch (err: any) {
    console.error('[NEWS] Error:', err);
    return NextResponse.json({ news: [], total: 0, error: err.message }, { status: 500 });
  }
}
