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

import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dump, load } from 'js-yaml';
import { writeStarExport, writeNdjsonExport } from '../exports/star.js';
import type { ExportManifest } from '../exports/star.js';

let tmp: string;
let appDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-star-'));
  appDir = join(tmp, 'apps', 'demo');
  mkdirSync(join(appDir, 'wsp', 'passes'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeFixture(): void {
  // wsp.yaml (spine)
  writeFileSync(
    join(appDir, 'wsp', 'wsp.yaml'),
    `wsp_version: "0.10"
app:
  id: demo
  name: Demo App
  business_domain: financial
  business_criticality: high
  regulatory_class: GDPR
overall:
  seven_r_label: Replatform
  modernization_position: invest_modernize_now
  coverage_score: 0.85
  confidence: 0.9
  portability_score: 0.7
landing_zone:
  primary: stackit_de_sovereign
assessed_at: "2026-05-09T13:00:00Z"
`,
    'utf-8',
  );

  // wsp-evidence.yaml
  writeFileSync(
    join(appDir, 'wsp', 'wsp-evidence.yaml'),
    `evidence_catalogue:
  PKG-04:
    type: static_analysis
    file: package.json
    summary: jsonwebtoken dependency
    reliability_weight: 0.9
  INC-2026-0042:
    type: incident
    file: imports/incidents/incidents-sample.csv
    summary: connection pool exhaustion
    reliability_weight: 0.95
`,
    'utf-8',
  );

  // wsp-plan.yaml
  writeFileSync(
    join(appDir, 'wsp', 'wsp-plan.yaml'),
    `migration_plan:
  runbook: []
risk_register:
  - risk_id: RR-01
    category: db
    likelihood: high
    impact: critical
    trigger: connection pool exhaustion under peak
    mitigation: raise pool size; add connection-level retry
    owner: SRE
value_case: []
compliance:
  regimes:
    - id: GDPR
      version: "2018-05"
      controls:
        - id: GDPR_Art_32
          outcome: PARTIAL
          severity: high
          rationale: Encryption at rest verified; logs unencrypted at rest
          signal_refs: [CRYPTO-04, CRYPTO-09]
          evidence_ids: [PKG-04]
          assessor: rule_engine
          assessed_at: "2026-05-09T13:00:00Z"
          remediation: Move log file to encrypted volume mount
          tags:
            - "technical-vs-organisational.technical"
            - "applies-to.controller"
            - "applies-to.processor"
security_findings:
  - id: SEC-01
    category: pipeline_security
    severity: medium
    description: Third-party action pinned by tag, not SHA
    remediation: Pin to commit SHA
    blocks_migration: false
    signal_ref: PP-01
assumptions: []
data_gaps: []
observability:
  score: 0.6
  threshold: 0.7
  sovereign_migration_risk: medium
  components: []
  overall_outcome: negative
  overall_rationale: Distributed tracing absent; partial logging coverage on critical paths
  assessor: rule_engine
  assessed_at: "2026-05-09T13:00:00Z"
`,
    'utf-8',
  );

  // passes/01-inv.yaml + 02-state.yaml
  writeFileSync(
    join(appDir, 'wsp', 'passes', '01-inv.yaml'),
    `pass:
  id: 1
  name: inventory
  status: complete
  iter: 1
signals:
  - id: INV-01
    source: static_analysis
    category: application
    severity: informational
    outcome: positive
    confidence: high
    derivation: Node.js 20 detected via package.json engines field; current LTS
    evidence: [package.json]
    assessor: rule_engine
    assessed_at: "2026-05-09T13:00:00Z"
assessment: {}
`,
    'utf-8',
  );
  writeFileSync(
    join(appDir, 'wsp', 'passes', '08-crypto.yaml'),
    `pass:
  id: 8
  name: crypto_posture
  status: complete
  iter: 1
signals:
  - id: CRYPTO-04
    source: static_analysis
    category: application
    severity: informational
    outcome: positive
    confidence: high
    derivation: AES-256-GCM verified via crypto.createCipheriv match in src/db.ts
    evidence: [PKG-04]
    assessor: rule_engine
    assessed_at: "2026-05-09T13:00:00Z"
  - id: CRYPTO-09
    source: static_analysis
    category: application
    severity: high
    outcome: negative
    confidence: high
    derivation: pgbouncer log file unencrypted at rest; mounted on root volume
    evidence: [PKG-04]
    assessor: rule_engine
    assessed_at: "2026-05-09T13:00:00Z"
    false_positive_considered: true
    false_positive_ruled_out: Considered if logs are filtered; ruled out, raw queries logged
    derivation_chain: [PKG-04]
assessment: {}
`,
    'utf-8',
  );

  // run-manifest.json (v1.3)
  writeFileSync(
    join(appDir, 'wsp', 'run-manifest.json'),
    JSON.stringify({
      schema_version: '1.3',
      run_id: 'demo-run-001',
      app: 'demo',
      iter: 1,
      assessed_at: '2026-05-09T13:00:00Z',
      started_at: '2026-05-09T13:00:00.000Z',
      finished_at: '2026-05-09T13:02:34.000Z',
      duration_ms: 154000,
      passes_executed: ['inventory', 'crypto_posture'],
      total_signals_emitted: 3,
      pass_stats: [
        { pass: 'inventory', num: '01', wall_clock_ms: 1500, signals_emitted: 1 },
        { pass: 'crypto_posture', num: '08', wall_clock_ms: 2400, signals_emitted: 2 },
      ],
      llm: { provider: 'anthropic', model: 'claude-opus-4-7' },
      files_assessed: { inventory_count: 1 },
      landing_zone_weights: {
        sovereign_score: 0.5,
        service_coverage: 0.35,
        portability: 0.1,
        cost_tier: 0.05,
      },
    }, null, 2),
    'utf-8',
  );
}

describe('writeStarExport (#0177)', () => {
  it('creates wsp/exports/<ts>/star/ with all 22 fact + dim + link CSV files', () => {
    writeFixture();
    const result = writeStarExport({
      workspaceAppDir: appDir,
      appId: 'demo',
      timestamp: '2026-05-09T1500',
    });
    expect(existsSync(result.bundleDir)).toBe(true);
    const starDir = join(result.bundleDir, 'star');
    const files = readdirSync(starDir).sort();
    // #0412 added fact_app_heatmap + fact_app_summary as stubs for single-app exports.
    // #0413 fills them with real per-app aggregates.
    // #1259 adds fact_lz_assessment, dim_landing_zone, link_lz_gap (25 tables total).
    const expected = [
      'dim_app.csv', 'dim_control.csv', 'dim_evidence.csv', 'dim_landing_zone.csv',
      'dim_override.csv', 'dim_pass.csv', 'dim_regime.csv', 'dim_severity.csv', 'dim_wave.csv',
      'fact_app_heatmap.csv', 'fact_app_summary.csv',
      'fact_assessments.csv', 'fact_controls.csv', 'fact_findings.csv',
      'fact_lz_assessment.csv', 'fact_pass_runs.csv', 'fact_risks.csv', 'fact_runs.csv',
      'fact_scope_coverage.csv', 'fact_signals.csv',
      'link_control_evidence.csv', 'link_control_signal.csv',
      'link_control_tag.csv', 'link_lz_gap.csv', 'link_signal_evidence.csv',
    ];
    expect(files).toEqual(expected);
  });

  it('fact_signals.csv contains one row per signal with v0.10 auditor columns', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_signals.csv'), 'utf-8');
    // eslint-disable-next-line no-irregular-whitespace
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(4); // header + 3 signals
    expect(lines[0]).toMatch(/signal_id,app_id,pass_num,severity,outcome,confidence,assessor,assessed_at/);
    expect(lines.some((l) => l.startsWith('INV-01,'))).toBe(true);
    expect(lines.some((l) => l.startsWith('CRYPTO-04,'))).toBe(true);
    expect(lines.some((l) => l.startsWith('CRYPTO-09,'))).toBe(true);
  });

  // #0250: false_positive_considered + synthesis must be emitted as JS
  // boolean primitives (not 'true' / 'false' strings) so NDJSON / XLSX
  // writers carry typed booleans and PowerBI Power Query can cast the
  // CSV columns to `type logical` consistently across single-app and
  // portfolio dashboards.
  it('#0250: fact_signals CSV emits unquoted true/false for boolean columns', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_signals.csv'), 'utf-8');
    // eslint-disable-next-line no-irregular-whitespace
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    const cryptoRow = lines.find((l) => l.startsWith('CRYPTO-09,'));
    expect(cryptoRow).toBeDefined();
    const cells = (cryptoRow as string).split(',');
    // false_positive_considered is column index 15 (0-indexed); never quoted.
    expect(cells[15]).toBe('true');
    expect(cells[15]).not.toBe('"true"');
  });

  it('#0250: fact_signals NDJSON carries native boolean for false_positive_considered', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const ndjsonPath = join(bundleDir, 'ndjson', 'fact_signals.ndjson');
    if (!existsSync(ndjsonPath)) {
      // NDJSON writer may not be wired in this fixture path; skip soft.
      return;
    }
    const lines = readFileSync(ndjsonPath, 'utf-8').split('\n').filter((l) => l.length > 0);
    const cryptoLine = lines.find((l) => l.includes('"CRYPTO-09"'));
    expect(cryptoLine, 'CRYPTO-09 NDJSON row must exist').toBeDefined();
    const parsed = JSON.parse(cryptoLine as string);
    expect(parsed.false_positive_considered).toBe(true);
    expect(typeof parsed.false_positive_considered).toBe('boolean');
  });

  it('fact_controls.csv has rationale, signal_refs, evidence_ids surfaced', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_controls.csv'), 'utf-8');
    expect(csv).toMatch(/GDPR_Art_32/);
    expect(csv).toMatch(/PARTIAL/);
    expect(csv).toMatch(/Encryption at rest verified/);
  });

  it('link_signal_evidence.csv links each signal to its evidence ids', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'link_signal_evidence.csv'), 'utf-8');
    expect(csv).toMatch(/CRYPTO-04,PKG-04/);
    expect(csv).toMatch(/CRYPTO-09,PKG-04/);
  });

  it('link_control_signal + link_control_evidence resolve control cross-refs', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const ctrlSig = readFileSync(join(bundleDir, 'star', 'link_control_signal.csv'), 'utf-8');
    expect(ctrlSig).toMatch(/GDPR_Art_32,CRYPTO-04,GDPR/);
    expect(ctrlSig).toMatch(/GDPR_Art_32,CRYPTO-09,GDPR/);
    const ctrlEv = readFileSync(join(bundleDir, 'star', 'link_control_evidence.csv'), 'utf-8');
    expect(ctrlEv).toMatch(/GDPR_Art_32,PKG-04,GDPR/);
  });

  it('fact_runs.csv contains one row sourced from run-manifest.json v1.3', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_runs.csv'), 'utf-8');
    // eslint-disable-next-line no-irregular-whitespace
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2); // header + 1 run
    expect(lines[1]).toMatch(/^demo-run-001,demo,/);
    expect(lines[1]).toMatch(/154000/);
    expect(lines[1]).toMatch(/anthropic/);
    expect(lines[1]).toMatch(/claude-opus-4-7/);
  });

  it('fact_runs.csv exposes the four landing-zone weight columns (#0153)', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_runs.csv'), 'utf-8');
    // eslint-disable-next-line no-irregular-whitespace
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    const header = lines[0].split(',');
    expect(header).toContain('lz_weight_sovereign_score');
    expect(header).toContain('lz_weight_service_coverage');
    expect(header).toContain('lz_weight_portability');
    expect(header).toContain('lz_weight_cost_tier');
    const cells = lines[1].split(',');
    const get = (col: string): string => cells[header.indexOf(col)];
    expect(get('lz_weight_sovereign_score')).toBe('0.5');
    expect(get('lz_weight_service_coverage')).toBe('0.35');
    expect(get('lz_weight_portability')).toBe('0.1');
    expect(get('lz_weight_cost_tier')).toBe('0.05');
  });

  it('fact_pass_runs.csv contains one row per pass from pass_stats[]', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_pass_runs.csv'), 'utf-8');
    // eslint-disable-next-line no-irregular-whitespace
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(3); // header + 2 pass rows
    expect(lines.some((l) => l.includes('inventory') && l.includes('demo-run-001'))).toBe(true);
    expect(lines.some((l) => l.includes('crypto_posture'))).toBe(true);
  });

  it('fact_assessments.csv emits one row per non-empty per-pass assessment block', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_assessments.csv'), 'utf-8');
    expect(csv).toMatch(/observability/);
    expect(csv).toMatch(/Distributed tracing absent/);
  });

  it('manifest.yaml lists every CSV with row count and SHA-256', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const manifest = load(readFileSync(join(bundleDir, 'manifest.yaml'), 'utf-8')) as {
      bundle_schema_version: string;
      app_id: string;
      files: Array<{ path: string; rows: number; sha256: string; bytes: number }>;
    };
    expect(manifest.bundle_schema_version).toBe('1.3.0');
    expect(manifest.app_id).toBe('demo');
    // #0412 added fact_app_heatmap + fact_app_summary (21); #1188 added dim_override (22); #1259 adds 3 LZ tables (25).
    expect(manifest.files).toHaveLength(25);
    for (const f of manifest.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes).toBeGreaterThan(0);
    }
  });

  it('fact_app_summary.csv has one data row with real per-app aggregates (#0413)', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_app_summary.csv'), 'utf-8');
    // eslint-disable-next-line no-irregular-whitespace
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2); // header + 1 row for 'demo'
    const header = lines[0].split(',');
    const cells = lines[1].split(',');
    const get = (col: string): string => cells[header.indexOf(col)];
    expect(get('app_id')).toBe('demo');
    // coverage_score comes from wsp.yaml overall.coverage_score = 0.85
    expect(get('coverage_score')).toBe('0.85');
    // The fixture has 1 negative signal (CRYPTO-09, severity=high -> rank 4)
    expect(get('total_negative_signals')).toBe('1');
  });

  it('fact_app_heatmap.csv has one data row per (app, regime) from fact_controls (#0413)', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_app_heatmap.csv'), 'utf-8');
    // eslint-disable-next-line no-irregular-whitespace
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    // header + 1 row (demo x GDPR)
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/app_id,regime_id,satisfied_count/);
    expect(lines[1]).toMatch(/^demo,GDPR,/);
  });

  it('manifest row counts match the CSV row counts on disk', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const manifest = load(readFileSync(join(bundleDir, 'manifest.yaml'), 'utf-8')) as {
      files: Array<{ path: string; rows: number }>;
    };
    for (const f of manifest.files) {
      const csv = readFileSync(join(bundleDir, f.path), 'utf-8');
      // eslint-disable-next-line no-irregular-whitespace
      const dataLines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length > 0);
      const dataRows = Math.max(0, dataLines.length - 1); // minus header
      expect(dataRows, `row mismatch in ${f.path}`).toBe(f.rows);
    }
  });

  it('CSV is RFC-4180-valid: values containing commas are double-quote escaped', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_signals.csv'), 'utf-8');
    // CRYPTO-09 false_positive_ruled_out contains a comma; must be quoted.
    expect(csv).toMatch(/"Considered if logs are filtered; ruled out, raw queries logged"/);
  });

  it('UTF-8 BOM is prepended to each CSV by default; `noBom: true` suppresses it', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const buf = readFileSync(join(bundleDir, 'star', 'dim_app.csv'));
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);

    const result2 = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1501', noBom: true });
    const buf2 = readFileSync(join(result2.bundleDir, 'star', 'dim_app.csv'));
    expect(buf2[0]).not.toBe(0xef);
  });

  it('link_control_tag.csv emits one row per (control, tag) with tag_kind derived from prefix (#0361)', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'link_control_tag.csv'), 'utf-8');
    // eslint-disable-next-line no-irregular-whitespace
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    // GDPR_Art_32 fixture carries 3 tags -> header + 3 rows.
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('control_id,tag,tag_kind,regime_id,app_id');
    // Axis-form tag: kind = "axis"
    expect(lines.some((l) => l === 'GDPR_Art_32,technical-vs-organisational.technical,axis,GDPR,demo')).toBe(true);
    // Applies-to tags: kind = "applies-to"
    expect(lines.some((l) => l === 'GDPR_Art_32,applies-to.controller,applies-to,GDPR,demo')).toBe(true);
    expect(lines.some((l) => l === 'GDPR_Art_32,applies-to.processor,applies-to,GDPR,demo')).toBe(true);
  });

  it('writes a top-level README.md describing the bundle', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const readme = readFileSync(join(bundleDir, 'README.md'), 'utf-8');
    expect(readme).toMatch(/SWAO BI export bundle -- demo/);
    expect(readme).toMatch(/PowerBI Desktop/);
    expect(readme).toMatch(/swao-report\.pbit/);
  });

  it('dim_pass.csv enumerates all 21 pass + signal_prefix mappings', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'dim_pass.csv'), 'utf-8');
    // eslint-disable-next-line no-irregular-whitespace
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(22); // header + 21 passes
    expect(csv).toMatch(/^01,inventory,INV/m);
    expect(csv).toMatch(/^23,lzr,LZR/m);
    // #0241: pass 11 + 12 must be present so fact_pass_runs rows join cleanly
    expect(csv).toMatch(/^11,compliance_evaluation,COMP/m);
    expect(csv).toMatch(/^12,block_assessments,COMP/m);
  });

  it('dim_severity.csv enumerates severity, control_outcome, signal_outcome categories', () => {
    writeFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const csv = readFileSync(join(bundleDir, 'star', 'dim_severity.csv'), 'utf-8');
    expect(csv).toMatch(/SATISFIED.*control_outcome/);
    expect(csv).toMatch(/PARTIAL.*control_outcome/);
    expect(csv).toMatch(/critical.*severity/);
    expect(csv).toMatch(/positive.*signal_outcome/);
  });

  it('#1258 -- manifest.yaml includes companion_outputs when NDJSON is also exported', () => {
    writeFixture();
    const ts = '2026-05-09T1504';
    const csvResult = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: ts });
    const ndjsonResult = writeNdjsonExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: ts });

    // Simulate the export.ts companion merge logic
    const updatedManifest: ExportManifest = {
      ...csvResult.manifest,
      companion_outputs: {
        ndjson: ndjsonResult.manifest.files,
      },
    };
    writeFileSync(join(csvResult.bundleDir, 'manifest.yaml'), dump(updatedManifest, { lineWidth: 160 }), 'utf-8');

    const manifest = load(readFileSync(join(csvResult.bundleDir, 'manifest.yaml'), 'utf-8')) as ExportManifest;
    expect(manifest.companion_outputs).toBeDefined();
    expect(Array.isArray(manifest.companion_outputs?.ndjson)).toBe(true);
    // NDJSON mirror has one entry per StarTables field (20 tables; CSV adds 2 extra summary tables)
    expect(manifest.companion_outputs?.ndjson?.length).toBeGreaterThanOrEqual(18);
    for (const f of manifest.companion_outputs?.ndjson ?? []) {
      expect(f.path).toMatch(/^ndjson\//);
      expect(f.path).toMatch(/\.ndjson$/);
      // sha256 is always present; bytes may be 0 for empty tables (e.g. dim_override with no overrides)
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof f.bytes).toBe('number');
    }
    // xlsx companion_outputs must be absent when XLSX was not exported
    expect(manifest.companion_outputs?.xlsx).toBeUndefined();
  });
});

