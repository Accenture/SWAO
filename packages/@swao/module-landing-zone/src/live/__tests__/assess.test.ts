// #3766: Landing Zone Live Assessment runner and run writer (Design 120
// sections 7.4, 11.1, 13.2, 14.3) on the OTC mock. Synthetic fixtures only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { CredentialStore, LicenseTierError, LzBaselineResultSchema, LzLiveMergedSchema, LzLiveScanSchema, LzOrganisationalResultSchema, parseLzCatalogue, readLzEvidenceMap } from '@swao/core';
import { runLzLiveAssessment, lzLiveRunId } from '../assess.js';
import { lzLiveAssessAction } from '../cli.js';
import { registerBuiltInLiveLzDrivers, UNVERIFIED_DRIVERS_ENV } from '../builtin.js';
import { unregisterLiveLzDriver } from '../registry.js';
import { ADMIN_ROLE, READONLY_ROLE, makeOtcMock } from '../otc/__tests__/otc-mock.js';
import type { MockOptions } from '../otc/__tests__/otc-mock.js';

const META = 'framework:\n  id: BSI_C5\n  name: "BSI C5 test"\n  version: "2020"\n';
const CONTROLS = 'regime_meta:\n  id: BSI_C5\n  version: "2020"\ncontrols: []\n';
const MAPPING = 'schema_version: "0.1"\nframework: BSI_C5\nmappings:\n  - capability: vm_compute\n    controls: [OPS-01]\n    relevance: configure\n    confidence: curated\n';

const tmp: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}
beforeEach(() => { unregisterLiveLzDriver(); registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'otc' }); });
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SCOPE = (id: string, kind: string): string[] => [`      - id: ${id}`, `        kind: ${kind}`, '        auth: iam-password-token', '        regions: [eu-de, eu-nl]'];

async function harness(opts: { scopes?: string[][]; framework?: boolean; assessment?: string } = {}): Promise<{ ws: string; store: CredentialStore }> {
  const ws = tempDir('swao-lzl-assess-');
  const scopes = opts.scopes ?? [SCOPE('platform', 'platform')];
  writeFileSync(join(ws, '.swao.yml'), ['name: demo', ...(opts.assessment ? [opts.assessment] : []), 'landing_zones:', '  - id: otc-test', '    provider: otc', '    scopes:', ...scopes.flat(), ''].join('\n'));
  if (opts.framework !== false) {
    const dir = join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'bsi-c5');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'framework-meta.yaml'), META);
    writeFileSync(join(dir, 'controls.yaml'), CONTROLS);
    writeFileSync(join(dir, 'service-controls.yaml'), MAPPING);
  }
  const store = new CredentialStore(tempDir('swao-lzl-assess-vault-'));
  for (const sc of scopes) {
    const id = sc[0]!.replace('      - id: ', '');
    await store.set(`lz:otc-test:${id}:username`, 'mock-user');
    await store.set(`lz:otc-test:${id}:password`, 'mock-pass-value');
    await store.set(`lz:otc-test:${id}:domain`, 'MOCK-DOMAIN');
  }
  return { ws, store };
}

const at = (iso: string) => () => new Date(iso);

