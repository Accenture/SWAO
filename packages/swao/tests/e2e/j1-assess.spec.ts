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
 * Journey J1 -- Application Assessment
 *
 * User journey (from docs/design/010-ux-access-design.md, J1):
 *   Alex runs swao assess against sovereign-health to produce a WSP.
 *   The pipeline runs all passes and emits progress indicators.
 *   Alex can select specific passes for faster targeted checks.
 */
import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { join } from 'path';
import { hasBinary, run, WORKSPACE, attachOutput } from './helpers.js';

test.skip(!hasBinary, 'swao binary not found -- run scripts/build-binary.sh first');

const APP_DIR = join(WORKSPACE, 'apps', 'sovereign-health');

test.describe('J1 -- Application Assessment', () => {

  // ── assess --help ─────────────────────────────────────────────────────────

  test('assess --help documents --app and --passes flags', async ({}, testInfo) => {
    const r = run(['assess', '--help']);
    attachOutput(testInfo, 'assess --help', r);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('--app');
    expect(r.stdout).toContain('--passes');
  });

  // ── inventory pass ────────────────────────────────────────────────────────

  test('assess runs inventory pass and exits 0', async ({}, testInfo) => {
    const r = run(['assess', '--app', 'sovereign-health', '--passes', 'inv', '--no-crawl']);
    attachOutput(testInfo, 'assess --passes inv', r);
    expect(r.status).toBe(0);
  });

  test('assess inventory pass emits progress marker', async ({}, testInfo) => {
    const r = run(['assess', '--app', 'sovereign-health', '--passes', 'inv', '--no-crawl']);
    attachOutput(testInfo, 'assess --passes inv (progress)', r);
    expect(r.combined).toContain('Pass 01');
  });

  test('assess inventory pass writes WSP file to disk', async ({}, testInfo) => {
    const r = run(['assess', '--app', 'sovereign-health', '--passes', 'inv', '--no-crawl']);
    attachOutput(testInfo, 'assess --passes inv (wsp file)', r);
    expect(existsSync(join(APP_DIR, 'wsp', 'passes', '01-inv.yaml'))).toBe(true);
  });

  // ── crypto pass ───────────────────────────────────────────────────────────

  test('assess crypto pass exits 0 and mentions crypto in output', async ({}, testInfo) => {
    const r = run(['assess', '--app', 'sovereign-health', '--passes', 'crypto', '--no-crawl']);
    attachOutput(testInfo, 'assess --passes crypto', r);
    expect(r.status).toBe(0);
    expect(r.combined.toLowerCase()).toContain('crypto');
  });

  // ── error cases ───────────────────────────────────────────────────────────

  test('assess exits non-zero when app does not exist', async ({}, testInfo) => {
    const r = run(['assess', '--app', 'no-such-app-xyz', '--passes', 'inv']);
    attachOutput(testInfo, 'assess (unknown app)', r);
    expect(r.status).not.toBe(0);
  });

  test('assess exits non-zero when --app flag is missing', async ({}, testInfo) => {
    const r = run(['assess', '--passes', 'inv']);
    attachOutput(testInfo, 'assess (missing --app)', r);
    expect(r.status).not.toBe(0);
  });

});
