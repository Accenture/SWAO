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
 * Pass smoke tests (#0670 Phase 1): verify each static analysis pass runs
 * and produces its output file when invoked via the community binary.
 *
 * Coverage:
 *   Static passes (no LLM key required): inv, state, sbom, tf, egr, crypto, scope
 *   LLM-required passes: data, ctx, synth, comp, blocks
 *     -- These are gated by it.skipIf(!hasLlmKey); they run only when
 *        SWAO_ANTHROPIC_API_KEY is set in the environment.
 *
 * All tests gate on it.skipIf(!hasBinary).  When the binary is absent they
 * log "skipped" instead of failing.
 *
 * Output path (empirically verified): apps/<app>/wsp/runs/<ts>/passes/NN-<name>.yaml
 * Run pointer:                        apps/<app>/wsp/latest.txt -> "runs/<ts>"
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

vi.setConfig({ testTimeout: 90_000 });

const __dirname = dirname(fileURLToPath(import.meta.url));

const REPO_ROOT    = resolve(__dirname, '../../../../');
const binaryName   = process.platform === 'win32' ? 'swao-community-win.exe' : 'swao-community-linux-x64';
const binaryPath   = join(REPO_ROOT, 'dist-bin', binaryName);
const hasBinary    = existsSync(binaryPath);
const hasLlmKey    = Boolean(process.env['SWAO_ANTHROPIC_API_KEY']);

const FIXTURE_ROOT = resolve(__dirname, '../../tests/fixtures/smoke-workspace');

let WORKSPACE: string;
let SANDBOX_HOME: string;

beforeAll(() => {
  if (!hasBinary) return;
  WORKSPACE    = mkdtempSync(join(tmpdir(), 'swao-pass-smoke-'));
  SANDBOX_HOME = mkdtempSync(join(tmpdir(), 'swao-pass-smoke-home-'));
  cpSync(FIXTURE_ROOT, WORKSPACE, { recursive: true });
}, 120_000);

afterAll(() => {
  if (!hasBinary) return;
  if (WORKSPACE)    rmSync(WORKSPACE,    { recursive: true, force: true });
  if (SANDBOX_HOME) rmSync(SANDBOX_HOME, { recursive: true, force: true });
}, 60_000);

function runPass(passName: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(
    binaryPath,
    ['assess', '--app', 'ci-app', '--passes', passName, '--no-crawl', '--workspace', WORKSPACE],
    {
      cwd: WORKSPACE,
      encoding: 'utf-8',
      timeout: 60_000,
      env: {
        ...process.env,
        HOME:        SANDBOX_HOME,
        USERPROFILE: SANDBOX_HOME,
        HOMEDRIVE:   '',
        HOMEPATH:    '',
      },
    },
  );
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
  };
}

/**
 * Find the pass YAML file for a given pass name prefix (e.g. "01-inv").
 * The binary writes to apps/ci-app/wsp/runs/<ts>/passes/<prefix>.yaml and
 * records the active run in apps/ci-app/wsp/latest.txt ("runs/<ts>").
 */
function passFileExists(prefix: string): boolean {
  const latestTxt = join(WORKSPACE, 'apps', 'ci-app', 'wsp', 'latest.txt');
  if (!existsSync(latestTxt)) return false;
  const runRel = readFileSync(latestTxt, 'utf-8').trim(); // e.g. "runs/2026-07-01T..."
  const passesDir = join(WORKSPACE, 'apps', 'ci-app', 'wsp', runRel, 'passes');
  if (!existsSync(passesDir)) return false;
  const files = readdirSync(passesDir);
  return files.some((f) => f.startsWith(prefix) && f.endsWith('.yaml'));
}

// ---------------------------------------------------------------------------
// Static passes -- no LLM key required
// ---------------------------------------------------------------------------

describe('Pass smoke -- static passes (#0670 Phase 1)', () => {

  it.skipIf(!hasBinary)('Pass 01 inv: exits 0 and emits 01-inv.yaml', () => {
    const { status, stdout, stderr } = runPass('inv');
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Pass 01');
    expect(passFileExists('01-inv')).toBe(true);
  });

  it.skipIf(!hasBinary)('Pass 02 state: exits 0 and emits 02-state.yaml', () => {
    const { status, stdout, stderr } = runPass('state');
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Pass 02');
    expect(passFileExists('02-state')).toBe(true);
  });

  it.skipIf(!hasBinary)('Pass 05 sbom: exits 0 and emits 05-sbom.yaml', () => {
    const { status, stdout, stderr } = runPass('sbom');
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Pass 05');
    expect(passFileExists('05-sbom')).toBe(true);
  });

  it.skipIf(!hasBinary)('Pass 06 tf: exits 0 and emits 06-tf.yaml', () => {
    const { status, stdout, stderr } = runPass('tf');
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Pass 06');
    expect(passFileExists('06-tf')).toBe(true);
  });

  it.skipIf(!hasBinary)('Pass 07 egr: exits 0 and emits 07-egr.yaml', () => {
    const { status, stdout, stderr } = runPass('egr');
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Pass 07');
    expect(passFileExists('07-egr')).toBe(true);
  });

  it.skipIf(!hasBinary)('Pass 08 crypto: exits 0 and emits 08-crypto.yaml', () => {
    const { status, stdout, stderr } = runPass('crypto');
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Pass 08');
    expect(passFileExists('08-crypto')).toBe(true);
  });

  it.skipIf(!hasBinary)('Pass 13 scope: exits 0 and emits 13-scope.yaml', () => {
    const { status, stdout, stderr } = runPass('scope');
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Pass 13');
    expect(passFileExists('13-scope')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LLM-required passes -- gated on SWAO_ANTHROPIC_API_KEY
// ---------------------------------------------------------------------------

describe('Pass smoke -- LLM-required passes (#0670 Phase 1)', () => {

  it.skipIf(!hasBinary || !hasLlmKey)('Pass 03 data: exits 0 and emits 03-data.yaml', () => {
    const { status, stdout, stderr } = runPass('data');
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Pass 03');
    expect(passFileExists('03-data')).toBe(true);
  });

  it.skipIf(!hasBinary || !hasLlmKey)('Pass 04 ctx: exits 0 and emits 04-ctx.yaml', () => {
    const { status, stdout, stderr } = runPass('ctx');
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Pass 04');
    expect(passFileExists('04-ctx')).toBe(true);
  });

  it.skipIf(!hasBinary || !hasLlmKey)('Pass 09 synth: exits 0 and emits 09-synth.yaml', () => {
    const { status, stdout, stderr } = runPass('synth');
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Pass 09');
    expect(passFileExists('09-synth')).toBe(true);
  });

  it.skipIf(!hasBinary || !hasLlmKey)('Pass 11 comp: exits 0 and emits 11-comp.yaml', () => {
    const { status, stdout, stderr } = runPass('comp');
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Pass 11');
    expect(passFileExists('11-comp')).toBe(true);
  });

  it.skipIf(!hasBinary || !hasLlmKey)('Pass 12 blocks: exits 0 and emits 12-blocks.yaml', () => {
    const { status, stdout, stderr } = runPass('blocks');
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Pass 12');
    expect(passFileExists('12-blocks')).toBe(true);
  });
});
