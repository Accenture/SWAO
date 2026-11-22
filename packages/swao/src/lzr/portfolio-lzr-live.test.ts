// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4351 (run 6): Portfolio LZR reads an LZ Live run as its snapshot source.
// Synthetic run folders in the shape runLzLiveAssessment writes (module-
// landing-zone live/assess.ts: <lz>.<scope>.lz-live-scan.json,
// lz-live-merged.yaml, manifest.json, run-status.json, latest-lz-live.txt),
// built like module-landing-zone live/__tests__/portfolio.test.ts. Neutral
// ids only; no recording, no credential, no network.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { dump as yamlDump } from 'js-yaml';
import { deriveLzScanBaseFields, parseLzLiveScan } from '@swao/core';
import type { LzLiveScan, LzLiveSimulated } from '@swao/core';
import { mergeLzLiveScopes } from '@swao/module-landing-zone';
import { buildLzrFromLiveRun, lzrLiveNotRecorded, readLzrLiveRun, NOT_RECORDED_BY_LZ_LIVE } from './providers/lz-live-run-adapter.js';
import type { LzrLiveRun } from './providers/lz-live-run-adapter.js';
import { detectAdapterConfig, formatPortfolioLzrReport, lzrLiveSelectionFromLabel, lzrSelectionFromLabel, pickedSnapshotMissing, runPortfolioLzr } from './portfolio-lzr.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

const SIM: LzLiveSimulated = { scenario: 'demo', fidelity: 'spec-derived', evidence: ['header'] };
const NOW = new Date('2026-11-03T12:00:00Z');

interface ScanOpts {
  lzId: string;
  provider: string;
  scopeId?: string;
  observedAt: string;
  region: string;
  resources: Array<{ id: string; type: string }>;
  guardrails?: Array<{ type: string; id: string; status: 'pass' | 'fail' | 'unknown' }>;
  quotas?: Array<{ resource: string; limit?: number; used?: number }>;
  checks?: Array<{ id: string; status: 'pass' | 'fail' | 'warn' }>;
  notCollected?: string[];
  simulated?: boolean;
}

function scan(o: ScanOpts): LzLiveScan {
  const meta = {
    lz_id: o.lzId, provider: o.provider, scope_id: o.scopeId ?? 'platform', scope_kind: 'platform' as const, observed_at: o.observedAt,
    driver_version: '0.1.0', read_only: 'verified' as const, read_only_overrides: [], coverage: { readable: [], unreadable: [] },
    frameworks: [], sources: [
      // The sources live/scan.ts collect() records as ok, unless the case marks them not collected.
      ...['regions', 'guardrails', 'inventory:resources', `quotas:${o.region}`, ...(o.provider === 'stackit' ? ['inventory:service-resources'] : [])]
        .filter((name) => !(o.notCollected ?? []).includes(name))
        .map((name) => ({ name, status: 'ok' as const })),
      ...(o.notCollected ?? []).map((name) => ({ name, status: 'not_collected' as const, reason: 'no collector' })),
    ],
    ...(o.simulated ? { simulated: SIM } : {}),
  };
  const offering = { regions: [{ id: o.region, azs: [], status: 'enabled' as const }], services: [] };
  const estate = {
    resources: o.resources, workloads: [], guardrails: o.guardrails ?? [],
    quotas: (o.quotas ?? []).map((q) => ({ region: o.region, ...q })),
    checks: (o.checks ?? []).map((c) => ({ id: c.id, title: c.id, controls: [], status: c.status })),
  };
  return parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate, diff: { new: [], removed: [], status_changes: [] } });
}

function writeRun(ws: string, s: LzLiveScan, runId: string, o: { status?: 'complete' | 'partial' | 'failed'; pointer?: boolean; simulated?: boolean } = {}): void {
  const lzId = s.meta.lz_id;
  const dir = join(ws, 'landing-zones', lzId, 'wsp', 'runs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${lzId}.${s.meta.scope_id}.lz-live-scan.json`), JSON.stringify(s));
  const merged = mergeLzLiveScopes({ lzId, provider: s.meta.provider, scans: [s], registeredScopes: [{ id: s.meta.scope_id, kind: 'platform' }], now: NOW });
  writeFileSync(join(dir, 'lz-live-merged.yaml'), yamlDump(merged));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ schema: 'lz-live-run-manifest/1', lz_id: lzId, provider: s.meta.provider, run_id: runId, finished_at: s.meta.observed_at, simulated: o.simulated === true }));
  writeFileSync(join(dir, 'run-status.json'), JSON.stringify({ status: o.status ?? 'complete', scopes: [] }));
  if (o.pointer !== false && o.status !== 'failed') writeFileSync(join(ws, 'landing-zones', lzId, 'wsp', 'latest-lz-live.txt'), `${runId}\n`);
}

