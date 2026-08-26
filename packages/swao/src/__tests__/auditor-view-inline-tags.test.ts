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

// #0360 (sprint-039) -- inline tag rendering on the auditor markdown
// view. Builds a minimal wsp/wsp-plan.yaml in a tmpdir with a tagged
// GDPR control + a tagged NIST CSF control + an untagged community
// control, then asserts the auditor view renders tags inline next to
// tagged controls and is a no-op for the untagged one.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { formatViewAuditor } from '../commands/report.js';
import type { ReportData } from '../commands/report.js';

let WSP_DIR: string;
let TMP_PARENT: string;

const data: ReportData = {
  appId: 'fixture-app',
  assessedAt: '2026-05-24',
  iter: 1,
  sevenRLabel: 'Replatform',
  coverageScore: '85%',
  landingZone: 'stackit_de_sovereign',
  signalCounts: { total: 0 },
  blockers: [],
  topFindings: [],
  nextSteps: [],
};

beforeAll(() => {
  TMP_PARENT = mkdtempSync(join(tmpdir(), 'swao-auditor-tags-'));
  WSP_DIR = join(TMP_PARENT, 'wsp');
  mkdirSync(WSP_DIR, { recursive: true });
  writeFileSync(join(WSP_DIR, 'latest.txt'), '.', 'utf-8');

  // Minimal plan: 3 controls -- one GDPR + tags, one NIST + tags, one
  // community framework without tags. The auditor renderer pulls controls
  // from compliance.regimes[].controls[]; the rest of the plan structure
  // is irrelevant to this test.
  const plan = `
compliance:
  regimes:
    - id: gdpr
      name: GDPR
      controls:
        - id: gdpr-art-32
          outcome: SATISFIED
          severity: high
          rationale: "TLS 1.3 at rest + in transit; AES-256-GCM at the storage layer; controls verified via SBOM-EGR-CRYPTO pass chain."
          tags:
            - "technical-vs-organisational.technical"
            - "applies-to.controller"
            - "applies-to.processor"
    - id: nist-csf-2-0
      name: NIST CSF 2.0
      controls:
        - id: PR.DS-01
          outcome: PARTIAL
          severity: medium
          rationale: "Data-at-rest encryption verified for primary store; backup encryption status unknown pending DR pass."
          tags:
            - "csf-function.protect"
            - "applies-to.organisation"
    - id: untagged-community-framework
      name: Hypothetical Untagged Framework
      controls:
        - id: hyp-1.1
          outcome: UNKNOWN
          severity: low
          rationale: "Catalogue carries no tags; renderer must be a no-op for this control."
`.trim();
  writeFileSync(join(WSP_DIR, 'wsp-plan.yaml'), plan, 'utf-8');
});

afterAll(() => {
  if (TMP_PARENT) rmSync(TMP_PARENT, { recursive: true, force: true });
});

describe('auditor view -- inline tag rendering (#0360)', () => {
  it('renders a Tags: line on a GDPR control with axis + applies-to tags', () => {
    const out = formatViewAuditor(data, WSP_DIR);
    const block = sliceControlBlock(out, 'gdpr-art-32');
    expect(block).toContain('Tags:');
    expect(block).toContain('technical-vs-organisational.technical');
    expect(block).toContain('applies-to.controller');
    expect(block).toContain('applies-to.processor');
  });

  it('renders a Tags: line on a NIST CSF control with csf-function + applies-to tags', () => {
    const out = formatViewAuditor(data, WSP_DIR);
    const block = sliceControlBlock(out, 'PR.DS-01');
    expect(block).toContain('Tags:');
    expect(block).toContain('csf-function.protect');
    expect(block).toContain('applies-to.organisation');
  });

  it('does NOT render a Tags: line on an untagged control', () => {
    const out = formatViewAuditor(data, WSP_DIR);
    const block = sliceControlBlock(out, 'hyp-1.1');
    expect(block).not.toContain('Tags:');
  });

  it('renders tags-line BEFORE the Signals line (block ordering preserved)', () => {
    const out = formatViewAuditor(data, WSP_DIR);
    const block = sliceControlBlock(out, 'gdpr-art-32');
    const tagsIdx = block.indexOf('Tags:');
    const ratIdx = block.indexOf('Rationale:');
    expect(tagsIdx).toBeGreaterThan(ratIdx);
  });
});

// Helper: extract the per-control text block from a control id to the
// blank line that terminates it.
function sliceControlBlock(out: string, controlId: string): string {
  const lines = out.split('\n');
  const headIdx = lines.findIndex((l) => l.trim() === controlId);
  if (headIdx < 0) return '';
  let endIdx = headIdx + 1;
  while (endIdx < lines.length && lines[endIdx].trim() !== '') endIdx += 1;
  return lines.slice(headIdx, endIdx).join('\n');
}
