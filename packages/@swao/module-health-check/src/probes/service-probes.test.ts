// Phase 10 suite (#3127-#3134; Design 103 §19.4).
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump, load } from 'js-yaml';
import {
  apmFrameworkDir,
  buildPortfolioSummary,
  loadInfraCatalogue,
  parseIntakeSheets,
  planScaffold,
  recordPortfolioDelta,
  writeScaffold,
  type SheetLike,
} from '@swao/module-service-assessment';
import {
  buildClusterDetectionProbe,
  buildDeltaSnapshotProbe,
  buildFrameworkControlsProbe,
  buildPiiScrubAuditProbe,
  buildResearchCacheProbe,
  buildServiceProbes,
  runServiceProbes,
  SERVICE_PROBE_RUNNERS,
  buildServiceWorkspaceProbe,
  buildVendorCatalogProbe,
  formatServiceProbeLine,
  looksLikePhone,
  PROBE_TOTAL,
} from './service-probes.js';
import { buildApmWeightsProbe } from './apm-weights-probe.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const NOW = new Date('2026-10-10T08:00:00Z');
const PII = ['erika@example.org', '+49-123-456789', 'Erika Musterfrau'];

const HEADERS = ['App ID', 'App Name', 'Vendor', 'Version', 'OS', 'CPU Cores', 'Memory (MB)', 'Disks', 'Total Disk (GB)', 'Department', 'Migration Candidate', 'Contact', 'Phone', 'Email', 'Integration Dependencies'];
type Row = Array<string | number | null>;
const ROWS: Row[] = [
  ['HOSAPP133', 'Radimetrics', 'Example Dose Vendor GmbH', '9.1', 'Windows Server 2016', 4, 8192, 2, 143, 'Radiologie', 'YES', PII[2]!, PII[1]!, PII[0]!, 'HOSAPP200'],
  ['HOSAPP200', 'Imaging Viewer', 'FUJIFILM', '7.2', 'Windows Server 2019', 2, 8192, 1, 100, 'Radiologie', 'NO', null, null, null, null],
  ...[1, 2, 3, 4].map((n): Row => [`HOSCIX00${n}`, 'Citrix Worker', 'Citrix', null, 'Windows Server 2019', 8, 32768, 1, 120, 'IT', 'YES', null, null, null, null]),
  ['HOSAPP045', 'Payroll Suite', null, null, 'Windows Server 2012 R2', 2, 4096, 1, 60, 'Personal', 'NO', null, null, null, null],
];

const sheet = (rows: Row[]): SheetLike => ({
  name: 'Inventory',
  rowCount: rows.length + 1,
  cell: (r, c) => (r === 1 ? HEADERS[c - 1] : rows[r - 2]?.[c - 1] ?? null),
});

