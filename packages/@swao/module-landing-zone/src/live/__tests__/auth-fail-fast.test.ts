// #3750 / #3803: a token refused mid-run fails the run fast for every driver
// (Design 120 section 6.2, Design 121 section 8.2 `expired-token`). The HTTP
// layer (http.ts) turns a 401 on a read into LiveTokenRejectedError and
// latches it; the scan (scan.ts) and the probe (session.ts) stop at the next
// driver method even when a driver swallowed the error.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';
import { AuthFailureLatch, LiveTokenRejectedError, createReadOnlyFetch } from '../http.js';
import { LiveAuthError, LiveSourceUnavailableError } from '../errors.js';
import { runLzLiveScan } from '../scan.js';
import { runLzProbe } from '../session.js';
import { readLzProbeRecords } from '../probe-record.js';
import { registerLiveLzDriver, unregisterLiveLzDriver } from '../registry.js';
import type { FetchLike, ScopeCtx } from '../types.js';
import { VERIFIED, makeFakeDriver, makeTransport } from './fake-driver.js';
import type { WireCall } from './fake-driver.js';

const TOKEN_RULE = [{ method: 'POST', path: /^\/v3\/auth\/tokens$/, reason: 'token request, changes nothing' }];
const PROJECT = '0123456789abcdef0123456789abcdef';

