// #3584: portfolio merge across landing zones (Design 120 section 11.2).
// Two synthetic landing zones on two CSPs written as WSP run folders: an OTC
// one with a stale application scope carried from an older run, and an AWS
// one with a simulated application scope. No recording, no tenant identifier.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump as yamlDump } from 'js-yaml';
import {
  deriveLzScanBaseFields,
  LandingZoneLiveSummarySchema,
  lzLivePortfolioSummaryEntries,
  parseLzLiveScan,
  readLatestLzLivePortfolio,
} from '@swao/core';
import { LicenseTierError } from '@swao/core';
import type { LzLiveScan, LzLiveSimulated } from '@swao/core';
import { mergeLzLiveScopes } from '../merge.js';
import { buildLzLivePortfolio, findLzLiveCapabilities, formatLzLivePortfolio, readLzLiveRunForPortfolio, runLzLivePortfolio } from '../portfolio.js';
import { lzLivePortfolioAction } from '../cli.js';

type Status = LzLiveScan['offering']['services'][number]['regions'][string]['status'];
type Light = 'red' | 'amber' | 'green' | 'grey';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

// Identity-shaped value placed only in .raw/ (must never be read, #3587 / Design 120 section 6.4).
const RAW_BAIT = ['raw', 'bait', '9c1d'].join('-');

function scan(o: {
  lzId: string; provider: string; scopeId: string; kind?: 'platform' | 'application'; observedAt: string;
  region: string; country: string;
  services: { code: string; tags: string[]; status: Status; light?: Light; iac?: 'full' | 'read' | 'none' }[];
  checks?: { id: string; status: 'pass' | 'fail' | 'warn' | 'na' }[];
  simulated?: LzLiveSimulated;
  diffNew?: number;
}): LzLiveScan {
  const meta = {
    lz_id: o.lzId, provider: o.provider, scope_id: o.scopeId, scope_kind: o.kind ?? 'platform', observed_at: o.observedAt,
    driver_version: '0.1.0', read_only: 'verified' as const, read_only_overrides: [], coverage: { readable: [], unreadable: [] },
    frameworks: [{ id: 'bsi-c5', version: '2020', sha256: 'a'.repeat(64) }], sources: [],
    ...(o.simulated ? { simulated: o.simulated } : {}),
  };
  const offering = {
    regions: [{ id: o.region, country: o.country, azs: [], status: 'enabled' as const }],
    services: o.services.map((s) => ({
      code: s.code, name: s.code, capability_tags: s.tags,
      regions: { [o.region]: { status: s.status, evidence: [{ source: s.status === 'restricted' ? 'policy' as const : 'api' as const, ref: `${o.scopeId}:${s.code}` }], observed_at: o.observedAt } },
      ...(s.iac ? { iac: s.iac === 'none' ? { level: 'none' as const, source: 'curated' as const } : { level: s.iac, provider: 'example', tool: ['terraform' as const], source: 'curated' as const, ...(s.iac === 'full' ? { resources: [`example_${s.code}`] } : { data_sources: [`example_${s.code}`] }) } } : {}),
      frameworks: s.light ? { 'bsi-c5': { light: s.light, controls: [] } } : {},
    })),
  };
  const estate = {
    resources: [{ id: `res-${o.scopeId}`, type: 'vm' }], workloads: [], guardrails: [],
    quotas: [{ resource: 'instances', region: o.region, limit: 20, used: 3 }],
    checks: (o.checks ?? []).map((c) => ({ id: c.id, title: c.id, controls: [], status: c.status })),
  };
  const s = parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate });
  return { ...s, diff: { new: Array.from({ length: o.diffNew ?? 0 }, (_, i) => ({ kind: 'resource' as const, ref: `r${i}` })), removed: [], status_changes: [] } } as LzLiveScan;
}

function writeRun(ws: string, lzId: string, runId: string, scans: LzLiveScan[], merged?: ReturnType<typeof mergeLzLiveScopes>, catalogueRegions?: unknown[]): void {
  const dir = join(ws, 'landing-zones', lzId, 'wsp', 'runs', runId);
  mkdirSync(dir, { recursive: true });
  for (const s of scans) writeFileSync(join(dir, `${lzId}.${s.meta.scope_id}.lz-live-scan.json`), JSON.stringify(s));
  if (merged) writeFileSync(join(dir, 'lz-live-merged.yaml'), yamlDump(merged));
  if (catalogueRegions) writeFileSync(join(dir, 'lz-live-catalogue.json'), JSON.stringify({ regions: catalogueRegions }));
}