/** A clean service workspace: scaffolded, researched, summarised, snapshotted. */
function cleanWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-svc-probes-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
  const catalogue = loadInfraCatalogue({ workspacePath: ws });
  const intake = parseIntakeSheets([sheet(ROWS)], { knownVendors: catalogue.services.flatMap((s) => s.vendor_patterns ?? []), sourceLabel: 'intake.xlsx' });
  const plan = planScaffold(intake.rows, catalogue, { clusterThreshold: 3 });
  writeScaffold(ws, plan.apps, [...intake.signals, ...plan.signals], {
    source: 'intake.xlsx', mapping: null, imported_at: '2026-10-10', app_count: plan.apps.length, row_count: intake.rows.length,
    sheets: ['Inventory'], headers: {}, pii_columns: ['L', 'M', 'N'], cluster_threshold: 3,
  });
  for (const a of plan.apps) {
    const r = join(ws, 'apps', a.appId, 'wsp', 'inputs', 'research');
    mkdirSync(r, { recursive: true });
    const retrieved = new Date(NOW.getTime() - 5 * 86_400_000).toISOString();
    writeFileSync(join(r, 'cve-summary.md'), `---\n${dump({ topic: 'cve-summary', app_id: a.appId, retrieved_at: retrieved, cve: { source: 'nvd', count: 0, critical_count: 0, high_count: 0, kev_match: false, top: [] } })}---\n`);
    writeFileSync(join(r, 'eol-status.md'), `---\n${dump({ topic: 'eol-status', app_id: a.appId, retrieved_at: retrieved, eol: { source: 'endoflife.date', is_eol: false, months_until_eol: 40, date: '2030-01-01' } })}---\n`);
    writeFileSync(join(r, 'confidence.json'), JSON.stringify({ app_id: a.appId, generated_at: retrieved, composite: 'medium', topics: {} }));
  }
  const summary = buildPortfolioSummary(ws, { now: NOW });
  recordPortfolioDelta(ws, summary, new Date(NOW.getTime() - 86_400_000));
  mkdirSync(join(ws, 'wsp', 'inputs', 'catalogs', 'infra-cat'), { recursive: true });
  writeFileSync(join(ws, 'wsp', 'inputs', 'catalogs', 'infra-cat', 'engagement.yaml'), dump({
    id: 'engagement', services: [{ id: 'INFRA_CUSTOM_LAB', name: 'Lab system', vendor_patterns: ['Example Lab'], product_name_patterns: ['\\bLabor\\b'] }],
  }));
  return ws;
}

function applicationWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-app-probes-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nengagement:\n  name: app\n');
  mkdirSync(join(ws, 'apps', 'demo-app'), { recursive: true });
  writeFileSync(join(ws, 'apps', 'demo-app', '.swao.yml'), 'app_id: demo-app\nassessment:\n  type: application\nsupport: ops@example.org\n');
  return ws;
}

const appYml = (ws: string, id: string) => join(ws, 'apps', id, '.swao.yml');
const editApp = (ws: string, id: string, fn: (d: Record<string, any>) => void) => {
  const d = load(readFileSync(appYml(ws, id), 'utf-8')) as Record<string, any>;
  fn(d);
  writeFileSync(appYml(ws, id), dump(d));
};

describe('clean service workspace (#3134)', () => {
  it('every new probe passes and the probe total is 25 including the SWAO_APM weights probe', () => {
    const ws = cleanWorkspace();
    const probes = buildServiceProbes(ws, NOW);
    expect(probes.map((p) => [p.key, p.status, p.message])).toEqual(probes.map((p) => [p.key, 'ok', p.message]));
    expect(probes).toHaveLength(7);
    expect(PROBE_TOTAL).toBeGreaterThanOrEqual(20);
    expect(buildApmWeightsProbe(ws).status).toBe('ok');
    expect(formatServiceProbeLine(probes[0]!, 0)).toMatch(/^ {2}\[19\/25\] Service workspace\.{2,} {2}ok {4}\d+ service app/);
    expect(formatServiceProbeLine(probes[6]!, 6)).toMatch(/\[25\/25\] SWAO_APM controls/);
  });

  it('reports the detected cluster', () => {
    expect(buildClusterDetectionProbe(cleanWorkspace()).message).toMatch(/^1 cluster\(s\) detected: hoscix-cluster \(4 apps\)$/);
  });
});

describe('application workspace (#3134)', () => {
  it('all probes skip without false positives', () => {
    const probes = buildServiceProbes(applicationWorkspace(), NOW);
    expect(probes.every((p) => p.status === 'skip' && p.message === 'not a service workspace')).toBe(true);
  });
});

describe('service workspace before init (#3134)', () => {
  it('reports missing scaffold as an error and skips the per-app probes', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-svc-empty-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nservice_portfolio:\n  source: intake.xlsx\n');
    const [workspace, research, , , pii] = buildServiceProbes(ws, NOW);
    expect(workspace!.status).toBe('error');
    expect(research).toMatchObject({ status: 'skip', message: 'no service apps yet (run swao service init)' });
    expect(pii!.status).toBe('skip');
  });
});

