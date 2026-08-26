// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- Assessment TUI E2E tests (#0805 prevention)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Assessment TUI end-to-end tests.
 *
 * Exercises the full TUI navigation path for both assessment types so that
 * phase-transition crashes (e.g. #0805: clear-screen in running useEffect
 * corrupting Ink cursor state) are caught before a binary is handed to QA.
 *
 * Tests are skipped when:
 *  - dist/index.js has not been compiled (run `npm run build` first), or
 *  - the test runner is piped on Windows (node-pty needs a real console handle).
 *
 * Fixture: examples/portfolio-workspace/portfolio is copied to a tmpdir so
 * the TUI finds a real workspace with 5 existing apps (crm-platform first
 * alphabetically), no community frameworks installed (regimes empty-state).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as pty from 'node-pty';

// Allow extra time -- the child assess process can take several seconds.
const TEST_TIMEOUT_MS = 40_000;

const DIST_ENTRY      = resolve(__dirname, '../../dist/index.js');
const PORTFOLIO_FIXTURE = resolve(__dirname, '../../../../../examples/portfolio-workspace/portfolio');
const NODE_BIN        = process.execPath;

const hasEntry      = existsSync(DIST_ENTRY);
const hasFixture    = existsSync(PORTFOLIO_FIXTURE);
// node-pty on Windows requires a real console handle (AttachConsole). Under
// piped stdout (vitest runner, VS Code task, CI on Windows) it produces empty
// output. Skip on Windows unless process.stdout.isTTY is true.
const hasRealConsole = process.platform !== 'win32' || process.stdout.isTTY === true;

const canRunE2e = hasEntry && hasFixture && hasRealConsole;

// ---------------------------------------------------------------------------
// Helpers shared across tests
// ---------------------------------------------------------------------------

/** Strip ANSI escape sequences and carriage returns from PTY output. */
function stripAnsi(s: string): string {
  /* eslint-disable no-control-regex */
  const ESC = '\x1b';
  const BEL = '\x07';
  return s
    .replace(new RegExp(`${ESC}\\[[0-9;]*[mABCDEFGHJKLMSTfsu]`, 'g'), '')
    .replace(new RegExp(`${ESC}\\[[?][0-9;]*[hl]`, 'g'), '')
    .replace(new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, 'g'), '')
    .replace(/\r/g, '');
  /* eslint-enable no-control-regex */
}

/** Poll until accumulated PTY output contains the expected substring. */
async function waitFor(
  getOutput: () => string,
  expected: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!stripAnsi(getOutput()).includes(expected)) {
    if (Date.now() > deadline) {
      throw new Error(
        `Timeout (${timeoutMs}ms) waiting for: ${JSON.stringify(expected)}\n` +
        `Got: ${JSON.stringify(stripAnsi(getOutput()).slice(-600))}`,
      );
    }
    await new Promise<void>(r => setTimeout(r, 50));
  }
}

/** Poll until output contains any of the given strings. */
async function waitForAny(
  getOutput: () => string,
  candidates: string[],
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!candidates.some(c => stripAnsi(getOutput()).includes(c))) {
    if (Date.now() > deadline) {
      throw new Error(
        `Timeout (${timeoutMs}ms) waiting for any of: ${candidates.map(c => JSON.stringify(c)).join(', ')}\n` +
        `Got: ${JSON.stringify(stripAnsi(getOutput()).slice(-600))}`,
      );
    }
    await new Promise<void>(r => setTimeout(r, 50));
  }
}

/** Spawn the SWAO TUI in a PTY with the given workspace as the CWD. */
function spawnTuiInWorkspace(workspaceDir: string, sandboxHome: string): {
  proc: pty.IPty;
  output: () => string;
  kill: () => void;
} {
  let buf = '';
  const proc = pty.spawn(NODE_BIN, [DIST_ENTRY, 'menu'], {
    name: 'xterm-256color',
    cols: 140,
    rows: 40,
    cwd: workspaceDir,
    env: {
      ...process.env,
      HOME: sandboxHome,
      USERPROFILE: sandboxHome,
      SWAO_NO_SPLASH_DELAY: '1',
      SWAO_LICENSE_SECRET: 'test-secret-for-assess-e2e',
    },
  });
  proc.onData(data => { buf += data; });
  return {
    proc,
    output: () => buf,
    kill: () => { try { proc.kill(); } catch { /* already dead */ } },
  };
}

