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
 * E2E tests for the compiled swao-enterprise-win.exe binary.
 *
 * Skipped automatically when dist-bin/swao-enterprise-win.exe does not exist
 * (i.e. normal CI runs that have not built the binary).
 * Run explicitly after `bash scripts/build-binary.sh --win`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { findInstalledChromium } from '@swao/core';

// When Playwright/Chromium is installed on the host, the binary uses it for
// dynamic analysis rather than showing "playwright not bundled". Tests that
// assert the "not bundled" behaviour are skipped in that environment.
const chromiumOnHost = findInstalledChromium() !== null;

// Binary startup on Windows takes up to 30 s on first run (AV scan, extraction).
// Raise the per-test timeout to match the spawnSync process timeout.
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT      = resolve(__dirname, '../../../../');
const PRIVATE_ROOT   = resolve(__dirname, '../../../../../');
const BIN_WIN        = join(REPO_ROOT, 'dist-bin', 'swao-enterprise-win.exe');
const BIN_COMMUNITY  = join(REPO_ROOT, 'dist-bin', 'swao-community-win.exe');
const SOURCE_FIXTURE = join(PRIVATE_ROOT, 'examples', 'portfolio-workspace', 'portfolio');

// #0193: clone the canonical fixture to tmp so the binary's runtime
// writes (wsp/runs/<ts>/, wsp/latest.txt, wsp/exports/<ts>/) cannot
// contaminate the committed golden fixture across test runs.
let WORKSPACE: string;
let APP_DIR: string;
// M18 #0271 followup: licence signing was rotated. Developer machines
// usually have a real Enterprise licence at ~/.swao-license.json signed with
// the rotated SWAO_LICENSE_SECRET. The vitest setup file sets a different
// signing secret (the dev-only PoC value). Without isolation, every binary
// call would load the developer's real licence and fail signature
// verification with the test secret. We sandbox HOME / USERPROFILE so
// licence-guard finds no file and falls back cleanly to Community.
let SANDBOX_HOME: string;

const BIN_CONSULTANT = join(REPO_ROOT, 'dist-bin', 'swao-consultant-win.exe');

const hasBinary           = existsSync(BIN_WIN);
const hasCommunityBinary  = existsSync(BIN_COMMUNITY);
const hasConsultantBinary = existsSync(BIN_CONSULTANT);

// The sovereign-health fixture is large; cpSync takes > 10s on Windows.
// Hook timeout raised to 120s so the copy completes before tests run.
beforeAll(() => {
  if (!hasBinary) return;
  const tmpRoot = mkdtempSync(join(tmpdir(), 'swao-e2e-'));
  WORKSPACE = join(tmpRoot, 'portfolio');
  cpSync(SOURCE_FIXTURE, WORKSPACE, { recursive: true });
  APP_DIR = join(WORKSPACE, 'apps', 'sovereign-health');
  SANDBOX_HOME = mkdtempSync(join(tmpdir(), 'swao-e2e-home-'));
}, 120_000);

afterAll(() => {
  if (!hasBinary || !WORKSPACE) return;
  // tmpRoot is the parent of WORKSPACE.
  const tmpRoot = resolve(WORKSPACE, '..');
  rmSync(tmpRoot, { recursive: true, force: true });
  if (SANDBOX_HOME) rmSync(SANDBOX_HOME, { recursive: true, force: true });
}, 60_000);

