// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Terminal mouse escape-sequence classification (#1082, #1378, #1387).
 *
 * Windows Terminal (and other emulators) can deliver mouse reports into the
 * application's stdin as raw escape sequences. Ink's useInput hands these to
 * components as the `input` string with no key flags set; navigation handlers
 * that only check `input === ' '` etc. treat them as garbage keystrokes,
 * which jitters cursor state and corrupts list rendering.
 *
 * Two protocols are recognised:
 *   X10:  ESC [ M cb cx cy         (cb = 32 + button code)
 *   SGR:  ESC [ < b ; x ; y M|m    (b = button code, decimal)
 *
 * Button code semantics (both protocols): bit 6 (64) marks wheel events,
 * low two bits select the direction (0 = up, 1 = down). Bit 5 (32) marks
 * motion reports. Everything that is a mouse report but not a wheel tick is
 * classified as noise and must be swallowed, never interpreted as input.
 */

export type MouseClassification = 'wheel-up' | 'wheel-down' | 'noise';

const X10_PREFIX = '\x1b[M';
const SGR_RE = /^\x1b\[<(\d+);\d+;\d+[Mm]/;

function classifyButton(btn: number): MouseClassification {
  if ((btn & 64) !== 0 && (btn & 32) === 0) {
    return (btn & 3) === 0 ? 'wheel-up' : (btn & 3) === 1 ? 'wheel-down' : 'noise';
  }
  return 'noise';
}

/**
 * Classify a useInput `input` string. Returns null when the input is NOT a
 * mouse escape sequence (i.e. normal keyboard input the caller should
 * process); otherwise the wheel direction, or 'noise' for any other mouse
 * report (clicks, motion, releases, truncated chunks) which the caller must
 * ignore entirely.
 */
export function classifyMouseInput(input: string): MouseClassification | null {
  if (!input || !input.startsWith('\x1b[')) return null;

  if (input.startsWith(X10_PREFIX)) {
    if (input.length < 4) return 'noise'; // truncated chunk
    const cb = input.charCodeAt(3);
    return classifyButton(cb - 32);
  }

  const sgr = SGR_RE.exec(input);
  if (sgr) return classifyButton(parseInt(sgr[1]!, 10));

  // ESC [ < without full payload yet (chunked SGR report).
  if (input.startsWith('\x1b[<')) return 'noise';

  return null;
}

// ---------------------------------------------------------------------------
// Terminal mouse-reporting lifecycle (#1391 stage 1)
// ---------------------------------------------------------------------------
// Without enabling mouse reporting the terminal keeps the wheel for its own
// scrollback, so pickers never receive wheel input at all. Button-event mode
// (?1000) + SGR encoding (?1006) delivers wheel ticks and clicks as escape
// sequences that classifyMouseInput already handles; motion tracking (?1003)
// is deliberately NOT enabled (hover-follow is #1391 stage 2).
//
// The refcount lets multiple pickers coexist (wizard steps, nested screens):
// the enable sequence is written on 0 -> 1, the disable sequence on 1 -> 0,
// and a process exit hook restores the terminal even on Ctrl+C -- leaving
// mouse reporting active would corrupt the operator's shell after quit.

export const ENABLE_MOUSE_REPORTING = '\x1b[?1000h\x1b[?1006h';
export const DISABLE_MOUSE_REPORTING = '\x1b[?1006l\x1b[?1000l';

type Writer = (s: string) => void;

export class MouseReportingManager {
  private count = 0;
  constructor(private readonly write: Writer) {}

  /** Returns a release function; safe to call the release at most once. */
  acquire(): () => void {
    this.count += 1;
    if (this.count === 1) this.write(ENABLE_MOUSE_REPORTING);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.count -= 1;
      if (this.count === 0) this.write(DISABLE_MOUSE_REPORTING);
    };
  }

  /** Exit-path restore: unconditionally disables when any acquisition is live. */
  restoreOnExit(): void {
    if (this.count > 0) {
      this.count = 0;
      this.write(DISABLE_MOUSE_REPORTING);
    }
  }

  get activeCount(): number { return this.count; }
}

let _singleton: MouseReportingManager | null = null;
let _exitHooked = false;

/** Process-wide manager writing to stdout; components call acquire() on mount
 *  and the returned release on unmount. TTY-only: outside a TTY (tests, CI,
 *  piped output) this is a no-op manager so no escapes leak into captures. */
export function acquireMouseReporting(): () => void {
  if (!process.stdout.isTTY) return () => {};
  if (!_singleton) {
    _singleton = new MouseReportingManager((s) => { process.stdout.write(s); });
  }
  if (!_exitHooked) {
    _exitHooked = true;
    process.on('exit', () => { _singleton?.restoreOnExit(); });
  }
  return _singleton.acquire();
}
