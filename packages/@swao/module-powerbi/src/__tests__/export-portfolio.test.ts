// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Power BI module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { load } from 'js-yaml';
import { writePortfolioStarExport, buildPortfolioIndex } from '../exports/star.js';
import type { PortfolioStarTables } from '../exports/star.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-portfolio-'));
  mkdirSync(join(tmp, 'apps'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeAppFixture(appId: string, opts: { signals: Array<{ id: string; severity?: string; outcome?: string; passNum?: string }>; controls: Array<{ id: string; outcome: string; severity?: string }>; sevenR: string; portability: number }): void {
  const appDir = join(tmp, 'apps', appId);
  mkdirSync(join(appDir, 'wsp', 'passes'), { recursive: true });

  writeFileSync(
    join(appDir, 'wsp', 'wsp.yaml'),
    `wsp_version: "0.10"
app:
  id: ${appId}
  name: ${appId}
overall:
  seven_r_label: ${opts.sevenR}
  portability_score: ${opts.portability}
  coverage_score: 0.85
assessed_at: "2026-05-09T13:00:00Z"
`,
    'utf-8',
  );

  const regimeControls = opts.controls.map((c) => `        - id: ${c.id}
          outcome: ${c.outcome}
          severity: ${c.severity ?? 'medium'}
          rationale: Long enough rationale for the v0.10 min length constraint`).join('\n');
  writeFileSync(
    join(appDir, 'wsp', 'wsp-plan.yaml'),
    `migration_plan:
  runbook: []
risk_register: []
value_case: []
compliance:
  regimes:
    - id: GDPR
      version: "2018-05"
      controls:
${regimeControls}
security_findings: []
assumptions: []
data_gaps: []
`,
    'utf-8',
  );

  // signals.yaml split by passNum
  const byPass = new Map<string, typeof opts.signals>();
  for (const s of opts.signals) {
    const num = s.passNum ?? '01';
    if (!byPass.has(num)) byPass.set(num, []);
    byPass.get(num)!.push(s);
  }
  for (const [num, signals] of byPass) {
    const sigBlock = signals.map((s) => `  - id: ${s.id}
    source: static_analysis
    category: application
    severity: ${s.severity ?? 'medium'}
    outcome: ${s.outcome ?? 'negative'}
    confidence: high
    derivation: Long enough derivation string for the v0.10 min length constraint
    evidence: []
    assessor: rule_engine
    assessed_at: "2026-05-09T13:00:00Z"`).join('\n');
    writeFileSync(
      join(appDir, 'wsp', 'passes', `${num}-pass.yaml`),
      `pass:
  id: ${parseInt(num, 10)}
  name: pass${num}
  status: complete
  iter: 1
signals:
${sigBlock}
assessment: {}
`,
      'utf-8',
    );
  }
}

describe('writePortfolioStarExport (#0186)', () => {
  it('emits wsp/exports/<ts>/ with all 20 fact + dim + link CSV files', () => {
    writeAppFixture('alpha', { signals: [{ id: 'INV-01' }], controls: [{ id: 'GDPR_Art_32', outcome: 'PARTIAL' }], sevenR: 'Replatform', portability: 0.7 });
    const r = writePortfolioStarExport({ workspaceRoot: tmp, timestamp: '2026-05-09T1500' });
    expect(r.bundleDir).toMatch(/wsp[\\/]exports[\\/]2026-05-09T1500$/);
    const files = readdirSync(join(r.bundleDir, 'star')).sort();
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files).toContain('fact_app_heatmap.csv');
    expect(files).toContain('fact_app_summary.csv');
    expect(files).toContain('dim_wave.csv');
  });

  it('discovers all apps under apps/ and includes them all', () => {
    writeAppFixture('alpha', { signals: [{ id: 'INV-01' }], controls: [{ id: 'GDPR_Art_32', outcome: 'PARTIAL' }], sevenR: 'Replatform', portability: 0.7 });
    writeAppFixture('beta', { signals: [{ id: 'INV-01' }], controls: [{ id: 'GDPR_Art_5', outcome: 'GAP' }], sevenR: 'Refactor', portability: 0.4 });
    writeAppFixture('gamma', { signals: [{ id: 'INV-01' }], controls: [], sevenR: 'Rehost', portability: 0.9 });
    const r = writePortfolioStarExport({ workspaceRoot: tmp, timestamp: '2026-05-09T1500' });
    expect(r.apps).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('returns zero apps cleanly when no apps/ are present', () => {
    rmSync(join(tmp, 'apps'), { recursive: true, force: true });
    const r = writePortfolioStarExport({ workspaceRoot: tmp, timestamp: '2026-05-09T1500' });
    expect(r.apps).toEqual([]);
    // All fact CSVs are emitted (empty) so the PowerBI template still loads.
    expect(readdirSync(join(r.bundleDir, 'star')).length).toBeGreaterThanOrEqual(20);
  });

  it('fact_app_heatmap aggregates outcome counts per (app, regime) from fact_controls', () => {
    writeAppFixture('alpha', {
      signals: [],
      controls: [
        { id: 'GDPR_Art_32', outcome: 'PARTIAL', severity: 'high' },
        { id: 'GDPR_Art_5', outcome: 'GAP', severity: 'critical' },
        { id: 'GDPR_Art_9', outcome: 'SATISFIED' },
      ],
      sevenR: 'Replatform',
      portability: 0.7,
    });
    const r = writePortfolioStarExport({ workspaceRoot: tmp, timestamp: '2026-05-09T1500' });
    // eslint-disable-next-line no-irregular-whitespace
    const csv = readFileSync(join(r.bundleDir, 'star', 'fact_app_heatmap.csv'), 'utf-8').replace(/^﻿/, '');
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2); // header + 1 row (alpha,GDPR)
    expect(lines[1]).toMatch(/^alpha,GDPR,1,1,1,0,0,/);
  });

  it('fact_app_summary surfaces 7R, scores, and per-app risk metrics', () => {
    writeAppFixture('alpha', {
      signals: [
        { id: 'INV-01', severity: 'high', outcome: 'negative' },
        { id: 'INV-02', severity: 'critical', outcome: 'negative' },
        { id: 'INV-03', severity: 'low', outcome: 'positive' },
      ],
      controls: [{ id: 'GDPR_Art_32', outcome: 'PARTIAL' }],
      sevenR: 'Replatform',
      portability: 0.7,
    });
    const r = writePortfolioStarExport({ workspaceRoot: tmp, timestamp: '2026-05-09T1500' });
    // eslint-disable-next-line no-irregular-whitespace
    const csv = readFileSync(join(r.bundleDir, 'star', 'fact_app_summary.csv'), 'utf-8').replace(/^﻿/, '');
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^alpha,Replatform,/);
    // total_negative_signals = 2; weighted_risk_score = severity ranks (high=4 + critical=5) = 9
    expect(lines[1]).toMatch(/2,9$/);
  });

  it('fact_signals concatenates rows across all apps; app_id distinguishes them', () => {
    writeAppFixture('alpha', { signals: [{ id: 'INV-01' }, { id: 'INV-02' }], controls: [], sevenR: 'Replatform', portability: 0.7 });
    writeAppFixture('beta', { signals: [{ id: 'INV-01' }], controls: [], sevenR: 'Rehost', portability: 0.9 });
    const r = writePortfolioStarExport({ workspaceRoot: tmp, timestamp: '2026-05-09T1500' });
    // eslint-disable-next-line no-irregular-whitespace
    const csv = readFileSync(join(r.bundleDir, 'star', 'fact_signals.csv'), 'utf-8').replace(/^﻿/, '');
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(4); // header + 2 alpha + 1 beta
    expect(lines.filter((l) => l.includes(',alpha,'))).toHaveLength(2);
    expect(lines.filter((l) => l.includes(',beta,'))).toHaveLength(1);
  });

  it('manifest.yaml carries the apps roll-up summary and per-file SHA-256 hashes', () => {
    writeAppFixture('alpha', { signals: [{ id: 'INV-01' }], controls: [{ id: 'GDPR_Art_32', outcome: 'PARTIAL' }], sevenR: 'Replatform', portability: 0.7 });
    writeAppFixture('beta', { signals: [{ id: 'INV-01' }], controls: [], sevenR: 'Rehost', portability: 0.9 });
    const r = writePortfolioStarExport({ workspaceRoot: tmp, timestamp: '2026-05-09T1500' });
    const manifest = load(readFileSync(join(r.bundleDir, 'manifest.yaml'), 'utf-8')) as {
      bundle_schema_version: string;
      app_id: string;
      files: Array<{ path: string; rows: number; sha256: string }>;
    };
    expect(manifest.app_id).toBe('portfolio (2 apps)');
    // Accepts >= 20 so adding new star tables does not break this gate.
    // As of sprint-054: 21 tables (compliance_matrix added).
    expect(manifest.files.length).toBeGreaterThanOrEqual(20);
    for (const f of manifest.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('dim_wave is emitted as Tier-2 stub (zero rows, post-PoC #0068)', () => {
    writeAppFixture('alpha', { signals: [{ id: 'INV-01' }], controls: [], sevenR: 'Replatform', portability: 0.7 });
    const r = writePortfolioStarExport({ workspaceRoot: tmp, timestamp: '2026-05-09T1500' });
    // eslint-disable-next-line no-irregular-whitespace
    const csv = readFileSync(join(r.bundleDir, 'star', 'dim_wave.csv'), 'utf-8').replace(/^﻿/, '');
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1); // header only
    expect(lines[0]).toMatch(/wave_number,name,target_quarter,selection_criteria/);
  });

  it('writes a top-level README.md naming each app in the bundle', () => {
    writeAppFixture('alpha', { signals: [{ id: 'INV-01' }], controls: [], sevenR: 'Replatform', portability: 0.7 });
    writeAppFixture('beta', { signals: [{ id: 'INV-01' }], controls: [], sevenR: 'Rehost', portability: 0.9 });
    const r = writePortfolioStarExport({ workspaceRoot: tmp, timestamp: '2026-05-09T1500' });
    const readme = readFileSync(join(r.bundleDir, 'README.md'), 'utf-8');
    expect(readme).toMatch(/portfolio BI export bundle/);
    expect(readme).toMatch(/Apps included: 2/);
    expect(readme).toMatch(/- alpha/);
    expect(readme).toMatch(/- beta/);
    expect(readme).toMatch(/Tier 2 facts/);
  });

  it('writePortfolioStarExport emits portfolio-index.json and returns indexPath (#1190)', () => {
    writeAppFixture('alpha', {
      signals: [{ id: 'INV-01', severity: 'high', outcome: 'negative' }],
      controls: [{ id: 'GDPR_Art_32', outcome: 'PARTIAL' }],
      sevenR: 'Replatform',
      portability: 0.7,
    });
    writeAppFixture('beta', {
      signals: [],
      controls: [{ id: 'GDPR_Art_5', outcome: 'SATISFIED' }],
      sevenR: 'Rehost',
      portability: 0.9,
    });
    const r = writePortfolioStarExport({ workspaceRoot: tmp, timestamp: '2026-05-09T1500' });
    expect(r.indexPath).toContain('portfolio-index.json');
    const index = JSON.parse(readFileSync(r.indexPath, 'utf-8')) as {
      built_at: string;
      schema_version: string;
      apps: Array<{ app_id: string; seven_r_label: string; lz_verdict: string | null }>;
    };
    expect(index.schema_version).toBe('1.0');
    expect(index.built_at).toBeTruthy();
    expect(index.apps.map((a) => a.app_id).sort()).toEqual(['alpha', 'beta']);
    const alphaEntry = index.apps.find((a) => a.app_id === 'alpha');
    expect(alphaEntry?.seven_r_label).toBe('Replatform');
    expect(alphaEntry?.lz_verdict).toBeNull(); // no lzr-summary.json in this fixture
  });
});

function makeMinimalPortfolioStarTables(): PortfolioStarTables {
  const empty = (): { header: string[]; rows: unknown[][] } => ({ header: [], rows: [] });
  const summaryHeader = ['app_id', 'seven_r_label', 'modernization_position', 'portability_score', 'coverage_score', 'total_negative_signals', 'weighted_risk_score'];
  const heatmapHeader = ['app_id', 'regime', 'satisfied', 'partial', 'gap', 'unknown', 'n_a', 'weighted_gap'];
  const risksHeader = ['risk_id', 'app_id', 'category', 'likelihood', 'impact', 'trigger', 'mitigation', 'owner', 'status', 'evidence_ids', 'closed_by', 'closed_at'];
  return {
    fact_signals: empty(), fact_controls: empty(), fact_findings: empty(),
    fact_risks: { header: risksHeader, rows: [] },
    fact_assessments: empty(), fact_scope_coverage: empty(), fact_runs: empty(), fact_pass_runs: empty(),
    fact_app_heatmap: { header: heatmapHeader, rows: [] },
    fact_app_summary: { header: summaryHeader, rows: [] },
    dim_app: empty(), dim_pass: empty(), dim_regime: empty(), dim_control: empty(),
    dim_evidence: empty(), dim_severity: empty(), dim_wave: empty(),
    link_signal_evidence: empty(), link_control_signal: empty(), link_control_evidence: empty(),
    link_control_tag: empty(), dim_override: empty(),
  };
}

describe('buildPortfolioIndex (#1190)', () => {
  it('returns empty apps array when no fact_app_summary rows', () => {
    const tables = makeMinimalPortfolioStarTables();
    const index = buildPortfolioIndex(tables, '2026-07-22T00:00:00.000Z');
    expect(index.apps).toHaveLength(0);
    expect(index.schema_version).toBe('1.0');
    expect(index.built_at).toBe('2026-07-22T00:00:00.000Z');
  });

  it('extracts app facets from fact_app_summary and per_regime from fact_app_heatmap', () => {
    const tables = makeMinimalPortfolioStarTables();
    tables.fact_app_summary.rows = [
      ['myapp', 'Replatform', 'cloud_native', 0.8, 0.75, 3, 12],
    ];
    tables.fact_app_heatmap.rows = [
      ['myapp', 'GDPR', 2, 1, 1, 0, 0, 0.15],
    ];
    tables.fact_risks.rows = [
      ['RR-01', 'myapp', 'data_residency', 'high', 'high', 'PII risk', 'Mitigate', 'lead', 'open', '', '', ''],
    ];
    const index = buildPortfolioIndex(tables, '2026-07-22T00:00:00.000Z');
    expect(index.apps).toHaveLength(1);
    const app = index.apps[0];
    expect(app.app_id).toBe('myapp');
    expect(app.seven_r_label).toBe('Replatform');
    expect(app.portability_score).toBe(0.8);
    expect(app.per_regime_coverage['GDPR']).toEqual({ satisfied: 2, partial: 1, gap: 1, weighted_gap: 0.15 });
    expect(app.risk_rollup.open).toBe(1);
    expect(app.risk_rollup.high_count).toBe(1);
    expect(app.lz_verdict).toBeNull();
  });

  it('joins lz_verdict from lzr-summary.json when path provided', () => {
    const lzrTmp = mkdtempSync(join(tmpdir(), 'swao-lzr-'));
    try {
      const summaryPath = join(lzrTmp, 'lzr-summary.json');
      writeFileSync(summaryPath, JSON.stringify({
        assessed_at: '2026-07-22',
        total_apps: 1,
        apps: [{ app_id: 'myapp', provider_id: 'aws', landing_zone_id: 'eu-central-1', verdict: 'ready', blocker_count: 0, warning_count: 0 }],
        counts: { ready: 1, blocked: 0, advisory: 0, skipped: 0 },
        overall_verdict: 'ready',
      }), 'utf-8');
      const tables = makeMinimalPortfolioStarTables();
      tables.fact_app_summary.rows = [['myapp', 'Rehost', '', 0.9, 0.9, 0, 0]];
      const index = buildPortfolioIndex(tables, '2026-07-22T00:00:00.000Z', summaryPath);
      expect(index.apps[0].lz_verdict).toBe('ready');
    } finally {
      rmSync(lzrTmp, { recursive: true, force: true });
    }
  });
});
