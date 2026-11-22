// #3888 (Design 123 section 8.4, D-12): host side of the baseline rule engine.
// The shipped baseline framework is copied into a temporary workspace.
import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appBaselineDecisions, appNeededCapabilities, baselineRequirementProvenance, persistBaselineDecisions, readBaselineDecisions, readLiveBaselineResults, selectedBaselineDenies, selectedPolicyBaselines } from './app-baseline-decisions.js';

const SHIPPED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '@swao', 'community-frameworks', 'frameworks', 'client-lz-policy-baseline');
const FW = 'CLIENT_LZ_POLICY_BASELINE';
const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function ws(): string {
  const root = mkdtempSync(join(tmpdir(), 'swao-app-baseline-'));
  tmp.push(root);
  cpSync(SHIPPED, join(root, 'wsp', 'inputs', 'catalogs', 'community', 'client-lz-policy-baseline'), { recursive: true });
  return root;
}

describe('app baseline decisions, host side (#3888)', () => {
  it('finds the installed baseline among the selected regimes, with the sha256 of its policy-baseline.yaml', () => {
    const root = ws();
    const b = selectedPolicyBaselines(root, [FW, 'GDPR']);
    expect(b.map((x) => x.id)).toEqual([FW]);
    expect(b[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(selectedPolicyBaselines(root, ['GDPR'])).toEqual([]);
  });

  it('the fit denies come from the same selection: every enabled service_deny capability names its policy (D-12)', () => {
    const root = ws();
    const denies = selectedBaselineDenies(selectedPolicyBaselines(root, [FW]));
    const enabledDeny = selectedPolicyBaselines(root, [FW])[0]!.baseline.policies.filter((p) => p.kind === 'service_deny' && p.state === 'enabled');
    if (enabledDeny.length === 0) expect(denies).toBeUndefined();
    else for (const p of enabledDeny) for (const c of (p.params as { capabilities?: string[] }).capabilities ?? []) expect(denies?.get(c)).toBeDefined();
  });

  it('needs are undefined when the run has no signals yet', () => {
    const root = ws();
    const app = join(root, 'apps', 'a');
    const passes = join(app, 'wsp', 'runs', 'r', 'passes');
    mkdirSync(passes, { recursive: true });
    expect(appNeededCapabilities(app, passes)).toBeUndefined();
  });

  it('source none: no decisions and the reason; catalogue: one decision per policy control; residency without facts UNKNOWN', () => {
    const root = ws();
    const baselines = selectedPolicyBaselines(root, [FW]);
    expect(appBaselineDecisions({ workspaceRoot: root, baselines, needs: [], source: { kind: 'none', reason: 'the inline LZ fit is off (--no-lz-fit)' } })).toEqual({ source: 'none', regimes: {}, reason: 'the inline LZ fit is off (--no-lz-fit)' });
    const d = appBaselineDecisions({ workspaceRoot: root, baselines, needs: undefined, source: { kind: 'catalogue', targets: [{ provider: 'otc', region: 'no-such-region' }] } });
    const controls = d.regimes[FW]!;
    expect(Object.keys(controls).sort()).toEqual(baselines[0]!.baseline.policies.map((p) => p.control).sort());
    for (const v of Object.values(controls)) expect(v.rationale).toMatch(/no LLM evaluation/);
    const res = baselines[0]!.baseline.policies.find((p) => p.kind === 'region_residency' && p.state === 'enabled');
    if (res) expect(controls[res.control]!.outcome).toBe('UNKNOWN');
  });

  it('live: reads the run baseline results of the used scopes and reuses them only for the same sha256', () => {
    const root = ws();
    const baselines = selectedPolicyBaselines(root, [FW]);
    const b = baselines[0]!;
    const audit = b.baseline.policies.find((p) => p.kind === 'audit_trail' && p.state === 'enabled');
    const runDir = join(root, 'landing-zones', 'lz-a', 'wsp', 'runs', 'r1');
    mkdirSync(runDir, { recursive: true });
    const doc = (scope: string, sha: string) => ({
      schema: 'lz-baseline-result/1', lz_id: 'lz-a', scope_id: scope, provider: 'otc', framework: FW, baseline_of: FW, catalogue_version: b.baseline.catalogue_version, sha256: sha, overall: 'READY',
      policies: audit ? [{ id: audit.id, kind: 'audit_trail', category: audit.category, control: audit.control, severity: 'warning', offering: 'READY', estate: 'pass', observability: 'observed', detail: 'x' }] : [],
      not_reviewed: [], disabled: [],
    });
    writeFileSync(join(runDir, 'lz-a.platform.lz-baseline.json'), JSON.stringify(doc('platform', b.sha256)));
    writeFileSync(join(runDir, 'lz-a.app.lz-baseline.json'), JSON.stringify(doc('app', 'f'.repeat(64))));
    expect(readLiveBaselineResults(root, 'lz-a', 'r1', ['platform']).map((r) => r.scope_id)).toEqual(['platform']);
    expect(readLiveBaselineResults(root, 'lz-a', 'r1', []).length).toBe(2);
    const d = appBaselineDecisions({ workspaceRoot: root, baselines, needs: [], source: { kind: 'live', lzId: 'lz-a', runId: 'r1', scopes: ['platform'], stale: false } });
    if (audit) expect(d.regimes[FW]![audit.control]!.outcome).toBe('SATISFIED');
    const other = appBaselineDecisions({ workspaceRoot: root, baselines, needs: [], source: { kind: 'live', lzId: 'lz-a', runId: 'r1', scopes: ['app'], stale: false } });
    if (audit) expect(other.regimes[FW]![audit.control]!.rationale).toMatch(/another baseline version/);
  });
});

describe('baseline decisions persisted in the app run (#3981)', () => {
  function liveWs() {
    const root = ws();
    const baselines = selectedPolicyBaselines(root, [FW]);
    const b = baselines[0]!;
    const audit = b.baseline.policies.find((p) => p.kind === 'audit_trail' && p.state === 'enabled')!;
    const runDir = join(root, 'landing-zones', 'lz-a', 'wsp', 'runs', 'r1');
    mkdirSync(runDir, { recursive: true });
    const doc = (scope: string, estate: string) => ({
      schema: 'lz-baseline-result/1', lz_id: 'lz-a', scope_id: scope, provider: 'otc', framework: FW, baseline_of: FW, catalogue_version: b.baseline.catalogue_version, sha256: b.sha256, overall: 'READY',
      policies: [{ id: audit.id, kind: 'audit_trail', category: audit.category, control: audit.control, severity: 'warning', offering: 'READY', estate, observability: 'observed', detail: `audit ${estate}` }],
      not_reviewed: [], disabled: [],
    });
    writeFileSync(join(runDir, 'lz-a.platform.lz-baseline.json'), JSON.stringify(doc('platform', 'pass')));
    writeFileSync(join(runDir, 'lz-a.app.lz-baseline.json'), JSON.stringify(doc('app', 'fail')));
    return { root, baselines, audit };
  }

  it('two live scopes: ranked contributions per control; persisted and read back unchanged', () => {
    const { root, baselines, audit } = liveWs();
    const d = appBaselineDecisions({ workspaceRoot: root, baselines, needs: [], source: { kind: 'live', lzId: 'lz-a', runId: 'r1', scopes: ['platform', 'app'], stale: false } });
    const ctl = d.regimes[FW]![audit.control]!;
    expect(ctl.outcome).toBe('GAP');
    expect(ctl.contributions?.map((c) => [c.scope_id, c.outcome])).toEqual([['app', 'GAP'], ['platform', 'SATISFIED']]);
    const appRun = join(root, 'apps', 'demo', 'wsp', 'runs', 't1');
    const part = persistBaselineDecisions(appRun, { baselineDecisions: d });
    expect(part.baselineDecisions).toBe(d);
    expect(existsSync(join(appRun, 'baseline-decisions.json'))).toBe(true);
    expect(readBaselineDecisions(appRun)).toEqual(d);
  });

  it('nothing is written without decisions; an unreadable file reads as null', () => {
    const root = ws();
    const appRun = join(root, 'apps', 'demo', 'wsp', 'runs', 't1');
    expect(persistBaselineDecisions(appRun, {})).toEqual({});
    expect(existsSync(join(appRun, 'baseline-decisions.json'))).toBe(false);
    mkdirSync(appRun, { recursive: true });
    writeFileSync(join(appRun, 'baseline-decisions.json'), '{"source":"live"');
    expect(readBaselineDecisions(appRun)).toBeNull();
  });
});

// #3920 (Design 123 section 9.3): requirement provenance for the inline fit, baseline selected only.
describe('baselineRequirementProvenance (#3920)', () => {
  const decls = [
    { id: FW, sovereignty_requirements: { require_residency_country: ['DE'] } },
    { id: 'GDPR', sovereignty_requirements: { require_residency_country: ['EU'], forbid_exposure: ['us_cloud_act'] } },
  ];
  it('is the value-level provenance of the decls when a baseline is selected', () => {
    const root = ws();
    expect(baselineRequirementProvenance(selectedPolicyBaselines(root, [FW, 'GDPR']), decls)).toEqual([
      { requirement: 'residency_country', value: 'DE', frameworks: [FW] },
      { requirement: 'residency_country', value: 'EU', frameworks: ['GDPR'] },
      { requirement: 'forbid_exposure', value: 'us_cloud_act', frameworks: ['GDPR'] },
    ]);
  });
  it('is undefined without a selected baseline, so other app fits stay unchanged', () => {
    const root = ws();
    expect(baselineRequirementProvenance(selectedPolicyBaselines(root, ['GDPR']), decls)).toBeUndefined();
  });
});