describe('service-workspace probe (#3127)', () => {
  it('errors on a missing app folder and names the app ID', () => {
    const ws = cleanWorkspace();
    rmSync(join(ws, 'apps', 'hosapp045'), { recursive: true, force: true });
    const p = buildServiceWorkspaceProbe(ws);
    expect(p.status).toBe('error');
    expect(p.message).toContain('app folder missing for hosapp045');
  });

  it('errors on an invalid summary and on an invalid app config', () => {
    const ws = cleanWorkspace();
    writeFileSync(join(ws, 'wsp', 'portfolio-summary.json'), '{"apps": "nope"}');
    editApp(ws, 'hosapp200', (d) => { d['vendor_type'] = 'mainframe'; });
    const p = buildServiceWorkspaceProbe(ws);
    expect(p.errors).toEqual(['invalid apps/<id>/.swao.yml for hosapp200', 'wsp/portfolio-summary.json does not match the portfolio summary schema']);
  });

  it('warns when service apps come from more than one intake source (#3521)', () => {
    const ws = cleanWorkspace();
    editApp(ws, 'hosapp200', (d) => { d['intake']['source'] = 'second.xlsx'; d['intake']['source_sha256'] = 'b'.repeat(64); });
    const p = buildServiceWorkspaceProbe(ws);
    expect(p.status).toBe('warn');
    expect(p.message).toMatch(/service apps come from 2 intake sources: \(source not recorded\) \(\d+\), second\.xlsx \(1\)/);
    expect(p.message).toContain('swao service init --replace');
  });

  it('warns when the app count differs from service_portfolio.app_count (#3521)', () => {
    const ws = cleanWorkspace();
    mkdirSync(join(ws, 'apps', 'extra001'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'extra001', '.swao.yml'), readFileSync(appYml(ws, 'hosapp200'), 'utf-8').replace(/app_id: hosapp200/, 'app_id: extra001'));
    const p = buildServiceWorkspaceProbe(ws);
    expect(p.warnings.some((w) => /service app folder\(s\) under apps\/, but service_portfolio\.app_count is \d+/.test(w))).toBe(true);
  });
});

describe('research-cache probe (#3128)', () => {
  it('errors on a missing stub, warns on a stale stub and missing confidence, passes when fresh', () => {
    const ws = cleanWorkspace();
    expect(buildResearchCacheProbe(ws, NOW).status).toBe('ok');
    expect(buildResearchCacheProbe(ws, new Date(NOW.getTime() + 40 * 86_400_000)).message).toMatch(/Research stub stale \(> 30 days\) for .*run swao service research --refresh/);
    rmSync(join(ws, 'apps', 'hosapp200', 'wsp', 'inputs', 'research', 'confidence.json'));
    expect(buildResearchCacheProbe(ws, NOW)).toMatchObject({ status: 'warn', message: 'Confidence data missing for hosapp200' });
    rmSync(join(ws, 'apps', 'hosapp045', 'wsp', 'inputs', 'research', 'eol-status.md'));
    expect(buildResearchCacheProbe(ws, NOW)).toMatchObject({ status: 'error', errors: ['Research stub missing for app hosapp045 - run swao service research'] });
  });
});

describe('vendor-catalog probe (#3129)', () => {
  const t2 = (ws: string) => join(ws, 'wsp', 'inputs', 'catalogs', 'infra-cat');
  it('errors on a regex that does not compile and warns on a duplicate category', () => {
    const ws = cleanWorkspace();
    writeFileSync(join(t2(ws), 'zz-extra.yaml'), dump({ services: [
      { id: 'INFRA_CUSTOM_LAB', name: 'Lab again', vendor_patterns: ['Lab'] },
      { id: 'INFRA_CUSTOM_BAD', name: 'Bad', product_name_patterns: ['(unclosed'] },
    ] }));
    const p = buildVendorCatalogProbe(ws);
    expect(p.status).toBe('error');
    expect(p.errors).toEqual(['zz-extra.yaml: INFRA_CUSTOM_BAD product_name_patterns regex does not compile']);
    expect(p.warnings).toEqual(['INFRA_CUSTOM_LAB defined in both engagement.yaml and zz-extra.yaml (last file wins)']);
  });

  it('skips when there is no Tier 2 catalogue', () => {
    const ws = cleanWorkspace();
    rmSync(t2(ws), { recursive: true, force: true });
    expect(buildVendorCatalogProbe(ws)).toMatchObject({ status: 'skip', message: 'no Tier 2 catalogue (optional)' });
  });
});

