// #1475: crash telemetry for the CLI entry -- capture unhandled rejections and
// uncaught exceptions to swao-crash.log in cwd so the root cause survives the
// terminal close. Both handlers use synchronous I/O, so the crash line is
// written before the process exits.
//
// #4021: an unhandled rejection used to be logged only, so a command that
// failed that way ended with exit 0 and scripts and CI read the failure as a
// success. It now ends with exit 1 (the "refused, invalid or missing input"
// family), after the crash line is written, like the uncaughtException path.
// process.exit(1), not process.exitCode = 1: several commands end with an
// explicit process.exit(0) (assess.ts, ingest.ts, init.ts, license.ts,
// report.ts), which would overwrite a pending exit code, and after an
// unhandled rejection the awaited chain of the command is broken, so the
// process could also hang. One exception: when a later handler is registered
// (the TUI crash handler of tui/run-app.ts, which writes wsp/logs/crash-*.ndjson
// and exits 1 itself), only the exit code is set, so that handler still runs.

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CrashHandlerDeps {
  /** Writes one crash record (file and stderr), synchronously. */
  write: (label: string, detail: string) => void;
  exit: (code: number) => void;
  setExitCode: (code: number) => void;
  /** Number of `unhandledRejection` listeners currently registered. */
  rejectionListeners: () => number;
  /**
   * #4345: number of `uncaughtException` listeners. With the TUI handler of
   * tui/run-app.ts registered after this one, an uncaught exception used to
   * exit here first: the TUI handler never ran (no tui.crash, no ErrorPanel)
   * and the wizard logged only `wizard.abort` reason exit from Ink's unmount
   * on process exit. Default 1 (exit here).
   */
  exceptionListeners?: () => number;
}

export function crashDetail(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? String(reason)) : String(reason);
}

export function onUnhandledRejection(reason: unknown, deps: CrashHandlerDeps): void {
  deps.write('unhandledRejection', crashDetail(reason));
  deps.setExitCode(1);
  // This handler is registered first; another listener exits by itself.
  if (deps.rejectionListeners() > 1) return;
  deps.exit(1);
}

export function onUncaughtException(err: Error, deps: CrashHandlerDeps): void {
  deps.write('uncaughtException', err.stack ?? String(err));
  if ((deps.exceptionListeners?.() ?? 1) > 1) {
    // The TUI handler runs next: it logs tui.crash, shows the ErrorPanel and exits 1 itself.
    deps.setExitCode(1);
    return;
  }
  deps.exit(1);
}

/** Crash record writer: appends to `logFile`, then mirrors to stderr. */
export function crashWriter(logFile: string): CrashHandlerDeps['write'] {
  return (label, detail) => {
    const line = `[${new Date().toISOString()}] ${label}\n${detail}\n---\n`;
    try { appendFileSync(logFile, line, 'utf-8'); } catch { /* fs failure -- silently skip */ }
    try { process.stderr.write(line); } catch { /* broken pipe -- silently skip */ }
  };
}

/** Registers both handlers on `process`; the crash log goes to `<cwd>/swao-crash.log`. */
export function installCrashHandlers(logFile: string = join(process.cwd(), 'swao-crash.log')): void {
  const deps: CrashHandlerDeps = {
    write: crashWriter(logFile),
    exit: (code) => process.exit(code),
    setExitCode: (code) => { process.exitCode = code; },
    rejectionListeners: () => process.listenerCount('unhandledRejection'),
    exceptionListeners: () => process.listenerCount('uncaughtException'),
  };
  process.on('unhandledRejection', (reason) => onUnhandledRejection(reason, deps));
  process.on('uncaughtException', (err) => onUncaughtException(err, deps));
}
