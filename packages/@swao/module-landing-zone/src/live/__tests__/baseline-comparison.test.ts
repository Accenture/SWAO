// #3872 (Design 123 section 8.3): several CSPs against one client baseline in
// the live portfolio. Synthetic run folders only.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump as yamlDump } from 'js-yaml';
import { LZ_BASELINE_RESULT_SCHEMA, LzLivePortfolioSchema, deriveLzScanBaseFields, parseLzLiveScan } from '@swao/core';
import type { LzBaselinePolicyResult, LzBaselineResult, LzLiveScan, LzLiveSimulated } from '@swao/core';
import { mergeLzLiveScopes } from '../merge.js';
import { formatLzLivePortfolio, runLzLivePortfolio } from '../portfolio.js';
import { buildBaselineComparison, rollUpBaselineScopes } from '../baseline-comparison.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

const NOW = new Date('2026-11-05T12:00:00Z');
const T = '2026-11-05T08:00:00Z';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const SIM: LzLiveSimulated = { scenario: 'baseline-compliant', fidelity: 'spec-derived', evidence: ['header'] };

type Row = Pick<LzBaselinePolicyResult, 'offering' | 'estate'> & Partial<LzBaselinePolicyResult>;
function pol(id: string, kind: LzBaselinePolicyResult['kind'], category: LzBaselinePolicyResult['category'], row: Row): LzBaselinePolicyResult {
  return { id, kind, category, control: id, severity: 'warning', observability: row.estate === 'unverified' ? 'not_collected' : 'observed', detail: 'synthetic', ...row };
}
function result(lzId: string, scopeId: string, provider: string, sha: string, policies: LzBaselinePolicyResult[]): LzBaselineResult {
  return {
    schema: LZ_BASELINE_RESULT_SCHEMA, lz_id: lzId, scope_id: scopeId, provider, framework: 'CLIENT_LZ_POLICY_BASELINE', baseline_of: 'CLIENT_LZ_POLICY_BASELINE',
    catalogue_version: '1.0.0', sha256: sha, overall: 'READY', policies, not_reviewed: [], disabled: [], requirement_provenance: [],
  };
}
const RES = (o: Row['offering'], e: Row['estate']) => pol('CPB-RES-01', 'region_residency', 'data_residency', { offering: o, estate: e });
const TAG = (o: Row['offering'], e: Row['estate']) => pol('CPB-TAG-01', 'required_tags', 'tagging', { offering: o, estate: e });
const NET = (o: Row['offering'], e: Row['estate']) => pol('CPB-NET-02', 'no_open_admin_ingress', 'network_exposure', { offering: o, estate: e });

describe('rollUpBaselineScopes (#3872)', () => {
  it('governance policies follow the platform scope; others take the worst scope (a fail anywhere fails)', () => {
    const rolled = rollUpBaselineScopes([
      { scope_id: 'platform', scope_kind: 'platform', result: result('a', 'platform', 'otc', H1, [RES('READY', 'pass'), TAG('READY', 'pass')]) },
      { scope_id: 'app', scope_kind: 'application', result: result('a', 'app', 'otc', H1, [RES('SOVEREIGNTY_BLOCKED', 'fail'), TAG('READY_WITH_CHANGES', 'fail')]) },
    ]);
    expect(rolled.get('CPB-RES-01')).toMatchObject({ offering: 'READY', estate: 'pass' });
    expect(rolled.get('CPB-TAG-01')).toMatchObject({ offering: 'READY_WITH_CHANGES', estate: 'fail' });
  });
  it('without a platform scope governance policies take the worst too', () => {
    const rolled = rollUpBaselineScopes([
      { scope_id: 'app', scope_kind: 'application', result: result('a', 'app', 'otc', H1, [RES('SOVEREIGNTY_BLOCKED', 'fail')]) },
      { scope_id: 'app2', scope_kind: 'application', result: result('a', 'app2', 'otc', H1, [RES('READY', 'pass')]) },
    ]);
    expect(rolled.get('CPB-RES-01')).toMatchObject({ offering: 'SOVEREIGNTY_BLOCKED', estate: 'fail' });
  });
});