/** A workspace with two apps and four registered landing zones on four providers. */
function workspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lzr-live-'));
  tmp.push(ws);
  for (const app of ['app-one', 'app-two']) mkdirSync(join(ws, 'apps', app), { recursive: true });
  writeFileSync(join(ws, '.swao.yml'), [
    'name: demo', 'landing_zones:',
    '  - id: otc-prod', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token',
    '  - id: stackit-lab', '    provider: stackit', '    scopes:', '      - id: platform', '        kind: platform', '        auth: service-account-key',
    '  - id: aws-sim', '    provider: aws', '    scopes:', '      - id: platform', '        kind: platform', '        auth: session-keys',
    '  - id: azure-new', '    provider: azure', '    scopes:', '      - id: platform', '        kind: platform', '        auth: service-principal-secret',
    '  - id: aws-ready', '    provider: aws', '    scopes:', '      - id: platform', '        kind: platform', '        auth: session-keys',
    '',
  ].join('\n'));

  // OTC: clusters, a database, two VPCs; one failing guardrail; no quota API (Design 120: OTC quotas not verified).
  writeRun(ws, scan({
    lzId: 'otc-prod', provider: 'otc', observedAt: '2026-11-03T08:00:00Z', region: 'eu-de',
    resources: [{ id: 'res-cce-1', type: 'cce.clusters' }, { id: 'res-rds-1', type: 'rds.instances' }, { id: 'res-vpc-1', type: 'vpc.vpcs' }, { id: 'res-vpc-2', type: 'vpc.vpcs' }],
    guardrails: [{ type: 'cts-tracker', id: 'g-1', status: 'pass' }, { type: 'iam-policy', id: 'g-2', status: 'fail' }],
    checks: [{ id: 'LZ-CHK-01', status: 'fail' }, { id: 'LZ-CHK-02', status: 'pass' }],
    notCollected: ['quotas:eu-de'],
  }), '2026-11-03T08-00-00', { status: 'partial' });

  // STACKIT: a PostgreSQL Flex instance, a network; one exhausted quota; no guardrail API.
  writeRun(ws, scan({
    lzId: 'stackit-lab', provider: 'stackit', observedAt: '2026-11-03T09:00:00Z', region: 'eu01',
    resources: [{ id: 'res-pg-1', type: 'postgres-flex.instance' }, { id: 'res-net-1', type: 'iaas.network' }],
    quotas: [{ resource: 'vcpu', limit: 100, used: 100 }, { resource: 'volumes', limit: 50, used: 3 }],
    notCollected: ['guardrails'],
  }), '2026-11-03T09-00-00');

  // AWS simulated: EKS and a VPC; quota limits only (Service Quotas reports no usage).
  writeRun(ws, scan({
    lzId: 'aws-sim', provider: 'aws', observedAt: '2026-11-03T10:00:00Z', region: 'eu-central-1', simulated: true,
    resources: [{ id: 'res-eks-1', type: 'eks.cluster' }, { id: 'res-vpc-1', type: 'ec2.vpc' }],
    guardrails: [{ type: 'aws-scp', id: 'p-1', status: 'pass' }],
    quotas: [{ resource: 'eks:L-1 Clusters', limit: 100 }],
  }), '2026-11-03T10-00-00', { simulated: true });

  // Azure: the only run failed (no pointer).
  writeRun(ws, scan({ lzId: 'azure-new', provider: 'azure', observedAt: '2026-11-03T11:00:00Z', region: 'westeurope', resources: [] }), '2026-11-03T11-00-00', { status: 'failed' });

  // AWS with every LZR block recorded (usage given), to show READY is reachable.
  writeRun(ws, scan({
    lzId: 'aws-ready', provider: 'aws', observedAt: '2026-11-03T10:30:00Z', region: 'eu-central-1',
    resources: [{ id: 'res-eks-1', type: 'eks.cluster' }, { id: 'res-vpc-1', type: 'ec2.vpc' }],
    guardrails: [{ type: 'aws-scp', id: 'p-1', status: 'pass' }],
    quotas: [{ resource: 'eks:L-1 Clusters', limit: 100, used: 2 }],
  }), '2026-11-03T10-30-00');
  return ws;
}

