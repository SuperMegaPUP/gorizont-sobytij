/**
 * Инициализация начальных весов BSCI
 * Запустить ОДИН раз после миграции:
 *   npx tsx src/lib/horizon/bsci/init-weights.ts
 */

import prisma from '@/lib/db';

const DETECTORS = [
  'GRAVITON',
  'DARKMATTER',
  'ACCRETOR',
  'DECOHERENCE',
  'HAWKING',
  'PREDATOR',
  'CIPHER',
  'ENTANGLE',
  'WAVEFUNCTION',
  'ATTRACTOR',
];

async function initWeights() {
  console.log('🔧 Initializing BSCI weights...');

  for (const detector of DETECTORS) {
    const result = await prisma.bsciWeight.upsert({
      where: { detector },
      update: {},
      create: {
        detector,
        weight: 0.1, // 1/10 = равные веса
        accuracy: 0.5, // 50% — нейтральная стартовая точность
        totalSignals: 0,
        correctSignals: 0,
      },
    });
    console.log(`  ✅ ${result.detector}: weight=${result.weight}, accuracy=${result.accuracy}`);
  }

  const all = await prisma.bsciWeight.findMany();
  const totalWeight = all.reduce((sum, w) => sum + w.weight, 0);
  console.log(`\n📊 Total detectors: ${all.length}, sum of weights: ${totalWeight}`);

  await prisma.$disconnect();
  console.log('✅ BSCI weights initialized successfully');
}

initWeights().catch((e) => {
  console.error('❌ Failed to initialize weights:', e);
  process.exit(1);
});
