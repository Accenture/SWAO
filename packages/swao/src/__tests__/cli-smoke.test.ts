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
 * CLI smoke tests (#0670 Phase 1): verify every major CLI verb exits 0 with
 * expected output patterns.
 *
 * Requires the community binary to be built.  Tests are skipped automatically
 * when the binary is absent via `it.skipIf(!hasBinary)` -- no test fails,
 * it logs "skipped" instead.
 *
 * LLM-dependent passes (data, ctx, synth, comp, blocks) are excluded from
 * the smoke assess call; the binary prints a [warn] line and skips them
 * cleanly when no LLM provider is configured.  The static pass set
 * (inv, state, sbom, tf, egr, crypto, scope) runs without a key and is
 * covered here.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

vi.setConfig({ testTimeout: 60_000 });

const __dirname = dirname(fileURLToPath(import.meta.url));

// Repo path: __tests__/ inside src/ inside packages/swao/ inside packages/
// inside swao/ inside REPO_ROOT.
const REPO_ROOT    = resolve(__dirname, '../../../../');
const binaryName   = process.platform === 'win32' ? 'swao-community-win.exe' : 'swao-community-linux-x64';
const binaryPath   = join(REPO_ROOT, 'dist-bin', binaryName);
const hasBinary    = existsSync(binaryPath);

// Committed smoke fixture: minimal portfolio workspace with a single ci-app.
// Copied to a temp dir per-suite so assess writes do not accumulate in git.
const FIXTURE_ROOT = resolve(__dirname, '../../tests/fixtures/smoke-workspace');

let WORKSPACE: string;
let SANDBOX_HOME: string;

beforeAll(() => {
  if (!hasBinary) return;
  WORKSPACE    = mkdtempSync(join(tmpdir(), 'swao-cli-smoke-'));
  SANDBOX_HOME = mkdtempSync(join(tmpdir(), 'swao-cli-smoke-home-'));
  cpSync(FIXTURE_ROOT, WORKSPACE, { recursive: true });
}, 120_000);

afterAll(() => {
  if (!hasBinary) return;
  if (WORKSPACE)    rmSync(WORKSPACE,    { recursive: true, force: true });
  if (SANDBOX_HOME) rmSync(SANDBOX_HOME, { recursive: true, force: true });
}, 60_000);

/** Spawn the community binary with sandboxed HOME and explicit --workspace. */
function run(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(binaryPath, args, {
    cwd: WORKSPACE,
    encoding: 'utf-8',
    timeout: 30_000,
    env: {
      ...process.env,
      HOME:        SANDBOX_HOME,
      USERPROFILE: SANDBOX_HOME,
      HOMEDRIVE:   '',
      HOMEPATH:    '',
    },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
  };
}

// ---------------------------------------------------------------------------
// Basic sanity
// ---------------------------------------------------------------------------

describe('CLI smoke -- community binary (#0670 Phase 1)', () => {

  it.skipIf(!hasBinary)('--version exits 0 and contains version string', () => {
    const { stdout, status } = run(['--version']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/SWAO.*v\d+\.\d+\.\d+/);
  });

  it.skipIf(!hasBinary)('--help exits 0 and contains "assess"', () => {
    const { stdout, status } = run(['--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('assess');
  });

  it.skipIf(!hasBinary)('health-check exits 0 or 1', { timeout: 150_000 }, () => {
    // health-check exits 0 (all checks pass) or 1 (warnings); both are
    // acceptable outcomes.  See binary-e2e.test.ts for the same pattern.
    // Spawn timeout 120s: the Playwright/Chromium probe alone can take
    // minutes on machines without a cached browser; 30s produced
    // status=null timeout flakes on otherwise healthy binaries.
    const result = spawnSync(binaryPath, ['health-check'], {
      cwd: tmpdir(),
      encoding: 'utf-8',
      timeout: 120_000,
      env: {
        ...process.env,
        HOME:        SANDBOX_HOME,
        USERPROFILE: SANDBOX_HOME,
        HOMEDRIVE:   '',
        HOMEPATH:    '',
      },
    });
    expect([0, 1]).toContain(result.status ?? -1);
  });

  // ---- init ----------------------------------------------------------------

  it.skipIf(!hasBinary)('init --name exits 0 and scaffolds ingestion directory', () => {
    const initDir = mkdtempSync(join(tmpdir(), 'swao-init-smoke-'));
    try {
      const result = spawnSync(
        binaryPath,
        ['init', '--name', 'ci-smoke-init'],
        {
          cwd: initDir,
          encoding: 'utf-8',
          timeout: 30_000,
          env: {
            ...process.env,
            HOME:        SANDBOX_HOME,
            USERPROFILE: SANDBOX_HOME,
            HOMEDRIVE:   '',
            HOMEPATH:    '',
          },
        },
      );
      expect(result.status ?? -1).toBe(0);
      const combined = (result.stdout ?? '') + (result.stderr ?? '');
      expect(combined).toContain('[ok]');
      expect(existsSync(join(initDir, 'apps', 'ci-smoke-init', 'ingestion'))).toBe(true);
    } finally {
      rmSync(initDir, { recursive: true, force: true });
    }
  });

  // ---- assess (static passes, no LLM key required) -------------------------

  it.skipIf(!hasBinary)('assess --passes inv exits 0 and emits pass file', () => {
    const { stdout, stderr, status } = run([
      'assess', '--app', 'ci-app',
      '--passes', 'inv',
      '--no-crawl',
      '--workspace', WORKSPACE,
    ]);
    const combined = stdout + stderr;
    expect(status).toBe(0);
    expect(combined).toContain('Pass 01');
    const latestTxt = join(WORKSPACE, 'apps', 'ci-app', 'wsp', 'latest.txt');
    expect(existsSync(latestTxt)).toBe(true);
    const runRel = readFileSync(latestTxt, 'utf-8').trim();
    expect(existsSync(join(WORKSPACE, 'apps', 'ci-app', 'wsp', runRel, 'passes', '01-inv.yaml'))).toBe(true);
  });

  it.skipIf(!hasBinary)('assess static pass set exits 0 and completes', () => {
    const { stdout, stderr, status } = run([
      'assess', '--app', 'ci-app',
      '--passes', 'inv,state,sbom,tf,egr,crypto,scope',
      '--no-crawl',
      '--workspace', WORKSPACE,
    ]);
    const combined = stdout + stderr;
    expect(status).toBe(0);
    expect(combined).toContain('Assessment complete');
  });

  it.skipIf(!hasBinary)('assess exits non-zero for unknown app', () => {
    const { status } = run([
      'assess', '--app', 'no-such-app',
      '--passes', 'inv',
      '--workspace', WORKSPACE,
    ]);
    expect(status).not.toBe(0);
  });

  // ---- report (depends on a prior assess run in the same suite) ------------

  it.skipIf(!hasBinary)('report exits 0 after assess', () => {
    const { status } = run([
      'report', '--app', 'ci-app',
      '--workspace', WORKSPACE,
    ]);
    expect(status).toBe(0);
  });

  // ---- export --------------------------------------------------------------

  it.skipIf(!hasBinary)('export --formats csv exits 0 and produces star bundle', () => {
    const { stdout, status } = run([
      'export', '--app', 'ci-app',
      '--formats', 'csv',
      '--no-templates',
      '--workspace', WORKSPACE,
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain('[ok]');
    expect(stdout.toLowerCase()).toMatch(/star|\.csv/);
  });
});
