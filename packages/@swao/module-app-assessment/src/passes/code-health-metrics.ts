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

// #3405: deterministic per-file code metrics for Pass 26 (code health),
// Design 117 section 4. Pure functions over file text: no file system access,
// no clock, no locale. Built-in proxies, no external tool:
//
//   - NLOC: non-blank lines that are not only comment;
//   - decision points: branch keywords and short-circuit operators in code
//     with comments and string literals blanked (a cyclomatic-complexity
//     proxy: sum over the file of the per-function decision count);
//   - max nesting: brace depth (C-family) or indentation depth (Python);
//   - duplication: 6-line windows of normalised code shared with another
//     place (a clone-detection proxy, cf. jscpd / PMD CPD minimum tokens);
//   - TODO / FIXME / HACK / XXX markers.
//
// Every scan is a single left-to-right pass over the text (linear).

import { createHash } from 'node:crypto';

export type CommentFamily = 'c' | 'hash' | 'sql' | 'vb';

export interface LanguageInfo {
  language: string;
  family: CommentFamily;
  /** Python-style nesting by indentation instead of braces. */
  indentNesting: boolean;
}

/** Code extensions Pass 26 measures (lower-cased, with the dot). Configuration files only feed the endpoint scan. */
export const CODE_LANGUAGES: Readonly<Record<string, LanguageInfo>> = {
  '.java': { language: 'Java', family: 'c', indentNesting: false },
  '.kt': { language: 'Kotlin', family: 'c', indentNesting: false },
  '.kts': { language: 'Kotlin', family: 'c', indentNesting: false },
  '.groovy': { language: 'Groovy', family: 'c', indentNesting: false },
  '.scala': { language: 'Scala', family: 'c', indentNesting: false },
  '.ts': { language: 'TypeScript', family: 'c', indentNesting: false },
  '.tsx': { language: 'TypeScript', family: 'c', indentNesting: false },
  '.js': { language: 'JavaScript', family: 'c', indentNesting: false },
  '.jsx': { language: 'JavaScript', family: 'c', indentNesting: false },
  '.mjs': { language: 'JavaScript', family: 'c', indentNesting: false },
  '.cjs': { language: 'JavaScript', family: 'c', indentNesting: false },
  '.vue': { language: 'Vue', family: 'c', indentNesting: false },
  '.svelte': { language: 'Svelte', family: 'c', indentNesting: false },
  '.go': { language: 'Go', family: 'c', indentNesting: false },
  '.cs': { language: 'C#', family: 'c', indentNesting: false },
  '.c': { language: 'C', family: 'c', indentNesting: false },
  '.h': { language: 'C', family: 'c', indentNesting: false },
  '.cc': { language: 'C++', family: 'c', indentNesting: false },
  '.cpp': { language: 'C++', family: 'c', indentNesting: false },
  '.hpp': { language: 'C++', family: 'c', indentNesting: false },
  '.rs': { language: 'Rust', family: 'c', indentNesting: false },
  '.swift': { language: 'Swift', family: 'c', indentNesting: false },
  '.php': { language: 'PHP', family: 'c', indentNesting: false },
  '.py': { language: 'Python', family: 'hash', indentNesting: true },
  '.rb': { language: 'Ruby', family: 'hash', indentNesting: false },
  '.sh': { language: 'Shell', family: 'hash', indentNesting: false },
  '.bash': { language: 'Shell', family: 'hash', indentNesting: false },
  '.ps1': { language: 'PowerShell', family: 'hash', indentNesting: false },
  '.psm1': { language: 'PowerShell', family: 'hash', indentNesting: false },
  '.sql': { language: 'SQL', family: 'sql', indentNesting: false },
  '.vb': { language: 'VB.NET', family: 'vb', indentNesting: false },
};