// ---------------------------------------------------------------------------
// Fixture + sandbox management
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

/** Copy the portfolio fixture to a fresh tmpdir and return the path. */
function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'swao-assess-e2e-'));
  tmpDirs.push(dir);
  cpSync(PORTFOLIO_FIXTURE, dir, { recursive: true });
  return dir;
}

/** Create a sandboxed HOME dir (empty license = Community tier). */
function makeSandboxHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'swao-assess-home-'));
  tmpDirs.push(dir);
  writeFileSync(join(dir, '.swao-license.json'), JSON.stringify({}));
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!canRunE2e)('Assessment TUI E2E (#0805)', () => {

  it('LZ Catalog Assessment: navigates full flow to running phase without crash', async () => {
    const workspace   = makeWorkspace();
    const sandboxHome = makeSandboxHome();
    const { proc, output, kill } = spawnTuiInWorkspace(workspace, sandboxHome);

    try {
      // Main menu
      await waitFor(output, 'Run Assessment');

      // Open Run Assessment (key 3) -> AssessmentTypeScreen
      proc.write('3');
      await waitFor(output, 'Select Assessment Type');

      // Select Landing Zone Catalog Assessment (key 3)
      proc.write('3');
      await waitFor(output, 'Select application to assess');

      // Select first app (crm-platform, no New/Delete options in LZ flow)
      proc.write('\r');
      await waitFor(output, 'Cloud provider');

      // Navigate to aws-esc (2nd provider, 1 region -- skips the filter step)
      proc.write('\x1b[B'); // Down
      await new Promise<void>(r => setTimeout(r, 100));
      proc.write('\r');
      // aws-esc has exactly 1 region: eusc-de-east-1
      await waitFor(output, 'Region');
      proc.write('\r');

      // Verify the running phase started -- TUI must not go blank
      await waitForAny(output, ['Running assessment...', 'Assessment complete', 'Assessment finished']);
      const text = stripAnsi(output());
      expect(
        text.includes('Running assessment...') ||
        text.includes('Assessment complete') ||
        text.includes('Assessment finished'),
      ).toBe(true);
    } finally {
      kill();
    }
  }, TEST_TIMEOUT_MS);


  it('Application Assessment: navigates full flow to running phase without crash', async () => {
    const workspace   = makeWorkspace();
    const sandboxHome = makeSandboxHome();
    const { proc, output, kill } = spawnTuiInWorkspace(workspace, sandboxHome);

    try {
      // Main menu
      await waitFor(output, 'Run Assessment');

      // Open Run Assessment (key 3) -> AssessmentTypeScreen
      proc.write('3');
      await waitFor(output, 'Select Assessment Type');

      // Select Application Assessment (key 1)
      proc.write('1');
      await waitFor(output, 'Select application to assess');

      // Navigate past "+ New app..." to the first existing app (crm-platform)
      proc.write('\x1b[B'); // Down
      await new Promise<void>(r => setTimeout(r, 100));
      proc.write('\r');

      // Regimes screen: portfolio fixture has no community frameworks installed,
      // so the empty-state screen is shown. Press Enter to continue.
      await waitFor(output, 'Community Frameworks');
      proc.write('\r');

      // Passes screen: confirm with default selection (all)
      await waitFor(output, 'Select passes to run');
      proc.write('\r');

      // Optional LZ provider step -- Escape skips directly to running (#0805)
      await waitFor(output, 'Target Landing Zone');
      proc.write('\x1b'); // Escape -> setPhase('running')

      // Verify running phase started -- the TUI must not go blank or freeze
      await waitForAny(output, ['Running assessment...', 'Assessment complete', 'Assessment finished']);
      const text = stripAnsi(output());
      expect(
        text.includes('Running assessment...') ||
        text.includes('Assessment complete') ||
        text.includes('Assessment finished'),
      ).toBe(true);
    } finally {
      kill();
    }
  }, TEST_TIMEOUT_MS);

});