const NOW = new Date('2026-11-03T12:00:00Z');
const SIM: LzLiveSimulated = { scenario: 'demo', fidelity: 'spec-derived', evidence: ['header'] };

function fixtureWorkspace(opts: { awsAllSimulated?: boolean } = {}): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lz-portfolio-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), [
    'name: demo', 'landing_zones:',
    '  - id: otc-prod', '    provider: otc', '    scopes:',
    '      - id: platform', '        kind: platform', '        auth: iam-password-token',
    '      - id: app-a', '        kind: application', '        auth: iam-password-token',
    '  - id: aws-lab', '    provider: aws', '    scopes:',
    '      - id: platform', '        kind: platform', '        auth: session-keys',
    '      - id: sim-app', '        kind: application', '        auth: session-keys',
    '  - id: azure-new', '    provider: azure', '    scopes:',
    '      - id: platform', '        kind: platform', '        auth: service-principal-secret',
    '',
  ].join('\n'));

  // OTC: app-a scanned in an older run (stale now), platform in the latest run.
  const otcApp = scan({ lzId: 'otc-prod', provider: 'otc', scopeId: 'app-a', kind: 'application', observedAt: '2026-10-01T08:00:00Z', region: 'eu-de', country: 'DE', services: [{ code: 'cce', tags: ['kubernetes'], status: 'enabled', light: 'red' }] });
  writeRun(ws, 'otc-prod', '2026-10-01T08-00-00', [otcApp]);
  const otcPlatform = scan({
    lzId: 'otc-prod', provider: 'otc', scopeId: 'platform', observedAt: '2026-11-03T08:00:00Z', region: 'eu-de', country: 'DE', diffNew: 2,
    services: [
      { code: 'cce', tags: ['kubernetes'], status: 'enabled', light: 'green', iac: 'full' },
      { code: 'rds', tags: ['postgresql'], status: 'available_not_enabled', light: 'amber' },
    ],
    checks: [{ id: 'LZ-CHK-01', status: 'pass' }, { id: 'LZ-CHK-02', status: 'fail' }],
  });
  const otcMerged = mergeLzLiveScopes({ lzId: 'otc-prod', provider: 'otc', scans: [otcPlatform, otcApp], registeredScopes: [{ id: 'platform', kind: 'platform' }, { id: 'app-a', kind: 'application' }], now: NOW });
  writeRun(ws, 'otc-prod', '2026-11-03T08-00-00', [otcPlatform], otcMerged, [{ id: 'eu-de', sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU' } }]);
  writeFileSync(join(ws, 'landing-zones', 'otc-prod', 'wsp', 'latest-lz-live.txt'), '2026-11-03T08-00-00\n');
  mkdirSync(join(ws, 'landing-zones', 'otc-prod', '.raw', '2026-11-03T08-00-00'), { recursive: true });
  writeFileSync(join(ws, 'landing-zones', 'otc-prod', '.raw', '2026-11-03T08-00-00', 'lz-live-merged.yaml'), `lz_id: ${RAW_BAIT}\n`);

  // AWS: platform real, sim-app simulated (adds eks and a restricted ec2).
  const awsPlatform = scan({
    lzId: 'aws-lab', provider: 'aws', scopeId: 'platform', observedAt: '2026-11-03T09:00:00Z', region: 'eu-central-1', country: 'DE', simulated: opts.awsAllSimulated ? SIM : undefined,
    services: [{ code: 'ec2', tags: ['vm_compute'], status: 'enabled', light: 'green', iac: 'full' }],
    checks: [{ id: 'LZ-CHK-01', status: 'warn' }],
  });
  const awsSim = scan({
    lzId: 'aws-lab', provider: 'aws', scopeId: 'sim-app', kind: 'application', observedAt: '2026-11-03T09:30:00Z', region: 'eu-central-1', country: 'DE', simulated: SIM,
    services: [{ code: 'eks', tags: ['kubernetes'], status: 'enabled', light: 'green', iac: 'full' }, { code: 'ec2', tags: ['vm_compute'], status: 'restricted', light: 'red' }],
    checks: [{ id: 'LZ-CHK-01', status: 'fail' }],
  });
  const awsMerged = mergeLzLiveScopes({ lzId: 'aws-lab', provider: 'aws', scans: [awsPlatform, awsSim], registeredScopes: [{ id: 'platform', kind: 'platform' }, { id: 'sim-app', kind: 'application' }], now: NOW });
  writeRun(ws, 'aws-lab', '2026-11-03T09-30-00', [awsPlatform, awsSim], awsMerged);
  return ws;
}

function inputs(ws: string) {
  return [['otc-prod', 'otc'], ['aws-lab', 'aws'], ['azure-new', 'azure']].map(([id, p]) => {
    const r = readLzLiveRunForPortfolio(ws, id as string, p as string);
    return typeof r === 'string' ? { lzId: id as string, reason: r } : r;
  });
}

describe('portfolio merge across landing zones (#3584, Design 120 section 11.2)', () => {
  it('merges two landing zones on two CSPs with provenance and lists stale, missing and unrun ones', () => {
    const p = buildLzLivePortfolio({ inputs: inputs(fixtureWorkspace()), now: NOW });
    expect(p.landing_zones.map((l) => [l.lz_id, l.provider, l.run_id])).toEqual([['otc-prod', 'otc', '2026-11-03T08-00-00'], ['aws-lab', 'aws', '2026-11-03T09-30-00']]);
    const otc = p.landing_zones[0]!;
    expect(otc.merge_basis).toBe('merged');
    expect(otc.scopes.map((s) => [s.scope_id, s.status, s.read_only])).toEqual([['platform', 'merged', 'verified'], ['app-a', 'stale', 'verified']]);
    expect(otc.scopes[1]?.observed_at).toBe('2026-10-01T08:00:00Z');
    expect(otc).toMatchObject({ regions_enabled: 1, services_enabled: 1, iac: { full: 1, read: 0, none: 0, unknown: 0 }, checks: { 'LZ-CHK-01': 'pass', 'LZ-CHK-02': 'fail' }, drift: { new: 2, removed: 0, status_changes: 0 } });
    // The stale app-a scan (red) does not reach the lights; only the merged platform scan does.
    expect(otc.framework_lights['bsi-c5']).toEqual({ green: 1, amber: 1, red: 0, grey: 0 });
    expect(otc.quotas).toEqual([{ scope_id: 'platform', resource: 'instances', region: 'eu-de', limit: 20, used: 3 }]);
    expect(p.skipped).toEqual([{ lz_id: 'azure-new', reason: 'no live run' }]);
    const lines = formatLzLivePortfolio(p);
    expect(lines).toContain('  stale scope(s), not merged: app-a');
    expect(lines).toContain('azure-new: not merged (no live run)');
  });

  it('without --include-simulated: the simulated scope is left out, listed, and the LZ merged again from the others', () => {
    const p = buildLzLivePortfolio({ inputs: inputs(fixtureWorkspace()), now: NOW });
    const aws = p.landing_zones.find((l) => l.lz_id === 'aws-lab')!;
    expect(aws).toMatchObject({ simulated: false, merge_basis: 're-merged', excluded_simulated_scopes: [{ scope_id: 'sim-app', scenario: 'demo', fidelity: 'spec-derived' }] });
    expect(aws.scopes.map((s) => s.scope_id)).toEqual(['platform']);
    // eks came only from the simulated scope; ec2 is enabled again (the simulated restricted status no longer wins).
    expect(p.capabilities.filter((c) => c.lz_id === 'aws-lab').map((c) => [c.service, c.status])).toEqual([['ec2', 'enabled']]);
    expect(aws.checks).toEqual({ 'LZ-CHK-01': 'warn' });
    expect(formatLzLivePortfolio(p).some((l) => l.includes('[SIM]'))).toBe(false);
    expect(formatLzLivePortfolio(p)).toContain('  simulated scope(s) left out (pass --include-simulated): sim-app');
  });

  it('with --include-simulated: the scope joins and the LZ carries [SIM] in the matrix and the capability rows', () => {
    const p = buildLzLivePortfolio({ inputs: inputs(fixtureWorkspace()), includeSimulated: true, now: NOW });
    const aws = p.landing_zones.find((l) => l.lz_id === 'aws-lab')!;
    expect(aws).toMatchObject({ simulated: true, merge_basis: 'merged', excluded_simulated_scopes: [] });
    expect(aws.scopes.find((s) => s.scope_id === 'sim-app')?.simulated).toEqual(SIM);
    expect(formatLzLivePortfolio(p).find((l) => l.startsWith('aws-lab'))).toContain('aws-lab (AWS, Amazon Web Services) [SIM]:');
    expect(p.capabilities.find((c) => c.service === 'eks')).toMatchObject({ simulated: true, status: 'enabled' });
    expect(p.capabilities.find((c) => c.lz_id === 'aws-lab' && c.service === 'ec2')).toMatchObject({ status: 'restricted', simulated: true });
  });

  it('a landing zone whose every merged scope is simulated is skipped with the reason', () => {
    const p = buildLzLivePortfolio({ inputs: inputs(fixtureWorkspace({ awsAllSimulated: true })), now: NOW });
    expect(p.landing_zones.map((l) => l.lz_id)).toEqual(['otc-prod']);
    expect(p.skipped.find((s) => s.lz_id === 'aws-lab')?.reason).toMatch(/every merged scope is simulated \(platform, sim-app\); pass --include-simulated/);
  });

  it('cross-CSP capability finder: kubernetes enabled in europe, EU operator, IaC full, green for bsi-c5', () => {
    const p = buildLzLivePortfolio({ inputs: inputs(fixtureWorkspace()), includeSimulated: true, now: NOW });
    const q = { tag: 'kubernetes', geography: 'europe', operatorJurisdiction: 'EU', iacLevel: 'full', framework: 'bsi-c5', light: 'green' as const };
    expect(findLzLiveCapabilities(p, q).map((c) => [c.lz_id, c.service, c.region])).toEqual([['otc-prod', 'cce', 'eu-de']]);
    // Without the operator filter the simulated AWS row is still left out unless asked for.
    const { operatorJurisdiction: _drop, ...noOperator } = q;
    expect(findLzLiveCapabilities(p, noOperator).map((c) => c.lz_id)).toEqual(['otc-prod']);
    expect(findLzLiveCapabilities(p, { ...noOperator, includeSimulated: true }).map((c) => c.lz_id)).toEqual(['otc-prod', 'aws-lab']);
    expect(p.capabilities.find((c) => c.service === 'cce')?.geographies).toEqual(['germany', 'europe']);
  });

  it('writes the artefact and the pointer; the core reader and the summary mapping read it; .raw/ and resource ids stay out', () => {
    const ws = fixtureWorkspace();
    const out = runLzLivePortfolio({ workspaceRoot: ws, now: () => NOW });
    expect(out.file).toBe(join(ws, 'wsp', 'lz-live-portfolio', 'runs', '2026-11-03T12-00-00', 'lz-live-portfolio.yaml'));
    expect(readFileSync(join(ws, 'wsp', 'lz-live-portfolio', 'latest.txt'), 'utf-8').trim()).toBe('2026-11-03T12-00-00');
    const text = readFileSync(out.file, 'utf-8');
    expect(text).not.toContain(RAW_BAIT);
    expect(text).not.toContain('res-platform');
    const p = readLatestLzLivePortfolio(ws);
    expect(p?.landing_zones).toHaveLength(2);
    const entries = lzLivePortfolioSummaryEntries(p!);
    for (const e of entries) expect(LandingZoneLiveSummarySchema.safeParse(e).success).toBe(true);
    expect(entries[0]).toMatchObject({ lz_id: 'otc-prod', stale_scopes: ['app-a'], iac_full_pct: 100, checks: { pass: 1, fail: 1, warn: 0 }, run_id: '2026-11-03T08-00-00' });
    expect(entries[1]).toMatchObject({ lz_id: 'aws-lab', excluded_simulated_scopes: ['sim-app'] });
    expect(entries[1]?.simulated).toBeUndefined();
  });
});

describe('swao assess --portfolio --type landing-zone-live (#3584)', () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, deps: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
  };

  it('is Enterprise: the tier gate stops it before anything is written', () => {
    const ws = fixtureWorkspace();
    const { err, deps } = io();
    // #3844: the real guard error; exit 2 with the [LICENSE] block.
    const code = lzLivePortfolioAction({}, { cwd: ws, ...deps, guard: { requireFeature: (k) => { throw new LicenseTierError('enterprise', 'consultant', k); } } });
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('[LICENSE] swao assess --portfolio --type landing-zone-live (Landing Zone Live portfolio) requires an Enterprise licence.');
    expect(err.join('\n')).toContain('Your current tier: consultant');
    expect(readLatestLzLivePortfolio(ws)).toBeNull();
  });

  it('merges, prints the matrix, rebuilds the summary; --include-simulated marks [SIM]', () => {
    const ws = fixtureWorkspace();
    const rebuilt: string[] = [];
    const { out, deps } = io();
    const code = lzLivePortfolioAction({ includeSimulated: true }, { cwd: ws, ...deps, guard: { requireFeature: () => undefined }, rebuildSummary: (w) => rebuilt.push(w), now: () => NOW });
    expect(code).toBe(0);
    expect(rebuilt).toEqual([ws]);
    expect(out.some((l) => l.includes('aws-lab (AWS, Amazon Web Services) [SIM]'))).toBe(true);
    expect(out.at(-1)).toMatch(/portfolio 2026-11-03T12-00-00: 2 landing zone\(s\) merged/);
  });

  it('exits 1 and rebuilds nothing when no landing zone can be merged', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-lz-portfolio-empty-'));
    tmp.push(ws);
    writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: otc-prod', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token', ''].join('\n'));
    const rebuilt: string[] = [];
    const { err, deps } = io();
    expect(lzLivePortfolioAction({}, { cwd: ws, ...deps, guard: { requireFeature: () => undefined }, rebuildSummary: (w) => rebuilt.push(w) })).toBe(1);
    expect(rebuilt).toEqual([]);
    expect(err.join('\n')).toMatch(/no landing zone could be merged/);
    expect(readLatestLzLivePortfolio(ws)).toBeNull();
  });
});

