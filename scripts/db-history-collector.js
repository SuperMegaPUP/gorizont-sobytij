#!/usr/bin/env node
/**
 * DB History Collector
 * Собирает данные из PostgreSQL (Neon) + Redis за период
 * Сохраняет в JSONL формате (как detailed_monitor.sh)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/home/g/gorizont-sobytij/data/db-stats';
const OUTPUT_FILE = path.join(DATA_DIR, `history_${new Date().toISOString().slice(0, 10)}.jsonl`);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ts = Date.now();
console.log('📊 DB History Collector Starting...');

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const Redis = require('ioredis');

  // Подключение к PostgreSQL
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_1kPCmxYN8VtT@ep-twilight-feather-amj7pqum-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require'
      }
    }
  });

  // Подключение к Redis  
  const redis = new Redis(process.env.REDIS_URL || 'redis://default:mZv87MZXthQawhs92dYhkSj2UDfFPeAN@redis-17047.crce296.us-east-1-6.ec2.cloud.redislabs.com:17047');
  
  await redis.ping();
  console.log('  → Connected to PostgreSQL and Redis');

  const records = [];

  // ===========================================
  // 1. PostgreSQL - Observations за период
  // ===========================================
  console.log('  → Fetching observations from PostgreSQL...');
  
  // Вчера 19:00 МСК = 16:00 UTC (29.04.2026)
  // Сегодня 15:30 МСК = 12:30 UTC (30.04.2026)
  const yesterdayStart = new Date('2026-04-29T16:00:00Z');
  const todayEnd = new Date('2026-04-30T12:30:00Z');

  try {
    const observations = await prisma.observation.findMany({
      where: {
        timestamp: {
          gte: yesterdayStart,
          lte: todayEnd
        }
      },
      orderBy: { timestamp: 'asc' },
      take: 10000
    });

    console.log(`     Found ${observations.length} observations`);

    for (const obs of observations) {
      // Получаем связанные detector scores
      const detScores = await prisma.detectorScore.findMany({
        where: { observationId: obs.id }
      });

      const detectorScores = {};
      detScores.forEach(ds => {
        detectorScores[ds.detector] = ds.score;
      });

      records.push({
        ts: obs.timestamp.getTime(),
        type: 'postgres_observation',
        ticker: obs.ticker,
        data: {
          bsci: obs.bsci,
          alertLevel: obs.alertLevel,
          direction: obs.direction,
          confidence: obs.confidence,
          detectorScores,
          aiComment: obs.aiComment,
          timestamp: obs.timestamp.toISOString()
        }
      });
    }
  } catch(e) {
    console.log('     ERROR:', e.message);
  }

  // ===========================================
  // 2. PostgreSQL - BSCI Log за период
  // ===========================================
  console.log('  → Fetching BSCI logs from PostgreSQL...');
  
  try {
    const bsciLogs = await prisma.bsciLog.findMany({
      where: {
        timestamp: {
          gte: yesterdayStart,
          lte: todayEnd
        }
      },
      orderBy: { timestamp: 'asc' },
      take: 10000
    });

    console.log(`     Found ${bsciLogs.length} BSCI logs`);

    for (const log of bsciLogs) {
      records.push({
        ts: log.timestamp.getTime(),
        type: 'postgres_bsci_log',
        ticker: log.ticker,
        data: {
          bsci: log.bsci,
          alertLevel: log.alertLevel,
          direction: log.direction,
          topDetector: log.topDetector,
          timestamp: log.timestamp.toISOString()
        }
      });
    }
  } catch(e) {
    console.log('     ERROR:', e.message);
  }

  // ===========================================
  // 3. Redis - сканируем ключи
  // ===========================================
  console.log('  → Fetching Redis cache data...');

  try {
    // Получаем данные сканера из кэша
    const scannerData = await redis.get('horizon:scanner:top100');
    if (scannerData) {
      const tickers = JSON.parse(scannerData);
      console.log(`     Found ${tickers.length} tickers in Redis cache`);

      // Сохраняем моментальный снимок TOP-100
      records.push({
        ts: Date.now(),
        type: 'redis_scanner_snapshot',
        data: {
          tickersCount: tickers.length,
          tickers: tickers.map(t => ({
            ticker: t.ticker,
            bsci: t.bsci,
            direction: t.direction,
            alertLevel: t.alertLevel
          }))
        }
      });
    }

    // Получаем ключи и их TTL
    const keys = await redis.keys('horizon:*');
    const keyInfo = [];

    for (const key of keys.slice(0, 50)) { // первые 50 ключей
      const ttl = await redis.ttl(key);
      keyInfo.push({ key: key.replace('horizon:', ''), ttl });
    }

    records.push({
      ts: Date.now(),
      type: 'redis_keys_info',
      data: {
        totalKeys: keys.length,
        sampleKeys: keyInfo
      }
    });

  } catch(e) {
    console.log('     ERROR:', e.message);
  }

  // ===========================================
  // 4. Агрегации по периоду
  // ===========================================
  console.log('  → Computing aggregates...');

  // Группируем по часам
  const hourlyBsci = {};
  records.filter(r => r.type === 'postgres_bsci_log').forEach(r => {
    const hour = new Date(r.data.timestamp).getHours();
    if (!hourlyBsci[hour]) hourlyBsci[hour] = [];
    hourlyBsci[hour].push(r.data.bsci);
  });

  const hourlyAvg = {};
  Object.entries(hourlyBsci).forEach(([hour, values]) => {
    hourlyAvg[hour] = values.reduce((a, b) => a + b, 0) / values.length;
  });

  records.push({
    ts: Date.now(),
    type: 'aggregate_hourly_bsci',
    data: hourlyAvg
  });

  // Запись в файл
  console.log(`\n💾 Writing ${records.length} records to ${OUTPUT_FILE}...`);
  
  const lines = records.map(r => JSON.stringify(r, ensure_ascii=false)).join('\n');
  fs.writeFileSync(OUTPUT_FILE, lines);

  console.log(`\n✅ Done! Total records: ${records.length}`);
  console.log(`   File: ${OUTPUT_FILE}`);
  console.log(`   Size: ${(lines.length / 1024).toFixed(1)} KB`);

  await prisma.$disconnect();
  redis.disconnect();
}

main().catch(e => { 
  console.error('FATAL:', e); 
  process.exit(1); 
});