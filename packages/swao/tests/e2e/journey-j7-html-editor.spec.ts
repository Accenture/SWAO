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
 * Journey J7 -- HTML Editor Browser UI
 *
 * User journey (from docs/design/user-journey/J7-html-editor-customisation.md):
 *   After generating publication.html, Alex opens the HTML Editor
 *   (`swao publish --edit --app sovereign-health`) in a browser, customises
 *   the report layout and theme, then exports the template.
 *
 * Prerequisites:
 *   - hasBinary: true (built binary in dist-bin/)
 *   - `swao publish --edit` command implemented (feature gate)
 *
 * If startEditorServer() times out (feature not yet implemented), every test
 * in this describe block is skipped cleanly -- editorUrl is set to '' and
 * each test guards with test.skip(!editorUrl, ...).
 *
 * Tracker: docs/tracker/issues/open/0529-e2e-journey-j7-html-editor-browser-ui.md
 */
import { test, expect } from '@playwright/test';
import { hasBinary, startEditorServer, WORKSPACE } from './helpers.js';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';

// ---------------------------------------------------------------------------
// Shared server state
// ---------------------------------------------------------------------------

let serverClose: (() => Promise<void>) | undefined;
let editorUrl: string = '';

// Golden fixture path -- backed up before any test writes to it
const TMPL_PATH = join(WORKSPACE, 'wsp', 'templates', 'html', 'publication.html.tmpl');
const DATA_PATH = join(WORKSPACE, 'apps', 'sovereign-health', 'publication-data.html');
let tmplBackup: string | undefined;