describe('check status unverified in the portfolio matrix (#3864)', () => {
  it('the CLI line counts unverified checks only when there are any', () => {
    const p = buildLzLivePortfolio({ inputs: inputs(fixtureWorkspace()), now: NOW });
    expect(formatLzLivePortfolio(p).some((l) => l.includes('unverified'))).toBe(false);
    const withUnverified = { ...p, landing_zones: p.landing_zones.map((lz, i) => (i === 0 ? { ...lz, checks: { ...lz.checks, 'CPB-ENC-01': 'unverified' as const } } : lz)) };
    expect(formatLzLivePortfolio(withUnverified)[0]).toContain('checks 1 pass, 1 fail, 0 warn, 1 unverified');
  });
});

describe('one tenant tree per landing zone (#3880, Design 123 section 5.6)', () => {
  it('the portfolio entry carries the merged view hierarchy; a landing zone without one has no key', () => {
    const ins = inputs(fixtureWorkspace());
    const otc = ins[0] as Exclude<(typeof ins)[number], { reason: string }>;
    const tree = { source: { calls: ['iam:ListProjects'], partial: false, status: 'ok' as const }, nodes: [{ id: 'dom-1', kind: 'organisation' as const, status: 'observed' as const, policy_refs: [] }], resource_nodes: {}, scope_nodes: { platform: 'dom-1' } };
    otc.merged = { ...otc.merged, estate: { ...otc.merged.estate, hierarchy: tree } };
    const p = buildLzLivePortfolio({ inputs: ins, now: NOW });
    expect(p.landing_zones.find((l) => l.lz_id === 'otc-prod')?.hierarchy).toEqual(tree);
    expect('hierarchy' in p.landing_zones.find((l) => l.lz_id === 'aws-lab')!).toBe(false);
  });
});