/** Duplication window: this many consecutive significant code lines. */
export const DUPLICATION_WINDOW = 6;
/** Normalised lines shorter than this are not significant (braces, `else`, `return;`). */
const MIN_SIGNIFICANT_LINE = 8;
const TRIVIAL_LINE_RE = /^(import|package|using|from|#include|require\(|export \{|@Override|\}|\{|\)|\]|end|fi|done|else)\b/;

const C_DECISION_RE = /\b(?:if|for|foreach|while|case|catch|when|elif|except)\b|&&|\|\|/g;
const SCRIPT_DECISION_RE = /\b(?:if|elif|elsif|unless|for|while|until|case|when|except|rescue|and|or|catch)\b/g;
const SQL_DECISION_RE = /\b(?:CASE|WHEN|IF|WHILE|LOOP|EXCEPTION)\b/gi;
const MARKER_RE = /\b(?:TODO|FIXME|HACK|XXX)\b/g;

export interface StrippedLine {
  /** Code with comments removed and string-literal contents blanked. */
  code: string;
  /** The line held comment text (for NLOC: a comment-only line has empty code). */
  hadComment: boolean;
}

/**
 * Strip comments and blank string contents, line by line, carrying block
 * comment / multi-line string state across lines. One pass per character.
 */
export function stripCode(lines: readonly string[], family: CommentFamily, indentNesting: boolean): StrippedLine[] {
  const out: StrippedLine[] = [];
  let inBlock = false; // C-family / SQL block comment
  let inString: string | null = null; // open multi-line string delimiter (` or ''' / """)
  for (const line of lines) {
    let code = '';
    let hadComment = false;
    let i = 0;
    const n = line.length;
    while (i < n) {
      const ch = line[i] as string;
      const next = i + 1 < n ? (line[i + 1] as string) : '';
      if (inBlock) {
        hadComment = true;
        if (ch === '*' && next === '/') { inBlock = false; i += 2; continue; }
        i++;
        continue;
      }
      if (inString !== null) {
        if (inString.length === 3) {
          if (line.startsWith(inString, i)) { code += inString; inString = null; i += 3; continue; }
        } else if (ch === '\\') { i += 2; continue; } else if (ch === inString) { code += ch; inString = null; i++; continue; }
        i++;
        continue;
      }
      if ((family === 'c' || family === 'sql') && ch === '/' && next === '*') { inBlock = true; hadComment = true; i += 2; continue; }
      if (family === 'c' && ch === '/' && next === '/') { hadComment = true; break; }
      if (family === 'hash' && ch === '#') { hadComment = true; break; }
      if (family === 'sql' && ch === '-' && next === '-') { hadComment = true; break; }
      if (family === 'vb' && ch === "'") { hadComment = true; break; }
      if (indentNesting && (line.startsWith('"""', i) || line.startsWith("'''", i))) {
        const delim = line.slice(i, i + 3);
        code += delim;
        inString = delim;
        i += 3;
        continue;
      }
      if (ch === '"' || (ch === "'" && family !== 'vb') || (ch === '`' && family === 'c')) {
        code += ch;
        // Backtick template literals may span lines; quotes close on the line.
        let j = i + 1;
        let closed = false;
        while (j < n) {
          const cj = line[j] as string;
          if (cj === '\\') { j += 2; continue; }
          if (cj === ch) { closed = true; break; }
          j++;
        }
        if (closed) { code += ch; i = j + 1; continue; }
        if (ch === '`') { inString = '`'; }
        i = n;
        continue;
      }
      code += ch;
      i++;
    }
    out.push({ code, hadComment });
  }
  return out;
}

export interface FileMetrics {
  /** Physical lines. */
  lines: number;
  /** Non-blank, non-comment-only lines. */
  nloc: number;
  decisionPoints: number;
  maxNesting: number;
  /** 1-based line where maxNesting is first reached (0 when no code). */
  maxNestingLine: number;
  markers: number;
  /** 1-based line of the first marker (0 when none). */
  firstMarkerLine: number;
  /** Normalised significant code lines with their 1-based line numbers (duplication input). */
  significant: Array<{ line: number; text: string }>;
}

export function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

/** Metrics of one code file. */
export function measureFile(content: string, lang: LanguageInfo): FileMetrics {
  const lines = splitLines(content);
  const stripped = stripCode(lines, lang.family, lang.indentNesting);
  const decisionRe = lang.family === 'c' ? C_DECISION_RE : lang.family === 'sql' ? SQL_DECISION_RE : SCRIPT_DECISION_RE;
  let nloc = 0;
  let decisions = 0;
  let depth = 0;
  let maxNesting = 0;
  let maxNestingLine = 0;
  let markers = 0;
  let firstMarkerLine = 0;
  const significant: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    const s = stripped[i] as StrippedLine;
    MARKER_RE.lastIndex = 0;
    const markerHits = raw.match(MARKER_RE);
    if (markerHits && s.hadComment) {
      markers += markerHits.length;
      if (firstMarkerLine === 0) firstMarkerLine = i + 1;
    }
    const code = s.code.trim();
    if (code.length === 0) continue;
    nloc++;
    decisionRe.lastIndex = 0;
    const d = code.match(decisionRe);
    if (d) decisions += d.length;
    if (lang.indentNesting) {
      const indent = /^[ \t]*/.exec(s.code)?.[0] ?? '';
      let width = 0;
      for (const c of indent) width += c === '\t' ? 4 : 1;
      const level = Math.floor(width / 4);
      if (level > maxNesting) { maxNesting = level; maxNestingLine = i + 1; }
    } else if (lang.family === 'c') {
      for (const c of s.code) {
        if (c === '{') {
          depth++;
          if (depth > maxNesting) { maxNesting = depth; maxNestingLine = i + 1; }
        } else if (c === '}') {
          depth = Math.max(0, depth - 1);
        }
      }
    }
    const norm = code.replace(/\s+/g, ' ');
    if (norm.length >= MIN_SIGNIFICANT_LINE && !TRIVIAL_LINE_RE.test(norm)) significant.push({ line: i + 1, text: norm });
  }
  // Brace nesting counts the class / namespace body as level 1; report the
  // depth inside it so a flat method body in a class reads 1, not 2.
  const nesting = lang.family === 'c' && !lang.indentNesting ? Math.max(0, maxNesting - 1) : maxNesting;
  return { lines: lines.length, nloc, decisionPoints: decisions, maxNesting: nesting, maxNestingLine, markers, firstMarkerLine, significant };
}

