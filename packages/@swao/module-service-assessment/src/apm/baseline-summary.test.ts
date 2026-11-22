// #3873 (Design 123 section 9.2): additive WSP fields in portfolio-summary.json:
// landing_zones[].baseline, landing_zones[].hierarchy, landing_zones[].checks.unverified
// and apps[].lz_source. Fixture WSPs with and without the fields; the
// aggregator fills them from the portfolio merge and the app run context.
// Synthetic artefacts only.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import { LandingZoneLiveSummarySchema, LzLivePortfolioSchema, PortfolioSummarySchema, WSP_SCHEMA_VERSION, lzLiveHierarchySummary } from '@swao/core';
import type { LzLivePortfolio } from '@swao/core';
import { makeMixedWorkspace, MIXED_APP, MIXED_APP_RUN } from '../__tests__/fixtures/mixed-workspace.js';
import { buildPortfolioSummary, readRunLzSource } from './score.js';

const NOW = new Date('2026-11-05T12:00:00Z');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
// Identity-shaped bait (assembled so no literal id sits in the source).
const NODE_ID = ['ou', 'bait', '0001'].join('-');
const ACCOUNT_ID = ['1234', '5678', '9012'].join('');

const lz = (id: string, provider: string, extra: Record<string, unknown> = {}) => ({
  lz_id: id, provider, run_id: '2026-11-05T08-00-00', merged_at: '2026-11-05T12:00:00.000Z', window_days: 7, simulated: false, merge_basis: 'merged',
  scopes: [{ scope_id: 'platform', scope_kind: 'platform', status: 'merged', observed_at: '2026-11-05T08:00:00Z', read_only: 'verified' }],
  regions_enabled: 1, services_enabled: 1, iac: { full: 1, read: 0, none: 0, unknown: 0 },
  framework_lights: {}, checks: { 'CPB-RES-01': 'pass', 'CPB-EXIT-01': 'unverified', 'CPB-NET-02': 'unverified', 'CPB-TAG-01': 'fail' },
  drift: { new: 0, removed: 0, status_changes: 0 },
  ...extra,
});
const cmpLz = (id: string, provider: string, sha: string, same: boolean, ready: number) => ({
  lz_id: id, provider, simulated: false, framework: 'CLIENT_LZ_POLICY_BASELINE', sha256: sha, same_baseline: same, overall: 'BLOCKED',
  counts: { enabled: 4, ready, ready_with_changes: 0, needs_verification: 2, blocked: 4 - ready - 2 }, fit_score: same ? ready / 4 : null, rank: same ? 1 : null,
});

const HIERARCHY = {
  nodes: [
    { id: 'r-root', kind: 'root', native_kind: 'aws:root' },
    { id: NODE_ID, kind: 'organisational_unit', native_kind: 'aws:ou', parent: 'r-root', label: 'Node-0123456789' },
    { id: ACCOUNT_ID, kind: 'account', native_kind: 'aws:account', parent: NODE_ID, label: 'Node-abcdef0123' },
    { id: 'acc-2', kind: 'account', parent: 'r-root' },
  ],
  source: { calls: ['organizations:ListRoots'] },
  scope_nodes: { platform: ACCOUNT_ID },
};

function merge(withBaseline: boolean): LzLivePortfolio {
  return LzLivePortfolioSchema.parse({
    schema: 'lz-live-portfolio/1', generated_at: '2026-11-05T12:00:00.000Z', include_simulated: false,
    landing_zones: [lz('aws-prod', 'aws', { hierarchy: HIERARCHY }), lz('otc-prod', 'otc')],
    ...(withBaseline ? {
      baseline_comparison: {
        framework: 'CLIENT_LZ_POLICY_BASELINE', baseline_of: 'CLIENT_LZ_POLICY_BASELINE', catalogue_version: '1.0.0', sha256: H1,
        landing_zones: [cmpLz('aws-prod', 'aws', H1, true, 2), cmpLz('otc-prod', 'otc', H2, false, 1)],
        policies: [], not_met_anywhere: [],
      },
    } : {}),
  });
}

