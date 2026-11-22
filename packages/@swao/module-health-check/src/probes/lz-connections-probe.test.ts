// #3589, #4233: health-check probe [26] LZ connections (Design 120 sections 6.3, 14.2).
// Offline: a temporary workspace and vault, a fake driver registered in the
// live registry, the stored last probe and a last-run scan as fixtures; the
// driver's probe throws, so any network path fails the test.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CredentialStore } from '@swao/core';
import { recordLzProbe, registerLiveLzDriver, unregisterLiveLzDriver } from '@swao/module-landing-zone';
import type { LiveLzDriver, ReadOnlyProbe } from '@swao/module-landing-zone';
import { WRITE_CAPABLE_ACCEPTED } from '@swao/tui-kit';
import { buildLzConnectionsProbe, formatLzConnectionScopeLines, LZ_PROBE_STALE_DAYS } from './lz-connections-probe.js';
import { formatLzConnectionsProbeLine } from '../commands/health-check.js';

const tmp: string[] = [];
function dir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}
afterEach(() => {
  unregisterLiveLzDriver('fakecsp');
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SECRET = ['not', 'a', 'real', 'secret'].join('-');

function fakeDriver(): LiveLzDriver {
  return {
    provider: 'fakecsp',
    driverVersion: '0.0.0-test',
    authMethods: [{ id: 'aksk', required: ['access-key-id', 'secret-access-key'], optional: [], unattended: true }],
    defaultBaseUrls: { iam: 'https://iam.fakecsp.example' },
    readAllowList: [],
    routeTemplates: [],
    probeReadOnly: async () => { throw new Error('the health check must not call the provider'); },
    listRegions: async () => [],
    listServices: async () => [],
    listGuardrails: async () => [],
    listResources: async () => [],
    listQuotas: async () => [],
    listActivity: async () => ({ window_days: 30, events_total: 0, by_kind: {} }),
  } as unknown as LiveLzDriver;
}

const YML = ['name: demo', 'landing_zones:',
  '  - id: fake-prod', '    provider: fakecsp', '    scopes:',
  '      - id: platform', '        kind: platform', '        auth: aksk',
  '      - id: app-a', '        kind: application', '        auth: aksk',
  '  - id: other', '    provider: nocsp', '    scopes:', '      - id: platform', '        kind: platform', '        auth: other-auth', ''].join('\n');
const ONE_SCOPE = ['name: demo', 'landing_zones:', '  - id: fake-prod', '    provider: fakecsp', '    scopes:', '      - id: platform', '        kind: platform', '        auth: aksk', ''].join('\n');

const REFUSED: ReadOnlyProbe = { read_only: 'refused', identity: 'te_admin', reason: 'role grants ecs:servers:create', write_actions_allowed: ['ecs:servers:create'], coverage: { readable: ['ecs', 'rds'], unreadable: ['cts'] } };
const VERIFIED: ReadOnlyProbe = { read_only: 'verified', identity: 'reader', write_actions_allowed: [], coverage: { readable: ['ecs'], unreadable: [] } };
const NOW = new Date('2026-11-11T08:00:00Z');
const PROBED = new Date('2026-11-10T08:05:00Z');

async function vault(): Promise<CredentialStore> {
  const store = new CredentialStore(dir('swao-hc-vault-'));
  await store.set('lz:fake-prod:platform:access-key-id', 'akid');
  await store.set('lz:fake-prod:platform:secret-access-key', SECRET);
  return store;
}

function writeLastRun(ws: string): void {
  const wsp = join(ws, 'landing-zones', 'fake-prod', 'wsp');
  const run = join(wsp, 'runs', '2026-11-10T09-00-00');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(wsp, 'latest-lz-live.txt'), '2026-11-10T09-00-00\n');
  writeFileSync(join(run, 'fake-prod.platform.lz-live-scan.json'), JSON.stringify({
    meta: { scope_id: 'platform', observed_at: '2026-11-10T09:02:00Z' },
    offering: { services: Array.from({ length: 12 }, () => ({})) },
    estate: { resources: Array.from({ length: 340 }, () => ({})) },
  }));
}

describe('buildLzConnectionsProbe (#3589, #4233)', () => {
  it('INFO when no landing zone is registered (and without a workspace file)', async () => {
    const ws = dir('swao-hc-lzc-');
    expect((await buildLzConnectionsProbe(ws)).status).toBe('info');
    writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
    const r = await buildLzConnectionsProbe(ws, { store: new CredentialStore(dir('swao-hc-vault-')) });
    expect(r).toMatchObject({ status: 'info', scopes: [] });
    expect(r.message).toMatch(/no live landing zone registered/);
    expect(r.message).not.toMatch(/Tools/); // #4127: Landing Zone Connections is no longer a Tools item
  });

  it('per scope: stored probe in the Probe step words, coverage, probe time, credential field names, last run; no network, no value, no identity', async () => {
    registerLiveLzDriver(fakeDriver());
    const ws = dir('swao-hc-lzc-');
    writeFileSync(join(ws, '.swao.yml'), YML);
    recordLzProbe({ workspaceRoot: ws, lzId: 'fake-prod', scopeId: 'platform', probe: REFUSED, caller: 'wizard.lz-live.probe', now: PROBED });
    writeLastRun(ws);
    const r = await buildLzConnectionsProbe(ws, { store: await vault(), now: NOW });
    expect(r.status).toBe('warn');
    expect(r.scopes).toEqual([
      {
        lz_id: 'fake-prod', scope_id: 'platform', provider: 'fakecsp', state: 'refused', readable: 2, unreadable: 1,
        reason: 'role grants ecs:servers:create', probed_at: PROBED.toISOString(),
        credentials_stored: ['access-key-id', 'secret-access-key'],
        last_run: { observed_at: '2026-11-10T09:02:00Z', services: 12, resources: 340 },
      },
      { lz_id: 'fake-prod', scope_id: 'app-a', provider: 'fakecsp', state: 'credentials-missing', reason: 'missing access-key-id, secret-access-key', credentials_stored: [] },
      { lz_id: 'other', scope_id: 'platform', provider: 'nocsp', state: 'no-driver', reason: 'no live driver for nocsp in this build', credentials_stored: [] },
    ]);
    const line = formatLzConnectionsProbeLine(r);
    // The row says why it warns (criterion 2).
    expect(line).toMatch(/^ {2}\[26\/26\] LZ connections\.+ {2}WARN {2}2 landing zones, 3 scopes: 0 read-only verified; 1 scope with a write-capable login \(a run asks for confirmation\); 1 scope with credentials missing; 1 scope without a usable live driver/);
    expect(line).toContain(`fake-prod/platform (fakecsp): ${WRITE_CAPABLE_ACCEPTED.text}; role grants ecs:servers:create`);
    expect(line).toContain('fake-prod/platform: coverage 2 readable / 1 not readable; probed 2026-11-10 08:05 UTC; credentials stored: access-key-id, secret-access-key; last run 2026-11-10 09:02 UTC: 12 services, 340 resources read');
    expect(line).toContain('fake-prod/app-a (fakecsp): credentials incomplete (missing access-key-id, secret-access-key)');
    expect(line).toContain('fake-prod/app-a: no credentials stored');
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain('akid');
    expect(line).not.toContain('te_admin');
  });

  it('ok when every scope has a fresh verified probe; stale, not probed and expired are warnings that say so', async () => {
    registerLiveLzDriver(fakeDriver());
    const ws = dir('swao-hc-lzc-');
    writeFileSync(join(ws, '.swao.yml'), ONE_SCOPE);
    const store = await vault();
    const notProbed = await buildLzConnectionsProbe(ws, { store, now: NOW });
    expect(notProbed).toMatchObject({ status: 'warn', scopes: [{ state: 'not-probed' }] });
    expect(notProbed.message).toContain('1 scope not probed yet');
    expect(formatLzConnectionScopeLines(notProbed.scopes[0]!)[1]).toContain('probe again: Setup, Landing Zone Live Assessment, Probe');

    recordLzProbe({ workspaceRoot: ws, lzId: 'fake-prod', scopeId: 'platform', probe: VERIFIED, caller: 'lz.probe', now: PROBED });
    const fresh = await buildLzConnectionsProbe(ws, { store, now: NOW });
    expect(fresh).toMatchObject({ status: 'ok', message: '1 landing zone, 1 scope: 1 read-only verified', scopes: [{ state: 'verified', readable: 1, unreadable: 0 }] });
    expect(formatLzConnectionScopeLines(fresh.scopes[0]!)[0]).toBe('fake-prod/platform (fakecsp): read-only verified');

    const later = new Date(PROBED.getTime() + (LZ_PROBE_STALE_DAYS + 1) * 86_400_000);
    const stale = await buildLzConnectionsProbe(ws, { store, now: later });
    expect(stale).toMatchObject({ status: 'warn', scopes: [{ state: 'verified', stale: true }] });
    expect(stale.message).toContain(`1 probe older than ${LZ_PROBE_STALE_DAYS} days`);
    expect(formatLzConnectionScopeLines(stale.scopes[0]!)[1]).toContain(`probed 2026-11-10 08:05 UTC (stale: older than ${LZ_PROBE_STALE_DAYS} days; probe again`);

    await store.set('lz:fake-prod:platform:expires-at', '2020-01-01T00:00:00Z');
    const expired = await buildLzConnectionsProbe(ws, { store, now: NOW });
    expect(expired).toMatchObject({ status: 'warn', scopes: [{ state: 'token-expired' }] });
    expect(formatLzConnectionScopeLines(expired.scopes[0]!)[1]).toContain('credentials stored: access-key-id, expires-at, secret-access-key');
  });

  it('a login the provider refused at the last probe is shown as login failed, without coverage', async () => {
    registerLiveLzDriver(fakeDriver());
    const ws = dir('swao-hc-lzc-');
    writeFileSync(join(ws, '.swao.yml'), ONE_SCOPE);
    recordLzProbe({ workspaceRoot: ws, lzId: 'fake-prod', scopeId: 'platform', probe: { loginFailed: { httpStatus: 401 } }, caller: 'lz.probe', now: PROBED });
    const r = await buildLzConnectionsProbe(ws, { store: await vault(), now: NOW });
    expect(r).toMatchObject({ status: 'warn', scopes: [{ state: 'login-failed', reason: 'authentication failed (HTTP 401)' }] });
    expect(r.scopes[0]!.readable).toBeUndefined();
    expect(r.message).toContain('1 scope whose login the provider refused at the last probe');
    expect(formatLzConnectionScopeLines(r.scopes[0]!)).toEqual([
      'fake-prod/platform (fakecsp): login failed (authentication failed (HTTP 401)); check the stored login',
      'fake-prod/platform: probed 2026-11-10 08:05 UTC; credentials stored: access-key-id, secret-access-key',
    ]);
  });

  it('an invalid landing_zones block is a warning, not a crash', async () => {
    const ws = dir('swao-hc-lzc-');
    writeFileSync(join(ws, '.swao.yml'), 'landing_zones:\n  - id: Bad Id\n');
    const r = await buildLzConnectionsProbe(ws, { store: new CredentialStore(dir('swao-hc-vault-')) });
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/LZ connections cannot be read: .*landing_zones is invalid/);
  });

  it('with no landing zone registered the vault is never opened', async () => {
    const ws = dir('swao-hc-lzc-');
    writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
    const store = new CredentialStore(dir('swao-hc-vault-'));
    let opened = 0;
    store.list = async () => { opened++; return []; };
    expect((await buildLzConnectionsProbe(ws, { store })).status).toBe('info');
    expect(opened).toBe(0);
  });

  it('formatLzConnectionScopeLines without facts is one line', () => {
    expect(formatLzConnectionScopeLines({ lz_id: 'a', scope_id: 'b', provider: 'p', state: 'verified' })).toEqual(['a/b (p): read-only verified']);
  });
});
