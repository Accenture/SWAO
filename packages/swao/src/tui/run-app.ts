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
import type { MenuTarget } from './screens/MainMenu.js';
import { SWAO_VERSION } from '../branding.js';
import { LicenseGuard } from '../license/license-guard.js';
import { findWorkspace } from '@swao/core';
import { killAllChildren, killMcpServer } from './child-process-registry.js';

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

export async function runTuiInAltScreen(initialScreen: Screen = 'main'): Promise<void> {
  // #0381: set the terminal/process title so the OS tab + window-list show
  // the full product name instead of "swao-win.exe" (default for pkg
  // binaries on Windows; "node" on Linux/macOS dev runs).
  try { process.title = 'SWAO -- Sovereign Workload Assessment & Onboarding'; } catch { /* read-only on some platforms; non-fatal */ }
  // OSC 0 (set window title) covers terminals that don't honour process.title
  // -- Windows Terminal, iTerm2, GNOME Terminal all respect this even when
  // process.title isn't propagated.
  process.stdout.write('\x1b]0;SWAO -- Sovereign Workload Assessment & Onboarding\x07');

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
      `  v${SWAO_VERSION}  --  ${editionStr} Edition  --  Apache 2.0\n` +
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
  const cleanup = () => { killAllChildren(); killMcpServer(); restore(); };
  process.once('exit',    cleanup);
  process.once('SIGINT',  () => { cleanup(); process.exit(130); });
  process.once('SIGTERM', () => { cleanup(); process.exit(143); });

  // #0766: catch unhandled exceptions / rejections before Ink starts so any
  // async throw (inside an assessment child-process callback, a failed render,
  // or a promise that escapes the React tree) is captured rather than silently
  // crashing the terminal with the alt-screen buffer still active.
  const crashLog = (err: unknown): void => {
    restore();
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
      appendFileSync(`${logsDir}/crash.ndjson`, entry, 'utf-8');
    } catch { /* best-effort -- never block exit */ }
    try {
      process.stderr.write(
        `\n[SWAO] Fatal error: ${err instanceof Error ? err.message : String(err)}\n` +
        `See wsp/logs/crash.ndjson for details.\n\n`,
      );
    } catch { /* terminal gone */ }
    process.exit(1);
  };
  process.on('uncaughtException',   crashLog);
  process.on('unhandledRejection',  crashLog);

  try {
    // Wrap in TuiErrorBoundary so React render errors are captured and written
    // to crash.ndjson. Without the boundary, Ink's internal error handler resolves
    // waitUntilExit() silently and the process exits 0 with no crash record.
    const { waitUntilExit } = render(
      React.createElement(TuiErrorBoundary, { onCrash: crashLog },
        React.createElement(App, { initialScreen }),
      ),
    );
    await waitUntilExit();
  } finally {
    restore();
  }
}