describe('rollUpBaselineScopes and the comparison carry the publication fields (#3874)', () => {
  it('the deciding scope, its detail and the default source are kept per policy', () => {
    const rolled = rollUpBaselineScopes([
      { scope_id: 'app1', scope_kind: 'application', result: result('a', 'app1', 'otc', H1, [pol('CPB-TAG-01', 'required_tags', 'tagging', { offering: 'READY', estate: 'pass', detail: 'all tagged', default_source: 'assumption' })]) },
      { scope_id: 'app2', scope_kind: 'application', result: result('a', 'app2', 'otc', H1, [pol('CPB-TAG-01', 'required_tags', 'tagging', { offering: 'READY', estate: 'fail', detail: '2 resources untagged', default_source: 'assumption' })]) },
    ]);
    expect(rolled.get('CPB-TAG-01')).toMatchObject({ estate: 'fail', scope_id: 'app2', detail: '2 resources untagged', default_source: 'assumption' });
  });
  it('the comparison lists default_source per policy, not_reviewed and disabled of the reference, and provenance per landing zone', () => {
    const r1 = { ...result('a', 'platform', 'otc', H1, [pol('CPB-RES-01', 'region_residency', 'data_residency', { offering: 'READY', estate: 'pass', default_source: 'BSI C5' })]),
      not_reviewed: [{ id: 'CPB-SVC-01', kind: 'service_deny' as const, params: { capabilities: ['postgresql'] }, default_source: 'assumption' }],
      disabled: ['CPB-TAG-01'],
      requirement_provenance: [{ requirement: 'residency_country' as const, value: 'DE', frameworks: ['CLIENT_LZ_POLICY_BASELINE'] }] };
    const r2 = { ...r1, scope_id: 'app', requirement_provenance: [{ requirement: 'residency_country' as const, value: 'DE', frameworks: ['BSI_C5'] }, { requirement: 'forbid_exposure' as const, value: 'us_cloud_act', frameworks: ['BSI_C5'] }] };
    const c = buildBaselineComparison([{ lz_id: 'a', provider: 'otc', simulated: false, scopes: [
      { scope_id: 'platform', scope_kind: 'platform', result: r1 },
      { scope_id: 'app', scope_kind: 'application', result: r2 },
    ] }])!;
    expect(c.policies[0]!.default_source).toBe('BSI C5');
    expect(c.not_reviewed).toEqual([{ id: 'CPB-SVC-01', kind: 'service_deny', params: { capabilities: ['postgresql'] }, default_source: 'assumption' }]);
    expect(c.disabled).toEqual(['CPB-TAG-01']);
    expect(c.landing_zones[0]!.requirement_provenance).toEqual([
      { requirement: 'residency_country', value: 'DE', frameworks: ['CLIENT_LZ_POLICY_BASELINE', 'BSI_C5'] },
      { requirement: 'forbid_exposure', value: 'us_cloud_act', frameworks: ['BSI_C5'] },
    ]);
    expect(() => LzLivePortfolioSchema.shape.baseline_comparison.parse(c)).not.toThrow();
  });
});