// #4050 (Design 120 section 8.4): organisational controls of the merged run.
describe('organisational controls in the portfolio (#4050)', () => {
  it('carries the counts per framework of the run folder, maps them into the summary and prints them; other runs and landing zones have no key', () => {
    const ws = fixtureWorkspace();
    const counts = { satisfied: 3, partial: 2, unknown: 28, n_a: 2 };
    writeFileSync(join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-11-03T08-00-00', 'lz-organisational.json'), JSON.stringify({
      schema: 'lz-organisational-result/1', lz_id: 'otc-prod', run_id: '2026-11-03T08-00-00', generated_at: '2026-11-03T08:00:00Z',
      folder: 'landing-zones/otc-prod/ingestion', documents: { total: 4, readable: 4, matched: 3 },
      frameworks: [{ id: 'DORA', version: '2025-01-17', controls: [], counts }],
    }));
    const p = buildLzLivePortfolio({ inputs: inputs(ws), now: NOW });
    expect(p.landing_zones.find((l) => l.lz_id === 'otc-prod')?.organisational).toEqual({ documents: 4, frameworks: { DORA: counts } });
    expect('organisational' in p.landing_zones.find((l) => l.lz_id === 'aws-lab')!).toBe(false);
    const entries = lzLivePortfolioSummaryEntries(p);
    expect(entries[0]?.organisational).toEqual({ documents: 4, decided: 5, evaluated: 33 });
    for (const e of entries) expect(LandingZoneLiveSummarySchema.safeParse(e).success).toBe(true);
    expect(formatLzLivePortfolio(p)).toContain('  organisational DORA: 3 documented, 2 partly, 28 not evaluated, 2 n/a (4 document(s))');
  });
});
