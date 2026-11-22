// #4375: the test profile is removed with its ms-playwright junction unlinked
// first; the junction target (a fixture standing in for the real browser
// cache) stays untouched. Every path lives in a fixture folder of this test.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeSandboxProfile } from './sandbox-cleanup.js';

const fixture = mkdtempSync(join(tmpdir(), 'swao-4375-fixture-'));
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function fakeCache(): string {
  const cache = mkdtempSync(join(fixture, 'real-local-'));
  const browsers = join(cache, 'ms-playwright', 'chromium-0000');
  mkdirSync(browsers, { recursive: true });
  writeFileSync(join(browsers, 'chrome.exe'), 'browser');
  return join(cache, 'ms-playwright');
}

function sandbox(tmpRoot: string, target: string | null): string {
  const home = mkdtempSync(join(tmpRoot, 'swao-test-home-'));
  const local = join(home, 'AppData', 'Local');
  mkdirSync(local, { recursive: true });
  mkdirSync(join(home, 'AppData', 'Roaming', 'swao'), { recursive: true });
  writeFileSync(join(home, 'AppData', 'Roaming', 'swao', 'state.json'), '{}');
  if (target) symlinkSync(target, join(local, 'ms-playwright'), 'junction');
  return home;
}

describe('removeSandboxProfile (#4375)', () => {
  it('unlinks the ms-playwright junction, removes the sandbox, keeps the junction target', () => {
    const tmpRoot = mkdtempSync(join(fixture, 'tmp-'));
    const cache = fakeCache();
    const home = sandbox(tmpRoot, cache);
    expect(existsSync(join(home, 'AppData', 'Local', 'ms-playwright', 'chromium-0000', 'chrome.exe'))).toBe(true);
    const r = removeSandboxProfile(home, { tmpRoot });
    expect(r).toEqual({ removed: true, linksRemoved: 1 });
    expect(existsSync(home)).toBe(false);
    expect(readFileSync(join(cache, 'chromium-0000', 'chrome.exe'), 'utf-8')).toBe('browser');
  });

  it('removes a sandbox without a junction', () => {
    const tmpRoot = mkdtempSync(join(fixture, 'tmp-'));
    const home = sandbox(tmpRoot, null);
    expect(removeSandboxProfile(home, { tmpRoot })).toEqual({ removed: true, linksRemoved: 0 });
    expect(existsSync(home)).toBe(false);
  });

  it('touches only a direct child of the temp root with the sandbox prefix', () => {
    const tmpRoot = mkdtempSync(join(fixture, 'tmp-'));
    const cache = fakeCache();
    const nested = join(tmpRoot, 'deeper');
    mkdirSync(nested);
    const deep = sandbox(nested, cache);
    expect(removeSandboxProfile(deep, { tmpRoot }).reason).toBe('outside_tmp_root');
    expect(existsSync(deep)).toBe(true);
    const other = mkdtempSync(join(tmpRoot, 'other-'));
    expect(removeSandboxProfile(other, { tmpRoot }).reason).toBe('wrong_prefix');
    expect(existsSync(other)).toBe(true);
    expect(removeSandboxProfile(join(tmpRoot, 'swao-test-home-gone'), { tmpRoot }).reason).toBe('missing');
    // A sandbox path that is itself a junction is never followed.
    const linked = join(tmpRoot, 'swao-test-home-link');
    symlinkSync(cache, linked, 'junction');
    expect(removeSandboxProfile(linked, { tmpRoot }).removed).toBe(false);
    expect(existsSync(join(cache, 'chromium-0000', 'chrome.exe'))).toBe(true);
  });
});
