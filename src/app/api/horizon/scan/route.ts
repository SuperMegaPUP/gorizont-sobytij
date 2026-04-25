// ─── /api/horizon/scan — POST: Scanner Batch Run ──────────────────────────
// Scans all 9 core futures tickers in parallel:
// 1. collectMarketData() → runAllDetectors() → calcBSCI() → applyScannerRules()
// 2. Saves results to Redis key `horizon:scanner:latest` (TTL 1 hour)
// 3. Batch inserts into bsci_log table
// 4. Returns scanner results
//
// v2: Поддержка параметра tickers для TOP-100 пакетного сканирования

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import redis from '@/lib/redis';
import { collectMarketData, fetchTop100Tickers } from '@/lib/horizon/observer/collect-market-data';
import { runAllDetectors, calcBSCI } from '@/lib/horizon/detectors/registry';
import type { DetectorResult } from '@/lib/horizon/detectors/types';
import { crossSectionNormalize, computeCrossSectionStats } from '@/lib/horizon/detectors/cross-section-normalize';
import { calculateTAIndicators, calculateSignalConvergence, type SignalConvergence } from '@/lib/horizon/ta-context';
import { checkInternalConsistency, type InternalConsistencyResult } from '@/lib/horizon/internal-consistency';
import { calculateConvergenceScore, type ConvergenceScoreResult } from '@/lib/horizon/convergence-score';
import { applyScannerRules, type ScannerResult } from '@/lib/horizon/scanner/rules';
import { calculateRobotContext, findTopDetector, isRobotConfirmed, type RobotContext } from '@/lib/horizon/robot-context';

// ─── 9 Core Tickers (short codes → real MOEX tickers resolved by collectMarketData) ─────

