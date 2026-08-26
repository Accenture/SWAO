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
import { writeNdjsonExport } from '../exports/star.js';

let tmp: string;
let appDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-ndjson-'));
  appDir = join(tmp, 'apps', 'demo');
  mkdirSync(join(appDir, 'wsp', 'passes'), { recursive: true });
  writeFileSync(
    join(appDir, 'wsp', 'wsp.yaml'),
    `wsp_version: "0.10"
app:
  id: demo
  name: Demo App
overall:
  seven_r_label: Replatform
assessed_at: "2026-05-09T13:00:00Z"
`,
    'utf-8',
  );
  writeFileSync(
    join(appDir, 'wsp', 'wsp-plan.yaml'),
    `migration_plan:
  runbook: []
risk_register: []
value_case: []
compliance:
  regimes: []
security_findings: []
assumptions: []
data_gaps: []
`,
    'utf-8',
  );
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
    severity: high
    outcome: negative
    confidence: high
    derivation: Long enough derivation string for the v0.10 min length constraint
    evidence: [package.json]
    derivation_chain: [PKG-04, STATE-01]
    assessor: rule_engine
    assessed_at: "2026-05-09T13:00:00Z"
assessment: {}
`,
    'utf-8',
  );
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('writeNdjsonExport (#0178)', () => {
  it('creates wsp/exports/<ts>/ndjson/ with one .ndjson per fact + dim + link table', () => {
    const result = writeNdjsonExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const files = readdirSync(join(result.bundleDir, 'ndjson')).sort();
    // 25 tables: 22 base + fact_lz_assessment + dim_landing_zone + link_lz_gap (#1259)
    expect(files.length).toBe(25);
    expect(files).toContain('fact_signals.ndjson');
    expect(files).toContain('dim_app.ndjson');
    expect(files).toContain('link_signal_evidence.ndjson');
    expect(files).toContain('fact_app_heatmap.ndjson');
    expect(files).toContain('fact_app_summary.ndjson');
  });

  it('every line of fact_signals.ndjson is a valid JSON object', () => {
    const result = writeNdjsonExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const body = readFileSync(join(result.bundleDir, 'ndjson', 'fact_signals.ndjson'), 'utf-8');
    const lines = body.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.signal_id).toBe('INV-01');
    expect(parsed.severity).toBe('high');
    expect(parsed.outcome).toBe('negative');
  });

  it('preserves derivation_chain as a JSON array (the documented array column)', () => {
    const result = writeNdjsonExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const body = readFileSync(join(result.bundleDir, 'ndjson', 'fact_signals.ndjson'), 'utf-8');
    const parsed = JSON.parse(body.trim());
    expect(parsed.derivation_chain).toEqual(['PKG-04', 'STATE-01']);
  });

  it('numeric strings become JSON numbers; empty cells become null; booleans are real booleans', () => {
    const result = writeNdjsonExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const body = readFileSync(join(result.bundleDir, 'ndjson', 'fact_signals.ndjson'), 'utf-8');
    const parsed = JSON.parse(body.trim());
    // false_positive_considered absent in source -> null (not "" string)
    expect(parsed.false_positive_considered).toBeNull();
    // signal_ref absent -> null
    expect(parsed.signal_ref).toBeNull();
  });

  it('row count matches what the CSV writer would emit (lock-step shape)', () => {
    const result = writeNdjsonExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    for (const f of result.manifest.files) {
      const body = readFileSync(join(result.bundleDir, f.path), 'utf-8');
      const lines = body.split(/\r?\n/).filter((l) => l.length > 0);
      expect(lines.length).toBe(f.rows);
    }
  });

  it('crlf option produces CRLF line endings between records', () => {
    const result = writeNdjsonExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500', crlf: true });
    const body = readFileSync(join(result.bundleDir, 'ndjson', 'dim_pass.ndjson'), 'utf-8');
    expect(body).toMatch(/\r\n/);
  });
});
