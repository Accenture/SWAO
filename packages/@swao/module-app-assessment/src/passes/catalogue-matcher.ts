// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3410: the shared catalogue matcher. Every pass that matches catalogue
// tokens or catalogue regexes against source text (08 CRYPTO, 21 IAM,
// 03 DATA, 05 SBOM, 07 EGR) goes through this module, so word boundaries,
// case rules, data-content masking and the ReDoS guard are decided once
// (Design 070 section 2.7, ADR-0063).
//
// Before #3410 each pass joined its tokens into one `new RegExp(..., 'i')`
// without boundaries: `TDEA` matched inside `istDeaktiviert`, `RC4` inside a
// base64-encoded test PDF, `eric` (ELSTER ERiC) inside `generic`.
//
// Design:
//   - Boundaries live inside the compiled regex (lookarounds), never in a
//     post-filter, so the engine still backtracks into a longer alternative
//     (`DES|DESede`) when the short one fails its boundary.
//   - Case-insensitive matching is done by folding letters into `[aA]`
//     classes, never with the `i` flag: the segment boundary needs to see
//     the real case of the neighbouring characters (camelCase transitions).
//   - Literal tokens compile to escaped alternations, which are linear.
//     Operator-supplied regexes (`context`, pass-03 `pattern`, pass-05
//     `config_keys`, pass-21 `env_vars`) pass a static ReDoS guard, and every
//     match runs on single lines capped at MAX_LINE_LENGTH characters.
//   - Files tagged `isGenerated` or larger than MAX_SCAN_FILE_BYTES are not
//     read; lines longer than MAX_LINE_LENGTH (minified) are skipped; base64
//     runs and `data:` URIs are blanked out (same length, so columns stay).

import { readFileSync } from 'fs';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema (Zod at the catalogue YAML boundary)
// ---------------------------------------------------------------------------

/**
 * How a token's edges must sit in the text.
 * - `identifier`: the neighbour of a word-character edge must not be
 *   `[A-Za-z0-9_]` (`TDEA` does not match `TDEAKey` or `xTDEA`).
 * - `segment`: identifier-part matching for field and package names: `_`,
 *   `-`, `.`, any non-alphanumeric and a lower-to-upper case change are
 *   boundaries (`kvnr` matches `kvnr_hash`, `patientPid` contains `pid`,
 *   `rapid` does not).
 * - `substring`: no boundary (the pre-#3410 behaviour, opt-in only).
 */
export const MatchModeSchema = z.enum(['identifier', 'segment', 'substring']);
export type MatchMode = z.infer<typeof MatchModeSchema>;

export const CatalogueTokenSchema = z.union([
  z.string().min(1),
  z.object({
    token: z.string().min(1),
    match: MatchModeSchema.optional(),
    case_sensitive: z.boolean().optional(),
  }).strict(),
]);
export type CatalogueToken = z.infer<typeof CatalogueTokenSchema>;

export const MatchDefaultsSchema = z.object({
  match: MatchModeSchema.optional(),
  case_sensitive: z.boolean().optional(),
}).strict();
export type MatchDefaults = z.infer<typeof MatchDefaultsSchema>;

/**
 * The `detection` block shared by token catalogues (08, 21). `imports` are
 * matched in code files, `config_keys` in configuration files, `context`
 * (regexes, case-insensitive) in both. Pass-specific keys (pass 21
 * `env_vars`) pass through.
 */
export const CatalogueDetectionSchema = z.object({
  match: MatchModeSchema.optional(),
  case_sensitive: z.boolean().optional(),
  imports: z.array(CatalogueTokenSchema).default([]),
  config_keys: z.array(CatalogueTokenSchema).default([]),
  context: z.array(z.string().min(1)).default([]),
}).passthrough();
export type CatalogueDetection = z.infer<typeof CatalogueDetectionSchema>;

/** #3412: severity an exception assigns to the hits it covers. */
export const ExceptionSeveritySchema = z.enum(['informational', 'low', 'medium']);
export type ExceptionSeverity = z.infer<typeof ExceptionSeveritySchema>;

