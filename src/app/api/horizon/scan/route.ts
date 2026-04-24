// ─── /api/horizon/scan — POST: Scanner Batch Run ──────────────────────────
// Scans all 9 futures tickers in parallel:
// 1. collectMarketData() → runAllDetectors() → calcBSCI() → applyScannerRules()
// 2. Saves results to Redis key `horizon:scanner:latest` (TTL 1 hour)
// 3. Batch inserts into bsci_log table
// 4. Returns scanner results

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import redis from '@/lib/redis';
import { collectMarketData } from '@/lib/horizon/observer/collect-market-data';
import { runAllDetectors, calcBSCI } from '@/lib/horizon/detectors/registry';
import { applyScannerRules, type ScannerResult } from '@/lib/horizon/scanner/rules';

// ─── 9 Futures tickers ────────────────────────────────────────────────────

const SCANNER_TICKERS = [
  { ticker: 'MX', name: 'Московская биржа' },
  { ticker: 'Si', name: 'Доллар/рубль' },
  { ticker: 'RI', name: 'Индекс РТС' },
  { ticker: 'BR', name: 'Нефть Brent' },
  { ticker: 'GZ', name: 'Газпром' },
  { ticker: 'GK', name: 'ГМК Норникель' },
  { ticker: 'SR', name: 'Сбербанк' },
  { ticker: 'LK', name: 'ЛУКОЙЛ' },
  { ticker: 'RN', name: 'Роснефть' },
] as const;

// ─── Single Ticker Scan ───────────────────────────────────────────────────

interface TickerScanResult {
  ticker: string;
  name: string;
  bsci: number;
  prevBsci: number;
  alertLevel: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  detectorScores: Record<string, number>;
  keySignal: string;
  action: 'WATCH' | 'ALERT' | 'URGENT';
  quickStatus: string;
  vpin: number;
  cumDelta: number;
  ofi: number;
  turnover: number;
  error?: string;
}

async function scanTicker(
  tickerInfo: { ticker: string; name: string },
): Promise<TickerScanResult> {
  const { ticker, name } = tickerInfo;

  try {
    // 1. Collect market data
    const { detectorInput } = await collectMarketData(ticker);

    // 2. Load current BSCI weights
    const weightsRows = await prisma.bsciWeight.findMany();
    const weights: Record<string, number> = {};
    for (const w of weightsRows) {
      weights[w.detector] = w.weight;
    }
    // Fallback: equal weights 0.1
    if (Object.keys(weights).length === 0) {
      const detectorNames = [
        'GRAVITON', 'DARKMATTER', 'ACCRETOR', 'DECOHERENCE', 'HAWKING',
        'PREDATOR', 'CIPHER', 'ENTANGLE', 'WAVEFUNCTION', 'ATTRACTOR',
      ];
      for (const d of detectorNames) weights[d] = 0.1;
    }

    // 3. Run all 10 detectors
    const detectorScores = runAllDetectors(detectorInput);

    // 4. Calculate BSCI
    const bsciResult = calcBSCI(detectorScores, weights);

    // 5. Build detector scores map
    const scoresMap: Record<string, number> = {};
    for (const ds of detectorScores) {
      scoresMap[ds.detector] = ds.score;
    }

    // 6. Get previous BSCI from Redis
    let prevBsci = 0;
    try {
      const prevData = await redis.get(`horizon:scanner:bsci:${ticker}`);
      if (prevData) prevBsci = Number(prevData);
    } catch { /* ignore Redis errors */ }

    // 7. Calculate turnover
    const turnover = detectorInput.trades.reduce(
      (sum, t) => sum + t.price * t.quantity,
      0,
    );

    // 8. Apply scanner rules
    const scannerResult: ScannerResult = applyScannerRules({
      bsci: bsciResult.bsci,
      prevBsci,
      alertLevel: bsciResult.alertLevel,
      direction: bsciResult.direction,
      detectorScores: scoresMap,
      ofi: detectorInput.ofi,
      cumDelta: detectorInput.cumDelta.delta,
      vpin: detectorInput.vpin.vpin,
      turnover,
      prevTurnover: turnover, // simplified: same turnover for now
    });

    // 9. Save current BSCI to Redis for next comparison
    try {
      await redis.setex(`horizon:scanner:bsci:${ticker}`, 3600, String(bsciResult.bsci));
    } catch { /* ignore Redis errors */ }

    // 10. Calculate max confidence
    const confidence = detectorScores.reduce(
      (max, ds) => Math.max(max, ds.confidence),
      0,
    );

    return {
      ticker,
      name,
      bsci: bsciResult.bsci,
      prevBsci,
      alertLevel: bsciResult.alertLevel,
      direction: bsciResult.direction,
      confidence,
      detectorScores: scoresMap,
      keySignal: scannerResult.signal,
      action: scannerResult.action,
      quickStatus: scannerResult.quickStatus,
      vpin: detectorInput.vpin.vpin,
      cumDelta: detectorInput.cumDelta.delta,
      ofi: detectorInput.ofi,
      turnover,
    };
  } catch (error: any) {
    console.error(`[horizon/scan] Error scanning ${ticker}:`, error.message);
    return {
      ticker,
      name,
      bsci: 0,
      prevBsci: 0,
      alertLevel: 'GREEN',
      direction: 'NEUTRAL',
      confidence: 0,
      detectorScores: {},
      keySignal: 'NEUTRAL',
      action: 'WATCH',
      quickStatus: `✅ Спокойно. BSCI 0.00 →. ОШИБКА: ${error.message?.slice(0, 40)}`,
      vpin: 0,
      cumDelta: 0,
      ofi: 0,
      turnover: 0,
      error: error.message,
    };
  }
}

