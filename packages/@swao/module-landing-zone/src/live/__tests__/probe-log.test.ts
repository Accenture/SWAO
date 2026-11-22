// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4265: the lz.live.probe event carries reason, detected permissions,
// override hint, caller and duration, and no native identifier (Design 120
// section 6.4).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const events: Array<{ level: string; code: string; message: string; context: Record<string, unknown> }> = [];
vi.mock('@swao/core', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@swao/core')>();
  return {
    ...orig,
    logPortfolio: (level: string, code: string, message: string, opts: { context?: Record<string, unknown> } = {}) => {
      events.push({ level, code, message, context: opts.context ?? {} });
    },
  };
});

const { CredentialStore } = await import('@swao/core');
const { registerLiveLzDriver, unregisterLiveLzDriver } = await import('../registry.js');
const { evaluateReadOnlyGate, probeDisplayLevel, probeLogContext, probeLogMessage, probeOverrideHint, runLzProbe } = await import('../session.js');
const { runLzLiveScan } = await import('../scan.js');
const { lzProbeAction } = await import('../cli.js');
const { makeFakeDriver, makeTransport, REFUSED, UNVERIFIABLE, VERIFIED } = await import('./fake-driver.js');
type WireCall = import('./fake-driver.js').WireCall;

const tmp: string[] = [];
const tempDir = (prefix: string): string => { const d = mkdtempSync(join(tmpdir(), prefix)); tmp.push(d); return d; };

const YML = [
  'name: demo',
  'landing_zones:',
  '  - id: fake-prod',
  '    provider: fakecsp',
  '    scopes:',
  '      - id: platform',
  '        kind: platform',
  '        auth: aksk',
  '        regions: [eu-de]',
  '',
].join('\n');

async function setup(): Promise<{ ws: string; store: InstanceType<typeof CredentialStore>; calls: WireCall[] }> {
  const ws = tempDir('swao-lz-probe-log-ws-');
  writeFileSync(join(ws, '.swao.yml'), YML);
  const store = new CredentialStore(tempDir('swao-lz-probe-log-vault-'));
  await store.set('lz:fake-prod:platform:access-key-id', ['fake', 'ak'].join('-'));
  await store.set('lz:fake-prod:platform:secret-access-key', ['fake', 'sk'].join('-'));
  return { ws, store, calls: [] };
}

