// #4128 BC-03 (Design 123 section 17.3.1): the hidden `swao lz baseline-impact`
// re-evaluates the stored scans of a run with the current and the candidate
// baseline values. OTC mock run with the shipped baseline; synthetic ids only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CredentialStore, LicenseTierError, LzBaselineResultSchema } from '@swao/core';
import { runLzLiveAssessment } from '../assess.js';
import { lzBaselineImpactAction } from '../cli.js';
import { parseBaselineImpactChanges, runLzBaselineImpact } from '../baseline-impact.js';
import { registerBuiltInLiveLzDrivers, UNVERIFIED_DRIVERS_ENV } from '../builtin.js';
import { unregisterLiveLzDriver } from '../registry.js';
import { READONLY_ROLE, makeOtcMock } from '../otc/__tests__/otc-mock.js';

const SHIPPED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'community-frameworks', 'frameworks', 'client-lz-policy-baseline');
const META = (sov: string) => `framework:\n  id: BSI_C5\n  name: "BSI C5 test"\n  version: "2020"\n${sov}`;
const CONTROLS = 'regime_meta:\n  id: BSI_C5\n  version: "2020"\ncontrols: []\n';
const RUN = '2026-11-08T08-00-00';

const tmp: string[] = [];
const tempDir = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); tmp.push(d); return d; };
beforeEach(() => { unregisterLiveLzDriver(); registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'otc' }); });
afterEach(() => { unregisterLiveLzDriver(); for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A workspace with one OTC scope, BSI C5 (optionally with a sovereignty block) and the shipped baseline, after one live run. */
async function assessed(opts: { bsiSovereignty?: string } = {}): Promise<{ ws: string; runDir: string }> {
  const ws = tempDir('swao-4128-impact-');
  writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: otc-test', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token', '        regions: [eu-de, eu-nl]', ''].join('\n'));
  const bsi = join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'bsi-c5');
  mkdirSync(bsi, { recursive: true });
  writeFileSync(join(bsi, 'framework-meta.yaml'), META(opts.bsiSovereignty ?? ''));
  writeFileSync(join(bsi, 'controls.yaml'), CONTROLS);
  cpSync(SHIPPED, join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'client-lz-policy-baseline'), { recursive: true });
  const store = new CredentialStore(tempDir('swao-4128-vault-'));
  await store.set('lz:otc-test:platform:username', 'mock-user');
  await store.set('lz:otc-test:platform:password', 'mock-pass-value');
  await store.set('lz:otc-test:platform:domain', 'MOCK-DOMAIN');
  // One server in eu-de (DE) and one in eu-nl (NL): Germany-only residency fails on eu-nl.
  const mock = makeOtcMock({ roles: [READONLY_ROLE], resourcesPages: [[
    { id: 'res-de-1', provider: 'ecs', type: 'cloudservers', region_id: 'eu-de' },
    { id: 'res-nl-1', provider: 'ecs', type: 'cloudservers', region_id: 'eu-nl' },
  ]] });
  const out = await runLzLiveAssessment({ workspaceRoot: ws, lzId: 'otc-test', frameworks: 'BSI_C5,CLIENT_LZ_POLICY_BASELINE', checks: [], store, env: {}, fetchImpl: mock.fetch, now: () => new Date('2026-11-08T08:00:00Z') });
  expect(out.status).toBe('complete');
  return { ws, runDir: out.runDir };
}

const stored = (runDir: string) => LzBaselineResultSchema.parse(JSON.parse(readFileSync(join(runDir, 'otc-test.platform.lz-baseline.json'), 'utf-8')));

