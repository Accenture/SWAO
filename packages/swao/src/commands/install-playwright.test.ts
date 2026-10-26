import { describe, it, expect, vi } from 'vitest';
import { isCommandAvailable, printOfflinePlaywrightGuidance } from './install-playwright.js';

describe('install-playwright offline handling (#3376)', () => {
  it('isCommandAvailable returns false for a command that does not exist', () => {
    expect(isCommandAvailable('swao-no-such-binary-xyz')).toBe(false);
  });

  it('printOfflinePlaywrightGuidance names the --no-crawl opt-out and the prepare-and-copy route', () => {
    const errs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { errs.push(String(m)); });
    try { printOfflinePlaywrightGuidance(); } finally { spy.mockRestore(); }
    const out = errs.join('\n');
    expect(out).toContain('--no-crawl');
    expect(out).toContain('npx playwright@');
    expect(out).toContain('playwright-core@');
    expect(out).toMatch(/ms-playwright/);
  });
});
