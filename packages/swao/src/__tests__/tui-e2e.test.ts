// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI E2E tests (#0670 Phase 4)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * L8 TUI end-to-end tests using node-pty (#0670 Phase 4).
 *
 * These tests spawn `node dist/index.js menu` in a real PTY so the TUI
 * starts in raw mode (process.stdin.isTTY = true). They verify the four
 * most-travelled user journeys: main menu render, navigation to a screen,
 * Ctrl+C cancellation, and clean exit via the exit key.
 *
 * Tests are skipped automatically when the compiled dist/index.js does not
 * exist (i.e. TypeScript has not been compiled). Run `npm run build` first.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as pty from 'node-pty';

vi.setConfig({ testTimeout: 20_000 });

const DIST_ENTRY  = resolve(__dirname, '../../dist/index.js');
const NODE_BIN    = process.execPath; // full path to the running Node.js executable
const hasEntry    = existsSync(DIST_ENTRY);
// On Windows, node-pty calls AttachConsole(ATTACH_PARENT_PROCESS) to obtain a
// console handle. When the test runner is not connected to a real terminal
// (piped stdout, VS Code task, CI) this fails and the spawned PTY produces
// empty output. Skip the suite in that environment rather than timing out.
const hasRealConsole = process.platform !== 'win32' || process.stdout.isTTY === true;
const canRunE2e = hasEntry && hasRealConsole;

// Sandbox HOME so the TUI finds no real licence file and falls back to Community.
let sandboxHome: string;
const tmpDirs: string[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape sequences + carriage returns from PTY output. */
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

/** Wait until accumulated PTY output (stripped of ANSI) contains expected text. */
async function waitFor(
  getOutput: () => string,
  expected: string,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!stripAnsi(getOutput()).includes(expected)) {
    if (Date.now() > deadline) {
      throw new Error(
        `Timeout (${timeoutMs}ms) waiting for: ${JSON.stringify(expected)}\n` +
        `Got: ${JSON.stringify(stripAnsi(getOutput()).slice(-500))}`,
      );
    }
    await new Promise<void>(r => setTimeout(r, 50));
  }
}

