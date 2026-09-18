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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeStarExport } from '../exports/star.js';

// #0261 -- CSV column-coverage gate. After Sprint 028's empty-cell audit
// (reports/0028-Audit-E2E-Solution.md), a set of columns must be 100%
// populated on every export. This test stands up a deterministic in-tmp
// workspace (spine + plan + evidence + manifest + a synthetic catalogue),
// runs writeStarExport, then asserts the rows.
//
// The fix issues these tests guard against regressing:
//   #0252  dim_control / dim_regime catalogue enrichment
//   #0253  fact_runs.files_source_total / imports_files_total
//   #0249  dim_app.modernization_position / portability_score
//   #0250  fact_signals booleans for synthesis / FP_considered
//   #0265  fact_assessments scope_coverage row + fact_scope_coverage table
//
// Spec-nullable columns (legacy_tier, signal_ref, etc.) are NOT asserted
// here -- they are intentionally empty when the source field is absent.

let tmp: string;
let appDir: string;
let workspaceRoot: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-csv-coverage-'));
  workspaceRoot = tmp;
  appDir = join(workspaceRoot, 'apps', 'audited');
  mkdirSync(join(appDir, 'wsp', 'passes'), { recursive: true });
  mkdirSync(join(appDir, 'wsp', 'runs', '2026-05-14T08-00-00', 'passes'), { recursive: true });
  mkdirSync(join(appDir, 'source'), { recursive: true });
  mkdirSync(join(appDir, 'wsp', 'inputs', 'cmdb'), { recursive: true });
  mkdirSync(join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'standard'), { recursive: true });
  mkdirSync(join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'community'), { recursive: true });

  // Source file (1) so files_source_total > 0
  writeFileSync(join(appDir, 'source', 'index.ts'), '// source', 'utf-8');
  // Imports file (1) so files_imports_total > 0
  writeFileSync(join(appDir, 'wsp', 'inputs', 'cmdb', 'cmdb.csv'), 'app,owner\naudited,team', 'utf-8');

  // Catalogue: standard/index.yaml + AUDIT.yaml
  writeFileSync(
    join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'standard', 'index.yaml'),
    `schema_version: '1'
scope: standard
regimes:
  - { id: AUDIT, name: Audit Test Regime, version: '1.0', file: audit.yaml, controls_count: 1, applicability_hints: [] }
`,
    'utf-8',
  );
  writeFileSync(
    join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'standard', 'audit.yaml'),
    `regime_meta:
  id: AUDIT
  name: Audit Test Regime
  version: '1.0'
  scope: standard
  authority: Audit Test Authority Inc.
  applicability_hints: [test]
  description: 'Synthetic regime used by the CSV column-coverage gate. Not for production.'
  references: []
  catalogue_version: '1.0.0'
controls:
  - id: AUDIT-01
    title: Audit baseline control
    description: 'The audited application has a baseline assertion that the test infrastructure works end-to-end.'
    severity_default: medium
    evidence_basis: [{ context_input: cmdb_export }]
    references: []
`,
    'utf-8',
  );
  writeFileSync(
    join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'community', 'index.yaml'),
    `schema_version: '1'
scope: community
regimes: []
`,
    'utf-8',
  );

  // App-side wsp/latest.txt pointing at our synthetic run
  writeFileSync(join(appDir, 'wsp', 'latest.txt'), 'runs/2026-05-14T08-00-00', 'utf-8');

  // Spine (wsp.yaml) -- carries the new fields from #0249
  writeFileSync(
    join(appDir, 'wsp', 'runs', '2026-05-14T08-00-00', 'wsp.yaml'),
    `wsp_version: "0.10"
app:
  id: audited
  name: Audited App
  business_domain: test
  business_criticality: medium
  regulatory_class: NONE
overall:
  seven_r_label: Replatform
  modernization_position: invest_modernize_now
  coverage_score: 0.95
  confidence: high
  portability_score: 0.80
landing_zone:
  primary: synthetic-target
engagement:
  name: CSV-Coverage-Gate
  client_code: AUDIT
  partnership_lead: assessor@example.com
  start_date: '2026-05-14'
assessed_at: '2026-05-14T08:00:00Z'
`,
    'utf-8',
  );

  // Plan (wsp-plan.yaml) -- one regime, one control with a signal_ref
  writeFileSync(
    join(appDir, 'wsp', 'runs', '2026-05-14T08-00-00', 'wsp-plan.yaml'),
    `compliance:
  regimes:
    - id: AUDIT
      name: Audit Test Regime
      version: '1.0'
      authority: 'Audit Test Authority Inc.'
      catalogue_version: '1.0.0'
      controls:
        - id: AUDIT-01
          title: 'Audit baseline control'
          description: 'The audited application has a baseline assertion that the test infrastructure works end-to-end.'
          outcome: SATISFIED
          status: ok
          severity: medium
          rationale: 'Baseline control satisfied via CMDB import (CMDB-01).'
          assessor: rule_engine
          assessed_at: '2026-05-14T08:00:00Z'
          remediation: ''
          signal_refs: [CMDB-01]
          evidence_ids: [cmdb.csv]
risk_register:
  - risk_id: RR-001
    category: data_governance
    likelihood: medium
    impact: high
    trigger: Baseline trigger
    mitigation: Baseline mitigation
    owner: data-governance@example.com
scope_coverage:
  catalogue_version: '1.0.0'
  total_blind_spots: 2
  closed: 1
  partial: 0
  open: 1
  coverage_ratio: 0.5
  blind_spots:
    - id: BS_AUDIT_CLOSED
      name: Audited closed blind spot
      category: process
      coverage: closed
      severity: medium
      input_provided: wsp/inputs/cmdb/cmdb.csv
      related_regimes: [AUDIT]
      assessor: rule_engine
      assessed_at: '2026-05-14T08:00:00Z'
    - id: BS_AUDIT_OPEN
      name: Audited open blind spot
      category: detection
      coverage: open
      severity: high
      input_required: wsp/inputs/observability/
      related_regimes: [AUDIT]
      assessor: rule_engine
      assessed_at: '2026-05-14T08:00:00Z'
`,
    'utf-8',
  );

  // Evidence catalogue
  writeFileSync(
    join(appDir, 'wsp', 'runs', '2026-05-14T08-00-00', 'wsp-evidence.yaml'),
    `evidence_catalogue:
  cmdb.csv:
    type: imported_artifact
    file: wsp/inputs/cmdb/cmdb.csv
    date: '2026-05-14'
`,
    'utf-8',
  );

  // Pass file (signal feed for fact_signals)
  writeFileSync(
    join(appDir, 'wsp', 'runs', '2026-05-14T08-00-00', 'passes', '04-ctx.yaml'),
    `pass:
  id: 4
  name: context_ingestion
  signal_prefix: CMDB
  status: complete
  iter: 1
  assessed_at: '2026-05-14T08:00:00Z'
signals:
  - id: CMDB-01
    source: cmdb_export
    category: business_processes
    severity: informational
    outcome: positive
    confidence: high
    assessor: rule_engine
    assessed_at: '2026-05-14T08:00:00Z'
    derivation: 'CMDB lists audited app under team ownership. Baseline ownership recorded.'
    evidence: [cmdb.csv]
    synthesis: false
    false_positive_considered: false
`,
    'utf-8',
  );

  // Run manifest (note: assess.ts is normally what writes this; we
  // pre-build a v1.3-shaped one with the file counts populated so the
  // export test asserts star.ts's downstream wiring, not assess.ts).
  writeFileSync(
    join(appDir, 'wsp', 'runs', '2026-05-14T08-00-00', 'run-manifest.json'),
    JSON.stringify({
      schema_version: '1.3',
      run_id: '2026-05-14T08:00:00.000Z',
      app: 'audited',
      iter: 1,
      assessed_at: '2026-05-14T08:00:00Z',
      started_at: '2026-05-14T08:00:00.000Z',
      finished_at: '2026-05-14T08:00:01.000Z',
      duration_ms: 1000,
      passes_executed: ['context_ingestion'],
      total_signals_emitted: 1,
      pass_stats: [
        { num: '04', pass: 'context_ingestion', wall_clock_ms: 500, signals_emitted: 1 },
      ],
      files_assessed: { inventory_count: 1, source_files_total: 1, imports_files_total: 1 },
      landing_zone_weights: { sovereign_score: 0.5, service_coverage: 0.35, portability: 0.1, cost_tier: 0.05 },
    }, null, 2),
    'utf-8',
  );
});