describe('buildBaselineComparison (#3872)', () => {
  const lz = (id: string, provider: string, sha: string, policies: LzBaselinePolicyResult[], simulated = false) => ({
    lz_id: id, provider, simulated, scopes: [{ scope_id: 'platform', scope_kind: 'platform' as const, result: result(id, 'platform', provider, sha, policies) }],
  });

  it('two CSPs with one baseline: matrix, fit score, ranks and the policies met nowhere', () => {
    const c = buildBaselineComparison([
      lz('stackit-a', 'stackit', H1, [RES('READY', 'pass'), TAG('READY', 'pass'), NET('NEEDS_VERIFICATION', 'unverified')]),
      lz('otc-a', 'otc', H1, [RES('READY_WITH_CHANGES', 'fail'), TAG('READY', 'pass'), NET('NEEDS_VERIFICATION', 'unverified')]),
    ])!;
    expect(c.sha256).toBe(H1);
    expect(c.landing_zones.map((l) => [l.lz_id, l.same_baseline, l.counts.ready, l.counts.needs_verification, l.fit_score, l.rank])).toEqual([
      ['otc-a', true, 1, 1, 1 / 3, 2],
      ['stackit-a', true, 2, 1, 2 / 3, 1],
    ]);
    expect(c.policies.find((p) => p.id === 'CPB-RES-01')?.cells).toEqual([
      { lz_id: 'otc-a', offering: 'READY_WITH_CHANGES', estate: 'fail', observability: 'observed' },
      { lz_id: 'stackit-a', offering: 'READY', estate: 'pass', observability: 'observed' },
    ]);
    expect(c.not_met_anywhere).toEqual(['CPB-NET-02']);
  });

  it('a landing zone assessed with a different baseline hash is marked and not ranked, and does not meet a policy for the others', () => {
    const c = buildBaselineComparison([
      lz('a', 'otc', H1, [RES('READY_WITH_CHANGES', 'fail')]),
      lz('b', 'aws', H1, [RES('READY_WITH_CHANGES', 'fail')]),
      lz('c', 'stackit', H2, [RES('READY', 'pass')]),
    ])!;
    expect(c.sha256).toBe(H1);
    const other = c.landing_zones.find((l) => l.lz_id === 'c')!;
    expect(other).toMatchObject({ same_baseline: false, fit_score: null, rank: null, sha256: H2 });
    expect(c.not_met_anywhere).toEqual(['CPB-RES-01']);
  });

  it('scopes of one landing zone with different hashes make it a different baseline', () => {
    const c = buildBaselineComparison([{ lz_id: 'a', provider: 'otc', simulated: false, scopes: [
      { scope_id: 'platform', scope_kind: 'platform', result: result('a', 'platform', 'otc', H1, [RES('READY', 'pass')]) },
      { scope_id: 'app', scope_kind: 'application', result: result('a', 'app', 'otc', H2, [RES('READY', 'pass')]) },
    ] }, lz('b', 'aws', H1, [RES('READY', 'pass')])])!;
    expect(c.landing_zones.find((l) => l.lz_id === 'a')).toMatchObject({ same_baseline: false, rank: null });
    expect(c.landing_zones.find((l) => l.lz_id === 'b')).toMatchObject({ same_baseline: true, rank: 1 });
  });

  it('an all-unverified landing zone is not ranked as fit', () => {
    const c = buildBaselineComparison([
      lz('grey', 'azure', H1, [RES('NEEDS_VERIFICATION', 'unverified'), TAG('NEEDS_VERIFICATION', 'unverified')]),
      lz('ok', 'otc', H1, [RES('READY', 'pass'), TAG('READY_WITH_CHANGES', 'fail')]),
    ])!;
    expect(c.landing_zones.find((l) => l.lz_id === 'grey')).toMatchObject({ fit_score: 0, rank: null, overall: 'NEEDS_VERIFICATION' });
    expect(c.landing_zones.find((l) => l.lz_id === 'ok')?.rank).toBe(1);
  });

  it('no baseline anywhere gives no block', () => {
    expect(buildBaselineComparison([{ lz_id: 'a', provider: 'otc', simulated: false, scopes: [] }])).toBeUndefined();
  });
});

// --- through the portfolio merge -------------------------------------------

function scan(lzId: string, provider: string, scopeId: string, sha: string, simulated?: LzLiveSimulated): LzLiveScan {
  const meta = {
    lz_id: lzId, provider, scope_id: scopeId, scope_kind: 'platform' as const, observed_at: T, driver_version: '0.1.0', read_only: 'verified' as const,
    read_only_overrides: [], coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [],
    baseline: { framework: 'CLIENT_LZ_POLICY_BASELINE', catalogue_version: '1.0.0', sha256: sha }, ...(simulated ? { simulated } : {}),
  };
  const offering = { regions: [{ id: 'r1', country: 'DE', azs: [], status: 'enabled' as const }], services: [] };
  const estate = { resources: [], workloads: [], guardrails: [], quotas: [], checks: [] };
  return parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate });
}

