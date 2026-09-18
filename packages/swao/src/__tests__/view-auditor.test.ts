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

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatViewAuditor, VALID_VIEWS } from '../commands/report.js';
import type { ReportData } from '../commands/report.js';

let tmp: string;
let wspDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-view-audit-'));
  wspDir = join(tmp, 'wsp');
  mkdirSync(join(wspDir, 'passes'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const baseData: ReportData = {
  appId: 'demo',
  assessedAt: '2026-05-09',
  iter: 1,
  sevenRLabel: 'Replatform',
  coverageScore: '85%',
  landingZone: 'stackit_de_sovereign',
  signalCounts: { total: 0 },
  blockers: [],
  topFindings: [],
  nextSteps: [],
};

function writePass(file: string, signalsBlock: string): void {
  writeFileSync(
    join(wspDir, 'passes', file),
    `pass:
  id: 1
  name: test
  status: complete
  iter: 1
signals:
${signalsBlock}
assessment: {}
`,
    'utf-8',
  );
}

function writePlan(controlsBlock: string): void {
  writeFileSync(
    join(wspDir, 'wsp-plan.yaml'),
    `compliance:
  regimes:
    - id: GDPR
      status: partial
      controls:
${controlsBlock}
migration_plan:
  runbook: []
risk_register: []
value_case: []
security_findings: []
assumptions: []
data_gaps: []
`,
    'utf-8',
  );
}

describe('VALID_VIEWS includes auditor (#0171)', () => {
  it('the auditor view is registered in the view enum', () => {
    expect(VALID_VIEWS).toContain('auditor');
  });
});

describe('formatViewAuditor (#0171)', () => {
  it('renders the summary card with app id, 7R, coverage', () => {
    const out = formatViewAuditor(baseData, wspDir);
    expect(out).toMatch(/Auditor View/);
    expect(out).toMatch(/demo/);
    expect(out).toMatch(/Replatform/);
    expect(out).toMatch(/85%/);
  });

  it('lists active regimes drawn from wsp-plan.yaml', () => {
    writePlan(`        - id: GDPR_Art_32
          outcome: PARTIAL
          rationale: Encryption at rest verified; pgbouncer log unencrypted at rest
`);
    const out = formatViewAuditor(baseData, wspDir);
    expect(out).toMatch(/Active regimes:\s+GDPR/);
  });

  it('renders per-control rows with outcome, rationale, signal_refs, and evidence_ids', () => {
    writePlan(`        - id: GDPR_Art_32
          outcome: PARTIAL
          severity: high
          rationale: Encryption at rest verified for primary database; logs unencrypted (gap)
          signal_refs: [CRYPTO-04, CRYPTO-09]
          evidence_ids: [PKG-04, PKG-08]
          assessor: rule_engine
          assessed_at: "2026-05-09T13:00:00Z"
          remediation: Move log file to encrypted volume mount
`);
    const out = formatViewAuditor(baseData, wspDir);
    expect(out).toMatch(/GDPR_Art_32/);
    expect(out).toMatch(/Outcome:\s+PARTIAL/);
    expect(out).toMatch(/Encryption at rest verified/);
    expect(out).toMatch(/CRYPTO-04, CRYPTO-09/);
    expect(out).toMatch(/PKG-04, PKG-08/);
    expect(out).toMatch(/Assessor:\s+rule_engine/);
    expect(out).toMatch(/Move log file/);
  });

  it('falls back to "(not yet recorded)" when control rationale is missing', () => {
    writePlan(`        - id: GDPR_Art_32
          outcome: GAP
`);
    const out = formatViewAuditor(baseData, wspDir);
    expect(out).toMatch(/Rationale:\s+\(not yet recorded\)/);
  });

  it('renders the per-signal drill-down for negative outcomes at medium+ severity', () => {
    writePass('01-inv.yaml', `  - id: INV-01
    source: static_analysis
    category: application
    confidence: high
    severity: high
    outcome: negative
    derivation: IBM MQ JMS dependency detected via pom.xml line 42; tier-1 blocker
    evidence: [pom.xml:42]
    false_positive_considered: true
    false_positive_ruled_out: considered upgrade path; ruled out because IBM MQ is the messaging substrate not just a client
    derivation_chain: [PKG-01]`);
    const out = formatViewAuditor(baseData, wspDir);
    expect(out).toMatch(/Per-Signal Drill-Down/);
    expect(out).toMatch(/INV-01/);
    expect(out).toMatch(/Severity:\s+high/);
    expect(out).toMatch(/Outcome:\s+negative/);
    expect(out).toMatch(/IBM MQ JMS dependency/);
    expect(out).toMatch(/False-positive considered:\s+yes/);
    expect(out).toMatch(/Chain:\s+PKG-01/);
  });

  it('marks negative-outcome signals at medium+ severity without FP narrative as not-yet-recorded', () => {
    writePass('01-inv.yaml', `  - id: INV-02
    source: static_analysis
    category: application
    confidence: high
    severity: high
    outcome: negative
    derivation: Long enough derivation to clear the v0.10 min length constraint
    evidence: []`);
    const out = formatViewAuditor(baseData, wspDir);
    expect(out).toMatch(/False-positive considered:\s+\(not yet recorded\)/);
  });

  it('renders the coverage table with totals and percentages', () => {
    writePass('01-inv.yaml', `  - id: INV-01
    source: static_analysis
    category: application
    confidence: high
    severity: high
    outcome: negative
    derivation: Long enough derivation to clear the v0.10 min length constraint
    evidence: []
    false_positive_considered: true
    false_positive_ruled_out: considered alternative path; ruled out for clear factual reason here
    derivation_chain: [PKG-01]
  - id: INV-02
    source: static_analysis
    category: application
    confidence: high
    severity: low
    outcome: positive
    derivation: Long enough derivation to clear the v0.10 min length constraint
    evidence: []`);
    const out = formatViewAuditor(baseData, wspDir);
    expect(out).toMatch(/Traceability Coverage/);
    expect(out).toMatch(/Signals total \.+\s+2/);
    expect(out).toMatch(/Signals with outcome \.+\s+2/);
    expect(out).toMatch(/Signals needing FP narrative \.+\s+1/);
    expect(out).toMatch(/Signals with FP narrative \.+\s+1/);
  });

  it('shows positive / neutral / indeterminate counts in the summary card', () => {
    writePass('01-inv.yaml', `  - id: INV-01
    source: static_analysis
    category: application
    confidence: high
    outcome: positive
    derivation: Long enough derivation to clear the v0.10 min length constraint
    evidence: []
  - id: INV-02
    source: static_analysis
    category: application
    confidence: high
    outcome: neutral
    derivation: Long enough derivation to clear the v0.10 min length constraint
    evidence: []`);
    const out = formatViewAuditor(baseData, wspDir);
    expect(out).toMatch(/positive 1/);
    expect(out).toMatch(/neutral 1/);
  });

  it('handles missing wsp-plan.yaml gracefully (no Regime sections)', () => {
    const out = formatViewAuditor(baseData, wspDir);
    expect(out).toMatch(/Auditor View/);
    expect(out).toMatch(/Active regimes:\s+--/);
  });
});