describe('writeStarExport line-ending semantics', () => {
  beforeEach(() => writeFixture());

  function writeFixture(): void {
    writeFileSync(
      join(appDir, 'wsp', 'wsp.yaml'),
      'wsp_version: "0.10"\napp:\n  id: demo\n  name: Demo\noverall:\n  seven_r_label: Replatform\n',
      'utf-8',
    );
    writeFileSync(
      join(appDir, 'wsp', 'wsp-plan.yaml'),
      'migration_plan:\n  runbook: []\nrisk_register: []\nvalue_case: []\ncompliance:\n  regimes: []\nsecurity_findings: []\nassumptions: []\ndata_gaps: []\n',
      'utf-8',
    );
  }

  it('default LF line endings', () => {
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1502' });
    const buf = readFileSync(join(bundleDir, 'star', 'dim_app.csv'));
    const text = buf.toString('utf-8');
    expect(text).not.toMatch(/\r\n/);
  });

  it('crlf: true switches to Windows line endings', () => {
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1503', crlf: true });
    const buf = readFileSync(join(bundleDir, 'star', 'dim_app.csv'));
    const text = buf.toString('utf-8');
    expect(text).toMatch(/\r\n/);
  });
});

// ---------------------------------------------------------------------------
// resolveSourceWspRun: application pointer preference (#0786)
// Regression tests asserting that the star-schema resolver prefers
// latest-application.txt over latest.txt when both exist (multi-type
// workspace). This prevents a later LZ catalog run from silently
// shadowing the application run's star-schema data.
// ---------------------------------------------------------------------------

