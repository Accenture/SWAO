// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, the "Report written to" line of `swao report`
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4257: `swao report` prints one "[ok]  Report written to <path>" line per
// file (report.ts). The Generate Report screen reads the paths from these
// lines and lists them as path rows instead of echoing the lines. The parse
// lives next to the command that defines the format, outside the TUI tree.

const OK_MARK = '[ok]';
const WRITTEN_MARK = 'Report written to ';

/** The report path of a CLI output line, or undefined when the line names no report file. */
export function reportPathFromLine(line: string): string | undefined {
  const t = line.trimStart();
  if (!t.startsWith(OK_MARK)) return undefined;
  const rest = t.slice(OK_MARK.length).trimStart();
  if (!rest.startsWith(WRITTEN_MARK)) return undefined;
  const path = rest.slice(WRITTEN_MARK.length).trim();
  return path === '' ? undefined : path;
}
