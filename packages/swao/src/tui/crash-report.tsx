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

// #4345 (Design 126 sections 4.9 and M-15): a TUI error never ends in a
// vanished window and never in a log that cannot tell a crash from an exit.
//
//   - `TuiCrashBoundary` wraps every main menu screen (App.tsx) and every
//     Setup Wizard step (SetupWizard.tsx). A render error writes `tui.crash`
//     to the portfolio log and shows the ErrorPanel with the log path in the
//     guidance instead of the screen; Back leaves the screen or the step.
//   - `handleProcessCrash` is the process-level handler of run-app.ts for an
//     uncaught exception or an unhandled rejection (a key handler, a timer,
//     a promise; a boundary does not see those). It writes `tui.crash` and,
//     while `TuiCrashOverlay` is mounted, shows the ErrorPanel at the root
//     (Enter exits SWAO); without the overlay it exits at once as before.
//   - The exit cause (`ctrl_c`, `crash`) is kept here, so the wizard's
//     `wizard.abort` names it (user_escape, ctrl_c, crash or exit). The
//     Ctrl+C guard (ctrl-c-guard.tsx, #4379) marks ctrl_c on the confirmed
//     second Ctrl+C only.
//
// The log record carries the error class, the message, the top of the stack
// and the screen and step the operator was on; the screen shows no stack.

import React, { useEffect, useState, type ReactNode } from 'react';
import { Box } from 'ink';
import { ErrorPanel, ERROR_PANEL_KEYS, errorGuidance } from '@swao/tui-kit';
import { listSinkPaths, logPortfolio, resolveWorkspaceRoot } from '@swao/core';
import { SetupStepFrame } from '../setup/setup-frame.js';

/** Why the TUI ended without a user Esc: Ctrl+C or a crash. */
export type TuiExitCause = 'ctrl_c' | 'crash';

/** Where the operator was: the main menu screen and the Setup Wizard step. */
export interface TuiLocation { screen?: string; step?: string }

export type TuiCrashOrigin = 'render' | 'uncaughtException' | 'unhandledRejection';

/** What `tui.crash` records and the ErrorPanel shows. */
export interface TuiCrashReport {
  origin: TuiCrashOrigin;
  errorClass: string;
  message: string;
  stackTop: string[];
  screen?: string;
  step?: string;
  /** The portfolio log the record went to (null when no workspace was found). */
  logPath: string | null;
}

let exitCause: TuiExitCause | null = null;
let location: TuiLocation = {};
let overlay: ((report: TuiCrashReport) => void) | null = null;

/** The screen or step the operator is on (App.tsx sets the screen, the wizard the step). */
export function setTuiLocation(patch: TuiLocation): void {
  location = { ...location, ...patch };
}

export function tuiLocation(): TuiLocation {
  return { ...location };
}

/** Records why the TUI ends; a crash wins over Ctrl+C. */
export function markTuiExitCause(cause: TuiExitCause): void {
  if (exitCause !== 'crash') exitCause = cause;
}

export function tuiExitCause(): TuiExitCause | null {
  return exitCause;
}

/** Test hook. */
export function resetTuiCrashState(): void {
  exitCause = null;
  location = {};
  overlay = null;
}

/** The first `n` frames of a stack ("at ..." lines), without the message lines. */
export function stackTop(err: unknown, n = 3): string[] {
  if (!(err instanceof Error) || typeof err.stack !== 'string') return [];
  const frames: string[] = [];
  for (const line of err.stack.split('\n')) {
    const t = line.trim();
    if (t.startsWith('at ')) frames.push(t);
    if (frames.length >= n) break;
  }
  return frames;
}

function errorClassOf(err: unknown): string {
  if (err instanceof Error) return err.constructor?.name || err.name || 'Error';
  return typeof err;
}

function portfolioLogPath(): string | null {
  try {
    const root = resolveWorkspaceRoot();
    return root ? listSinkPaths(root).portfolio : null;
  } catch {
    return null;
  }
}

/**
 * Writes `tui.crash` (synchronous append). A process-level crash also marks
 * the exit cause; a render error caught by a boundary does not end the TUI.
 */
export function reportTuiCrash(err: unknown, origin: TuiCrashOrigin): TuiCrashReport {
  if (origin !== 'render') markTuiExitCause('crash');
  const report: TuiCrashReport = {
    origin,
    errorClass: errorClassOf(err),
    message: err instanceof Error ? err.message : String(err),
    stackTop: stackTop(err),
    ...(location.screen ? { screen: location.screen } : {}),
    ...(location.step ? { step: location.step } : {}),
    logPath: portfolioLogPath(),
  };
  try {
    logPortfolio('error', 'tui.crash', `TUI ${origin === 'render' ? 'render error' : origin}: ${report.errorClass}`, {
      context: {
        origin,
        error_class: report.errorClass,
        message: report.message,
        stack_top: report.stackTop,
        screen: report.screen ?? null,
        step: report.step ?? null,
      },
      mirror: false,
    });
  } catch { /* best-effort: never throw from the crash path */ }
  return report;
}

