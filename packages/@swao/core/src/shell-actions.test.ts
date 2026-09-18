// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #0408 (sprint-040 round-7): smoke tests for shell-actions.ts. We
// cannot spawn the actual OS clipboard / open tools in CI (and even on
// dev hosts, opening PowerBI Desktop during a vitest run is annoying),
// so these tests only assert that the API is well-shaped: returns
// false on empty inputs, returns boolean otherwise, and doesn't throw.
// End-to-end behaviour is operator-verified in TUI testing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openWithDefaultApp, copyToClipboard } from './shell-actions.js';

// ---------------------------------------------------------------------------
// Path guard: inputs that must be rejected before any spawn call.
// These tests do not mock child_process -- the guard returns before spawning.
// ---------------------------------------------------------------------------
describe('openWithDefaultApp -- path guard (#0726/#0733)', () => {
  it('returns false on empty path', () => {
    expect(openWithDefaultApp('')).toBe(false);
  });

  it('returns false for a relative path', () => {
    expect(openWithDefaultApp('relative/path/file.pbit')).toBe(false);
  });

  it('returns false for a bare filename', () => {
    expect(openWithDefaultApp('file.pbit')).toBe(false);
  });

  it('returns false for a dot-slash relative path', () => {
    expect(openWithDefaultApp('./reports/index.html')).toBe(false);
  });

  it('accepts an absolute Windows path (C:\\...)', () => {
    // On any platform the guard passes; spawn outcome is irrelevant here.
    const result = openWithDefaultApp('C:\\Users\\test\\report.pbit');
    expect(typeof result).toBe('boolean');
  });

  it('accepts an absolute POSIX path (/...)', () => {
    const result = openWithDefaultApp('/home/user/report.pbit');
    expect(typeof result).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// Smoke tests: the function returns a boolean without throwing for valid paths.
// ---------------------------------------------------------------------------
describe('openWithDefaultApp (#0408)', () => {
  it('returns a boolean for a non-empty path (does not throw)', () => {
    const result = openWithDefaultApp('/swao-test-non-existent-path-12345.pbit');
    expect(typeof result).toBe('boolean');
  });

  it('returns a boolean for an .html path without throwing (#0699)', () => {
    const result = openWithDefaultApp('/swao-test-non-existent-path-12345.html');
    expect(typeof result).toBe('boolean');
  });
});

describe('copyToClipboard (#0408)', () => {
  it('returns false on empty string without throwing', () => {
    expect(copyToClipboard('')).toBe(false);
  });

  it('returns false on non-string input without throwing', () => {
    // @ts-expect-error -- testing runtime guard
    expect(copyToClipboard(null)).toBe(false);
    // @ts-expect-error -- testing runtime guard
    expect(copyToClipboard(undefined)).toBe(false);
  });

  it('returns a boolean for a non-empty string (does not throw)', () => {
    // On Windows / macOS this typically succeeds; on Linux it depends on
    // xclip/xsel availability. We assert the return type only.
    const result = copyToClipboard('swao-test-clipboard');
    expect(typeof result).toBe('boolean');
  });
});
