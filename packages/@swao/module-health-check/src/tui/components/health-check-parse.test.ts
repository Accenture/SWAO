// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { parseHealthCheckOutput } from './health-check-parse.js';

// Regression test for #0671: probe names containing spaces were silently dropped
// by the HEADER_RE because [^\s.]*? excluded whitespace. The fix uses [^.]+?
// which is safe against backtracking (dots are excluded, no overlap with \.+).

// Regression fixture for #1289: 12-probe output using the exact line format
// produced by health-check.ts formatBiExportProbeLine et al. (pad('[N/12] <name>', 26)).
// Dot counts: License=12, Playwright/Chromium=2, SWAO-MCP=11, Community frameworks=2,
// Import templates=3, Traceability=7, BI export=10, Scope=14, Prerequisites=6,
// VCS auth=10, Audit ingestion=3, Ingestion folder=2.
const SAMPLE_LINES_12 = [
  '  [1/12] License............  ok    Community (free, unlimited)  56/2000 used',
  '  [2/12] Playwright / Chromium..  WARN  Chromium not found',
  '  [3/12] SWAO-MCP...........  ok    MCP server reachable',
  '  [4/12] Community frameworks..  ok    3 standard + 2 community  no integrity issues',
  '          GDPR: controls.yaml ok',
  '  [5/12] Import templates...  ok    2 templates found',
  '  [6/12] Traceability.......  ok    All apps traceable',
  '  [7/12] BI export..........  INFO  no BI bundle under wsp/exports/ yet (run `swao export`)',
  '  [8/12] Scope..............  INFO  Pass 13 signal missing on 1 app',
  '  [9/12] Prerequisites......  INFO  `ssh` not on PATH',
  '  [10/12] VCS auth..........  ok    1 of 3 apps authenticated',
  '  [11/12] Audit ingestion...  INFO  [N/A] no audit module configured',
  '  [12/12] Ingestion folder..  INFO  No ingestion/ folder found',
  'All probes passed.',
];

const SAMPLE_LINES = [
  '  [1/11]  License.....................................  ok    56/2000 used',
  '  [2/11]  Playwright / Chromium.......................  WARN  Chromium not found',
  '  [3/11]  SWAO-MCP...................................  ok    MCP server reachable',
  '  [4/11]  Community frameworks.......................  ok    1 catalogue loaded',
  '          GDPR: controls.yaml ok',
  '  [5/11]  Import templates...........................  ok    2 templates found',
  '  [6/11]  Traceability...............................  ok    All apps traceable',
  '  [7/11]  BI export..................................  INFO  No BI bundle yet',
  '  [8/11]  Scope......................................  INFO  Pass 13 signal missing',
  '  [9/11]  Prerequisites..............................  INFO  `ssh` not on PATH',
  '  [10/11] VCS auth...................................  ok    1 of 3 apps authenticated',
  '  [11/11] Audit ingestion............................  INFO  No ingestion/ folder',
  'All probes passed.',
];

describe('parseHealthCheckOutput', () => {
  it('parses all 11 probes including multi-word names', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES);
    expect(probes).toHaveLength(11);
    expect(probes.map((p) => p.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('parses probe names with spaces and slashes correctly', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES);
    expect(probes[1]!.name).toBe('Playwright / Chromium');
    expect(probes[3]!.name).toBe('Community frameworks');
    expect(probes[4]!.name).toBe('Import templates');
    expect(probes[6]!.name).toBe('BI export');
    expect(probes[9]!.name).toBe('VCS auth');
    expect(probes[10]!.name).toBe('Audit ingestion');
  });

  it('attaches continuation lines only to the correct probe', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES);
    const compliance = probes.find((p) => p.name === 'Community frameworks')!;
    expect(compliance.detailLines).toContain('GDPR: controls.yaml ok');
    // Regression: [10/11] and [11/11] headers must NOT appear in [9/11] detail
    const prereqs = probes.find((p) => p.name === 'Prerequisites')!;
    expect(prereqs.detailLines).toHaveLength(0);
  });

  it('parses statuses correctly', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES);
    expect(probes[0]!.status).toBe('ok');
    expect(probes[1]!.status).toBe('WARN');
    expect(probes[6]!.status).toBe('INFO');
  });

  it('parses head messages', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES);
    expect(probes[0]!.headMessage).toBe('56/2000 used');
    expect(probes[8]!.headMessage).toContain('ssh');
  });

  it('does not include epilogue lines in any probe', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES);
    const allDetail = probes.flatMap((p) => p.detailLines);
    expect(allDetail).not.toContain('All probes passed.');
  });
});