/**
 * The process-level handler (uncaughtException, unhandledRejection): logs
 * `tui.crash`, then shows the root ErrorPanel when it is mounted, otherwise
 * exits with code 1. Returns true when the panel took over.
 */
export function handleProcessCrash(err: unknown, origin: Exclude<TuiCrashOrigin, 'render'>, exit: (code: number) => void): boolean {
  const report = reportTuiCrash(err, origin);
  if (overlay) {
    try { overlay(report); return true; } catch { /* fall through to exit */ }
  }
  exit(1);
  return false;
}

const CAUSE = 'SWAO recorded the error in the log; what earlier steps saved is kept.';

/** The message as one sentence: trimmed, ending in a full stop (no regular expression on the input). */
export function sentence(message: string): string {
  const t = message.trim();
  if (t === '') return 'An unexpected error occurred.';
  const last = t[t.length - 1];
  return last === '.' || last === '!' || last === '?' ? t : `${t}.`;
}

function remedy(where: 'screen' | 'step' | 'process'): string {
  switch (where) {
    case 'screen': return 'Back returns to the main menu; open the screen again. If the error repeats, send the log to the SWAO team (Tools, Support bundle).';
    case 'step': return 'Back leaves the setup; start the setup of this assessment type again from Setup. If the error repeats, send the log to the SWAO team (Tools, Support bundle).';
    case 'process': return 'Enter exits SWAO; start it again. If the error repeats, send the log to the SWAO team (Tools, Support bundle).';
    default: {
      const never: never = where;
      return String(never);
    }
  }
}

function shortLogPath(path: string | null): string | undefined {
  if (!path) return undefined;
  const at = path.replace(/\\/g, '/').lastIndexOf('/wsp/');
  return at >= 0 ? path.replace(/\\/g, '/').slice(at + 1) : path;
}

/**
 * The ErrorPanel of a crash (Design 126 M-15). Through SetupStepFrame: inside
 * the wizard the frame draws the error keys and the guidance box; elsewhere
 * the frame draws them itself.
 */
export function CrashPanel({ report, where, onBack }: { report: TuiCrashReport; where: 'screen' | 'step' | 'process'; onBack: () => void }): JSX.Element {
  const title = where === 'step' ? 'This setup step stopped with an error' : where === 'screen' ? 'This screen stopped with an error' : 'SWAO stopped with an error';
  const logPath = shortLogPath(report.logPath);
  const recovery = where === 'process' ? [{ label: 'Exit SWAO', value: 'back' }] : [];
  return (
    <SetupStepFrame keys={ERROR_PANEL_KEYS} guidance={errorGuidance({ title, remedy: remedy(where), ...(logPath ? { logPath } : {}) })}>
      <Box flexDirection="column">
        <ErrorPanel
          title={title}
          cause={`${sentence(report.message)} ${CAUSE}`}
          recovery={recovery}
          onSelect={() => onBack()}
          {...(logPath ? { logPath } : {})}
        />
      </Box>
    </SetupStepFrame>
  );
}

interface BoundaryProps {
  where: 'screen' | 'step';
  onBack: () => void;
  /** Called once with the report (the wizard records `crash` as its abort reason). */
  onCrash?: (report: TuiCrashReport) => void;
  children?: ReactNode;
}
interface BoundaryState { crashed: boolean; report: TuiCrashReport | null }

/** Catches a render error of one screen or one wizard step (#4345). */
export class TuiCrashBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { crashed: false, report: null };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { crashed: true };
  }

  componentDidCatch(err: unknown): void {
    const report = reportTuiCrash(err, 'render');
    try { this.props.onCrash?.(report); } catch { /* best-effort */ }
    this.setState({ report });
  }

  render(): ReactNode {
    if (this.state.report) return <CrashPanel report={this.state.report} where={this.props.where} onBack={this.props.onBack} />;
    if (this.state.crashed) return null; // until componentDidCatch has the report
    return this.props.children ?? null;
  }
}

/**
 * The root of the TUI: shows the process-level crash panel instead of the
 * app once `handleProcessCrash` reports, so the window does not vanish.
 */
export function TuiCrashOverlay({ children, exit }: { children?: ReactNode; exit: (code: number) => void }): JSX.Element {
  const [report, setReport] = useState<TuiCrashReport | null>(null);
  useEffect(() => {
    overlay = (r) => setReport(r);
    return () => { overlay = null; };
  }, []);
  if (report) return <CrashPanel report={report} where="process" onBack={() => exit(1)} />;
  return <>{children}</>;
}