describe('runLzLiveAssessment (#3766)', () => {
  it('writes the section 7.4 run folder: scan, merged view, live catalogue, manifest, run status and the latest pointer', async () => {
    const { ws, store } = await harness();
    const mock = makeOtcMock({ roles: [READONLY_ROLE] });
    const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: mock.fetch, now: at('2026-11-03T08:00:00.123Z'), swaoVersion: '9.9.9' });
    expect(out).toMatchObject({ status: 'complete', exitCode: 0, runId: '2026-11-03T08-00-00' });
    const runDir = join(ws, 'landing-zones', 'otc-test', 'wsp', 'runs', '2026-11-03T08-00-00');
    expect(out.runDir).toBe(runDir);
    expect(readdirSync(runDir).sort()).toEqual(['evidence-refs.json', 'lz-live-catalogue.json', 'lz-live-merged.yaml', 'manifest.json', 'otc-test.platform.lz-live-scan.json', 'run-status.json']);
    const scan = LzLiveScanSchema.parse(JSON.parse(readFileSync(join(runDir, 'otc-test.platform.lz-live-scan.json'), 'utf-8')));
    expect(scan.meta.frameworks.map((f) => f.id)).toEqual(['BSI_C5']);
    expect(scan.offering.services.some((s) => Object.keys(s.frameworks).includes('BSI_C5'))).toBe(true);
    expect(LzLiveMergedSchema.parse(yamlLoad(readFileSync(join(runDir, 'lz-live-merged.yaml'), 'utf-8'))).scopes[0]).toMatchObject({ scope_id: 'platform', status: 'merged' });
    expect(parseLzCatalogue(JSON.parse(readFileSync(join(runDir, 'lz-live-catalogue.json'), 'utf-8'))).meta.source.mode).toBe('live-api');
    const manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf-8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({ lz_id: 'otc-test', provider: 'otc', run_id: '2026-11-03T08-00-00', swao_version: '9.9.9', scopes: [{ scope_id: 'platform', kind: 'platform', read_only: 'verified', read_only_overrides: [] }] });
    expect((manifest['frameworks'] as Array<{ id: string; sha256: string }>)[0]).toMatchObject({ id: 'BSI_C5' });
    expect(JSON.parse(readFileSync(join(runDir, 'run-status.json'), 'utf-8'))).toEqual({ status: 'complete', scopes: [{ scope_id: 'platform', status: 'complete' }] });
    expect(readFileSync(join(ws, 'landing-zones', 'otc-test', 'wsp', 'latest-lz-live.txt'), 'utf-8').trim()).toBe('2026-11-03T08-00-00');
    expect(existsSync(join(ws, 'landing-zones', 'otc-test', '.raw'))).toBe(false);
  }, 30_000);

  it('diffs against the previous run and carries a scope not run now into the merge (stale when outside the window)', async () => {
    const { ws, store } = await harness({ scopes: [SCOPE('platform', 'platform'), SCOPE('app-a', 'application')] });
    const first = makeOtcMock({ roles: [READONLY_ROLE] });
    await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: first.fetch, now: at('2026-11-01T08:00:00Z') });
    // The crawl stamps the wall clock; age the app-a scan of the first run beyond the window.
    const appFile = join(ws, 'landing-zones', 'otc-test', 'wsp', 'runs', '2026-11-01T08-00-00', 'otc-test.app-a.lz-live-scan.json');
    const aged = JSON.parse(readFileSync(appFile, 'utf-8')) as { meta: { observed_at: string } };
    aged.meta.observed_at = '2026-10-01T00:00:00Z';
    writeFileSync(appFile, JSON.stringify(aged));
    const second = makeOtcMock({ roles: [READONLY_ROLE], resourcesPages: [[{ id: 'res-9', provider: 'ecs', type: 'cloudservers', region_id: 'eu-de' }]] });
    const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', scopeIds: ['platform'], frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: second.fetch, staleDays: 7, now: at('2026-11-03T08:00:00Z') });
    expect(out.status).toBe('complete');
    const scan = LzLiveScanSchema.parse(JSON.parse(readFileSync(join(out.runDir, 'otc-test.platform.lz-live-scan.json'), 'utf-8')));
    expect(scan.diff.previous_run).toBe('2026-11-01T08-00-00');
    expect(scan.diff.new).toContainEqual({ kind: 'resource', ref: 'res-9' });
    const merged = LzLiveMergedSchema.parse(yamlLoad(readFileSync(join(out.runDir, 'lz-live-merged.yaml'), 'utf-8')));
    expect(merged.scopes.map((s) => [s.scope_id, s.status])).toEqual([['platform', 'merged'], ['app-a', 'stale']]);
    expect(JSON.parse(readFileSync(join(out.runDir, 'manifest.json'), 'utf-8'))).toMatchObject({ previous_run: '2026-11-01T08-00-00' });
  }, 30_000);

  it('a refused scope is skipped and logged: the run closes partial with exit 1; refused everywhere closes failed and keeps the pointer', async () => {
    const { ws, store } = await harness({ scopes: [SCOPE('platform', 'platform'), SCOPE('app-a', 'application')] });
    // Route the admin role to app-a only: the mock serves one role set for all, so run the scopes separately.
    const ok = makeOtcMock({ roles: [READONLY_ROLE] });
    await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', scopeIds: ['platform'], frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: ok.fetch, now: at('2026-11-02T08:00:00Z') });
    const admin = makeOtcMock({ roles: [ADMIN_ROLE] } satisfies MockOptions);
    const failed = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: admin.fetch, now: at('2026-11-03T08:00:00Z') });
    expect(failed).toMatchObject({ status: 'failed', exitCode: 1 });
    expect(failed.scopes.map((s) => s.status)).toEqual(['refused', 'refused']);
    expect(JSON.parse(readFileSync(join(failed.runDir, 'run-status.json'), 'utf-8')).status).toBe('failed');
    expect(readdirSync(failed.runDir).sort()).toEqual(['manifest.json', 'run-status.json']);
    expect(readFileSync(join(ws, 'landing-zones', 'otc-test', 'wsp', 'latest-lz-live.txt'), 'utf-8').trim()).toBe('2026-11-02T08-00-00');
    // Accepting the write-capable credential for this run proceeds and stamps the override.
    const accepted = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', scopeIds: ['platform'], frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: admin.fetch, acceptWriteCapableCredentials: true, now: at('2026-11-03T09:00:00Z') });
    expect(accepted.status).toBe('complete');
    const scan = LzLiveScanSchema.parse(JSON.parse(readFileSync(join(accepted.runDir, 'otc-test.platform.lz-live-scan.json'), 'utf-8')));
    expect(scan.meta.read_only_overrides).toEqual(['accept-write-capable-credentials']);
  }, 30_000);

  it('a scope failing mid-crawl does not stop the others: partial', async () => {
    const { ws, store } = await harness({ scopes: [SCOPE('platform', 'platform'), SCOPE('app-a', 'application')] });
    await store.set('lz:otc-test:app-a:password', '');
    const mock = makeOtcMock({ roles: [READONLY_ROLE] });
    const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: mock.fetch, now: at('2026-11-03T08:00:00Z') });
    expect(out.status).toBe('partial');
    expect(out.exitCode).toBe(1);
    expect(out.scopes.find((s) => s.scope_id === 'app-a')?.status).toBe('failed');
    expect(readdirSync(out.runDir)).toContain('otc-test.platform.lz-live-scan.json');
  }, 30_000);

  it('framework selection: assessment.frameworks fallback; none, or one not installed, is refused before any request', async () => {
    const { ws, store } = await harness({ assessment: 'assessment:\n  frameworks: [BSI_C5]' });
    const mock = makeOtcMock({ roles: [READONLY_ROLE] });
    const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', checks: [], store, env: {}, fetchImpl: mock.fetch, now: at('2026-11-03T08:00:00Z') });
    expect(out.status).toBe('complete');
    const bare = await harness({ framework: false });
    const quiet = makeOtcMock({ roles: [READONLY_ROLE] });
    await expect(runLzLiveAssessment({ workspaceRoot: bare.ws, lzId: 'otc-test', checks: [], store: bare.store, env: {}, fetchImpl: quiet.fetch })).rejects.toThrow(/at least one community framework/);
    await expect(runLzLiveAssessment({ workspaceRoot: bare.ws, lzId: 'otc-test', frameworks: 'GDPR', checks: [], store: bare.store, env: {}, fetchImpl: quiet.fetch })).rejects.toThrow(/not installed.*GDPR/);
    await expect(runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', scopeIds: ['nope'], frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: quiet.fetch })).rejects.toThrow(/no scope nope/);
    expect(quiet.calls).toHaveLength(0);
  }, 30_000);

  it('lzLiveRunId drops the fraction and colons', () => {
    expect(lzLiveRunId(new Date('2026-11-03T08:01:02.999Z'))).toBe('2026-11-03T08-01-02');
  });
});

