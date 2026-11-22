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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from './credential-store.js';
import { _atomicWriteIo } from './atomic-write.js';

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

// #3686, #3823: the vault write survives a transient Windows lock on the
// rename (antivirus or indexer holding the file) and still surfaces a
// persistent one. The lock is simulated through the _atomicWriteIo seam.
describe('CredentialStore vault write under a locked target (#3686, #3823)', () => {
  const savedIo = { ..._atomicWriteIo };

  function errno(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(`${code}: operation not permitted, rename (simulated)`), { code });
  }

  function lockRename(codes: string[]): () => number {
    let attempts = 0;
    const queue = [...codes];
    _atomicWriteIo.rename = (src, dest) => {
      attempts++;
      const code = queue.shift();
      if (code !== undefined) throw errno(code);
      savedIo.rename(src, dest);
    };
    return () => attempts;
  }

  function vaultTmpFiles(): string[] {
    return readdirSync(vaultDir).filter(f => f.endsWith('.tmp'));
  }

  beforeEach(() => {
    _atomicWriteIo.platform = () => 'win32';
    _atomicWriteIo.sleep = () => undefined;
  });

  afterEach(() => {
    Object.assign(_atomicWriteIo, savedIo);
    cleanup();
  });

  it.each(['EPERM', 'EBUSY'])('set() survives one transient %s on the rename', async (code) => {
    const attempts = lockRename([code]);
    await store.set('api-key', 'v1');
    expect(attempts()).toBe(2);
    expect(await store.get('api-key')).toBe('v1');
    expect(vaultTmpFiles()).toEqual([]);
    expect(vi.mocked(logPortfolio).mock.calls.find(c => c[1] === 'credential.store.error')).toBeUndefined();
  });

  it('a persistent EPERM surfaces, keeps the previous vault and leaves no temp copy', async () => {
    await store.set('api-key', 'v1');
    const before = readFileSync(join(vaultDir, '.swao-credentials.json'), 'utf-8');
    const attempts = lockRename(Array(10).fill('EPERM'));
    await expect(store.set('api-key', 'v2')).rejects.toThrow(/EPERM/);
    expect(attempts()).toBe(5);
    expect(readFileSync(join(vaultDir, '.swao-credentials.json'), 'utf-8')).toBe(before);
    expect(vaultTmpFiles()).toEqual([]);
    const ev = vi.mocked(logPortfolio).mock.calls.find(c => c[1] === 'credential.store.error');
    expect(ev?.[3]).toMatchObject({ context: { error: 'EPERM' } });
    Object.assign(_atomicWriteIo, savedIo);
    expect(await store.get('api-key')).toBe('v1');
  });

  it('off Windows the rename is not retried', async () => {
    _atomicWriteIo.platform = () => 'linux';
    const attempts = lockRename(['EPERM']);
    await expect(store.set('api-key', 'v1')).rejects.toThrow(/EPERM/);
    expect(attempts()).toBe(1);
    expect(vaultTmpFiles()).toEqual([]);
  });
});
