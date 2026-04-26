// ─── /api/horizon/top100 — GET: TOP-100 Scanner Data ──────────────────────
// Returns cached TOP-100 scanner results from Redis
// POST: Incremental batch scan with per-ticker timeout + progressive caching
//
// v3: Incremental scanning — scans tickers in batches, saves progress to Redis
//     after each batch. If timeout, returns what's been scanned so far.
//     Subsequent POST continues from where it left off.

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for TOP-100 scan

import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { scanTicker, TOP100_TICKERS, type TickerScanResult } from '../scan/route';
import { fetchTop100Tickers } from '@/lib/horizon/observer/collect-market-data';
import { runAllDetectors, calcBSCI } from '@/lib/horizon/detectors/registry';
import { crossSectionNormalize } from '@/lib/horizon/detectors/cross-section-normalize';
import { applyScannerRules } from '@/lib/horizon/scanner/rules';
import { getSessionInfo } from '@/lib/horizon/signals/moex-sessions';

// Redis keys
const CACHE_KEY = 'horizon:scanner:top100';
const PROGRESS_KEY = 'horizon:scanner:top100:progress';
const PROGRESS_TTL = 600; // 10 min TTL for progress

export async function GET(_request: NextRequest) {
  try {
    // Try to read from Redis cache first
    const raw = await redis.get(CACHE_KEY);

    if (raw) {
      const data = JSON.parse(raw);
      // Sort by moexTurnover (VALTODAY) descending — TOP-100 = по обороту!
      const sorted = (data as TickerScanResult[]).sort((a: TickerScanResult, b: TickerScanResult) =>
        (b.moexTurnover || b.turnover || 0) - (a.moexTurnover || a.turnover || 0)
      );
      return NextResponse.json({
        success: true,
        count: sorted.length,
        data: sorted,
        ts: Date.now(),
        cached: true,
      });
    }

    // No cached data — auto-trigger POST scan in background and return empty
    // This allows cron jobs to trigger scans via GET
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    // Fire-and-forget POST to start scanning
    fetch(`${baseUrl}/api/horizon/top100`, { method: 'POST' })
      .then(() => console.log('[/api/horizon/top100] Auto-triggered POST scan'))
      .catch((e) => console.warn('[/api/horizon/top100] Auto-trigger failed:', e.message));

    return NextResponse.json({
      success: true,
      count: 0,
      data: [],
      ts: Date.now(),
      cached: false,
      scanning: true,
      hint: 'Scan started in background. Refresh in 2-3 minutes.',
    });
  } catch (error: any) {
    console.error('[/api/horizon/top100] GET error:', error);
    return NextResponse.json(
      { error: error.message, data: [], ts: Date.now() },
      { status: 500 },
    );
  }
}

/**
 * Strip internal fields before saving/sending
 */
function stripInternalFields(results: TickerScanResult[]): any[] {
  return results.map(({ _rawDetectorResults, _weights, _topDetector, ...rest }) => rest);
}

