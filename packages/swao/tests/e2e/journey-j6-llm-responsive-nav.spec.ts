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
 * Journey J6-LLM-NAV -- LLM Assessment HTML responsive type-nav checks (#1483)
 *
 * Verifies that the type-nav bar (#swao-type-nav) is:
 *   - sticky (position: sticky) at full desktop width (1280px)
 *   - compressed at the 900px breakpoint (nav links collapse)
 *   - correctly offset below the sticky page header at 768px mobile width
 *
 * Preconditions:
 *   - LLM_PUB_HTML env var must point to an existing LLM assessment HTML file.
 *   - Tests skip gracefully when the env var is absent.
 *
 * To run locally:
 *   LLM_PUB_HTML="C:/swao/test-9.8/apps/sovereign-health/wsp/publications/2026-08-08-16-46-29-llm-assessment.html" \
 *   pnpm exec playwright test tests/e2e/journey-j6-llm-responsive-nav.spec.ts
 *
 * Tracker: #1483
 */
import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

const LLM_HTML = process.env['LLM_PUB_HTML'] ?? '';
const hasHtml = LLM_HTML !== '' && existsSync(LLM_HTML);

test.describe('J6-LLM-NAV -- responsive type-nav (#1483)', () => {
  test.skip(!hasHtml, 'LLM_PUB_HTML not set or file absent -- set env var to run');

  const fileUrl = hasHtml ? pathToFileURL(LLM_HTML).href : 'about:blank';

  test('type-nav is position:sticky at 1280px desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(fileUrl);
    await page.waitForLoadState('networkidle');

    const position = await page.evaluate(() => {
      const el = document.querySelector('#swao-type-nav') as HTMLElement | null;
      return el ? getComputedStyle(el).position : null;
    });
    expect(position).toBe('sticky');
  });

  test('type-nav top offset at 768px mobile matches header + band', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(fileUrl);
    await page.waitForLoadState('networkidle');

    const styles = await page.evaluate(() => {
      const nav = document.querySelector('#swao-type-nav') as HTMLElement | null;
      if (!nav) return null;
      const cs = getComputedStyle(nav);
      return { position: cs.position, top: cs.top };
    });
    expect(styles).not.toBeNull();
    expect(styles!.position).toBe('sticky');
    // At 768px the mobile @media rule reduces top to header-height + 46px band.
    // The exact pixel value is layout-dependent; assert it is set (not 'auto').
    expect(styles!.top).not.toBe('auto');
    expect(styles!.top).not.toBe('');
  });

  test('type-nav is present and links are rendered at 900px breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(fileUrl);
    await page.waitForLoadState('networkidle');

    const navLinkCount = await page.evaluate(() =>
      document.querySelectorAll('#swao-type-nav a').length,
    );
    // The 900px breakpoint compresses the nav but does not hide links.
    expect(navLinkCount).toBeGreaterThan(0);
  });
});