export const SCANNER_TICKERS = [
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

// ─── TOP 100 Tickers (actual MOEX share codes on TQBR) ─────────────────────

export const TOP100_TICKERS: readonly { ticker: string; name: string }[] = [
  // ТОП-20 (оригинальный список)
  { ticker: 'SBER', name: 'Сбербанк' },
  { ticker: 'GAZP', name: 'Газпром' },
  { ticker: 'LKOH', name: 'ЛУКОЙЛ' },
  { ticker: 'GMKN', name: 'Норникель' },
  { ticker: 'YNDX', name: 'Яндекс' },
  { ticker: 'VTBR', name: 'ВТБ' },
  { ticker: 'ROSN', name: 'Роснефть' },
  { ticker: 'PLZL', name: 'Полюс' },
  { ticker: 'MGNT', name: 'Магнит' },
  { ticker: 'NVTK', name: 'Новатэк' },
  { ticker: 'SNGS', name: 'Сургутнефтегаз' },
  { ticker: 'TATN', name: 'Татнефть' },
  { ticker: 'ALRS', name: 'Алроса' },
  { ticker: 'CHMF', name: 'Северсталь' },
  { ticker: 'NLMK', name: 'НЛМК' },
  { ticker: 'POLY', name: 'Polymetal' },
  { ticker: 'RUAL', name: 'Rusal' },
  { ticker: 'OZON', name: 'Ozon' },
  { ticker: 'TCSG', name: 'ТКС Холдинг' },
  { ticker: 'FIVE', name: 'X5 Retail' },
  // 21–40
  { ticker: 'SBERP', name: 'Сбербанк-п' },
  { ticker: 'GAZPP', name: 'Газпром-п' },
  { ticker: 'SNGSP', name: 'Сургутнефтегаз-п' },
  { ticker: 'TATNP', name: 'Татнефть-п' },
  { ticker: 'SIBN', name: 'Газпром нефть' },
  { ticker: 'MOEX', name: 'Московская биржа' },
  { ticker: 'AFKS', name: 'Система' },
  { ticker: 'MTLR', name: 'Мечел' },
  { ticker: 'IRAO', name: 'Интер РАО' },
  { ticker: 'PHOR', name: 'ФосАгро' },
  { ticker: 'FLOT', name: 'Совкомфлот' },
  { ticker: 'LENT', name: 'Лента' },
  { ticker: 'SGZH', name: 'Сегежа' },
  { ticker: 'TRMK', name: 'ТМК' },
  { ticker: 'PIKK', name: 'ПИК' },
  { ticker: 'RTKM', name: 'Ростелеком' },
  { ticker: 'HYDR', name: 'РусГидро' },
  { ticker: 'FEES', name: 'ФСК ЕЭС' },
  { ticker: 'MAGN', name: 'ММК' },
  { ticker: 'VTBRP', name: 'ВТБ-п' },
  // 41–60
  { ticker: 'LSRG', name: 'ЛСР' },
  { ticker: 'SELG', name: 'Селигдар' },
  { ticker: 'FIXP', name: 'Fix Price' },
  { ticker: 'VKCO', name: 'VK Company' },
  { ticker: 'HEAD', name: 'HeadHunter' },
  { ticker: 'TCSGP', name: 'ТКС-п' },
  { ticker: 'RUALP', name: 'Rusal-п' },
  { ticker: 'SMLT', name: 'СМЛТ' },
  { ticker: 'AFLT', name: 'Аэрофлот' },
  { ticker: 'CBOM', name: 'МКБ' },
  { ticker: 'POSI', name: 'Parent' },
  { ticker: 'KZOS', name: 'Казаньоргсинтез' },
  { ticker: 'LSNG', name: 'Ленэнерго' },
  { ticker: 'LSNGP', name: 'Ленэнерго-п' },
  { ticker: 'DVEC', name: 'ДЭК' },
  { ticker: 'MSNG', name: 'Мосэнерго' },
  { ticker: 'MSRS', name: 'МРСК Сибири' },
  { ticker: 'RNFT', name: 'Распадская' },
  { ticker: 'GRNT', name: 'Грандлайн' },
  { ticker: 'NKNC', name: 'Нижнекамскнефтехим' },
  // 61–80
  { ticker: 'BANE', name: 'Башнефть' },
  { ticker: 'BANEP', name: 'Башнефть-п' },
  { ticker: 'CLKN', name: 'Клиник' },
  { ticker: 'AKRN', name: 'Акрон' },
  { ticker: 'IRKT', name: 'ИРКУТ' },
  { ticker: 'LNZL', name: 'Лензолото' },
  { ticker: 'LNZLP', name: 'Лензолото-п' },
  { ticker: 'MSTT', name: 'Мостотрест' },
  { ticker: 'NMTP', name: 'НМТП' },
  { ticker: 'APTK', name: 'Аптека' },
  { ticker: 'GTLC', name: 'ГТЛК' },
  { ticker: 'KMAZ', name: 'КАМАЗ' },
  { ticker: 'USBN', name: 'Юнистрим' },
  { ticker: 'SELGP', name: 'Селигдар-п' },
  { ticker: 'VSMO', name: 'ВСМПО-АВИСМА' },
  { ticker: 'MRKC', name: 'МРСК ЦП' },
  { ticker: 'MRKP', name: 'МРСК ЦП-п' },
  { ticker: 'MRKK', name: 'МРСК Юга' },
  { ticker: 'MRKV', name: 'МРСК Волги' },
  { ticker: 'MRKU', name: 'МРСК Урала' },
  // 81–100
  { ticker: 'MRKY', name: 'МРСК Сибири' },
  { ticker: 'MRKS', name: 'МРСК СЗ' },
  { ticker: 'KOGK', name: 'Косогорский' },
  { ticker: 'KZOSP', name: 'Казаньоргс-п' },
  { ticker: 'TGKA', name: 'ТГК-1' },
  { ticker: 'TGKN', name: 'ТГК-2' },
  { ticker: 'TGKM', name: 'ТГК-14' },
  { ticker: 'UNAC', name: 'Объединённые' },
  { ticker: 'MORI', name: 'Мори' },
  { ticker: 'ZRAN', name: 'Зарубежнефть' },
  { ticker: 'ZILL', name: 'ЗИЛ' },
  { ticker: 'YAKG', name: 'Якутскэнерго' },
  { ticker: 'MGKL', name: 'МГКЛ' },
  { ticker: 'MTLRP', name: 'Мечел-п' },
  { ticker: 'OGKB', name: 'ОГК-2' },
  { ticker: 'PLZLP', name: 'Полюс-п' },
  { ticker: 'KRKN', name: 'Крокус' },
  { ticker: 'KAZT', name: 'КАЗТ' },
  { ticker: 'KAZTP', name: 'КАЗТ-п' },
  { ticker: 'MEGP', name: 'Мегаполис' },
];

// ─── Single Ticker Scan ───────────────────────────────────────────────────

export interface TickerScanResult {
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
  realtimeOFI?: number;   // Real-time OFI (Cont et al. 2014) — дельта стакана
  turnover: number;
  moexTurnover?: number;  // VALTODAY от MOEX (реальный оборот за день в рублях)
  type: 'FUTURE' | 'STOCK';
  error?: string;
  // TA Context layer (НЕ входит в BSCI!)
  taContext?: SignalConvergence;
  // Convergence score 0-10
  convergenceScore?: ConvergenceScoreResult;
  // Level-0 internal consistency
  consistencyCheck?: InternalConsistencyResult;
  // Robot context (Спринт 3)
  robotContext?: RobotContext;
  // Internal fields for cross-section normalization (stripped before API response)
  _rawDetectorResults?: DetectorResult[];
  _weights?: Record<string, number>;
}

// Фьючерсные тикеры (реальные фьючерсы на срочном рынке)
const FUTURES_TICKERS = new Set(['Si', 'RI', 'BR']);

export async function scanTicker(
  tickerInfo: { ticker: string; name: string; moexTurnover?: number },
): Promise<TickerScanResult> {
  const { ticker, name, moexTurnover } = tickerInfo;
  const tickerType = FUTURES_TICKERS.has(ticker) ? 'FUTURE' as const : 'STOCK' as const;

  try {
    // 1. Collect market data (with auto-resolution)
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

    // 3.5 Level-0: Internal Consistency Check
    // Проверяем галлюцинации детекторов на пустых данных
    const turnover3_5 = detectorInput.trades.reduce(
      (sum, t) => sum + t.price * t.quantity,
      0,
    );
    const consistencyCheck = checkInternalConsistency(
      detectorScores,
      detectorInput.cumDelta.delta,
      detectorInput.vpin.vpin,
      turnover3_5,
      weights,
    );
    // Используем скорректированные веса если есть галлюцинации
    const effectiveWeights = consistencyCheck.hasHallucination
      ? consistencyCheck.adjustedWeights
      : weights;
    if (consistencyCheck.hasHallucination) {
      console.log(`[horizon/scan] Level-0: ${ticker} has hallucinations: ${consistencyCheck.hallucinations.join(', ')}`);
    }

    // 4. Calculate BSCI (with consistency-adjusted weights)
    const bsciResult = calcBSCI(detectorScores, effectiveWeights);

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

    // 11. TA Context layer (НЕ входит в BSCI — только контекст!)
    let taContext: SignalConvergence | undefined;
    let convergenceScore: ConvergenceScoreResult | undefined;
    let robotContext: RobotContext | undefined;
    try {
      const taIndicators = calculateTAIndicators(
        detectorInput.candles,
        detectorInput.trades,
        detectorInput.orderbook,
      );
      taContext = calculateSignalConvergence(
        bsciResult.direction,
        bsciResult.bsci,
        taIndicators,
      );

      // 11.3 Robot Context (Спринт 3) — до convergence score!
      const topDetector = findTopDetector(scoresMap);
      const totalTradeVolumeLots = detectorInput.trades.reduce(
        (sum, t) => sum + t.quantity, 0,
      );
      try {
        robotContext = await calculateRobotContext(
          ticker,
          detectorInput.trades.map(t => ({
            price: t.price,
            quantity: t.quantity,
            side: t.side as 'BUY' | 'SELL',
            time: t.time,
          })),
          topDetector,
          totalTradeVolumeLots,
        );
        // DEBUG: log robot confirmation for top tickers
        if (robotContext.confirmation < 0.4 && robotContext.source !== 'none') {
          console.log(`[horizon/scan] ${ticker}: topDetector=${topDetector}, confirmation=${robotContext.confirmation}, source=${robotContext.source}, wall=${robotContext.wallScore}, accum=${robotContext.accumScore}, matched=${robotContext.matchedDetector}↔${robotContext.matchedPattern}`);
        }
      } catch (robotErr: any) {
        console.warn(`[horizon/scan] Robot context failed for ${ticker}:`, robotErr.message);
      }

      // 11.5 Convergence Score 0-10
      convergenceScore = calculateConvergenceScore(
        bsciResult.direction,
        bsciResult.bsci,
        taIndicators,
        taContext.divergence,                   // бонус за дивергенцию
        taIndicators.atrZone === 'COMPRESSED',   // бонус за ATR-сжатие
        isRobotConfirmed(robotContext),           // робот-подтверждение (Спринт 3)!
        robotContext?.hasSpoofing ?? false,       // штраф за спуфинг (−2)
        robotContext?.cancelRatio ?? 0,           // штраф за cancel>80% (−1)
      );
    } catch (taErr: any) {
      console.warn(`[horizon/scan] TA context failed for ${ticker}:`, taErr.message);
    }

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
      realtimeOFI: detectorInput.realtimeOFI,
      turnover,
      moexTurnover,
      type: tickerType,
      taContext,
      convergenceScore,
      consistencyCheck,
      robotContext,
      // Internal: for cross-section normalization
      _rawDetectorResults: detectorScores,
      _weights: weights,
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
      quickStatus: `Спокойно. BSCI 0.00. ОШИБКА: ${error.message?.slice(0, 40)}`,
      vpin: 0,
      cumDelta: 0,
      ofi: 0,
      realtimeOFI: undefined,
      turnover: 0,
      moexTurnover,
      type: tickerType,
      error: error.message,
      taContext: undefined,
      convergenceScore: undefined,
      consistencyCheck: undefined,
      robotContext: undefined,
      _rawDetectorResults: undefined,
      _weights: undefined,
    };
  }
}

