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

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, resolve } from 'path';
import { load } from 'js-yaml';
import type { PassContext, PassResult } from '@swao/core';
import type { LlmPassResponse } from './types.js';
import type { Signal } from '@swao/core';
import { SIGNAL_SCHEMA_HINT, normalizeSignal, logPortfolio } from '@swao/core';
import { llmSkipResult } from './llm-skip.js';
import { getFileCategory, selectContextChunks, PASS_WEIGHTS } from './context-file-weights.js';
import type { ScoredChunk } from './context-file-weights.js';

function readFileSync_safe(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// Subdirs under wsp/inputs/ that the CTX pass MUST NOT walk:
// - source/     = the cloned application source (massive; analysed by static-analysis passes)
// - catalogs/   = the bundled regime catalogs + consultant overlays
// - llm-gateway/ = LLM connector YAML files; large NDJSON call logs eat the prompt budget (#1537)
const CTX_SKIP_TOP_DIRS = new Set(['source', 'catalogs', 'llm-gateway']);

// Patterns for files that are not engagement context and must be excluded from CTX
// ingestion. SBOM exports consume large prompt budgets while contributing no
// architecture context. Matched against the relative file path (#1349/#1351).
//
// #1356: lock-file patterns (package-lock.json, pnpm-lock.yaml, yarn.lock, etc.)
// are not listed here -- the extension allowlist (line ~89) only admits .md, .txt,
// .yaml, .yml, .json, .csv, so .lock files never reach isExcluded(). Listing them
// here was dead code and is now removed.
const CTX_EXCLUDE_PATTERNS: RegExp[] = [
  /(?:^|[/\\])(?:[^/\\]*(?:sbom|bom)[^/\\]*)\.xlsx\.[^/\\]*\.csv$/i,  // SBOM Excel sheet exports (e.g. SBOM-app.xlsx.Sheet.csv, bom.xlsx.ffae1b.csv)
  /\.cdx\.json$/i,             // CycloneDX SBOM exports
  // #1349: lock files that bypass the extension filter because they end in .json or .yaml.
  // yarn.lock / Cargo.lock / *.lock are dropped earlier by the extension allowlist.
  /(?:^|[/\\])package-lock\.json$/i,
  /(?:^|[/\\])pnpm-lock\.yaml$/i,
];

function isExcluded(relPath: string): boolean {
  return CTX_EXCLUDE_PATTERNS.some((re) => re.test(relPath));
}

const CTX_CHUNK_SIZE = 3_000;

// Chunk is a ScoredChunk -- category replaces the old tier field (#2958).
type Chunk = ScoredChunk;

// #1236/#1500: Anthropic streaming timeout fires at ~60s; observed safe threshold
// is ~25,800 chars (42s). Default 28,000 gives 25% headroom below the failing
// 39,764-char prompt. SWAO_CTX_PROMPT_MAX_CHARS env var overrides (max 110000 for
// advanced use; only raise on a model/endpoint whose timeout is confirmed larger).
// #2957: raised ceiling from 55000 to 110000 for large workspace support.
const CTX_PROMPT_MAX_CHARS = Math.min(
  parseInt(process.env['SWAO_CTX_PROMPT_MAX_CHARS'] ?? '55000', 10) || 55_000,
  110_000,
);

/** Read context.allocations and context.categories from .swao.yml (#2968). */
function readContextConfig(workspacePath: string): {
  allocations: Record<string, number>;
  categories: Record<string, number>;
} {
  const ymlPath = join(workspacePath, '.swao.yml');
  if (!existsSync(ymlPath)) return { allocations: {}, categories: {} };
  try {
    const parsed = load(readFileSync(ymlPath, 'utf-8')) as { context?: { allocations?: Record<string, number>; categories?: Record<string, number> } } | null;
    const ctx = parsed?.context ?? {};
    return {
      allocations: ctx.allocations ?? {},
      categories: ctx.categories ?? {},
    };
  } catch {
    return { allocations: {}, categories: {} };
  }
}

/** Walk wsp/inputs/, apply exclusions, split into CTX_CHUNK_SIZE chunks, return tiered chunks. */
function collectChunks(importsDir: string): { chunks: Chunk[]; filesExcluded: string[] } {
  if (!existsSync(importsDir)) return { chunks: [], filesExcluded: [] };
  const allowed = new Set(['.md', '.txt', '.yaml', '.yml', '.json', '.csv']);
  const chunks: Chunk[] = [];
  const filesExcluded: string[] = [];

  function walk(dir: string, prefix: string): void {
    const entries = readdirSync(dir).sort();
    for (const entry of entries) {
      if (prefix === '' && CTX_SKIP_TOP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full, rel);
        continue;
      }
      const ext = extname(entry).toLowerCase();
      if (!allowed.has(ext)) continue;
      if (isExcluded(rel)) {
        filesExcluded.push(rel);
        continue;
      }
      const content = readFileSync_safe(full);
      if (!content) continue;
      const category = getFileCategory(rel);
      // Split into fixed-size chunks with part labels.
      const totalParts = Math.max(1, Math.ceil(content.length / CTX_CHUNK_SIZE));
      for (let p = 0; p < totalParts; p++) {
        const sliceContent = content.slice(p * CTX_CHUNK_SIZE, (p + 1) * CTX_CHUNK_SIZE);
        chunks.push({
          relativePath: rel,
          partNum: p + 1,
          totalParts,
          content: sliceContent,
          charCount: sliceContent.length,
          category,
        });
      }
    }
  }

  walk(importsDir, '');
  return { chunks, filesExcluded };
}

