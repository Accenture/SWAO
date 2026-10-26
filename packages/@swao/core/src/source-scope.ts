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

// #3428: central source scope. One walker, one canonical skip set, one test
// classification for every assessment pass (Design 070 section 2.5).
//
// Before #3428 every pass walked the source tree on its own, with at least
// nine different skip sets: some passes scanned `target/` build output or
// `.git/`, none knew which files were test code. This module is the single
// place that decides which files under the resolved source path (which
// already honours `vcs.subdir`, #3404) a pass may read:
//
//   - listSourceFiles(root, opts) -- the filtered view a pass consumes;
//   - getSourceScope(root)        -- the underlying walk (memoised per run);
//   - beginSourceScopeRun() / endSourceScopeRun() -- run boundary set by
//     `swao assess`; outside a run every call walks afresh, so unit tests
//     that mutate fixtures never see a stale listing;
//   - listInputFiles(root, opts)  -- sibling walker for operator-curated
//     input folders (wsp/inputs/), which are never filtered by the source
//     skip set.
//
// Test files are TAGGED (`isTest`), never dropped by default. #3403 adds the
// `.swao.yml` switch (assessment.exclude_test_code / assessment.test_code,
// test-code.ts): `swao assess` passes the resolved setting to
// beginSourceScopeRun(), so every pass inherits it without a per-call option;
// `purpose: 'secrets'` ignores an exclude request so a password in test code
// stays a finding. #3403 also extends the classification with operator
// patterns (extra / keep) and test folders declared in build files (pom.xml,
// Gradle sourceSets, vitest / jest), read from files this walk already found.
//
// The audit gate tests/audit-gates/source-scope-single-walker.gate.mjs fails
// on a new raw directory walker in pass code.

import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { isTestRuleBuildFile, rulesFromPatterns, testRulesFromBuildFile, type TestCodeRule } from './test-code.js';

/** What a pass reads the files for. Drives hidden-file and test-code defaults. */
export type SourcePurpose = 'code' | 'config' | 'manifest' | 'docs' | 'secrets';

/**
 * Listing behaviour for test files: `include` lists them tagged; `exclude`
 * drops them (never for `secrets`). The operator setting `tag` lists like
 * `include` (see scopeTestCodeMode in test-code.ts).
 */
export type TestCodeMode = 'include' | 'exclude';

/** #3403: classification options of one walk (fixed for its lifetime). */
export interface SourceScopeOptions {
  /** Operator globs classified as test code (`assessment.test_code.extra_patterns`). */
  extraTestPatterns?: readonly string[];
  /** Operator globs never classified as test code (`assessment.test_code.keep_patterns`). */
  keepPatterns?: readonly string[];
  /** Read test folders from pom.xml / Gradle / vitest / jest files in the walk. Default true. */
  detectBuildFileTestFolders?: boolean;
}

/** #3403: run-wide settings handed to beginSourceScopeRun by `swao assess`. */
export interface SourceScopeRunOptions extends SourceScopeOptions {
  /** Default listing behaviour for every listSourceFiles call without its own `testCode`. */
  testCode?: TestCodeMode;
}

export interface SourceFile {
  /** path.join(root, ...) with the root as passed in (native separators). */
  abs: string;
  /** Path relative to the scope root, forward slashes. */
  rel: string;
  /** Base name. */
  name: string;
  /** Lower-cased extension including the dot (`.ts`), '' when none. */
  ext: string;
  /** Number of directory segments between the root and the file (root files = 0). */
  depth: number;
  /** Test code per the built-in path rules (isTestPath). */
  isTest: boolean;
  /** Generated or minified artefact per isGeneratedPath (tagged only, never dropped). */
  isGenerated: boolean;
  /** Dot-file (`.env.example`, `.eslintrc.js`). Dot-directories are never walked. */
  isHidden: boolean;
  sizeBytes: number;
}

export interface ListSourceFilesOptions {
  purpose: SourcePurpose;
  /** Lower-cased extensions with the dot. Absent = every extension. */
  extensions?: Iterable<string>;
  /** Keep files whose `depth` is <= maxDepth (same meaning as the old `walk(root, 0)` depth guards). */
  maxDepth?: number;
  /** Cap on returned files, applied after the other filters, in walk order. */
  maxFiles?: number;
  /** Include dot-files. Default: true for `secrets`, false otherwise. */
  includeHidden?: boolean;
  /** Default: the run's setting (beginSourceScopeRun), else `include`. */
  testCode?: TestCodeMode;
}

