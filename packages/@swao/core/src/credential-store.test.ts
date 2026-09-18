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

// Tests for CredentialStore audit log (#2325 Feature 1).
// Verifies that set() and delete() emit the correct logPortfolio events.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from './credential-store.js';

vi.mock('./log.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./log.js')>();
  return { ...original, logPortfolio: vi.fn() };
});

import { logPortfolio } from './log.js';

let vaultDir: string;
let store: CredentialStore;

beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), 'swao-cred-test-'));
  store = new CredentialStore(vaultDir);
  vi.mocked(logPortfolio).mockClear();
});

function cleanup() {
  try { rmSync(vaultDir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

describe('CredentialStore audit log (#2325)', () => {
  it('set() emits credential.stored with key name only', async () => {
    await store.set('my-api-key', 'secret-value');
    const calls = vi.mocked(logPortfolio).mock.calls;
    const stored = calls.find(c => c[1] === 'credential.stored');
    expect(stored).toBeDefined();
    expect(stored![0]).toBe('info');
    expect(stored![3]).toMatchObject({ context: { key: 'my-api-key' } });
    // Value must never appear in any log call
    for (const [, , , opts] of calls) {
      const str = JSON.stringify(opts ?? {});
      expect(str).not.toContain('secret-value');
    }
    cleanup();
  });

  it('set() audit context contains only the key, not the value', async () => {
    await store.set('playwright-url-test', 'https://example.com');
    const calls = vi.mocked(logPortfolio).mock.calls;
    const stored = calls.find(c => c[1] === 'credential.stored');
    expect(stored![3]).toStrictEqual({ context: { key: 'playwright-url-test' } });
    cleanup();
  });

  it('delete() emits credential.deleted for existing key', async () => {
    await store.set('vcs-token', 'ghp_abc');
    vi.mocked(logPortfolio).mockClear();
    const deleted = await store.delete('vcs-token');
    expect(deleted).toBe(true);
    const calls = vi.mocked(logPortfolio).mock.calls;
    const ev = calls.find(c => c[1] === 'credential.deleted');
    expect(ev).toBeDefined();
    expect(ev![0]).toBe('info');
    expect(ev![3]).toMatchObject({ context: { key: 'vcs-token' } });
    cleanup();
  });

  it('delete() does NOT emit credential.deleted for missing key', async () => {
    const deleted = await store.delete('nonexistent-key');
    expect(deleted).toBe(false);
    const calls = vi.mocked(logPortfolio).mock.calls;
    const ev = calls.find(c => c[1] === 'credential.deleted');
    expect(ev).toBeUndefined();
    cleanup();
  });

  it('credential.stored is emitted AFTER successful save (not before)', async () => {
    const order: string[] = [];
    vi.mocked(logPortfolio).mockImplementation((_, code) => { order.push(code); });
    await store.set('test-key', 'test-val');
    // The only log event should be credential.stored
    expect(order).toEqual(['credential.stored']);
    cleanup();
  });
});
