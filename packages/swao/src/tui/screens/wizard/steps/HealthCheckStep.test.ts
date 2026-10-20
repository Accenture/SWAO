// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI + orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3170: setup.health-check.complete reported "3 failure(s)" for a run that
// health-check.complete logged as fail_count 0: the wizard counted every WARN
// line (and binary_not_found) as a failure. It now uses the runner's own
// summary line for fail_count and reports warnings separately.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logged } = vi.hoisted(() => ({
  logged: [] as Array<{ level: string; code: string; message: string; context?: Record<string, unknown> }>,
}));

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return {
    ...actual,
    logPortfolio: (level: string, code: string, message: string, opts?: { context?: Record<string, unknown> }) => {
      logged.push({ level, code, message, context: opts?.context });
    },
  };
});

import { logSetupHealthCheckResult } from './HealthCheckStep.js';

beforeEach(() => { logged.length = 0; });

// The v1.4.0 UAT run: three WARN probes, runner summary "All probes passed."
const UAT_OUTPUT = [
  'Running swao health-check...',
  '  [1/25] License...............  ok    Enterprise',
  '  [3/25] SWAO-MCP..............  WARN  swao binary path in config not found: C:\\swao\\swao-v1.2.1\\swao-enterprise-win-x64.exe',
  '  [9/25] Prerequisites.........  WARN  optional tools missing: gitleaks',
  '  [12/25] IaC toolchain........  WARN  IaC toolchain (partial): terraform v1.9.8. Not found: opentofu, pulumi, checkov, kics.',
  '  Machine fingerprint: abcd1234  (needed when requesting a license key)',
  'All probes passed.',
];

describe('logSetupHealthCheckResult (#3170)', () => {
  it('reports fail_count 0 and the three warnings for the UAT run, matching health-check.complete', () => {
    logSetupHealthCheckResult(UAT_OUTPUT);
    expect(logged).toHaveLength(1);
    const ev = logged[0]!;
    expect(ev.code).toBe('setup.health-check.complete');
    expect(ev.context).toEqual({
      probe_count: 4,
      fail_count: 0,
      failed_probes: [],
      warn_count: 3,
      warned_probes: ['SWAO-MCP', 'Prerequisites', 'IaC toolchain'],
    });
    expect(ev.message).toBe('Setup Wizard health-check finished: 4 probes, 0 failure(s), 3 warning(s)');
  });

  it('carries the runner failure keys so the count is traceable', () => {
    logSetupHealthCheckResult([
      '  [1/25] License...............  FAIL  licence invalid',
      '  [9/25] Prerequisites.........  WARN  optional tools missing',
      '1 probe(s) failed: license.',
    ]);
    expect(logged[0]!.context).toMatchObject({ fail_count: 1, failed_probes: ['license'], warn_count: 1 });
  });

  it('emits setup.health-check.empty when no probe lines were parsed', () => {
    logSetupHealthCheckResult(['Running swao health-check...']);
    expect(logged.map((e) => e.code)).toEqual(['setup.health-check.empty']);
  });
});