function readRun(ws: string, lzId: string): LzrLiveRun {
  const run = readLzrLiveRun(ws, lzId);
  if (typeof run === 'string') throw new Error(run);
  return run;
}

describe('#4351 live label', () => {
  it('parses live:<lz-id> and keeps it apart from the snapshot labels', () => {
    expect(lzrLiveSelectionFromLabel('live:otc-prod')).toBe('otc-prod');
    expect(lzrLiveSelectionFromLabel(' LIVE:otc-prod ')).toBe('otc-prod');
    expect(lzrLiveSelectionFromLabel('lz-aws-01')).toBeNull();
    expect(lzrLiveSelectionFromLabel('live:')).toBeNull();
    expect(lzrLiveSelectionFromLabel('live:../etc')).toBeNull();
    expect(lzrSelectionFromLabel('live:otc-prod')).toBeNull();
    expect(pickedSnapshotMissing('live:otc-prod')).toBe('no usable LZ Live run of landing zone otc-prod');
  });

  it('a live label never falls back to a snapshot file of the app', () => {
    const ws = workspace();
    const tf = join(ws, 'apps', 'app-one', 'wsp', 'inputs', 'terraform');
    mkdirSync(tf, { recursive: true });
    writeFileSync(join(tf, 'lz-aws-snapshot.json'), JSON.stringify({ vpc_count: 1 }));
    expect(detectAdapterConfig('app-one', join(ws, 'apps', 'app-one'), 'live:otc-prod')).toBeNull();
  });
});

describe('#4351 readLzrLiveRun', () => {
  it('reads the run named by latest-lz-live.txt with status, finish time and provider', () => {
    const run = readRun(workspace(), 'otc-prod');
    expect(run).toMatchObject({ lzId: 'otc-prod', provider: 'otc', runId: '2026-11-03T08-00-00', status: 'partial', finishedAt: '2026-11-03T08:00:00Z', simulated: false });
  });

  it('marks a run served by a mock CSP as simulated', () => {
    expect(readRun(workspace(), 'aws-sim').simulated).toBe(true);
  });

  it('refuses a failed run, an unregistered landing zone and a landing zone without runs', () => {
    const ws = workspace();
    expect(readLzrLiveRun(ws, 'azure-new')).toBe('landing zone azure-new: LZ Live run 2026-11-03T11-00-00 failed');
    expect(readLzrLiveRun(ws, 'nope')).toBe('landing zone nope is not registered in .swao.yml');
    rmSync(join(ws, 'landing-zones', 'stackit-lab'), { recursive: true, force: true });
    expect(readLzrLiveRun(ws, 'stackit-lab')).toBe('landing zone stackit-lab: no live run');
  });
});