describe('lzLiveAssessAction (#3766)', () => {
  it('exit 0 and the publish hint on a complete run; exit 2 and the [LICENSE] block under the tier gate (ADR-0055) with no request (#3844)', async () => {
    const { ws, store } = await harness();
    const mock = makeOtcMock({ roles: [READONLY_ROLE] });
    const out: string[] = [];
    const err: string[] = [];
    const deps = { cwd: ws, store, env: {}, fetchImpl: mock.fetch, out: (l: string) => out.push(l), err: (l: string) => err.push(l), guard: { requireFeature: () => undefined }, checks: [] };
    expect(await lzLiveAssessAction('otc-test', { frameworks: 'BSI_C5', scope: ['platform'] }, deps)).toBe(0);
    expect(out.join('\n')).toMatch(/swao publish --lz-live otc-test/);
    const gated = makeOtcMock({ roles: [READONLY_ROLE] });
    // #3844: the real guard error; exit 2 with the [LICENSE] block (LZ_LIVE_TIER_EXIT_CODE).
    const code = await lzLiveAssessAction('otc-test', { frameworks: 'BSI_C5' }, { ...deps, fetchImpl: gated.fetch, guard: { requireFeature: (k: string) => { throw new LicenseTierError('consultant', 'community', k); } } });
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('[LICENSE] swao assess --type landing-zone-live and swao lz scan (Landing Zone Live Assessment) requires a Consultant licence.');
    expect(err.join('\n')).toContain('To upgrade: swao license request --tier consultant');
    expect(gated.calls).toHaveLength(0);
    expect(await lzLiveAssessAction('otc-test', { frameworks: 'BSI_C5', staleDays: '0' }, deps)).toBe(1);
  }, 30_000);
});

