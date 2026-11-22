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

// Shared Ink-mount helper that runs the SWAO TUI inside the terminal's
// alternate-screen buffer (#0223 follow-up).
//
// Why alt-screen?
//   Ink renders by tracking its own height and moving the cursor up to
//   redraw on each frame. If the previous paint pushed earlier content
//   off-screen via terminal scroll, the cursor-up math no longer lands
//   at the screen's true top -- the new screen's header ends up hidden
//   somewhere above the visible viewport ("empty space, scroll up to
//   find the menu"). Alt-screen gives the TUI a dedicated viewport with
//   no scrollback, so every Ink render sits at row 0 by construction.
//
// On exit (clean, Ctrl+C, SIGTERM) we restore the user's main buffer so
// their shell content reappears as if SWAO never ran -- this is the
// behaviour `vim`, `htop`, `k9s`, `lazygit` provide.

import { render } from 'ink';
import { appendFileSync, mkdirSync } from 'node:fs';
import React from 'react';
import { App } from './App.js';
import type { SetupRunMode } from '../setup/types.js';
import type { MenuTarget } from './screens/MainMenu.js';
import { SWAO_BUILD_SUFFIX, SWAO_BUILD_TAG, SWAO_VERSION } from '../branding.js';
import { setHeaderBuildTag } from '@swao/tui-kit';
import { LicenseGuard } from '../license/license-guard.js';
import { findWorkspace } from '@swao/core';
import { killAllChildren, killMcpServer } from './child-process-registry.js';
import { startTuiMcpServer } from './mcp-server-slot.js';
import { TuiCrashOverlay, handleProcessCrash, reportTuiCrash } from './crash-report.js';
import { createCtrlCGuard, installCtrlCGuard } from './ctrl-c-guard.js';

type Screen = 'type-select' | 'main' | MenuTarget;

// React ErrorBoundary -- catches render errors that Ink's internal handler
// swallows before they reach process.on('uncaughtException'). Without this,
// a render crash resolves waitUntilExit() silently and writes no crash.ndjson.
class TuiErrorBoundary extends React.Component<
  React.PropsWithChildren<{ onCrash: (err: unknown) => void }>,
  { crashed: boolean; message: string }
> {
  state = { crashed: false, message: '' };
  static getDerivedStateFromError(err: Error) {
    return { crashed: true, message: err.message };
  }
  componentDidCatch(err: unknown) {
    this.props.onCrash(err);
  }
  render() {
    if (this.state.crashed) {
      // Minimal fallback -- process.exit fires in onCrash before this paints.
      return null;
    }
    return this.props.children as React.ReactElement;
  }
}

const ENTER_ALT_SCREEN = '\x1B[?1049h\x1B[H';
const EXIT_ALT_SCREEN  = '\x1B[?1049l';