/** Spawn the SWAO TUI in a PTY, return pty + accumulated output accessor. */
function spawnTui(args: string[] = ['menu'], cwd?: string): {
  proc: pty.IPty;
  output: () => string;
  kill: () => void;
} {
  let buf = '';
  const proc = pty.spawn(NODE_BIN, [DIST_ENTRY, ...args], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: cwd ?? process.cwd(),
    env: {
      ...process.env,
      HOME: sandboxHome,
      USERPROFILE: sandboxHome,
      SWAO_NO_SPLASH_DELAY: '1',
      SWAO_LICENSE_SECRET: 'test-secret-for-tui-e2e',
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
// Setup / teardown
// ---------------------------------------------------------------------------

// beforeEach equivalent using the describe-level hook pattern
function setupSandbox(): void {
  sandboxHome = mkdtempSync(join(tmpdir(), 'swao-tui-e2e-'));
  tmpDirs.push(sandboxHome);
  // Place a minimal Community licence so the TUI does not prompt for one.
  // An empty object makes LicenseGuard fall back cleanly to Community tier.
  writeFileSync(join(sandboxHome, '.swao-license.json'), JSON.stringify({}));
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!canRunE2e)('TUI E2E (#0670 Phase 4)', () => {
  it('main menu renders "Workspace Setup" and "Health Check" items', async () => {
    setupSandbox();
    const { output, kill } = spawnTui();

    try {
      await waitFor(output, 'Workspace Setup');
      expect(stripAnsi(output())).toContain('Workspace Setup');
      expect(stripAnsi(output())).toContain('Health Check');
      expect(stripAnsi(output())).toContain('Run Assessment');
    } finally {
      kill();
    }
  });

  it('exits cleanly when "0" is pressed', async () => {
    setupSandbox();
    const { proc, output, kill } = spawnTui();

    try {
      await waitFor(output, 'Workspace Setup');
      proc.write('0');
      // Wait up to 3s for the process to exit
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Process did not exit')), 3000);
        proc.onExit(() => { clearTimeout(timer); resolve(); });
      });
      // Exit without error -- test passes if we reach here
    } finally {
      kill();
    }
  });

  it('Ctrl+C sends SIGINT and terminates the process', async () => {
    setupSandbox();
    const { proc, output, kill } = spawnTui();

    try {
      await waitFor(output, 'Workspace Setup');
      proc.write('\x03'); // Ctrl+C
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Process did not exit on Ctrl+C')), 3000);
        proc.onExit(() => { clearTimeout(timer); resolve(); });
      });
    } finally {
      kill();
    }
  });

  it('navigates to Help screen when "9" then "5" are pressed', async () => {
    setupSandbox();
    const { proc, output, kill } = spawnTui();

    try {
      await waitFor(output, 'Workspace Setup');
      proc.write('9'); // Tools submenu
      await waitFor(output, 'License');
      proc.write('5'); // Help
      await waitFor(output, 'Troubleshooting');
      expect(stripAnsi(output())).toContain('Troubleshooting');
    } finally {
      kill();
    }
  });

  // #0805 regression: MultiSelect Space key on the LZ region picker crashed with
  //   TypeError: Cannot read properties of undefined (reading 'value')
  // because Ink's useInput re-registers its listener on every render and the
  // stale closure captured options=[] from a previous render cycle. The fix
  // (optionsRef + idxRef + null guard) mirrors GuidanceBox #0753.
  //
  // This test navigates the full Application Assessment path to the region
  // selection MultiSelect and presses Space. If the fix regresses the process
  // exits with a TypeError before reaching the confirm step.
  it('#0805 Space key on LZ region MultiSelect does not crash the process', async () => {
    setupSandbox();
    // Minimal workspace with one app so the TUI reaches the region picker.
    const wsDir = sandboxHome;
    mkdirSync(join(wsDir, 'apps', 'smoke-app'), { recursive: true });
    writeFileSync(join(wsDir, '.swao.yml'), [
      'engagement:',
      '  name: "Smoke Workspace"',
      '  client_code: smoke',
    ].join('\n') + '\n');
    writeFileSync(join(wsDir, 'apps', 'smoke-app', '.swao.yml'), [
      'app:',
      '  id: smoke-app',
      '  name: "Smoke App"',
    ].join('\n') + '\n');

    const { proc, output, kill } = spawnTui(['menu'], wsDir);
    let exited = false;
    proc.onExit(() => { exited = true; });

    try {
      // Main menu
      await waitFor(output, 'Workspace Setup', 15_000);

      // Run Assessment (key '3')
      proc.write('3');
      await waitFor(output, 'Application Assessment', 5000);

      // Application Assessment (key '1')
      proc.write('1');

      // App selection: "+ New app..." is item 0; smoke-app is item 1.
      // Press down arrow then Enter to pick smoke-app.
      await waitFor(output, '+ New app', 5000);
      proc.write('\x1B[B'); // down arrow
      await waitFor(output, 'smoke-app', 3000);
      proc.write('\r'); // Enter

      // Regimes step: select first regime then confirm.
      await waitFor(output, 'Assessment frameworks', 5000);
      proc.write(' '); // Space -- toggle first regime
      proc.write('\r'); // Enter -- confirm

      // Passes step: confirm defaults.
      await waitFor(output, 'Assessment passes', 5000);
      proc.write('\r'); // Enter -- confirm

      // LZ provider step: press Enter to select the first provider (aws-esc).
      await waitFor(output, 'aws-esc', 5000);
      proc.write('\r'); // Enter

      // LZ region step: the region MultiSelect.
      await waitFor(output, 'eusc-de-east-1', 5000);

      // Press Space -- this was crashing (TypeError: cannot read 'value' of undefined).
      proc.write(' ');

      // Give Ink 300 ms to process; if the bug is present the process exits.
      await new Promise<void>(r => setTimeout(r, 300));

      expect(exited).toBe(false);
      expect(stripAnsi(output())).toContain('eusc-de-east-1');
    } finally {
      kill();
    }
  });

  // #0805 regression: SelectInput Enter key on the LZ region picker crashed with
  //   TypeError: Cannot read properties of undefined (reading 'value')
  // because Ink's useInput re-registers its listener on every render and the
  // stale closure captured options=[] from a previous render cycle. The fix
  // (optionsRef + idxRef + null guard) mirrors MultiSelect / GuidanceBox #0753.
  //
  // Landing Zone Catalog Assessment flow:
  //   Main menu '3' -> AssessmentTypeScreen '3' -> LZ provider SelectInput (Enter)
  //   -> LZ region SelectInput (Enter) <- crash site.
  it('#0805 Enter key on LZ region SelectInput does not crash the process', async () => {
    setupSandbox();
    const wsDir = sandboxHome;
    mkdirSync(join(wsDir, 'apps', 'smoke-app'), { recursive: true });
    writeFileSync(join(wsDir, '.swao.yml'), [
      'engagement:',
      '  name: "Smoke Workspace"',
      '  client_code: smoke',
    ].join('\n') + '\n');
    writeFileSync(join(wsDir, 'apps', 'smoke-app', '.swao.yml'), [
      'app:',
      '  id: smoke-app',
      '  name: "Smoke App"',
    ].join('\n') + '\n');

    const { proc, output, kill } = spawnTui(['menu'], wsDir);
    let exited = false;
    proc.onExit(() => { exited = true; });

    try {
      // Main menu
      await waitFor(output, 'Workspace Setup', 15_000);

      // Run Assessment (key '3')
      proc.write('3');
      await waitFor(output, 'Application Assessment', 5000);

      // Landing Zone Catalog Assessment (key '3' in AssessmentTypeScreen)
      proc.write('3');

      // LZ provider SelectInput: press Enter to select the first provider (aws-esc).
      await waitFor(output, 'aws-esc', 8000);
      proc.write('\r');

      // LZ region SelectInput: press Enter -- this was crashing SelectInput.tsx line 38.
      await waitFor(output, 'eusc-de-east-1', 5000);
      proc.write('\r');

      // Give Ink 300 ms to process; if the bug is present the process exits.
      await new Promise<void>(r => setTimeout(r, 300));

      expect(exited).toBe(false);
    } finally {
      kill();
    }
  });
});
