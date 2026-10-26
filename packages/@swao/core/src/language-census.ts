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

// #3423: language census, recursive build-manifest detection and the
// language coverage contract (Design 070 section 2.6).
//
// Everything here reads the source tree through the central source scope
// (#3428, source-scope.ts): no directory walk of its own. The census counts
// files and non-blank lines per programming language, split into production
// and test code via SourceFile.isTest; generated or minified files are
// excluded from the counts (they would distort a comparison with CAST
// Highlight) and only reported as a number.
//
// The pass x language coverage matrix is BUILT in @swao/module-app-assessment
// (it derives the cells from the extension sets the passes scan); this module
// owns its shape (LanguageCoverageSchema) so the inventory pass output and the
// publication extractor share one Zod contract.

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { listSourceFiles, type SourceFile } from './source-scope.js';

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/** Programming languages the census recognises. Markup and data formats (HTML, CSS, XML, YAML, JSON) are not counted. */
export const SOURCE_LANGUAGES = [
  'Java', 'Kotlin', 'Scala', 'Groovy',
  'TypeScript', 'JavaScript',
  'Python', 'Go', 'C#', 'VB.NET', 'F#', 'Rust', 'Ruby', 'PHP',
  'C', 'C++', 'Swift', 'Dart', 'COBOL',
  'Shell', 'PowerShell', 'SQL',
] as const;

export type SourceLanguage = typeof SOURCE_LANGUAGES[number];

export const SourceLanguageSchema = z.enum(SOURCE_LANGUAGES);

/** Lower-cased extension (with the dot) to language. Single source for the census and the coverage matrix. */
export const LANGUAGE_BY_EXTENSION: Readonly<Record<string, SourceLanguage>> = {
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.scala': 'Scala',
  '.groovy': 'Groovy',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.cs': 'C#',
  '.vb': 'VB.NET',
  '.fs': 'F#',
  '.rs': 'Rust',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.c': 'C', '.h': 'C',
  '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++', '.hh': 'C++',
  '.swift': 'Swift',
  '.dart': 'Dart',
  '.cbl': 'COBOL', '.cob': 'COBOL',
  '.sh': 'Shell', '.bash': 'Shell', '.ksh': 'Shell', '.zsh': 'Shell',
  '.ps1': 'PowerShell', '.psm1': 'PowerShell',
  '.sql': 'SQL',
};

