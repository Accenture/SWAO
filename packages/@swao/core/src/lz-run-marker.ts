// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4506 (Design 126 section 4.6): the stdout markers of `swao assess --type
// landing-zone` for a parent that opted in with SWAO_PASS_MARKERS=1 (the LZ
// Catalog run screen), so an operator terminal never sees them. One line when a
// target fit starts and one when it ends (the Stage bar), one verdict line per
// target and one overall verdict (the Done screen). The format and its one
// parser live here, as pass-marker.ts does for the passes of an application run.

const PASS = '[pass] ';
const PASS_DONE = '[pass-done] ';
const TARGET_VERDICT = '[lz-target-verdict] ';
const VERDICT = '[lz-verdict] ';

/** The pass name of a landing zone target fit on the run screen. */
export const LZ_FIT_PASS = 'lz_fit';

export function formatLzPassStart(provider: string, region: string): string {
  return `${PASS}${LZ_FIT_PASS} ${provider}:${region}`;
}

export function formatLzPassDone(provider: string, region: string): string {
  return `${PASS_DONE}${LZ_FIT_PASS} ${provider}:${region}`;
}

/** One target: `provider/region`, the verdict in lower case, the gap count. */
export function formatLzTargetVerdict(target: string, verdict: string, gaps: number): string {
  return `${TARGET_VERDICT}target=${target} verdict=${verdict.toLowerCase()} gaps=${gaps}`;
}

export function formatLzVerdict(verdict: string): string {
  return `${VERDICT}${verdict.toLowerCase()}`;
}

export type LzRunMarker =
  | { kind: 'pass'; pass: string; label: string }
  | { kind: 'pass-done'; pass: string }
  | { kind: 'target-verdict'; target: string; verdict: string; gaps: number }
  | { kind: 'verdict'; verdict: string };

/** The marker of one output line, or null for every other line. String code, no regex on the line. */
export function parseLzRunMarker(raw: string): LzRunMarker | null {
  const line = raw.trim();
  if (line.startsWith(PASS)) {
    const body = line.slice(PASS.length).trim();
    const blank = body.indexOf(' ');
    const pass = blank < 0 ? body : body.slice(0, blank);
    return pass ? { kind: 'pass', pass, label: blank < 0 ? '' : body.slice(blank + 1).trim() } : null;
  }
  if (line.startsWith(PASS_DONE)) {
    const pass = line.slice(PASS_DONE.length).trim().split(' ')[0] ?? '';
    return pass ? { kind: 'pass-done', pass } : null;
  }
  if (line.startsWith(TARGET_VERDICT)) {
    const fields: Record<string, string> = {};
    for (const part of line.slice(TARGET_VERDICT.length).trim().split(' ')) {
      const eq = part.indexOf('=');
      if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
    }
    const gaps = Number(fields['gaps']);
    if (!fields['target'] || !fields['verdict'] || !Number.isInteger(gaps)) return null;
    return { kind: 'target-verdict', target: fields['target'], verdict: fields['verdict'], gaps };
  }
  if (line.startsWith(VERDICT)) {
    const verdict = line.slice(VERDICT.length).trim();
    return verdict ? { kind: 'verdict', verdict } : null;
  }
  return null;
}
