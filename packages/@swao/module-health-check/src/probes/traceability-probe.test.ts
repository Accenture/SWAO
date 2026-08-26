// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildTraceabilityProbe,
  computeAppTraceability,
  DEFAULT_TARGETS,
} from './traceability-probe.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-trace-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writePass(appDir: string, file: string, signals: Array<Record<string, unknown>>): void {
  mkdirSync(join(appDir, 'wsp', 'passes'), { recursive: true });
  const yaml = `pass:
  id: 1
  name: test
  status: complete
  iter: 1
signals:
${signals.map((s) => `  - ${Object.entries(s).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n    ')}`).join('\n')}
assessment: {}
`;
  writeFileSync(join(appDir, 'wsp', 'passes', file), yaml, 'utf-8');
}

function writePlan(appDir: string, controls: Array<Record<string, unknown>>): void {
  mkdirSync(join(appDir, 'wsp'), { recursive: true });
  const yaml = `compliance:
  regimes:
    - id: GDPR
      status: partial
      controls:
${controls.map((c) => `        - ${Object.entries(c).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n          ')}`).join('\n')}
migration_plan:
  runbook: []
risk_register: []
value_case: []
security_findings: []
assumptions: []
data_gaps: []
`;
  writeFileSync(join(appDir, 'wsp', 'wsp-plan.yaml'), yaml, 'utf-8');
}

describe('computeAppTraceability (#0170)', () => {
  it('returns null when wsp/ does not exist', () => {
    expect(computeAppTraceability('demo', tmp)).toBeNull();
  });

  it('counts signals and the rationale-coverage from a single pass', () => {
    writePass(tmp, '01-inv.yaml', [
      { id: 'INV-01', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Long enough derivation string to satisfy the v0.10 min(20) constraint' },
      { id: 'INV-02', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'short' },
    ]);
    const r = computeAppTraceability('demo', tmp)!;
    expect(r.counts.signals_total).toBe(2);
    expect(r.counts.signals_with_rationale).toBe(1);
    expect(r.coverage.rationale_coverage).toBeCloseTo(0.5, 6);
  });

  it('counts signals_with_outcome separately from rationale', () => {
    writePass(tmp, '01-inv.yaml', [
      { id: 'INV-01', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake', outcome: 'positive' },
      { id: 'INV-02', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake' },
    ]);
    const r = computeAppTraceability('demo', tmp)!;
    expect(r.counts.signals_with_outcome).toBe(1);
    expect(r.counts.signals_with_rationale).toBe(2);
  });

  it('counts signals_needing_fp only for severity >= medium AND outcome=negative', () => {
    writePass(tmp, '01-inv.yaml', [
      { id: 'INV-01', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake', severity: 'high', outcome: 'negative', false_positive_considered: true, false_positive_ruled_out: 'considered something; ruled out for clear reason' },
      { id: 'INV-02', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake', severity: 'low', outcome: 'negative' },
      { id: 'INV-03', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake', severity: 'high', outcome: 'positive' },
      { id: 'INV-04', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake', severity: 'critical', outcome: 'negative' },
    ]);
    const r = computeAppTraceability('demo', tmp)!;
    expect(r.counts.signals_needing_fp).toBe(2);
    expect(r.counts.signals_with_fp).toBe(1);
    expect(r.coverage.fp_consideration_coverage).toBeCloseTo(0.5, 6);
  });

  it('counts signals_with_chain when derivation_chain has at least one entry', () => {
    writePass(tmp, '01-inv.yaml', [
      { id: 'INV-01', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake', derivation_chain: ['PKG-04'] },
      { id: 'INV-02', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake', derivation_chain: [] },
      { id: 'INV-03', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake' },
    ]);
    const r = computeAppTraceability('demo', tmp)!;
    expect(r.counts.signals_with_chain).toBe(1);
    expect(r.coverage.chain_coverage).toBeCloseTo(1 / 3, 6);
  });

  it('counts compliance controls and their rationale coverage from wsp-plan.yaml', () => {
    mkdirSync(join(tmp, 'wsp', 'passes'), { recursive: true });
    writePlan(tmp, [
      { id: 'GDPR_Art_32', outcome: 'PARTIAL', rationale: 'Encryption verified at rest; logs unencrypted (gap)' },
      { id: 'GDPR_Art_9', outcome: 'GAP', rationale: 'short' },
      { id: 'GDPR_Art_5', outcome: 'SATISFIED' },
    ]);
    const r = computeAppTraceability('demo', tmp)!;
    expect(r.counts.controls_total).toBe(3);
    expect(r.counts.controls_with_outcome).toBe(3);
    expect(r.counts.controls_with_rationale).toBe(1);
    expect(r.coverage.control_rationale_coverage).toBeCloseTo(1 / 3, 6);
  });

  it('returns null when no passes/ directory exists (app not yet assessed)', () => {
    mkdirSync(join(tmp, 'wsp'), { recursive: true });
    const r = computeAppTraceability('demo', tmp);
    expect(r).toBeNull();
  });

  it('returns 1.0 coverage on empty denominators when passes/ exists but has no signal files', () => {
    mkdirSync(join(tmp, 'wsp', 'passes'), { recursive: true });
    const r = computeAppTraceability('demo', tmp)!;
    expect(r.coverage.rationale_coverage).toBe(1);
    expect(r.coverage.fp_consideration_coverage).toBe(1);
    expect(r.coverage.chain_coverage).toBe(1);
    expect(r.coverage.control_rationale_coverage).toBe(1);
  });
});

describe('buildTraceabilityProbe (#0170)', () => {
  it('returns absent when no apps with wsp/ are found', () => {
    const r = buildTraceabilityProbe(tmp);
    expect(r.status).toBe('absent');
    expect(r.apps).toEqual([]);
  });

  it('detects a single-app workspace and reports ok when targets are met', () => {
    writePass(tmp, '01-inv.yaml', [
      { id: 'INV-01', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake', outcome: 'positive', derivation_chain: ['PKG-01'] },
    ]);
    const r = buildTraceabilityProbe(tmp);
    expect(r.status).toBe('ok');
    expect(r.apps).toHaveLength(1);
    expect(r.apps[0]?.warnings).toEqual([]);
  });

  it('detects a portfolio workspace and discovers each apps/<id>/ entry', () => {
    const portfolio = tmp;
    mkdirSync(join(portfolio, 'apps', 'demo-a'), { recursive: true });
    mkdirSync(join(portfolio, 'apps', 'demo-b'), { recursive: true });
    writePass(join(portfolio, 'apps', 'demo-a'), '01-inv.yaml', [
      { id: 'INV-01', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake' },
    ]);
    writePass(join(portfolio, 'apps', 'demo-b'), '01-inv.yaml', [
      { id: 'INV-01', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake' },
    ]);
    const r = buildTraceabilityProbe(portfolio);
    const ids = r.apps.map((a) => a.app_id).sort();
    expect(ids).toEqual(['demo-a', 'demo-b']);
  });

  it('reports warn (not fail) when a target is missed during the v0.10 window', () => {
    writePass(tmp, '01-inv.yaml', [
      { id: 'INV-01', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake' },
      { id: 'INV-02', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'short' },
    ]);
    const r = buildTraceabilityProbe(tmp);
    expect(r.status).toBe('warn');
    expect(r.apps[0]?.warnings.some((w) => w.includes('rationale-coverage'))).toBe(true);
  });

  it('reads custom targets from .swao.yml when present', () => {
    writeFileSync(
      join(tmp, '.swao.yml'),
      `wsp_version: "0.9"
traceability:
  rationale_coverage_target: 0.50
  fp_consideration_target: 0.50
  chain_coverage_target: 0.00
  control_rationale_target: 0.50
`,
      'utf-8',
    );
    writePass(tmp, '01-inv.yaml', [
      { id: 'INV-01', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake' },
      { id: 'INV-02', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Also long enough derivation string for the constraint' },
    ]);
    const r = buildTraceabilityProbe(tmp);
    expect(r.targets.rationale_coverage_target).toBe(0.5);
    expect(r.status).toBe('ok');
  });

  it('default targets are exported and applied when .swao.yml is missing', () => {
    writePass(tmp, '01-inv.yaml', [
      { id: 'INV-01', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake' },
    ]);
    const r = buildTraceabilityProbe(tmp);
    expect(r.targets).toEqual(DEFAULT_TARGETS);
  });

  it('portfolio with root wsp/ present discovers apps/<id>/ entries, not the workspace root (#1701)', () => {
    // Reproduces the scenario where setup wizard creates a root wsp/ for portfolio-level
    // events while assessed apps live under apps/<id>/wsp/. Before the fix, discoverAppDirs
    // returned single-app mode because it checked root wsp/ first.
    mkdirSync(join(tmp, 'wsp'), { recursive: true }); // portfolio-level events dir (no passes/)
    mkdirSync(join(tmp, 'apps', 'sovereign-health'), { recursive: true });
    writePass(join(tmp, 'apps', 'sovereign-health'), '01-inv.yaml', [
      { id: 'INV-01', source: 'static_analysis', category: 'application', confidence: 'high', evidence: [], derivation: 'Padded derivation for the constraint sake', outcome: 'positive', derivation_chain: ['PKG-01'] },
    ]);
    const r = buildTraceabilityProbe(tmp);
    expect(r.status).toBe('ok');
    expect(r.apps).toHaveLength(1);
    expect(r.apps[0]?.app_id).toBe('sovereign-health');
  });

  it('reports informative absent message when apps with wsp/ exist but none have been assessed', () => {
    mkdirSync(join(tmp, 'apps', 'demo-app', 'wsp'), { recursive: true }); // wsp/ but no passes/
    const r = buildTraceabilityProbe(tmp);
    expect(r.status).toBe('absent');
    expect(r.message).toMatch(/app\(s\) found but none have completed assessment runs/);
  });
});
