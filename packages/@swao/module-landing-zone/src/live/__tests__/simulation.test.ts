// #3596: simulated-run provenance (Design 121 section 10). Each of the three
// evidence sources alone marks a scope run simulated; the mark reaches the
// scan, the merged view and the run manifest; consumers refuse or split
// simulated runs. Synthetic fixtures only (fake driver, fake values).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';
import type { LzLiveScan } from '@swao/core';
import { registerLiveLzDriver, unregisterLiveLzDriver } from '../registry.js';
import { MOCK_ENDPOINTS_ENV } from '../endpoints.js';
import { runLzLiveScan } from '../scan.js';
import { runLzLiveAssessment } from '../assess.js';
import { mergeLzLiveScopes } from '../merge.js';
import {
  MOCK_CSP_RESPONSE_HEADER,
  SimulatedRunError,
  SimulationEvidence,
  assertLzLiveRunNotSimulated,
  createSimulationEvidenceFetch,
  hasSwaoMockClaim,
  parseMockCspHeader,
  simulatedScopesOfRun,
  splitSimulatedScopes,
} from '../simulation.js';
import { makeFakeDriver, makeTransport, REFUSED, VERIFIED } from './fake-driver.js';
import type { WireCall } from './fake-driver.js';
import type { FetchLike, ScopeCtx } from '../types.js';

const tmp: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}
beforeEach(() => unregisterLiveLzDriver());
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

const AK = ['fake', 'ak', 'value'].join('-');
const SK = ['fake', 'sk', 'value'].join('-');
const YML = ['name: demo', 'landing_zones:', '  - id: fake-prod', '    provider: fakecsp', '    scopes:', '      - id: platform', '        kind: platform', '        auth: aksk', '        regions: [eu-de]', ''].join('\n');

async function workspace(): Promise<{ ws: string; store: CredentialStore }> {
  const ws = tempDir('swao-lz-sim-ws-');
  writeFileSync(join(ws, '.swao.yml'), YML);
  const store = new CredentialStore(tempDir('swao-lz-sim-vault-'));
  await store.set('lz:fake-prod:platform:access-key-id', AK);
  await store.set('lz:fake-prod:platform:secret-access-key', SK);
  return { ws, store };
}

/** Probe that reads the token response body, as real drivers do (the OTC driver reads the catalogue from it). */
function readingProbe(result = VERIFIED) {
  return async (ctx: ScopeCtx) => {
    const r = await ctx.http.fetch(`${ctx.http.baseUrls['iam']}/v3/auth/tokens`, { method: 'POST', body: '{}' });
    await r.text();
    return result;
  };
}

const TOKEN_URL = /\/v3\/auth\/tokens$/;

describe('each evidence source alone sets meta.simulated (Design 121 section 10, item 1)', () => {
  it('no evidence: a real-looking run has no meta.simulated', async () => {
    registerLiveLzDriver(makeFakeDriver(readingProbe()));
    const { ws, store } = await workspace();
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl: makeTransport([]) });
    expect(out.results[0]?.scan?.meta.simulated).toBeUndefined();
    expect(out.results[0]?.simulated).toBeUndefined();
  });

  it('the X-SWAO-Mock-CSP response header alone, with scenario and fidelity', async () => {
    registerLiveLzDriver(makeFakeDriver(readingProbe()));
    const { ws, store } = await workspace();
    const fetchImpl = makeTransport([], () => ({ status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json', [MOCK_CSP_RESPONSE_HEADER]: 'fakecsp/minimal-roles/conformed' } }));
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl });
    expect(out.results[0]?.scan?.meta.simulated).toEqual({ scenario: 'minimal-roles', fidelity: 'conformed', evidence: ['header'] });
  });

  it('the swao_mock token claim alone', async () => {
    registerLiveLzDriver(makeFakeDriver(readingProbe()));
    const { ws, store } = await workspace();
    const fetchImpl = makeTransport([], (url) => ({ status: TOKEN_URL.test(url) ? 201 : 200, body: TOKEN_URL.test(url) ? '{"token":{"swao_mock":true,"roles":[]}}' : '{"ok":true}' }));
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl });
    expect(out.results[0]?.scan?.meta.simulated).toEqual({ evidence: ['token_claim'] });
  });

  it('an endpoint override alone', async () => {
    registerLiveLzDriver(makeFakeDriver(readingProbe()));
    const { ws, store } = await workspace();
    const file = join(tempDir('swao-lz-sim-ep-'), 'endpoints.json');
    writeFileSync(file, JSON.stringify({ fakecsp: { iam: 'https://127.0.0.1:9443' } }));
    const calls: WireCall[] = [];
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: { [MOCK_ENDPOINTS_ENV]: file }, fetchImpl: makeTransport(calls) });
    expect(calls[0]?.url.startsWith('https://127.0.0.1:9443/')).toBe(true);
    expect(out.results[0]?.scan?.meta.simulated).toEqual({ evidence: ['endpoint_override'] });
  });

  it('a scope refused by the read-only gate still reports its evidence (for the manifest)', async () => {
    registerLiveLzDriver(makeFakeDriver(readingProbe(REFUSED)));
    const { ws, store } = await workspace();
    const fetchImpl = makeTransport([], () => ({ status: 200, body: '{}', headers: { [MOCK_CSP_RESPONSE_HEADER]: 'fakecsp/admin-only/spec-derived' } }));
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl });
    expect(out.results[0]?.scan).toBeUndefined();
    expect(out.results[0]?.simulated).toEqual({ scenario: 'admin-only', fidelity: 'spec-derived', evidence: ['header'] });
  });
});