export async function runTuiInAltScreen(initialScreen: Screen = 'main', opts?: { setupMode?: SetupRunMode }): Promise<void> {
  // #0381: set the terminal/process title so the OS tab + window-list show
  // the full product name instead of "swao-win.exe" (default for pkg
  // binaries on Windows; "node" on Linux/macOS dev runs).
  // #4430: every screen header names the build (commit, date or tag).
  setHeaderBuildTag(SWAO_BUILD_TAG);
  try { process.title = 'SWAO, Sovereign Workload Assessment & Onboarding'; } catch { /* read-only on some platforms; non-fatal */ }
  // OSC 0 (set window title) covers terminals that don't honour process.title
  // -- Windows Terminal, iTerm2, GNOME Terminal all respect this even when
  // process.title isn't propagated.
  process.stdout.write('\x1b]0;SWAO, Sovereign Workload Assessment & Onboarding\x07');

  // #0830 (Option B): write a visible line to the main buffer before opening
  // the alt-screen. Gives the operator immediate feedback after JS starts
  // executing. Suppressed when swao.bat already handled startup display.
  // Note: does not address Blank 1 (PKG V8 cold-start, 5-20 s before JS runs);
  // that requires Option A (stub launcher) or Option D (swao.bat discoverability).
  if (!process.env['SWAO_LAUNCHER_WROTE_BANNER']) {
    process.stdout.write('  Starting SWAO...\r');
  }
  // #0806: enter the alt-screen first so the splash banner is written into
  // the alt-screen buffer. The banner then stays visible for the entire
  // PKG binary startup window (1-10 s) until Ink completes its first render
  // and overwrites it from row 0. Previous approach wrote to the main buffer
  // with a fixed 1500 ms delay -- the delay was too short on slow machines
  // and the main buffer disappeared the moment the alt-screen opened.
  process.stdout.write(ENTER_ALT_SCREEN);

  let editionStr = 'Community';
  try {
    const tier = LicenseGuard.load().state.tier;
    if (tier === 'enterprise') editionStr = 'Enterprise';
    else if (tier === 'consultant') editionStr = 'Consultant';
  } catch { /* non-fatal: default to Community */ }

  // #0806: full ASCII banner inside the alt-screen. The banner is visible
  // from the moment the alt-screen opens until the delay expires; then the
  // screen is fully cleared (\x1B[2J) before Ink renders so residual banner
  // lines never bleed into the main menu. Suppressed by SWAO_NO_SPLASH_DELAY
  // for CI / headless environments (screen still cleared for a clean canvas).
  // Also suppressed when SWAO_LAUNCHER_WROTE_BANNER=1 (set by swao.bat): the
  // launcher wrote the banner before the binary started, so the user already
  // saw it during the V8 snapshot load. Skip both the banner and the delay.
  const launcherWroteBanner = !!process.env['SWAO_LAUNCHER_WROTE_BANNER'];
  if (!process.env['SWAO_NO_SPLASH_DELAY'] && !launcherWroteBanner) {
    const platformStr = process.platform === 'win32' ? 'Windows'
      : process.platform === 'darwin' ? 'macOS' : 'Linux';
    const sep = '='.repeat(64);
    process.stdout.write(
      '\n' +
      sep + '\n' +
      '\n' +
      '                    S  W  A  O\n' +
      '\n' +
      '  Sovereign Workload Assessment and Onboarding\n' +
      `  ${platformStr} launcher\n` +
      '\n' +
      `  v${SWAO_VERSION}${SWAO_BUILD_SUFFIX}, ${editionStr} Edition, Apache 2.0\n` +
      '\n' +
      '  Website       :  https://steady-echo-yp4z.here.now/\n' +
      '  Technical Docs:  https://accenture.github.io/SWAO/en/\n' +
      '  Source Code   :  https://github.com/Accenture/SWAO\n' +
      '\n' +
      sep + '\n',
    );
    // #0812: 1500ms was too brief to read. 3500ms keeps the banner visible
    // long enough to scan while not adding perceptible delay on fast machines.
    await new Promise<void>(resolve => setTimeout(resolve, 3500));
  }
  // Clear the entire screen + home cursor before Ink renders. Without this,
  // residual banner text on rows longer than the first Ink frame bleeds through.
  process.stdout.write('\x1B[2J\x1B[3J\x1B[H');

  const restore = () => { try { process.stdout.write(EXIT_ALT_SCREEN); } catch { /* terminal already gone */ } };
  // Kill any active assessment leg / challenge subprocesses before exiting
  // so they do not linger as orphans on Windows after the TUI window closes.
  // #3461: killMcpServer first (tree-kill of the MCP child SWAO Chat spawned, if any; never a pid-file PID).
  const cleanup = () => { killMcpServer(); killAllChildren(); restore(); };
  process.once('exit',    cleanup);
  process.once('SIGINT',  () => { cleanup(); process.exit(130); });
  process.once('SIGTERM', () => { cleanup(); process.exit(143); });

  // #4392 (Design 116 section 12.6): the HTTP MCP server for Claude Code and the
  // Claude Desktop Code tab, pinned to the open workspace, in the background
  // (the first frame does not wait). Enterprise registers the starter; in
  // Community and Consultant this is a silent no-op. SWAO Chat starts its own
  // when opened directly (`swao chat`), so the chat screen is left out here.
  if (initialScreen !== 'chat') void startTuiMcpServer({ workspace: findWorkspace(process.cwd()) });

  // #0766: catch unhandled exceptions / rejections before Ink starts so any
  // async throw (inside an assessment child-process callback, a failed render,
  // or a promise that escapes the React tree) is captured rather than silently
  // crashing the terminal with the alt-screen buffer still active.
  const writeCrashRecord = (err: unknown): void => {
    const now = new Date();
    const entry = JSON.stringify({
      ts: now.toISOString(), level: 'fatal', scope: 'process', code: 'process.crash',
      message: err instanceof Error ? err.message : String(err),
      context: { stack: err instanceof Error ? err.stack : undefined },
    }) + '\n';
    try {
      const ws = findWorkspace(process.cwd());
      const logsDir = ws ? `${ws}/wsp/logs` : `${process.cwd()}/wsp/logs`;
      mkdirSync(logsDir, { recursive: true });
      // #2367: date-suffix so each day's crashes are in a separate file; easier to correlate with UAT session logs.
      const dateStr = now.toISOString().slice(0, 10);
      appendFileSync(`${logsDir}/crash-${dateStr}.ndjson`, entry, 'utf-8');
    } catch { /* best-effort -- never block exit */ }
  };
  const exitAfterCrash = (err: unknown): void => {
    restore();
    try {
      process.stderr.write(
        `\n[SWAO] Fatal error: ${err instanceof Error ? err.message : String(err)}\n` +
        `See wsp/logs/crash-YYYY-MM-DD.ndjson for details.\n\n`,
      );
    } catch { /* terminal gone */ }
    process.exit(1);
  };
  const crashLog = (err: unknown): void => { writeCrashRecord(err); exitAfterCrash(err); };
  // #4345: an uncaught exception or unhandled rejection (a key handler, a
  // timer, a promise) writes tui.crash to the portfolio log with the screen
  // and the step, then the root ErrorPanel replaces the app so the window
  // does not vanish (Enter exits with code 1). The crash-*.ndjson record of
  // #0766 is kept. Without a mounted overlay the process exits as before.
  const processCrash = (origin: 'uncaughtException' | 'unhandledRejection') => (err: unknown): void => {
    writeCrashRecord(err);
    handleProcessCrash(err, origin, () => exitAfterCrash(err));
  };
  process.on('uncaughtException',   processCrash('uncaughtException'));
  process.on('unhandledRejection',  processCrash('unhandledRejection'));
  // #4379 (Design 126 section 7.11): Ctrl+C asks first. The guard takes every
  // Ctrl+C byte out of Ink's input; the first shows "Press Ctrl+C again to quit
  // SWAO", a second within 2 seconds marks the exit cause ctrl_c (#4345, so
  // wizard.abort names it) and unmounts Ink, which resolves waitUntilExit and
  // the finally block leaves the alternate screen as on any exit.
  let unmountInk: (() => void) | null = null;
  const ctrlCGuard = createCtrlCGuard({ onQuit: () => { setImmediate(() => { unmountInk?.(); }); } });
  const uninstallCtrlC = installCtrlCGuard(process.stdin as unknown as { read: (size?: number) => unknown }, ctrlCGuard);

  try {
    // Wrap in TuiErrorBoundary so React render errors are captured and written
    // to crash.ndjson. Without the boundary, Ink's internal error handler resolves
    // waitUntilExit() silently and the process exits 0 with no crash record.
    // #4345: screens and wizard steps have their own TuiCrashBoundary (ErrorPanel,
    // Back); this one only sees an error of the root itself.
    const exitWithCrash = (code: number): void => { restore(); process.exit(code); };
    const { waitUntilExit, unmount } = render(
      React.createElement(TuiErrorBoundary, { onCrash: (err: unknown) => { reportTuiCrash(err, 'uncaughtException'); crashLog(err); } },
        React.createElement(TuiCrashOverlay, { exit: exitWithCrash },
          // #4123: App renders inside the constant-height TerminalFrame (App.tsx).
          React.createElement(App, { initialScreen, ...(opts?.setupMode ? { setupMode: opts.setupMode } : {}) }),
        ),
      ),
      // #4379: the Ctrl+C guard owns Ctrl+C; Ink never ends the app on it.
      { exitOnCtrlC: false },
    );
    unmountInk = unmount;
    await waitUntilExit();
  } finally {
    uninstallCtrlC();
    ctrlCGuard.dispose();
    // #4392: the MCP server this TUI started stops with it (a live child would also keep the process alive).
    killMcpServer();
    restore();
  }
}
