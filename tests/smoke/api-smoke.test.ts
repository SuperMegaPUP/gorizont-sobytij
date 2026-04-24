// ─── Smoke Tests ────────────────────────────────────────────────────────
// MOEX_TOKEN запрещён, force-dynamic обязателен, критические файлы существуют

import * as fs from 'fs';
import * as path from 'path';

// <rootDir> = /home/z/my-project, исходники в src/
const ROOT_DIR = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT_DIR, 'src');

describe('Smoke: MOEX_TOKEN запрещён', () => {
  const apiDir = path.join(SRC, 'app/api');

  test('ни один роут не использует process.env.MOEX_TOKEN', () => {
    const violations: string[] = [];
    const checkDir = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { checkDir(full); continue; }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
        const content = fs.readFileSync(full, 'utf8');
        // MOEX_TOKEN в коде (не в комментарии) запрещён
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
          if (line.includes('process.env.MOEX_TOKEN')) {
            violations.push(`${path.relative(SRC, full)}:${i + 1}`);
          }
        }
      }
    };
    if (fs.existsSync(apiDir)) checkDir(apiDir);
    expect(violations).toEqual([]);
  });
});

describe('Smoke: force-dynamic обязателен в API роутах', () => {
  const apiDir = path.join(SRC, 'app/api');

  test('каждый route.ts содержит export const dynamic', () => {
    const missing: string[] = [];
    const checkDir = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { checkDir(full); continue; }
        if (entry.name !== 'route.ts') continue;
        const content = fs.readFileSync(full, 'utf8');
        if (!content.includes("export const dynamic = 'force-dynamic'")) {
          missing.push(path.relative(SRC, full));
        }
      }
    };
    if (fs.existsSync(apiDir)) checkDir(apiDir);
    // Все роуты должны иметь force-dynamic
    expect(missing).toEqual([]);
  });
});

describe('Smoke: критические файлы существуют', () => {
  const criticalFiles = [
    'app/api/detect/route.ts',
    'app/api/futoi/route.ts',
    'app/api/hint/route.ts',
    'app/api/reports/route.ts',
    'app/api/reports/cron/route.ts',
    'app/api/calendar/route.ts',
    'app/api/moex/route.ts',
    'app/api/algopack/route.ts',
    'lib/detect-engine.ts',
    'lib/moex-futoi.ts',
    'lib/store.ts',
    'lib/helpers.ts',
    'lib/layout-store.ts',
    'lib/types.ts',
    'app/page.tsx',
    'app/layout.tsx',
    'app/globals.css',
  ];

  for (const file of criticalFiles) {
    test(`${file} существует`, () => {
      expect(fs.existsSync(path.join(SRC, file))).toBe(true);
    });
  }
});

describe('Smoke: revalidate запрещён в API роутах', () => {
  const apiDir = path.join(SRC, 'app/api');

  test('ни один route.ts не содержит export const revalidate', () => {
    const violations: string[] = [];
    const checkDir = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { checkDir(full); continue; }
        if (entry.name !== 'route.ts') continue;
        const content = fs.readFileSync(full, 'utf8');
        if (/export\s+const\s+revalidate/.test(content)) {
          violations.push(path.relative(SRC, full));
        }
      }
    };
    if (fs.existsSync(apiDir)) checkDir(apiDir);
    expect(violations).toEqual([]);
  });
});