describe('#4351 buildLzrFromLiveRun field mapping', () => {
  it('OTC: inventory counted, policy fail is advisory, quotas not recorded, partial run warned', () => {
    const r = buildLzrFromLiveRun(readRun(workspace(), 'otc-prod'), NOW);
    expect(r.provider_id).toBe('otc');
    expect(r.landing_zone_id).toBe('otc-prod');
    expect(r.service_checks.map((s) => [s.service, s.provisioned_in_lz, s.required])).toEqual([
      ['Kubernetes clusters', true, false], ['databases', true, false], ['caches', false, false],
    ]);
    expect(r.network_checks[0]).toMatchObject({ status: 'pass', note: '2 network(s) observed' });
    expect(r.quota_checks).toEqual([{ resource: 'quotas', available: null, status: 'warning', note: `quotas: ${NOT_RECORDED_BY_LZ_LIVE}` }]);
    expect(r.policy_checks.map((p) => [p.rule, p.status])).toEqual([['lz-live-guardrails', 'fail'], ['lz-live-baseline-checks', 'fail']]);
    expect(r.warnings.map((w) => w.check_id).sort()).toEqual(['LZ-POL-LIVE', 'LZ-WARN-LIVE-QUO', 'LZ-WARN-LIVE-RUN']);
    expect(r.blockers).toEqual([]);
    expect(r.overall_verdict).toBe('advisory');
  });

  it('STACKIT: an exhausted quota blocks; clusters and caches and guardrails are not recorded, never passed', () => {
    const run = readRun(workspace(), 'stackit-lab');
    const r = buildLzrFromLiveRun(run, NOW);
    expect(r.blockers.map((b) => b.check_id)).toEqual(['LZ-QUO-LIVE']);
    expect(r.quota_checks.map((q) => [q.resource, q.status, q.available])).toEqual([['vcpu (eu01)', 'blocked', 0], ['volumes (eu01)', 'ok', 47]]);
    expect(r.service_checks.find((s) => s.service === 'Kubernetes clusters')).toMatchObject({ status: 'warning', provisioned_in_lz: null, note: `Kubernetes clusters: ${NOT_RECORDED_BY_LZ_LIVE}` });
    expect(r.service_checks.find((s) => s.service === 'databases')).toMatchObject({ status: 'ready', provisioned_in_lz: true });
    expect(r.policy_checks).toEqual([expect.objectContaining({ status: 'skipped', note: `policy compliance: ${NOT_RECORDED_BY_LZ_LIVE}` })]);
    expect(r.overall_verdict).toBe('blocked');
    expect(lzrLiveNotRecorded(run)).toEqual(['Kubernetes clusters', 'caches', 'policy compliance', 'resource state (running, available)']);
  });

  it('AWS: a quota limit without usage is listed, not judged, and keeps the verdict off READY', () => {
    const r = buildLzrFromLiveRun(readRun(workspace(), 'aws-sim'), NOW);
    expect(r.quota_checks).toEqual([{ resource: 'quotas', available: null, status: 'warning', note: `1 quota limit(s) recorded; usage ${NOT_RECORDED_BY_LZ_LIVE}` }]);
    expect(r.policy_checks[0]).toMatchObject({ status: 'pass' });
    expect(r.overall_verdict).toBe('advisory');
  });

  it('READY only when every block is recorded and clean', () => {
    expect(buildLzrFromLiveRun(readRun(workspace(), 'aws-ready'), NOW)).toMatchObject({ overall_verdict: 'ready', warnings: [], blockers: [] });
  });

  it('a guardrail source a scope could not read keeps the policy row off pass and the verdict off READY', () => {
    const ws = workspace();
    // Application scope login: Organizations (SCPs) not readable, CloudTrail and Config read and passing.
    writeRun(ws, scan({
      lzId: 'aws-ready', provider: 'aws', observedAt: '2026-11-03T11:30:00Z', region: 'eu-central-1',
      resources: [{ id: 'res-vpc-1', type: 'ec2.vpc' }],
      guardrails: [{ type: 'cloudtrail-trail', id: 't-1', status: 'pass' }, { type: 'config-recorder', id: 'c-1', status: 'pass' }],
      quotas: [{ resource: 'eks:L-1 Clusters', limit: 100, used: 2 }],
      notCollected: ['guardrails:organizations'],
    }), '2026-11-03T11-30-00');
    const run = readRun(ws, 'aws-ready');
    const r = buildLzrFromLiveRun(run, NOW);
    expect(r.policy_checks[0]).toMatchObject({ status: 'skipped' });
    expect(r.policy_checks[0]!.note).toContain(`partial: guardrails:organizations ${NOT_RECORDED_BY_LZ_LIVE}`);
    expect(r.warnings.map((w) => w.check_id)).toEqual(['LZ-WARN-LIVE-POL']);
    expect(r.overall_verdict).toBe('advisory');
    expect(lzrLiveNotRecorded(run)).toContain('policy compliance (partial)');
  });

  it('a quota region not read leaves the headroom partial', () => {
    const ws = workspace();
    writeRun(ws, scan({
      lzId: 'stackit-lab', provider: 'stackit', observedAt: '2026-11-03T11:30:00Z', region: 'eu01',
      resources: [{ id: 'res-net-1', type: 'iaas.network' }],
      quotas: [{ resource: 'vcpu', limit: 100, used: 3 }],
      notCollected: ['quotas:eu02', 'guardrails'],
    }), '2026-11-03T11-30-00');
    const run = readRun(ws, 'stackit-lab');
    const r = buildLzrFromLiveRun(run, NOW);
    expect(r.quota_checks.map((q) => q.status)).toEqual(['ok', 'warning']);
    expect(r.warnings.map((w) => w.description)).toContain(`Quotas recorded in part: quotas:eu02 ${NOT_RECORDED_BY_LZ_LIVE}`);
    expect(lzrLiveNotRecorded(run)).toContain('quotas (partial)');
  });

  it('STACKIT databases come from the service inventory: not collected there means not recorded, not zero', () => {
    const ws = workspace();
    writeRun(ws, scan({
      lzId: 'stackit-lab', provider: 'stackit', observedAt: '2026-11-03T11:30:00Z', region: 'eu01',
      resources: [{ id: 'res-net-1', type: 'iaas.network' }],
      quotas: [{ resource: 'vcpu', limit: 100, used: 3 }],
      notCollected: ['inventory:service-resources', 'guardrails'],
    }), '2026-11-03T11-30-00');
    const run = readRun(ws, 'stackit-lab');
    const r = buildLzrFromLiveRun(run, NOW);
    expect(r.service_checks.find((s) => s.service === 'databases')).toMatchObject({ status: 'warning', provisioned_in_lz: null, note: `databases: ${NOT_RECORDED_BY_LZ_LIVE}` });
    expect(r.network_checks[0]).toMatchObject({ status: 'pass' });
    expect(lzrLiveNotRecorded(run)).toContain('databases');
  });

  it('an inventory the run did not collect is not recorded, not zero', () => {
    const ws = workspace();
    writeRun(ws, scan({ lzId: 'aws-ready', provider: 'aws', observedAt: '2026-11-03T11:30:00Z', region: 'eu-central-1', resources: [], guardrails: [{ type: 'aws-scp', id: 'p-1', status: 'pass' }], notCollected: ['inventory:resources'] }), '2026-11-03T11-30-00');
    const r = buildLzrFromLiveRun(readRun(ws, 'aws-ready'), NOW);
    expect(r.network_checks[0]).toMatchObject({ status: 'skipped', note: `networks: ${NOT_RECORDED_BY_LZ_LIVE}` });
    expect(r.service_checks.every((s) => s.status === 'warning' && s.provisioned_in_lz === null)).toBe(true);
  });
});