describe('swao lz baseline-impact (#4128 BC-03)', () => {
  it('the current-value counts equal the stored lz-baseline result of the run, labelled as a re-evaluation', async () => {
    const { ws, runDir } = await assessed();
    const r = runLzBaselineImpact({ workspaceRoot: ws, lzId: 'otc-test', framework: 'CLIENT_LZ_POLICY_BASELINE', changes: [{ policy_id: 'CPB-LOG-02', params: { min_days: 365 } }] });
    const res = stored(runDir);
    const counts = { pass: 0, fail: 0, warn: 0, unverified: 0, na: 0 };
    for (const p of res.policies) counts[p.estate]++;
    expect(r.run_id).toBe(RUN);
    expect(r.scopes).toHaveLength(1);
    expect(r.scopes[0]!.current).toEqual(counts);
    expect(r.scopes[0]!.overall_current).toBe(res.overall);
    expect(r.label).toBe(`re-evaluated from the stored scan of run ${RUN}, not a new live read`);
    expect(r.run_baseline).toMatchObject({ framework: 'CLIENT_LZ_POLICY_BASELINE', same: true });
    expect(r.notes).toEqual([]);
  }, 30_000);

  it('a residency candidate changes the scopes it decides: the baseline\'s own residency reaches the D-11 union', async () => {
    const { ws, runDir } = await assessed();
    expect(stored(runDir).policies.find((p) => p.id === 'CPB-RES-01')?.estate).toBe('fail');
    const r = runLzBaselineImpact({ workspaceRoot: ws, lzId: 'otc-test', framework: 'CLIENT_LZ_POLICY_BASELINE', changes: [{ policy_id: 'CPB-RES-01', params: { allowed_countries: ['DE', 'NL'] } }] });
    const pol = r.policies[0]!;
    expect(pol.changed_scopes).toEqual([{ scope_id: 'platform', from: 'fail', to: 'pass' }]);
    expect(pol.current.fail).toBe(1);
    expect(pol.candidate.pass).toBe(1);
    expect(pol.offering[0]).toMatchObject({ scope_id: 'platform', candidate: 'READY' });
    // Disabling the policy removes it from the evaluation.
    const off = runLzBaselineImpact({ workspaceRoot: ws, lzId: 'otc-test', framework: 'CLIENT_LZ_POLICY_BASELINE', changes: [{ policy_id: 'CPB-RES-01', state: 'disabled' }] });
    expect(off.policies[0]!.changed_scopes).toEqual([{ scope_id: 'platform', from: 'fail', to: 'not_evaluated' }]);
  }, 30_000);

  it('the union note names another framework that widens the residency value', async () => {
    const { ws } = await assessed({ bsiSovereignty: '  sovereignty_requirements:\n    require_residency_country: [NL]\n' });
    const r = runLzBaselineImpact({ workspaceRoot: ws, lzId: 'otc-test', framework: 'CLIENT_LZ_POLICY_BASELINE', changes: [{ policy_id: 'CPB-RES-01', params: { allowed_countries: ['DE'] }, rationale: 'Germany only' }] });
    expect(r.policies[0]!.notes).toContain('the union with BSI_C5 also accepts NL; the candidate value does not decide alone');
  }, 30_000);

  it('an unverified policy gets the no-live-effect note, never a pass', async () => {
    const { ws } = await assessed();
    const r = runLzBaselineImpact({ workspaceRoot: ws, lzId: 'otc-test', framework: 'CLIENT_LZ_POLICY_BASELINE', changes: [{ policy_id: 'CPB-PRT-01', state: 'enabled', rationale: 'exit plan required' }] });
    const pol = r.policies[0]!;
    expect(pol.candidate.pass).toBe(0);
    expect(pol.candidate.unverified).toBe(1);
    expect(pol.notes[0]).toMatch(/^no live effect measurable in 1 scope \(observability not_observable\)/);
  }, 30_000);

  it('says when the run measured another baseline version (sha256)', async () => {
    const { ws } = await assessed();
    const file = join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'client-lz-policy-baseline', 'policy-baseline.yaml');
    writeFileSync(file, readFileSync(file, 'utf-8').replace('min_days: 180', 'min_days: 200'));
    const r = runLzBaselineImpact({ workspaceRoot: ws, lzId: 'otc-test', framework: 'CLIENT_LZ_POLICY_BASELINE', changes: [{ policy_id: 'CPB-LOG-02', params: { min_days: 365 } }] });
    expect(r.run_baseline?.same).toBe(false);
    expect(r.notes[0]).toMatch(/^the run measured baseline CLIENT_LZ_POLICY_BASELINE \(sha256 [0-9a-f]{12}\), not the current file/);
  }, 30_000);

  it('the JSON output carries no detail text and no native resource id', async () => {
    const { ws } = await assessed();
    const out: string[] = [];
    const err: string[] = [];
    const code = lzBaselineImpactAction('otc-test', { framework: 'CLIENT_LZ_POLICY_BASELINE', changes: JSON.stringify([{ policy_id: 'CPB-RES-01', params: { allowed_countries: ['EU'] } }]), json: true }, { cwd: ws, out: (l) => out.push(l), err: (l) => err.push(l), guard: { requireFeature: () => undefined } });
    expect(err).toEqual([]);
    expect(code).toBe(0);
    const text = out.join('\n');
    expect(JSON.parse(text).schema).toBe('lz-baseline-impact/1');
    expect(text).not.toContain('"detail"');
    expect(text).not.toContain('res-nl-1');
    expect(text).not.toContain('res-de-1');
  }, 30_000);

  it('refuses input errors and is gated like swao lz scan', async () => {
    const { ws } = await assessed();
    const err: string[] = [];
    const deps = { cwd: ws, out: () => undefined, err: (l: string) => err.push(l), guard: { requireFeature: () => undefined } };
    expect(lzBaselineImpactAction('otc-test', { framework: 'BSI_C5', changes: '[{"policy_id":"CPB-LOG-02","state":"enabled"}]' }, deps)).toBe(1);
    expect(err.pop()).toMatch(/is not a policy baseline/);
    expect(lzBaselineImpactAction('otc-test', { framework: 'CLIENT_LZ_POLICY_BASELINE', changes: '[{"policy_id":"CPB-ZZZ-01","state":"enabled"}]' }, deps)).toBe(1);
    expect(err.pop()).toMatch(/is not a policy of this baseline/);
    expect(lzBaselineImpactAction('otc-test', { framework: 'CLIENT_LZ_POLICY_BASELINE', changes: 'not json' }, deps)).toBe(1);
    expect(lzBaselineImpactAction('otc-test', { framework: 'CLIENT_LZ_POLICY_BASELINE', changes: '[{"policy_id":"CPB-LOG-02","params":{"min_days":"365"}}]' }, deps)).toBe(1);
    expect(lzBaselineImpactAction('no-such-lz', { framework: 'CLIENT_LZ_POLICY_BASELINE', changes: '[{"policy_id":"CPB-LOG-02","state":"enabled"}]' }, deps)).toBe(1);
    const tier = lzBaselineImpactAction('otc-test', { framework: 'CLIENT_LZ_POLICY_BASELINE', changes: '[]' }, { ...deps, guard: { requireFeature: () => { throw new LicenseTierError('consultant', 'community', 'lz-live-assess'); } } });
    expect(tier).toBe(2);
    expect(() => parseBaselineImpactChanges('[{"policy_id":"CPB-LOG-02","path":"../x"}]')).toThrow(/--changes/);
  }, 60_000);
});