export interface DuplicationResult {
  /** Per file: number of significant lines inside a window that occurs at least twice. */
  duplicatedLines: Map<string, number>;
  /** Per file: 1-based line of the first duplicated window (evidence). */
  firstDuplicateLine: Map<string, number>;
  /** Distinct duplicated windows (clone groups). */
  cloneGroups: number;
}

/**
 * Clone-detection proxy: every DUPLICATION_WINDOW consecutive significant
 * lines form a window, keyed by a SHA-1 of the normalised text. A window that
 * occurs twice or more (in the same or another file) marks all its lines as
 * duplicated in every occurrence. Files are processed in the given order,
 * which the caller sorts by path, so the result is deterministic.
 */
export function detectDuplication(files: ReadonlyArray<{ rel: string; significant: ReadonlyArray<{ line: number; text: string }> }>): DuplicationResult {
  const occurrences = new Map<string, Array<{ rel: string; idx: number }>>();
  for (const f of files) {
    const sig = f.significant;
    for (let i = 0; i + DUPLICATION_WINDOW <= sig.length; i++) {
      const h = createHash('sha1');
      for (let k = 0; k < DUPLICATION_WINDOW; k++) { h.update((sig[i + k] as { text: string }).text); h.update('\n'); }
      const key = h.digest('hex');
      const list = occurrences.get(key);
      if (list) list.push({ rel: f.rel, idx: i }); else occurrences.set(key, [{ rel: f.rel, idx: i }]);
    }
  }
  const dupIdx = new Map<string, Set<number>>();
  let cloneGroups = 0;
  for (const list of occurrences.values()) {
    if (list.length < 2) continue;
    cloneGroups++;
    for (const o of list) {
      let set = dupIdx.get(o.rel);
      if (!set) { set = new Set(); dupIdx.set(o.rel, set); }
      for (let k = 0; k < DUPLICATION_WINDOW; k++) set.add(o.idx + k);
    }
  }
  const duplicatedLines = new Map<string, number>();
  const firstDuplicateLine = new Map<string, number>();
  const byRel = new Map(files.map((f) => [f.rel, f.significant]));
  for (const [rel, set] of dupIdx) {
    duplicatedLines.set(rel, set.size);
    let first = Number.POSITIVE_INFINITY;
    for (const idx of set) if (idx < first) first = idx;
    firstDuplicateLine.set(rel, byRel.get(rel)?.[first]?.line ?? 1);
  }
  return { duplicatedLines, firstDuplicateLine, cloneGroups };
}

// ---------------------------------------------------------------------------
// Scores (Design 117 section 5). Weights and thresholds are PROVISIONAL until
// the owner confirms them (issue #3405 spec tightening item 2).
// ---------------------------------------------------------------------------

export const CODE_HEALTH_WEIGHTS = {
  complexity: 0.30,
  size: 0.25,
  duplication: 0.20,
  endpoints: 0.15,
  markers: 0.10,
} as const;

export const CODE_HEALTH_THRESHOLDS = {
  /** NLOC at which the size component starts (0) and saturates (100). */
  sizeStartNloc: 200,
  sizeFullNloc: 1000,
  /** A file above this NLOC is a bulky file (QUAL-03). */
  bulkyNloc: 1000,
  /** Decision points at which the complexity component saturates. */
  complexityFullDecisions: 150,
  /** Nesting depth from which the complexity component rises 20 points per level. */
  nestingStart: 3,
  /** Component points per hard-coded IP / URL / marker. */
  pointsPerIp: 20,
  pointsPerUrl: 10,
  pointsPerMarker: 10,
  /** A file whose complexity component reaches this is a complexity hotspot (QUAL-02). */
  complexityHotspot: 70,
  /** A file whose composite score reaches this counts as a maintainability hotspot. */
  hotspotScore: 50,
  /** Decision points per 100 NLOC that the complexity KPI tolerates. */
  densityTolerance: 15,
} as const;

export function clamp100(v: number): number {
  return Math.min(100, Math.max(0, v));
}

export interface FileComponents {
  complexity: number;
  size: number;
  duplication: number;
  endpoints: number;
  markers: number;
}