describe('cluster-detection probe (#3130)', () => {
  it('warns on a cluster with no members', () => {
    const ws = cleanWorkspace();
    editApp(ws, 'hoscix-cluster', (d) => { d['cluster_members'] = []; });
    expect(buildClusterDetectionProbe(ws)).toMatchObject({ status: 'warn', warnings: ['cluster hoscix-cluster has no cluster_members'] });
  });
});

describe('pii-scrub-audit probe (#3131)', () => {
  it('passes on the scrubbed scaffold (booleans only for contact columns)', () => {
    const ws = cleanWorkspace();
    expect((load(readFileSync(appYml(ws, 'hosapp133'), 'utf-8')) as any).vendor.support_contact_present).toBe(true);
    expect(buildPiiScrubAuditProbe(ws).status).toBe('ok');
  });

  it('errors with file and field path but never the value', () => {
    const ws = cleanWorkspace();
    editApp(ws, 'hosapp133', (d) => { d['integrations_notes'] = `call ${PII[1]} or mail ${PII[0]}`; d['vendor']['support_email_present'] = 'yes'; });
    editApp(ws, 'hosapp200', (d) => { d['business']['function'] = 'Hotline 030 1234 5678'; });
    const p = buildPiiScrubAuditProbe(ws);
    expect(p.status).toBe('error');
    expect(p.errors).toEqual([
      'apps/hosapp133/.swao.yml: integrations_notes (e-mail), vendor.support_email_present (must be boolean)',
      'apps/hosapp200/.swao.yml: business.function (phone)',
    ]);
    for (const v of PII) expect(JSON.stringify(p)).not.toContain(v);
  });

  it('does not treat dates, versions, or IP addresses as phone numbers', () => {
    for (const s of ['2026-10-10', '2026-10-10T08:00:00.000Z', '9.1.20231', '10.20.30.40', 'Windows Server 2012 R2']) expect(looksLikePhone(s)).toBe(false);
    for (const s of ['+49 30 1234567', '+49-123-456789', '(030) 1234 5678', '0301234567890']) expect(looksLikePhone(s)).toBe(true);
  });
});

describe('delta-snapshot probe (#3132)', () => {
  const snap = (ws: string, name: string) => {
    mkdirSync(join(ws, 'wsp', 'snapshots'), { recursive: true });
    writeFileSync(join(ws, 'wsp', 'snapshots', name), '{"apps":[]}');
  };
  it('warns at 95 days, passes at 30 days, informs when there is no snapshot', () => {
    const ws = cleanWorkspace();
    rmSync(join(ws, 'wsp', 'snapshots'), { recursive: true, force: true });
    expect(buildDeltaSnapshotProbe(ws, NOW)).toMatchObject({ status: 'skip', message: 'No portfolio snapshots yet - baseline will be established on first run' });
    snap(ws, 'portfolio-summary-20260910-080000.json');
    expect(buildDeltaSnapshotProbe(ws, NOW).status).toBe('ok');
    expect(buildDeltaSnapshotProbe(ws, new Date('2026-12-14T08:00:00Z')).message).toBe('Portfolio snapshot is 95 days old - run swao service research to refresh');
  });

  it('warns when more than 4 snapshots exist', () => {
    const ws = cleanWorkspace();
    for (const d of ['01', '02', '03', '04', '05']) snap(ws, `portfolio-summary-202610${d}-080000.json`);
    expect(buildDeltaSnapshotProbe(ws, NOW).warnings).toContain('6 snapshots found (max 4) - oldest should be pruned by runtime');
  });
});