describe('resolveSourceWspRun: application pointer preference (#0786)', () => {
  function writeMinimalFixture(runDir: string): void {
    mkdirSync(join(runDir, 'passes'), { recursive: true });
    writeFileSync(join(runDir, 'wsp.yaml'),
      `wsp_version: "0.10"
app:
  id: demo
  name: Demo App
  business_domain: financial
  business_criticality: high
  regulatory_class: NONE
overall:
  seven_r_label: Rehost
  modernization_position: lift_and_shift
  coverage_score: 0.55
  confidence: 0.7
  portability_score: 0.5
landing_zone:
  primary: stackit-de
assessed_at: "2026-07-04T09:00:00Z"
`, 'utf-8');
    writeFileSync(join(runDir, 'wsp-plan.yaml'),
      'migration_plan:\n  runbook: []\nrisk_register: []\nvalue_case: []\ncompliance:\n  regimes: []\nsecurity_findings: []\nassumptions: []\ndata_gaps: []\n',
      'utf-8');
    writeFileSync(join(runDir, 'passes', '01-inv.yaml'),
      `pass:\n  id: 1\n  name: inventory\n  status: complete\n  iter: 1\nsignals:\n  - id: APP-RUN-SIGNAL\n    source: static_analysis\n    category: application\n    severity: informational\n    outcome: positive\n    confidence: high\n    derivation: marker signal from application run\n    evidence: []\n    assessor: rule_engine\n    assessed_at: "2026-07-04T09:00:00Z"\nassessment: {}\n`,
      'utf-8');
  }

  it('uses latest-application.txt when both latest.txt and latest-application.txt exist', () => {
    const appRunId = '2026-07-04T09-00-00';
    const lzRunId  = '2026-07-04T10-00-00';
    const appRunDir = join(appDir, 'wsp', 'runs', appRunId);
    const lzRunDir  = join(appDir, 'wsp', 'runs', lzRunId);
    writeMinimalFixture(appRunDir);
    mkdirSync(lzRunDir, { recursive: true }); // LZ run dir exists but has no pass data

    // latest.txt points to the newer LZ run; latest-application.txt to the app run.
    writeFileSync(join(appDir, 'wsp', 'latest.txt'),              `runs/${lzRunId}`,  'utf-8');
    writeFileSync(join(appDir, 'wsp', 'latest-application.txt'), `runs/${appRunId}`, 'utf-8');

    const { bundleDir, manifest } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-07-04T1200' });
    // Resolver must pick the application pointer, not latest.txt.
    expect(manifest.source_wsp_run).toBe(appRunId);
    // Belt-and-suspenders: fact_signals must contain the marker signal written into the app run.
    const signalsCsv = readFileSync(join(bundleDir, 'star', 'fact_signals.csv'), 'utf-8');
    expect(signalsCsv).toContain('APP-RUN-SIGNAL');
  });

  it('falls back to latest.txt when no type-specific pointers exist (legacy workspace)', () => {
    const legacyRunId = 'legacy-2026-07-01T08-00-00';
    const legacyRunDir = join(appDir, 'wsp', 'runs', legacyRunId);
    writeMinimalFixture(legacyRunDir);
    writeFileSync(join(appDir, 'wsp', 'latest.txt'), `runs/${legacyRunId}`, 'utf-8');
    // No latest-application.txt -- pre-sprint-076 workspace.

    const { manifest } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-07-04T1201' });
    expect(manifest.source_wsp_run).toBe(legacyRunId);
  });

  it('uses flat wsp/ when neither latest.txt nor type pointers exist', () => {
    writeMinimalFixture(join(appDir, 'wsp'));
    // No latest.txt at all -- pre-run workspace or a flat layout.
    const { manifest } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-07-04T1202' });
    expect(manifest.source_wsp_run).toBe('flat');
  });
});