// Exact-format fixture for the current 13-probe output (v0.9.8+, sprint-112).
// Dot counts computed from pad('[N/13] <name>', 26):
// License=12, Playwright/Chromium=2, SWAO-MCP=11, Community frameworks=2,
// Import templates=3 (INFO/absent -- the absent case that was not covered before),
// Traceability=7, BI export=10, Scope=14, Prerequisites=6, VCS auth=9,
// Audit ingestion=3, Ingestion folder=2, IaC toolchain=5.
const SAMPLE_LINES_13 = [
  '  [1/13] License............  ok    Enterprise (licensed)  203/2000 used',
  '  [2/13] Playwright / Chromium..  ok    Chromium installed',
  '  [3/13] SWAO-MCP...........  ok    MCP server reachable',
  '  [4/13] Community frameworks..  ok    4 community  no integrity issues',
  '  [5/13] Import templates...  INFO  no context_inputs entries registered in .swao.yml',
  '  [6/13] Traceability.......  INFO  no apps configured yet',
  '  [7/13] BI export..........  INFO  no BI bundle under wsp/exports/ yet',
  '  [8/13] Scope..............  WARN  Pass 13 signal missing on 1 app',
  '  [9/13] Prerequisites......  WARN  terraform not on PATH',
  '  [10/13] VCS auth.........  ok    all apps authenticated',
  '  [11/13] Audit ingestion...  INFO  [N/A] no audit module configured',
  '  [12/13] Ingestion folder..  ok    ingestion/ folder present',
  '  [13/13] IaC toolchain.....  WARN  No IaC toolchain found on PATH',
  'All probes passed.',
];

describe('parseHealthCheckOutput (13-probe output -- current format v0.9.8)', () => {
  it('parses all 13 probes including the new IaC toolchain probe', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_13);
    expect(probes).toHaveLength(13);
    expect(probes.map((p) => p.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('parses [5/13] Import templates with INFO status (absent case)', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_13);
    expect(probes[4]!.name).toBe('Import templates');
    expect(probes[4]!.num).toBe(5);
    expect(probes[4]!.total).toBe(13);
    expect(probes[4]!.status).toBe('INFO');
    expect(probes[4]!.headMessage).toContain('no context_inputs');
  });

  it('parses [12/13] Ingestion folder and [13/13] IaC toolchain', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_13);
    expect(probes[11]!.name).toBe('Ingestion folder');
    expect(probes[11]!.num).toBe(12);
    expect(probes[12]!.name).toBe('IaC toolchain');
    expect(probes[12]!.num).toBe(13);
    expect(probes[12]!.status).toBe('WARN');
  });

  it('does not include epilogue lines in any probe', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_13);
    const allDetail = probes.flatMap((p) => p.detailLines);
    expect(allDetail).not.toContain('All probes passed.');
  });
});

// Regression suite for [5/13]: verify that community-framework continuation
// lines (format: "  ..........................  [ok] community/<id> -- ...")
// produced by formatCommunityFrameworksProbeLine do NOT cause [5/13] Import
// templates to be dropped from the parsed probe list. Uses the ACTUAL format
// with 26-dot padding emitted by `pad('', 26)` so a parser regression is caught
// immediately without needing a live binary run.
const SAMPLE_LINES_13_WITH_COMMUNITY = [
  '  [1/13] License............  ok    Enterprise (licensed)  203/2000 used',
  '  [2/13] Playwright / Chromium..  ok    Chromium installed',
  '  [3/13] SWAO-MCP...........  ok    MCP server reachable',
  '  [4/13] Community frameworks..  ok    4 community  no integrity issues',
  '  ..........................  [ok] community/gdpr -- contributor=accenture, 45 controls',
  '  ..........................  [ok] community/ai_10_pillars -- contributor=accenture, 60 controls',
  '  ..........................  [ok] community/nist_sp_800_66r2 -- contributor=accenture, 55 controls',
  '  ..........................  [ok] community/ai_act -- contributor=accenture, 48 controls',
  '  [5/13] Import templates...  INFO  1 app(s) configured; none have context_inputs registered yet',
  '  [6/13] Traceability.......  INFO  no apps configured yet',
  '  [7/13] BI export..........  INFO  no BI bundle under wsp/exports/ yet',
  '  [8/13] Scope..............  WARN  Pass 13 signal missing on 1 app',
  '  [9/13] Prerequisites......  WARN  terraform not on PATH',
  '  [10/13] VCS auth.........  ok    all apps authenticated',
  '  [11/13] Audit ingestion...  INFO  [N/A] no audit module configured',
  '  [12/13] Ingestion folder..  ok    ingestion/ folder present',
  '  [13/13] IaC toolchain.....  WARN  No IaC toolchain found on PATH',
  'All probes passed.',
];

