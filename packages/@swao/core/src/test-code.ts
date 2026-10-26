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

// #3403: configurable test-code handling (Design 070 section 2.5, Design 051).
//
// The central source scope (#3428, source-scope.ts) classifies every file it
// walks as test code or not. This module owns what the operator configures on
// top of that classification:
//
//   - the `.swao.yml` setting: `assessment.exclude_test_code` (boolean) or the
//     extended `assessment.test_code: { mode, extra_patterns, keep_patterns }`,
//     resolved app file first, workspace file second (resolveTestCodeSetting);
//   - the extra classification rules: operator glob patterns and test folders
//     declared in build files (pom.xml, Gradle sourceSets, vitest / jest
//     configuration), read from files the scope already walked (no new walk);
//   - the evidence classifier every consumer shares (classifyEvidenceOrigin),
//     used here for the `tag` marker and by #3414 / #3418 for the path class;
//   - the signal marker itself (applyTestCodeMarker).
//
// Modes: `include` (default) analyses everything and changes nothing, so the
// default run is byte-identical to a run without the setting; `tag` analyses
// everything and marks signals whose evidence is test code only (severity one
// step lower, original kept); `exclude` keeps test files away from every pass
// except the secret scan, whose test-code findings are marked, never dropped.

/** Operator-facing setting (`assessment.test_code.mode`). */
export type TestCodeSetting = 'include' | 'tag' | 'exclude';

export const TEST_CODE_SETTINGS: readonly TestCodeSetting[] = ['include', 'tag', 'exclude'];

/** Where the effective setting came from (recorded in the run manifest). */
export type TestCodeSettingSource = 'app' | 'workspace' | 'default';

export interface ResolvedTestCodeSetting {
  mode: TestCodeSetting;
  /** Operator globs classified as test code in addition to the built-in rules. */
  extraPatterns: string[];
  /** Operator globs never classified as test code (wins over every other rule). */
  keepPatterns: string[];
  source: TestCodeSettingSource;
}

export const DEFAULT_TEST_CODE_SETTING: ResolvedTestCodeSetting = {
  mode: 'include',
  extraPatterns: [],
  keepPatterns: [],
  source: 'default',
};

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];
}

function isSetting(v: unknown): v is TestCodeSetting {
  return typeof v === 'string' && (TEST_CODE_SETTINGS as readonly string[]).includes(v);
}

/**
 * The setting one `assessment` block declares, or null when it declares none.
 * `test_code.mode` wins over `exclude_test_code`; the schema refuses the
 * contradictory combination, so the precedence only matters for callers that
 * skip validation.
 */
export function readTestCodeSetting(assessment: unknown): Omit<ResolvedTestCodeSetting, 'source'> | null {
  const a = asRecord(assessment);
  if (!a) return null;
  const tc = asRecord(a['test_code']);
  const extraPatterns = stringList(tc?.['extra_patterns']);
  const keepPatterns = stringList(tc?.['keep_patterns']);
  if (tc && isSetting(tc['mode'])) return { mode: tc['mode'], extraPatterns, keepPatterns };
  if (typeof a['exclude_test_code'] === 'boolean') {
    return { mode: a['exclude_test_code'] ? 'exclude' : 'include', extraPatterns, keepPatterns };
  }
  if (tc && (extraPatterns.length > 0 || keepPatterns.length > 0)) return { mode: 'include', extraPatterns, keepPatterns };
  return null;
}

/**
 * Effective setting for a run: the app `.swao.yml` `assessment` block wins,
 * then the workspace `.swao.yml` (where the Setup Wizard writes it), then the
 * default (`include`). Same app-first, workspace-fallback rule as the LLM
 * provider configuration (#1409).
 */
export function resolveTestCodeSetting(appAssessment: unknown, workspaceAssessment?: unknown): ResolvedTestCodeSetting {
  const app = readTestCodeSetting(appAssessment);
  if (app) return { ...app, source: 'app' };
  const ws = readTestCodeSetting(workspaceAssessment);
  if (ws) return { ...ws, source: 'workspace' };
  return { ...DEFAULT_TEST_CODE_SETTING };
}

