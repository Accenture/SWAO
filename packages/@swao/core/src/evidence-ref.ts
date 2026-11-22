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

// #4463, #4465 (Design publication/006 section 9.12): one normalisation of evidence
// references for every side that keys or looks them up: the Pass 14 secret
// scan (writes the location), derive-plan (writes evidence_index and the
// catalogue ids) and the publication (resolves a cited ref to its Evidence
// Gallery entry). Pure string functions, no file system access.

import { isAbsenceEvidenceRef } from './evidence-absence.js';

/**
 * Absolute path into the app inputs: a drive letter (`C:/`, `C:\`) or a
 * leading slash, any folders, then `wsp/inputs/`. The lookbehind keeps a
 * relative `x/wsp/inputs/` (inside another path) untouched. Folder names are
 * bounded and exclude blanks, so the match is linear.
 */
const ABS_INPUTS_RE = /(?<![A-Za-z0-9_.:/\x5c-])(?:[A-Za-z]:[/\x5c]|[/\x5c])(?:[^\s/\x5c'"<>|:*?]{1,255}[/\x5c]){0,64}?wsp[/\x5c]inputs[/\x5c]([^\s'"<>|*?]*)/g;

/** Absolute path into an app folder outside the inputs (`C:/ws/apps/<id>/wsp/runs/...`). */
const ABS_APP_RE = /(?<![A-Za-z0-9_.-])[A-Za-z]:[/\x5c](?:[^\s/\x5c'"<>|:*?]{1,255}[/\x5c]){0,64}?apps[/\x5c][^\s/\x5c'"<>|:*?]{1,255}[/\x5c]([^\s'"<>|*?]*)/g;

export interface RelativiseOptions {
  /**
   * Sub-directory of the source checkout the assessment scanned
   * (`.swao.yml` `source.vcs.subdir`, for example `apps/health/x`). Paths
   * below `wsp/inputs/source/<subdir>/` become relative to it, the form the
   * other passes cite (`api/Cargo.toml`).
   */
  sourceSubdir?: string;
}

function trimSlashes(p: string): string {
  let s = 0;
  let e = p.length;
  while (s < e && (p[s] === '/' || p[s] === '.')) s++;
  while (e > s && p[e - 1] === '/') e--;
  return p.slice(s, e);
}

/**
 * #4463: path below the app inputs root (`source/...`, `terraform/...`) to the
 * form the passes cite: a source file relative to the scanned checkout
 * (`source/` and the optional subdir removed), any other input relative to
 * `wsp/inputs/`, prefixed `wsp/inputs/` only when it is the inputs root itself.
 */
export function inputsRelativePath(rest: string, opts: RelativiseOptions = {}): string {
  let p = rest.split(String.fromCharCode(92)).join('/');
  if (p.startsWith('source/')) {
    p = p.slice('source/'.length);
    const sub = trimSlashes((opts.sourceSubdir ?? '').split(String.fromCharCode(92)).join('/'));
    if (sub && p.toLowerCase().startsWith(`${sub.toLowerCase()}/`)) p = p.slice(sub.length + 1);
    return p;
  }
  return p === '' ? 'wsp/inputs/' : p;
}

/**
 * #4463: replace every absolute workspace path in `text` by the relative form
 * a reader of a publication can use: files of the app inputs relative to the
 * inputs (see inputsRelativePath), other files of the app folder relative to
 * the app (`wsp/runs/...`). Text without a drive letter or a leading-slash
 * `wsp/inputs/` path is returned unchanged.
 */
export function relativiseWorkspacePaths(text: string, opts: RelativiseOptions = {}): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (!/[/\x5c]/.test(text)) return text;
  let out = text.replace(ABS_INPUTS_RE, (_m: string, rest: string) => inputsRelativePath(rest, opts));
  out = out.replace(ABS_APP_RE, (_m: string, rest: string) => rest.split(String.fromCharCode(92)).join('/'));
  return out;
}

/** True when `text` still holds a drive-letter path (`C:/`, `d:\`). */
export function hasDriveLetterPath(text: string): boolean {
  return /(?<![A-Za-z0-9])[A-Za-z]:(?:\/|\x5c(?!u[0-9a-fA-F]{4}))[A-Za-z0-9_.]/.test(text);
}

// A file extension at the end of a token (bounded, so the scan stays linear).
const EXTENSION_END_RE = /\.[A-Za-z0-9]{1,8}$/;
// `path:12`, `path:12-30`, `path:12:4` (a location after the file).
const LINE_SUFFIX_RE = /^(.+?):\d{1,9}(?:[-:]\d{1,9})?$/;
// `path (text)`: a trailing parenthetical without nested parentheses.
const PAREN_SUFFIX_RE = /^(\S(?:.{0,1000}?\S)?)\s+\([^()]{0,1000}\)$/;
// `head: rest`, the head without blanks.
const COLON_TEXT_RE = /^(\S{1,1000}?):\s+(.{1,2000})$/;

// A token is path-shaped when it has no blank and either has a separator
// before any colon or, colon-free, ends in a file extension. Written without a
// regex over the whole token: two overlapping character classes in sequence
// are polynomial on long runs of '/' (CodeQL js/polynomial-redos).
function isPathish(token: string): boolean {
  if (/\s/.test(token)) return false;
  const slash = token.indexOf('/');
  const colon = token.indexOf(':');
  if (slash >= 0 && (colon < 0 || colon > slash)) return true;
  return colon < 0 && EXTENSION_END_RE.test(token);
}

/**
 * Removes leading and trailing '/' (or only trailing ones with `end`). A loop,
 * not an end-anchored regex: a repetition anchored at the end is polynomial on
 * long runs of '/' (CodeQL js/polynomial-redos).
 */
export function trimPathSlashes(value: string, ends: 'both' | 'end' = 'both'): string {
  let start = 0;
  let stop = value.length;
  if (ends === 'both') while (start < stop && value.charCodeAt(start) === 47) start++;
  while (stop > start && value.charCodeAt(stop - 1) === 47) stop--;
  return value.slice(start, stop);
}

/**
 * #4465: the keys a cited evidence ref is looked up under, most specific
 * first. Each step removes one decoration the passes add after a file:
 *   1. the ref as cited, then with absolute workspace paths made relative;
 *   2. a trailing ` (text)` (`ops/Dockerfile (image: postgres:16)`);
 *   3. a secret-scan rule before the location (`rule: path:12`) or a
 *      description after the file (`path: is_deleted columns`);
 *   4. a location or description after a blank (`other/doc.md section 1`);
 *   5. a `:line`, `:line-line` or `:line:col` location.
 * The caller maps every key of evidence_index and every catalogue key and
 * ref through the same function (`evidenceLookupKey`), so both sides agree.
 */
export function evidenceRefLookupKeys(ref: string, opts: RelativiseOptions = {}): string[] {
  const out: string[] = [];
  const push = (k: string): void => {
    const v = k.trim();
    if (v && !out.includes(v)) out.push(v);
  };
  const raw = typeof ref === 'string' ? ref.trim() : '';
  if (!raw) return out;
  push(raw);
  let cur = evidenceLookupKey(raw, opts);
  push(cur);
  const paren = PAREN_SUFFIX_RE.exec(cur);
  if (paren) { cur = paren[1]!; push(cur); }
  const colon = COLON_TEXT_RE.exec(cur);
  if (colon) {
    const head = colon[1]!;
    const tail = colon[2]!.trim();
    if (isPathish(head)) { cur = head; push(cur); }
    else if (!/\s/.test(tail) && isPathish(tail)) { cur = tail; push(cur); }
  }
  // A location or description after the file (`other/doc.md section 1`).
  const blank = cur.search(/\s/);
  if (blank > 0 && isPathish(cur.slice(0, blank))) { cur = cur.slice(0, blank); push(cur); }
  const line = LINE_SUFFIX_RE.exec(cur);
  if (line && isPathish(line[1]!)) { cur = line[1]!; push(cur); }
  return out;
}

/**
 * #4465: the canonical form of one ref (or one evidence_index key): trimmed,
 * absolute workspace paths relative, backslashes in a path-shaped ref turned
 * into forward slashes. Used on both sides of the lookup.
 */
export function evidenceLookupKey(ref: string, opts: RelativiseOptions = {}): string {
  const v = relativiseWorkspacePaths(typeof ref === 'string' ? ref.trim() : '', opts);
  return /\s/.test(v) ? v : v.split(String.fromCharCode(92)).join('/');
}

/**
 * #0257, #4465: the opaque catalogue id (`EVD-<SLUG>`) of a ref, or null for
 * an absence statement. Moved from derive-plan so the publication re-keys a
 * legacy catalogue entry exactly as derive-plan keys a new one.
 * Bound the input before the regex chain: evidence refs are short labels, but
 * they can carry LLM- or source-derived text. The parenthetical drop is
 * O(n^2) over many failing start positions (a string of unmatched '('), so
 * the length is capped first (CodeQL js/polynomial-redos). The slug is capped
 * at 64 characters.
 */
export function evidenceCatalogueId(ref: string): string | null {
  if (isAbsenceEvidenceRef(ref)) return null;
  const slug = (ref.length > 200 ? ref.slice(0, 200) : ref)
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 64);
  if (!slug || slug.length < 2) return null;
  return `EVD-${slug}`;
}

/**
 * #4463: a legacy secret-scan ref `rule: path:line` in the current producer
 * shape `path:line (rule)` (Pass 14 mapGitleaksJson). With the rule first the
 * output guard reads the location as the value of an `api-key:` assignment.
 * Any other ref is returned unchanged.
 */
export function secretScanRefShape(ref: string): string {
  const m = /^([a-z0-9][a-z0-9-]{1,80}):\s+(\S{1,1000}:\d{1,9})$/i.exec(ref.trim());
  if (!m || !isPathish(m[2]!.replace(/:\d+$/, ''))) return ref;
  return `${m[2]} (${m[1]})`;
}