export interface SourceScopeSummary {
  /** Absolute root the scope was walked from. */
  root: string;
  /** Non-hidden files in scope (what a default listSourceFiles call sees). */
  files_scanned: number;
  /** Of files_scanned: classified as test code. */
  files_test: number;
  /** Of files_scanned: generated or minified. */
  files_generated: number;
  /** Dot-files in scope (listed only on request). */
  files_hidden: number;
  /** Directories not descended into (canonical skip set, dot-directories, build-output bin/). */
  dirs_excluded: number;
  /** dirs_excluded by directory name, for the report (e.g. node_modules: 3, .git: 1). */
  excluded_dir_names: Record<string, number>;
  /** Symbolic links and junctions, never followed (keeps the scope inside its root). */
  symlinks_skipped: number;
  /** True when the walk hit SOURCE_SCOPE_MAX_FILES or SOURCE_SCOPE_MAX_DEPTH. */
  truncated: boolean;
  /**
   * #3403: extra test-code rules beyond the built-in path rules, as
   * `<source>: <glob>` (`service/pom.xml: service/src/it/java/**`; keep
   * patterns prefixed `!`). Present only when at least one rule applied, so a
   * default run's summary is unchanged.
   */
  test_rules?: string[];
}

// ---------------------------------------------------------------------------
// Canonical rules
// ---------------------------------------------------------------------------

/**
 * Directory names never descended into, at any depth. Every dot-directory
 * (VCS `.git`/`.hg`/`.svn`, IDE `.idea`/`.vscode`, tool caches `.terraform`,
 * `.gradle`, `.venv`, `.next`) is skipped as well, and `bin/` when it is
 * build output (see isBuildOutputBin).
 */
export const SOURCE_SCOPE_SKIP_DIRS: ReadonlySet<string> = new Set([
  // dependencies
  'node_modules', 'bower_components', 'jspm_packages', 'vendor', 'venv', '__pycache__',
  // build output and generated reports
  'dist', 'build', 'target', 'obj', 'out', 'coverage',
  // test fixtures (data, not application code)
  'fixtures',
]);

/** Hard caps of the underlying walk (per-call caps are maxDepth / maxFiles). */
export const SOURCE_SCOPE_MAX_FILES = 100_000;
export const SOURCE_SCOPE_MAX_DEPTH = 32;

const PROJECT_FILE_RE = /\.(csproj|vbproj|fsproj|sln)$/i;

/**
 * `bin/` is build output for .NET (next to `obj/` or a project file) and for
 * Eclipse Java (next to `.classpath`), but source for Node (`bin/www`) and
 * shell tooling, so it is skipped only in the first case.
 */
function isBuildOutputBin(siblings: readonly Dirent[]): boolean {
  return siblings.some((e) =>
    (e.isDirectory() && e.name === 'obj') ||
    (e.isFile() && (PROJECT_FILE_RE.test(e.name) || e.name === '.classpath')),
  );
}

const TEST_DIR_SEGMENTS = new Set([
  'test', 'tests', '__tests__', '__mocks__', 'systemtest', 'e2e', 'mock', 'mocks', 'testdata',
]);

const TEST_FILE_RES: readonly RegExp[] = [
  /\.(test|spec)\.[cm]?[jt]sx?$/i,          // npm: *.test.ts, *.spec.js
  /(Test|Tests|IT|ITest|TestCase)\.(java|kt|groovy|scala)$/, // JVM: FooTest.java, FooIT.java, FooITest.java
  /Tests?\.cs$/,                              // .NET: FooTests.cs
  /^test_.*\.py$/i, /_test\.py$/i,            // pytest
  /_test\.go$/i,                              // go test
  /_spec\.rb$/i,                              // rspec
];

/**
 * Test-code classification on a root-relative path (forward slashes).
 * Path rules: any directory segment in TEST_DIR_SEGMENTS (covers Maven
 * `src/test/java`, `src/test/resources`, `test/`, `tests/`, `__tests__/`,
 * `systemtest/`, `e2e/`, `mock/`, `__mocks__/`); file rules: TEST_FILE_RES.
 * Build-file driven detection (pom.xml testSourceDirectory, Gradle
 * sourceSets, vitest/jest include) and operator patterns are applied per walk
 * on top of this (#3403, SourceScope.isTestRel).
 */