function writeMerge(ws: string, p: LzLivePortfolio): void {
  const dir = join(ws, 'wsp', 'lz-live-portfolio');
  mkdirSync(join(dir, 'runs', '2026-11-05T12-00-00'), { recursive: true });
  writeFileSync(join(dir, 'runs', '2026-11-05T12-00-00', 'lz-live-portfolio.yaml'), dump(p));
  writeFileSync(join(dir, 'latest.txt'), '2026-11-05T12-00-00\n');
}

function lzOnlyWorkspace(p: LzLivePortfolio): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-baseline-summary-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
  writeMerge(ws, p);
  return ws;
}

describe('WSP version (#3873, Design 123 section 9.2)', () => {
  it('the spine schema version is 0.11 (additive minor bump per CLAUDE.md 5.6 / ADR-0012)', () => {
    expect(WSP_SCHEMA_VERSION).toBe('0.11');
  });
});

describe('fixture WSP without the new fields (#3873)', () => {
  it('a portfolio-summary.json written before #3873 parses unchanged', () => {
    const old = {
      generated_at: '2026-11-01T00:00:00.000Z', framework: { id: 'SWAO_APM', version: '1', status: 'draft' }, domain_weights: {}, app_count: 0, portfolio_risk_score: null,
      time_distribution: { Tolerate: 0, Invest: 0, Migrate: 0, 'Migrate-Critical': 0, Eliminate: 0 }, apps: [], vendor_consolidation: [], waves: [],
      landing_zones: [{ lz_id: 'otc-prod', provider: 'otc', scopes: [], regions_enabled: 1, services_enabled: 1, iac_full_pct: 100, framework_lights: {}, checks: { pass: 1, fail: 0, warn: 0 }, stale_scopes: [] }],
    };
    const r = PortfolioSummarySchema.safeParse(old);
    expect(r.success).toBe(true);
    const entry = r.success ? r.data.landing_zones![0]! : undefined;
    expect(entry?.baseline).toBeUndefined();
    expect(entry?.hierarchy).toBeUndefined();
    expect(entry?.checks.unverified).toBeUndefined();
  });

  it('a merge without a baseline comparison or hierarchy gives entries without baseline and hierarchy, but with the unverified count', () => {
    const ws = lzOnlyWorkspace(LzLivePortfolioSchema.parse({ ...merge(false), landing_zones: merge(false).landing_zones.map(({ hierarchy: _h, ...l }) => l) }));
    const s = buildPortfolioSummary(ws, { now: NOW });
    for (const l of s.landing_zones!) {
      expect(l.baseline).toBeUndefined();
      expect(l.hierarchy).toBeUndefined();
      expect(l.checks).toEqual({ pass: 1, fail: 1, warn: 0, unverified: 2 });
    }
  });
});