function buildCtxPrompt(
  importsDir: string,
  chunks: Chunk[],
  filesExcluded: string[],
  opts?: { budgetOverride?: number; userCategories?: Record<string, number> },
): {
  prompt: string;
  chunksIncluded: number;
  chunksExcluded: number;
  budgetExcludedFiles: Set<string>;
} {
  const effectiveBudget = opts?.budgetOverride != null
    ? Math.min(opts.budgetOverride, 110_000)
    : CTX_PROMPT_MAX_CHARS;
  const header = [
    'CONTEXT_INGESTION_PASS',
    `wsp/inputs/ directory: ${importsDir}`,
    `Chunks available: ${chunks.length}  Files excluded by pattern: ${filesExcluded.length}`,
    'Ingest all context inputs. Detect contradictions between documents and code evidence. Identify data gaps.',
    'Return JSON: { "signals": [...], "assessment": { "context_inputs_found": number, "contradictions_detected": number }, "context_overrides": [] }',
    'Signal IDs must use prefix CTX-NN.',
    '',
    SIGNAL_SCHEMA_HINT,
    '',
  ].join('\n');

  if (chunks.length === 0) {
    return {
      prompt: header + '\nNo import files found. Emit a CTX signal noting reduced context coverage.',
      chunksIncluded: 0,
      chunksExcluded: 0,
      budgetExcludedFiles: new Set(),
    };
  }

  // Category-weight selection (#2958): replaces tier sort with relevance-weighted
  // ordering. Architecture/compliance/intake rank highest for pass-04; terraform
  // and structured files rank lower to prevent large JSON state files exhausting
  // the budget before prose docs are included.
  // #2968: userCategories from .swao.yml context.categories applied as multipliers.
  const budgetForChunks = effectiveBudget - header.length;
  const { included, excluded } = selectContextChunks(chunks, budgetForChunks, '04', opts?.userCategories);

  const parts: string[] = [header];
  for (const chunk of included) {
    const label = chunk.totalParts > 1
      ? `--- ${chunk.relativePath} [part ${chunk.partNum}/${chunk.totalParts}] ---`
      : `--- ${chunk.relativePath} ---`;
    parts.push(label);
    parts.push(chunk.content);
    parts.push('');
  }

  if (excluded.length > 0) {
    const excludedByFile = new Map<string, number>();
    for (const c of excluded) {
      excludedByFile.set(c.relativePath, (excludedByFile.get(c.relativePath) ?? 0) + 1);
    }
    const excludedSummary = [...excludedByFile.entries()]
      .map(([f, n]) => `${f} (${n} chunk${n !== 1 ? 's' : ''})`)
      .join(', ');
    const first = excluded[0];
    const firstWeight = PASS_WEIGHTS['04']?.[first.category] ?? 1.0;
    console.warn(
      `[warn] CTX: ${excluded.length} chunk(s) from ${excludedByFile.size} file(s) excluded -- prompt budget exhausted` +
      ` (${effectiveBudget} chars max).` +
      ` First excluded: ${first.relativePath}, category=${first.category}, weight=${firstWeight} for pass 04.` +
      ` Excluded: ${excludedSummary}.` +
      ` Set SWAO_CTX_PROMPT_MAX_CHARS=<chars> (max 110000) or context.allocations.ctx in .swao.yml to increase the cap.`,
    );
  }

  return {
    prompt: parts.join('\n'),
    chunksIncluded: included.length,
    chunksExcluded: excluded.length,
    budgetExcludedFiles: new Set(excluded.map((c) => c.relativePath)),
  };
}

