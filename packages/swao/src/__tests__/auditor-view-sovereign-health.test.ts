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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { formatViewAuditor } from '../commands/report.js';
import type { ReportData } from '../commands/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_WSP = join(
  __dirname,
  '../../../../../examples/portfolio-workspace/portfolio/apps/sovereign-health/wsp',
);

// #0319 hermeticity: copy the sovereign-health wsp/ to a tmpdir so the
// test never writes into the tracked example fixture. The previous
// `beforeEach` wrote '.' into wsp/latest.txt every run, overwriting the
// committed pointer (currently runs/2026-05-19T17-43-53) and dirtying
// the git tree. The tmpdir copy carries its own latest.txt set to '.'
// so the auditor view resolves wsp/passes/ from the curated golden
// fixture content.
let SOVEREIGN_HEALTH_WSP: string;
let TMP_PARENT: string;

beforeAll(() => {
  TMP_PARENT = mkdtempSync(join(tmpdir(), 'swao-auditor-view-'));
  SOVEREIGN_HEALTH_WSP = join(TMP_PARENT, 'wsp');
  cpSync(SOURCE_WSP, SOVEREIGN_HEALTH_WSP, { recursive: true });
  // Pin latest.txt to '.' in the COPY so the run-dir resolver loads
  // wsp/passes/ directly (the curated golden fixture content).
  writeFileSync(join(SOVEREIGN_HEALTH_WSP, 'latest.txt'), '.', 'utf-8');
});

afterAll(() => {
  if (TMP_PARENT) rmSync(TMP_PARENT, { recursive: true, force: true });
});

const data: ReportData = {
  appId: 'sovereign-health',
  assessedAt: '2026-04-30',
  iter: 1,
  sevenRLabel: 'Replatform',
  coverageScore: '93%',
  landingZone: 'stackit_de_sovereign',
  signalCounts: { total: 0 },
  blockers: [],
  topFindings: [],
  nextSteps: [],
};

describe('Auditor view against the sovereign-health golden fixture (#0174)', () => {
  it('renders the summary card with sovereign-health metadata', () => {
    const out = formatViewAuditor(data, SOVEREIGN_HEALTH_WSP);
    expect(out).toMatch(/sovereign-health/);
    expect(out).toMatch(/Replatform/);
    expect(out).toMatch(/93%/);
  });

  it('shows the DATA-01 FP narrative (closes #0157 partial scope)', () => {
    const out = formatViewAuditor(data, SOVEREIGN_HEALTH_WSP);
    expect(out).toMatch(/DATA-01/);
    expect(out).toMatch(/False-positive considered:\s+yes/);
    expect(out).toMatch(/tokenised|pseudonymised/);
  });

  it('shows the DATA-02 FP narrative explaining Art. 17(3)(b) balance', () => {
    const out = formatViewAuditor(data, SOVEREIGN_HEALTH_WSP);
    expect(out).toMatch(/DATA-02/);
    expect(out).toMatch(/Art\. 17\(3\)\(b\)|legal-obligation derogation/);
  });

  it('coverage table reports a non-zero rationale-coverage', () => {
    const out = formatViewAuditor(data, SOVEREIGN_HEALTH_WSP);
    const m = out.match(/Signals with rationale \.+\s+(\d+)\s+\((\d+)%\)/);
    expect(m).not.toBeNull();
    if (m) {
      const pct = parseInt(m[2]!, 10);
      expect(pct).toBeGreaterThanOrEqual(95);
    }
  });

  it('coverage table reports a non-zero outcome-coverage now that the fixture is migrated', () => {
    const out = formatViewAuditor(data, SOVEREIGN_HEALTH_WSP);
    const m = out.match(/Signals with outcome \.+\s+(\d+)\s+\((\d+)%\)/);
    expect(m).not.toBeNull();
    if (m) {
      const pct = parseInt(m[2]!, 10);
      expect(pct).toBeGreaterThanOrEqual(95);
    }
  });
});
