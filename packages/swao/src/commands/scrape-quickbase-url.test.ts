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
 * Regression tests for Quickbase URL hostname validation (#1197).
 *
 * CodeQL alert #71 flagged a substring-based host check in
 * scripts/scrape-quickbase.mjs that could be bypassed via spoofed hostnames
 * (e.g. quickbase.com.evil.test). The check (lines 83-85) was already fixed
 * to use `new URL(u).hostname` with exact/suffix matching before this sprint.
 * These tests pin the correct behaviour as a regression guard.
 *
 * The production logic is re-expressed here as pure functions so the test
 * does not require Playwright or a browser process.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Re-expression of the production logic from scrape-quickbase.mjs:83-85
// Keep in sync with that file.
// ---------------------------------------------------------------------------
function isQuickbaseHost(rawUrl: string): boolean {
  try {
    const h = new URL(rawUrl).hostname;
    return h === 'quickbase.com' || h.endsWith('.quickbase.com');
  } catch {
    return false;
  }
}

function isReadyQuickbasePage(rawUrl: string): boolean {
  if (!isQuickbaseHost(rawUrl)) return false;
  return rawUrl.includes('/nav/app') || (!rawUrl.includes('a=SignIn') && !rawUrl.includes('/db/main'));
}

// ---------------------------------------------------------------------------
// Host validation (#1197 -- substring bypass prevention)
// ---------------------------------------------------------------------------
describe('isQuickbaseHost (#1197 regression)', () => {
  it('accepts exact quickbase.com hostname', () => {
    expect(isQuickbaseHost('https://quickbase.com/nav/app/xyz')).toBe(true);
  });

  it('accepts legitimate subdomain acnlegalreadiness.quickbase.com', () => {
    expect(isQuickbaseHost('https://acnlegalreadiness.quickbase.com/nav/app/bss4pik5n')).toBe(true);
  });

  it('rejects spoofed host: quickbase.com.evil.test', () => {
    expect(isQuickbaseHost('https://quickbase.com.evil.test/nav/app/x')).toBe(false);
  });

  it('rejects spoofed host: evil.test with quickbase.com in path', () => {
    expect(isQuickbaseHost('https://evil.test/quickbase.com/nav/app/x')).toBe(false);
  });

  it('rejects non-quickbase host', () => {
    expect(isQuickbaseHost('https://example.com/nav/app')).toBe(false);
  });

  it('returns false for non-URL strings without throwing', () => {
    expect(isQuickbaseHost('not-a-url')).toBe(false);
    expect(isQuickbaseHost('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full ready-page check
// ---------------------------------------------------------------------------
describe('isReadyQuickbasePage', () => {
  it('passes for authenticated app nav view', () => {
    expect(isReadyQuickbasePage('https://acnlegalreadiness.quickbase.com/nav/app/bss4pik5n/table/bss4pik5q')).toBe(true);
  });

  it('fails for sign-in page', () => {
    expect(isReadyQuickbasePage('https://acnlegalreadiness.quickbase.com/db/main?a=SignIn')).toBe(false);
  });

  it('fails for /db/main unauthenticated page', () => {
    expect(isReadyQuickbasePage('https://acnlegalreadiness.quickbase.com/db/main')).toBe(false);
  });

  it('fails for spoofed host even on /nav/app path', () => {
    expect(isReadyQuickbasePage('https://quickbase.com.evil.test/nav/app/xyz')).toBe(false);
  });
});