export async function runCtxPass(ctx: PassContext): Promise<PassResult> {
  const { workspacePath, iter, assessedAt, llm } = ctx;

  if (!llm) {
    // LLM-optional alignment (#0550): no provider configured -> graceful skip.
    return llmSkipResult({ id: 4, name: 'context_ingestion', signalPrefix: 'CTX', iter, assessedAt });
  }

  // #0227: context inputs live under wsp/inputs/ (per-app scope). The
  // walker skips wsp/inputs/source/ (cloned app source) and
  // wsp/inputs/catalogs/ (regime catalogs) -- see CTX_SKIP_TOP_DIRS.
  // #1351: files are now split into 3000-char chunks sorted by priority tier
  // (T1 prose > T2 YAML > T3 CSV > T4 JSON) and filled greedily into the
  // prompt budget. SBOM exports and lock files are excluded by pattern (#1349).
  const importsDir = join(workspacePath, 'wsp', 'inputs');
  const { chunks, filesExcluded } = collectChunks(importsDir);
  const ctxConfig = readContextConfig(workspacePath);
  // Priority: explicit .swao.yml allocation > connector-derived budget (#2959) > env/default constant
  const budgetOverride = ctxConfig.allocations['ctx'] ?? ctx.ctxPromptBudget;
  const userCategories = Object.keys(ctxConfig.categories).length > 0 ? ctxConfig.categories : undefined;

  // C-09: Placeholder detection BEFORE the LLM call (#0468).
  // Files still containing sample/placeholder text will cause the LLM to
  // hallucinate findings based on fabricated data -- warn early.
  const PLACEHOLDER_PATTERNS = [
    /Sample\s*\/\s*placeholder/i,
    /replace-with-/i,
    /Replace before the assessment/i,
  ];
  const placeholderFiles: string[] = [];
  const seenFiles = new Set<string>();
  for (const chunk of chunks) {
    if (seenFiles.has(chunk.relativePath)) continue;
    seenFiles.add(chunk.relativePath);
    if (PLACEHOLDER_PATTERNS.some((p) => p.test(chunk.content))) {
      placeholderFiles.push(chunk.relativePath);
      console.warn(`[warn] CTX: ${chunk.relativePath} contains placeholder text -- findings may be hallucinated`);
    }
  }

  if (filesExcluded.length > 0) {
    console.log(`[info] CTX: ${filesExcluded.length} file(s) excluded by pattern (SBOM exports / lock files): ${filesExcluded.join(', ')}`);
  }

  const { prompt, chunksIncluded, chunksExcluded, budgetExcludedFiles } = buildCtxPrompt(
    importsDir, chunks, filesExcluded,
    { budgetOverride, userCategories },
  );

  // #1697: warn before the LLM call when the configured token ceiling is smaller
  // than the expected CTX response size. The CTX pass emits ~6000-8000 output
  // tokens for a typical workspace; if MODEL_OUTPUT_CEILING < 8000, the response
  // will be truncated mid-JSON and quality.truncated will be set in the CallRecord.
  const EXPECTED_CTX_RESPONSE_TOKENS = 8000;
  const MODEL_OUTPUT_CEILING = parseInt(process.env['SWAO_TOKEN_CEILING'] ?? '8192', 10);
  if (MODEL_OUTPUT_CEILING < EXPECTED_CTX_RESPONSE_TOKENS) {
    logPortfolio('warn', 'ctx.pass.ceiling-risk',
      `Token ceiling (${MODEL_OUTPUT_CEILING}) is below the expected CTX response size (${EXPECTED_CTX_RESPONSE_TOKENS}). ` +
      `CTX pass output may be truncated -- set SWAO_TOKEN_CEILING to at least ${EXPECTED_CTX_RESPONSE_TOKENS}.`,
      { context: { ceiling: MODEL_OUTPUT_CEILING, expected: EXPECTED_CTX_RESPONSE_TOKENS } },
    );
  }

  const raw = await llm.complete(prompt);

  // #1096 defensive: strip leading/trailing garbage before parsing (same
  // pattern as pass-03 and pass-12).
  let parsed: LlmPassResponse & { context_overrides?: unknown[] };
  try {
    let candidate = raw;
    const fenceOpen = raw.indexOf('```');
    if (fenceOpen !== -1) {
      const contentStart = raw.indexOf('\n', fenceOpen);
      if (contentStart !== -1) {
        const closingFence = raw.indexOf('\n```', contentStart + 1);
        if (closingFence !== -1) {
          candidate = raw.slice(contentStart + 1, closingFence);
        }
      }
    }
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    const slice = first >= 0 && last >= 0 ? candidate.slice(first, last + 1) : raw;
    parsed = JSON.parse(slice) as LlmPassResponse & { context_overrides?: unknown[] };
  } catch {
    // #1677: detect likely token-ceiling truncation. When the LLM hits its max
    // output token limit the response is cut off mid-JSON and the HTTP status
    // is still 200 -- there is no "finish_reason: length" surfaced to us.
    // Heuristic: if the raw response is long AND does not end with a closing
    // brace, the JSON was truncated at the ceiling rather than being malformed.
    const rawTrimmed = raw.trimEnd();
    const likelyTruncated = raw.length > 5_000 && !rawTrimmed.endsWith('}') && !rawTrimmed.endsWith(']');
    const truncNote = likelyTruncated
      ? ' (response truncated at token ceiling -- switch to a model with higher max_tokens or reduce input file set)'
      : '';
    if (likelyTruncated) {
      logPortfolio('warn', 'ctx.pass.truncation-detected',
        `CTX: LLM response appears truncated at token ceiling (${raw.length} chars, no closing brace).` + truncNote,
        { context: { raw_length: raw.length, likely_truncated: true } },
      );
    }
    logPortfolio('error', 'ctx.pass.json-parse-error',
      `CTX pass: LLM response is not valid JSON.${truncNote}`,
      { context: { raw_response_prefix: raw.slice(0, 200), raw_length: raw.length, likely_truncated: likelyTruncated } },
    );
    // #2441: return a graceful skip rather than throwing so the rest of the assessment continues.
    // The error is already logged above; the pass file shows a single CTX-00 skip signal.
    return llmSkipResult({ id: 4, name: 'context_ingestion', signalPrefix: 'CTX', iter, assessedAt });
  }

  const signals: Signal[] = parsed.signals.map(normalizeSignal);

  // C-10: Evidence file verification AFTER the LLM call (#0468).
  // Guard against path traversal (LLM output is untrusted): resolve each
  // evidence reference and confirm it stays within importsDir.
  // Known file extensions for evidence path normalisation.
  // Uses a suffix-anchored scan (no ^.* prefix) to avoid O(n^2) backtracking
  // on long LLM-generated strings (CodeQL js/polynomial-redos).
  const EXT_RE = /\.(md|txt|yaml|yml|json|csv|xlsx?|pdf|docx?)\b/i;
  const matchKnownExt = (s: string): string | null => {
    const m = EXT_RE.exec(s);
    return m ? s.slice(0, m.index + m[0].length) : null;
  };
  // Heuristic: references that describe ABSENCE of data (not file paths) start with
  // phrases like "no ", "not ", "absent", "missing" or contain no file extension.
  // They are valid CTX observations but not file-resolvable (#0998).
  const NEGATIVE_EVIDENCE_RE = /^(no |not |absent|missing|empty|none |zero |without |\[absent)/i;

  const resolvedImportsDir = resolve(importsDir);
  const WSP_INPUTS_PREFIX = 'wsp/inputs/';
  for (const signal of signals) {
    const unresolvable: string[] = [];
    for (const evidenceRef of signal.evidence ?? []) {
      // Evidence refs may include a row qualifier after ':' (e.g. 'cmdb/file.csv:row 3').
      // Strip the qualifier before resolving so the file-existence check uses only the path.
      const colonStripped = evidenceRef.split(':')[0].trim();
      // Negative-evidence observations describe absence of data, not a missing file (#0998).
      // Log at INFO and skip file resolution to avoid spurious WARN noise.
      if (NEGATIVE_EVIDENCE_RE.test(colonStripped) && !matchKnownExt(colonStripped)) {
        console.log(`[info] CTX ${signal.id}: negative-evidence observation (not a file path): '${evidenceRef}'`);
        continue;
      }
      // Also strip space-separated section descriptions after the file extension
      // (e.g. 'other/doc.md section 1 & 11' -> 'other/doc.md').
      const evidencePath = matchKnownExt(colonStripped) ?? colonStripped;
      // Multi-form resolution (#0997): LLM alternates between short form
      // ('architecture/file.md') and full form ('wsp/inputs/architecture/file.md').
      // Try direct join first; if not found and path starts with 'wsp/inputs/',
      // strip that prefix and retry within importsDir.
      let resolved = resolve(importsDir, evidencePath);
      if (!existsSync(resolved) && evidencePath.startsWith(WSP_INPUTS_PREFIX)) {
        const stripped = resolve(importsDir, evidencePath.slice(WSP_INPUTS_PREFIX.length));
        if (stripped.startsWith(resolvedImportsDir)) resolved = stripped;
      }
      // #2962: check budget-exclusion BEFORE existsSync. Budget-excluded files DO
      // exist on disk but were dropped from the context payload by the budget ceiling.
      const relEvidencePath = evidencePath.startsWith(WSP_INPUTS_PREFIX)
        ? evidencePath.slice(WSP_INPUTS_PREFIX.length)
        : evidencePath;
      const isBudgetExcluded = budgetExcludedFiles.has(relEvidencePath) || budgetExcludedFiles.has(evidencePath);

      if (!resolved.startsWith(resolvedImportsDir)) {
        // Path traversal attempt -- flag without following
        signal.false_positive_flag = true;
        signal.false_positive_note = `Evidence reference escapes workspace: ${evidenceRef}`;
        console.warn(`[warn] CTX ${signal.id}: evidence '${evidenceRef}' escapes workspace bounds`);
      } else if (isBudgetExcluded) {
        // File exists but was excluded from the context prompt by budget ceiling.
        // Annotate as a context gap rather than a false positive.
        signal.context_gaps = [...(signal.context_gaps ?? []), evidenceRef];
        unresolvable.push(`[budget-excluded] ${evidenceRef}`);
      } else if (!existsSync(resolved)) {
        signal.false_positive_flag = true;
        signal.false_positive_note = `Evidence file not found: ${evidenceRef}`;
        unresolvable.push(evidenceRef);
      }
    }
    if (unresolvable.length > 0) {
      const budgetExcludedRefs = unresolvable.filter((r) => r.startsWith('[budget-excluded] '));
      const missingRefs = unresolvable.filter((r) => !r.startsWith('[budget-excluded] '));
      if (budgetExcludedRefs.length > 0) {
        console.warn(
          `[warn] CTX ${signal.id}: ${budgetExcludedRefs.length} evidence file(s) budget-excluded -- cited but not verified: ` +
          budgetExcludedRefs.map((r) => `'${r.slice('[budget-excluded] '.length)}'`).join(', '),
        );
      }
      if (missingRefs.length > 0) {
        console.warn(`[warn] CTX ${signal.id}: ${missingRefs.length} evidence reference(s) could not be resolved: ${missingRefs.map((r) => `'${r}'`).join(', ')}`);
      }
    }
  }

  const uniqueFiles = new Set(chunks.map((c) => c.relativePath)).size;
  const assessment: Record<string, unknown> = {
    ...parsed.assessment,
    context_inputs_found: uniqueFiles,
    chunks_included: chunksIncluded,
    chunks_excluded: chunksExcluded,
    files_excluded_by_pattern: filesExcluded,
    placeholder_inputs: placeholderFiles,
  };

  if (parsed.context_overrides && parsed.context_overrides.length > 0) {
    assessment.context_overrides = parsed.context_overrides;
  }

  return {
    pass: {
      id: 4,
      name: 'context_ingestion',
      signal_prefix: 'CTX',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals,
    assessment,
  };
}