export function fileComponents(m: { nloc: number; decisionPoints: number; maxNesting: number; duplicatedLines: number; ips: number; urls: number; markers: number }): FileComponents {
  const t = CODE_HEALTH_THRESHOLDS;
  const complexity = clamp100(Math.max(
    (m.decisionPoints * 100) / t.complexityFullDecisions,
    (m.maxNesting - t.nestingStart) * 20,
  ));
  const size = clamp100(((m.nloc - t.sizeStartNloc) * 100) / (t.sizeFullNloc - t.sizeStartNloc));
  const duplication = m.nloc > 0 ? clamp100((m.duplicatedLines * 100) / m.nloc) : 0;
  const endpoints = clamp100(m.ips * t.pointsPerIp + m.urls * t.pointsPerUrl);
  const markers = clamp100(m.markers * t.pointsPerMarker);
  const r = (v: number) => Math.round(v);
  return { complexity: r(complexity), size: r(size), duplication: r(duplication), endpoints: r(endpoints), markers: r(markers) };
}

/** Composite worklist score 0..100 (higher = more urgent). */
export function fileScore(c: FileComponents): number {
  const w = CODE_HEALTH_WEIGHTS;
  return Math.round(c.complexity * w.complexity + c.size * w.size + c.duplication * w.duplication + c.endpoints * w.endpoints + c.markers * w.markers);
}

export interface AppTotals {
  nloc: number;
  decisionPoints: number;
  duplicatedLines: number;
  ips: number;
  urls: number;
  markers: number;
  /** NLOC in files with fileScore >= hotspotScore or nloc > bulkyNloc. */
  hotspotNloc: number;
}

export interface CodeHealthKpis {
  complexity: number;
  maintainability: number;
  duplication: number;
  configuration_hygiene: number;
  overall: number;
}

/** App KPIs 0..100 (higher = healthier); null when there is no production code. */
export function appKpis(t: AppTotals): CodeHealthKpis | null {
  if (t.nloc <= 0) return null;
  const th = CODE_HEALTH_THRESHOLDS;
  const kloc = Math.max(1, t.nloc / 1000);
  const density = (t.decisionPoints * 100) / t.nloc;
  const complexity = clamp100(100 - Math.max(0, density - th.densityTolerance) * 4);
  const markerPenalty = Math.min(20, (t.markers / kloc) * 2);
  const maintainability = clamp100(100 - (t.hotspotNloc * 100) / t.nloc - markerPenalty);
  const duplication = clamp100(100 - ((t.duplicatedLines * 100) / t.nloc) * 2);
  const hygiene = clamp100(100 - (10 * (t.urls + 2 * t.ips)) / kloc);
  const r = (v: number) => Math.round(v);
  const k = { complexity: r(complexity), maintainability: r(maintainability), duplication: r(duplication), configuration_hygiene: r(hygiene) };
  return { ...k, overall: r((k.complexity + k.maintainability + k.duplication + k.configuration_hygiene) / 4) };
}

// ---------------------------------------------------------------------------
// Owner (Design 117 section 6): CODEOWNERS, last matching rule wins.
// ---------------------------------------------------------------------------

export interface CodeOwnersRule { pattern: string; owners: string[]; re: RegExp }

function globToRegExp(pattern: string): RegExp {
  let p = pattern;
  const anchored = p.startsWith('/') || p.slice(0, -1).includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i] as string;
    if (ch === '*') {
      if (p[i + 1] === '*') {
        re += '.*';
        i++;
        if (p[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  re = re.replace(/(?:\.\*)+/g, '.*');
  const prefix = anchored ? '^' : '^(?:.*/)?';
  // A pattern matches the path itself or anything below it (directory rule).
  return new RegExp(`${prefix}${re}(?:/.*)?$`);
}

/** Parse a CODEOWNERS file (GitHub / GitLab syntax; GitLab `[Section]` headers are ignored). */
export function parseCodeOwners(text: string): CodeOwnersRule[] {
  const rules: CodeOwnersRule[] = [];
  for (const rawLine of splitLines(text)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('[') || line.startsWith('^[')) continue;
    const parts = line.split(/\s+/);
    const pattern = parts[0] as string;
    if (pattern.length > 500) continue;
    const owners = parts.slice(1).filter((o) => !o.startsWith('#'));
    rules.push({ pattern, owners, re: globToRegExp(pattern) });
  }
  return rules;
}

/** Owners of a root-relative path (forward slashes): the last matching rule wins; null when none matches or the rule has no owner. */
export function ownerOf(rel: string, rules: readonly CodeOwnersRule[]): string | null {
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i] as CodeOwnersRule;
    if (r.re.test(rel)) return r.owners.length > 0 ? r.owners.join(' ') : null;
  }
  return null;
}
