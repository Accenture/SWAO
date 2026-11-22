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

// #4223 / #4294: the Ready row model (setup/ready-rows.ts).

import { describe, it, expect } from 'vitest';
import { BRANCH_STATE_LEVEL, branchStateWord, healthRow, readyLabelWidth, readyRowProps, readyRows } from './ready-rows.js';
import { APPLICATION_TOOL_GROUPS, checkApplicationTools } from './application-tools.js';
import type { SetupCheckItem } from './types.js';

const HEALTH = { scope: 'llm' as const, probeCount: 7, failCount: 1, warnCount: 1, failedProbes: ['llm_connectors'], warnedProbes: ['licence'] };

describe('readyRows (#4223)', () => {
  it('the Health check row carries the failed and warned probes on its line; a repeated Health check item is dropped', () => {
    const rows = readyRows([{ label: 'Health check', state: 'ok', detail: 'passed' }, { label: 'Run', state: 'ok', detail: 'can start' }], HEALTH);
    expect(rows.map((r) => r.label)).toEqual(['Health check', 'Run']);
    expect(rows[0]).toMatchObject({ level: 'fail', value: '7 probes, 1 failure, 1 warning: llm_connectors, licence' });
    expect(rows[0]!.guidance.sections).toEqual(expect.arrayContaining([{ label: 'Failed', text: 'llm_connectors' }, { label: 'Warnings', text: 'licence' }]));
    expect(healthRow(undefined)).toMatchObject({ level: 'waiting', label: 'Health check' });
  });

  it('tools of one group share one row at the place of the first tool; the guidance lists each tool in full', () => {
    const items = checkApplicationTools('.', { env: { PATH: '/bin' }, platform: 'linux', isFile: (p) => p === '/bin/yara' || p === '/bin/terraform' });
    const rows = readyRows([{ label: 'Apps', state: 'ok', detail: '1 app: shop' }, ...items], undefined);
    expect(rows.map((r) => [r.label, r.level, r.value])).toEqual([
      ['Health check', 'waiting', 'no result (run Health Check from the main menu)'],
      ['Apps', 'ok', '1 app: shop'],
      [APPLICATION_TOOL_GROUPS.scanner.label, 'warn', 'gitleaks, osv-scanner, clamav not found; yara found'],
      [APPLICATION_TOOL_GROUPS['code-health'].label, 'info', 'lizard, jscpd not found'],
      [APPLICATION_TOOL_GROUPS.iac.label, 'info', 'opentofu, pulumi, checkov, kics not found; terraform found'],
    ]);
    const sec = rows[2]!.guidance;
    expect(sec.what).toBe(APPLICATION_TOOL_GROUPS.scanner.what);
    expect(sec.sections!.map((s) => s.label)).toEqual(['gitleaks', 'osv-scanner', 'clamav', 'yara']);
    expect(sec.sections![0]!.text).toMatch(/^warn, not found: The default secret scan/);
  });

  it('a single item shows its short value; the full detail is the guidance', () => {
    const it: SetupCheckItem = { label: 'Assessed app', state: 'waiting', detail: 'No app has a completed Application Assessment; set up and run the Application Assessment first', short: 'run the Application Assessment first' };
    const [, row] = readyRows([it], undefined);
    expect(row).toMatchObject({ level: 'waiting', value: 'run the Application Assessment first' });
    expect(row!.guidance.what).toBe(it.detail);
  });
});

describe('Ready label column (#4223: labels never break inside a word)', () => {
  const rows = [{ label: 'Health check' }, { label: 'Candidate openrouter' }, { label: 'Policy baseline CLIENT_LZ_POLICY_BASELINE' }];
  for (const width of [98, 78]) {
    it(`widens to the longest label within the cap and gives a longer label its own line (${width})`, () => {
      const { labelWidth, cap } = readyLabelWidth(rows, width);
      expect(labelWidth).toBe('Candidate openrouter'.length + 2);
      expect(labelWidth).toBeLessThanOrEqual(cap);
      const long = readyRowProps({ level: 'warn', label: rows[2]!.label, value: 'framework not found', guidance: { title: 't', what: 'w' } }, labelWidth, width);
      expect(long.summary).toBeUndefined();
      expect(long.detail).toBe('framework not found');
      expect(long.labelWidth).toBeGreaterThan(rows[2]!.label.length);
      const short = readyRowProps({ level: 'ok', label: 'Health check', value: '7 probes', guidance: { title: 't', what: 'w' } }, labelWidth, width);
      expect(short).toMatchObject({ summary: '7 probes', labelWidth });
    });
  }
});

describe('branch state colour (#4294, Design 126 section 6)', () => {
  it('ready is ok (green), needs attention is warn, not set up is waiting (yellow, no new token)', () => {
    expect(BRANCH_STATE_LEVEL).toEqual({ ready: 'ok', 'needs-attention': 'warn', 'not-set-up': 'waiting' });
    expect(branchStateWord('not-set-up')).toEqual({ text: 'not set up', level: 'waiting' });
  });
});

describe('health row of a stopped health check (#4410)', () => {
  it('the incomplete field passed by SetupWizard alone makes the row fail, also with no failed probe entry', () => {
    const row = healthRow({ scope: 'generic', probeCount: 12, failCount: 0, warnCount: 0, failedProbes: [], warnedProbes: [], incomplete: 'health check did not finish (stopped after 120 s at probe community_frameworks)' });
    expect(row.level).toBe('fail');
  });
});