/**
 * #3412: a context exception on a catalogue entry. `pattern` (regex,
 * case-insensitive) must match the hit's own line; `near` (regex) must match
 * within `window` lines either side of the hit. At least one is required;
 * when both are given, both must match. The first matching exception wins.
 * A workspace catalogue overrides the exceptions by redefining the entry
 * (ADR-0063: workspace entry wins on id).
 */
export const CatalogueExceptionSchema = z.object({
  id: z.string().min(1),
  pattern: z.string().min(1).optional(),
  near: z.string().min(1).optional(),
  window: z.number().int().min(0).max(20).default(5),
  severity: ExceptionSeveritySchema,
  rationale: z.string().min(1),
}).strict().refine((e) => e.pattern !== undefined || e.near !== undefined, {
  message: 'an exception needs pattern or near',
});
export type CatalogueException = z.infer<typeof CatalogueExceptionSchema>;

export interface CompiledException {
  id: string;
  line: LineMatcher | null;
  near: LineMatcher | null;
  window: number;
  severity: ExceptionSeverity;
  rationale: string;
}

/**
 * #3412: validate and compile an entry's `exceptions` block. Invalid
 * exceptions are dropped with a message (never thrown), so a malformed
 * workspace override cannot silence an entry by accident: the base finding
 * stays.
 */
export function compileExceptions(raw: unknown, entryId: string): { exceptions: CompiledException[]; errors: string[] } {
  const exceptions: CompiledException[] = [];
  const errors: string[] = [];
  if (raw === undefined || raw === null) return { exceptions, errors };
  if (!Array.isArray(raw)) return { exceptions, errors: [`${entryId}: exceptions must be a list`] };
  for (const item of raw) {
    const r = CatalogueExceptionSchema.safeParse(item);
    if (!r.success) {
      const issue = r.error.issues[0];
      errors.push(`${entryId}: exception ${(issue?.path ?? []).join('.') || ''} ${issue?.message ?? 'invalid'}`.replace(/\s+/g, ' '));
      continue;
    }
    const e = r.data;
    const compile = (src: string | undefined): LineMatcher | null | string => {
      if (src === undefined) return null;
      const c = compileRegexMatcher(src);
      return c.ok ? c.matcher : c.reason;
    };
    const line = compile(e.pattern);
    const near = compile(e.near);
    if (typeof line === 'string' || typeof near === 'string') {
      errors.push(`${entryId}: exception ${e.id} rejected (${typeof line === 'string' ? line : near})`);
      continue;
    }
    exceptions.push({ id: e.id, line, near, window: e.window, severity: e.severity, rationale: e.rationale });
  }
  return { exceptions, errors };
}