describe('fixture WSP with the new fields (#3873)', () => {
  it('landing_zones[] carry baseline fit, hierarchy summary and the unverified count; written and re-read through the schema', () => {
    const ws = lzOnlyWorkspace(merge(true));
    buildPortfolioSummary(ws, { now: NOW });
    const onDisk = PortfolioSummarySchema.parse(JSON.parse(readFileSync(join(ws, 'wsp', 'portfolio-summary.json'), 'utf-8')));
    const aws = onDisk.landing_zones!.find((l) => l.lz_id === 'aws-prod')!;
    expect(aws.baseline).toEqual({ framework: 'CLIENT_LZ_POLICY_BASELINE', fit_ready: 2, fit_total: 4, needs_verification: 2, blocked: 0, same_baseline: true });
    expect(aws.hierarchy).toEqual({ nodes_by_kind: { root: 1, organisational_unit: 1, account: 2 }, depth: 3 });
    expect(aws.checks.unverified).toBe(2);
    // Assessed with other baseline settings: carried, but marked as not comparable.
    expect(onDisk.landing_zones!.find((l) => l.lz_id === 'otc-prod')!.baseline).toMatchObject({ fit_ready: 1, same_baseline: false });
  });

  it('privacy: no node id, account id, label or native kind reaches portfolio-summary.json', () => {
    const ws = lzOnlyWorkspace(merge(true));
    buildPortfolioSummary(ws, { now: NOW });
    const text = readFileSync(join(ws, 'wsp', 'portfolio-summary.json'), 'utf-8');
    for (const bait of [NODE_ID, ACCOUNT_ID, 'Node-0123456789', 'aws:ou', 'r-root']) expect(text).not.toContain(bait);
  });

  it('the hierarchy schema refuses an unknown kind and extra keys (no ids slip in)', () => {
    const base = LandingZoneLiveSummarySchema.parse({ lz_id: 'x', provider: 'aws', scopes: [], regions_enabled: 0, services_enabled: 0, iac_full_pct: 0, framework_lights: {}, checks: { pass: 0, fail: 0, warn: 0 }, stale_scopes: [] });
    expect(LandingZoneLiveSummarySchema.safeParse({ ...base, hierarchy: { nodes_by_kind: { tenant: 1 }, depth: 1 } }).success).toBe(false);
    expect(LandingZoneLiveSummarySchema.safeParse({ ...base, hierarchy: { nodes_by_kind: {}, depth: 0, ids: [NODE_ID] } }).success).toBe(false);
    expect(LandingZoneLiveSummarySchema.safeParse({ ...base, baseline: { framework: 'X', fit_ready: 1, fit_total: 1, needs_verification: 0, blocked: 0 } }).success).toBe(false);
  });

  it('lzLiveHierarchySummary: a lone root is depth 1', () => {
    expect(lzLiveHierarchySummary({ nodes: [{ id: 'r', kind: 'root', status: 'observed', policy_refs: [] }], source: { calls: ['x'], partial: false, status: 'ok' }, resource_nodes: {}, scope_nodes: {} })).toEqual({ nodes_by_kind: { root: 1 }, depth: 1 });
  });

  it('apps[].lz_source comes from the app run context (#3887); absent without it', () => {
    const ws = makeMixedWorkspace();
    dirs.push(ws);
    expect(buildPortfolioSummary(ws, { now: NOW }).apps.find((a) => a.id === MIXED_APP)!.lz_source).toBeUndefined();
    writeFileSync(join(ws, 'apps', MIXED_APP, 'wsp', 'runs', MIXED_APP_RUN, 'run-context.yaml'), dump({ assessment_type: 'application', run_timestamp: '2026-11-05T08:00:00Z', swao_version: '1.6.1', lz_source: 'live', lz_live: { lz_id: 'otc-prod', run_id: 'r1', scopes: ['app-a'], stale: false } }));
    const s = buildPortfolioSummary(ws, { now: NOW });
    expect(s.apps.find((a) => a.id === MIXED_APP)!.lz_source).toBe('live');
    expect(PortfolioSummarySchema.parse(JSON.parse(readFileSync(join(ws, 'wsp', 'portfolio-summary.json'), 'utf-8'))).apps.find((a) => a.id === MIXED_APP)!.lz_source).toBe('live');
  });

  it('readRunLzSource: invalid or missing run context yields undefined', () => {
    const ws = makeMixedWorkspace();
    dirs.push(ws);
    expect(readRunLzSource(ws, MIXED_APP, null)).toBeUndefined();
    writeFileSync(join(ws, 'apps', MIXED_APP, 'wsp', 'runs', MIXED_APP_RUN, 'run-context.yaml'), dump({ assessment_type: 'application', run_timestamp: 't', swao_version: 'v', lz_source: 'cmdb' }));
    expect(readRunLzSource(ws, MIXED_APP, `runs/${MIXED_APP_RUN}`)).toBeUndefined();
    writeFileSync(join(ws, 'apps', MIXED_APP, 'wsp', 'runs', MIXED_APP_RUN, 'run-context.yaml'), dump({ assessment_type: 'application', run_timestamp: 't', swao_version: 'v', lz_source: 'catalogue' }));
    expect(readRunLzSource(ws, MIXED_APP, `runs/${MIXED_APP_RUN}`)).toBe('catalogue');
  });
});

describe('lz-live-portfolio/1 stays valid for the additive baseline_comparison block (#3873, section 9.1)', () => {
  it('a merge with and one without baseline_comparison both parse as /1', () => {
    expect(LzLivePortfolioSchema.safeParse(merge(true)).success).toBe(true);
    expect(LzLivePortfolioSchema.safeParse(merge(false)).success).toBe(true);
  });
});