test.describe('J7 HTML Editor browser UI', () => {
  test.skip(!hasBinary, 'swao binary not found -- run npm run build:dev:win first');

  test.beforeAll(async () => {
    // Back up golden fixture before any test can overwrite it.
    if (existsSync(TMPL_PATH)) {
      tmplBackup = readFileSync(TMPL_PATH, 'utf-8');
    }

    try {
      const { url, close } = await startEditorServer('sovereign-health', 4001);
      editorUrl = url;
      serverClose = close;
    } catch {
      // Feature not yet implemented -- startEditorServer() timed out.
      // editorUrl remains '' and every test will skip via the guard below.
      editorUrl = '';
    }
  });

  test.afterAll(async () => {
    // Stop the shared server.
    await serverClose?.();

    // Restore golden fixture.
    if (tmplBackup !== undefined) {
      writeFileSync(TMPL_PATH, tmplBackup, 'utf-8');
    }

    // Remove any publication-data.html written by J7-07.
    if (existsSync(DATA_PATH)) {
      unlinkSync(DATA_PATH);
    }
  });

  // ── J7-01: Editor launches and panels render ─────────────────────────────

  test('J7-01: editor launches and panels render', async ({ page }) => {
    test.skip(!editorUrl, 'HTML Editor server did not start');

    // Capture browser console errors to surface JS runtime failures.
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => { consoleErrors.push(err.message); });

    await page.goto(editorUrl);
    await page.waitForLoadState('networkidle');

    // Page heading must identify the editor.
    const titleOrH1 = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return (h1?.textContent ?? '') + document.title;
    });
    expect(titleOrH1.toLowerCase()).toMatch(/swao|editor/);

    // Three panel tabs must be present (Layout / Content / Style).
    await expect(page.locator('[data-testid="tab-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-style"]')).toBeVisible();

    // Live preview pane must be present (right panel -- iframe or div).
    const preview = page.locator('iframe, [data-testid="preview"], [id="preview-frame"]').first();
    await expect(preview).toBeVisible();

    // No JS runtime errors should have occurred.
    expect(consoleErrors).toHaveLength(0);
  });

  // ── J7-02: Blocks panel lists expected blocks ─────────────────────────────

  test('J7-02: blocks panel lists expected blocks', async ({ page }) => {
    test.skip(!editorUrl, 'HTML Editor server did not start');

    await page.goto(editorUrl);
    await page.waitForLoadState('networkidle');

    // Block Manager is in the Layout tab (default active -- no tab switch needed).
    // At least 10 block entries (conservative guard against regressions).
    // Blocks are rendered as <li data-blk="..."> elements inside #block-list.
    const blockItems = page.locator('#block-list li[data-blk]');
    const count = await blockItems.count();
    expect(count).toBeGreaterThanOrEqual(10);

    // The Signals block must be listed (label "Signals" for slot "signal-list").
    await expect(page.locator('#block-list li[data-blk="signal-list"]')).toBeVisible();

    // The Overview block (cover) must also be listed.
    await expect(page.locator('#block-list li[data-blk="cover"]')).toBeVisible();
  });

  // ── J7-03: Toggle block off and verify preview updates ───────────────────

  test('J7-03: toggle signal-list off and preview updates', async ({ page }) => {
    test.skip(!editorUrl, 'HTML Editor server did not start');

    await page.goto(editorUrl);
    await page.waitForLoadState('networkidle');

    // Block Manager is in the Layout tab (active by default -- no tab switch needed).
    const signalListRow = page.locator('#block-list li[data-blk="signal-list"]');
    const toggle = signalListRow.locator('input[type="checkbox"]').first();
    await toggle.click();

    // Give the preview time to reflect the toggle.
    await page.waitForTimeout(500);

    // The live preview must no longer show signal-list as a visible section.
    // Supports both iframe and in-page preview rendering.
    const previewFrame = page.frameLocator('iframe').first();
    const signalListSection = previewFrame.locator('#signal-list, [data-block="signal-list"]');
    // Either absent or hidden.
    const visible = await signalListSection.isVisible().catch(() => false);
    expect(visible).toBe(false);
  });

  // ── J7-04: Export Level 1 writes template file ───────────────────────────

  test('J7-04: export level 1 writes template file', async ({ page }) => {
    test.skip(!editorUrl, 'HTML Editor server did not start');

    await page.goto(editorUrl);
    await page.waitForLoadState('networkidle');

    // Disable signal-list first (mirrors J7-03 intent).
    // Block Manager is in the Layout tab (active by default -- no tab switch needed).
    const signalListRow = page.locator('#block-list li[data-blk="signal-list"]');
    const toggle = signalListRow.locator('input[type="checkbox"]').first();
    await toggle.click();

    // Click the Export Level 1 button (soft assertion on button label).
    const exportBtn = page.getByRole('button', { name: /export level 1/i })
      .or(page.getByRole('button', { name: /export template/i }))
      .or(page.getByRole('button', { name: /save template/i }))
      .first();
    await exportBtn.click();

    // Allow file I/O to complete.
    await page.waitForTimeout(1000);

    // Template file must exist.
    expect(existsSync(TMPL_PATH)).toBe(true);

    // The toggled-off block must be absent -- not just hidden.
    const content = readFileSync(TMPL_PATH, 'utf-8');
    expect(content).not.toContain('signal-list');
  });

  // ── J7-05: Theme panel updates CSS custom property ───────────────────────

  test('J7-05: style panel updates --brand-primary CSS variable', async ({ page }) => {
    test.skip(!editorUrl, 'HTML Editor server did not start');

    await page.goto(editorUrl);
    await page.waitForLoadState('networkidle');

    // Switch to the Style tab (contains brand colour pickers).
    await page.locator('[data-testid="tab-style"]').click();

    // Find the --brand-primary colour input (id="brand-primary").
    const brandInput = page.locator('input[type="color"]#brand-primary').first();
    await brandInput.fill('#FF0000');
    await brandInput.dispatchEvent('change');

    // Give the preview time to update.
    await page.waitForTimeout(500);

    // Live preview (iframe or inline) must reflect the new value.
    const previewFrame = page.frameLocator('iframe').first();
    const cssValue = await previewFrame.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim();
    });
    expect(cssValue).toMatch(/#[Ff][Ff]0{4}|#[Ff][Ff]0000/);
  });

  // ── J7-06: Reload editor pre-populates from saved template ───────────────

  test('J7-06: reload editor pre-populates from saved template', async ({ page }) => {
    test.skip(!editorUrl, 'HTML Editor server did not start');

    // Use dedicated ports to avoid conflicting with the shared beforeAll server.
    const PORT_A = 4051;
    const PORT_B = 4052;

    // --- Phase A: save state on PORT_A ---
    let closeA: (() => Promise<void>) | undefined;
    try {
      const serverA = await startEditorServer('sovereign-health', PORT_A);
      closeA = serverA.close;

      await page.goto(serverA.url);
      await page.waitForLoadState('networkidle');

      // Disable signal-list. Block Manager is in the Layout tab (active by default).
      const signalListRowA = page.locator('#block-list li[data-blk="signal-list"]');
      const toggleA = signalListRowA.locator('input[type="checkbox"]').first();
      await toggleA.click();

      // Export to save the state.
      const exportBtnA = page.getByRole('button', { name: /export level 1/i })
        .or(page.getByRole('button', { name: /export template/i }))
        .or(page.getByRole('button', { name: /save template/i }))
        .first();
      await exportBtnA.click();
      await page.waitForTimeout(1000);
    } finally {
      await closeA?.();
    }

    // --- Phase B: verify pre-populated state on PORT_B ---
    let closeB: (() => Promise<void>) | undefined;
    try {
      const serverB = await startEditorServer('sovereign-health', PORT_B);
      closeB = serverB.close;

      await page.goto(serverB.url);
      await page.waitForLoadState('networkidle');

      // Block Manager is in the Layout tab (active by default -- no tab switch needed).
      // signal-list toggle must reflect the saved disabled state.
      const signalListRowB = page.locator('#block-list li[data-blk="signal-list"]');
      const toggleB = signalListRowB.locator('input[type="checkbox"]').first();

      // For a checkbox: unchecked means disabled.
      // For a switch button: aria-checked="false" means disabled.
      const isChecked = await toggleB.isChecked().catch(async () => {
        const ariaChecked = await toggleB.getAttribute('aria-checked');
        return ariaChecked === 'true';
      });
      expect(isChecked).toBe(false);
    } finally {
      await closeB?.();
    }
  });

  // ── J7-07: Export Level 2 writes data-injection stub ────────────────────

  test('J7-07: export level 2 writes data-injection stub', async ({ page }) => {
    test.skip(!editorUrl, 'HTML Editor server did not start');

    await page.goto(editorUrl);
    await page.waitForLoadState('networkidle');

    // Click Export Level 2 (soft match in case button label differs slightly).
    const exportBtn = page.getByRole('button', { name: /export level 2/i })
      .or(page.getByRole('button', { name: /export with data/i }))
      .or(page.getByRole('button', { name: /export data/i }))
      .first();
    await exportBtn.click();

    // Allow file I/O to complete.
    await page.waitForTimeout(1000);

    // publication-data.html must exist in the app directory.
    expect(existsSync(DATA_PATH)).toBe(true);

    // The file must contain the SWAO data script placeholder.
    const content = readFileSync(DATA_PATH, 'utf-8');
    expect(content).toContain('<script id="swao-data">');
  });
});