export async function POST(_request: NextRequest) {
  const startTime = Date.now();
  const MAX_SCAN_TIME = 240_000; // 4 min max (leave 1 min buffer for Vercel 5 min limit)

  try {
    // ─── Market closed check REMOVED (HOTFIX v4.1.5) ───────────
    // canGenerateSignals() is NOW only in signal-generator.ts.
    // Scanning always runs — but we check AFTER scanning if data is real.
    // This allows weekend ДСВД sessions to work properly.

    const sessionInfo = getSessionInfo();

    console.log('[/api/horizon/top100] Starting TOP-100 incremental scan...');

    // 1. Get dynamic top-100 tickers from MOEX by turnover
    let tickersToScan = await fetchTop100Tickers();

    // 2. Fallback to hardcoded list if dynamic fetch fails
    if (tickersToScan.length < 20) {
      console.warn(`[/api/horizon/top100] Dynamic list only ${tickersToScan.length}, using hardcoded fallback`);
      tickersToScan = [...TOP100_TICKERS].map(t => ({ ...t, turnover: 0 }));
    }

    console.log(`[/api/horizon/top100] Scanning ${tickersToScan.length} tickers (dynamic from MOEX)`);

    // 3. Load previous progress from Redis (if scan was interrupted)
    let scannedResults: TickerScanResult[] = [];
    let scannedTickers = new Set<string>();
    try {
      const progressRaw = await redis.get(PROGRESS_KEY);
      if (progressRaw) {
        const progress = JSON.parse(progressRaw);
        scannedResults = progress.results || [];
        scannedTickers = new Set(progress.scannedTickers || []);
        console.log(`[/api/horizon/top100] Resuming from progress: ${scannedTickers.size} tickers already scanned`);
      }
    } catch { /* ignore */ }

    // 4. Filter out already-scanned tickers
    const remaining = tickersToScan.filter(t => !scannedTickers.has(t.ticker));
    console.log(`[/api/horizon/top100] Remaining: ${remaining.length} tickers to scan`);

    // 5. Scan in batches: 5 at a time, 200ms delay, with overall time limit
    const BATCH_SIZE = 5;
    const DELAY_MS = 200;
    const TICKER_TIMEOUT = 10_000; // 10s per ticker

    for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
      // Check if we're about to exceed time limit
      if (Date.now() - startTime > MAX_SCAN_TIME) {
        console.warn(`[/api/horizon/top100] Time limit reached after ${scannedResults.length} tickers, saving progress...`);
        break;
      }

      const batch = remaining.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map((t) => scanTicker(
          { ticker: t.ticker, name: t.name, moexTurnover: t.turnover },
          TICKER_TIMEOUT,
          true, // fastMode: skip RVI/futuresOI for TOP-100 (they're cached globally)
        )),
      );

      for (let j = 0; j < batchResults.length; j++) {
        const r = batchResults[j];
        const tickerInfo = batch[j];
        if (r.status === 'fulfilled') {
          scannedResults.push(r.value);
          scannedTickers.add(tickerInfo.ticker);
        } else {
          // Failed ticker — add as empty
          console.warn(`[/api/horizon/top100] Failed: ${tickerInfo.ticker}: ${r.reason?.message}`);
          scannedResults.push({
            ticker: tickerInfo.ticker,
            name: tickerInfo.name,
            bsci: 0,
            prevBsci: 0,
            alertLevel: 'GREEN',
            direction: 'NEUTRAL',
            confidence: 0,
            detectorScores: {},
            keySignal: 'NEUTRAL',
            action: 'WATCH',
            quickStatus: 'Ошибка сканирования',
            vpin: 0,
            cumDelta: 0,
            ofi: 0,
            realtimeOFI: undefined,
            turnover: 0,
            moexTurnover: tickerInfo.turnover,
            type: 'STOCK',
            error: r.reason?.message,
            taContext: undefined,
            convergenceScore: undefined,
            consistencyCheck: undefined,
            robotContext: undefined,
            _rawDetectorResults: undefined,
            _weights: undefined,
          });
          scannedTickers.add(tickerInfo.ticker);
        }
      }

      // Save progress after each batch (in case of timeout)
      try {
        await redis.setex(
          PROGRESS_KEY,
          PROGRESS_TTL,
          JSON.stringify({
            results: scannedResults,
            scannedTickers: [...scannedTickers],
            ts: Date.now(),
          }),
        );
      } catch { /* ignore Redis errors */ }

      // Delay between batches
      if (i + BATCH_SIZE < remaining.length && DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    // 6. Cross-section normalization (only on results with real data)
    const validResults = scannedResults.filter(r => r._rawDetectorResults && r._rawDetectorResults.length > 0);
    if (validResults.length > 1) {
      const allRawScores = validResults.map(r => r._rawDetectorResults!);
      const normalizedScores = crossSectionNormalize(allRawScores);

      for (let i = 0; i < validResults.length; i++) {
        const result = validResults[i];
        const normalized = normalizedScores[i];
        const weights = result._weights!;

        const bsciResult = calcBSCI(normalized, weights);
        const scoresMap: Record<string, number> = {};
        for (const ds of normalized) {
          scoresMap[ds.detector] = ds.score;
        }

        const scannerResult = applyScannerRules({
          bsci: bsciResult.bsci,
          prevBsci: result.prevBsci,
          alertLevel: bsciResult.alertLevel,
          direction: bsciResult.direction,
          detectorScores: scoresMap,
          ofi: result.ofi,
          cumDelta: result.cumDelta,
          vpin: result.vpin,
          turnover: result.turnover,
          prevTurnover: result.turnover,
        });

        result.bsci = bsciResult.bsci;
        result.alertLevel = bsciResult.alertLevel;
        result.direction = bsciResult.direction;
        result.detectorScores = scoresMap;
        result.keySignal = scannerResult.signal;
        result.action = scannerResult.action;
        result.quickStatus = scannerResult.quickStatus;
      }

      console.log(`[cross-section] Normalized ${validResults.length}/${scannedResults.length} tickers`);
    }

    // 7. Show ALL tickers — do NOT filter by BSCI level!
    // Even on weekends when BSCI ≈ 0, users should see tickers.
    // Low BSCI tickers are displayed as GREEN (calm) — that's correct.

    // 8. Sort by moexTurnover (VALTODAY) descending — TOP-100 = по обороту!
    const sorted = scannedResults.sort((a, b) =>
      (b.moexTurnover || b.turnover || 0) - (a.moexTurnover || a.turnover || 0)
    );

    // 9. Strip internal fields
    const cleanData = stripInternalFields(sorted);

    // ── hasRealData check (HOTFIX v4.1.5) ─────────────────────────────────
    // If ALL tickers have BSCI ≈ 0, market is truly closed → don't overwrite cache with zeros
    const hasRealData = scannedResults.some(r => r.bsci > 0.01);

    if (!hasRealData) {
      // Market truly closed — return cached data if available, don't overwrite with zeros
      console.log(`[/api/horizon/top100] No real data (all BSCI≈0), market likely closed (${sessionInfo.description})`);
      try {
        const cached = await redis.get(CACHE_KEY);
        if (cached) {
          const cachedData = JSON.parse(cached);
          return NextResponse.json({
            success: true,
            count: cachedData.length,
            data: cachedData,
            marketClosed: true,
            sessionInfo: sessionInfo.description,
            ts: Date.now(),
          });
        }
      } catch { /* ignore */ }

      // No cached data either
      return NextResponse.json({
        success: true,
        count: 0,
        data: [],
        marketClosed: true,
        sessionInfo: sessionInfo.description,
        ts: Date.now(),
      });
    }

    // 10. Save to Redis (2 hours TTL — HOTFIX v4.1.5: raised from 30 min)
    try {
      await redis.setex(CACHE_KEY, 7200, JSON.stringify(cleanData));
    } catch (redisErr: any) {
      console.warn('[/api/horizon/top100] Redis save failed:', redisErr.message);
    }

    // 11. Clear progress (scan complete)
    try {
      await redis.del(PROGRESS_KEY);
    } catch { /* ignore */ }

    const elapsed = Date.now() - startTime;
    const incomplete = remaining.length - (scannedResults.length - (scannedResults.length - scannedTickers.size));
    console.log(`[/api/horizon/top100] Done in ${elapsed}ms: ${sorted.length}/${scannedResults.length} tickers with real data (${scannedTickers.size} total scanned)`);

    return NextResponse.json({
      success: true,
      count: cleanData.length,
      totalScanned: scannedResults.length,
      source: tickersToScan[0]?.turnover > 0 ? 'moex-dynamic' : 'hardcoded',
      data: cleanData,
      elapsed,
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/top100] POST error:', error);
    return NextResponse.json(
      { error: error.message, ts: Date.now() },
      { status: 500 },
    );
  }
}
