#!/usr/bin/env node
/**
 * DB Stats Collector - Prisma API version
 * Собирает статистику с Neon (PostgreSQL) + Redis
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = '/home/g/gorizont-sobytij/data/db-stats';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUTPUT_FILE = path.join(OUTPUT_DIR, `${TIMESTAMP}.jsonl`);

async function main() {
  console.log('📊 DB Stats Collector Starting...');
  
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const ts = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // ===========================================
  // PostgreSQL via Prisma
  // ===========================================
  console.log('→ Loading Prisma client...');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  let pgStats = { error: 'Not collected' };

  try {
    console.log('→ Collecting PostgreSQL (Neon) data...');
    
    // Observations - count and aggregate
    const obsCount = await prisma.observation.count();
    const obsDistinct = await prisma.observation.findMany({
      select: { ticker: true },
      distinct: ['ticker']
    });
    
    // Get latest observations for stats
    const obsSample = await prisma.observation.findMany({
      take: 1000,
      orderBy: { timestamp: 'desc' }
    });
    
    const bsciValues = obsSample.map(o => o.bsci).filter(b => b !== null);
    const avgBsci = bsciValues.length ? bsciValues.reduce((a, b) => a + b, 0) / bsciValues.length : null;
    const minBsci = bsciValues.length ? Math.min(...bsciValues) : null;
    const maxBsci = bsciValues.length ? Math.max(...bsciValues) : null;
    
    const alertLevels = { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
    const directions = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
    
    obsSample.forEach(o => {
      if (o.alertLevel) alertLevels[o.alertLevel] = (alertLevels[o.alertLevel] || 0) + 1;
      if (o.direction) directions[o.direction] = (directions[o.direction] || 0) + 1;
    });
    
    const observations = {
      total_observations: obsCount,
      unique_tickers: obsDistinct.length,
      avg_bsci: avgBsci ? parseFloat(avgBsci.toFixed(4)) : null,
      min_bsci: minBsci,
      max_bsci: maxBsci,
      ...alertLevels,
      ...directions
    };

    // Detector scores aggregate
    const detScores = await prisma.detectorScore.findMany({
      select: { detector: true, score: true, signal: true }
    });
    
    const detectorMap = {};
    detScores.forEach(ds => {
      if (!detectorMap[ds.detector]) {
        detectorMap[ds.detector] = { count: 0, scores: [], signals: { BULLISH: 0, BEARISH: 0 } };
      }
      detectorMap[ds.detector].count++;
      if (ds.score !== null) detectorMap[ds.detector].scores.push(ds.score);
      if (ds.signal === 'BULLISH') detectorMap[ds.detector].signals.BULLISH++;
      if (ds.signal === 'BEARISH') detectorMap[ds.detector].signals.BEARISH++;
    });
    
    const detector_scores = Object.entries(detectorMap).map(([detector, data]) => ({
      detector,
      count: data.count,
      avg_score: data.scores.length ? parseFloat((data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(4)) : null,
      min_score: data.scores.length ? Math.min(...data.scores) : null,
      max_score: data.scores.length ? Math.max(...data.scores) : null,
      bullish_signals: data.signals.BULLISH,
      bearish_signals: data.signals.BEARISH
    }));

    // BSCI log
    const bsciLogCount = await prisma.bsciLog.count();
    const bsciLogDistinct = await prisma.bsciLog.findMany({
      select: { ticker: true },
      distinct: ['ticker']
    });
    const bsciLogSample = await prisma.bsciLog.findMany({ take: 1000 });
    const bsciLogValues = bsciLogSample.map(b => b.bsci).filter(b => b !== null);
    const bsci_log = {
      total_logs: bsciLogCount,
      tickers: bsciLogDistinct.length,
      avg_bsci: bsciLogValues.length ? parseFloat((bsciLogValues.reduce((a, b) => a + b, 0) / bsciLogValues.length).toFixed(4)) : null,
      min_bsci: bsciLogValues.length ? Math.min(...bsciLogValues) : null,
      max_bsci: bsciLogValues.length ? Math.max(...bsciLogValues) : null
    };

    // BSCI weights
    const bsci_weights = await prisma.bsciWeight.findMany({
      select: { detector: true, weight: true, accuracy: true, totalSignals: true, correctSignals: true }
    });

    // Reports
    const reportCount = await prisma.report.count();
    const reportDistinct = await prisma.report.findMany({
      select: { ticker: true },
      distinct: ['ticker']
    });
    const reports = {
      total_reports: reportCount,
      tickers: reportDistinct.length
    };

    pgStats = { observations, detector_scores, bsci_log, bsci_weights, reports };
    console.log('  PostgreSQL done:', obsCount, 'observations');

  } catch (err) {
    console.error('PostgreSQL error:', err.message);
    pgStats = { error: err.message };
  } finally {
    await prisma.$disconnect();
  }

  // ===========================================
  // Redis
  // ===========================================
  console.log('→ Collecting Redis data...');
  let redisStats = { error: 'Not collected' };

  try {
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(process.env.REDIS_URL || 'redis://default:mZv87MZXthQawhs92dYhkSj2UDfFPeAN@redis-17047.crce296.us-east-1-6.ec2.cloud.redislabs.com:17047');
    
    await redis.ping();
    
    const keys = await redis.keys('horizon:*');
    
    const keyPatterns = {
      scanner: keys.filter(k => k.includes('scanner')).length,
      obs: keys.filter(k => k.includes('obs')).length,
      signals: keys.filter(k => k.includes('signals')).length,
      algopack: keys.filter(k => k.includes('algopack')).length,
      other: keys.filter(k => !k.includes('scanner') && !k.includes('obs') && !k.includes('signals') && !k.includes('algopack')).length
    };
    
    const scannerTTL = await redis.ttl('horizon:scanner:top100');
    const signalsTTL = await redis.ttl('horizon:signals:active');
    const algopackTTL = await redis.ttl('horizon:algopack:latest');
    
    const scannerCache = await redis.get('horizon:scanner:top100');
    const scannerData = scannerCache ? JSON.parse(scannerCache) : null;
    
    redisStats = {
      totalKeys: keys.length,
      keyPatterns,
      mainTTLs: {
        scanner_top100: scannerTTL,
        signals_active: signalsTTL,
        algopack: algopackTTL
      },
      dataCounts: {
        scannerTop100Items: scannerData?.length || 0
      },
      sampleKeys: keys.slice(0, 15)
    };
    
    redis.disconnect();
    console.log('  Redis done:', keys.length, 'keys');

  } catch (err) {
    console.error('Redis error:', err.message);
    redisStats = { error: err.message };
  }

  // ===========================================
  // Write JSONL
  // ===========================================
  const records = [
    { ts, source: 'neon_postgresql', collection: 'observations', data: pgStats.observations, collectedAt: today },
    { ts, source: 'neon_postgresql', collection: 'detector_scores_agg', data: pgStats.detector_scores, collectedAt: today },
    { ts, source: 'neon_postgresql', collection: 'bsci_log', data: pgStats.bsci_log, collectedAt: today },
    { ts, source: 'neon_postgresql', collection: 'bsci_weights', data: pgStats.bsci_weights, collectedAt: today },
    { ts, source: 'neon_postgresql', collection: 'reports', data: pgStats.reports, collectedAt: today },
    { ts, source: 'redis', collection: 'keys', data: redisStats, collectedAt: today }
  ];

  const jsonl = records.map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(OUTPUT_FILE, jsonl);

  console.log(`\n✅ Saved to: ${OUTPUT_FILE}`);
  console.log(`   Size: ${(jsonl.length / 1024).toFixed(1)} KB`);

  // Summary
  console.log('\n📊 SUMMARY:');
  console.log('  PostgreSQL:');
  console.log(`    Observations: ${pgStats.observations?.total_observations || 'N/A'}`);
  console.log(`    Unique tickers: ${pgStats.observations?.unique_tickers || 'N/A'}`);
  console.log(`    Avg BSCI: ${pgStats.observations?.avg_bsci || 'N/A'}`);
  console.log(`    BSCI logs: ${pgStats.bsci_log?.total_logs || 'N/A'}`);
  console.log(`    Reports: ${pgStats.reports?.total_reports || 'N/A'}`);
  console.log('  Redis:');
  console.log(`    Total keys: ${redisStats.totalKeys || 'N/A'}`);
  console.log(`    Scanner cache: ${redisStats.dataCounts?.scannerTop100Items || 'N/A'} items`);
}

main().catch(console.error);