// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// PlaywrightCrawlProvider smoke test -- extracted from crawl.test.ts per
// #0266. Lives in its own file so it can be excluded from the default
// `vitest run` parallel sweep (where it raced against other workers for
// Chromium handles and intermittently timed out) and run in isolation
// via `npm run test:crawl`.
//
// Run locally:
//   cd swao/packages/swao
//   npx playwright install chromium       # if Chromium is missing
//   npm run test:crawl
//
// The previous gating via `SWAO_RUN_FLAKY=1` is removed -- the suite is
// now reliable when launched on its own (no inter-worker contention),
// so the env-var workaround is no longer needed.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

import { PlaywrightCrawlProvider } from './playwright-driver.js';

const CHROMIUM_PATH = (() => {
  try {
    const p = chromium.executablePath();
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
})();

const FIXTURE_DIR = join(tmpdir(), `swao-crawl-fixture-smoke-${process.pid}`);

beforeAll(() => {
  if (CHROMIUM_PATH === null) {
    console.warn(
      '[swao] Playwright smoke test skipped: Chromium binary not found. ' +
      'Run `npx playwright install chromium` to enable it.',
    );
    return;
  }

  mkdirSync(FIXTURE_DIR, { recursive: true });
  const pageLinks = Array.from(
    { length: 8 },
    (_, i) => `<a href="page-${i + 1}.html">Page ${i + 1}</a>`,
  ).join('\n');
  writeFileSync(
    join(FIXTURE_DIR, 'index.html'),
    `<!DOCTYPE html><html><head><title>Fixture Home</title></head><body><h1>Home</h1>${pageLinks}</body></html>`,
    'utf-8',
  );
  for (let i = 1; i <= 8; i++) {
    writeFileSync(
      join(FIXTURE_DIR, `page-${i}.html`),
      `<!DOCTYPE html><html><head><title>Page ${i}</title></head><body><h1>Page ${i}</h1><a href="index.html">Home</a></body></html>`,
      'utf-8',
    );
  }
});

afterAll(() => {
  if (CHROMIUM_PATH === null) return;
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe.skipIf(CHROMIUM_PATH === null)('PlaywrightCrawlProvider smoke test (#0102 / #0266)', () => {
  it(
    'crawls file:// fixture and captures multiple screens',
    { timeout: 60000 },
    async () => {
      const indexUrl = `file:///${FIXTURE_DIR.replace(/\\/g, '/')}/index.html`;
      const provider = new PlaywrightCrawlProvider();
      const result = await provider.crawl({ targetUrl: indexUrl, maxTurns: 20 }, FIXTURE_DIR);
      expect(result.screenCount).toBeGreaterThanOrEqual(5);
      expect(result.screens[0].url).toBe(indexUrl);
      expect(result.screens[0].domSnapshot).toContain('Fixture Home');
    },
  );

  it(
    'checkBinary returns available: true on this machine',
    { timeout: 5000 },
    async () => {
      const provider = new PlaywrightCrawlProvider();
      const check = await provider.checkBinary();
      expect(check.available).toBe(true);
      expect(check.version).not.toBeNull();
    },
  );
});