/** Languages covered by a set of scanned extensions (a pass's extension list). */
export function languagesForExtensions(extensions: Iterable<string>): Set<SourceLanguage> {
  const out = new Set<SourceLanguage>();
  for (const ext of extensions) {
    const lang = LANGUAGE_BY_EXTENSION[ext.toLowerCase()];
    if (lang) out.add(lang);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Package ecosystems and build manifests
// ---------------------------------------------------------------------------

export const PACKAGE_ECOSYSTEMS = ['npm', 'Maven', 'PyPI', 'Go', 'NuGet', 'crates.io', 'RubyGems', 'Packagist'] as const;
export type PackageEcosystem = typeof PACKAGE_ECOSYSTEMS[number];

/** Languages whose dependencies a package ecosystem describes (SBOM coverage). */
export function ecosystemLanguages(eco: PackageEcosystem): SourceLanguage[] {
  switch (eco) {
    case 'npm': return ['TypeScript', 'JavaScript'];
    case 'Maven': return ['Java', 'Kotlin', 'Scala', 'Groovy'];
    case 'PyPI': return ['Python'];
    case 'Go': return ['Go'];
    case 'NuGet': return ['C#', 'VB.NET', 'F#'];
    case 'crates.io': return ['Rust'];
    case 'RubyGems': return ['Ruby'];
    case 'Packagist': return ['PHP'];
    default: {
      const never: never = eco;
      return never;
    }
  }
}

export const BUILD_MANIFEST_KINDS = [
  'maven', 'gradle', 'sbt', 'npm', 'python', 'go', 'dotnet', 'cargo', 'bundler', 'composer',
] as const;
export type BuildManifestKind = typeof BUILD_MANIFEST_KINDS[number];

/** Build-manifest kind for a file name, or null. */
export function buildManifestKind(name: string): BuildManifestKind | null {
  const lower = name.toLowerCase();
  if (lower === 'pom.xml') return 'maven';
  if (lower === 'build.gradle' || lower === 'build.gradle.kts') return 'gradle';
  if (lower === 'build.sbt') return 'sbt';
  if (lower === 'package.json') return 'npm';
  if (lower === 'pyproject.toml' || lower === 'setup.py' || lower === 'setup.cfg' || lower === 'pipfile'
    || /^requirements([-_.][\w.-]*)?\.txt$/.test(lower)) return 'python';
  if (lower === 'go.mod') return 'go';
  if (/\.(csproj|vbproj|fsproj|sln)$/.test(lower)) return 'dotnet';
  if (lower === 'cargo.toml') return 'cargo';
  if (lower === 'gemfile') return 'bundler';
  if (lower === 'composer.json') return 'composer';
  return null;
}

/** Ecosystem and candidate languages of a manifest kind. */
export function manifestKindInfo(kind: BuildManifestKind): { ecosystem: PackageEcosystem; languages: SourceLanguage[] } {
  switch (kind) {
    case 'maven': return { ecosystem: 'Maven', languages: ['Java', 'Kotlin', 'Scala', 'Groovy'] };
    case 'gradle': return { ecosystem: 'Maven', languages: ['Java', 'Kotlin', 'Groovy', 'Scala'] };
    case 'sbt': return { ecosystem: 'Maven', languages: ['Scala', 'Java'] };
    case 'npm': return { ecosystem: 'npm', languages: ['TypeScript', 'JavaScript'] };
    case 'python': return { ecosystem: 'PyPI', languages: ['Python'] };
    case 'go': return { ecosystem: 'Go', languages: ['Go'] };
    case 'dotnet': return { ecosystem: 'NuGet', languages: ['C#', 'VB.NET', 'F#'] };
    case 'cargo': return { ecosystem: 'crates.io', languages: ['Rust'] };
    case 'bundler': return { ecosystem: 'RubyGems', languages: ['Ruby'] };
    case 'composer': return { ecosystem: 'Packagist', languages: ['PHP'] };
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** Languages for which a build manifest is recognised (INV coverage). */
export function manifestDetectableLanguages(): Set<SourceLanguage> {
  const out = new Set<SourceLanguage>();
  for (const k of BUILD_MANIFEST_KINDS) for (const l of manifestKindInfo(k).languages) out.add(l);
  return out;
}

export const BuildManifestSchema = z.object({
  /** Path relative to the source root, forward slashes. */
  path: z.string(),
  kind: z.enum(BUILD_MANIFEST_KINDS),
  ecosystem: z.enum(PACKAGE_ECOSYSTEMS),
  depth: z.number().int().nonnegative(),
  /** Manifest sits in test code (e.g. systemtest/package.json). */
  is_test: z.boolean(),
});
export type BuildManifest = z.infer<typeof BuildManifestSchema>;

/** Default manifest depth: `service/module/sub/pom.xml` (depth 3) is still found. */
export const BUILD_MANIFEST_MAX_DEPTH = 4;

/**
 * Build manifests at any depth up to `maxDepth` inside the source scope
 * (canonical skips apply, so node_modules/x/package.json is never listed).
 * Order: shallowest first, then walk order.
 */
export function detectBuildManifests(root: string, opts: { maxDepth?: number } = {}): BuildManifest[] {
  const maxDepth = opts.maxDepth ?? BUILD_MANIFEST_MAX_DEPTH;
  const out: BuildManifest[] = [];
  for (const f of listSourceFiles(root, { purpose: 'manifest', maxDepth })) {
    const kind = buildManifestKind(f.name);
    if (!kind) continue;
    out.push({ path: f.rel, kind, ecosystem: manifestKindInfo(kind).ecosystem, depth: f.depth, is_test: f.isTest });
  }
  // Stable sort keeps walk order within one depth.
  return out.sort((a, b) => a.depth - b.depth);
}

// ---------------------------------------------------------------------------
// Census
// ---------------------------------------------------------------------------

export const LanguageCensusRowSchema = z.object({
  language: SourceLanguageSchema,
  /** Extensions seen for this language, sorted. */
  extensions: z.array(z.string()),
  files: z.number().int().nonnegative(),
  /** Non-blank lines, production + test. */
  loc: z.number().int().nonnegative(),
  files_test: z.number().int().nonnegative(),
  loc_test: z.number().int().nonnegative(),
});
export type LanguageCensusRow = z.infer<typeof LanguageCensusRowSchema>;

export const LanguageCensusSchema = z.object({
  /** Counting method, for the methodology note. */
  method: z.literal('non_blank_lines'),
  total_files: z.number().int().nonnegative(),
  total_loc: z.number().int().nonnegative(),
  total_loc_test: z.number().int().nonnegative(),
  /** Generated or minified files of a known language, excluded from the counts. */
  files_generated_excluded: z.number().int().nonnegative(),
  /** Files above CENSUS_MAX_FILE_BYTES, excluded from the counts. */
  files_too_large: z.number().int().nonnegative(),
  /** Sorted by loc descending, then language name. */
  languages: z.array(LanguageCensusRowSchema),
  /** Shallowest first, capped at CENSUS_MAX_MANIFESTS (monorepos). */
  manifests: z.array(BuildManifestSchema),
  /** All manifests found, before the cap. */
  manifests_total: z.number().int().nonnegative(),
});
export type LanguageCensus = z.infer<typeof LanguageCensusSchema>;

/** Manifests kept in the census (the pass file stays small for monorepos with hundreds of package.json files). */
export const CENSUS_MAX_MANIFESTS = 200;

/** Files above this size are not read (a data dump with a code extension). */
export const CENSUS_MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Non-blank line count of a text. */
export function countNonBlankLines(text: string): number {
  let n = 0;
  for (const line of text.split(/\r\n|\r|\n/)) if (line.trim().length > 0) n++;
  return n;
}

/**
 * Language census over the source scope: files and non-blank lines per
 * language, production vs test (SourceFile.isTest). Reads only files with an
 * extension in LANGUAGE_BY_EXTENSION.
 */
export function computeLanguageCensus(
  root: string,
  opts: { manifestMaxDepth?: number; maxFileBytes?: number } = {},
): LanguageCensus {
  const maxBytes = opts.maxFileBytes ?? CENSUS_MAX_FILE_BYTES;
  const rows = new Map<SourceLanguage, { exts: Set<string>; files: number; loc: number; filesTest: number; locTest: number }>();
  let generated = 0;
  let tooLarge = 0;
  const files: SourceFile[] = listSourceFiles(root, { purpose: 'code', extensions: Object.keys(LANGUAGE_BY_EXTENSION) });
  for (const f of files) {
    const lang = LANGUAGE_BY_EXTENSION[f.ext];
    if (!lang) continue;
    if (f.isGenerated) { generated++; continue; }
    if (f.sizeBytes > maxBytes) { tooLarge++; continue; }
    let loc = 0;
    try { loc = countNonBlankLines(readFileSync(f.abs, 'utf-8')); } catch { continue; }
    let row = rows.get(lang);
    if (!row) { row = { exts: new Set(), files: 0, loc: 0, filesTest: 0, locTest: 0 }; rows.set(lang, row); }
    row.exts.add(f.ext);
    row.files++;
    row.loc += loc;
    if (f.isTest) { row.filesTest++; row.locTest += loc; }
  }
  const languages: LanguageCensusRow[] = [...rows.entries()]
    .map(([language, r]) => ({
      language,
      extensions: [...r.exts].sort(),
      files: r.files,
      loc: r.loc,
      files_test: r.filesTest,
      loc_test: r.locTest,
    }))
    .sort((a, b) => b.loc - a.loc || a.language.localeCompare(b.language));
  const manifests = detectBuildManifests(root, { maxDepth: opts.manifestMaxDepth });
  return {
    method: 'non_blank_lines',
    total_files: languages.reduce((s, r) => s + r.files, 0),
    total_loc: languages.reduce((s, r) => s + r.loc, 0),
    total_loc_test: languages.reduce((s, r) => s + r.loc_test, 0),
    files_generated_excluded: generated,
    files_too_large: tooLarge,
    languages,
    manifests: manifests.slice(0, CENSUS_MAX_MANIFESTS),
    manifests_total: manifests.length,
  };
}

/** Production lines of a census row. */
export function productionLoc(row: Pick<LanguageCensusRow, 'loc' | 'loc_test'>): number {
  return row.loc - row.loc_test;
}

// ---------------------------------------------------------------------------
// Coverage contract (built by @swao/module-app-assessment)
// ---------------------------------------------------------------------------

/**
 * deterministic: a rule-based check reads this language's files or manifests;
 * llm: only an LLM pass reasons over it; none: the pass does not look at it.
 */
export const COVERAGE_LEVELS = ['deterministic', 'llm', 'none'] as const;
export type CoverageLevel = typeof COVERAGE_LEVELS[number];

export const LanguageCoverageSchema = z.object({
  /** Passes in matrix column order. */
  passes: z.array(z.object({
    key: z.string(),
    name: z.string(),
    /** One line on what the deterministic part reads (for the legend). */
    basis: z.string(),
    /** True when the deterministic part is language-specific code analysis (counts towards `has_deterministic`). */
    code_analysis: z.boolean(),
  })),
  rows: z.array(z.object({
    language: SourceLanguageSchema,
    loc: z.number().int().nonnegative(),
    loc_production: z.number().int().nonnegative(),
    /** Pass key to coverage level. */
    cells: z.record(z.string(), z.enum(COVERAGE_LEVELS)),
    /** At least one code-analysis pass covers the language deterministically. */
    has_deterministic: z.boolean(),
  })),
  /** Language with the most production lines (total lines when there is no production code). */
  dominant_language: SourceLanguageSchema.nullable(),
  /** Share (0..1) of production lines in languages without deterministic code analysis. */
  uncovered_loc_share: z.number().min(0).max(1),
  /** Threshold for the coverage warning (INV-91). */
  warning_threshold: z.number(),
  warning: z.boolean(),
});
export type LanguageCoverage = z.infer<typeof LanguageCoverageSchema>;