describe('parseHealthCheckOutput (13-probe + community continuation lines regression)', () => {
  it('parses all 13 probes when Community frameworks has 4 community continuation lines', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_13_WITH_COMMUNITY);
    expect(probes).toHaveLength(13);
    expect(probes.map((p) => p.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('[5/13] Import templates is present and correctly parsed after community lines', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_13_WITH_COMMUNITY);
    const p5 = probes.find((p) => p.num === 5)!;
    expect(p5).toBeDefined();
    expect(p5.name).toBe('Import templates');
    expect(p5.status).toBe('INFO');
    expect(p5.headMessage).toContain('context_inputs');
  });

  it('[4/13] Community frameworks absorbs community lines as detailLines', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_13_WITH_COMMUNITY);
    const p4 = probes.find((p) => p.num === 4)!;
    expect(p4.detailLines.length).toBe(4);
    expect(p4.detailLines[0]).toContain('community/gdpr');
  });
});

// Regression suite for #1289: [7/12] BI export row was absent from the TUI
// probe list when health-check emits 12 probes. Uses the exact line format
// produced by the format functions (pad('[N/12] <name>', 26)) so a future
// HEADER_RE change that silently drops probe 7 is caught immediately.
describe('parseHealthCheckOutput (12-probe output -- regression #1289)', () => {
  it('parses all 12 probes from current command output format', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_12);
    expect(probes).toHaveLength(12);
    expect(probes.map((p) => p.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('parses [7/12] BI export as probe 7 with correct fields', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_12);
    expect(probes[6]!.name).toBe('BI export');
    expect(probes[6]!.num).toBe(7);
    expect(probes[6]!.total).toBe(12);
    expect(probes[6]!.status).toBe('INFO');
    expect(probes[6]!.headMessage).toContain('no BI bundle');
  });

  it('parses [12/12] Ingestion folder as the last probe', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_12);
    expect(probes[11]!.name).toBe('Ingestion folder');
    expect(probes[11]!.num).toBe(12);
    expect(probes[11]!.total).toBe(12);
  });

  it('does not include epilogue lines in any probe', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_12);
    const allDetail = probes.flatMap((p) => p.detailLines);
    expect(allDetail).not.toContain('All probes passed.');
  });
});

// 14-probe fixture for the current format (v0.10.7+, #1705 fix).
// Denominator updated from 13 to 14 across all probe labels to match
// the actual wsp_metadata probe being present at startup.
// Dot counts from pad('[N/14] <name>', 26):
// License=12, Playwright/Chromium=2, SWAO-MCP=11, Community frameworks=2,
// Import templates=3, Traceability=7, BI export=10, Scope=14,
// Prerequisites=6, VCS auth=9, Ingestion folder=2, IaC toolchain=5,
// LLM gateway=7, Engagement=13.
const SAMPLE_LINES_14 = [
  '  [1/14] License............  ok    Enterprise (licensed)  203/2000 used',
  '  [2/14] Playwright / Chromium..  ok    Chromium installed',
  '  [3/14] SWAO-MCP...........  ok    swao server configured',
  '  [4/14] Community frameworks..  ok    4 community  no integrity issues',
  '  [5/14] Import templates...  INFO  no context_inputs entries registered',
  '  [6/14] Traceability.......  INFO  no apps configured yet',
  '  [7/14] BI export..........  INFO  no BI bundle under wsp/exports/ yet',
  '  [8/14] Scope..............  WARN  Pass 13 signal missing on 1 app',
  '  [9/14] Prerequisites......  WARN  terraform not on PATH',
  '  [10/14] VCS auth.........  ok    all apps authenticated',
  '  [11/14] Ingestion folder..  ok    ingestion/ folder present',
  '  [12/14] IaC toolchain.....  WARN  No IaC toolchain found on PATH',
  '  [13/14] LLM gateway.......  ok    1 connector found',
  '  [14/14] Engagement.........  ok    engagement.name set',
  'All probes passed.',
];

describe('parseHealthCheckOutput (14-probe output -- current format v0.10.7+, #1705)', () => {
  it('parses all 14 probes with consistent denominator', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_14);
    expect(probes).toHaveLength(14);
    expect(probes.map((p) => p.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(probes.every((p) => p.total === 14)).toBe(true);
  });

  it('[13/14] LLM gateway and [14/14] Engagement both parse correctly', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_14);
    expect(probes[12]!.name).toBe('LLM gateway');
    expect(probes[12]!.num).toBe(13);
    expect(probes[12]!.total).toBe(14);
    expect(probes[13]!.name).toBe('Engagement');
    expect(probes[13]!.num).toBe(14);
    expect(probes[13]!.total).toBe(14);
    expect(probes[13]!.status).toBe('ok');
  });

  it('does not include epilogue lines in any probe', () => {
    const probes = parseHealthCheckOutput(SAMPLE_LINES_14);
    const allDetail = probes.flatMap((p) => p.detailLines);
    expect(allDetail).not.toContain('All probes passed.');
  });
});