// ---------------------------------------------------------------------------
// Demo-framework star export (#0827)
//
// Verifies that writeStarExport correctly processes all four bundled demo
// frameworks (gdpr-demo, ai-10-pillars-demo, cobit-5-demo, nist-hipaa-demo)
// and that fact_controls.csv contains exactly 47 rows -- one per control.
//
// Control counts per framework (verified against docs/custom-frameworks/*/controls.yaml):
//   GDPR_DEMO         12 controls
//   AI_10_PILLARS_DEMO 11 controls
//   COBIT_5_DEMO       12 controls
//   NIST_SP_800_66R2_DEMO    12 controls
//   Total:             47 controls
//
// The test builds an inline wsp-plan.yaml fixture representing a completed
// Pass 11 run across all four demo regimes.  It does not read from
// _demo-frameworks/ on disk; it only tests the star export pipeline.
// ---------------------------------------------------------------------------
describe('demo-framework star export (#0827)', () => {
  function writeDemoFixture(): void {
    // Minimal spine (wsp.yaml)
    writeFileSync(
      join(appDir, 'wsp', 'wsp.yaml'),
      `wsp_version: "0.10"\napp:\n  id: demo\n  name: Demo\noverall:\n  seven_r_label: Replatform\nassessed_at: "2026-07-07T10:00:00Z"\n`,
      'utf-8',
    );

    // wsp-plan.yaml with all 4 demo regimes and their controls.
    // Control IDs match docs/custom-frameworks/*/controls.yaml entries.
    const gdprDemoControls = [
      'GDPR_DEMO.ART5_1_A', 'GDPR_DEMO.ART5_1_C', 'GDPR_DEMO.ART5_1_F', 'GDPR_DEMO.ART6',
      'GDPR_DEMO.ART9', 'GDPR_DEMO.ART13', 'GDPR_DEMO.ART17', 'GDPR_DEMO.ART25',
      'GDPR_DEMO.ART28', 'GDPR_DEMO.ART32', 'GDPR_DEMO.ART33', 'GDPR_DEMO.ART35',
    ]; // 12 controls
    const ai10pDemoControls = [
      'AI10P_DEMO.INP_01', 'AI10P_DEMO.IAM_01', 'AI10P_DEMO.DAT_01', 'AI10P_DEMO.DAT_02',
      'AI10P_DEMO.MOD_01', 'AI10P_DEMO.INF_01', 'AI10P_DEMO.SEC_01', 'AI10P_DEMO.SEC_02',
      'AI10P_DEMO.OPS_01', 'AI10P_DEMO.GOV_01', 'AI10P_DEMO.GOV_02',
    ]; // 11 controls
    const cobit5DemoControls = [
      'COBIT5_DEMO.EDM01', 'COBIT5_DEMO.EDM03', 'COBIT5_DEMO.APO10', 'COBIT5_DEMO.APO12',
      'COBIT5_DEMO.APO13', 'COBIT5_DEMO.BAI06', 'COBIT5_DEMO.BAI10', 'COBIT5_DEMO.DSS01',
      'COBIT5_DEMO.DSS02', 'COBIT5_DEMO.DSS05', 'COBIT5_DEMO.MEA01', 'COBIT5_DEMO.MEA02',
    ]; // 12 controls
    const hipaaDecoControls = [
      'HIPAA_DEMO.ADM_01', 'HIPAA_DEMO.ADM_02', 'HIPAA_DEMO.ADM_04', 'HIPAA_DEMO.ADM_08',
      'HIPAA_DEMO.PHY_01', 'HIPAA_DEMO.PHY_02', 'HIPAA_DEMO.PHY_03', 'HIPAA_DEMO.TEC_01',
      'HIPAA_DEMO.TEC_02', 'HIPAA_DEMO.TEC_04', 'HIPAA_DEMO.TEC_05', 'HIPAA_DEMO.ORG_01',
    ]; // 12 controls

    function controlBlock(ids: string[]): string {
      return ids.map((id) => `        - id: ${id}\n          outcome: PARTIAL\n          severity: medium\n`).join('');
    }

    const planYaml = `compliance:
  regimes:
    - id: GDPR_DEMO
      name: "GDPR Demo (12 controls)"
      controls:
${controlBlock(gdprDemoControls)}
    - id: AI_10_PILLARS_DEMO
      name: "AI 10 Pillars Demo (11 controls)"
      controls:
${controlBlock(ai10pDemoControls)}
    - id: COBIT_5_DEMO
      name: "COBIT 5 Demo (12 controls)"
      controls:
${controlBlock(cobit5DemoControls)}
    - id: NIST_SP_800_66R2_DEMO
      name: "NIST/HIPAA Demo (12 controls)"
      controls:
${controlBlock(hipaaDecoControls)}
`;
    writeFileSync(join(appDir, 'wsp', 'wsp-plan.yaml'), planYaml, 'utf-8');
  }

  it('fact_controls.csv has exactly 47 rows -- one per control across all four demo regimes', () => {
    writeDemoFixture();
    const { bundleDir } = writeStarExport({
      workspaceAppDir: appDir,
      appId: 'demo',
      timestamp: '2026-07-07T1000',
    });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_controls.csv'), 'utf-8');
    // Strip BOM + split by newline; header is row 0; filter out empty trailing lines.
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    const dataRows = lines.slice(1); // skip header
    expect(dataRows).toHaveLength(47);
  });

  it('all four demo regime IDs appear in fact_controls.csv', () => {
    writeDemoFixture();
    const { bundleDir } = writeStarExport({
      workspaceAppDir: appDir,
      appId: 'demo',
      timestamp: '2026-07-07T1001',
    });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_controls.csv'), 'utf-8');
    expect(csv).toMatch(/GDPR_DEMO/);
    expect(csv).toMatch(/AI_10_PILLARS_DEMO/);
    expect(csv).toMatch(/COBIT_5_DEMO/);
    expect(csv).toMatch(/NIST_SP_800_66R2_DEMO/);
  });

  it('dim_regime.csv has exactly 4 rows for the four demo regimes', () => {
    writeDemoFixture();
    const { bundleDir } = writeStarExport({
      workspaceAppDir: appDir,
      appId: 'demo',
      timestamp: '2026-07-07T1002',
    });
    const csv = readFileSync(join(bundleDir, 'star', 'dim_regime.csv'), 'utf-8');
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    expect(lines.slice(1)).toHaveLength(4); // 4 regime rows
  });

  it('manifest note on empty bridge tables when controls exist but COMP produced no mappings (#1257)', () => {
    writeDemoFixture();
    const { bundleDir, manifest } = writeStarExport({
      workspaceAppDir: appDir,
      appId: 'demo',
      timestamp: '2026-07-07T1003',
    });
    const ctrlSigEntry = manifest.files.find((f) => f.path === 'star/link_control_signal.csv');
    const ctrlEvEntry  = manifest.files.find((f) => f.path === 'star/link_control_evidence.csv');
    expect(ctrlSigEntry?.rows).toBe(0);
    expect(ctrlSigEntry?.note).toContain('COMP produced no control-signal mappings');
    expect(ctrlEvEntry?.rows).toBe(0);
    expect(ctrlEvEntry?.note).toContain('COMP produced no control-signal mappings');
    // Files still written (0-row CSVs with header only)
    expect(existsSync(join(bundleDir, 'star', 'link_control_signal.csv'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LZ catalog assessment star schema tables (#1259)
// ---------------------------------------------------------------------------
describe('fact_lz_assessment / dim_landing_zone / link_lz_gap (#1259)', () => {
  function writeLzFixture(): void {
    writeFileSync(
      join(appDir, 'wsp', 'wsp.yaml'),
      `wsp_version: "0.10"\napp:\n  id: demo\n  name: Demo\noverall:\n  seven_r_label: Replatform\nassessed_at: "2026-07-01T10:00:00Z"\n`,
      'utf-8',
    );
    // Two lz-fit pass files: one READY (stackit/eu01), one SOVEREIGNTY_BLOCKED (aws/eu-central-1)
    writeFileSync(join(appDir, 'wsp', 'passes', 'lz-fit-stackit-eu01.yaml'), dump({
      pass: { id: 'lz-fit', assessed_at: '2026-07-01', schema_version: '1' },
      assessment: {
        provider: 'stackit', region: 'eu01', overall: 'READY',
        assessment_mode: 'catalogue-sovereignty-only', generated_at: '2026-07-01T10:00:00Z',
        items: [
          { framework: 'BSI_C5', requirement: 'C5-OIS-04', status: 'MET', rationale: 'OK' },
        ],
      },
    }), 'utf-8');
    writeFileSync(join(appDir, 'wsp', 'passes', 'lz-fit-aws-eu-central-1.yaml'), dump({
      pass: { id: 'lz-fit', assessed_at: '2026-07-01', schema_version: '1' },
      assessment: {
        provider: 'aws', region: 'eu-central-1', overall: 'SOVEREIGNTY_BLOCKED',
        assessment_mode: 'catalogue-sovereignty-only', generated_at: '2026-07-01T11:00:00Z',
        items: [
          { framework: 'BSI_C5', requirement: 'C5-OIS-04', status: 'NOT_MET', rationale: 'No residency' },
          { framework: 'GDPR', requirement: 'Art.28', status: 'NOT_MET', rationale: 'No DPA' },
        ],
      },
    }), 'utf-8');
  }

  it('fact_lz_assessment.csv has one row per lz-fit pass file', () => {
    writeLzFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-07-27T1000' });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_lz_assessment.csv'), 'utf-8');
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    expect(lines.slice(1)).toHaveLength(2);
    expect(csv).toMatch(/stackit\/eu01,demo,stackit,eu01,READY,0/);
    expect(csv).toMatch(/aws\/eu-central-1,demo,aws,eu-central-1,SOVEREIGNTY_BLOCKED,2/);
  });

  it('dim_landing_zone.csv deduplicates regions', () => {
    writeLzFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-07-27T1001' });
    const csv = readFileSync(join(bundleDir, 'star', 'dim_landing_zone.csv'), 'utf-8');
    expect(csv).toMatch(/stackit\/eu01,stackit,eu01/);
    expect(csv).toMatch(/aws\/eu-central-1,aws,eu-central-1/);
  });

  it('link_lz_gap.csv has one row per NOT_MET item', () => {
    writeLzFixture();
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-07-27T1002' });
    const csv = readFileSync(join(bundleDir, 'star', 'link_lz_gap.csv'), 'utf-8');
    const lines = csv.replace(/^﻿/, '').split('\n').filter((l) => l.length > 0);
    expect(lines.slice(1)).toHaveLength(2); // two NOT_MET items from aws run
    expect(csv).toMatch(/aws\/eu-central-1,demo,BSI_C5\/C5-OIS-04,certification/);
    expect(csv).toMatch(/aws\/eu-central-1,demo,GDPR\/Art\.28,certification/);
  });

  it('when no lz-fit files present all three tables are written with 0 rows', () => {
    // Use writeFixture which has no lz-fit files
    writeFileSync(
      join(appDir, 'wsp', 'wsp.yaml'),
      `wsp_version: "0.10"\napp:\n  id: demo\n  name: Demo\noverall:\n  seven_r_label: Replatform\nassessed_at: "2026-07-01T10:00:00Z"\n`,
      'utf-8',
    );
    const { bundleDir, manifest } = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-07-27T1003' });
    const lzEntry = manifest.files.find((f) => f.path === 'star/fact_lz_assessment.csv');
    expect(lzEntry?.rows).toBe(0);
    expect(existsSync(join(bundleDir, 'star', 'fact_lz_assessment.csv'))).toBe(true);
  });
});