/** Listing behaviour of the source scope for a setting (`tag` lists everything, like `include`). */
export function scopeTestCodeMode(mode: TestCodeSetting): 'include' | 'exclude' {
  switch (mode) {
    case 'include': return 'include';
    case 'tag': return 'include';
    case 'exclude': return 'exclude';
    default: {
      const never: never = mode;
      throw new Error(`unknown test-code mode: ${String(never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Glob patterns (operator patterns and build-file includes)
// ---------------------------------------------------------------------------

/** Extended globs (`?(x)`, `+(x)`, `@(x)`, `!(x)`, `*(x)`) are not supported; such patterns are ignored. */
const EXTGLOB_RE = /[?*+@!]\(/;

/**
 * Glob to anchored RegExp on a root-relative, forward-slash path. Supports
 * `**`, `*`, `?` and `{a,b}`. A pattern without a slash matches the base name
 * at any depth (gitignore style); a trailing `/` matches everything below the
 * folder. Returns null for unsupported or empty patterns.
 */
export function globToRegExp(pattern: string): RegExp | null {
  let p = pattern.trim().replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.slice(2);
  if (p.startsWith('/')) p = p.slice(1);
  if (p.length === 0 || EXTGLOB_RE.test(p)) return null;
  if (p.endsWith('/')) p += '**';
  const anyDepth = !p.includes('/');
  let re = '';
  let braceDepth = 0;
  for (let i = 0; i < p.length; i++) {
    const c = p[i] as string;
    if (c === '*') {
      if (p[i + 1] === '*') {
        const slashAfter = p[i + 2] === '/';
        re += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      braceDepth++;
      re += '(?:';
    } else if (c === '}' && braceDepth > 0) {
      braceDepth--;
      re += ')';
    } else if (c === ',' && braceDepth > 0) {
      re += '|';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  if (braceDepth !== 0) return null;
  return new RegExp(`^${anyDepth ? '(?:.*/)?' : ''}${re}$`);
}

/** One extra test-code rule: where it came from and the root-relative glob. */
export interface TestCodeRule {
  /** `assessment.test_code.extra_patterns` or the build file (`service/pom.xml`). */
  source: string;
  pattern: string;
  re: RegExp;
}

function posixJoin(dir: string, sub: string): string | null {
  const parts = (dir ? `${dir}/${sub}` : sub).replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null; // escapes the scope root
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

/** Build-file folder (`src/it/java`) to a root-relative `<dir>/**` rule, or null when unusable. */
function folderRule(source: string, buildRel: string, folder: string): TestCodeRule | null {
  let f = folder.trim().replace(/^\$\{(?:project\.basedir|basedir|projectDir|rootDir)\}\/?/, '');
  if (f.length === 0 || f.includes('${') || f.includes('$') || /^[A-Za-z]:|^\//.test(f)) return null;
  f = f.replace(/^<rootDir>\/?/, '');
  const joined = posixJoin(dirOf(buildRel), trimTrailingSlashes(f));
  if (!joined) return null;
  const pattern = `${joined}/**`;
  const re = globToRegExp(pattern);
  return re ? { source, pattern, re } : null;
}

/** A test-runner include glob (`tests/**\/*.spec.ts`), anchored at the config file's folder. */
function includeRule(source: string, configRel: string, glob: string): TestCodeRule | null {
  let g = glob.trim().replace(/\\/g, '/').replace(/^<rootDir>\/?/, '');
  // Guard: a runner include that does not name tests (`src/**`) would tag production code.
  if (!/(test|spec|e2e|integration)/i.test(g)) return null;
  if (g.startsWith('./')) g = g.slice(2);
  const dir = dirOf(configRel);
  const pattern = dir ? `${dir}/${g}` : g;
  const re = globToRegExp(pattern);
  return re ? { source, pattern, re } : null;
}

/** Text between the `{` at `open` and its matching `}` (exclusive), or null. */
function balancedBlock(text: string, open: number): { inner: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i };
    }
  }
  return null;
}

function quoted(text: string): string[] {
  return [...text.matchAll(/["']([^"'\n]+)["']/g)].map((m) => m[1] as string);
}

/**
 * Removes every `open ... close` span by a linear scan (no regular expression,
 * so build-file input cannot cause backtracking). An unclosed `open` drops the
 * rest of the text, so no `open` token is left behind.
 */
export function stripDelimited(text: string, open: string, close: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const s = text.indexOf(open, i);
    if (s === -1) return out + text.slice(i);
    out += text.slice(i, s);
    const e = text.indexOf(close, s + open.length);
    if (e === -1) return out;
    i = e + close.length;
  }
}

/** Maven: `<testSourceDirectory>` and `<testResources><testResource><directory>`. */
export function mavenTestFolders(pomXml: string): string[] {
  const out: string[] = [];
  const xml = stripDelimited(pomXml, '<!--', '-->');
  out.push(...leafTagValues(xml, 'testSourceDirectory'));
  for (const block of tagContents(xml, 'testResources')) out.push(...leafTagValues(block, 'directory'));
  return out;
}

/** Inner text of every `<tag>...</tag>` (non-nested), by a linear scan. */
export function tagContents(xml: string, tag: string): string[] {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const s = xml.indexOf(open, i);
    if (s === -1) return out;
    const e = xml.indexOf(close, s + open.length);
    if (e === -1) return out;
    out.push(xml.slice(s + open.length, e));
    i = e + close.length;
  }
}

