// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, the level of a CLI output line
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4257 (Design 126 section 6, gate G-03): the CLI commands mark a line with
// a bracketed prefix ("[warn] ...", "[error] ..."). Screens that spawn a
// command (Ingest, Service Portfolio) read the level of each output line for
// the event log and the line colour. The parse lives here, next to the
// commands that write the prefixes, so no TUI file holds a status literal.

/** The level of one CLI output line. */
export type CliLineLevel = 'error' | 'warn' | 'info';

const ERROR_MARK = '[error]';
const WARN_MARK = '[warn]';

/** The level a CLI output line starts with; `info` when it has no error or warning prefix. */
export function cliLineLevel(line: string): CliLineLevel {
  const t = line.trimStart();
  if (t.startsWith(ERROR_MARK)) return 'error';
  if (t.startsWith(WARN_MARK)) return 'warn';
  return 'info';
}

/** True when a CLI output line carries a warning mark anywhere (a prefixed sub-line included). */
export function cliLineWarns(line: string): boolean {
  return line.includes(WARN_MARK);
}