// #3871 (Design 123 sections 8 and 9.1): a run with the shipped Client LZ Policy Baseline selected.
describe('runLzLiveAssessment with a client policy baseline (#3871)', () => {
  const SHIPPED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'community-frameworks', 'frameworks', 'client-lz-policy-baseline');
  const install = (ws: string, folder = 'client-lz-policy-baseline'): string => {
    const dir = join(ws, 'wsp', 'inputs', 'catalogs', 'community', folder);
    cpSync(SHIPPED, dir, { recursive: true });
    return dir;
  };

  it('evaluates the baseline: estate checks, meta.baseline, the lz-baseline result file and the manifest block', async () => {
    const { ws, store } = await harness();
    install(ws);
    const mock = makeOtcMock({ roles: [READONLY_ROLE] });
    const lines: string[] = [];
    const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'BSI_C5,CLIENT_LZ_POLICY_BASELINE', checks: [], store, env: {}, fetchImpl: mock.fetch, now: at('2026-11-05T08:00:00Z'), progress: (l) => lines.push(l) });
    expect(out.status).toBe('complete');
    const files = readdirSync(out.runDir);
    expect(files).toContain('otc-test.platform.lz-baseline.json');
    const scan = LzLiveScanSchema.parse(JSON.parse(readFileSync(join(out.runDir, 'otc-test.platform.lz-live-scan.json'), 'utf-8')));
    const result = LzBaselineResultSchema.parse(JSON.parse(readFileSync(join(out.runDir, 'otc-test.platform.lz-baseline.json'), 'utf-8')));
    expect(scan.meta.baseline).toEqual({ framework: 'CLIENT_LZ_POLICY_BASELINE', catalogue_version: '1.0.0', sha256: result.sha256 });
    expect(scan.estate.checks.map((c) => c.id).sort()).toEqual(result.policies.map((p) => p.id).sort());
    expect(result.policies).toHaveLength(17);
    expect(result.disabled).toEqual(['CPB-SVC-01', 'CPB-SVC-02', 'CPB-SVC-03']);
    expect(scan.offering.services.some((s) => Object.keys(s.frameworks).includes('CLIENT_LZ_POLICY_BASELINE'))).toBe(true);
    expect(result.requirement_provenance.find((r) => r.value === 'us_cloud_act')?.frameworks).toEqual(['CLIENT_LZ_POLICY_BASELINE']);
    const manifest = JSON.parse(readFileSync(join(out.runDir, 'manifest.json'), 'utf-8')) as { baseline?: Record<string, unknown>; frameworks: { id: string; files: Record<string, string> }[] };
    expect(manifest.baseline).toEqual({ framework: 'CLIENT_LZ_POLICY_BASELINE', baseline_of: 'CLIENT_LZ_POLICY_BASELINE', catalogue_version: '1.0.0', sha256: result.sha256, results: ['otc-test.platform.lz-baseline.json'] });
    expect(manifest.frameworks.find((f) => f.id === 'CLIENT_LZ_POLICY_BASELINE')?.files['policy-baseline.yaml']).toBe(result.sha256);
    expect(manifest.frameworks.find((f) => f.id === 'BSI_C5')?.files['policy-baseline.yaml']).toBeUndefined();
    expect(lines.some((l) => l.includes('baseline CLIENT_LZ_POLICY_BASELINE'))).toBe(true);
  }, 30_000);

  it('without a baseline nothing changes: no result file, no meta.baseline, no manifest block', async () => {
    const { ws, store } = await harness();
    const mock = makeOtcMock({ roles: [READONLY_ROLE] });
    const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'BSI_C5', checks: [], store, env: {}, fetchImpl: mock.fetch, now: at('2026-11-05T08:00:00Z') });
    expect(readdirSync(out.runDir).some((f) => f.endsWith('.lz-baseline.json'))).toBe(false);
    const scan = LzLiveScanSchema.parse(JSON.parse(readFileSync(join(out.runDir, 'otc-test.platform.lz-live-scan.json'), 'utf-8')));
    expect(scan.meta.baseline).toBeUndefined();
    expect((JSON.parse(readFileSync(join(out.runDir, 'manifest.json'), 'utf-8')) as Record<string, unknown>)['baseline']).toBeUndefined();
  }, 30_000);

  it('refuses an invalid baseline and two baselines before any request', async () => {
    const { ws, store } = await harness();
    const dir = install(ws);
    const second = install(ws, 'client-lz-policy-baseline-high');
    for (const f of ['framework-meta.yaml', 'controls.yaml', 'policy-baseline.yaml', 'service-controls.yaml']) {
      const file = join(second, f);
      writeFileSync(file, readFileSync(file, 'utf-8').replace(/^(\s*(?:id|framework)): CLIENT_LZ_POLICY_BASELINE$/gm, '$1: CLIENT_LZ_POLICY_BASELINE_HIGH'));
    }
    const quiet = makeOtcMock({ roles: [READONLY_ROLE] });
    await expect(runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'CLIENT_LZ_POLICY_BASELINE,CLIENT_LZ_POLICY_BASELINE_HIGH', checks: [], store, env: {}, fetchImpl: quiet.fetch })).rejects.toThrow(/one client policy baseline per run/);
    const file = join(dir, 'policy-baseline.yaml');
    writeFileSync(file, readFileSync(file, 'utf-8').replace('min_days: 180', 'min_days: "180"'));
    await expect(runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'CLIENT_LZ_POLICY_BASELINE', checks: [], store, env: {}, fetchImpl: quiet.fetch })).rejects.toThrow(/policy-baseline.yaml is invalid/);
    expect(quiet.calls).toHaveLength(0);
  }, 30_000);

  it('records what the OTC mock answers per Phase 1 kind', async () => {
    const { ws, store } = await harness();
    install(ws);
    const mock = makeOtcMock({ roles: [READONLY_ROLE] });
    const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'CLIENT_LZ_POLICY_BASELINE', checks: [], store, env: {}, fetchImpl: mock.fetch, now: at('2026-11-05T08:00:00Z') });
    const result = LzBaselineResultSchema.parse(JSON.parse(readFileSync(join(out.runDir, 'otc-test.platform.lz-baseline.json'), 'utf-8')));
    const by = new Map(result.policies.map((p) => [p.id, p] as const));
    // OTC mock: eu-de (DE) and eu-nl (NL) offered, no RMS resources, a CTS system tracker per region.
    expect(by.get('CPB-RES-01')).toMatchObject({ offering: 'READY_WITH_CHANGES', estate: 'na' });
    expect(by.get('CPB-LOG-01')).toMatchObject({ offering: 'READY', estate: 'pass', observability: 'observed' });
    // #3871 posture: the answered ingress block decides (no rule read is no open admin port).
    expect(by.get('CPB-NET-02')).toMatchObject({ estate: 'pass', observability: 'observed' });
    expect(by.get('CPB-PRT-01')).toMatchObject({ estate: 'unverified', observability: 'not_observable' });
    expect(by.get('CPB-COST-01')).toMatchObject({ estate: 'unverified', observability: 'not_observable' });
    // the encryption block answered with no stored resource: na from posture; the offering still comes from the catalogue
    expect(by.get('CPB-ENC-01')).toMatchObject({ estate: 'na', observability: 'observed', offering: 'READY_WITH_CHANGES' });
  }, 30_000);
});