/** Trimmed, non-empty text values of `<tag>value</tag>` that contain no further markup. */
function leafTagValues(xml: string, tag: string): string[] {
  return tagContents(xml, tag).map((v) => v.trim()).filter((v) => v.length > 0 && !v.includes('<'));
}

/** Gradle (Groovy and Kotlin DSL): `srcDir` / `srcDirs` of every source set whose name contains `test`. */
export function gradleTestFolders(buildGradle: string): string[] {
  const text = stripDelimited(buildGradle, '/*', '*/').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const out: string[] = [];
  for (const m of text.matchAll(/\bsourceSets\s*\{/g)) {
    const block = balancedBlock(text, (m.index ?? 0) + m[0].length - 1);
    if (!block) continue;
    const inner = block.inner;
    // Direct children of sourceSets { ... }: `name {`, `named("name") {`, `create("name") {`, ...
    let depth = 0;
    let headerStart = 0;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '{' && depth === 0) {
        const header = inner.slice(headerStart, i);
        const child = balancedBlock(inner, i);
        if (!child) break;
        const name = /(?:named|create|register|getByName|maybeCreate)\s*\(\s*["'](\w+)["']/.exec(header)?.[1]
          ?? /(\w+)\s*$/.exec(header.trim())?.[1] ?? '';
        if (/test/i.test(name)) {
          for (const d of child.inner.matchAll(/\b(?:srcDirs?|setSrcDirs)\b([^\n]*)/g)) out.push(...quoted(d[1] as string));
        }
        i = child.end;
        headerStart = i + 1;
        continue;
      }
      if (c === '\n' || c === ';') headerStart = i + 1;
    }
  }
  return out;
}

/** vitest / vite: `include` globs, ignoring the `coverage` block (which lists production files). */
export function vitestIncludeGlobs(config: string): string[] {
  let text = config;
  for (;;) {
    const m = /\bcoverage\s*:\s*\{/.exec(text);
    if (!m) break;
    const block = balancedBlock(text, (m.index ?? 0) + m[0].length - 1);
    if (!block) break;
    text = text.slice(0, m.index) + text.slice(block.end + 1);
  }
  const out: string[] = [];
  for (const m of text.matchAll(/\binclude\s*:\s*\[([^\]]*)\]/g)) out.push(...quoted(m[1] as string));
  return out;
}

/** jest: `testMatch` globs (JS / TS config, jest.config.json, or package.json `jest`). */
export function jestTestMatchGlobs(config: string, isPackageJson: boolean): string[] {
  if (isPackageJson) {
    try {
      const pkg = JSON.parse(config) as Record<string, unknown>;
      return stringList(asRecord(pkg['jest'])?.['testMatch']);
    } catch { return []; }
  }
  const out: string[] = [];
  for (const m of config.matchAll(/["']?\btestMatch["']?\s*:\s*\[([^\]]*)\]/g)) out.push(...quoted(m[1] as string));
  return out;
}

const VITEST_CONFIG_RE = /^(vitest|vite)\.config\.[cm]?[jt]s$/;
const JEST_CONFIG_RE = /^jest\.config\.([cm]?[jt]s|json)$/;

/** Is this base name a build file the test-folder detection reads? */
export function isTestRuleBuildFile(name: string): boolean {
  return name === 'pom.xml' || name === 'build.gradle' || name === 'build.gradle.kts'
    || VITEST_CONFIG_RE.test(name) || JEST_CONFIG_RE.test(name) || name === 'package.json';
}

/**
 * Test-code rules declared by one build file (root-relative `rel`, its text).
 * pom.xml: testSourceDirectory + testResources; Gradle: test source sets;
 * vitest / vite: test.include; jest: testMatch (also package.json `jest`).
 */
export function testRulesFromBuildFile(rel: string, name: string, text: string): TestCodeRule[] {
  const rules: TestCodeRule[] = [];
  const push = (r: TestCodeRule | null): void => { if (r && !rules.some((x) => x.pattern === r.pattern)) rules.push(r); };
  if (name === 'pom.xml') {
    for (const f of mavenTestFolders(text)) push(folderRule(rel, rel, f));
  } else if (name === 'build.gradle' || name === 'build.gradle.kts') {
    for (const f of gradleTestFolders(text)) push(folderRule(rel, rel, f));
  } else if (VITEST_CONFIG_RE.test(name)) {
    for (const g of vitestIncludeGlobs(text)) push(includeRule(rel, rel, g));
  } else if (JEST_CONFIG_RE.test(name) || name === 'package.json') {
    for (const g of jestTestMatchGlobs(text, name.endsWith('.json'))) push(includeRule(rel, rel, g));
  }
  return rules;
}

/** Operator patterns to rules (unsupported patterns are dropped). */
export function rulesFromPatterns(source: string, patterns: readonly string[]): TestCodeRule[] {
  const out: TestCodeRule[] = [];
  for (const pattern of patterns) {
    const re = globToRegExp(pattern);
    if (re) out.push({ source, pattern, re });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evidence classification and the signal marker
// ---------------------------------------------------------------------------

/** Where a signal's file evidence lives (#3414 path class, #3418 evidence kind). */
export type EvidenceOrigin = 'test' | 'production' | 'mixed' | 'none';

const PATHISH_EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,9}$/;

const LEADING_PUNCT = new Set(['(', '"', "'", '`', '[', '<']);
const TRAILING_PUNCT = new Set([')', '"', "'", '`', ']', ',', ';', '>', '.']);

/** Trims leading and trailing wrapper punctuation by index (linear, no regular expression). */
function trimPunctuation(t: string): string {
  let s = 0;
  let e = t.length;
  while (s < e && LEADING_PUNCT.has(t[s] as string)) s++;
  while (e > s && TRAILING_PUNCT.has(t[e - 1] as string)) e--;
  return t.slice(s, e);
}

const isDigit = (c: number): boolean => c >= 48 && c <= 57;

/**
 * Strips a trailing line reference such as `:12`, `:12:5` or `:12-20` (one or
 * more `:N`, each optionally followed by `-N` or `:N`) by scanning back from
 * the end; the suffix must start with `:`. Linear, unlike the regular
 * expression it replaces (js/redos).
 */
export function stripLineSuffix(t: string): string {
  let i = t.length;
  let cut = t.length;
  for (;;) {
    let j = i;
    while (j > 0 && isDigit(t.charCodeAt(j - 1))) j--;
    if (j === i || j === 0) break;
    const sep = t[j - 1];
    if (sep !== ':' && sep !== '-') break;
    i = j - 1;
    if (sep === ':') cut = i;
  }
  return t.slice(0, cut);
}

function trimTrailingSlashes(t: string): string {
  let e = t.length;
  while (e > 0 && t[e - 1] === '/') e--;
  return t.slice(0, e);
}

function normaliseCandidate(token: string, sourceRoot: string | undefined): string | null {
  let t = stripLineSuffix(trimPunctuation(token.trim())).replace(/\\/g, '/');
  t = t.replace(/:$/, '');
  if (t.length === 0) return null;
  if (sourceRoot) {
    const root = trimTrailingSlashes(sourceRoot.replace(/\\/g, '/'));
    if (root && t.toLowerCase().startsWith(`${root.toLowerCase()}/`)) t = t.slice(root.length + 1);
  }
  if (t.startsWith('./')) t = t.slice(2);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return null; // URL, not a file
  if (!t.includes('/') && !PATHISH_EXT_RE.test(t)) return null;
  return t;
}

/**
 * File paths cited by one evidence string. Handles `file`, `file:line`,
 * `rule: file:line` (Gitleaks MAL-03), `package.json (express: 4.1.2)`,
 * backslashes and absolute paths under `sourceRoot` (made relative).
 */
export function evidencePaths(evidence: string, sourceRoot?: string): string[] {
  const whole = evidence.trim();
  if (whole.length === 0) return [];
  if (!/\s/.test(whole)) {
    const p = normaliseCandidate(whole, sourceRoot);
    return p ? [p] : [];
  }
  const out: string[] = [];
  for (const token of whole.split(/\s+/)) {
    const p = normaliseCandidate(token, sourceRoot);
    if (p) out.push(p);
  }
  return out;
}

/** Classify a signal's evidence list with a test-path predicate (the scope's classifier). */
export function classifyEvidenceOrigin(
  evidence: readonly string[],
  isTest: (rel: string) => boolean,
  sourceRoot?: string,
): EvidenceOrigin {
  let test = 0;
  let prod = 0;
  for (const e of evidence) {
    for (const p of evidencePaths(e, sourceRoot)) {
      if (isTest(p)) test++; else prod++;
    }
  }
  if (test === 0 && prod === 0) return 'none';
  if (prod === 0) return 'test';
  if (test === 0) return 'production';
  return 'mixed';
}

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'informational' | 'positive';

/** One step down the severity ladder; informational and positive stay. */
export function lowerSeverity(sev: Severity): Severity {
  switch (sev) {
    case 'critical': return 'high';
    case 'high': return 'medium';
    case 'medium': return 'low';
    case 'low': return 'informational';
    case 'informational': return 'informational';
    case 'positive': return 'positive';
    default: {
      const never: never = sev;
      return never;
    }
  }
}

/**
 * Secret-scan findings (Gitleaks MAL-03) are never dropped and never
 * down-graded: a password in test code stays a finding (#3403 rule 7).
 */
export const SECRET_SIGNAL_IDS: ReadonlySet<string> = new Set(['MAL-03']);

/** The marker fields #3403 adds to a signal (see SignalSchema). */
export interface TestCodeMarkedSignal {
  id: string;
  severity?: Severity;
  evidence: string[];
  test_code?: boolean;
  severity_original?: Severity;
}

export interface TestCodeMarkerResult<S> {
  signals: S[];
  /** Signals marked `test_code: true`. */
  tagged: number;
  /** Of tagged: severity lowered (tag mode, non-secret). */
  lowered: number;
}

/**
 * Mark signals whose file evidence is test code only.
 *   include: unchanged (same array, no field written: byte-identical default);
 *   tag:     `test_code: true`, severity one step lower, `severity_original` kept;
 *            secret findings are marked but keep their severity;
 *   exclude: `test_code: true` only (what still cites test code here is the
 *            secret scan, exempt from the exclusion).
 */
export function applyTestCodeMarker<S extends TestCodeMarkedSignal>(
  signals: S[],
  mode: TestCodeSetting,
  isTest: (rel: string) => boolean,
  sourceRoot?: string,
): TestCodeMarkerResult<S> {
  switch (mode) {
    case 'include':
      return { signals, tagged: 0, lowered: 0 };
    case 'tag':
    case 'exclude': {
      let tagged = 0;
      let lowered = 0;
      const out = signals.map((s) => {
        if (classifyEvidenceOrigin(s.evidence, isTest, sourceRoot) !== 'test') return s;
        tagged++;
        const lower = mode === 'tag' && !SECRET_SIGNAL_IDS.has(s.id) && s.severity !== undefined
          && lowerSeverity(s.severity) !== s.severity;
        if (!lower || s.severity === undefined) return { ...s, test_code: true };
        lowered++;
        return { ...s, test_code: true, severity: lowerSeverity(s.severity), severity_original: s.severity };
      });
      return { signals: out, tagged, lowered };
    }
    default: {
      const never: never = mode;
      throw new Error(`unknown test-code mode: ${String(never)}`);
    }
  }
}