afterAll(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

// Helper: parse a CSV emitted by writeStarExport.
function readCsv(bundleDir: string, name: string): { header: string[]; rows: string[][] } {
  // eslint-disable-next-line no-irregular-whitespace
  const raw = readFileSync(join(bundleDir, 'star', name), 'utf-8').replace(/^﻿/, '');
  const lines = raw.split('\n').filter(l => l.length > 0);
  // Permissive CSV split: rows here have no embedded commas for the asserted columns.
  const header = lines[0].split(',');
  const rows = lines.slice(1).map(l => l.split(','));
  return { header, rows };
}

function pick(header: string[], rows: string[][], col: string): string[] {
  const idx = header.indexOf(col);
  if (idx === -1) throw new Error(`column "${col}" not in header [${header.join(', ')}]`);
  return rows.map(r => r[idx] ?? '');
}

describe('CSV column-coverage gate (#0261, audit Phase 3)', () => {
  it('exports without throwing and produces star files', () => {
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'audited', timestamp: '2026-05-14T08-00-01' });
    const files = readdirSync(join(bundleDir, 'star'));
    // Accepts any count >= 18 so adding new tables does not break this gate;
    // the detailed shape assertions below cover content correctness.
    expect(files.length).toBeGreaterThanOrEqual(18);
  });

  it('#0249: dim_app.modernization_position + portability_score populated', () => {
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'audited', timestamp: '2026-05-14T08-00-02' });
    const { header, rows } = readCsv(bundleDir, 'dim_app.csv');
    expect(rows.length).toBe(1);
    expect(pick(header, rows, 'modernization_position')[0]).toBe('invest_modernize_now');
    expect(pick(header, rows, 'portability_score')[0]).toBe('0.8');
    expect(pick(header, rows, 'seven_r_label')[0]).toBe('Replatform');
    expect(pick(header, rows, 'coverage_score')[0]).toBe('0.95');
  });

  it('#0252: dim_control populated from catalogue (title, description, severity_default, catalogue_version)', () => {
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'audited', timestamp: '2026-05-14T08-00-03' });
    const { header, rows } = readCsv(bundleDir, 'dim_control.csv');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const titles = pick(header, rows, 'title');
    const descs = pick(header, rows, 'description');
    const sevs = pick(header, rows, 'severity_default');
    const vers = pick(header, rows, 'catalogue_version');
    for (let i = 0; i < rows.length; i++) {
      expect(titles[i], `dim_control[${i}].title`).not.toBe('');
      expect(titles[i], `dim_control[${i}].title is human-readable, not the bare id`).not.toBe(rows[i][0]);
      expect(descs[i], `dim_control[${i}].description`).not.toBe('');
      expect(sevs[i], `dim_control[${i}].severity_default`).not.toBe('');
      expect(vers[i], `dim_control[${i}].catalogue_version`).not.toBe('');
    }
  });

  it('#0252: dim_regime populated from catalogue (authority + catalogue_version)', () => {
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'audited', timestamp: '2026-05-14T08-00-04' });
    const { header, rows } = readCsv(bundleDir, 'dim_regime.csv');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(pick(header, rows, 'authority')[0]).not.toBe('');
    expect(pick(header, rows, 'catalogue_version')[0]).not.toBe('');
  });

  it('#0253: fact_runs files_source_total + imports_files_total populated', () => {
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'audited', timestamp: '2026-05-14T08-00-05' });
    const { header, rows } = readCsv(bundleDir, 'fact_runs.csv');
    expect(rows.length).toBe(1);
    expect(pick(header, rows, 'files_source_total')[0]).not.toBe('');
    expect(pick(header, rows, 'files_imports_total')[0]).not.toBe('');
  });

  it('#0250: fact_signals false_positive_considered emits unquoted true/false (not "true"/"false")', () => {
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'audited', timestamp: '2026-05-14T08-00-06' });
    const csv = readFileSync(join(bundleDir, 'star', 'fact_signals.csv'), 'utf-8');
    // CMDB-01 carries false_positive_considered: false -- expect bare 'false' not quoted
    expect(csv).toMatch(/CMDB-01,/);
    expect(csv).not.toMatch(/CMDB-01,[^\n]*"false"/);
  });

  it('#0265: fact_assessments carries a scope_coverage row mirroring plan.scope_coverage', () => {
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'audited', timestamp: '2026-05-14T08-00-07' });
    const { header, rows } = readCsv(bundleDir, 'fact_assessments.csv');
    const blockNames = pick(header, rows, 'block_name');
    const scopeIdx = blockNames.indexOf('scope_coverage');
    expect(scopeIdx, 'fact_assessments must include a scope_coverage row').toBeGreaterThanOrEqual(0);
    expect(pick(header, rows, 'score')[scopeIdx]).toBe('0.5');
    expect(pick(header, rows, 'threshold')[scopeIdx]).toBe('0.5');
    expect(pick(header, rows, 'status')[scopeIdx]).toBe('PASS');
    expect(pick(header, rows, 'assessor')[scopeIdx]).toBe('rule_engine');
  });

  it('#0265: fact_scope_coverage emits one row per blind_spot with required columns', () => {
    const { bundleDir } = writeStarExport({ workspaceAppDir: appDir, appId: 'audited', timestamp: '2026-05-14T08-00-08' });
    const { header, rows } = readCsv(bundleDir, 'fact_scope_coverage.csv');
    expect(header).toEqual([
      'blind_spot_id', 'app_id', 'name', 'category', 'coverage', 'severity',
      'input_required', 'input_provided', 'related_regimes', 'assessor', 'assessed_at',
    ]);
    expect(rows.length).toBe(2);
    const ids = pick(header, rows, 'blind_spot_id');
    expect(ids).toContain('BS_AUDIT_CLOSED');
    expect(ids).toContain('BS_AUDIT_OPEN');
    const openIdx = ids.indexOf('BS_AUDIT_OPEN');
    expect(pick(header, rows, 'coverage')[openIdx]).toBe('open');
    expect(pick(header, rows, 'severity')[openIdx]).toBe('high');
    expect(pick(header, rows, 'input_required')[openIdx]).toBe('wsp/inputs/observability/');
    expect(pick(header, rows, 'related_regimes')[openIdx]).toBe('AUDIT');
  });
});
