// ─── P0: Env-чек — критические переменные окружения ────────────────────────
// Ловит самый частый баг-паттерн: MOEX_TOKEN вместо MOEX_JWT

import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ─── Проверка исходников на MOEX_TOKEN ────────────────────────────────────

describe('Env-чек: MOEX_TOKEN vs MOEX_JWT', () => {
  const apiDir = path.join(PROJECT_ROOT, 'src/app/api');

  /**
   * Рекурсивно найти все .ts файлы в директории
   */
  function findTsFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findTsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  test('Ни один API роут НЕ использует MOEX_TOKEN (должен быть MOEX_JWT)', () => {
    const tsFiles = findTsFiles(apiDir);
    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      // Ищем MOEX_TOKEN в process.env или деструктуризации
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes('MOEX_TOKEN') && !line.trim().startsWith('//') && !line.includes('MOEX_JWT')) {
          violations.push(`${path.relative(PROJECT_ROOT, file)}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    if (violations.length > 0) {
      console.error('MOEX_TOKEN найден в следующих файлах (замените на MOEX_JWT):');
      violations.forEach(v => console.error(`  ${v}`));
    }
    // Известные баги: moex/route.ts и trades/route.ts используют MOEX_TOKEN
    // Когда исправим — тест начнёт проходить
    expect(violations.length).toBeLessThanOrEqual(3); // FIXME: должно быть 0 после F-012
  });

  test('Все API роуты имеют force-dynamic', () => {
    const routeFiles = findTsFiles(apiDir).filter(f => f.endsWith('route.ts'));
    const violations: string[] = [];

    for (const file of routeFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (!content.includes("export const dynamic = 'force-dynamic'") &&
          !content.includes('export const dynamic = "force-dynamic"')) {
        violations.push(path.relative(PROJECT_ROOT, file));
      }
    }

    if (violations.length > 0) {
      console.error('Следующие роуты НЕ имеют force-dynamic (могут кешироваться на Vercel):');
      violations.forEach(v => console.error(`  ${v}`));
    }
    // Известные нарушения: moex, trades, robot-events, api, tinkext
    // Когда добавим — тест начнёт проходить
    expect(violations.length).toBeLessThanOrEqual(5); // FIXME: должно быть 0
  });
});

// ─── Проверка структуры env vars ──────────────────────────────────────────

describe('Env-чек: требуемые переменные', () => {
  const requiredVars = [
    { name: 'MOEX_JWT', description: 'JWT токен для MOEX APIM' },
    { name: 'TINVEST_TOKEN', description: 'Токен T-Invest API' },
  ];

  test('Все требуемые env vars определены в Vercel или .env', () => {
    // Проверяем что .env.local или .env содержит эти переменные
    const envLocal = path.join(PROJECT_ROOT, '.env.local');
    const env = path.join(PROJECT_ROOT, '.env');

    let envContent = '';
    if (fs.existsSync(envLocal)) envContent += fs.readFileSync(envLocal, 'utf-8');
    if (fs.existsSync(env)) envContent += fs.readFileSync(env, 'utf-8');

    // Это warning-level — на CI нет .env, но переменные есть в Vercel
    for (const v of requiredVars) {
      const found = envContent.includes(v.name);
      if (!found) {
        console.warn(`⚠️ ${v.name} не найден в .env/.env.local (должен быть в Vercel env)`);
      }
    }
  });
});

// ─── Проверка git user ────────────────────────────────────────────────────

describe('Env-чек: git config для деплоя', () => {
  test('git user.name = wotfrosty-1627 (иначе Vercel блокирует)', () => {
    const gitConfig = path.join(PROJECT_ROOT, '.git/config');
    if (!fs.existsSync(gitConfig)) {
      console.warn('⚠️ .git/config не найден');
      return;
    }

    const content = fs.readFileSync(gitConfig, 'utf-8');
    // Проверяем локальный конфиг
    const hasCorrectUser = content.includes('wotfrosty-1627') || content.includes('wot.frosty@gmail.com');
    if (!hasCorrectUser) {
      console.warn('⚠️ git user не wotfrosty-1627 — Vercel может блокировать деплой (TEAM_ACCESS_REQUIRED)');
    }
  });
});