// ─── Cross-Section Normalization ──────────────────────────────────────────

/**
 * Применяет кросс-секционную нормализацию к результатам сканирования.
 * Z-score по батчу тикеров для каждого детектора → растягивает BSCI.
 *
 * ПОСЛЕ нормализации пересчитывает BSCI и заново применяет scanner rules.
 */
async function applyCrossSectionNorm(results: TickerScanResult[]): Promise<TickerScanResult[]> {
  // Собираем только результаты с raw detector results (без ошибок)
  const validResults = results.filter(r => r._rawDetectorResults && r._rawDetectorResults.length > 0);

  if (validResults.length <= 1) {
    console.log('[cross-section] Skipping: only 0-1 valid results');
    return results;
  }

  // 1. Собираем все raw detector scores для нормализации
  const allRawScores = validResults.map(r => r._rawDetectorResults!);

  // 2. Кросс-секционная нормализация
  const normalizedScores = crossSectionNormalize(allRawScores);

  // 3. Пересчитываем BSCI и обновляем результаты
  let normalizedCount = 0;
  for (let i = 0; i < validResults.length; i++) {
    const result = validResults[i];
    const normalized = normalizedScores[i];
    const weights = result._weights!;

    // Пересчитываем BSCI из нормализованных скоров
    const bsciResult = calcBSCI(normalized, weights);

    // Обновляем detector scores map
    const scoresMap: Record<string, number> = {};
    for (const ds of normalized) {
      scoresMap[ds.detector] = ds.score;
    }

    // Пересчитываем scanner rules с новыми BSCI/scores
    const scannerResult: ScannerResult = applyScannerRules({
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

    // Обновляем результат
    result.bsci = bsciResult.bsci;
    result.alertLevel = bsciResult.alertLevel;
    result.direction = bsciResult.direction;
    result.detectorScores = scoresMap;
    result.keySignal = scannerResult.signal;
    result.action = scannerResult.action;
    result.quickStatus = scannerResult.quickStatus;
    normalizedCount++;
  }

  console.log(`[cross-section] Normalized ${normalizedCount}/${results.length} tickers. BSCI range: ${validResults.map(r => r.bsci).sort((a,b) => a-b).map(v => v.toFixed(2)).join(' → ')}`);

  // Сохраняем статистики в Redis для одиночных наблюдений (generate-observation)
  try {
    const stats = computeCrossSectionStats(allRawScores);
    await redis.setex(
      'horizon:cross-section:stats',
      7200, // 2 часа TTL
      JSON.stringify(stats),
    );
    console.log('[cross-section] Stats saved to Redis for single-ticker normalization');
  } catch (e: any) {
    console.warn('[cross-section] Failed to save stats to Redis:', e.message);
  }

  return results;
}

/**
 * Удаляет внутренние поля (_rawDetectorResults, _weights) перед отправкой клиенту
 */
function stripInternalFields(results: TickerScanResult[]): any[] {
  return results.map(({ _rawDetectorResults, _weights, ...rest }) => rest);
}

// ─── Batch Scanner Helper ────────────────────────────────────────────────

/**
 * Сканирует список тикеров батчами с кросс-секционной нормализацией
 * @param tickers — список тикеров для сканирования
 * @param batchSize — размер батча (параллельные запросы)
 * @param delayMs — задержка между батчами (мс)
 */
export async function scanBatch(
  tickers: readonly { ticker: string; name: string; moexTurnover?: number }[],
  batchSize: number = 5,
  delayMs: number = 2000,
): Promise<TickerScanResult[]> {
  const results: TickerScanResult[] = [];

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((t) => scanTicker(t)),
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      }
    }

    // Задержка между батчами (кроме последнего)
    if (i + batchSize < tickers.length && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // ── Cross-section normalization: ПОСЛЕ всех детекторов, ПЕРЕД возвратом ──
  await applyCrossSectionNorm(results);

  return results;
}

// ─── Dynamic TOP-100 Helper ────────────────────────────────────────────────

async function getTop100Tickers(): Promise<{ ticker: string; name: string; moexTurnover?: number }[]> {
  try {
    const dynamic = await fetchTop100Tickers();
    if (dynamic.length >= 20) {
      return dynamic.map(t => ({ ticker: t.ticker, name: t.name, moexTurnover: t.turnover }));
    }
  } catch (e: any) {
    console.warn('[/api/horizon/scan] Dynamic TOP-100 fetch failed:', e.message);
  }
  // Fallback to hardcoded list
  console.warn('[/api/horizon/scan] Using hardcoded TOP-100 list as fallback');
  return [...TOP100_TICKERS];
}

// ─── POST: Run Scanner ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check for TOP-100 mode via query param or body
    let scanMode: 'core' | 'top100' = 'core';
    let customTickers: { ticker: string; name: string }[] | null = null;

    try {
      const url = request.nextUrl;
      const mode = url.searchParams.get('mode');
      if (mode === 'top100') scanMode = 'top100';

      // Also check body
      const body = await request.clone().json().catch(() => ({}));
      if (body?.mode === 'top100') scanMode = 'top100';
      if (body?.tickers && Array.isArray(body.tickers)) {
        customTickers = body.tickers;
      }
    } catch { /* ignore parse errors */ }

    const tickersToScan = customTickers ||
      (scanMode === 'top100' ? await getTop100Tickers() : [...SCANNER_TICKERS]);

    console.log(`[/api/horizon/scan] Starting scanner for ${tickersToScan.length} tickers (mode=${scanMode})`);

    // Core mode: full parallel, TOP-100: batched
    let scannerData: TickerScanResult[];

    if (scanMode === 'core') {
      // Core 9: scan all in parallel (fast, only 9 tickers)
      const results = await Promise.allSettled(
        tickersToScan.map((t) => scanTicker(t)),
      );
      scannerData = results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return {
          ticker: tickersToScan[i].ticker,
          name: tickersToScan[i].name,
          bsci: 0,
          prevBsci: 0,
          alertLevel: 'GREEN' as const,
          direction: 'NEUTRAL' as const,
          confidence: 0,
          detectorScores: {},
          keySignal: 'NEUTRAL',
          action: 'WATCH' as const,
          quickStatus: 'Спокойно. BSCI 0.00. ОШИБКА',
          vpin: 0,
          cumDelta: 0,
          ofi: 0,
          realtimeOFI: undefined,
          turnover: 0,
          moexTurnover: (tickersToScan[i] as any).moexTurnover,
          type: FUTURES_TICKERS.has(tickersToScan[i].ticker) ? 'FUTURE' as const : 'STOCK' as const,
          error: r.reason?.message || 'Unknown error',
          taContext: undefined,
          convergenceScore: undefined,
          consistencyCheck: undefined,
          robotContext: undefined,
          _rawDetectorResults: undefined,
          _weights: undefined,
        };
      });

      // ── Cross-section normalization для core 9 ──
      await applyCrossSectionNorm(scannerData);
    } else {
      // TOP-100: batched scanning (20 at a time, 300ms delay)
      // scanBatch уже включает cross-section normalization
      scannerData = await scanBatch(tickersToScan, 20, 300);
    }

    // Strip internal fields before saving/sending
    const cleanData = stripInternalFields(scannerData);

    // Save to Redis
    const redisKey = scanMode === 'top100' ? 'horizon:scanner:top100' : 'horizon:scanner:latest';
    const redisTTL = scanMode === 'top100' ? 1800 : 3600; // TOP-100: 30 min, Core: 1 hour

    try {
      await redis.setex(
        redisKey,
        redisTTL,
        JSON.stringify(cleanData),
      );
    } catch (redisErr: any) {
      console.warn(`[/api/horizon/scan] Redis save failed (${redisKey}):`, redisErr.message);
    }

    // Batch insert into bsci_log
    try {
      const logEntries = cleanData
        .filter((d: any) => d.bsci > 0) // Only log tickers with actual data
        .map((d: any) => ({
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
    console.log(`[/api/horizon/scan] Done in ${elapsed}ms: ${scannerData.length} tickers scanned (mode=${scanMode})`);

    return NextResponse.json({
      success: true,
      mode: scanMode,
      count: cleanData.length,
      data: cleanData,
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