describe('framework-controls probe (#3133)', () => {
  const override = (ws: string, controls: unknown[]) => {
    const dir = join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'swao-apm');
    mkdirSync(dir, { recursive: true });
    const bundled = apmFrameworkDir()!.dir;
    writeFileSync(join(dir, 'framework-meta.yaml'), readFileSync(join(bundled, 'framework-meta.yaml')));
    writeFileSync(join(dir, 'controls.yaml'), dump({ controls }));
  };
  const ctl = (id: string) => ({ id, title: `Control ${id}`, evidence_basis: [{ apm_export: 'x' }] });
  const DOMAINS = ['STR', 'VND', 'TCH', 'SEC', 'DAT', 'SOV', 'BIZ', 'HW', 'INT', 'MIG', 'REG'];
  const full = (skip?: string, thin?: string) => DOMAINS.filter((d) => d !== skip).flatMap((d) => Array.from({ length: d === thin ? 3 : 5 }, (_, i) => ctl(`APM-${d}-0${i + 1}`)));

  it('passes on the bundled framework', () => {
    expect(buildFrameworkControlsProbe(cleanWorkspace())).toMatchObject({ status: 'ok' });
  });

  it('errors on a missing domain and duplicate IDs, warns on a domain with 3 controls', () => {
    const ws = cleanWorkspace();
    override(ws, full('REG'));
    expect(buildFrameworkControlsProbe(ws).errors).toEqual(['domains without controls: APM-REG']);
    override(ws, [...full(undefined, 'HW'), ctl('APM-STR-01')]);
    const p = buildFrameworkControlsProbe(ws);
    expect(p.errors).toEqual(['duplicate control IDs: APM-STR-01']);
    expect(p.warnings).toEqual(['domains with fewer than 4 controls: APM-HW (3)']);
  });
});

describe('runServiceProbes event sequence (#3171)', () => {
  it('emits probe.start before probe.complete for each of the seven probes with per-probe elapsed_ms', () => {
    const events: Array<{ code: string; probe: unknown; elapsed: unknown }> = [];
    let tick = 1000;
    const clock = () => { tick += 4; return tick; };
    const seen: string[] = [];
    const probes = runServiceProbes(
      applicationWorkspace(),
      (_level, code, _message, opts) => { events.push({ code, probe: opts.context['probe'], elapsed: opts.context['elapsed_ms'] }); },
      (sp, i) => { seen.push(`${i}:${sp.key}`); },
      NOW,
      clock,
    );
    const keys = SERVICE_PROBE_RUNNERS.map((r) => r.key);
    expect(keys).toEqual(['service_workspace', 'research_cache', 'vendor_catalog', 'cluster_detection', 'pii_scrub_audit', 'delta_snapshot', 'framework_controls']);
    expect(probes.map((p) => p.key)).toEqual(keys);
    expect(events.map((e) => `${e.code}:${String(e.probe)}`)).toEqual(
      keys.flatMap((k) => [`health-check.probe.start:${k}`, `health-check.probe.complete:${k}`]),
    );
    // Each probe is timed on its own (one clock tick), not from a shared batch start.
    const completes = events.filter((e) => e.code === 'health-check.probe.complete');
    expect(completes.map((e) => e.elapsed)).toEqual(keys.map(() => 4));
    expect(seen).toEqual(keys.map((k, i) => `${i}:${k}`));
  });

  it('buildServiceProbes and runServiceProbes return the same results', () => {
    const ws = applicationWorkspace();
    expect(runServiceProbes(ws, () => {}, undefined, NOW)).toEqual(buildServiceProbes(ws, NOW));
  });
});