describe('evidence parsing', () => {
  it('parseMockCspHeader takes scenario and fidelity; malformed parts are dropped', () => {
    expect(parseMockCspHeader('otc/full-reader/recorded')).toEqual({ scenario: 'full-reader', fidelity: 'recorded' });
    expect(parseMockCspHeader('otc/full-reader/invented')).toEqual({ scenario: 'full-reader' });
    expect(parseMockCspHeader('garbage')).toEqual({});
    expect(parseMockCspHeader('otc/../recorded')).toEqual({ fidelity: 'recorded' });
    expect(parseMockCspHeader('otc/a/b/recorded')).toEqual({});
  });

  it('a malformed header value still marks the run', () => {
    const e = new SimulationEvidence();
    e.observeHeader('garbage');
    expect(e.result()).toEqual({ evidence: ['header'] });
    const none = new SimulationEvidence();
    none.observeHeader(null);
    none.observeHeader('  ');
    expect(none.result()).toBeUndefined();
  });

  it('hasSwaoMockClaim: root, token object, JWT access_token; never a substring or a false claim', () => {
    const jwt = (payload: unknown): string => ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
    expect(hasSwaoMockClaim('{"swao_mock":true}')).toBe(true);
    expect(hasSwaoMockClaim('{"token":{"swao_mock":true}}')).toBe(true);
    expect(hasSwaoMockClaim(JSON.stringify({ access_token: jwt({ tid: 't', swao_mock: true }) }))).toBe(true);
    expect(hasSwaoMockClaim(JSON.stringify({ access_token: jwt({ tid: 't' }) }))).toBe(false);
    expect(hasSwaoMockClaim('{"token":{"swao_mock":false}}')).toBe(false);
    expect(hasSwaoMockClaim('{"resources":[{"name":"swao_mock"}]}')).toBe(false);
    expect(hasSwaoMockClaim('<xml swao_mock="true"/>')).toBe(false);
    expect(hasSwaoMockClaim('{not json')).toBe(false);
  });

  it('the evidence fetch reads the body once and hands the same text to repeated reads', async () => {
    let reads = 0;
    const inner: FetchLike = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => { reads += 1; return '{"swao_mock":true}'; } });
    const e = new SimulationEvidence();
    const res = await createSimulationEvidenceFetch(inner, e)('https://x.example/');
    expect(await res.text()).toBe('{"swao_mock":true}');
    expect(await res.text()).toBe('{"swao_mock":true}');
    expect(reads).toBe(1);
    expect(e.result()).toEqual({ evidence: ['token_claim'] });
  });

  it('evidence kinds are listed in a stable order', () => {
    const e = new SimulationEvidence();
    e.markEndpointOverride();
    e.observeBody('{"swao_mock":true}');
    e.observeHeader('p/s/conformed');
    expect(e.result()?.evidence).toEqual(['header', 'token_claim', 'endpoint_override']);
  });
});