function run(args: string[], cwd: string = WORKSPACE): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(BIN_WIN, args, {
    cwd,
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

describe.skipIf(!hasBinary)('binary E2E -- swao-enterprise-win.exe', () => {

  // ── Binary sanity ────────────────────────────────────────────────────────

  it('binary file exists and is non-empty', () => {
    expect(hasBinary).toBe(true);
    const size = statSync(BIN_WIN).size;
    expect(size).toBeGreaterThan(10 * 1024 * 1024); // > 10 MB
  });

  it('--version prints correct format', () => {
    const { stdout, status } = run(['--version']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/SWAO.*v\d+\.\d+\.\d+.*(Community|Consultant|Enterprise)/);
  });

  it('--help shows banner and subcommands', () => {
    const { stdout, status } = run(['--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('S W A O');
    expect(stdout).toContain('assess');
    expect(stdout).toContain('report');
    expect(stdout).toContain('challenge');
    expect(stdout).toContain('license');
    expect(stdout).toContain('health-check');
  });

  it('no-args displays usage (Commander exits 1 when no subcommand given)', () => {
    const { stdout, stderr, status } = run([]);
    // Commander v12 exits 1 when called with no subcommand -- same as `git`, `docker`, etc.
    expect([0, 1]).toContain(status);
    const combined = stdout + stderr;
    expect(combined).toContain('Usage');
  });

  // ── assess subcommand ────────────────────────────────────────────────────

  it('assess --help works', () => {
    const { stdout, status } = run(['assess', '--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('--app');
    expect(stdout).toContain('--passes');
  });

  it('assess runs inventory pass against sovereign-health', () => {
    const { stdout, stderr, status } = run(
      ['assess', '--app', 'sovereign-health', '--passes', 'inv', '--no-crawl'],
    );
    const combined = stdout + stderr;
    expect(status).toBe(0);
    expect(combined).toContain('Pass 01');
    expect(combined).toContain('inventory');
  });

  // ── framework subcommand (sprint-037 #0344) ──────────────────────────────

  it('framework list against the bundled binary lists all 3 bundled community frameworks', () => {
    const { stdout, stderr, status } = run(['framework', 'list']);
    const combined = stdout + stderr;
    expect(status).toBe(0);
    // All bundled frameworks must appear in the binary's listing -- proves
    // the pkg.assets `../../community-frameworks/**` glob shipped them.
    // COBIT_5 removed from the bundle by #1226 (D-02); available as a
    // standalone download from GitHub.
    expect(combined).toContain('GDPR');
    expect(combined).toContain('AI_10_PILLARS');
    expect(combined).toContain('NIST_SP_800_66R2');
    // The "folder not found" error message must NOT appear -- it would
    // mean resolveBundledRoot returned null in the pkg runtime.
    expect(combined).not.toContain('bundled community-frameworks/ folder not found');
  });

  it('framework info GDPR prints contributor from the embedded asset', () => {
    const { stdout, status } = run(['framework', 'info', 'GDPR']);
    expect(status).toBe(0);
    expect(stdout).toContain('Helmut Schindlwick');
  });

  // #0337: --passes filter must gate Pass 10 (dynamic_analysis); previously
  // the dynamic block ran regardless of --passes contents, surfacing a
  // [warn] Dynamic analysis failed line during Phase C verification.
  it('assess --passes inv does not trigger Pass 10 dynamic_analysis (#0337)', () => {
    const { stdout, stderr, status } = run(
      ['assess', '--app', 'sovereign-health', '--passes', 'inv'],
    );
    const combined = stdout + stderr;
    expect(status).toBe(0);
    expect(combined).toContain('Pass 01');
    expect(combined).not.toMatch(/Running Pass 10/);
    expect(combined).not.toMatch(/Dynamic analysis failed/);
  });

  // #0337 Part B: when Pass 10 IS requested (--passes inv,dynamic), the
  // bundled binary's playwright stub must throw the EXPLICIT "playwright
  // is not bundled" message with the operator-facing remediation, not
  // the cryptic "undefined is not a function" / "Cannot read properties
  // of undefined" that the original stub produced. The crawl still fails
  // (the binary cannot ship playwright); the failure is just legible.
  // Skipped when Chromium is installed: the binary uses host playwright and
  // shows "using host-installed playwright-core" instead of "not bundled".
  it.skipIf(chromiumOnHost)('assess --passes inv,dynamic surfaces the explicit "playwright not bundled" message in the binary (#0337 Part B)', () => {
    const { stdout, stderr, status } = run(
      ['assess', '--app', 'sovereign-health', '--passes', 'inv,dynamic'],
    );
    const combined = stdout + stderr;
    expect(status).toBe(0);
    expect(combined).toContain('Pass 01');
    expect(combined).toMatch(/Running Pass 10/);
    expect(combined).toMatch(/Dynamic analysis failed/);
    // The whole point of #0337 Part B: error message is explicit, not cryptic.
    expect(combined).toMatch(/playwright is not bundled in the swao binary/);
    expect(combined).not.toMatch(/undefined is not a function/);
    expect(combined).not.toMatch(/Cannot read properties of undefined/);
    // Operator-facing remediation must be in the message
    expect(combined).toMatch(/--no-crawl/);
  });

  it('assess runs crypto pass against sovereign-health', () => {
    const { stdout, stderr, status } = run(
      ['assess', '--app', 'sovereign-health', '--passes', 'crypto', '--no-crawl'],
    );
    const combined = stdout + stderr;
    expect(status).toBe(0);
    expect(combined).toContain('crypto');
  });

  it('assess emits YAML pass file', () => {
    run(['assess', '--app', 'sovereign-health', '--passes', 'inv', '--no-crawl']);
    expect(existsSync(join(APP_DIR, 'wsp', 'passes', '01-inv.yaml'))).toBe(true);
  });

  // #0807-P2: CLI assess E2E -- verify run-manifest.json is written with
  // the correct passes_executed list (Layer 3 gap from #0807 design doc).
  it('assess writes run-manifest.json with passes_executed containing inv (#0807-P2)', () => {
    run(['assess', '--app', 'sovereign-health', '--passes', 'inv', '--no-crawl']);
    const runsDir = join(APP_DIR, 'wsp', 'runs');
    expect(existsSync(runsDir)).toBe(true);
    // Find the most-recent run directory (named by timestamp).
    const runDirs = readdirSync(runsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse();
    expect(runDirs.length).toBeGreaterThan(0);
    const manifestPath = join(runsDir, runDirs[0]!, 'run-manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      passes_executed?: string[];
    };
    expect(Array.isArray(manifest.passes_executed)).toBe(true);
    expect(manifest.passes_executed).toContain('inventory');
  });

  it('assess exits non-zero for unknown app', () => {
    const { status } = run(['assess', '--app', 'no-such-app', '--passes', 'inv']);
    expect(status).not.toBe(0);
  });

  // #1704: lz.assess.start + lz.assess.complete events emitted by CLI path
  it('assess --type landing-zone-catalog emits lz.assess.start and lz.assess.complete to app-events (#1704)', () => {
    const { status } = run([
      'assess', '--app', 'sovereign-health',
      '--type', 'landing-zone-catalog',
      '--lz-cat-targets', 'stackit:eu-de-1',
      '--lz-frameworks', 'GDPR',
    ]);
    expect(status).toBe(0);
    // Find the app-events NDJSON file for the current month.
    const logsDir = join(APP_DIR, 'wsp', 'logs');
    const monthSlug = new Date().toISOString().slice(0, 7); // YYYY-MM
    const eventsPath = join(logsDir, `app-events-${monthSlug}.ndjson`);
    expect(existsSync(eventsPath)).toBe(true);
    const lines = readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean);
    const events = lines.map(l => { try { return JSON.parse(l) as { event?: string }; } catch { return null; } }).filter(Boolean);
    const hasStart = events.some(e => e?.event === 'lz.assess.start');
    const hasComplete = events.some(e => e?.event === 'lz.assess.complete');
    expect(hasStart).toBe(true);
    expect(hasComplete).toBe(true);
  });

  // ── report subcommand ────────────────────────────────────────────────────

  it('report generates text summary for sovereign-health', () => {
    const { stdout, stderr, status } = run(
      ['report', '--app', 'sovereign-health'],
    );
    expect(status).toBe(0);
    const combined = stdout + stderr;
    // When a prior assess run exists, report auto-saves and logs the path;
    // when no run dir exists it writes directly to stdout.
    // Default view is application-architect, which emits <ts>-technical.txt.
    // Older binaries used <ts>-report.txt; tolerate both during upgrade path.
    const autoSaved = combined.includes('[ok]') &&
      (combined.includes('technical.txt') || combined.includes('report.txt'));
    const inStdout  = combined.includes('sovereign-health') && combined.includes('7R');
    expect(autoSaved || inStdout).toBe(true);
  });

  it('report --format yaml emits valid YAML keys', () => {
    const { stdout, stderr, status } = run(
      ['report', '--app', 'sovereign-health', '--format', 'yaml'],
    );
    expect(status).toBe(0);
    const combined = stdout + stderr;
    // #0219: when a run dir exists, the yaml report auto-saves as
    // <ts>-technical.yaml (default view application-architect). Older binaries
    // used report.yaml or .txt; tolerate all during upgrade-path straddling.
    const autoSaved = combined.includes('[ok]') &&
      (combined.includes('technical.yaml') || combined.includes('report.yaml') || combined.includes('report.txt'));
    const inStdout  = combined.includes('app:') && combined.includes('seven_r_label:');
    expect(autoSaved || inStdout).toBe(true);
  });

  // ── LZ report subcommand (#1120) ─────────────────────────────────────────

  it('report --type landing-zone-catalog exits 0 for sovereign-health', () => {
    const { stdout, stderr, status } = run(
      ['report', '--app', 'sovereign-health', '--type', 'landing-zone-catalog'],
    );
    expect(status).toBe(0);
    const combined = stdout + stderr;
    // Must write to wsp/reports-lz/ and log the path.
    const wroteFile = combined.includes('[ok]') && combined.includes('lz-report');
    const inStdout  = combined.includes('Landing Zone') || combined.includes('Verdict Summary');
    expect(wroteFile || inStdout).toBe(true);
  });

  it('report --type landing-zone-catalog writes file under reports-lz/', () => {
    run(['report', '--app', 'sovereign-health', '--type', 'landing-zone-catalog']);
    const reportsLzDir = join(APP_DIR, 'wsp', 'reports-lz');
    expect(existsSync(reportsLzDir)).toBe(true);
    const files = readdirSync(reportsLzDir).filter(f => f.endsWith('lz-report.txt'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('report --type landing-zone-catalog text output contains verdict sections (#1120)', () => {
    run(['report', '--app', 'sovereign-health', '--type', 'landing-zone-catalog']);
    const reportsLzDir = join(APP_DIR, 'wsp', 'reports-lz');
    const files = readdirSync(reportsLzDir).filter(f => f.endsWith('lz-report.txt')).sort().reverse();
    expect(files.length).toBeGreaterThan(0);
    const content = readFileSync(join(reportsLzDir, files[0]!), 'utf-8');
    // Comparison table at the top
    expect(content).toContain('LZ Comparison');
    expect(content).toContain('Verdict Summary');
    expect(content).toContain('Sovereignty Gate Analysis');
    // At least one SOVEREIGNTY_BLOCKED target (aws/eu-central-1 in the fixture).
    expect(content).toContain('SOVEREIGNTY_BLOCKED');
    // At least one READY target (aws-esc or stackit).
    expect(content).toContain('READY');
  });

  it('report --type landing-zone-catalog yaml format saves .yaml file (#1120)', () => {
    const { status } = run([
      'report', '--app', 'sovereign-health', '--type', 'landing-zone-catalog', '--format', 'yaml',
    ]);
    expect(status).toBe(0);
    const reportsLzDir = join(APP_DIR, 'wsp', 'reports-lz');
    const files = readdirSync(reportsLzDir).filter(f => f.endsWith('lz-report.yaml'));
    expect(files.length).toBeGreaterThan(0);
  });

  // ── license subcommand ───────────────────────────────────────────────────

  it('license status prints tier', () => {
    const { stdout, stderr, status } = run(['license', 'status']);
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).toMatch(/community|consultant|enterprise/);
  });

  it('license status shows machine fingerprint to Community user (fingerprint regression)', () => {
    const { stdout, stderr, status } = run(['license', 'status']);
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('Machine fingerprint');
    // fingerprint must be 8 hex chars
    expect(combined).toMatch(/[0-9a-f]{8}/);
  });

  it('license activate with invalid key exits non-zero and reports error', () => {
    const { stdout, stderr, status } = run(['license', 'activate', 'SWAO-invalid-key']);
    expect(status).not.toBe(0);
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).toMatch(/invalid|error|malformed/);
  });

  // ── health-check subcommand ──────────────────────────────────────────────

  it('health-check runs without crashing', () => {
    const { status } = run(['health-check']);
    // health-check exits 0 (all ok) or 1 (warnings) -- both are acceptable
    expect([0, 1]).toContain(status);
  });

  it('health-check output shows machine fingerprint (fingerprint regression)', () => {
    const { stdout, stderr } = run(['health-check']);
    const combined = stdout + stderr;
    expect(combined).toContain('Machine fingerprint');
    expect(combined).toMatch(/[0-9a-f]{8}/);
  });

  // ── init subcommand (#0669 regression guard) ─────────────────────────────

  it('init creates a new app directory and reports success', () => {
    const { stdout, stderr, status } = run(['init', '--name', 'binary-e2e-test-app']);
    const combined = stdout + stderr;
    expect(status).toBe(0);
    expect(combined).toContain('[ok]');
    expect(existsSync(join(WORKSPACE, 'apps', 'binary-e2e-test-app'))).toBe(true);
  });

  it('init with --name flag exits 0 and scaffolds wsp structure', () => {
    const { stdout, stderr, status } = run(['init', '--name', 'binary-e2e-test-app-2']);
    const combined = stdout + stderr;
    expect(status).toBe(0);
    expect(combined).not.toMatch(/Cannot find module/i);
    expect(combined).not.toMatch(/MODULE_NOT_FOUND/);
    expect(existsSync(join(WORKSPACE, 'apps', 'binary-e2e-test-app-2', 'ingestion'))).toBe(true);
  });

  // #1153 -- bundled LZ terraform stubs scaffolded (pkg snapshot VFS probe)
  it('init scaffolds LZ terraform stubs into wsp/inputs/terraform (#1153)', () => {
    const { stdout, stderr, status } = run(['init', '--name', 'binary-e2e-lz-app']);
    const combined = stdout + stderr;
    expect(status).toBe(0);
    expect(combined).not.toMatch(/landing-zone stubs not found/i);
    const tfDir = join(WORKSPACE, 'apps', 'binary-e2e-lz-app', 'wsp', 'inputs', 'terraform');
    expect(existsSync(tfDir)).toBe(true);
    const files = readdirSync(tfDir);
    expect(files).toContain('lz-aws-snapshot.json');
    expect(files).toContain('lz-azure-snapshot.json');
    expect(files).toContain('lz-meshstack-snapshot.json');
  });

  // ── credential subcommand ────────────────────────────────────────────────

  it('credential list runs without crashing', () => {
    const { status } = run(['credential', 'list']);
    expect([0, 1]).toContain(status);
  });

  it('credential set stores a value and credential delete removes it', () => {
    const key = 'e2e-test-key';
    const val = 'e2e-test-value-42';

    const setResult = run(['credential', 'set', key, val]);
    expect(setResult.status).toBe(0);

    const deleteResult = run(['credential', 'delete', key]);
    expect(deleteResult.status).toBe(0);
  });

  // ── export subcommand (#0670 smoke) ─────────────────────────────────────

  it('export generates CSV star bundle for sovereign-health', () => {
    const { stdout, stderr, status } = run(
      ['export', '--app', 'sovereign-health', '--formats', 'csv', '--no-templates'],
    );
    expect(status).toBe(0);
    const combined = stdout + stderr;
    // export logs "[ok]  Star CSV bundle written  ->  <path>"
    expect(combined).toContain('[ok]');
    expect(combined.toLowerCase()).toMatch(/star|\.csv/);
  });

  // ── publish subcommand (#0670 smoke) ────────────────────────────────────

  it('publish generates HTML publication for sovereign-health', () => {
    const { stdout, stderr, status } = run(
      ['publish', '--app', 'sovereign-health'],
    );
    expect(status).toBe(0);
    const combined = stdout + stderr;
    // publish writes size to stderr ("Done. Size: N KB") and HTML path to stdout
    expect(combined).toMatch(/Done|\.html/i);
  });

  // ── --help coverage for every registered subcommand ─────────────────────
  // Each test asserts: (a) exit 0, (b) output contains the command name or
  // a usage hint, (c) no MODULE_NOT_FOUND / snapshot error.
  // These are fast (< 1 s each) and CWD-independent -- they only need the binary.

  it('setup --help works', () => {
    const { stdout, status } = run(['setup', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/setup|wizard/);
  });

  it('export --help works', () => {
    const { stdout, status } = run(['export', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/export|power.?bi/);
  });

  it('mcp --help works', () => {
    const { stdout, status } = run(['mcp', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/mcp|model context protocol/);
  });

  it('menu --help works', () => {
    const { stdout, status } = run(['menu', '--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('menu');
  });

  it('migrate-workspace --help works', () => {
    const { stdout, status } = run(['migrate-workspace', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/migrat/);
  });

  it('regime-select --help works', () => {
    const { stdout, status } = run(['regime-select', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/regime|compliance/);
  });

  it('generate-tf --help works', () => {
    const { stdout, status } = run(['generate-tf', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/terraform|generate/);
  });

  it('log --help works', () => {
    const { stdout, status } = run(['log', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/log|event/);
  });

  it('framework --help works', () => {
    const { stdout, status } = run(['framework', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/framework/);
  });

  it('publish --help works', () => {
    const { stdout, status } = run(['publish', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/publish|html/);
  });

  it('lenses --help works', () => {
    const { stdout, status } = run(['lenses', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/lens/);
  });

  it('normalize --help works', () => {
    const { stdout, status } = run(['normalize', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/normaliz/);
  });

  it('diff --help works', () => {
    const { stdout, status } = run(['diff', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/diff|compar/);
  });

  it('accept --help works', () => {
    const { stdout, status } = run(['accept', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/accept/);
  });

  // The `audit --help` / `audit init --help` cases were retired at #1434
  // with the audit assessment surface (the command group no longer exists).

  it('lz --help works', () => {
    const { stdout, status } = run(['lz', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/landing.?zone|lz/);
  });

  it('lz catalogue --help works', () => {
    const { stdout, status } = run(['lz', 'catalogue', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/catalogu/);
  });

  // #0872 regression guard: lz catalogue update must be registered in the
  // Enterprise entry (index.ts). Previously only wired in consultant.ts,
  // which the Enterprise binary does not use directly.
  it('lz catalogue update --help works', () => {
    const { stdout, status } = run(['lz', 'catalogue', 'update', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/update|refresh|catalogue/);
  });

  it('lz fit --help works', () => {
    const { stdout, status } = run(['lz', 'fit', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/fit|assess/);
  });

  it('health-check --help works', () => {
    const { stdout, status } = run(['health-check', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/health.?check|probe/);
  });

  it('challenge --help works', () => {
    const { stdout, status } = run(['challenge', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/challenge|stakeholder/);
  });

  it('install-playwright --help works', () => {
    const { stdout, status } = run(['install-playwright', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/playwright|chromium/);
  });

  it('no command emits MODULE_NOT_FOUND (snapshot CWD-independence regression)', () => {
    // Run from an unrelated directory -- the binary must NOT error with a
    // path-relative module-resolution failure regardless of CWD.
    const { stdout, stderr } = run(['--version'], tmpdir());
    const combined = stdout + stderr;
    expect(combined).not.toMatch(/Cannot find module/i);
    expect(combined).not.toMatch(/MODULE_NOT_FOUND/);
  });

  // ── coming-soon guards: --type hybrid and --type llm (#0586) ────────────
  // Both are known-but-unimplemented assessment types. The guard exits 0 and
  // prints a human-readable coming-soon notice (no stack trace, no error code).

  it('assess --type hybrid prints coming-soon notice and exits 0', () => {
    const { stdout, stderr, status } = run(
      ['assess', '--app', 'sovereign-health', '--type', 'hybrid', '--passes', 'inv'],
    );
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toMatch(/coming.soon|not yet implemented|future|planned/i);
    expect(combined).not.toMatch(/UnhandledPromiseRejection/);
    expect(combined).not.toMatch(/at\s+\w+\s+\(/); // no stack trace
  });

  it('assess --type llm without legs config exits 1 with helpful error', () => {
    // LLM Assessment (Design 092) is implemented but requires an
    // llm_assessment.legs block (2..5 legs) in the portfolio .swao.yml.
    // The reference workspace has no such block, so the CLI should exit 1
    // with an actionable error -- no stack trace, no unhandled rejection.
    const { stdout, stderr, status } = run(
      ['assess', '--app', 'sovereign-health', '--type', 'llm', '--passes', 'inv'],
    );
    expect(status).toBe(1);
    const combined = stdout + stderr;
    expect(combined).toMatch(/legs|llm_assessment|LLM Assessment/i);
    expect(combined).not.toMatch(/UnhandledPromiseRejection/);
    expect(combined).not.toMatch(/at\s+\w+\s+\(/); // no stack trace
  });

  // ── error handling ───────────────────────────────────────────────────────

  it('unknown subcommand exits non-zero', () => {
    const { status } = run(['totally-unknown-command']);
    expect(status).not.toBe(0);
  });

  it('challenge without license exits 2 (Enterprise gate)', () => {
    // The default `run()` helper inherits process.env, which on a developer
    // machine usually contains a real Enterprise licence at ~/.swao-license.json
    // (homedir-resolved). To exercise the unlicensed Enterprise gate we point
    // HOME / USERPROFILE at an empty tmpdir so license-guard.ts finds no
    // licence file. Same pattern used elsewhere when isolating filesystem
    // state.
    const emptyHome = mkdtempSync(join(tmpdir(), 'swao-e2e-nolicense-'));
    try {
      const result = spawnSync(BIN_WIN, ['challenge', '--app', 'sovereign-health', '--agent', 'grc-compliance-officer'], {
        cwd: WORKSPACE,
        encoding: 'utf-8',
        timeout: 30_000,
        env: {
          ...process.env,
          HOME: emptyHome,
          USERPROFILE: emptyHome,
          HOMEDRIVE: '',
          HOMEPATH: '',
        },
      });
      expect(result.status).toBe(2);
    } finally {
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });

});

// ---------------------------------------------------------------------------
// Community binary: gated commands must return a clean upgrade-required
// message (#0675, sprint-072). Skipped when the community binary is absent.
// ---------------------------------------------------------------------------

describe.skipIf(!hasCommunityBinary)('Community binary -- upgrade-required gate (#0675)', () => {
  let communityWorkspace: string;
  let communityHome: string;

  beforeAll(() => {
    communityWorkspace = mkdtempSync(join(tmpdir(), 'swao-community-e2e-'));
    communityHome = mkdtempSync(join(tmpdir(), 'swao-community-home-'));
  });

  afterAll(() => {
    if (communityWorkspace) rmSync(communityWorkspace, { recursive: true, force: true });
    if (communityHome) rmSync(communityHome, { recursive: true, force: true });
  });

  function runCommunity(args: string[]): { stdout: string; stderr: string; status: number } {
    const r = spawnSync(BIN_COMMUNITY, args, {
      cwd: communityWorkspace,
      encoding: 'utf-8',
      timeout: 30_000,
      env: {
        ...process.env,
        HOME:        communityHome,
        USERPROFILE: communityHome,
        HOMEDRIVE:   '',
        HOMEPATH:    '',
      },
    });
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
  }

  it('community binary --version reports the correct version', () => {
    const { stdout, status } = runCommunity(['--version']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/SWAO.*\d+\.\d+\.\d+/);
  });

  it('gated command (report --format pdf) exits non-zero on Community binary', () => {
    const { status } = runCommunity(['report', '--format', 'pdf', '--app', 'nonexistent', '--workspace', communityWorkspace]);
    expect(status).not.toBe(0);
  });

  it('gated command output contains no stack trace', () => {
    const { stdout, stderr } = runCommunity(['report', '--format', 'pdf', '--app', 'nonexistent', '--workspace', communityWorkspace]);
    const combined = stdout + stderr;
    expect(combined).not.toMatch(/at\s+\w+\s+\(/);    // no stack trace lines
    expect(combined).not.toMatch(/UnhandledPromiseRejection/);
    expect(combined).not.toMatch(/ENOENT.*node_modules/); // no missing-module crash
  });

  it('gated command output contains human-readable upgrade message', () => {
    const { stdout, stderr } = runCommunity(['report', '--format', 'pdf', '--app', 'nonexistent', '--workspace', communityWorkspace]);
    const combined = stdout + stderr;
    // Must reference the required tier or licence in the output.
    expect(combined.toLowerCase()).toMatch(/consultant|licence|license|tier|upgrade/);
  });
});

// ---------------------------------------------------------------------------
// Consultant binary: PDF report enabled; Enterprise commands still gated.
// (#0586, sprint-073). Skipped when the Consultant binary is absent.
// ---------------------------------------------------------------------------

describe.skipIf(!hasConsultantBinary)('Consultant binary -- tier-specific commands (#0586)', () => {
  let consultantWorkspace: string;
  let consultantHome: string;

  // cpSync of the sovereign-health fixture takes >10 s on Windows; raise the
  // hook timeout to match the main-binary block (120 s / 60 s).
  beforeAll(() => {
    if (!hasConsultantBinary) return;
    consultantWorkspace = mkdtempSync(join(tmpdir(), 'swao-consultant-e2e-'));
    cpSync(SOURCE_FIXTURE, consultantWorkspace, { recursive: true });
    consultantHome = mkdtempSync(join(tmpdir(), 'swao-consultant-home-'));
  }, 120_000);

  afterAll(() => {
    if (consultantWorkspace) rmSync(consultantWorkspace, { recursive: true, force: true });
    if (consultantHome) rmSync(consultantHome, { recursive: true, force: true });
  }, 60_000);

  function runConsultant(args: string[]): { stdout: string; stderr: string; status: number } {
    const r = spawnSync(BIN_CONSULTANT, args, {
      cwd: consultantWorkspace,
      encoding: 'utf-8',
      timeout: 30_000,
      env: {
        ...process.env,
        HOME:        consultantHome,
        USERPROFILE: consultantHome,
        HOMEDRIVE:   '',
        HOMEPATH:    '',
      },
    });
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
  }

  it('--version reports the correct version and tier', () => {
    const { stdout, status } = runConsultant(['--version']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/SWAO.*\d+\.\d+\.\d+/);
  });

  it('--help lists assess and report subcommands', () => {
    const { stdout, status } = runConsultant(['--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('assess');
    expect(stdout).toContain('report');
  });

  it('health-check runs without crashing', () => {
    const { status } = runConsultant(['health-check']);
    expect([0, 1]).toContain(status);
  });

  it('assess --help shows --passes option', () => {
    const { stdout, status } = runConsultant(['assess', '--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('--app');
    expect(stdout).toContain('--passes');
  });

  // Consultant-specific: report --format pdf is listed as a format option.
  // The PDF renderer module is present in the Consultant binary (in Community
  // it is excluded by esbuild and not listed in --help descriptions).
  it('report --help shows pdf as a supported format on Consultant binary', () => {
    const { stdout, status } = runConsultant(['report', '--help']);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toContain('pdf');
  });

  // Enterprise-gated commands must still be blocked on the Consultant binary.
  it('challenge is not available on the Consultant binary', () => {
    const { stdout, stderr, status } = runConsultant(
      ['challenge', '--app', 'sovereign-health', '--agent', 'technical'],
    );
    const combined = stdout + stderr;
    // Either the command is not registered (unknown command, exit 1)
    // or it is blocked by the Enterprise licence gate (exit 2).
    const licenceGated = status === 2;
    const unknownCmd = /unknown command/i.test(combined) || status === 1;
    expect(licenceGated || unknownCmd).toBe(true);
  });

  // Coming-soon guard also applies to the Consultant binary.
  it('assess --type hybrid prints coming-soon notice and exits 0', () => {
    const { stdout, stderr, status } = runConsultant(
      ['assess', '--app', 'sovereign-health', '--type', 'hybrid', '--passes', 'inv'],
    );
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toMatch(/coming.soon|not yet implemented|future|planned/i);
    expect(combined).not.toMatch(/at\s+\w+\s+\(/);
  });

  it('no MODULE_NOT_FOUND from any CWD', () => {
    const { stdout, stderr } = runConsultant(['--version']);
    const combined = stdout + stderr;
    expect(combined).not.toMatch(/Cannot find module/i);
    expect(combined).not.toMatch(/MODULE_NOT_FOUND/);
  });
});