function writeLz(ws: string, lzId: string, provider: string, sha: string, policies: LzBaselinePolicyResult[], simulated?: LzLiveSimulated): void {
  const s = scan(lzId, provider, 'platform', sha, simulated);
  const merged = mergeLzLiveScopes({ lzId, provider, scans: [s], registeredScopes: [{ id: 'platform', kind: 'platform' }], now: NOW });
  const dir = join(ws, 'landing-zones', lzId, 'wsp', 'runs', '2026-11-05T08-30-00');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${lzId}.platform.lz-live-scan.json`), JSON.stringify(s));
  writeFileSync(join(dir, `${lzId}.platform.lz-baseline.json`), JSON.stringify(result(lzId, 'platform', provider, sha, policies)));
  writeFileSync(join(dir, 'lz-live-merged.yaml'), yamlDump(merged));
  writeFileSync(join(dir, 'lz-live-catalogue.json'), JSON.stringify({ regions: [] }));
}

function workspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lz-cmp-'));
  tmp.push(ws);
  const lzs = [['otc-a', 'otc', 'iam-password-token'], ['stackit-a', 'stackit', 'key-flow'], ['aws-sim', 'aws', 'sso-profile']];
  writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', ...lzs.flatMap(([id, p, auth]) => [`  - id: ${id}`, `    provider: ${p}`, '    scopes:', '      - id: platform', '        kind: platform', `        auth: ${auth}`]), ''].join('\n'));
  writeLz(ws, 'otc-a', 'otc', H1, [RES('READY_WITH_CHANGES', 'fail'), TAG('READY', 'pass')]);
  writeLz(ws, 'stackit-a', 'stackit', H1, [RES('READY', 'pass'), TAG('READY', 'pass')]);
  writeLz(ws, 'aws-sim', 'aws', H1, [RES('READY', 'pass'), TAG('READY', 'pass')], SIM);
  return ws;
}

describe('baseline_comparison in the live portfolio (#3872)', () => {
  it('compares the merged landing zones; a simulated landing zone is excluded without --include-simulated', () => {
    const { portfolio } = runLzLivePortfolio({ workspaceRoot: workspace(), now: () => NOW });
    expect(() => LzLivePortfolioSchema.parse(portfolio)).not.toThrow();
    const c = portfolio.baseline_comparison!;
    expect(c.landing_zones.map((l) => [l.lz_id, l.rank])).toEqual([['otc-a', 2], ['stackit-a', 1]]);
    expect(portfolio.skipped.map((s) => s.lz_id)).toContain('aws-sim');
    const text = formatLzLivePortfolio(portfolio).join('\n');
    expect(text).toContain('baseline CLIENT_LZ_POLICY_BASELINE 1.0.0');
    expect(text).toContain('stackit-a (STACKIT): READY; fit 2/2 READY');
  });

  it('with --include-simulated the simulated landing zone joins, marked [SIM]', () => {
    const { portfolio } = runLzLivePortfolio({ workspaceRoot: workspace(), includeSimulated: true, now: () => NOW });
    const sim = portfolio.baseline_comparison!.landing_zones.find((l) => l.lz_id === 'aws-sim');
    expect(sim).toMatchObject({ simulated: true, same_baseline: true });
    expect(formatLzLivePortfolio(portfolio).join('\n')).toMatch(/aws-sim \(AWS, Amazon Web Services\) \[SIM\]/);
  });

  it('a baseline result whose hash does not match the scan meta.baseline is ignored; no baseline gives no block', () => {
    const ws = workspace();
    const dir = join(ws, 'landing-zones', 'otc-a', 'wsp', 'runs', '2026-11-05T08-30-00');
    writeFileSync(join(dir, 'otc-a.platform.lz-baseline.json'), JSON.stringify(result('otc-a', 'platform', 'otc', H2, [RES('READY', 'pass')])));
    const c = runLzLivePortfolio({ workspaceRoot: ws, now: () => NOW }).portfolio.baseline_comparison!;
    expect(c.landing_zones.map((l) => l.lz_id)).toEqual(['stackit-a']);
    const bare = mkdtempSync(join(tmpdir(), 'swao-lz-cmp-none-'));
    tmp.push(bare);
    writeFileSync(join(bare, '.swao.yml'), 'name: demo\n');
    expect(runLzLivePortfolio({ workspaceRoot: bare, now: () => NOW }).portfolio.baseline_comparison).toBeUndefined();
  });
});