describe('createReadOnlyFetch: 401 on a read', () => {
  it('throws LiveTokenRejectedError (a LiveAuthError, exit 1) naming the route template, never the path, and latches it', async () => {
    const latch = new AuthFailureLatch();
    const f = createReadOnlyFetch(makeTransport([], () => ({ status: 401, body: '{}' })), 'fakecsp', TOKEN_RULE, { latch, routeOf: () => '/v3/projects/{project_id}/servers' });
    const err = await f(`https://ecs.fakecsp.example/v3/projects/${PROJECT}/servers`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveTokenRejectedError);
    expect(err).toBeInstanceOf(LiveAuthError);
    expect(err).toMatchObject({ name: 'LiveAuthError', httpStatus: 401, exitCode: 1, route: 'GET /v3/projects/{project_id}/servers' });
    expect((err as Error).message).not.toContain(PROJECT);
    expect(latch.failure).toBe(err);
    expect(() => latch.throwIfFailed()).toThrow(LiveTokenRejectedError);
    // HEAD is a read as well
    await expect(f('https://ecs.fakecsp.example/x', { method: 'HEAD' })).rejects.toBeInstanceOf(LiveTokenRejectedError);
  });

  it('leaves a 401 of an allow-listed token request to the driver (wrong password keeps its message), and every other status alone', async () => {
    const latch = new AuthFailureLatch();
    const calls: WireCall[] = [];
    const f = createReadOnlyFetch(makeTransport(calls, (u) => ({ status: u.endsWith('/tokens') ? 401 : u.endsWith('/403') ? 403 : 404, body: '{}' })), 'fakecsp', TOKEN_RULE, { latch });
    expect((await f('https://iam.fakecsp.example/v3/auth/tokens', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await f('https://ecs.fakecsp.example/403')).status).toBe(403);
    expect((await f('https://ecs.fakecsp.example/404')).status).toBe(404);
    expect(latch.failure).toBeUndefined();
    expect(() => latch.throwIfFailed()).not.toThrow();
  });

  it('without options it still throws, with a generic route label', async () => {
    const f = createReadOnlyFetch(makeTransport([], () => ({ status: 401, body: '{}' })), 'fakecsp', TOKEN_RULE);
    await expect(f(`https://ecs.fakecsp.example/v3/projects/${PROJECT}/servers`)).rejects.toThrow(/refused on GET a read request/);
  });

  it('the latch keeps the first refusal', () => {
    const l = new AuthFailureLatch();
    const a = new LiveTokenRejectedError('x', 'GET /a');
    l.record(a);
    l.record(new LiveTokenRejectedError('x', 'GET /b'));
    expect(l.failure).toBe(a);
  });
});

describe('scan and probe stop on a refused token even when the driver swallows it', () => {
  const tmp: string[] = [];
  const dir = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); tmp.push(d); return d; };
  beforeEach(() => unregisterLiveLzDriver());
  afterEach(() => { unregisterLiveLzDriver(); for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

  async function workspace(): Promise<{ ws: string; store: CredentialStore }> {
    const ws = dir('swao-401-ws-');
    writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: fake-prod', '    provider: fakecsp', '    scopes:', '      - id: platform', '        kind: platform', '        auth: aksk', '        regions: [eu-de]', ''].join('\n'));
    const store = new CredentialStore(dir('swao-401-vault-'));
    await store.set('lz:fake-prod:platform:access-key-id', ['fake', 'ak'].join('-'));
    await store.set('lz:fake-prod:platform:secret-access-key', ['fake', 'sk'].join('-'));
    return { ws, store };
  }

  /** Answers 200 for the first `okReads` reads, then 401 (the token expired). */
  function expiring(okReads: number): FetchLike {
    let reads = 0;
    return async (_url, init) => {
      const read = (init?.method ?? 'GET').toUpperCase() === 'GET';
      const status = read && ++reads > okReads ? 401 : 200;
      return { ok: status < 400, status, headers: { get: () => null }, text: async () => '{}' };
    };
  }

  /** A list method that records every failure as a missing source, as the otc driver does. */
  const swallowing = (source: string) => async (ctx: ScopeCtx) => {
    try {
      await ctx.http.fetch(`${ctx.http.baseUrls['ecs']}/v3/projects/${PROJECT}/servers`);
    } catch (err) {
      ctx.sources.push({ name: source, status: 'not_collected', http_status: (err as { httpStatus?: number }).httpStatus ?? 0 });
    }
    return [];
  };

  it('runLzLiveScan rejects with LiveTokenRejectedError at the first method after the refusal; later methods are not called', async () => {
    let quotasCalled = false;
    registerLiveLzDriver(makeFakeDriver(VERIFIED, {
      listRegions: async () => [{ id: 'eu-de', azs: [], status: 'enabled' }],
      listServices: swallowing('services:eu-de') as never,
      listQuotas: async () => { quotasCalled = true; return []; },
    }));
    const { ws, store } = await workspace();
    // The probe makes one read; the first list read is refused.
    const err = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl: expiring(1) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveTokenRejectedError);
    expect(err).toMatchObject({ httpStatus: 401, route: 'GET /v3/projects/{project_id}/servers', exitCode: 1 });
    expect(quotasCalled).toBe(false);
  });

  it('a driver that turns the 401 into LiveSourceUnavailableError does not hide it either', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED, {
      listResources: async (ctx) => {
        try { await ctx.http.fetch(`${ctx.http.baseUrls['ecs']}/v3/projects/${PROJECT}/servers`); } catch { throw new LiveSourceUnavailableError('inventory:resources', 401); }
        return [];
      },
    }));
    const { ws, store } = await workspace();
    await expect(runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl: expiring(1) })).rejects.toBeInstanceOf(LiveTokenRejectedError);
  });

  it('a probe that reports unverifiable after a 401 stops the probe and the scan', async () => {
    registerLiveLzDriver(makeFakeDriver(async (ctx) => {
      try { await ctx.http.fetch(`${ctx.http.baseUrls['iam']}/v3/projects/${PROJECT}/servers`); } catch { /* the otc probe returns unverifiable here */ }
      return { read_only: 'unverifiable', identity: 'x', reason: 'r', write_actions_allowed: [], coverage: { readable: [], unreadable: [] } };
    }));
    const { ws, store } = await workspace();
    await expect(runLzProbe({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl: expiring(0) })).rejects.toBeInstanceOf(LiveTokenRejectedError);
    // #4233: the refused login is stored as the scope's last probe (HTTP status only).
    expect(readLzProbeRecords(ws, 'fake-prod').get('platform')).toMatchObject({ read_only: 'login-failed', reason: expect.stringMatching(/^authentication failed \(HTTP \d+\)$/) });
    await expect(runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl: expiring(0), acceptUnverifiedReadOnly: true })).rejects.toBeInstanceOf(LiveTokenRejectedError);
  });

  it('without a 401 the scan completes and records sources as before', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const { ws, store } = await workspace();
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl: expiring(1000) });
    expect(out.exitCode).toBe(0);
    expect(out.results[0]?.scan).toBeDefined();
    // #4233: the run's probe is stored as the scope's last probe (health check reads it).
    expect(readLzProbeRecords(ws, 'fake-prod').get('platform')).toMatchObject({ read_only: 'verified', caller: 'lz.scan' });
  });
});
