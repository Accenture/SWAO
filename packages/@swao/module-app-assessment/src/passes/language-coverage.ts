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

// #3423: per-language coverage matrix (Design 070 section 2.6).
//
// Which default pass covers which language, and how: `deterministic` (a
// rule-based check reads the language's files or manifests), `llm` (the pass
// puts the language's source files into an LLM prompt, today DATA only) or
// `none`. The cells are DERIVED from the extension sets and ecosystem lists
// the passes actually scan (imported from the pass modules), so widening a
// pass's scan widens the matrix without a second edit. Two passes gate their language-specific checks on a stack test
// rather than an extension set (STATE: package.json / Prisma; TF: the Node and
// Rust branches of TF-04); their stacks are declared here next to a pointer to
// the gating code.

import {
  languagesForExtensions,
  manifestDetectableLanguages,
  ecosystemLanguages,
  productionLoc,
  SOURCE_LANGUAGES,
  type CoverageLevel,
  type LanguageCensus,
  type LanguageCoverage,
  type SourceLanguage,
} from '@swao/core';
import { PII_SCAN_EXTENSIONS, DATA_LLM_SOURCE_EXTENSIONS } from './pass-03-data.js';
import { SBOM_OSV_ECOSYSTEMS } from './pass-05-sbom.js';
import { EGR_SOURCE_SCAN_EXTENSIONS } from './pass-07-egr.js';
import { CRYPTO_PRIMITIVE_SCAN_EXTENSIONS, CRYPTO_CATALOGUE_SCAN_EXTENSIONS } from './pass-08-crypto.js';
import { CODE_LANGUAGES } from './code-health-metrics.js';

/** How a pass treats source languages. */
export type PassLanguageMode =
  /** Deterministic for `languages`, nothing for the rest. */
  | 'deterministic'
  /** Deterministic for `languages`, LLM for `llmLanguages`, nothing for the rest. */
  | 'deterministic+llm'
  /** Language-independent deterministic check (pattern scan over every file). */
  | 'agnostic';

export interface PassLanguageRule {
  key: string;
  name: string;
  mode: PassLanguageMode;
  /** Languages of the deterministic part (ignored for `agnostic`). */
  languages: ReadonlySet<SourceLanguage>;
  /** Languages whose source files the pass's LLM prompt may include (`deterministic+llm` only). */
  llmLanguages?: ReadonlySet<SourceLanguage>;
  /** What the deterministic part reads, one line, for the publication legend. */
  basis: string;
  /** Language-specific code analysis (counts towards has_deterministic / the INV-91 warning). */
  codeAnalysis: boolean;
}

const ALL_LANGUAGES: ReadonlySet<SourceLanguage> = new Set(SOURCE_LANGUAGES);

function union(...sets: Array<Iterable<SourceLanguage>>): Set<SourceLanguage> {
  const out = new Set<SourceLanguage>();
  for (const s of sets) for (const l of s) out.add(l);
  return out;
}

/**
 * STATE (pass-02-state.ts runStatePass): stateful stores come from
 * package.json dependencies and prisma/schema.prisma; #3422 adds the JVM
 * session and in-process state patterns of jvm-state.ts (Java and Kotlin
 * source, Spring configuration, Maven / Gradle build files).
 */
const STATE_STACK_LANGUAGES: ReadonlySet<SourceLanguage> = new Set(['TypeScript', 'JavaScript', 'Java', 'Kotlin']);

/**
 * TF (pass-06-tf.ts runTfPass, `isNode` / `isRust` / `isJvm`): the
 * language-specific factor checks run for Node, Rust and Java (TF-04
 * structured logging, TF-05 Actuator, #3421). #3424: TF-01 reads the config
 * idiom of Spring (Java / Kotlin sources and application*.yml), Node, Python
 * and .NET (C#); compose, Helm and Kubernetes manifests are language-independent.
 */
const TF_STACK_LANGUAGES: ReadonlySet<SourceLanguage> = new Set(['TypeScript', 'JavaScript', 'Rust', 'Java', 'Kotlin', 'Python', 'C#']);

/**
 * Matrix columns, in default-profile order: the passes that read source
 * files or manifests. ctx (context documents), comp, synth and blocks reason
 * over the collected signals and inputs, not over source files, and dynamic
 * and scope read no source code, so none of them is a column (a column of
 * "LLM" cells would claim the model read code it never saw).
 */
