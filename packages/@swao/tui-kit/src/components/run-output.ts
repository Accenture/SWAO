// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, run output text and progress arithmetic
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4252 (TUI-08, Design 126 sections 4.6 and 8 rules 1 and 4): run output
// lines reach the screen without dash punctuation and without user profile
// paths; the stage percentage includes the share of items done.
//
// tui-kit is a leaf package (react and ink only, ADR-0048), so it cannot
// import normalizeDashes() from @swao/core. normalizeRunDashes() mirrors it
// rule for rule; a parity test in the swao package
// (src/tui/__tests__/tui-run-cancel.test.tsx) compares both over a corpus.
// Dash characters are written as escapes so this file passes gate G-01.

const EM = '\u2014';
const EN = '\u2013';
const SPACED_DOUBLE_HYPHEN = / -{2} /g;

const isBlank = (code: number): boolean => code === 0x20 || code === 0x09;

/**
 * The rules of @swao/core normalizeDashes(): an em dash with the blanks
 * around it becomes ", ", an en dash a hyphen, a spaced double hyphen ", ".
 * CLI flags (a double hyphen without a space after it) stay.
 */
export function normalizeRunDashes(text: string): string {
  let out = text;
  if (out.includes(EM)) {
    const parts = out.split(EM);
    const last = parts.length - 1;
    out = parts.map((part, i) => {
      let start = 0;
      let end = part.length;
      if (i > 0) while (start < end && isBlank(part.charCodeAt(start))) start++;
      if (i < last) while (end > start && isBlank(part.charCodeAt(end - 1))) end--;
      return part.slice(start, end);
    }).join(', ');
  }
  return out.split(EN).join('-').replace(SPACED_DOUBLE_HYPHEN, ', ');
}

/** The profile folders replaced by their variable, most specific first (section 8 rule 4). */
export const USER_PATH_VARIABLES = ['LOCALAPPDATA', 'APPDATA', 'TEMP', 'USERPROFILE', 'HOME'] as const;

/**
 * Replace user profile folders by their variable (`%LOCALAPPDATA%\ms-playwright`),
 * case-insensitive, longest folder first so a nested folder wins over its
 * parent. `env` is injected so tests never read the real profile.
 */
export function shortenUserPaths(line: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const pairs = USER_PATH_VARIABLES
    .map((name) => ({ name, value: (env[name] ?? '').replace(/[\\/]+$/, '') }))
    .filter((p) => p.value.length > 3)
    .sort((a, b) => b.value.length - a.value.length);
  let out = line;
  for (const { name, value } of pairs) {
    const lower = out.toLowerCase();
    const needle = value.toLowerCase();
    let at = lower.indexOf(needle);
    if (at < 0) continue;
    let result = '';
    let from = 0;
    while (at >= 0) {
      const after = out.charAt(at + value.length);
      // Only a whole folder: the match ends at a separator, a blank or the end.
      if (after === '' || after === '\\' || after === '/' || /\s|["'),;:]/.test(after)) {
        result += out.slice(from, at) + `%${name}%`;
        from = at + value.length;
      }
      at = lower.indexOf(needle, at + value.length);
    }
    out = result + out.slice(from);
  }
  return out;
}

/** One run output line as the screen shows it: dashes normalised, user paths shortened. */
export function runOutputLine(line: string, env?: Readonly<Record<string, string | undefined>>): string {
  return shortenUserPaths(normalizeRunDashes(line), env);
}

/**
 * The hanging-indent prefix of an item line (`[189/234] app0189  `): the
 * counter, the item name and the blanks after it. Continuation lines wrap
 * under the text after the prefix (M-12). Null for a line without a counter.
 */
export function hangingPrefix(line: string): string | null {
  const m = /^(\[\s*\d+\/\d+\]\s+\S+\s+)\S/.exec(line);
  return m ? m[1]! : null;
}

/**
 * Overall percentage of a staged run (#4237 b): the stages before the
 * current one plus the share of items done within it, so the stage bar
 * moves while the assessment stage works through its apps.
 */
export function stagePercent(stage: number, stages: number, itemsDone?: number, itemsTotal?: number, stageShare?: number): number {
  if (stages <= 0) return 0;
  const s = Math.max(1, Math.min(stage, stages));
  // #4472: an explicit share of the current stage wins over the item count.
  const share = stageShare !== undefined && Number.isFinite(stageShare)
    ? Math.max(0, Math.min(1, stageShare))
    : itemsTotal && itemsTotal > 0 ? Math.max(0, Math.min(1, (itemsDone ?? 0) / itemsTotal)) : 0;
  return Math.floor(((s - 1 + share) / stages) * 100);
}

/** A duration in words of the timer line: `45s`, `12m 40s`, `1h 05m`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** An estimate, rounded to what an estimate can say: `40s`, `21m`, `1h 05m`. */
export function formatEta(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * Greedy word wrap to `width` columns. Ink's own wrap keeps the blank before
 * a wrapped word, which shifts the continuation by one column; the hanging
 * indent of M-12 needs the continuation exactly under the text. A word
 * longer than the width is split, never cut.
 */
export function wrapWords(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/ +/).filter((x) => x !== '')) {
    let rest = word;
    while (rest.length > w) {
      if (line) { out.push(line); line = ''; }
      out.push(rest.slice(0, w));
      rest = rest.slice(w);
    }
    if (!line) line = rest;
    else if (line.length + 1 + rest.length <= w) line += ` ${rest}`;
    else { out.push(line); line = rest; }
  }
  if (line || out.length === 0) out.push(line);
  return out;
}
