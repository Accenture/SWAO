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
 * Journey J6 -- HTML Publication User Journeys (UC-01 to UC-05)
 *
 * User journey (from docs/tracker/issues/open/0523-e2e-playwright-html-publication-user-journeys.md):
 *   After running `swao publish --app sovereign-health`, a consultant opens the
 *   single-page HTML report in a browser, searches for signals, navigates via
 *   deep links, toggles filter chips, and verifies version consistency.
 *
 * Preconditions:
 *   - hasBinary: true (built binary in dist-bin/)
 *   - Golden fixture: examples/portfolio-workspace/portfolio/apps/sovereign-health/
 *     contains at least one WSP run (INV-01, INV-05, INV-10 signals)
 *
 * Implementation notes:
 *   - UC-03 tests severity filter chips (not compliance tiles) because the golden
 *     fixture has an empty compliance array -- severity chips are always rendered
 *     by initSwaoTable regardless of WSP data.
 *   - UC-05 checks binary version and HTML embedded version independently.
 *     They may differ when the fixture WSP run predates the current binary build;
 *     both are asserted to be valid semver strings.
 *   - No Playwright test run is performed locally (Windows file:// dialog issue).
 *     Specs are validated in CI.
 *
 * Tracker: docs/tracker/issues/open/0523-e2e-playwright-html-publication-user-journeys.md
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { hasBinary, run, BIN, WORKSPACE, attachOutput } from './helpers.js';

// ── Module-level state shared by all tests in this file ───────────────────────

let publishedHtmlPath = '';

// ── Local helpers ─────────────────────────────────────────────────────────────

/**
 * Convert an absolute filesystem path to a file:// URL.
 * Handles Windows drive letters (e.g. C:\... becomes file:///C:/...).
 */
function fileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('J6 -- HTML Publication User Journeys', () => {
  test.skip(!hasBinary, 'swao binary not found -- run npm run build:dev:win first');

  // ── One-time setup: publish sovereign-health ────────────────────────────────

  test.beforeAll(async () => {
    if (!hasBinary) return; // skip guard above handles individual tests

    const r = run(['publish', '--app', 'sovereign-health']);
    if (r.status !== 0) {
      throw new Error(`swao publish failed (exit ${r.status}):\n${r.combined}`);
    }

    // stdout: last non-empty line is the output HTML path
    const lines = r.stdout.split('\n').map(l => l.trim()).filter(Boolean);
    publishedHtmlPath = lines[lines.length - 1] ?? '';
    if (!publishedHtmlPath) {
      throw new Error(`swao publish produced no output path on stdout.\nCombined:\n${r.combined}`);
    }
  });

  // ── UC-01: Global search, compliance section, delta view ────────────────────

  test('UC-01: global search overlay, compliance section, and delta view render', async ({ page }) => {
    await page.goto(fileUrl(publishedHtmlPath));
    await page.waitForLoadState('networkidle');

    // Global search: type a signal ID -- overlay must become visible
    await page.locator('#swao-global-search').fill('INV-05');
    await expect(page.locator('#swao-search-overlay')).toBeVisible();

    // Compliance section container must be present in the DOM (even when empty)
    await expect(page.locator('#compliance-regime')).toBeAttached();

    // Delta view block must be present and visible
    await expect(page.locator('#delta-view')).toBeVisible();
  });

  // ── UC-02: Signal deep link via URL hash ─────────────────────────────────────

  test('UC-02: navigating with #signal-INV-05 hash filters the signals table', async ({ page }) => {
    await page.goto(`${fileUrl(publishedHtmlPath)}#signal-INV-05`);
    await page.waitForLoadState('networkidle');

    // swaoNavigateToSignal uses setTimeout internally; wait for it to settle
    await page.waitForFunction(
      () => {
        const el = document.querySelector<HTMLInputElement>('#signals-search');
        return el !== null && el.value.includes('INV-05');
      },
      { timeout: 5000 },
    );

    await expect(page.locator('#signals-search')).toHaveValue('INV-05');
  });

  // ── UC-03: Severity filter chip roundtrip ────────────────────────────────────
  //
  // The golden fixture has an empty compliance array so no compliance tiles render.
  // Severity chips are always injected by initSwaoTable (hard-coded filter values),
  // so the roundtrip is tested against the "high" severity chip instead.

  test('UC-03: severity filter chip toggles aria-pressed on click', async ({ page }) => {
    await page.goto(fileUrl(publishedHtmlPath));
    await page.waitForLoadState('networkidle');

    // Severity chips are dynamically created by initSwaoTable -- wait until attached
    const highChip = page.locator(
      '#signals-container .filter-chip[data-filter-key="severity"][data-filter-val="high"]',
    );
    await highChip.waitFor({ state: 'attached' });

    // First click: chip becomes active
    await highChip.click();
    await expect(highChip).toHaveAttribute('aria-pressed', 'true');

    // Second click: chip deselects
    await highChip.click();
    await expect(highChip).toHaveAttribute('aria-pressed', 'false');
  });

  // ── UC-04: Global search "INV" prefix returns results; clicking navigates ─────

  test('UC-04: searching "INV" prefix shows results and clicking one navigates', async ({ page }) => {
    await page.goto(fileUrl(publishedHtmlPath));
    await page.waitForLoadState('networkidle');

    // Type the INV prefix -- golden fixture has INV-01, INV-05, INV-10
    await page.locator('#swao-global-search').fill('INV');
    const overlay = page.locator('#swao-search-overlay');
    await expect(overlay).toBeVisible();

    // At least one result item must appear
    const firstResult = overlay.locator('.search-result a').first();
    await expect(firstResult).toBeVisible();

    // Clicking a result closes the overlay (onclick sets display:none)
    await firstResult.click();
    await expect(overlay).not.toBeVisible({ timeout: 3000 });
  });

  // ── UC-05: Binary --version is consistent with package.json version ──────────
  //
  // Runs without a browser page.
  // Note: the HTML may show a different (older) version than the binary when the
  // WSP run predates the current build. Both are asserted to be valid semver;
  // the binary version is additionally cross-checked against package.json.

  test('UC-05: swao --version matches package.json and HTML embeds a valid semver', async ({}, testInfo) => {
    // Run swao --version
    const versionResult = spawnSync(BIN, ['--version'], { encoding: 'utf-8' });
    attachOutput(testInfo, '--version', {
      stdout: versionResult.stdout ?? '',
      stderr: versionResult.stderr ?? '',
      combined: (versionResult.stdout ?? '') + (versionResult.stderr ?? ''),
      status: versionResult.status ?? -1,
    });
    expect(versionResult.status, 'swao --version exited non-zero').toBe(0);

    // Extract semver from output: e.g. "SWAO ... v0.5.17 (Enterprise)"
    const versionOutput = (versionResult.stdout ?? '').trim();
    const semverMatch = versionOutput.match(/v?(\d+\.\d+\.\d+)/);
    expect(semverMatch, `--version output does not contain a semver: ${JSON.stringify(versionOutput)}`).not.toBeNull();
    const binaryVersion = semverMatch![1];

    // Cross-check against package.json (WORKSPACE is examples/portfolio-workspace/portfolio;
    // go up 3 levels to reach swao/, then into packages/swao/package.json)
    const pkgPath = join(WORKSPACE, '..', '..', '..', 'packages', 'swao', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    expect(pkg.version, 'package.json version is not a valid string').toMatch(/^\d+\.\d+\.\d+/);
    expect(
      binaryVersion,
      `swao --version (${binaryVersion}) does not match package.json (${pkg.version})`,
    ).toBe(pkg.version);

    // HTML must embed a valid swao_version field
    // (may differ from binaryVersion when WSP run predates the current build)
    const htmlContent = readFileSync(publishedHtmlPath, 'utf-8');
    const htmlVersionMatch = htmlContent.match(/"swao_version"\s*:\s*"(\d+\.\d+\.\d+)"/);
    expect(
      htmlVersionMatch,
      'Published HTML does not contain a "swao_version" field with a valid semver',
    ).not.toBeNull();
  });

});
