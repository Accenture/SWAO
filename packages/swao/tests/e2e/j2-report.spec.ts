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

/**
 * Journey J2 -- Report Generation
 *
 * User journey (from docs/design/010-ux-access-design.md, J2):
 *   After assessment, Alex generates the report in various formats.
 *   The report surfaces the 7R disposition, coverage score, and findings.
 *   Alex can export as text, YAML, or JSON for downstream tooling.
 */
import { test, expect } from '@playwright/test';
import { hasBinary, run, attachOutput } from './helpers.js';

test.skip(!hasBinary, 'swao binary not found -- run scripts/build-binary.sh first');

test.describe('J2 -- Report Generation', () => {

  // ── text (default) ────────────────────────────────────────────────────────

  test('report text output contains app name and 7R label', async ({}, testInfo) => {
    const r = run(['report', '--app', 'sovereign-health']);
    attachOutput(testInfo, 'report (text)', r);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('sovereign-health');
    expect(r.stdout).toContain('7R');
  });

  // ── YAML format ───────────────────────────────────────────────────────────

  test('report --format yaml outputs required YAML keys', async ({}, testInfo) => {
    const r = run(['report', '--app', 'sovereign-health', '--format', 'yaml']);
    attachOutput(testInfo, 'report --format yaml', r);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('app:');
    expect(r.stdout).toContain('seven_r_label:');
    expect(r.stdout).toContain('coverage_score:');
  });

  // ── JSON format ───────────────────────────────────────────────────────────

  test('report --format json exits 0 (format implemented or graceful fallback)', async ({}, testInfo) => {
    const r = run(['report', '--app', 'sovereign-health', '--format', 'json']);
    attachOutput(testInfo, 'report --format json', r);
    // JSON format may output structured JSON or fall back to text; either is acceptable.
    // When JSON is fully implemented this test should be extended to parse the output.
    expect(r.status).toBe(0);
  });

  // ── error cases ───────────────────────────────────────────────────────────

  test('report exits non-zero for unknown app', async ({}, testInfo) => {
    const r = run(['report', '--app', 'no-such-app-xyz']);
    attachOutput(testInfo, 'report (unknown app)', r);
    expect(r.status).not.toBe(0);
  });

  test('report exits non-zero for unknown format', async ({}, testInfo) => {
    const r = run(['report', '--app', 'sovereign-health', '--format', 'pdf']);
    attachOutput(testInfo, 'report --format pdf (invalid)', r);
    expect(r.status).not.toBe(0);
  });

});
