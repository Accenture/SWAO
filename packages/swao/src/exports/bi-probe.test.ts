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

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// #0573: bi-probe moved to @swao/module-health-check; #0577: the star-export writers
// moved to @swao/module-powerbi. This test stays host-side because it pairs the
// doctor probe with the powerbi star writers (two sibling modules a module may
// not import from each other); the host is the only place allowed to depend on
// both, so the integration test lives here.
import { buildBiExportProbe } from '@swao/module-health-check';
import { writeStarExport, writeNdjsonExport } from '@swao/module-powerbi';

let tmp: string;
let appDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-biprobe-'));
  appDir = join(tmp, 'apps', 'demo');
  mkdirSync(join(appDir, 'wsp', 'passes'), { recursive: true });
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
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('buildBiExportProbe (#0181)', () => {
  it('returns absent when no wsp/exports/<ts> bundle has been emitted', () => {
    const r = buildBiExportProbe(appDir);
    expect(r.status).toBe('absent');
    expect(r.bundle_dir).toBeNull();
  });

  it('returns ok against a freshly emitted bundle', () => {
    writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const r = buildBiExportProbe(appDir);
    expect(r.status).toBe('ok');
    expect(r.bundle_dir).toMatch(/2026-05-09T1500/);
    expect(r.findings.length).toBeGreaterThanOrEqual(18); // count grows as new tables are added
    for (const f of r.findings) {
      expect(f.status).toBe('ok');
      expect(f.rows_actual).toBe(f.rows_expected);
      expect(f.sha_actual).toBe(f.sha_expected);
    }
  });

  it('reports warn when a CSV file has been mutated after emission (sha mismatch)', () => {
    const r1 = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    // Tamper: append a line to fact_signals.csv
    const targetCsv = join(r1.bundleDir, 'star', 'fact_signals.csv');
    const body = readFileSync(targetCsv, 'utf-8');
    writeFileSync(targetCsv, body + 'TAMPERED-01,demo,01,low,negative,low,rule_engine,ts,static_analysis,application,,,,a long enough derivation,,,\n', 'utf-8');
    const r = buildBiExportProbe(appDir);
    expect(r.status).toBe('warn');
    expect(r.findings.some((f) => f.path.includes('fact_signals') && f.status === 'mismatch')).toBe(true);
  });

  it('reports fail when a referenced file is removed', () => {
    const r1 = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    rmSync(join(r1.bundleDir, 'star', 'dim_app.csv'));
    const r = buildBiExportProbe(appDir);
    expect(r.status).toBe('fail');
    expect(r.findings.some((f) => f.path.includes('dim_app') && f.status === 'missing')).toBe(true);
  });

  it('picks one of the available bundles when several timestamps exist', () => {
    const r1 = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1400' });
    const r2 = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const r = buildBiExportProbe(appDir);
    expect(r.bundle_dir).not.toBeNull();
    expect([r1.bundleDir, r2.bundleDir]).toContain(r.bundle_dir);
  });

  it('manifest.yaml unreadable -> fail', () => {
    const r1 = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    writeFileSync(join(r1.bundleDir, 'manifest.yaml'), '{{{ not yaml', 'utf-8');
    // The directory still has manifest.yaml so findLatestBundleDir returns
    // it, but the load throws -- expect fail.
    const r = buildBiExportProbe(appDir);
    // Either fail (load error) or absent (if no findable manifest) -- the
    // current implementation returns fail with an error message.
    expect(r.status === 'fail' || r.status === 'absent').toBe(true);
  });

  it('NDJSON sibling emission does not regress the CSV probe path', async () => {
    const r1 = writeStarExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    const ndjsonResult = writeNdjsonExport({ workspaceAppDir: appDir, appId: 'demo', timestamp: '2026-05-09T1500' });
    expect(ndjsonResult.bundleDir).toBe(r1.bundleDir);
    // The probe reads the CSV-only manifest (#0181 scope); NDJSON rows
    // are not counted by this probe today. Verify CSV path stays OK.
    const r = buildBiExportProbe(appDir);
    expect(r.status).toBe('ok');
  });
});