export function passLanguageRules(): PassLanguageRule[] {
  return [
    { key: 'inv', name: 'inventory', mode: 'deterministic', languages: manifestDetectableLanguages(),
      basis: 'build manifests at any depth (pom.xml, build.gradle, package.json, go.mod, *.csproj, ...)', codeAnalysis: false },
    { key: 'state', name: 'state_analysis', mode: 'deterministic', languages: STATE_STACK_LANGUAGES,
      basis: 'package.json dependencies and Prisma schema; Java/Kotlin JDBC / JPA database evidence, session and in-process state patterns with Spring configuration', codeAnalysis: true },
    { key: 'data', name: 'data_classification', mode: 'deterministic+llm', languages: languagesForExtensions(PII_SCAN_EXTENSIONS),
      llmLanguages: languagesForExtensions(DATA_LLM_SOURCE_EXTENSIONS),
      basis: 'PII field-name catalogue over source files; privacy-relevant source files in the LLM prompt', codeAnalysis: true },
    { key: 'sbom', name: 'sbom_cve', mode: 'deterministic',
      languages: union(...SBOM_OSV_ECOSYSTEMS.map((e) => ecosystemLanguages(e))),
      basis: `dependency manifests checked against OSV (${SBOM_OSV_ECOSYSTEMS.join(', ')})`, codeAnalysis: true },
    { key: 'tf', name: 'twelve_factor', mode: 'deterministic', languages: TF_STACK_LANGUAGES,
      basis: 'stack-specific factor checks (config externalisation, structured logging, health)', codeAnalysis: true },
    { key: 'egr', name: 'egress', mode: 'deterministic', languages: languagesForExtensions(EGR_SOURCE_SCAN_EXTENSIONS),
      basis: 'egress domain catalogue over source files; hard-coded endpoints in JVM source and Spring configuration', codeAnalysis: true },
    { key: 'crypto', name: 'crypto_posture', mode: 'deterministic',
      languages: union(languagesForExtensions(CRYPTO_PRIMITIVE_SCAN_EXTENSIONS), languagesForExtensions(CRYPTO_CATALOGUE_SCAN_EXTENSIONS)),
      basis: 'crypto primitive patterns, catalogue import tokens and the Java JCA call inventory', codeAnalysis: true },
    // #3405: Pass 26 measures code quality, not sovereignty, so it does not
    // count as language-specific code analysis (the INV-91 warning stays honest).
    { key: 'quality', name: 'code_health', mode: 'deterministic', languages: languagesForExtensions(Object.keys(CODE_LANGUAGES)),
      basis: 'built-in size, complexity, duplication and marker metrics over production code', codeAnalysis: false },
    { key: 'secrets', name: 'secret_scan', mode: 'agnostic', languages: ALL_LANGUAGES,
      basis: 'Gitleaks pattern scan over every file (when installed)', codeAnalysis: false },
  ];
}

/** Coverage level of one pass for one language. */
export function coverageLevel(rule: PassLanguageRule, language: SourceLanguage): CoverageLevel {
  switch (rule.mode) {
    case 'deterministic': return rule.languages.has(language) ? 'deterministic' : 'none';
    case 'deterministic+llm':
      if (rule.languages.has(language)) return 'deterministic';
      return rule.llmLanguages?.has(language) ? 'llm' : 'none';
    case 'agnostic': return 'deterministic';
    default: {
      const never: never = rule.mode;
      return never;
    }
  }
}

/** Warning threshold: share of production LOC without deterministic code analysis (#3423 acceptance). */
export const LANGUAGE_COVERAGE_WARNING_SHARE = 0.5;

/** Language x pass matrix for the languages present in the census. */
export function buildLanguageCoverage(census: LanguageCensus, rules: PassLanguageRule[] = passLanguageRules()): LanguageCoverage {
  const rows = census.languages.map((r) => {
    const cells: Record<string, CoverageLevel> = {};
    for (const rule of rules) cells[rule.key] = coverageLevel(rule, r.language);
    const hasDeterministic = rules.some((rule) => rule.codeAnalysis && cells[rule.key] === 'deterministic');
    return { language: r.language, loc: r.loc, loc_production: productionLoc(r), cells, has_deterministic: hasDeterministic };
  });
  const prodTotal = rows.reduce((s, r) => s + r.loc_production, 0);
  const weight = (r: { loc: number; loc_production: number }): number => (prodTotal > 0 ? r.loc_production : r.loc);
  const total = prodTotal > 0 ? prodTotal : rows.reduce((s, r) => s + r.loc, 0);
  let dominant: SourceLanguage | null = null;
  let best = -1;
  for (const r of rows) {
    if (weight(r) > best) { best = weight(r); dominant = r.language; }
  }
  if (best <= 0) dominant = null;
  const uncovered = rows.filter((r) => !r.has_deterministic).reduce((s, r) => s + weight(r), 0);
  const share = total > 0 ? Math.round((uncovered / total) * 1000) / 1000 : 0;
  return {
    passes: rules.map((r) => ({ key: r.key, name: r.name, basis: r.basis, code_analysis: r.codeAnalysis })),
    rows,
    dominant_language: dominant,
    uncovered_loc_share: share,
    warning_threshold: LANGUAGE_COVERAGE_WARNING_SHARE,
    warning: share > LANGUAGE_COVERAGE_WARNING_SHARE,
  };
}
