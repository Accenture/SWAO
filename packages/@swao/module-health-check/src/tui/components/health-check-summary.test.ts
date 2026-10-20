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

// #3170: the Setup Wizard reported "3 failure(s)" for a run the runner logged
// as fail_count 0, because it counted every WARN line as a failure. The wizard
// now summarises the output with summariseHealthCheckOutput, which reads the
// runner's own summary line for the failure count and reports WARN separately.

import { describe, it, expect } from 'vitest';
import { summariseHealthCheckOutput, parseHealthCheckOutput } from './health-check-parse.js';

// Shape of the v1.4.0 UAT run: mcp=binary_not_found, prerequisites=warn and
// iac_toolchain=warn are WARN lines; the runner declared 0 failures.
const UAT_RUN = [
  'Running swao health-check...',
  '',
  '  [1/25] License...............  ok    Enterprise',
  '  [2/25] Playwright / Chromium..  ok    Chromium 1.0',
  '  [3/25] SWAO-MCP..............  WARN  swao binary path in config not found: C:\\swao\\old\\swao-enterprise-win-x64.exe',
  '  [9/25] Prerequisites.........  WARN  optional tools missing: gitleaks',
  '  [12/25] IaC toolchain........  WARN  IaC toolchain (partial): terraform v1.9.8. Not found: opentofu, pulumi, checkov, kics.',
  '  [19/25] Service workspace....  INFO  not a service workspace',
  '',
  '  Machine fingerprint: abcd1234  (needed when requesting a license key)',
  '',
  'All probes passed.',
];

describe('summariseHealthCheckOutput (#3170)', () => {
  it('reports WARN probes as warnings, not failures, for the UAT run shape', () => {
    const s = summariseHealthCheckOutput(UAT_RUN);
    expect(s.probeCount).toBe(6);
    expect(s.failCount).toBe(0);
    expect(s.failedProbes).toEqual([]);
    expect(s.warnCount).toBe(3);
    expect(s.warnedProbes).toEqual(['SWAO-MCP', 'Prerequisites', 'IaC toolchain']);
  });

  it('takes the failure count and keys from the runner summary line', () => {
    const lines = [
      '  [1/25] License...............  FAIL  licence invalid',
      '  [13/25] LLM gateway..........  FAIL  no connector',
      '  [9/25] Prerequisites.........  WARN  optional tools missing',
      '',
      '3 probe(s) failed: license, imports, llm-gateway.',
    ];
    const s = summariseHealthCheckOutput(lines);
    expect(s.failCount).toBe(3);
    expect(s.failedProbes).toEqual(['license', 'imports', 'llm-gateway']);
    expect(s.warnCount).toBe(1);
  });

  it('falls back to FAIL headers when the summary line is missing (child killed)', () => {
    const lines = [
      '  [1/25] License...............  FAIL  licence invalid',
      '  [2/25] Playwright / Chromium..  WARN  not in this build',
    ];
    const s = summariseHealthCheckOutput(lines);
    expect(s.failCount).toBe(1);
    expect(s.failedProbes).toEqual(['License']);
    expect(s.warnCount).toBe(1);
  });

  it('does not count a WARN or FAIL word inside a continuation line', () => {
    const lines = [
      '  [4/25] Community frameworks..  ok    3 standard + 1 community',
      '          WARN note: FAIL text in a detail line',
      'All probes passed.',
    ];
    const s = summariseHealthCheckOutput(lines);
    expect(s.failCount).toBe(0);
    expect(s.warnCount).toBe(0);
  });

  it('parseHealthCheckOutput does not attach the failure summary line to the last probe', () => {
    const probes = parseHealthCheckOutput([
      '  [1/25] License...............  FAIL  licence invalid',
      '1 probe(s) failed: license.',
    ]);
    expect(probes).toHaveLength(1);
    expect(probes[0]?.detailLines).toEqual([]);
  });
});