/** #3412: the first exception that covers the hit on `lines[idx]`, or null. */
export function findException(
  exceptions: readonly CompiledException[],
  lines: readonly string[],
  idx: number,
): CompiledException | null {
  for (const ex of exceptions) {
    if (ex.line && !ex.line.exec(lines[idx] ?? '')) continue;
    if (ex.near) {
      let found = false;
      const from = Math.max(0, idx - ex.window);
      const to = Math.min(lines.length - 1, idx + ex.window);
      for (let j = from; j <= to && !found; j++) found = ex.near.exec(lines[j] ?? '') !== null;
      if (!found) continue;
    }
    return ex;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Files above this size are data or bundles, not hand-written source (#3410). */
export const MAX_SCAN_FILE_BYTES = 512 * 1024;
/** Lines above this length are minified or embedded data (#3410). */
export const MAX_LINE_LENGTH = 1000;
/** Shortest base64 run that is blanked out before matching (#3410). */
export const BASE64_RUN_MIN = 64;
/** Default cap on collected hits per catalogue entry (#3411). */
export const DEFAULT_MAX_HITS_PER_KEY = 50;

const MAX_PATTERN_LENGTH = 400;

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

const W = 'A-Za-z0-9_';
const A = 'A-Za-z0-9';

// Generic edge guards: a guard only bites when the matched edge character
// itself is a word character, so `crypto.createCipheriv('rc4'` (ends in `'`)
// and `"DESede` (starts with `"`) are unaffected.
const IDENT_LEFT = `(?:(?![${W}])|(?<![${W}]))`;
const IDENT_RIGHT = `(?:(?<![${W}])|(?![${W}]))`;
const CASE_STEP = `(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])`;
const SEG_LEFT = `(?:(?![${A}])|(?<![${A}])|${CASE_STEP})`;
const SEG_RIGHT = `(?:(?<![${A}])|(?![${A}])|${CASE_STEP})`;

function wrap(body: string, mode: MatchMode): string {
  switch (mode) {
    case 'identifier': return `${IDENT_LEFT}(?:${body})${IDENT_RIGHT}`;
    case 'segment': return `${SEG_LEFT}(?:${body})${SEG_RIGHT}`;
    case 'substring': return `(?:${body})`;
    default: {
      const never: never = mode;
      throw new Error(`unknown match mode ${String(never)}`);
    }
  }
}

function escapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function otherCase(ch: string): string {
  const lo = ch.toLowerCase();
  return lo === ch ? ch.toUpperCase() : lo;
}

function isAsciiLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

/**
 * Case-fold a regex source without the `i` flag: letters outside character
 * classes become `[aA]`, letters and letter ranges inside a class gain their
 * other case. Escapes (`\d`, `\s`, `\.`, `ä`, `\p{..}`), group syntax
 * (`(?:`, `(?<name>`) and quantifier braces are copied verbatim.
 */
export function foldCase(src: string): string {
  let out = '';
  let i = 0;
  let inClass = false;
  let classExtra = '';
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === '\\') {
      const next = src[i + 1] ?? '';
      if ((next === 'p' || next === 'P') && src[i + 2] === '{') {
        const end = src.indexOf('}', i);
        const stop = end < 0 ? src.length : end + 1;
        out += src.slice(i, stop); i = stop; continue;
      }
      if (next === 'u' && src[i + 2] === '{') {
        const end = src.indexOf('}', i);
        const stop = end < 0 ? src.length : end + 1;
        out += src.slice(i, stop); i = stop; continue;
      }
      const len = next === 'u' ? 6 : next === 'x' ? 4 : next === 'c' ? 3 : 2;
      out += src.slice(i, i + len); i += len; continue;
    }
    if (inClass) {
      if (ch === ']') { out += classExtra + ']'; inClass = false; classExtra = ''; i++; continue; }
      if (isAsciiLetter(ch) && src[i + 1] === '-' && isAsciiLetter(src[i + 2] ?? '')) {
        const to = src[i + 2] as string;
        out += `${ch}-${to}`;
        if (otherCase(ch) !== ch && otherCase(to) !== to) classExtra += `${otherCase(ch)}-${otherCase(to)}`;
        i += 3; continue;
      }
      out += ch;
      if (isAsciiLetter(ch)) classExtra += otherCase(ch);
      i++; continue;
    }
    if (ch === '[') {
      inClass = true; classExtra = '';
      out += '[';
      i++;
      if (src[i] === '^') { out += '^'; i++; }
      if (src[i] === ']') { out += '\\]'; i++; }
      continue;
    }
    if (ch === '(' && src[i + 1] === '?') {
      // (?:  (?=  (?!  (?<=  (?<!  (?<name>
      if (src[i + 2] === '<' && src[i + 3] !== '=' && src[i + 3] !== '!') {
        const end = src.indexOf('>', i);
        const stop = end < 0 ? src.length : end + 1;
        out += src.slice(i, stop); i = stop; continue;
      }
      const len = src[i + 2] === '<' ? 4 : 3;
      out += src.slice(i, i + len); i += len; continue;
    }
    if (ch === '{') {
      const end = src.indexOf('}', i);
      if (end > 0 && /^\{\d+(,\d*)?\}$/.test(src.slice(i, end + 1))) {
        out += src.slice(i, end + 1); i = end + 1; continue;
      }
    }
    out += isAsciiLetter(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch;
    i++;
  }
  return out;
}

/**
 * Static ReDoS guard for operator-supplied regexes. Rejects nested
 * quantifiers (`(a+)+`, `(\w*)*`, `(x{2,})+`), quantified groups containing
 * an alternation (`(a|ab)*`), backreferences, more than three unbounded
 * wildcards and very long sources. Returns the reason, or null when safe.
 */
export function unsafeRegexReason(src: string): string | null {
  if (src.length > MAX_PATTERN_LENGTH) return `longer than ${MAX_PATTERN_LENGTH} characters`;
  // Single linear pass over the source (no regex over the regex): track per
  // open group whether it holds a quantifier or an alternation, and look at
  // what follows each closing parenthesis.
  const stack: Array<{ quant: boolean; alt: boolean }> = [];
  let unbounded = 0;
  let inClass = false;
  const isQuantAt = (j: number): 'unbounded' | 'bounded' | null => {
    const c = src[j];
    if (c === '*' || c === '+') return 'unbounded';
    if (c === '?') return 'bounded';
    if (c === '{') {
      let k = j + 1;
      let digits = 0;
      while (k < src.length && src[k]! >= '0' && src[k]! <= '9') { k++; digits++; }
      if (digits === 0) return null;
      if (src[k] === '}') return 'bounded';
      if (src[k] !== ',') return null;
      k++;
      let upper = 0;
      while (k < src.length && src[k]! >= '0' && src[k]! <= '9') { k++; upper++; }
      if (src[k] !== '}') return null;
      return upper === 0 ? 'unbounded' : 'bounded';
    }
    return null;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (c === '\\') {
      const n = src[i + 1] ?? '';
      if ((n >= '1' && n <= '9') || n === 'k') return 'backreference';
      i++;
      if (isQuantAt(i + 1) === 'unbounded') unbounded++;
      continue;
    }
    if (inClass) {
      if (c === ']') {
        inClass = false;
        if (isQuantAt(i + 1) === 'unbounded') unbounded++;
      }
      continue;
    }
    if (c === '[') { inClass = true; continue; }
    if (c === '(') {
      stack.push({ quant: false, alt: false });
      // Skip group syntax so its `?` is not read as a quantifier:
      // (?:  (?=  (?!  (?<=  (?<!  (?<name>
      if (src[i + 1] === '?') {
        if (src[i + 2] === '<' && src[i + 3] !== '=' && src[i + 3] !== '!') {
          const end = src.indexOf('>', i);
          i = end < 0 ? src.length : end;
        } else {
          i += src[i + 2] === '<' ? 3 : 2;
        }
      }
      continue;
    }
    if (c === '|') { const top = stack[stack.length - 1]; if (top) top.alt = true; continue; }
    if (c === ')') {
      const g = stack.pop() ?? { quant: false, alt: false };
      const q = isQuantAt(i + 1);
      if (q !== null && g.quant) return 'nested quantifier';
      if (q === 'unbounded' && g.alt) return 'quantified alternation';
      const parent = stack[stack.length - 1];
      if (parent && (g.quant || q !== null)) parent.quant = true;
      continue;
    }
    const q = isQuantAt(i);
    if (q !== null) {
      const top = stack[stack.length - 1];
      if (top) top.quant = true;
      if (q === 'unbounded' && (src[i - 1] === '.' || src[i - 1] === ')')) unbounded++;
      continue;
    }
  }
  if (unbounded > 3) return 'more than three unbounded wildcards';
  return null;
}

export interface TokenRuleOptions {
  /** Default match mode for string tokens (catalogue/entry defaults applied by the caller). */
  match?: MatchMode;
  /** Default case rule for string tokens. */
  caseSensitive?: boolean;
}

/** A compiled matcher for single lines. `exec` returns the first match or null. */
export interface LineMatcher {
  /** Regex source, for diagnostics and tests. */
  readonly source: string;
  exec(line: string): { index: number; text: string } | null;
}

function lineMatcher(source: string): LineMatcher {
  const re = new RegExp(source);
  return {
    source,
    exec(line: string) {
      const m = re.exec(line);
      return m ? { index: m.index, text: m[0] } : null;
    },
  };
}

/**
 * Compile a token list (literals) into one line matcher, or null for an empty
 * list. Tokens sharing a mode and case rule form one alternation, longest
 * first. Literal alternations with lookaround edges are linear; no ReDoS
 * guard is needed.
 */
export function compileTokenMatcher(tokens: readonly CatalogueToken[], opts: TokenRuleOptions = {}): LineMatcher | null {
  const groups = new Map<string, { mode: MatchMode; cs: boolean; lits: string[] }>();
  for (const t of tokens) {
    const tok = typeof t === 'string' ? t : t.token;
    const mode = (typeof t === 'string' ? undefined : t.match) ?? opts.match ?? 'identifier';
    const cs = (typeof t === 'string' ? undefined : t.case_sensitive) ?? opts.caseSensitive ?? false;
    const key = `${mode}|${cs}`;
    let g = groups.get(key);
    if (!g) { g = { mode, cs, lits: [] }; groups.set(key, g); }
    if (!g.lits.includes(tok)) g.lits.push(tok);
  }
  const parts: string[] = [];
  for (const g of groups.values()) {
    const alts = [...g.lits]
      .sort((a, b) => b.length - a.length)
      .map((l) => (g.cs ? escapeLiteral(l) : foldCase(escapeLiteral(l))));
    parts.push(wrap(alts.join('|'), g.mode));
  }
  if (parts.length === 0) return null;
  return lineMatcher(parts.join('|'));
}

export interface RegexRuleOptions {
  /** Boundary applied around the whole pattern. Default `substring` (pattern as authored). */
  match?: MatchMode;
  /** Default false: the pattern is case-folded. */
  caseSensitive?: boolean;
}

export type CompiledRegex = { ok: true; matcher: LineMatcher } | { ok: false; reason: string };

/**
 * Compile an operator-supplied regex through the ReDoS guard. Invalid or
 * unsafe patterns come back as `{ ok: false, reason }` so the pass can
 * report them instead of throwing.
 */
export function compileRegexMatcher(pattern: string, opts: RegexRuleOptions = {}): CompiledRegex {
  const unsafe = unsafeRegexReason(pattern);
  if (unsafe) return { ok: false, reason: unsafe };
  try {
    new RegExp(pattern); // syntax check on the authored form
  } catch (e) {
    return { ok: false, reason: `invalid regex: ${(e as Error).message}` };
  }
  const body = opts.caseSensitive ? pattern : foldCase(pattern);
  try {
    return { ok: true, matcher: lineMatcher(wrap(body, opts.match ?? 'substring')) };
  } catch (e) {
    return { ok: false, reason: `invalid regex after case folding: ${(e as Error).message}` };
  }
}

/** Combine several matchers into one (first match in line order wins). */
export function anyOf(matchers: ReadonlyArray<LineMatcher | null>): LineMatcher | null {
  const list = matchers.filter((m): m is LineMatcher => m !== null);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0] as LineMatcher;
  return {
    source: list.map((m) => m.source).join(' || '),
    exec(line: string) {
      let best: { index: number; text: string } | null = null;
      for (const m of list) {
        const hit = m.exec(line);
        if (hit && (best === null || hit.index < best.index)) best = hit;
      }
      return best;
    },
  };
}

// ---------------------------------------------------------------------------
// Content filtering
// ---------------------------------------------------------------------------

const BASE64_RUN_RE = new RegExp(`[A-Za-z0-9+/]{${BASE64_RUN_MIN},}={0,2}`, 'g');
const DATA_URI_RE = /data:[A-Za-z0-9.+/-]{1,100};base64,[A-Za-z0-9+/=]*/g;

/**
 * Blank out embedded data so it cannot produce a token hit: `data:` URIs and
 * base64 runs of BASE64_RUN_MIN or more characters (a MIME-wrapped PDF line
 * is 76). Replaced by spaces of the same length so match columns stay valid.
 */
export function maskDataContent(line: string): string {
  if (line.length < BASE64_RUN_MIN && !line.includes('data:')) return line;
  return line
    .replace(DATA_URI_RE, (m) => ' '.repeat(m.length))
    .replace(BASE64_RUN_RE, (m) => ' '.repeat(m.length));
}

/** The file-level part of the #3410 content filter. */
export function isScannableFile(f: { isGenerated?: boolean; sizeBytes?: number }): boolean {
  if (f.isGenerated) return false;
  if (f.sizeBytes !== undefined && f.sizeBytes > MAX_SCAN_FILE_BYTES) return false;
  return true;
}

/**
 * Lines of a file prepared for matching: minified (over-long) lines become
 * '' and embedded data is masked. Index i is line i + 1.
 */
export function scanLines(content: string): string[] {
  return content.split('\n').map((l) => (l.length > MAX_LINE_LENGTH ? '' : maskDataContent(l)));
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** #3411: where a hit sits. `unknown` when the file carries no test classification. */
export type PathClass = 'prod' | 'test' | 'unknown';

/** A file the scanner may read (SourceFile from the central source scope fits). */
export interface ScanFile {
  abs: string;
  /** Root-relative path, forward slashes. */
  rel: string;
  isTest?: boolean;
  isGenerated?: boolean;
  sizeBytes?: number;
}

export interface CatalogueHit {
  file: string;
  line: number;
  path_class: PathClass;
  /** Which rule of the key matched (e.g. `token`, `context`, `config_key`). */
  via: string;
  /** The matched text, truncated to 80 characters. */
  match: string;
  /** #3412: the context exception that covers this hit. */
  exception?: { id: string; severity: ExceptionSeverity; rationale: string };
}

export interface ScanRule<K> {
  key: K;
  matcher: LineMatcher;
  /** Rule kind recorded on each hit. */
  via: string;
  /** Restrict the rule to some files (e.g. config_keys only in config files). */
  appliesTo?: (f: ScanFile) => boolean;
  /** Keep the matched text on the hit. Default true; false for env files (values may be secrets). */
  recordMatch?: boolean;
  /** #3412: context exceptions evaluated on every hit of this rule. */
  exceptions?: readonly CompiledException[];
}

export interface ScanOptions {
  /** Hits kept per key (#3411). Default DEFAULT_MAX_HITS_PER_KEY; Infinity keeps all. */
  maxHitsPerKey?: number;
  /** One hit per key per file (the first line). Default false. */
  firstHitPerFile?: boolean;
}

/** #3411: hit counts per path class, including hits beyond the cap. */
export interface ClassCounts {
  prod: number;
  test: number;
  unknown: number;
}

export interface ScanResult<K> {
  hits: Map<K, CatalogueHit[]>;
  /** Total hits per key, including those beyond the cap. */
  totals: Map<K, number>;
  /** #3411: totals split by path class. */
  totalsByClass: Map<K, ClassCounts>;
  /** #3412: hits not covered by a context exception, by path class (beyond the cap too). */
  unexceptedByClass: Map<K, ClassCounts>;
  /** Files read. */
  filesScanned: number;
  /** Files skipped by the content filter (generated or oversized). */
  filesSkipped: number;
}

export function pathClassOf(f: { isTest?: boolean }): PathClass {
  return f.isTest === undefined ? 'unknown' : f.isTest ? 'test' : 'prod';
}

/**
 * Scan files once and test every rule on every prepared line. Each file is
 * read a single time however many catalogue entries there are. Hits come in
 * file order (the source-scope walk order), then line order.
 */
export function scanCatalogueRules<K>(
  files: readonly ScanFile[],
  rules: readonly ScanRule<K>[],
  opts: ScanOptions = {},
): ScanResult<K> {
  const cap = opts.maxHitsPerKey ?? DEFAULT_MAX_HITS_PER_KEY;
  const hits = new Map<K, CatalogueHit[]>();
  const totals = new Map<K, number>();
  const totalsByClass = new Map<K, ClassCounts>();
  const unexceptedByClass = new Map<K, ClassCounts>();
  let filesScanned = 0;
  let filesSkipped = 0;
  if (rules.length === 0) return { hits, totals, totalsByClass, unexceptedByClass, filesScanned, filesSkipped };
  for (const f of files) {
    if (!isScannableFile(f)) { filesSkipped++; continue; }
    const applicable = rules.filter((r) => !r.appliesTo || r.appliesTo(f));
    if (applicable.length === 0) continue;
    let content: string;
    try { content = readFileSync(f.abs, 'utf-8'); } catch { continue; }
    filesScanned++;
    const lines = scanLines(content);
    const pathClass = pathClassOf(f);
    const seenInFile = new Set<K>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      if (line.length === 0) continue;
      const seenOnLine = new Set<K>();
      for (const r of applicable) {
        if (seenOnLine.has(r.key)) continue;
        if (opts.firstHitPerFile && seenInFile.has(r.key)) continue;
        const m = r.matcher.exec(line);
        if (!m) continue;
        seenOnLine.add(r.key);
        seenInFile.add(r.key);
        totals.set(r.key, (totals.get(r.key) ?? 0) + 1);
        let byClass = totalsByClass.get(r.key);
        if (!byClass) { byClass = { prod: 0, test: 0, unknown: 0 }; totalsByClass.set(r.key, byClass); }
        byClass[pathClass]++;
        let list = hits.get(r.key);
        if (!list) { list = []; hits.set(r.key, list); }
        const match = r.recordMatch === false ? '' : m.text.slice(0, 80);
        const hit: CatalogueHit = { file: f.rel, line: i + 1, path_class: pathClass, via: r.via, match };
        const ex = r.exceptions && r.exceptions.length > 0 ? findException(r.exceptions, lines, i) : null;
        if (ex) {
          hit.exception = { id: ex.id, severity: ex.severity, rationale: ex.rationale };
        } else {
          let u = unexceptedByClass.get(r.key);
          if (!u) { u = { prod: 0, test: 0, unknown: 0 }; unexceptedByClass.set(r.key, u); }
          u[pathClass]++;
        }
        if (list.length < cap) {
          list.push(hit);
        } else if (pathClass === 'prod') {
          // #3411: a full list never hides a production hit behind test
          // hits: the most recent non-production hit makes room.
          for (let j = list.length - 1; j >= 0; j--) {
            if ((list[j] as CatalogueHit).path_class !== 'prod') { list.splice(j, 1); list.push(hit); break; }
          }
        }
      }
    }
  }
  return { hits, totals, totalsByClass, unexceptedByClass, filesScanned, filesSkipped };
}

/**
 * #3411: production hits first (walk order kept within each class), then
 * test hits, then unclassified ones. Used for signal evidence, where at most
 * MAX_EVIDENCE_HITS locations are cited.
 */
export function productionFirst(hits: readonly CatalogueHit[]): CatalogueHit[] {
  const rank: Record<PathClass, number> = { prod: 0, unknown: 1, test: 2 };
  return hits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => rank[a.h.path_class] - rank[b.h.path_class] || a.i - b.i)
    .map((x) => x.h);
}

/** #3411: evidence locations cited per signal; the full list goes into the pass YAML. */
export const MAX_EVIDENCE_HITS = 10;

/**
 * #3411: the derivation fragment for a hit list:
 * "4 occurrences (1 production, 3 test)", plus a truncation note when the
 * stored list was capped.
 */
export function occurrenceSummary(total: number, byClass: ClassCounts, stored: number): string {
  const parts = [`${byClass.prod} production`, `${byClass.test} test`];
  if (byClass.unknown > 0) parts.push(`${byClass.unknown} unclassified`);
  const noun = total === 1 ? 'occurrence' : 'occurrences';
  const truncated = stored < total ? ` Hit list truncated at ${stored} of ${total}.` : '';
  return `${total} ${noun} (${parts.join(', ')}).${truncated}`;
}

/** `file:line` evidence string. */
export function hitRef(h: { file: string; line?: number }): string {
  return h.line !== undefined ? `${h.file}:${h.line}` : h.file;
}
