// #3751 / #3804: the shared 429 rule (retry.ts) and its place in the driver
// context (session.ts buildScopeCtx), Design 121 section 8.2 `throttled`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';
import { MAX_RETRIES, MAX_TOTAL_WAIT_S, MAX_WAIT_S, createThrottleRetryFetch, retryAfterSeconds, setThrottleSleepForTests } from '../retry.js';
import { runLzLiveScan } from '../scan.js';
import { registerLiveLzDriver, unregisterLiveLzDriver } from '../registry.js';
import { LiveSourceUnavailableError } from '../errors.js';
import type { FetchLike } from '../types.js';
import { VERIFIED, makeFakeDriver } from './fake-driver.js';

const slept: number[] = [];
beforeEach(() => { slept.length = 0; setThrottleSleepForTests(async (ms) => { slept.push(ms); }); });
afterEach(() => setThrottleSleepForTests(undefined));

/** Answers the statuses in order (then 200), with the given Retry-After values. */
function sequence(statuses: number[], retryAfter: (string | null)[] = []): { fetch: FetchLike; calls: { method: string; body?: string }[]; drained: number[] } {
  const calls: { method: string; body?: string }[] = [];
  const drained: number[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const i = calls.length;
    calls.push({ method: init?.method ?? 'GET', ...(init?.body !== undefined ? { body: init.body } : {}) });
    const status = statuses[i] ?? 200;
    const ra = retryAfter[i] ?? null;
    return { ok: status < 400, status, headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? ra : null) }, text: async () => { drained.push(i); return '{}'; } };
  };
  return { fetch, calls, drained };
}

describe('retryAfterSeconds (RFC 9110 section 10.2.3)', () => {
  it('reads delay-seconds and HTTP-dates; a past date is 0; anything else is undefined', () => {
    const now = Date.parse('2026-11-04T18:00:00Z');
    expect(retryAfterSeconds('7', now)).toBe(7);
    expect(retryAfterSeconds(' 0 ', now)).toBe(0);
    expect(retryAfterSeconds('Wed, 04 Nov 2026 18:00:12 GMT', now)).toBe(12);
    expect(retryAfterSeconds('Wed, 04 Nov 2026 17:59:00 GMT', now)).toBe(0);
    for (const v of [null, undefined, '', '-1', '1.5', 'soon', '2026-11-04T18:00:12Z']) expect(retryAfterSeconds(v, now)).toBeUndefined();
  });
});

describe('createThrottleRetryFetch', () => {
  it('retries a 429 after its Retry-After and returns the success; the refused body is drained; the request is resent unchanged', async () => {
    const s = sequence([429, 200], ['2']);
    const r = await createThrottleRetryFetch(s.fetch)('https://x.example/a', { method: 'POST', body: 'grant=1' });
    expect(r.status).toBe(200);
    expect(slept).toEqual([2000]);
    expect(s.calls).toEqual([{ method: 'POST', body: 'grant=1' }, { method: 'POST', body: 'grant=1' }]);
    expect(s.drained).toEqual([0]);
  });

  it('without Retry-After the wait doubles from 1 s; after MAX_RETRIES retries the 429 is returned', async () => {
    const s = sequence([429, 429, 429, 429, 429]);
    const r = await createThrottleRetryFetch(s.fetch)('https://x.example/a');
    expect(r.status).toBe(429);
    expect(s.calls).toHaveLength(MAX_RETRIES + 1);
    expect(slept).toEqual([1000, 2000, 4000]);
  });

  it('honours an HTTP-date Retry-After', async () => {
    const at = new Date(Date.now() + 3000).toUTCString();
    const s = sequence([429, 200], [at]);
    expect((await createThrottleRetryFetch(s.fetch)('https://x.example/a')).status).toBe(200);
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThanOrEqual(2000);
    expect(slept[0]).toBeLessThanOrEqual(4000);
  });

  it('returns the 429 at once when the asked wait exceeds the single cap or the total cap', async () => {
    const long = sequence([429], [String(MAX_WAIT_S + 1)]);
    expect((await createThrottleRetryFetch(long.fetch)('https://x.example/a')).status).toBe(429);
    expect(long.calls).toHaveLength(1);
    expect(slept).toEqual([]);
    const total = sequence([429, 429, 429], [String(MAX_WAIT_S), String(MAX_WAIT_S), String(MAX_WAIT_S)]);
    expect((await createThrottleRetryFetch(total.fetch)('https://x.example/a')).status).toBe(429);
    expect(slept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_TOTAL_WAIT_S * 1000);
    expect(total.calls).toHaveLength(MAX_TOTAL_WAIT_S / MAX_WAIT_S + 1);
  });

  it('retries a 503 only when it carries Retry-After (RFC 9110 section 15.6.4)', async () => {
    const withHeader = sequence([503, 200], ['3']);
    expect((await createThrottleRetryFetch(withHeader.fetch)('https://x.example/a')).status).toBe(200);
    expect(slept).toEqual([3000]);
    const without = sequence([503, 200]);
    expect((await createThrottleRetryFetch(without.fetch)('https://x.example/a')).status).toBe(503);
    expect(without.calls).toHaveLength(1);
  });

  it('leaves every other status alone (no retry on 401, 403, 500, 503 without Retry-After)', async () => {
    for (const st of [200, 401, 403, 500, 503]) {
      const s = sequence([st]);
      expect((await createThrottleRetryFetch(s.fetch)('https://x.example/a')).status).toBe(st);
      expect(s.calls).toHaveLength(1);
    }
    expect(slept).toEqual([]);
  });

  it('reports each retry to onRetry without the URL', async () => {
    const seen: unknown[] = [];
    const s = sequence([429, 200], ['1']);
    await createThrottleRetryFetch(s.fetch, { onRetry: (i) => seen.push(i) })('https://x.example/secret-path');
    expect(seen).toEqual([{ attempt: 1, waitS: 1, method: 'GET', status: 429 }]);
  });
});

describe('the driver context retries 429 for every driver (session.ts)', () => {
  const tmp: string[] = [];
  const dir = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); tmp.push(d); return d; };
  beforeEach(() => unregisterLiveLzDriver());
  afterEach(() => { unregisterLiveLzDriver(); for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it('a driver list method sees the success after one 429 and the source is ok', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED, {
      listResources: async (ctx) => {
        const r = await ctx.http.fetch(`${ctx.http.baseUrls['ecs']}/v3/projects/p/servers`);
        if (!r.ok) throw new LiveSourceUnavailableError('inventory:resources', r.status);
        return [];
      },
    }));
    const ws = dir('swao-429-ws-');
    writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: fake-prod', '    provider: fakecsp', '    scopes:', '      - id: platform', '        kind: platform', '        auth: aksk', '        regions: [eu-de]', ''].join('\n'));
    const store = new CredentialStore(dir('swao-429-vault-'));
    await store.set('lz:fake-prod:platform:access-key-id', ['fake', 'ak'].join('-'));
    await store.set('lz:fake-prod:platform:secret-access-key', ['fake', 'sk'].join('-'));
    let servers = 0;
    const fetchImpl: FetchLike = async (url) => {
      const throttle = url.startsWith('https://ecs.') && servers++ === 0;
      return { ok: !throttle, status: throttle ? 429 : 200, headers: { get: (n: string) => (throttle && n === 'retry-after' ? '1' : null) }, text: async () => '{}' };
    };
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl });
    expect(out.exitCode).toBe(0);
    expect(out.results[0]?.scan?.meta.sources).toContainEqual({ name: 'inventory:resources', status: 'ok' });
    expect(slept).toEqual([1000]);
  });
});
