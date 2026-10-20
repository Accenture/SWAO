// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Combined ID + name cell parsing and operational flags (Design 103 §3.3.2,
 * guardrails G-03 / G-04, #3077 / #3082).
 */

export type OperationalStatus = 'active' | 'restricted' | 'decommissioned' | 'unused' | 'inactive';

/**
 * Ordered: the combined `restricted` marker first, then `decommissioned`, then
 * `unused` (whose marker also contains "nicht starten"), and only then the
 * single "nicht starten" / "nicht löschen" phrases (#3167).
 */
const FLAG_PATTERNS: ReadonlyArray<{ status: Exclude<OperationalStatus, 'active' | 'inactive'>; re: RegExp }> = [
  { status: 'restricted',     re: /nicht\s+starten\s*(?:&|und)\s*nicht\s+l(?:o|ö|oe)schen!?/i },
  { status: 'decommissioned', re: /\balt\s+abgeschaltet\b|\bdecommissioned\b/i },
  { status: 'unused',         re: /\bungenutzte\s+ressource\b\.?(?:\s*nicht\s+starten!?)?/i },
  { status: 'restricted',     re: /\bnicht\s+(?:starten|l(?:o|ö|oe)schen)\b!?/i },
];

/** A dash with spaces on both sides separates the code from a name or a note. */
const SPACED_DASH = /\s[-–—]\s/;
/** One trailing-separator character: whitespace, `, ; . ! :`, hyphen, en-dash, em-dash. */
const SEPARATOR_CHAR = /[\s,;.!:\-\u2013\u2014]/;

/**
 * `text` without its trailing separator run: what `text.replace(/[\s,;.!:\-\u2013\u2014]+$/, '')`
 * returned, as a loop because that regex backtracks polynomially on long
 * whitespace runs (CodeQL js/polynomial-redos). Exported for tests.
 */
export function dropTrailingSeparators(text: string): string {
  let end = text.length;
  while (end > 0 && SEPARATOR_CHAR.test(text[end - 1] as string)) end--;
  return text.slice(0, end);
}

/** Hyphen runs collapsed to one hyphen, leading and trailing hyphens dropped (no regex backtracking). */
function collapseHyphens(text: string): string {
  let out = '';
  let pending = false;
  for (const ch of text) {
    if (ch === '-') { pending = out.length > 0; continue; }
    if (pending) out += '-';
    pending = false;
    out += ch;
  }
  return out;
}

export interface ParsedIdName {
  id: string;
  name: string;
  /** Operational flag found in the cell text, if any. */
  flag?: Exclude<OperationalStatus, 'active' | 'inactive'>;
}

const TRANSLITERATION: Readonly<Record<string, string>> = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' };

/**
 * Folder-safe app ID: lowercase, only [a-z0-9._-]. German umlauts and sharp s
 * are transliterated and dash runs collapsed, so `Größe` becomes `groesse`
 * instead of `gr--e` (#3167).
 */
export function normaliseAppId(raw: string): string {
  return collapseHyphens(raw
    .trim()
    .toLowerCase()
    .replace(/[äöüß]/g, (ch) => TRANSLITERATION[ch] ?? ch)
    .replace(/[^a-z0-9._-]+/g, '-'));
}

/** Index of the first operational flag phrase in `text`, or -1. */
function firstFlagIndex(text: string): number {
  let first = -1;
  for (const { re } of FLAG_PATTERNS) {
    const m = re.exec(text);
    if (m && (first < 0 || m.index < first)) first = m.index;
  }
  return first;
}

/** Text before the first flag phrase (when parsing flags), without trailing separators. */
function beforeFlag(text: string, parseFlags: boolean): string {
  const at = parseFlags ? firstFlagIndex(text) : -1;
  return dropTrailingSeparators(at >= 0 ? text.slice(0, at) : text).trim();
}

/** The code part of an identity text: cut at the first flag phrase and at a spaced dash. */
function codePart(text: string, parseFlags: boolean): string {
  const head = beforeFlag(text, parseFlags);
  const dash = SPACED_DASH.exec(` ${head} `);
  const code = dash ? ` ${head} `.slice(0, dash.index) : head;
  return dropTrailingSeparators(code).trim();
}

function decodeName(raw: string): string {
  return raw.replace(/%([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))).trim();
}

export function detectOperationalFlag(text: string): ParsedIdName['flag'] {
  for (const { status, re } of FLAG_PATTERNS) {
    if (re.test(text)) return status;
  }
  return undefined;
}

export function stripFlags(text: string): string {
  let out = text;
  for (const { re } of FLAG_PATTERNS) out = out.replace(re, ' ');
  return out.trim();
}

/**
 * Parse an identity cell such as `APP133 (Radimetrics) Alt Abgeschaltet`
 * (Design 103 §3.3.2, #3167):
 * - ID: the text before the first `splitOn` (default `(`), cut at the first
 *   operational flag phrase and at a spaced dash; the remaining words stay in
 *   the ID, so `NAME 2020` and `NAME (Fileserver)` stay distinct (#3162).
 * - Name: the text inside the brackets up to `stripClosing` (default `)`), cut
 *   before a flag phrase. Without brackets the name is empty.
 * - Flag: the first flag phrase anywhere in the cell.
 * - Free-text notes (after `)` or after a flag phrase) never reach the ID or
 *   the name; they can name a staff member.
 */
export function parseIdNameCell(
  value: string,
  opts: { splitOn?: string; stripClosing?: string; stripFlags?: boolean } = {},
): ParsedIdName {
  const splitOn = opts.splitOn ?? '(';
  const closing = opts.stripClosing ?? ')';
  const parseFlags = opts.stripFlags ?? true;
  const text = value.trim();
  const flag = parseFlags ? detectOperationalFlag(text) : undefined;
  const at = text.indexOf(splitOn);

  const id = normaliseAppId(codePart(at < 0 ? text : text.slice(0, at), parseFlags));
  let name = '';
  if (at >= 0) {
    const rest = text.slice(at + splitOn.length);
    const closeAt = closing ? rest.lastIndexOf(closing) : -1;
    name = decodeName(beforeFlag(closeAt >= 0 ? rest.slice(0, closeAt) : rest, parseFlags));
  }
  return flag ? { id, name, flag } : { id, name };
}

/**
 * Resolve operational status: an explicit Column A flag wins; otherwise
 * `active_memory_mb === 0` means the server is likely shut down (G-04).
 */
export function resolveOperationalStatus(flag: ParsedIdName['flag'], activeMemoryMb: number | null | undefined, memoryMb?: number | null): OperationalStatus {
  if (flag) return flag;
  if (activeMemoryMb === 0 || memoryMb === 0) return 'inactive';
  return 'active';
}
