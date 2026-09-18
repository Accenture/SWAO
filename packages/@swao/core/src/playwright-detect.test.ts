// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core utilities
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// vi.mock is hoisted above imports by Vitest's transform. The factory must not
// reference module-scope variables (only vi.fn() is safe here). (#0927)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findInstalledChromium, PLAYWRIGHT_VERSION } from './playwright-detect.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

const FAKE_APPDATA = '/fake/AppData/Local';
const FAKE_PW_DIR = join(FAKE_APPDATA, 'ms-playwright');

describe('findInstalledChromium', () => {
  beforeEach(() => {
    process.env['LOCALAPPDATA'] = FAKE_APPDATA;
  });

  afterEach(() => {
    vi.resetAllMocks();
    delete process.env['LOCALAPPDATA'];
  });

  it('returns null when ms-playwright directory does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(findInstalledChromium()).toBeNull();
  });

  it('returns null when no chromium-* subdirectories are present', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(
      ['firefox-1234'] as unknown as ReturnType<typeof readdirSync>,
    );
    expect(findInstalledChromium()).toBeNull();
  });

  it('returns the chrome.exe path when chromium is installed in chrome-win64', () => {
    const chromePath = join(FAKE_PW_DIR, 'chromium-1169', 'chrome-win64', 'chrome.exe');
    vi.mocked(existsSync).mockImplementation((p) => p === FAKE_PW_DIR || p === chromePath);
    vi.mocked(readdirSync).mockReturnValue(
      ['chromium-1169'] as unknown as ReturnType<typeof readdirSync>,
    );
    expect(findInstalledChromium()).toBe(chromePath);
  });

  it('picks the highest version when multiple chromium builds are installed', () => {
    const highPath = join(FAKE_PW_DIR, 'chromium-1200', 'chrome-win64', 'chrome.exe');
    vi.mocked(existsSync).mockImplementation((p) => p === FAKE_PW_DIR || p === highPath);
    vi.mocked(readdirSync).mockReturnValue(
      ['chromium-1050', 'chromium-1200', 'chromium-1100'] as unknown as ReturnType<typeof readdirSync>,
    );
    expect(findInstalledChromium()).toBe(highPath);
  });

  it('falls back to chrome-win subfolder when chrome-win64 is absent', () => {
    const chromePath = join(FAKE_PW_DIR, 'chromium-1169', 'chrome-win', 'chrome.exe');
    vi.mocked(existsSync).mockImplementation((p) => p === FAKE_PW_DIR || p === chromePath);
    vi.mocked(readdirSync).mockReturnValue(
      ['chromium-1169'] as unknown as ReturnType<typeof readdirSync>,
    );
    expect(findInstalledChromium()).toBe(chromePath);
  });
});

describe('PLAYWRIGHT_VERSION', () => {
  it('is a semver string', () => {
    expect(PLAYWRIGHT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