export function isTestPath(rel: string): boolean {
  const parts = rel.split('/');
  const name = parts[parts.length - 1] ?? '';
  for (let i = 0; i < parts.length - 1; i++) {
    if (TEST_DIR_SEGMENTS.has((parts[i] ?? '').toLowerCase())) return true;
  }
  return TEST_FILE_RES.some((re) => re.test(name));
}

const GENERATED_DIR_SEGMENTS = new Set(['generated', 'generated-sources', '__generated__']);
const GENERATED_FILE_RE = /(\.min\.(js|css)|\.bundle\.js|\.map|\.generated\.\w+|\.g\.cs|\.designer\.cs|_pb2\.py|\.pb\.go)$/i;

/** Generated or minified artefact (tagged so consumers such as #3410 can down-weight it). */
export function isGeneratedPath(rel: string): boolean {
  const parts = rel.split('/');
  const name = parts[parts.length - 1] ?? '';
  for (let i = 0; i < parts.length - 1; i++) {
    if (GENERATED_DIR_SEGMENTS.has((parts[i] ?? '').toLowerCase())) return true;
  }
  return GENERATED_FILE_RE.test(name);
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

let walkCount = 0;

/** Number of full source walks performed in this process (memoisation evidence for tests). */
export function sourceScopeWalkCount(): number {
  return walkCount;
}

export class SourceScope {
  readonly root: string;
  private readonly files: SourceFile[] = [];
  private readonly excludedDirNames: Record<string, number> = {};
  private dirsExcluded = 0;
  private symlinks = 0;
  private truncated = false;
  /** #3403: extra rules (operator + build files) and keep rules of this walk. */
  private readonly extraRules: TestCodeRule[] = [];
  private readonly keepRules: TestCodeRule[];

  constructor(root: string, opts: SourceScopeOptions = {}) {
    // The root is kept as given (not resolved) so `abs` equals the
    // path.join(sourcePath, ...) every pass built before #3428.
    this.root = root;
    walkCount++;
    this.walk(root, '', 0);
    // #3403: classification on top of the built-in path rules, from files the
    // walk already found (no second walk).
    this.keepRules = rulesFromPatterns('assessment.test_code.keep_patterns', opts.keepPatterns ?? []);
    this.extraRules.push(...rulesFromPatterns('assessment.test_code.extra_patterns', opts.extraTestPatterns ?? []));
    if (opts.detectBuildFileTestFolders ?? true) {
      for (const f of this.files) {
        if (f.isHidden || !isTestRuleBuildFile(f.name) || f.sizeBytes > BUILD_FILE_MAX_BYTES) continue;
        let text: string;
        try { text = readFileSync(f.abs, 'utf-8'); } catch { continue; }
        for (const r of testRulesFromBuildFile(f.rel, f.name, text)) {
          if (!this.extraRules.some((x) => x.pattern === r.pattern)) this.extraRules.push(r);
        }
      }
    }
    if (this.extraRules.length > 0 || this.keepRules.length > 0) {
      for (const f of this.files) f.isTest = this.isTestRel(f.rel);
    }
  }

  /**
   * #3403: test-code classification of a root-relative path with this walk's
   * rules: keep patterns win, then the built-in rules (isTestPath), then the
   * operator and build-file rules. Used for files and for signal evidence.
   */
  isTestRel(rel: string): boolean {
    const p = rel.split('\\').join('/');
    if (this.keepRules.some((r) => r.re.test(p))) return false;
    if (isTestPath(p)) return true;
    return this.extraRules.some((r) => r.re.test(p));
  }

  /**
   * Depth-first, pre-order, native readdir order, recursing into a directory
   * when it is met (the order every pre-#3428 walker used, so "first hit"
   * and "last hit" evidence is unchanged).
   */
  private walk(dir: string, rel: string, depth: number): void {
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    let binIsOutput: boolean | null = null;
    for (const e of entries) {
      if (this.files.length >= SOURCE_SCOPE_MAX_FILES) { this.truncated = true; return; }
      const name = e.name;
      const childRel = rel ? `${rel}/${name}` : name;
      if (e.isSymbolicLink()) { this.symlinks++; continue; }
      if (e.isDirectory()) {
        let skip = name.startsWith('.') || SOURCE_SCOPE_SKIP_DIRS.has(name);
        if (!skip && name === 'bin') {
          if (binIsOutput === null) binIsOutput = isBuildOutputBin(entries);
          skip = binIsOutput;
        }
        if (skip) {
          this.dirsExcluded++;
          this.excludedDirNames[name] = (this.excludedDirNames[name] ?? 0) + 1;
          continue;
        }
        if (depth + 1 > SOURCE_SCOPE_MAX_DEPTH) { this.truncated = true; continue; }
        this.walk(join(dir, name), childRel, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const abs = join(dir, name);
      let sizeBytes = 0;
      try { sizeBytes = statSync(abs).size; } catch { continue; }
      this.files.push({
        abs,
        rel: childRel,
        name,
        ext: extname(name).toLowerCase(),
        depth,
        isTest: isTestPath(childRel),
        isGenerated: isGeneratedPath(childRel),
        isHidden: name.startsWith('.'),
        sizeBytes,
      });
    }
  }

  /** Filtered view in walk order. */
  list(opts: ListSourceFilesOptions): SourceFile[] {
    const exts = opts.extensions ? new Set(opts.extensions) : null;
    const includeHidden = opts.includeHidden ?? opts.purpose === 'secrets';
    const dropTests = (opts.testCode ?? runTestCode) === 'exclude' && opts.purpose !== 'secrets';
    const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY;
    const maxFiles = opts.maxFiles ?? Number.POSITIVE_INFINITY;
    const out: SourceFile[] = [];
    for (const f of this.files) {
      if (out.length >= maxFiles) break;
      if (f.depth > maxDepth) continue;
      if (f.isHidden && !includeHidden) continue;
      if (dropTests && f.isTest) continue;
      if (exts && !exts.has(f.ext)) continue;
      out.push(f);
    }
    return out;
  }

  /**
   * Shallowest file matching `test` (ties: walk order). Same result as the
   * old breadth-first "shallowest wins" searches (pass-01 INV-05, pass-06).
   */
  findShallowest(opts: ListSourceFilesOptions, test: (f: SourceFile) => boolean): SourceFile | null {
    let best: SourceFile | null = null;
    for (const f of this.list({ ...opts, maxFiles: undefined })) {
      if (!test(f)) continue;
      if (best === null || f.depth < best.depth) best = f;
      if (best.depth === 0) break;
    }
    return best;
  }

  summary(): SourceScopeSummary {
    let scanned = 0; let tests = 0; let generated = 0; let hidden = 0;
    for (const f of this.files) {
      if (f.isHidden) { hidden++; continue; }
      scanned++;
      if (f.isTest) tests++;
      if (f.isGenerated) generated++;
    }
    return {
      root: resolve(this.root),
      files_scanned: scanned,
      files_test: tests,
      files_generated: generated,
      files_hidden: hidden,
      dirs_excluded: this.dirsExcluded,
      excluded_dir_names: { ...this.excludedDirNames },
      symlinks_skipped: this.symlinks,
      truncated: this.truncated,
      ...(this.extraRules.length > 0 || this.keepRules.length > 0
        ? {
          test_rules: [
            ...this.extraRules.map((r) => `${r.source}: ${r.pattern}`),
            ...this.keepRules.map((r) => `${r.source}: !${r.pattern}`),
          ],
        }
        : {}),
    };
  }
}

/** #3403: build files larger than this are not parsed for test folders. */
const BUILD_FILE_MAX_BYTES = 1_000_000;

// ---------------------------------------------------------------------------
// Per-run memoisation
// ---------------------------------------------------------------------------

let runCache: Map<string, SourceScope> | null = null;
/** #3403: the run's test-code listing default and classification options. */
let runTestCode: TestCodeMode = 'include';
let runScopeOptions: SourceScopeOptions = {};

/**
 * Start a run: from now on each root is walked once. Called by `swao assess`
 * after Pass 00 INGEST (which may route files into wsp/inputs/source) and
 * before the first pass. #3403: `opts` carries the resolved test-code setting,
 * so every pass (and every service-plan source root) inherits it.
 */
export function beginSourceScopeRun(opts: SourceScopeRunOptions = {}): void {
  runCache = new Map();
  const { testCode, ...scopeOpts } = opts;
  runTestCode = testCode ?? 'include';
  runScopeOptions = scopeOpts;
}

/** End the run and drop the cached walks and the run's test-code setting. */
export function endSourceScopeRun(): void {
  runCache = null;
  runTestCode = 'include';
  runScopeOptions = {};
}

/** #3403: the listing default of the active run (`include` outside a run). */
export function sourceScopeRunTestCode(): TestCodeMode {
  return runTestCode;
}

/** The scope for `root`: memoised inside a run, a fresh walk outside one. */
export function getSourceScope(root: string): SourceScope {
  if (!runCache) return new SourceScope(root);
  // Keyed by the root string: within a run every pass receives the same
  // ctx.sourcePath (service plans hand some passes a different folder, which
  // gets its own entry).
  let scope = runCache.get(root);
  if (!scope) {
    scope = new SourceScope(root, runScopeOptions);
    runCache.set(root, scope);
  }
  return scope;
}

/** The files a pass may read under `root` (the resolved source path). */
export function listSourceFiles(root: string, opts: ListSourceFilesOptions): SourceFile[] {
  return getSourceScope(root).list(opts);
}

/** Shallowest matching file under `root`, or null. */
export function findShallowestSourceFile(
  root: string,
  opts: ListSourceFilesOptions,
  test: (f: SourceFile) => boolean,
): SourceFile | null {
  return getSourceScope(root).findShallowest(opts, test);
}

/**
 * True when `root` holds at least one file whose lower-cased name is not in
 * `ignoreNames` (#0516 README-only guard). Early exit, never cached: it runs
 * before Pass 00 and the clone decision. Dot-entries are always ignored.
 * `respectSkipSet` (default true) applies the canonical skip set, so a tree
 * whose only files sit in node_modules/ or target/ counts as empty for the
 * passes; the clone guard passes false, because there an existing file
 * anywhere is operator work that must not be replaced by a clone.
 */
export function sourceTreeHasFiles(
  root: string,
  ignoreNames: ReadonlySet<string>,
  opts: { respectSkipSet?: boolean } = {},
): boolean {
  const respectSkipSet = opts.respectSkipSet ?? true;
  const stack: string[] = [resolve(root)];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    let binIsOutput: boolean | null = null;
    for (const e of entries) {
      if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
      if (e.isDirectory()) {
        if (!respectSkipSet) { stack.push(join(dir, e.name)); continue; }
        if (SOURCE_SCOPE_SKIP_DIRS.has(e.name)) continue;
        if (e.name === 'bin') {
          if (binIsOutput === null) binIsOutput = isBuildOutputBin(entries);
          if (binIsOutput) continue;
        }
        stack.push(join(dir, e.name));
        continue;
      }
      if (e.isFile() && !ignoreNames.has(e.name.toLowerCase())) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Input folders (wsp/inputs/): operator-curated, no source skip set
// ---------------------------------------------------------------------------

export interface InputFile {
  abs: string;
  /** Relative to the listing root, forward slashes. */
  rel: string;
  name: string;
  ext: string;
  depth: number;
  sizeBytes: number;
}

export interface ListInputFilesOptions {
  /** Directory names skipped directly under the root only (pass-04 CTX: source, catalogs, llm-gateway). */
  skipTopLevelDirs?: Iterable<string>;
  /** Directory names skipped at any depth (service passes: SWAO-generated input folders). */
  skipDirNames?: Iterable<string>;
}

/**
 * Files under an input folder, depth-first with each directory's entries
 * sorted (code-unit order), not memoised (Pass 00 and the research step
 * write into wsp/inputs/ during the run). Symbolic links are not followed.
 */
export function listInputFiles(root: string, opts: ListInputFilesOptions = {}): InputFile[] {
  const top = new Set(opts.skipTopLevelDirs ?? []);
  const any = new Set(opts.skipDirNames ?? []);
  const out: InputFile[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (any.has(e.name) || (depth === 0 && top.has(e.name))) continue;
        if (depth + 1 > SOURCE_SCOPE_MAX_DEPTH) continue;
        walk(join(dir, e.name), childRel, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const abs = join(dir, e.name);
      let sizeBytes = 0;
      try { sizeBytes = statSync(abs).size; } catch { continue; }
      out.push({ abs, rel: childRel, name: e.name, ext: extname(e.name).toLowerCase(), depth, sizeBytes });
    }
  };
  walk(root, '', 0);
  return out;
}
