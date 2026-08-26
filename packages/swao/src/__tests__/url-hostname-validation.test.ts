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
 * Regression tests for js/incomplete-url-substring-sanitization -- #1197
 *
 * The quickbase URL validation in scrape-quickbase.mjs must use parsed
 * URL.hostname (exact match or suffix) rather than a substring includes()
 * check, which can be bypassed by crafted hostnames like quickbase.com.evil.test.
 */

import { describe, it, expect } from 'vitest';

// Mirrors the hostname validation logic used in scrape-quickbase.mjs.
// Changes to that logic must be reflected here (#1197 regression guard).
function isQuickbaseHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'quickbase.com' || h.endsWith('.quickbase.com');
  } catch { return false; }
}

describe('quickbase hostname validation (#1197)', () => {
  it('accepts bare quickbase.com', () => {
    expect(isQuickbaseHost('https://quickbase.com/db/main')).toBe(true);
  });

  it('accepts legitimate subdomain acnlegalreadiness.quickbase.com', () => {
    expect(isQuickbaseHost('https://acnlegalreadiness.quickbase.com/db/7')).toBe(true);
  });

  it('rejects spoofed host quickbase.com.evil.test', () => {
    expect(isQuickbaseHost('https://quickbase.com.evil.test/signin')).toBe(false);
  });

  it('rejects evil.test/path/quickbase.com', () => {
    expect(isQuickbaseHost('https://evil.test/path/quickbase.com')).toBe(false);
  });

  it('rejects URL with quickbase.com in query string only', () => {
    expect(isQuickbaseHost('https://evil.test/?ref=quickbase.com')).toBe(false);
  });

  it('rejects invalid URL string', () => {
    expect(isQuickbaseHost('not-a-url')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isQuickbaseHost('')).toBe(false);
  });
});