// #4050 (Design 120 section 8.4): organisational controls from the landing zone ingestion folder.
describe('runLzLiveAssessment with the landing zone ingestion folder (#4050)', () => {
  const DORA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'community-frameworks', 'frameworks', 'dora');
  const install = (ws: string): void => { cpSync(DORA, join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'dora'), { recursive: true }); };
  const DOCS = [
    { source: 'ICT-Risk-Management-Framework.md', category: 'compliance', readable: true },
    { source: 'governance/ict_governance_terms_of_reference.md', category: 'compliance', readable: true },
  ];

  it('decides governance controls from the documents, writes lz-organisational.json with references only, and lists the documents in the evidence map', async () => {
    const { ws, store } = await harness();
    install(ws);
    const mock = makeOtcMock({ roles: [READONLY_ROLE] });
    const lines: string[] = [];
    const seen: string[] = [];
    const out = await runLzLiveAssessment({
      workspaceRoot: ws, lzId: 'otc-test', frameworks: 'DORA', checks: [], store, env: {}, fetchImpl: mock.fetch, now: at('2026-11-07T20:00:00Z'), progress: (l) => lines.push(l),
      ingestOrganisationalDocuments: async (lzDir) => { seen.push(lzDir); return DOCS; },
    });
    expect(out.status).toBe('complete');
    expect(seen).toEqual([join(ws, 'landing-zones', 'otc-test')]);
    const raw = readFileSync(join(out.runDir, 'lz-organisational.json'), 'utf-8');
    const result = LzOrganisationalResultSchema.parse(JSON.parse(raw));
    expect(raw).not.toContain('ICT-Risk-Management-Framework.md');
    expect(raw).not.toContain('governance/');
    expect(result.folder).toBe('landing-zones/otc-test/ingestion');
    expect(result.documents).toMatchObject({ total: 2, readable: 2 });
    const dora = result.frameworks.find((f) => f.id === 'DORA')!;
    expect(dora.controls.length).toBeGreaterThan(0);
    // DORA 2.0.0: 35 governance controls, of which the catalogue scopes some to lz; the rest are counted as out of scope.
    expect(dora.controls.length + dora.out_of_scope).toBe(35);
    expect(dora.out_of_scope).toBeGreaterThan(0);
    expect(dora.controls.every((c) => c.outcome !== ('GAP' as string))).toBe(true);
    const decided = dora.controls.filter((c) => c.outcome === 'SATISFIED' || c.outcome === 'PARTIAL');
    expect(decided.length).toBeGreaterThan(0);
    expect(decided.every((c) => c.evidence_refs.every((r) => /^ev:2026-11-07T20-00-00:document:Ref-[0-9a-f]{10}$/.test(r)))).toBe(true);
    expect(decided.some((c) => c.evidence_refs.length > 0)).toBe(true);
    const map = readLzEvidenceMap(out.runDir)!;
    expect(map.entries.filter((e) => e.kind === 'document').map((e) => e.native.id).sort()).toEqual(DOCS.map((d) => d.source).sort());
    expect(map.entries.filter((e) => e.kind === 'document').every((e) => e.console === undefined && !e.title.includes('Framework'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(out.runDir, 'manifest.json'), 'utf-8')) as { organisational?: { file: string; frameworks: { id: string; satisfied: number }[] } };
    expect(manifest.organisational).toMatchObject({ file: 'lz-organisational.json', frameworks: [{ id: 'DORA', satisfied: dora.counts.satisfied }] });
    expect(lines.some((l) => l.startsWith('organisational controls DORA:'))).toBe(true);
  }, 30_000);

  it('without documents the governance controls stay UNKNOWN with a reason naming the folder; without the host step no file is written', async () => {
    const { ws, store } = await harness();
    install(ws);
    const mock = makeOtcMock({ roles: [READONLY_ROLE] });
    const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'DORA', checks: [], store, env: {}, fetchImpl: mock.fetch, now: at('2026-11-07T20:00:00Z'), ingestOrganisationalDocuments: async () => null });
    const result = LzOrganisationalResultSchema.parse(JSON.parse(readFileSync(join(out.runDir, 'lz-organisational.json'), 'utf-8')));
    const dora = result.frameworks[0]!;
    expect(dora.counts.satisfied + dora.counts.partial).toBe(0);
    expect(dora.controls.filter((c) => c.outcome === 'UNKNOWN').every((c) => c.reason === 'no_documents' || c.reason === 'no_expected_input')).toBe(true);
    expect(dora.controls.find((c) => c.reason === 'no_documents')!.rationale).toContain('landing-zones/otc-test/ingestion/');
    const plain = makeOtcMock({ roles: [READONLY_ROLE] });
    const none = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'DORA', checks: [], store, env: {}, fetchImpl: plain.fetch, now: at('2026-11-07T21:00:00Z') });
    expect(existsSync(join(none.runDir, 'lz-organisational.json'))).toBe(false);
  }, 30_000);
});
