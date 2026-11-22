// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, test helper: the G-08 width and ellipsis rule (#4213)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-08 with sections 8 (rule 5) and 10: no line wider
// than the header rule, and no ellipsis on operator text. An ellipsis is
// allowed only in a middle-shortened path and in the collapsed guidance box
// (its preview line is cut on purpose). Shared by tui-width-100-80.test.tsx
// and the step and branch width tests of the Setup Wizard.

import { headerRuleWidth } from '@swao/tui-kit';

const NL = String.fromCharCode(10);
const ELLIPSIS = /\.\.\.|…/;
const GUIDANCE_COLLAPSED = '(Ctrl+G for guidance)';

/**
 * True when no ellipsis of the line cuts text: each one sits in a path token
 * (the word around it holds a slash or a backslash: a middle-shortened path),
 * or is written text closed by a bracket, such as "(sk-ant-...)" or
 * "readiness, ...)", which a cut never produces.
 */
export function noCutEllipsis(line: string): boolean {
  const re = /\.\.\.|…/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const start = line.lastIndexOf(' ', m.index) + 1;
    const stop = line.indexOf(' ', m.index);
    const token = line.slice(start, stop < 0 ? line.length : stop);
    const after = line[m.index + m[0].length] ?? '';
    if (!/[\\/]/.test(token) && after !== ')') return false;
  }
  return true;
}

/**
 * The G-08 offenders of one rendered frame (lines without colour codes):
 * lines past the header rule of `columns`, and lines with an ellipsis that
 * cuts text. The lines of a collapsed guidance box (a bordered box whose
 * first line carries "(Ctrl+G for guidance)") are exempt from the ellipsis
 * check; other bordered panels (AbortDialog, LicenseGate) are not.
 */
export function widthOffenders(frame: string | readonly string[], columns: number): string[] {
  const lines = (typeof frame === 'string' ? frame.split(NL) : [...frame]).map((l) => l.trimEnd());
  const out: string[] = [];
  const rule = headerRuleWidth(columns);
  let inCollapsedBox = false;
  lines.forEach((l, i) => {
    const t = l.trimStart();
    if (t.startsWith('┌')) inCollapsedBox = (lines[i + 1] ?? '').includes(GUIDANCE_COLLAPSED);
    const width = [...l].length;
    if (width > rule) out.push(`line ${i + 1} is ${width} wide (rule ${rule}): ${l.trim()}`);
    if (ELLIPSIS.test(l) && !inCollapsedBox && !noCutEllipsis(l)) out.push(`line ${i + 1} has an ellipsis outside a path: ${l.trim()}`);
    if (t.startsWith('└')) inCollapsedBox = false;
  });
  return out;
}

/** The ellipsis offenders only (the step tests check the width themselves). */
export function ellipsisOffenders(frame: string | readonly string[], columns: number): string[] {
  return widthOffenders(frame, columns).filter((o) => o.includes('ellipsis outside a path'));
}