beforeEach(() => { events.length = 0; unregisterLiveLzDriver(); });
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('lz.live.probe event (#4265)', () => {
  it('a refused scope logs reason, detected permission, override hint, caller and duration once', async () => {
    registerLiveLzDriver(makeFakeDriver(REFUSED));
    const h = await setup();
    const outcome = await runLzProbe({ workspaceRoot: h.ws, lzId: 'fake-prod', store: h.store, env: {}, fetchImpl: makeTransport(h.calls), caller: 'wizard.lz-live.probe' });
    expect(outcome.exitCode).toBe(1);
    const probes = events.filter((e) => e.code === 'lz.live.probe');
    expect(probes).toHaveLength(1);
    const e = probes[0]!;
    expect(e.level).toBe('warn');
    expect(e.context).toMatchObject({
      lz_id: 'fake-prod', scope_id: 'platform', caller: 'wizard.lz-live.probe', read_only: 'refused',
      reason: 'role grants ecs:servers:create', detected_permissions: ['ecs:servers:create'], proceed: false, overrides: [],
    });
    expect(String(e.context['override_hint'])).toMatch(/--accept-write-capable-credentials/);
    expect(typeof e.context['duration_ms']).toBe('number');
    expect(e.context['duration_ms'] as number).toBeGreaterThanOrEqual(0);
  });

  it('repeated probes are told apart by caller; the CLI default is lz.probe', async () => {
    registerLiveLzDriver(makeFakeDriver(REFUSED));
    const h = await setup();
    await runLzProbe({ workspaceRoot: h.ws, lzId: 'fake-prod', store: h.store, env: {}, fetchImpl: makeTransport(h.calls), caller: 'health-check.lz_connections' });
    await lzProbeAction('fake-prod', {}, { cwd: h.ws, store: h.store, env: {}, fetchImpl: makeTransport(h.calls), out: () => {}, err: () => {}, guard: { requireFeature: () => undefined } });
    await lzProbeAction('fake-prod', { caller: 'wizard.lz-live.probe' }, { cwd: h.ws, store: h.store, env: {}, fetchImpl: makeTransport(h.calls), out: () => {}, err: () => {}, guard: { requireFeature: () => undefined } });
    expect(events.filter((e) => e.code === 'lz.live.probe').map((e) => e.context['caller'])).toEqual(['health-check.lz_connections', 'lz.probe', 'wizard.lz-live.probe']);
  });

  it('a proceeding probe carries no override hint', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = await setup();
    await runLzProbe({ workspaceRoot: h.ws, lzId: 'fake-prod', store: h.store, env: {}, fetchImpl: makeTransport(h.calls) });
    const e = events.find((x) => x.code === 'lz.live.probe')!;
    expect(e.level).toBe('info');
    expect(e.context).not.toHaveProperty('override_hint');
    expect(e.context).not.toHaveProperty('reason');
  });

  it('masks account ids, project ids and ARNs in the reason and the permissions', () => {
    const probe = {
      ...REFUSED,
      reason: 'role arn:aws:iam::123456789012:role/Admin in project 0123456789abcdef0123456789abcdef grants write',
      write_actions_allowed: ['iam:CreateRole on arn:aws:iam::123456789012:role/x', 'account 123456789012'],
    };
    const gate = evaluateReadOnlyGate(probe, {});
    const ctx = probeLogContext({ lzId: 'otc-prod', scopeId: 'platform', probe, gate, caller: 'lz.probe', durationMs: 12 });
    const text = JSON.stringify(ctx);
    expect(text).not.toMatch(/123456789012/);
    expect(text).not.toMatch(/arn:aws/);
    expect(text).not.toMatch(/0123456789abcdef0123456789abcdef/);
    expect(ctx['reason']).toMatch(/\[id\]/);
    expect(ctx['duration_ms']).toBe(12);
  });

  it('the hint names the unverified override for an unverifiable scope', () => {
    expect(probeOverrideHint(UNVERIFIABLE, evaluateReadOnlyGate(UNVERIFIABLE, {}))).toMatch(/--accept-unverified-read-only/);
    expect(probeOverrideHint(UNVERIFIABLE, evaluateReadOnlyGate(UNVERIFIABLE, { acceptUnverifiedReadOnly: true }))).toBeUndefined();
  });
  it('#4298: display_level warn for a write-capable login, the machine value stays refused', () => {
    const ctx = probeLogContext({ lzId: 'otc-prod', scopeId: 'platform', probe: REFUSED, gate: evaluateReadOnlyGate(REFUSED, {}), caller: 'lz.probe', durationMs: 1 });
    expect(ctx['read_only']).toBe('refused');
    expect(ctx['display_level']).toBe(REFUSED.coverage.readable.length === 0 ? 'fail' : 'warn');
    const ok = probeLogContext({ lzId: 'otc-prod', scopeId: 'platform', probe: VERIFIED, gate: evaluateReadOnlyGate(VERIFIED, {}), caller: 'lz.probe', durationMs: 1 });
    expect(ok['display_level']).toBe(VERIFIED.coverage.readable.length === 0 ? 'fail' : 'ok');
  });

  it('#4460: a run with an accepted write-capable login logs "write-capable, accepted for this run" (caller lz.scan)', async () => {
    registerLiveLzDriver(makeFakeDriver(REFUSED));
    const h = await setup();
    await runLzLiveScan({ workspaceRoot: h.ws, lzId: 'fake-prod', store: h.store, env: {}, fetchImpl: makeTransport(h.calls), acceptWriteCapableCredentials: true });
    const e = events.find((x) => x.code === 'lz.live.probe')!;
    expect(e.message).toBe('Landing zone read-only probe: fake-prod/platform write-capable, accepted for this run');
    expect(e.message).not.toMatch(/refused/);
    expect(e.level).toBe('info');
    expect(e.context).toMatchObject({ caller: 'lz.scan', read_only: 'refused', accepted: true, proceed: true });
  });

  it('#4460: a probe without the override (caller lz.probe, before the user decides) reads "needs a confirmation per run", never "stopped", and carries no accepted flag', async () => {
    registerLiveLzDriver(makeFakeDriver(REFUSED));
    const h = await setup();
    await lzProbeAction('fake-prod', {}, { cwd: h.ws, store: h.store, env: {}, fetchImpl: makeTransport(h.calls), out: () => {}, err: () => {}, guard: { requireFeature: () => undefined } });
    const e = events.find((x) => x.code === 'lz.live.probe')!;
    expect(e.message).toBe('Landing zone read-only probe: fake-prod/platform write-capable, needs a confirmation per run');
    expect(e.message).not.toMatch(/stopped/);
    expect(e.context['caller']).toBe('lz.probe');
    expect(e.context).toMatchObject({ read_only: 'refused', display_level: 'warn' });
    expect(e.context).not.toHaveProperty('accepted');
  });

  it('#4460: the Setup probe (caller wizard.lz-live.probe) of a write-capable login reads "write-capable, needs a confirmation per run"', async () => {
    registerLiveLzDriver(makeFakeDriver(REFUSED));
    const h = await setup();
    await lzProbeAction('fake-prod', { caller: 'wizard.lz-live.probe' }, { cwd: h.ws, store: h.store, env: {}, fetchImpl: makeTransport(h.calls), out: () => {}, err: () => {}, guard: { requireFeature: () => undefined } });
    const e = events.find((x) => x.code === 'lz.live.probe')!;
    expect(e.message).toBe('Landing zone read-only probe: fake-prod/platform write-capable, needs a confirmation per run');
    expect(e.context).toMatchObject({ caller: 'wizard.lz-live.probe', read_only: 'refused', display_level: 'warn' });
  });

  it('#4460: a run that stops keeps "refused, stopped" (caller lz.scan)', async () => {
    registerLiveLzDriver(makeFakeDriver(REFUSED));
    const h = await setup();
    await runLzLiveScan({ workspaceRoot: h.ws, lzId: 'fake-prod', store: h.store, env: {}, fetchImpl: makeTransport(h.calls) }).catch(() => undefined);
    const e = events.find((x) => x.code === 'lz.live.probe')!;
    expect(e.message).toBe('Landing zone read-only probe: fake-prod/platform refused, stopped');
    expect(e.context['caller']).toBe('lz.scan');
  });

  it('#4496: a scope whose sign-in is refused logs lz.live.probe "not probed" with the masked reason (caller wizard.lz-live.probe)', async () => {
    const { LiveAuthError } = await import('../errors.js');
    registerLiveLzDriver(makeFakeDriver(async () => { throw new LiveAuthError('fakecsp', 400, 'bad request for project 0123456789abcdef0123456789abcdef'); }));
    const h = await setup();
    await expect(runLzProbe({ workspaceRoot: h.ws, lzId: 'fake-prod', store: h.store, env: {}, fetchImpl: makeTransport(h.calls), caller: 'wizard.lz-live.probe' })).rejects.toThrow(/authentication failed/);
    const e = events.find((x) => x.code === 'lz.live.probe')!;
    expect(e.level).toBe('warn');
    expect(e.message).toBe('Landing zone read-only probe: fake-prod/platform not probed');
    expect(e.context).toMatchObject({ caller: 'wizard.lz-live.probe', read_only: 'login-failed', http_status: 400, display_level: 'fail', proceed: false });
    expect(String(e.context['reason'])).toMatch(/authentication failed \(HTTP 400\)/);
    expect(String(e.context['reason'])).not.toContain('0123456789abcdef0123456789abcdef');
  });

  it('#4496: a scope without its login logs lz.live.probe "not probed" before the error', async () => {
    registerLiveLzDriver(makeFakeDriver(VERIFIED));
    const h = await setup();
    await h.store.delete('lz:fake-prod:platform:access-key-id');
    await expect(runLzProbe({ workspaceRoot: h.ws, lzId: 'fake-prod', store: h.store, env: {}, fetchImpl: makeTransport(h.calls) })).rejects.toThrow();
    const e = events.find((x) => x.code === 'lz.live.probe')!;
    expect(e.message).toBe('Landing zone read-only probe: fake-prod/platform not probed');
    expect(e.context).toMatchObject({ caller: 'lz.probe', read_only: 'not-probed' });
    expect(typeof e.context['reason']).toBe('string');
  });

  it('#4460: probeLogMessage words per state', () => {
    expect(probeLogMessage('a', 'b', VERIFIED, evaluateReadOnlyGate(VERIFIED, {}))).toBe('Landing zone read-only probe: a/b verified');
    expect(probeLogMessage('a', 'b', UNVERIFIABLE, evaluateReadOnlyGate(UNVERIFIABLE, { acceptUnverifiedReadOnly: true }))).toBe('Landing zone read-only probe: a/b not verifiable, accepted for this run');
    expect(probeLogMessage('a', 'b', UNVERIFIABLE, evaluateReadOnlyGate(UNVERIFIABLE, {}))).toBe('Landing zone read-only probe: a/b unverifiable, stopped');
    // #4460: a probe stops nothing.
    expect(probeLogMessage('a', 'b', UNVERIFIABLE, evaluateReadOnlyGate(UNVERIFIABLE, {}), 'probe')).toBe('Landing zone read-only probe: a/b not verifiable, needs a confirmation per run');
    expect(probeLogMessage('a', 'b', REFUSED, evaluateReadOnlyGate(REFUSED, {}), 'probe')).toBe('Landing zone read-only probe: a/b write-capable, needs a confirmation per run');
    expect(probeLogMessage('a', 'b', VERIFIED, evaluateReadOnlyGate(VERIFIED, {}), 'probe')).toBe('Landing zone read-only probe: a/b verified');
  });

  it('#4298: probeDisplayLevel: refused and unverifiable are warn, verified ok, nothing readable fail', () => {
    expect(probeDisplayLevel('refused', 56)).toBe('warn');
    expect(probeDisplayLevel('unverifiable', 3)).toBe('warn');
    expect(probeDisplayLevel('verified', 5)).toBe('ok');
    expect(probeDisplayLevel('refused', 0)).toBe('fail');
    expect(probeDisplayLevel('verified', undefined)).toBe('ok');
  });
});
