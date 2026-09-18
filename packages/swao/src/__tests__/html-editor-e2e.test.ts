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

/**
 * HTML Editor Playwright E2E tests (#1121, #1123, #1130).
 *
 * Tests the HTML publication editor at the browser level:
 *  1. Editor loads without JS errors
 *  2. Block list populates (application profile, 21+ slots)
 *  3. Tab switching works (switchTab function defined)
 *  4. Save Navigation writes profile YAML to temp workspace
 *  5. Load Preview populates iframe srcdoc from real run data
 *  6. Export Template writes publication.html.tmpl to temp workspace
 *  7. Assessment type selector switches block list to lz-catalog profile (#1123)
 *
 * Two servers are used:
 *  - mainServer  (4098): PORTFOLIO_FIXTURE -- read-only; used for GET tests + Load Preview
 *  - writeServer (4097): temp workspace   -- used for Save Navigation + Export Template
 *    to prevent commits to the fixture directory.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  existsSync, mkdtempSync, readdirSync, rmSync, readFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createEditorServer } from '@swao/module-html-report/editor-server';

vi.setConfig({ testTimeout: 90_000 });

import { vi } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORTFOLIO_FIXTURE = resolve(__dirname, '../../../../../examples/portfolio-workspace/portfolio');
const hasFixture = existsSync(PORTFOLIO_FIXTURE);

// Synchronous Chromium detection (Windows path) -- required for it.skipIf.
// Check for the actual chrome.exe executable, not just the directory, to avoid
// false-positives when the Chromium directory exists but the binary is absent.
const msPlaywrightDir = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const hasChromium = existsSync(msPlaywrightDir)
  && readdirSync(msPlaywrightDir).some(d => {
    if (!d.startsWith('chromium')) return false;
    return existsSync(join(msPlaywrightDir, d, 'chrome-win', 'chrome.exe'));
  });

const canRunE2e = hasFixture && hasChromium;

// ----- server handles -----
let mainServer: { start(): Promise<number>; stop(): Promise<void> };
let writeServer: { start(): Promise<number>; stop(): Promise<void> };
let mainUrl: string;
let writeUrl: string;
let tempWriteWorkspace: string;

const MAIN_PORT = 4098;
const WRITE_PORT = 4097;

beforeAll(async () => {
  if (!canRunE2e) return;

  // Temp workspace for tests that write to disk (never pollutes the committed fixture)
  tempWriteWorkspace = mkdtempSync(join(tmpdir(), 'swao-editor-write-'));

  // Read-only server: uses PORTFOLIO_FIXTURE which has real sovereign-health run data
  mainServer = createEditorServer({
    port: MAIN_PORT,
    workspace: PORTFOLIO_FIXTURE,
    appId: 'sovereign-health',
  });
  const mainPort = await mainServer.start();
  mainUrl = `http://127.0.0.1:${mainPort}`;

  // Write server: temp dir for Save Navigation + Export Template tests
  writeServer = createEditorServer({
    port: WRITE_PORT,
    workspace: tempWriteWorkspace,
    appId: 'sovereign-health',
  });
  const writePort = await writeServer.start();
  writeUrl = `http://127.0.0.1:${writePort}`;
}, 30_000);

afterAll(async () => {
  await mainServer?.stop().catch(() => undefined);
  await writeServer?.stop().catch(() => undefined);
  if (tempWriteWorkspace && existsSync(tempWriteWorkspace)) {
    rmSync(tempWriteWorkspace, { recursive: true, force: true });
  }
});

describe('HTML Editor E2E (#1121 #1123 #1130)', () => {
  it.skipIf(!canRunE2e)('GET / returns HTML with editor title', async () => {
    const r = await fetch(mainUrl);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('SWAO Publication Editor');
    expect(html).toContain('<script>');
  });

  it.skipIf(!canRunE2e)('GET /context returns 200 with block_profile and template_slots', async () => {
    const r = await fetch(`${mainUrl}/context`);
    expect(r.status).toBe(200);
    const ctx = await r.json() as Record<string, unknown>;
    expect(ctx).toHaveProperty('block_profile');
    expect(ctx).toHaveProperty('allowed_blocks');
    expect(Array.isArray(ctx['allowed_blocks'])).toBe(true);
    expect((ctx['allowed_blocks'] as unknown[]).length).toBeGreaterThan(0);
    expect(ctx).toHaveProperty('template_slots');
    expect(Array.isArray(ctx['template_slots'])).toBe(true);
    expect((ctx['template_slots'] as unknown[]).length).toBeGreaterThan(0);
  });

  it.skipIf(!canRunE2e)('GET /context?profile=lz-catalog returns lz-catalog slots', async () => {
    const r = await fetch(`${mainUrl}/context?profile=lz-catalog`);
    expect(r.status).toBe(200);
    const ctx = await r.json() as Record<string, unknown>;
    expect(ctx['block_profile']).toBe('lz-catalog');
    const slots = ctx['template_slots'] as string[];
    expect(Array.isArray(slots)).toBe(true);
    expect(slots).toContain('lz-catalog-services');
    expect(slots).not.toContain('seven-r-card');
  });

  it.skipIf(!canRunE2e)('browser: no JS errors on load', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto(mainUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await browser.close();

    if (consoleErrors.length > 0) {
      console.warn('[html-editor-e2e] Browser console errors:', JSON.stringify(consoleErrors, null, 2));
    }
    expect(consoleErrors.length).toBe(0);
  });

  it.skipIf(!canRunE2e)('browser: side nav list has at least 5 items', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(mainUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Sprint-099 simplified block list: #block-list now shows only structural/meta
    // slots (quick-nav, coverage-bar, footer). Content blocks live in #side-nav-items.
    const navCount = await page.locator('#side-nav-items li').count();
    await browser.close();

    expect(navCount).toBeGreaterThan(5);
  });

  it.skipIf(!canRunE2e)('browser: switchTab function defined -- tab switching changes active panel', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(mainUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const isSwitchTabDefined = await page.evaluate(
      () => typeof (window as unknown as Record<string, unknown>)['switchTab'] === 'function',
    );
    expect(isSwitchTabDefined).toBe(true);

    await page.click('button[data-testid="tab-style"]');
    const styleTabActive = await page.locator('#tab-style.active').count();

    await browser.close();
    expect(styleTabActive).toBe(1);
  });

  it.skipIf(!canRunE2e)('browser: Save Elements writes profile YAML to workspace', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Use the write server so the committed fixture is never touched
    await page.goto(writeUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Sprint-099 renamed the button from "Save Navigation" to "Save Elements"
    await page.click('button:has-text("Save Elements")');
    await page.waitForTimeout(2000);
    await browser.close();

    const profilePath = join(tempWriteWorkspace, 'wsp', 'templates', 'profiles', 'application.yaml');
    expect(existsSync(profilePath)).toBe(true);
    const content = readFileSync(profilePath, 'utf-8');
    expect(content).toContain('profile: application');
  });

  it.skipIf(!canRunE2e)('browser: Load Preview populates iframe srcdoc from real run data', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Use main server which has sovereign-health run data in PORTFOLIO_FIXTURE
    await page.goto(mainUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    await page.fill('#app-id', 'sovereign-health');
    await page.click('button:has-text("Load Preview")');

    // Wait for the async preview to populate the iframe srcdoc
    await page.waitForFunction(
      () => {
        const f = document.getElementById('preview-frame') as HTMLIFrameElement;
        return !!(f && f.srcdoc && f.srcdoc.length > 1000);
      },
      { timeout: 30_000 },
    );

    const srcdoc = await page.evaluate(
      () => (document.getElementById('preview-frame') as HTMLIFrameElement)?.srcdoc ?? '',
    );
    await browser.close();

    expect(srcdoc.length).toBeGreaterThan(1000);
    // Publication chrome from PUBLICATION_TEMPLATE must be present (#1131)
    expect(srcdoc).toContain('class="site-header"');
    expect(srcdoc).toContain('class="page-layout"');
  });

  it.skipIf(!canRunE2e)('browser: Export Template writes publication.html.tmpl to workspace', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(writeUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    await page.click('button:has-text("Export Template")');
    await page.waitForTimeout(2000);
    await browser.close();

    // handleExportLevel1 writes profile-specific filename: publication-application.html.tmpl
    const templatePath = join(tempWriteWorkspace, 'wsp', 'templates', 'html', 'publication-application.html.tmpl');
    expect(existsSync(templatePath)).toBe(true);
    const content = readFileSync(templatePath, 'utf-8');
    expect(content).toContain('SWAO:slot');
  });

  it.skipIf(!canRunE2e)('browser: assessment type selector switches block list to lz-catalog (#1123)', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(mainUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Sprint-099: content blocks moved from #block-list to #side-nav-items.
    // Verify initial application profile has signal-list in the side nav.
    const hasSignalListInitially = await page.locator('#side-nav-items li[data-nav="signal-list"]').count();
    expect(hasSignalListInitially).toBe(1);

    // Switch to lz-catalog via the dropdown
    await page.selectOption('#assessment-type-selector', 'lz-catalog');
    await page.waitForTimeout(2000);

    // Assert side nav now has lz-catalog-services and NOT seven-r-card
    const hasLzServices = await page.locator('#side-nav-items li[data-nav="lz-catalog-services"]').count();
    const hasSevenR = await page.locator('#side-nav-items li[data-nav="seven-r-card"]').count();
    await browser.close();

    expect(hasLzServices).toBe(1);
    expect(hasSevenR).toBe(0);
  });
});
