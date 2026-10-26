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

import { existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { load } from 'js-yaml';
import { loadPassCatalog, compileRegexMatcher, scanCatalogueRules, MatchModeSchema, type ScanRule } from './pass-catalog-loader.js';
import type { PassContext, PassResult } from '@swao/core';
import type { LlmPassResponse } from './types.js';
import type { Signal } from '@swao/core';
import { SIGNAL_SCHEMA_HINT, normalizeSignal, maskKnownSecret, guardSecretsDeep, guardSecretText, extractCredentialValues, listSourceFiles, getSourceScope } from '@swao/core';
import { llmSkipResult, llmInvalidResponseResult } from './llm-skip.js';

// ---- #1144 Saudi CCC tier helpers ----

/** NCA CCC regime IDs that activate Saudi data-tier classification */
const SAUDI_CCC_REGIMES = new Set(['NCA_CCC_CST', 'NCA_CCC_CSP']);

/** Read regimes_active from the app's .swao.yml (same logic as loadAppRegimes in derive-plan.ts) */
function readRegimesActive(workspacePath: string): string[] {
  const ymlPath = join(workspacePath, '.swao.yml');
  if (!existsSync(ymlPath)) return [];
  try {
    const yml = load(readFileSync(ymlPath, 'utf-8')) as {
      regimes?: string[];
      assessment?: { regimes_active?: string[] };
    } | null;
    return Array.isArray(yml?.assessment?.regimes_active)
      ? yml.assessment.regimes_active
      : Array.isArray(yml?.regimes) ? yml.regimes : [];
  } catch {
    return [];
  }
}

/** Extra instructions appended to the DATA pass prompt when Saudi CCC is active. */
const SAUDI_TIER_PROMPT_APPEND = `

SAUDI CCC DATA TIER CLASSIFICATION (active because NCA_CCC_CST/CSP is in regimes):
In addition to the standard output, add a "saudi_data_tier" key to the assessment object:
  "saudi_data_tier": {
    "level": "<public|internal|confidential|restricted>",
    "label": "<brief description of the most sensitive data class found>",
    "cst_class_required": "<class_c|class_b|class_a|qualification|null>"
  }
Classification mapping:
  - public    -> cst_class_required: "class_c"
  - internal  -> cst_class_required: "class_c"
  - confidential -> cst_class_required: "class_b"
  - restricted (highest sensitivity: health, financial, government) -> cst_class_required: "class_a"
If you cannot determine the sensitivity level, set cst_class_required to null.
Base this ONLY on observed data classes in the source files.`;

function readSafe(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try { return readFileSync(filePath, 'utf-8'); } catch { return null; }
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.rs', '.go', '.py', '.java', '.kt', '.cs', '.rb']);
// #3423: source files the LLM data-classification prompt may include (language coverage matrix).
export const DATA_LLM_SOURCE_EXTENSIONS: ReadonlySet<string> = SOURCE_EXTENSIONS;
const SCHEMA_EXTENSIONS = new Set(['.prisma', '.sql', '.graphql']);

// Keywords that indicate a file is relevant to data privacy / GDPR
const PRIVACY_KEYWORDS = [
  'gdpr', 'erasure', 'art.17', 'article.17', 'right.to', 'purge', 'delete_user',
  'personal_data', 'pii', 'consent', 'data_subject', 'dsar', 'retention',
  'anonymis', 'anonymiz', 'redact', 'health_record', 'medical', 'patient',
];

function hasPrivacyKeyword(content: string): boolean {
  const lower = content.toLowerCase();
  return PRIVACY_KEYWORDS.some(k => lower.includes(k.replace('.', '')));
}

/**
 * Walk source tree and collect files relevant to data classification.
 * Returns up to `cap` files, prioritising:
 *   1. Schema definitions (Prisma, SQL migrations)
 *   2. Files whose name or content signals GDPR / privacy relevance
 *   3. Auth / user-data handler files
 *   4. Env/config files
 */
function collectDataFiles(
  sourcePath: string,
  cap = 16,
): Array<{ relativePath: string; content: string; kind: string }> {
  const results: Array<{ relativePath: string; content: string; kind: string; priority: number }> = [];
  const seen = new Set<string>();

  // ---- 1. Prisma schema ----
  const prisma = join(sourcePath, 'prisma', 'schema.prisma');
  if (existsSync(prisma)) {
    const c = readSafe(prisma);
    if (c) results.push({ relativePath: 'prisma/schema.prisma', content: c.slice(0, 4000), kind: 'schema', priority: 0 });
    seen.add(prisma);
  }

  // ---- 2. Env / config ----
  for (const name of ['.env.example', '.env.sample', 'config.toml', 'config.yaml', 'config.yml']) {
    const full = join(sourcePath, name);
    if (existsSync(full) && !seen.has(full)) {
      const c = readSafe(full);
      if (c) { results.push({ relativePath: name, content: c.slice(0, 1500), kind: 'env', priority: 1 }); seen.add(full); }
    }
  }

  // ---- 3. Walk tree: schemas + privacy-relevant source files ----
  // #3428: central source scope (canonical skips; same depth guard as the
  // old walk(sourcePath, 0) with `depth > 7` return).
  for (const f of listSourceFiles(sourcePath, { purpose: 'code', maxDepth: 7 })) {
    const full = f.abs;
    const entry = f.name;
    if (seen.has(full)) continue;
    try {
      const ext = f.ext;
      const rel = relative(sourcePath, full).replace(/\\/g, '/');
      const isSchemaFile = SCHEMA_EXTENSIONS.has(ext);
      const alreadyHasEnoughSchemas = results.filter(r => r.kind === 'schema').length >= 4;
      if (isSchemaFile && !seen.has(full) && !alreadyHasEnoughSchemas) {
        const c = readSafe(full);
        if (c) { results.push({ relativePath: rel, content: c.slice(0, 2500), kind: 'schema', priority: 0 }); seen.add(full); }
      } else if (SOURCE_EXTENSIONS.has(ext)) {
        // Check filename for privacy signals first (cheap)
        const namePrivate = PRIVACY_KEYWORDS.some(k => entry.toLowerCase().includes(k.replace('.', '')));
        if (namePrivate) {
          const c = readSafe(full);
          if (c) { results.push({ relativePath: rel, content: c.slice(0, 3000), kind: 'source:privacy', priority: 2 }); seen.add(full); }
        }
      }
    } catch { /* skip */ }
  }

  // ---- 4. If still sparse, add auth / user handler files by name pattern ----
  if (results.filter(r => r.kind === 'source:privacy').length < 3) {
    const authPatterns = ['auth', 'user', 'account', 'profile', 'settings', 'delete', 'export', 'consent'];
    // #3428: central source scope (same depth guard as the old walkForHandlers).
    for (const f of listSourceFiles(sourcePath, { purpose: 'code', maxDepth: 7 })) {
      const full = f.abs;
      if (seen.has(full)) continue;
      try {
        if (SOURCE_EXTENSIONS.has(f.ext)) {
          const nameLower = f.name.toLowerCase();
          if (authPatterns.some(p => nameLower.includes(p))) {
            const c = readSafe(full);
            if (c && hasPrivacyKeyword(c)) {
              const rel = relative(sourcePath, full).replace(/\\/g, '/');
              results.push({ relativePath: rel, content: c.slice(0, 2500), kind: 'source:handler', priority: 3 });
              seen.add(full);
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  // Sort by priority, cap total
  results.sort((a, b) => a.priority - b.priority);
  return results.slice(0, cap);
}

/** #3403: label suffix and prompt rule for test files (assessment.test_code: tag only). */
export const TEST_CODE_KIND_SUFFIX = ', test code';
export const TEST_CODE_PROMPT_RULE =
  'Files labelled "test code" are test code (test sources, fixtures, test data), not production code. ' +
  'A finding that rests only on test code must say "in test code" in its derivation and must not claim ' +
  'that production processes or stores that data.';

export function buildDataPrompt(
  files: Array<{ relativePath: string; content: string; kind: string }>,
  saudiCccActive: boolean,
  testCodeMarked = false,
): string {
  const baseAssessmentShape = saudiCccActive
    ? '{ "signals": [...], "assessment": { "data_classes": ["string"], "gdpr_art17_implemented": bool, "secrets_in_env": bool, "saudi_data_tier": { "level": "...", "label": "...", "cst_class_required": "..." } } }'
    : '{ "signals": [...], "assessment": { "data_classes": ["string"], "gdpr_art17_implemented": bool, "secrets_in_env": bool } }';

  const parts: string[] = [
    'DATA_CLASSIFICATION_PASS',
    'Analyse the source files below to classify data types, identify PII/sensitive data classes, and assess GDPR compliance.',
    'Base your signals ONLY on evidence you can observe in the files provided.',
    'Do NOT emit signals about things you cannot observe -- absence of evidence is NOT evidence of absence.',
    'If a GDPR control IS implemented, emit a positive signal citing the specific file and function.',
    `Return JSON: ${baseAssessmentShape}`,
    'Signal IDs must use prefix DATA-NN.',
    '',
    SIGNAL_SCHEMA_HINT,
    '',
    SECRET_VALUE_PROMPT_RULE,
    '',
    // #3403: only when a listed file carries the test-code label (tag mode),
    // so the default prompt (and its cassette hash) is unchanged.
    ...(testCodeMarked ? [TEST_CODE_PROMPT_RULE, ''] : []),
    `Source files scanned (${files.length} files):`,
    files.map(f => `  ${f.kind}: ${f.relativePath}`).join('\n'),
    '',
  ];

  if (files.length === 0) {
    parts.push('WARNING: No source files were found. Emit a single DATA-01 signal noting limited source coverage.');
    parts.push('Do NOT fabricate compliance gaps without source evidence.');
  } else {
    for (const f of files) {
      parts.push(`--- ${f.relativePath} (${f.kind}) ---`);
      parts.push(f.content);
      parts.push('');
    }
  }

  if (saudiCccActive) {
    parts.push(SAUDI_TIER_PROMPT_APPEND);
  }

  return parts.join('\n');
}

// #3064 / #3423: extensions the deterministic PII scan reads (exported for the
// language coverage matrix).
export const PII_SCAN_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.js', '.java', '.py', '.cs', '.go', '.kt', '.rs',
  '.prisma', '.graphql', '.sql', '.yaml', '.yml', '.json', '.env', '.example']);

// #3064: Deterministic PII field-name scanner backed by pass-03-pii-patterns.yaml.
// Runs before the LLM pass. Provides coverage when LLM is not configured and
// supplements LLM findings with exact-match pattern evidence.
function runDeterministicPiiScan(
  sourcePath: string,
  workspacePath: string,
): Array<{ id: string; name: string; file: string; line?: number; data_category: string; severity: string }> {
  const catalogue = loadPassCatalog(workspacePath, 'pass-03-pii-patterns.yaml');
  if (!catalogue) return [];

  const hits: Array<{ id: string; name: string; file: string; line?: number; data_category: string; severity: string }> = [];

  // #3428: central source scope (same depth guard as the old walkFiles).
  const allFiles = listSourceFiles(sourcePath, { purpose: 'code', maxDepth: 6, extensions: PII_SCAN_EXTENSIONS });

  // #3410: shared catalogue matcher. PII patterns are field-name fragments,
  // so the catalogue default is `segment` matching: `kvnr` still matches
  // `kvnr_hash` and `patientPid` contains `pid`, but `rapid` no longer does.
  // Patterns are case-folded (no `i` flag) and pass the ReDoS guard.
  const defaultMode = catalogue.match_defaults?.match ?? 'segment';
  const rules: ScanRule<string>[] = [];
  for (const entry of catalogue.entries) {
    const pattern = entry.pattern as string | undefined;
    if (!pattern) continue;
    const mode = MatchModeSchema.safeParse(entry.match);
    const c = compileRegexMatcher(pattern, { match: mode.success ? mode.data : defaultMode });
    if (!c.ok) continue;
    rules.push({ key: String(entry.id), matcher: c.matcher, via: 'pattern' });
  }
  // One signal per PII pattern id, first file (walk order) and first line win.
  const scan = scanCatalogueRules(allFiles, rules, { maxHitsPerKey: 1 });

  for (const entry of catalogue.entries) {
    const first = scan.hits.get(String(entry.id))?.[0];
    if (!first || hits.some((h) => h.id === String(entry.id))) continue;
    hits.push({
      id: String(entry.id),
      name: String(entry.name),
      file: first.file,
      line: first.line,
      data_category: String(entry.data_category ?? 'pii'),
      severity: String(entry.severity ?? 'medium'),
    });
  }

  return hits;
}

export async function runDataPass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, workspacePath, iter, assessedAt, llm } = ctx;

  // #3064: always run deterministic PII scan; provides coverage without LLM
  const deterministicHits = runDeterministicPiiScan(sourcePath, workspacePath);

  if (!llm) {
    // LLM-optional alignment (#0550): no provider configured.
    // With deterministic catalogue available, emit DATA signals instead of a bare skip.
    // IDs must match SIGNAL_ID_REGEX (PREFIX-NN): the LLM pass does not run on this
    // path, so DATA-01..DATA-99 cannot collide (an earlier DATA-D01 form failed the
    // pass schema and aborted assess --skip-llm, found at the v1.4.0 smoke).
    if (deterministicHits.length > 0) {
      const signals: Signal[] = deterministicHits.slice(0, 99).map((hit, i) => ({
        id: `DATA-${String(i + 1).padStart(2, '0')}`,
        source: 'static_analysis' as const,
        category: 'application' as const,
        severity: hit.severity === 'critical' ? 'high' : hit.severity === 'high' ? 'high' : 'medium',
        derivation: `Regulated PII field pattern detected: ${hit.name}. Category: ${hit.data_category}. Deterministic pattern match -- verify via LLM classification for full context.`,
        evidence: [`${hit.file}${hit.line !== undefined ? `:${hit.line}` : ''}`],
        confidence: 'medium' as const,
      }));
      return {
        pass: { id: 3, name: 'data_classification', signal_prefix: 'DATA', status: 'complete', iter, assessed_at: assessedAt },
        signals,
        assessment: {
          note: 'Deterministic PII scan only (LLM not configured). Configure an LLM provider for full data classification.',
          data_classes: deterministicHits.map((h) => h.data_category),
          deterministic_hits: deterministicHits.length,
        },
      };
    }
    return llmSkipResult({ id: 3, name: 'data_classification', signalPrefix: 'DATA', iter, assessedAt });
  }

  // #1144: detect Saudi CCC regimes to extend the prompt with data-tier classification
  const activeRegimes = readRegimesActive(workspacePath);
  const saudiCccActive = activeRegimes.some(r => SAUDI_CCC_REGIMES.has(r));

  // #3403: in tag mode the model is told which files are test code (exclude
  // mode never lists them; include mode leaves the prompt as it was).
  const collected = collectDataFiles(sourcePath);
  const files = ctx.testCode === 'tag'
    ? collected.map((f) => (getSourceScope(sourcePath).isTestRel(f.relativePath)
      ? { ...f, kind: `${f.kind}${TEST_CODE_KIND_SUFFIX}` }
      : f))
    : collected;
  const testCodeMarked = files.some((f) => f.kind.endsWith(TEST_CODE_KIND_SUFFIX));
  // #3415: credential literals in the files sent to the model; masked wherever
  // the model repeats them (quoted or not, with or without secret_value).
  const sourceSecrets = files.flatMap((f) => extractCredentialValues(f.content));
  const prompt = buildDataPrompt(files, saudiCccActive, testCodeMarked);
  const raw = await llm.complete(prompt);

  // #1096: strip leading/trailing garbage (stray `=`, markdown fences) before
  // parsing. The model occasionally prepends non-JSON characters; safeSlice
  // finds the first `{` and last `}` to recover the valid object boundary.
  // #1112: on truncation (no closing `}`), attempt one recovery by appending `}}`
  // before giving up; if still invalid, degrade to WARN with empty signals.
  function tryParseDataResponse(text: string): LlmPassResponse | null {
    const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    const candidate = fenced ? fenced[1]! : text;
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    const slice = first >= 0 && last >= 0 ? candidate.slice(first, last + 1) : candidate;
    try { return JSON.parse(slice) as LlmPassResponse; } catch { return null; }
  }
  let parsed = tryParseDataResponse(raw);
  if (!parsed) {
    parsed = tryParseDataResponse(raw + ']}');
  }
  if (!parsed) {
    // #3415: the raw response may echo a secret; the console line is guarded.
    console.warn(`[warn] DATA pass: LLM response truncated or non-JSON -- signals skipped.\n${guardSecretText(maskKnownSecretsDeep(raw, sourceSecrets) as string).text.slice(0, 200)}`);
    // #3158: follow the llmSkipResult convention (not_applicable + DATA-00)
    // instead of a 0-signal `stub`, which read as stub data downstream.
    return llmInvalidResponseResult({
      id: 3, name: 'data_classification', signalPrefix: 'DATA', iter, assessedAt,
      detail: 'response truncated or not valid JSON',
      assessment: { note: 'DATA pass skipped: LLM returned a truncated response. Re-run the assessment to retry.' },
    });
  }

  // #3415: mask detected secret values before the signals leave the pass.
  // Every reported secret_value is also masked in the assessment block. The
  // credential literals in the files sent to the model are added, so a value
  // the model repeats unquoted and without secret_value is still masked.
  const allSecrets = [...new Set([
    ...collectSecretValues(parsed.signals),
    ...sourceSecrets,
  ])].sort((a, b) => b.length - a.length);
  const signals: Signal[] = parsed.signals.map((s) => normalizeSignal(maskDataSignalSecrets(s, allSecrets)));
  const assessment = guardSecretsDeep(maskKnownSecretsDeep(parsed.assessment, allSecrets) as typeof parsed.assessment).value;

  return {
    pass: {
      id: 3,
      name: 'data_classification',
      signal_prefix: 'DATA',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals,
    assessment,
  };
}

// ---------------------------------------------------------------------------
// #3415: secret masking at source (Design 032 section 11.6)
// ---------------------------------------------------------------------------

/**
 * Prompt rule: the model returns any detected secret literal in a separate
 * `secret_value` field (never in derivation / evidence), so masking is
 * deterministic. The field is stripped before the signal is stored.
 */
export const SECRET_VALUE_PROMPT_RULE = [
  'SECRETS: if a file contains a hard-coded password, token, API key or other credential,',
  'NEVER write the secret value into "derivation", "evidence" or any other field.',
  'Describe it by type and location only (e.g. "hard-coded password in src/test/TestHelper.java:42").',
  'Put the literal value ONLY in an extra field "secret_value": "<value>" on that signal; SWAO masks it.',
].join('\n');

/** The `secret_value` entries (string or string array) of raw LLM signals, longest first. */
export function collectSecretValues(rawSignals: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const raw of rawSignals) {
    if (raw === null || typeof raw !== 'object') continue;
    const sv = (raw as Record<string, unknown>)['secret_value'];
    for (const v of Array.isArray(sv) ? sv : [sv]) {
      if (typeof v === 'string' && v.length >= 3) out.add(v);
    }
  }
  // Longest first, so a value that contains another is masked whole.
  return [...out].sort((a, b) => b.length - a.length);
}

/** Replace every literal occurrence of the known secrets in any nested string. */
function maskKnownSecretsDeep(v: unknown, secrets: readonly string[]): unknown {
  if (secrets.length === 0) return v;
  if (typeof v === 'string') return secrets.reduce((acc, sec) => maskKnownSecret(acc, sec), v);
  if (Array.isArray(v)) return v.map((x) => maskKnownSecretsDeep(x, secrets));
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, maskKnownSecretsDeep(x, secrets)]));
  }
  return v;
}

/**
 * Mask a raw LLM signal: every occurrence of a reported `secret_value` (its
 * own plus `extraSecrets`) in any string field is replaced by
 * maskSecretValue(), the `secret_value` field is removed, and the output
 * guard then masks any credential-shaped value the model wrote despite the
 * prompt rule. Exported for tests.
 */
export function maskDataSignalSecrets<T>(raw: T, extraSecrets: readonly string[] = []): T {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const secrets = [...new Set([...collectSecretValues([raw]), ...extraSecrets])].sort((a, b) => b.length - a.length);
  const { secret_value: _secretValue, ...rest } = raw as Record<string, unknown>;
  return guardSecretsDeep(maskKnownSecretsDeep(rest, secrets)).value as T;
}
