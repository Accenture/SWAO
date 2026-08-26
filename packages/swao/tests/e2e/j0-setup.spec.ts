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
 * Journey J0 -- Workspace Setup and Health Check
 *
 * User journey (from docs/design/010-ux-access-design.md, J0):
 *   Accenture consultant Alex receives a new client engagement.
 *   Alex runs swao health-check to verify the environment is ready,
 *   then inspects the machine fingerprint to request a license.
 *
 * These tests validate the non-interactive parts of J0 (the TUI wizard
 * is tested separately in binary-e2e.test.ts).
 */
import { test, expect } from '@playwright/test';
import { rmSync } from 'fs';
import { hasBinary, run, makeTempWorkspace, attachOutput } from './helpers.js';

test.skip(!hasBinary, 'swao binary not found -- run scripts/build-binary.sh first');

test.describe('J0 -- Workspace Setup and Health Check', () => {

  // ── Doctor probe ──────────────────────────────────────────────────────────

  test('health-check runs in the reference workspace and exits 0 or 1', async ({}, testInfo) => {
    const r = run(['health-check']);
    attachOutput(testInfo, 'health-check', r);
    expect([0, 1]).toContain(r.status);
  });

  test('health-check output contains expected probe sections', async ({}, testInfo) => {
    const r = run(['health-check']);
    attachOutput(testInfo, 'health-check', r);
    expect(r.combined.toLowerCase()).toContain('playwright');
    expect(r.combined.toLowerCase()).toMatch(/license|community|tier/);
  });

  test('health-check output includes Machine fingerprint for license request', async ({}, testInfo) => {
    const r = run(['health-check']);
    attachOutput(testInfo, 'health-check', r);
    expect([0, 1]).toContain(r.status);
    expect(r.combined).toContain('Machine fingerprint');
    expect(r.combined).toMatch(/[0-9a-f]{8}/i);
  });

  // ── Fresh workspace init ──────────────────────────────────────────────────

  test('doctor runs cleanly in a freshly-created workspace', async ({}, testInfo) => {
    const workspace = makeTempWorkspace('setup-test-app');
    try {
      const r = run(['health-check'], { cwd: workspace });
      attachOutput(testInfo, 'doctor (fresh workspace)', r);
      expect([0, 1]).toContain(r.status);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  // ── --version / --help sanity ─────────────────────────────────────────────

  test('--version prints SWAO version string', async ({}, testInfo) => {
    const r = run(['--version']);
    attachOutput(testInfo, '--version', r);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/SWAO.*v\d+\.\d+\.\d+/);
  });

  test('--help lists all primary subcommands', async ({}, testInfo) => {
    const r = run(['--help']);
    attachOutput(testInfo, '--help', r);
    expect(r.status).toBe(0);
    for (const cmd of ['assess', 'report', 'health-check', 'license', 'credential']) {
      expect(r.stdout).toContain(cmd);
    }
  });

});