// ─── POST: Run Scanner ────────────────────────────────────────────────────

export async function POST(_request: NextRequest) {
  const startTime = Date.now();

  try {
    console.log('[/api/horizon/scan] Starting scanner for 9 tickers');

    // Process tickers in parallel with resilience
    const results = await Promise.allSettled(
      SCANNER_TICKERS.map((t) => scanTicker(t)),
    );

    // Extract successful results, use fallback for failed ones
    const scannerData: TickerScanResult[] = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        ticker: SCANNER_TICKERS[i].ticker,
        name: SCANNER_TICKERS[i].name,
        bsci: 0,
        prevBsci: 0,
        alertLevel: 'GREEN' as const,
        direction: 'NEUTRAL' as const,
        confidence: 0,
        detectorScores: {},
        keySignal: 'NEUTRAL',
        action: 'WATCH' as const,
        quickStatus: '✅ Спокойно. BSCI 0.00 →. ОШИБКА',
        vpin: 0,
        cumDelta: 0,
        ofi: 0,
        turnover: 0,
        error: r.reason?.message || 'Unknown error',
      };
    });

    // Save to Redis (TTL 1 hour)
    try {
      await redis.setex(
        'horizon:scanner:latest',
        3600,
        JSON.stringify(scannerData),
      );
    } catch (redisErr: any) {
      console.warn('[/api/horizon/scan] Redis save failed:', redisErr.message);
    }

    // Batch insert into bsci_log
    try {
      const logEntries = scannerData
        .filter((d) => d.bsci > 0)
        .map((d) => ({
          ticker: d.ticker,
          bsci: d.bsci,
          alertLevel: d.alertLevel,
          topDetector: Object.entries(d.detectorScores).reduce(
            (top, [name, score]) => (score > (d.detectorScores[top] ?? 0) ? name : top),
            'NONE',
          ),
          direction: d.direction,
        }));

      if (logEntries.length > 0) {
        await prisma.bsciLog.createMany({ data: logEntries });
      }
    } catch (dbErr: any) {
      console.warn('[/api/horizon/scan] bsci_log batch insert failed:', dbErr.message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[/api/horizon/scan] Done in ${elapsed}ms: ${scannerData.length} tickers scanned`);

    return NextResponse.json({
      success: true,
      count: scannerData.length,
      data: scannerData,
      elapsed,
      ts: Date.now(),
    });
  } catch (error: any) {
    console.error('[/api/horizon/scan] Error:', error);
    return NextResponse.json(
      { error: error.message, ts: Date.now() },
      { status: 500 },
    );
  }
}