describe('the mark reaches the merged view and the run manifest (Design 121 section 10, item 2)', () => {
  it('mergeLzLiveScopes copies meta.simulated onto the scope entry, stale scopes included', () => {
    const scan = (scope: string, observed: string, simulated?: LzLiveScan['meta']['simulated']): LzLiveScan => ({
      provider: 'fakecsp', collection_mode: 'live', confidence: 'observed', scanned_at: observed, regions: [], enabled_services: [], guardrails: [], quotas: [],
      meta: { lz_id: 'fake-prod', provider: 'fakecsp', scope_id: scope, scope_kind: 'platform', observed_at: observed, driver_version: '0', read_only: 'verified', read_only_overrides: [], coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [], ...(simulated ? { simulated } : {}) },
      offering: { regions: [], services: [] },
      estate: { resources: [], workloads: [], guardrails: [], quotas: [], checks: [] },
      diff: { new: [], removed: [], status_changes: [] },
    }) as unknown as LzLiveScan;
    const merged = mergeLzLiveScopes({
      lzId: 'fake-prod', provider: 'fakecsp', now: new Date('2026-11-03T00:00:00Z'),
      scans: [scan('platform', '2026-11-02T00:00:00Z', { scenario: 'demo', evidence: ['header'] }), scan('app-a', '2026-10-01T00:00:00Z', { evidence: ['endpoint_override'] }), scan('app-b', '2026-11-02T00:00:00Z')],
    });
    const byId = Object.fromEntries(merged.scopes.map((s) => [s.scope_id, s]));
    expect(byId['platform']).toMatchObject({ status: 'merged', simulated: { scenario: 'demo', evidence: ['header'] } });
    expect(byId['app-a']).toMatchObject({ status: 'stale', simulated: { evidence: ['endpoint_override'] } });
    expect(byId['app-b']?.simulated).toBeUndefined();
  });

  it('manifest.json carries simulated per scope and a run-level flag; a real run has false', async () => {
    registerLiveLzDriver(makeFakeDriver(readingProbe()));
    const { ws, store } = await workspace();
    const dir = join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'bsi-c5');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'framework-meta.yaml'), 'framework:\n  id: BSI_C5\n  name: "BSI C5 test"\n  version: "2020"\n');
    writeFileSync(join(dir, 'controls.yaml'), 'regime_meta:\n  id: BSI_C5\n  version: "2020"\ncontrols: []\n');
    writeFileSync(join(dir, 'service-controls.yaml'), 'schema_version: "0.1"\nframework: BSI_C5\nmappings: []\n');
    const simFetch = makeTransport([], () => ({ status: 200, body: '{}', headers: { [MOCK_CSP_RESPONSE_HEADER]: 'fakecsp/demo/spec-derived' } }));
    const lines: string[] = [];
    const sim = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'fake-prod', frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: simFetch, now: () => new Date('2026-11-03T08:00:00Z'), progress: (l) => lines.push(l) });
    expect(lines).toContain('scope platform: simulated environment (mock CSP; scenario demo; fidelity spec-derived; evidence header)');
    const { readFileSync } = await import('node:fs');
    const m = JSON.parse(readFileSync(join(sim.runDir, 'manifest.json'), 'utf-8')) as { simulated: boolean; scopes: Array<Record<string, unknown>> };
    expect(m.simulated).toBe(true);
    expect(m.scopes[0]?.['simulated']).toEqual({ scenario: 'demo', fidelity: 'spec-derived', evidence: ['header'] });
    const real = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'fake-prod', frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: makeTransport([]), now: () => new Date('2026-11-03T09:00:00Z') });
    const rm = JSON.parse(readFileSync(join(real.runDir, 'manifest.json'), 'utf-8')) as { simulated: boolean; scopes: Array<Record<string, unknown>> };
    expect(rm.simulated).toBe(false);
    expect(rm.scopes[0]?.['simulated']).toBeUndefined();
    expect(simulatedScopesOfRun(sim.runDir).map((s) => s.scope_id)).toEqual(['platform']);
    expect(simulatedScopesOfRun(real.runDir)).toEqual([]);
  }, 30_000);
});

describe('consumers (Design 121 section 10, items 4 and 5)', () => {
  function runDir(files: Record<string, unknown>): string {
    const d = tempDir('swao-lz-sim-run-');
    for (const [name, doc] of Object.entries(files)) writeFileSync(join(d, name), JSON.stringify(doc));
    return d;
  }

  it('assertLzLiveRunNotSimulated passes a clean run and refuses a simulated scan with exit code 1', () => {
    expect(() => assertLzLiveRunNotSimulated(runDir({ 'manifest.json': { scopes: [{ scope_id: 'platform' }] } }))).not.toThrow();
    const dir = runDir({ 'manifest.json': { scopes: [{ scope_id: 'platform', simulated: { scenario: 'demo', fidelity: 'conformed', evidence: ['header'] } }] } });
    let caught: unknown;
    try { assertLzLiveRunNotSimulated(dir); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(SimulatedRunError);
    expect((caught as SimulatedRunError).exitCode).toBe(1);
    expect((caught as Error).message).toMatch(/simulated scope\(s\): platform \(demo, conformed\)/);
    expect((caught as Error).message).toMatch(/never updates an LZ catalogue/);
  });

  it('a malformed simulated entry in the manifest is not evidence', () => {
    expect(simulatedScopesOfRun(runDir({ 'manifest.json': { scopes: [{ scope_id: 'platform', simulated: { evidence: [] } }] } }))).toEqual([]);
    expect(simulatedScopesOfRun(join(tmpdir(), 'swao-lz-sim-no-such-run'))).toEqual([]);
  });

  it('splitSimulatedScopes excludes simulated scopes unless included', () => {
    const scopes = [{ scope_id: 'a' }, { scope_id: 'b', simulated: { evidence: ['header' as const] } }];
    expect(splitSimulatedScopes(scopes, false)).toEqual({ included: [scopes[0]], excluded: [scopes[1]] });
    expect(splitSimulatedScopes(scopes, true)).toEqual({ included: scopes, excluded: [] });
  });
});
