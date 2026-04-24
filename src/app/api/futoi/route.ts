import { NextRequest, NextResponse } from 'next/server';
import { fetchFutoi, fetchFromApim, hasRealData, FutoiGroup, EMPTY_GROUP, calculateSMI } from '@/lib/moex-futoi';

// FUTOI — Открытый интерес по фьючерсам (MOEX APIM + ISS fallback)
// GET /api/futoi?tickers=MX,Si,RI,BR,GZ,GK,SR,LK,RN&debug=1
//
// Fallback chain: APIM (real-time 5 мин) → ISS Authorized → Openpositions → none
//
// КРИТИЧЕСКИЕ ДЕТАЛИ:
// - JWT trimming — Vercel добавляет \n в env vars (исправлено в moex-futoi.ts)
// - APIM FUTOI: pos_short ОТРИЦАТЕЛЬНОЕ, clgroup = "YUR"/"FIZ"
// - Openpositions: open_position_short ПОЛОЖИТЕЛЬНОЕ, is_fiz = 0/1
// - force-dynamic — ОБЯЗАТЕЛЕН, иначе Next.js кеширует на Vercel

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tickersParam = searchParams.get('tickers') || 'MX,Si,RI,BR,GZ,GK,SR,LK,RN';
  const debug = searchParams.get('debug') === '1';
  const tickers = tickersParam.split(',').map(t => t.trim()).filter(Boolean);

  const results: any[] = [];
  let source = 'none';
  let realtime = false;
  const debugInfo: any = debug ? {} : undefined;

  for (const ticker of tickers) {
    const { result, source: tickerSource, realtime: tickerRealtime } = await fetchFutoi(ticker);

    results.push(result);

    // Источник = лучший из всех тикеров
    if (tickerSource === 'apim_futoi') { source = 'apim_futoi'; realtime = true; }
    else if (tickerSource === 'iss_authorized' && source !== 'apim_futoi') { source = 'iss_authorized'; }
    else if (tickerSource === 'openpositions' && source === 'none') { source = 'openpositions'; }

    // Debug info для конкретного тикера
    if (debug) {
      const apimDebug = await fetchFromApim(ticker);
      debugInfo[ticker] = {
        source: tickerSource,
        realtime: tickerRealtime,
        jwt_length: (process.env.MOEX_JWT || '').length,
        jwt_trimmed_length: (process.env.MOEX_JWT || '').trim().length,
        jwt_first_20: (process.env.MOEX_JWT || '').substring(0, 20),
        apim_debug: apimDebug.debug,
      };
    }
  }

  // Общий SMI — средневзвешенное + cross-confirmation буст
  // Веса: MX — индексный (25%), SR/GZ — тяжелейшие в индексе, Si — курсовой, далее по значимости
  const weights: Record<string, number> = {
    MX: 0.25,  // Индекс Мосбиржи — главный рынок
    SR: 0.15,  // Сбербанк = ~15% IMOEX
    GZ: 0.12,  // Газпром = ~10% IMOEX
    Si: 0.12,  // Доллар/рубль — курсообразующий
    LK: 0.10,  // Лукойл — тяжёлый в индексе
    RI: 0.08,  // RTS — коррелят MX
    RN: 0.08,  // Роснефть — крупная но менее ликвидный фьюч
    BR: 0.05,  // Brent — внешний фактор
    GK: 0.05,  // Норникель — менее ликвидный
  };

  // Cross-confirmation: если несколько фьючерсов в одну сторону → буст
  // Считаем сколько фьючерсов бычьи/медвежьи (SMI > 10 или < -10)
  const validResults = results.filter(r => r.smiDirection !== 'no_data' && r.smiDirection !== 'error' && hasRealData(r));
  const bullishCount = validResults.filter(r => r.smi > 10).length;
  const bearishCount = validResults.filter(r => r.smi < -10).length;
  const totalValid = validResults.length;

  // Alignment bonus: если >= 60% фьючерсов в одну сторону → ×1.15 буст к SMI
  // Это ловит «широкое движение» когда весь рынок синхронен
  let alignmentMultiplier = 1.0;
  if (totalValid >= 3) {
    if (bullishCount / totalValid >= 0.6) alignmentMultiplier = 1.15;
    else if (bearishCount / totalValid >= 0.6) alignmentMultiplier = 1.15;
  }

  let totalWeight = 0;
  let weightedSMI = 0;
  for (const r of validResults) {
    const w = weights[r.ticker] || 0.1;
    weightedSMI += r.smi * w;
    totalWeight += w;
  }
  const rawComposite = totalWeight > 0 ? (weightedSMI / totalWeight) * alignmentMultiplier : 0;
  const compositeSMI = Math.max(-100, Math.min(100, Math.round(rawComposite * 10) / 10));
  let compositeDirection = 'neutral';
  if (compositeSMI > 30) compositeDirection = 'bullish';
  else if (compositeSMI > 10) compositeDirection = 'slightly_bullish';
  else if (compositeSMI < -30) compositeDirection = 'bearish';
  else if (compositeSMI < -10) compositeDirection = 'slightly_bearish';

  const response: any = {
    instruments: results,
    compositeSMI,
    compositeDirection,
    source,
    realtime,
    date: new Date().toISOString().slice(0, 10),
    authenticated: source === 'apim_futoi' || source === 'iss_authorized',
  };

  if (debug) {
    response.debug = debugInfo;
  }

  return NextResponse.json(response);
}
