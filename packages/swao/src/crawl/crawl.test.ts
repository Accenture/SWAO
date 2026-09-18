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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { StubCrawlProvider } from './stub.js';
import { extractSameOriginLinks, isDuplicateByDomSize, planNextActions, STATIC_ASSET_EXT } from './navigation-planner.js';
import { runDynamicPass } from '../passes/index.js';
import { writeParityBaseline } from './parity-baseline.js';
import type { ScreenArtefact } from './types.js';
// Note: PlaywrightCrawlProvider + chromium are imported only by the
// extracted smoke test in `crawl-playwright.smoke.test.ts` (#0266).

// ---------------------------------------------------------------------------
// StubCrawlProvider
// ---------------------------------------------------------------------------

describe('StubCrawlProvider (#0102)', () => {
  it('checkBinary returns available: true', async () => {
    const stub = new StubCrawlProvider();
    const check = await stub.checkBinary();
    expect(check.available).toBe(true);
    expect(check.version).toBe('stub');
  });

  it('crawl returns preset screens with correct target url', async () => {
    const stub = new StubCrawlProvider();
    const result = await stub.crawl({ targetUrl: 'http://localhost:3000' }, '/tmp');
    expect(result.targetUrl).toBe('http://localhost:3000');
    expect(result.screenCount).toBeGreaterThan(0);
    expect(result.screens.length).toBe(result.screenCount);
  });

  it('crawl with custom screens returns those screens', async () => {
    const screens: ScreenArtefact[] = [
      {
        index: 0, url: 'http://x.com/', title: 'X', timestamp: '2026-04-28T00:00:00.000Z',
        slug: '000-root', screenshotJpeg: null, domSnapshot: '<html></html>',
        a11yJson: null, networkEntries: [], consoleEntries: [], a11yViolations: 0,
      },
    ];
    const stub = new StubCrawlProvider(screens);
    const result = await stub.crawl({ targetUrl: 'http://x.com/' }, '/tmp');
    expect(result.screenCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Navigation planner
// ---------------------------------------------------------------------------

describe('extractSameOriginLinks (#0102)', () => {
  it('returns same-origin links', () => {
    const html = '<a href="/patients">P</a><a href="/admin">A</a>';
    const links = extractSameOriginLinks(html, 'http://localhost:3000/', []);
    expect(links).toContain('http://localhost:3000/patients');
    expect(links).toContain('http://localhost:3000/admin');
  });

  it('filters cross-origin links', () => {
    const html = '<a href="https://external.com/page">Ext</a><a href="/local">Local</a>';
    const links = extractSameOriginLinks(html, 'http://localhost:3000/', []);
    expect(links).not.toContain('https://external.com/page');
    expect(links).toContain('http://localhost:3000/local');
  });

  it('applies exclude patterns', () => {
    const html = '<a href="/logout">Logout</a><a href="/home">Home</a>';
    const links = extractSameOriginLinks(html, 'http://localhost:3000/', ['/logout']);
    expect(links).not.toContain('http://localhost:3000/logout');
    expect(links).toContain('http://localhost:3000/home');
  });

  it('strips fragment-only links', () => {
    const html = '<a href="#section">Section</a><a href="/page">Page</a>';
    const links = extractSameOriginLinks(html, 'http://localhost:3000/', []);
    expect(links).not.toContain('http://localhost:3000/#section');
    expect(links).toContain('http://localhost:3000/page');
  });

  it('deduplicates repeated links', () => {
    const html = '<a href="/page">A</a><a href="/page">B</a><a href="/page">C</a>';
    const links = extractSameOriginLinks(html, 'http://localhost:3000/', []);
    const pageLinkCount = links.filter((l) => l === 'http://localhost:3000/page').length;
    expect(pageLinkCount).toBe(1);
  });

  it('filters static asset extensions -- CSS, JS, images, fonts, manifests (#0892)', () => {
    const html = [
      '<link rel="stylesheet" href="/styles/main.css">',
      '<script src="/_next/static/chunks/webpack.js"></script>',
      '<link rel="manifest" href="/manifest.json">',
      '<link rel="icon" href="/favicon.ico">',
      '<link rel="icon" type="image/png" href="/favicon-32x32.png">',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
      '<link rel="preload" href="/fonts/inter.woff2" as="font">',
      '<a href="/dashboard">Dashboard</a>',
      '<a href="/settings">Settings</a>',
    ].join('\n');
    const links = extractSameOriginLinks(html, 'http://app.example.com/', []);
    // Only HTML navigation links survive
    expect(links).toContain('http://app.example.com/dashboard');
    expect(links).toContain('http://app.example.com/settings');
    // Static assets are filtered out
    expect(links.some(l => l.endsWith('.css'))).toBe(false);
    expect(links.some(l => l.endsWith('.js'))).toBe(false);
    expect(links.some(l => l.endsWith('.json'))).toBe(false);
    expect(links.some(l => l.endsWith('.ico'))).toBe(false);
    expect(links.some(l => l.endsWith('.png'))).toBe(false);
    expect(links.some(l => l.endsWith('.woff2'))).toBe(false);
  });
});

describe('STATIC_ASSET_EXT (#0892 / #0894)', () => {
  it('matches common static asset extensions', () => {
    expect(STATIC_ASSET_EXT.test('/styles/main.css')).toBe(true);
    expect(STATIC_ASSET_EXT.test('/_next/static/chunks/webpack.js')).toBe(true);
    expect(STATIC_ASSET_EXT.test('/favicon.ico')).toBe(true);
    expect(STATIC_ASSET_EXT.test('/manifest.json')).toBe(true);
    expect(STATIC_ASSET_EXT.test('/logo.png')).toBe(true);
    expect(STATIC_ASSET_EXT.test('/fonts/inter.woff2')).toBe(true);
  });

  it('does not match HTML application paths', () => {
    expect(STATIC_ASSET_EXT.test('/dashboard')).toBe(false);
    expect(STATIC_ASSET_EXT.test('/patients/123')).toBe(false);
    expect(STATIC_ASSET_EXT.test('/settings')).toBe(false);
    expect(STATIC_ASSET_EXT.test('/api/health')).toBe(false);
  });
});

describe('isDuplicateByDomSize (#0102)', () => {
  it('returns true for nearly identical DOM sizes', () => {
    const a = 'x'.repeat(1000);
    const b = 'x'.repeat(1002);
    expect(isDuplicateByDomSize(a, b)).toBe(true);
  });

  it('returns false for substantially different DOM sizes', () => {
    const a = 'x'.repeat(1000);
    const b = 'x'.repeat(2000);
    expect(isDuplicateByDomSize(a, b)).toBe(false);
  });
});

describe('planNextActions (#0102)', () => {
  it('excludes already-visited URLs', () => {
    const html = '<a href="/a">A</a><a href="/b">B</a>';
    const visited = new Set(['http://localhost:3000/a']);
    const actions = planNextActions('http://localhost:3000/', html, visited, []);
    expect(actions.map((a) => a.url)).not.toContain('http://localhost:3000/a');
    expect(actions.map((a) => a.url)).toContain('http://localhost:3000/b');
  });
});

// ---------------------------------------------------------------------------
// runDynamicPass
// ---------------------------------------------------------------------------

describe('runDynamicPass (#0102)', () => {
  const ctx = {
    appId: 'test-app',
    sourcePath: '/tmp',
    workspacePath: '/tmp',
    iter: 1,
    assessedAt: '2026-04-28',
  };

  it('emits at least one signal', async () => {
    const stub = new StubCrawlProvider();
    const result = await stub.crawl({ targetUrl: 'http://localhost:3000' }, '/tmp');
    const pass = await runDynamicPass(ctx, result);
    expect(pass.signals.length).toBeGreaterThan(0);
  });

  it('emits DYN-prefixed signal IDs', async () => {
    const stub = new StubCrawlProvider();
    const result = await stub.crawl({ targetUrl: 'http://localhost:3000' }, '/tmp');
    const pass = await runDynamicPass(ctx, result);
    for (const signal of pass.signals) {
      expect(signal.id).toMatch(/^DYN-\d{2}$/);
    }
  });

  it('surfaces external network host (api.stripe.com) in assessment + DYN-01 summary', async () => {
    // Since #1264 (sprint-108) the per-host DETAIL signal is DYN-02, produced
    // by the disk-based Phase 2 extraction (parity-baseline/) and unit-tested
    // in @swao/module-app-assessment. The in-memory crawl path guarantees the
    // host list on the assessment payload and the DYN-01 aggregate signal.
    const stub = new StubCrawlProvider();
    const result = await stub.crawl({ targetUrl: 'http://localhost:3000' }, '/tmp');
    const pass = await runDynamicPass(ctx, result);
    expect(pass.assessment.external_hosts).toContain('api.stripe.com');
    expect(pass.assessment.external_host_count).toBeGreaterThanOrEqual(1);
    const summary = pass.signals.find(
      (s) => s.source === 'dynamic_analysis' && /External hosts contacted: [1-9]/.test(s.derivation),
    );
    expect(summary).toBeDefined();
  });

  it('emits DYN signal for console errors', async () => {
    const stub = new StubCrawlProvider();
    const result = await stub.crawl({ targetUrl: 'http://localhost:3000' }, '/tmp');
    const pass = await runDynamicPass(ctx, result);
    const consoleSignal = pass.signals.find((s) => s.derivation.includes('console error'));
    expect(consoleSignal).toBeDefined();
  });

  it('pass header has id 10 and signal_prefix DYN', async () => {
    const stub = new StubCrawlProvider();
    const result = await stub.crawl({ targetUrl: 'http://localhost:3000' }, '/tmp');
    const pass = await runDynamicPass(ctx, result);
    expect(pass.pass.id).toBe(10);
    expect(pass.pass.signal_prefix).toBe('DYN');
  });

  it('assessment block contains screens_captured', async () => {
    const stub = new StubCrawlProvider();
    const result = await stub.crawl({ targetUrl: 'http://localhost:3000' }, '/tmp');
    const pass = await runDynamicPass(ctx, result);
    expect(pass.assessment['screens_captured']).toBe(result.screenCount);
  });
});

// ---------------------------------------------------------------------------
// writeParityBaseline
// ---------------------------------------------------------------------------

const TMP_WS = join(tmpdir(), `swao-parity-test-${process.pid}`);

beforeAll(() => {
  mkdirSync(TMP_WS, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_WS, { recursive: true, force: true });
});

describe('writeParityBaseline (#0102)', () => {
  it('creates manifest.json in parity-baseline dir', async () => {
    const stub = new StubCrawlProvider();
    const result = await stub.crawl({ targetUrl: 'http://localhost:3000' }, TMP_WS);
    writeParityBaseline(TMP_WS, result);
    const manifestPath = join(TMP_WS, 'parity-baseline', 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
  });

  it('manifest has correct screen count and target_url', async () => {
    const stub = new StubCrawlProvider();
    const result = await stub.crawl({ targetUrl: 'http://localhost:3000' }, TMP_WS);
    writeParityBaseline(TMP_WS, result);
    const manifest = JSON.parse(
      readFileSync(join(TMP_WS, 'parity-baseline', 'manifest.json'), 'utf-8'),
    );
    expect(manifest.screen_count).toBe(result.screenCount);
    expect(manifest.target_url).toBe('http://localhost:3000');
    expect(manifest.schema_version).toBe('1.0');
  });

  it('creates per-screen dom.html files', async () => {
    const stub = new StubCrawlProvider();
    const result = await stub.crawl({ targetUrl: 'http://localhost:3000' }, TMP_WS);
    writeParityBaseline(TMP_WS, result);
    for (const screen of result.screens) {
      const domPath = join(TMP_WS, 'parity-baseline', screen.slug, 'dom.html');
      expect(existsSync(domPath)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// PlaywrightCrawlProvider smoke test -- moved to `crawl-playwright.smoke.test.ts`
// per #0266 so it runs in isolation via `npm run test:crawl`. The previous
// in-suite location raced against other vitest workers for Chromium handles
// and intermittently timed out under default parallel runs.
