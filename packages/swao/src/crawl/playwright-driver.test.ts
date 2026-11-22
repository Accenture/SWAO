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

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Browser } from 'playwright';
import { findInstalledChromium } from '@swao/core';
import { buildPlaywrightProbe, CHROMIUM_PROBE_LAUNCH_TIMEOUT_MS } from './playwright-driver.js';

// #0573: relocated from @swao/module-doctor's doctor.test.ts. buildPlaywrightProbe
// is host-only (playwright-driver is binary-excluded and shared with assess), so
// the doctor module receives it via injection and cannot import it for tests.
// The behavioural probe test belongs alongside the driver it exercises.

// When Chromium is installed, buildPlaywrightProbe falls back to the filesystem
// scan and returns 'ok' even for a fake path. Skip in that environment.
const chromiumInstalled = findInstalledChromium() !== null;

describe('Doctor -- Playwright probe (#0102)', () => {
  it.skipIf(chromiumInstalled)('buildPlaywrightProbe returns fail for non-existent binary path', async () => {
    const result = await buildPlaywrightProbe({ executablePath: '/does/not/exist/chrome', launchTimeoutMs: 1000 });
    expect(result.status).toBe('fail');
    expect(result.error).not.toBeNull();
  });
});

// #4388: the launch race timer must not outlive the probe, and a launch that loses
// the race must be closed. A mocked launcher stands in for Chromium; the path is any
// existing file (the node binary) so the probe reaches the launch branch.
describe('Playwright probe race timer (#4388)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeBrowser(): { browser: Browser; close: ReturnType<typeof vi.fn> } {
    const close = vi.fn(async () => undefined);
    const browser = { version: () => '131.0.0.0', close } as unknown as Browser;
    return { browser, close };
  }

  it('clears the timer when the launch wins the race', async () => {
    vi.useFakeTimers();
    const { browser, close } = fakeBrowser();
    const result = await buildPlaywrightProbe({
      executablePath: process.execPath,
      launchTimeoutMs: 5000,
      launch: async () => browser,
    });
    expect(result.status).toBe('ok');
    expect(result.version).toBe('131.0.0.0');
    expect(close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timer when the launch rejects before the timeout', async () => {
    vi.useFakeTimers();
    const result = await buildPlaywrightProbe({
      executablePath: process.execPath,
      launchTimeoutMs: 5000,
      launch: async () => { throw new Error('launch failed: missing shared library'); },
    });
    expect(result.status).toBe('fail');
    // #4451: a launch error stays fail and names its reason.
    expect(result.reason).toBe('launch_error');
    // Design 126: the raw error is log-only (detail), not in the screen text.
    expect(result.error).not.toContain('missing shared library');
    expect(result.detail).toBe('launch failed: missing shared library');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports the timeout and closes a launch that resolves after the timeout won', async () => {
    vi.useFakeTimers();
    const { browser, close } = fakeBrowser();
    let resolveLaunch: (b: Browser) => void = () => undefined;
    const pending = buildPlaywrightProbe({
      executablePath: process.execPath,
      launchTimeoutMs: 1000,
      launch: () => new Promise<Browser>((resolve) => { resolveLaunch = resolve; }),
    });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    // #4451: Chromium is on disk, the launch was only slow: warn, not fail.
    expect(result.status).toBe('warn');
    expect(result.reason).toBe('timeout');
    expect(result.error).toContain('Chromium installed, the test launch took longer than 1 s');
    expect(vi.getTimerCount()).toBe(0);
    expect(close).not.toHaveBeenCalled();
    resolveLaunch(browser);
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

// #4451 / #4461: the launch limit is a named 15 s constant, the launch runs once,
// and a slow close does not hold the probe result.
describe('Playwright probe launch limit and close wait (#4451, #4461)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a 15 s launch limit by default and reports a slower launch as warn', async () => {
    expect(CHROMIUM_PROBE_LAUNCH_TIMEOUT_MS).toBe(15_000);
    vi.useFakeTimers();
    const launch = vi.fn(() => new Promise<Browser>(() => undefined));
    const pending = buildPlaywrightProbe({ executablePath: process.execPath, launch });
    await vi.advanceTimersByTimeAsync(14_999);
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.status).toBe('warn');
    expect(result.reason).toBe('timeout');
    expect(result.error).toContain('longer than 15 s');
    expect(result.error).not.toContain(' -- ');
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('returns after the close wait when the browser close does not finish, launching once', async () => {
    vi.useFakeTimers();
    const close = vi.fn(() => new Promise<void>(() => undefined));
    const browser = { version: () => '148.0.0.0', close } as unknown as Browser;
    const launch = vi.fn(async () => browser);
    const pending = buildPlaywrightProbe({ executablePath: process.execPath, launch, closeWaitMs: 2000 });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;
    expect(result.status).toBe('ok');
    expect(result.version).toBe('148.0.0.0');
    expect(result.close_ms).toBeNull();
    expect(typeof result.launch_ms).toBe('number');
    expect(launch).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a missing executable as fail with reason not_found and no spaced double hyphen', async () => {
    const result = await buildPlaywrightProbe({ executablePath: '/does/not/exist/chrome', launch: vi.fn() });
    // The filesystem fallback may find an installed Chromium on a developer machine.
    if (result.status !== 'ok') {
      expect(result.status).toBe('fail');
      expect(result.reason).toBe('not_found');
      expect(result.error).not.toContain(' -- ');
    }
  });
});

describe('closeBrowserBounded (#4461)', () => {
  it('returns true when the close finishes in time', async () => {
    const { closeBrowserBounded } = await import('./playwright-driver.js');
    expect(await closeBrowserBounded({ close: () => Promise.resolve() }, 100)).toBe(true);
  });
  it('returns false after the wait when the close hangs, and a close error is no throw', async () => {
    const { closeBrowserBounded } = await import('./playwright-driver.js');
    expect(await closeBrowserBounded({ close: () => new Promise<void>(() => undefined) }, 20)).toBe(false);
    expect(await closeBrowserBounded({ close: () => Promise.reject(new Error('x')) }, 100)).toBe(true);
  });
});