describe('#4351 runPortfolioLzr with an LZ Live run', () => {
  it('evaluates the picked live run once for every app and records the source', async () => {
    const ws = workspace();
    const summary = await runPortfolioLzr(ws, 'live:otc-prod');
    expect(summary.total_apps).toBe(2);
    expect(summary.apps.map((a) => a.app_id)).toEqual(['app-one', 'app-two']);
    const row = summary.apps[0]!;
    expect(row).toMatchObject({
      verdict: 'advisory', provider_id: 'otc', provider_map_id: 'otc', landing_zone_id: 'otc-prod', picker_label: 'live:otc-prod',
      source_kind: 'lz-live-run', source_snapshot: 'landing-zones/otc-prod/wsp/runs/2026-11-03T08-00-00/',
      live_run: { lz_id: 'otc-prod', run_id: '2026-11-03T08-00-00', status: 'partial', finished_at: '2026-11-03T08:00:00Z', folder: 'landing-zones/otc-prod/wsp/runs/2026-11-03T08-00-00/' },
    });
    expect(row.provider_label).toBe('OTC, T Cloud Public');
    expect(row.lzr_snapshot_fabricated).toBeUndefined();
    expect(row.not_recorded).toContain('quotas');
    expect(summary.overall_verdict).toBe('advisory');
  });

  it('marks a simulated live run [SIM] in the report and names what is not recorded', async () => {
    const summary = await runPortfolioLzr(workspace(), 'live:aws-sim');
    expect(summary.apps[0]!.lzr_snapshot_fabricated).toBe(true);
    const text = formatPortfolioLzrReport(summary);
    expect(text).toContain('ADVISORY [SIM]');
    expect(text).toContain('app-one: LZ Live run 2026-11-03T10-00-00 of aws-sim (complete, finished 2026-11-03T10:00:00Z)');
    expect(text).toContain('simulated (mock CSP)');
    expect(text).toContain('Not recorded by LZ Live: quota usage, resource state (running, available).');
    expect(text).toContain('[SIM]: the LZ Live run was served by a mock CSP environment');
    expect(text).not.toContain(' -- ');
  });

  it('skips every app with the reason when the live run is unusable, never another source', async () => {
    const ws = workspace();
    const tf = join(ws, 'apps', 'app-one', 'wsp', 'inputs', 'terraform');
    mkdirSync(tf, { recursive: true });
    writeFileSync(join(tf, 'lz-aws-snapshot.json'), JSON.stringify({ vpc_count: 1 }));
    const summary = await runPortfolioLzr(ws, 'live:azure-new');
    expect(summary.counts).toEqual({ ready: 0, advisory: 0, blocked: 0, skipped: 2 });
    expect(summary.apps[0]).toMatchObject({ verdict: 'skipped', source_kind: 'lz-live-run', skip_reason: 'landing zone azure-new: LZ Live run 2026-11-03T11-00-00 failed' });
  });
});
