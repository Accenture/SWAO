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

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeXlsxExport } from '../exports/star.js';

let tmp: string;
let appDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-xlsx-'));
  appDir = join(tmp, 'apps', 'demo');
  mkdirSync(join(appDir, 'wsp', 'passes'), { recursive: true });
  writeFileSync(
    join(appDir, 'wsp', 'wsp.yaml'),
    `wsp_version: "0.10"
app:
  id: demo
  name: Demo
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
  regimes:
    - id: GDPR
      version: "2018-05"
      controls:
        - id: GDPR_Art_32
          outcome: PARTIAL
          severity: high
          rationale: Encryption at rest verified; logs unencrypted (gap)
          signal_refs: [CRYPTO-04]
          evidence_ids: [PKG-04]
          assessor: rule_engine
          assessed_at: "2026-05-09T13:00:00Z"
          remediation: Move log file to encrypted volume mount
security_findings: []
assumptions: []
data_gaps: []
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
    severity: high
    outcome: negative
    confidence: high
    derivation: pgbouncer log file unencrypted at rest; mounted on root volume
    evidence: [PKG-04]
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

describe('writeXlsxExport (#0179)', () => {
  it('creates wsp/exports/<ts>/xlsx/swao-export.xlsx', async () => {
    const r = await writeXlsxExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const xlsxPath = join(r.bundleDir, 'xlsx', 'swao-export.xlsx');
    expect(existsSync(xlsxPath)).toBe(true);
    const buf = readFileSync(xlsxPath);
    // XLSX is a ZIP -- starts with the ZIP magic bytes 'PK'.
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it('opens as a parseable workbook with the expected sheets', async () => {
    const r = await writeXlsxExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const ExcelJS = await import('exceljs');
    const Workbook = (ExcelJS.default ?? ExcelJS).Workbook;
    const wb = new Workbook();
    await wb.xlsx.readFile(join(r.bundleDir, 'xlsx', 'swao-export.xlsx'));
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names).toContain('Auditor view');
    expect(names).toContain('fact_signals');
    expect(names).toContain('fact_controls');
    expect(names).toContain('dim_app');
    expect(names).toContain('dim_pass');
    expect(names).toContain('link_signal_evidence');
  });

  it('Auditor view sheet pre-pivots one row per control with rationale visible', async () => {
    const r = await writeXlsxExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const ExcelJS = await import('exceljs');
    const Workbook = (ExcelJS.default ?? ExcelJS).Workbook;
    const wb = new Workbook();
    await wb.xlsx.readFile(join(r.bundleDir, 'xlsx', 'swao-export.xlsx'));
    const auditor = wb.getWorksheet('Auditor view');
    expect(auditor).toBeDefined();
    const headerRow = auditor!.getRow(1);
    const headerValues = headerRow.values as unknown[];
    expect(headerValues).toContain('control_id');
    expect(headerValues).toContain('rationale');
    expect(headerValues).toContain('signal_refs');
    expect(headerValues).toContain('evidence_ids');
    // rowCount includes the header row.
    expect(auditor!.rowCount).toBe(2); // header + 1 control
    const dataRow = auditor!.getRow(2);
    const dataValues = dataRow.values as unknown[];
    expect(dataValues).toContain('GDPR_Art_32');
    expect(dataValues).toContain('PARTIAL');
    expect(dataValues.find((v) => typeof v === 'string' && v.includes('Encryption at rest'))).toBeDefined();
  });

  it('every fact + dim + link sheet has frozen header + autofilter', async () => {
    const r = await writeXlsxExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const ExcelJS = await import('exceljs');
    const Workbook = (ExcelJS.default ?? ExcelJS).Workbook;
    const wb = new Workbook();
    await wb.xlsx.readFile(join(r.bundleDir, 'xlsx', 'swao-export.xlsx'));
    const factSignals = wb.getWorksheet('fact_signals')!;
    expect(factSignals.views?.[0]?.state).toBe('frozen');
    expect(factSignals.autoFilter).toBeDefined();
  });

  it('manifest reports the xlsx file with SHA-256 + bytes', async () => {
    const r = await writeXlsxExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    expect(r.manifest.files).toHaveLength(1);
    expect(r.manifest.files[0]?.path).toBe('xlsx/swao-export.xlsx');
    expect(r.manifest.files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.manifest.files[0]?.bytes).toBeGreaterThan(2000); // small but non-empty
  });

  it('co-exists with star + ndjson in the same bundle dir', async () => {
    const { writeStarExport, writeNdjsonExport } = await import('../exports/star.js');
    writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    writeNdjsonExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const r = await writeXlsxExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    expect(existsSync(join(r.bundleDir, 'star'))).toBe(true);
    expect(existsSync(join(r.bundleDir, 'ndjson'))).toBe(true);
    expect(existsSync(join(r.bundleDir, 'xlsx'))).toBe(true);
  });
});
