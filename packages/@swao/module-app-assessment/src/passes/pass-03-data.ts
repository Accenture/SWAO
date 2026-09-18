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
import { join, extname, relative } from 'path';
import { load } from 'js-yaml';
import type { PassContext, PassResult } from '@swao/core';
import type { LlmPassResponse } from './types.js';
import type { Signal } from '@swao/core';
import { SIGNAL_SCHEMA_HINT, normalizeSignal } from '@swao/core';
import { llmSkipResult } from './llm-skip.js';

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
  function walk(dir: string, depth: number): void {
    if (depth > 7) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === 'target' || entry === '.git' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (seen.has(full)) continue;
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full, depth + 1);
        } else {
          const ext = extname(entry).toLowerCase();
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
        }
      } catch { /* skip */ }
    }
  }
  walk(sourcePath, 0);

  // ---- 4. If still sparse, add auth / user handler files by name pattern ----
  if (results.filter(r => r.kind === 'source:privacy').length < 3) {
    const authPatterns = ['auth', 'user', 'account', 'profile', 'settings', 'delete', 'export', 'consent'];
    // eslint-disable-next-line no-inner-declarations
    function walkForHandlers(dir: string, depth: number): void {
      if (depth > 7) return;
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === 'target' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (seen.has(full)) continue;
        try {
          const st = statSync(full);
          if (st.isDirectory()) {
            walkForHandlers(full, depth + 1);
          } else {
            const ext = extname(entry).toLowerCase();
            if (SOURCE_EXTENSIONS.has(ext)) {
              const nameLower = entry.toLowerCase();
              if (authPatterns.some(p => nameLower.includes(p))) {
                const c = readSafe(full);
                if (c && hasPrivacyKeyword(c)) {
                  const rel = relative(sourcePath, full).replace(/\\/g, '/');
                  results.push({ relativePath: rel, content: c.slice(0, 2500), kind: 'source:handler', priority: 3 });
                  seen.add(full);
                }
              }
            }
          }
        } catch { /* skip */ }
      }
    }
    walkForHandlers(sourcePath, 0);
  }

  // Sort by priority, cap total
  results.sort((a, b) => a.priority - b.priority);
  return results.slice(0, cap);
}

function buildDataPrompt(
  files: Array<{ relativePath: string; content: string; kind: string }>,
  saudiCccActive: boolean,
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

export async function runDataPass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, workspacePath, iter, assessedAt, llm } = ctx;

  if (!llm) {
    // LLM-optional alignment (#0550): no provider configured -> emit a
    // graceful skip signal and let the assessment complete, rather than
    // aborting the whole run.
    return llmSkipResult({ id: 3, name: 'data_classification', signalPrefix: 'DATA', iter, assessedAt });
  }

  // #1144: detect Saudi CCC regimes to extend the prompt with data-tier classification
  const activeRegimes = readRegimesActive(workspacePath);
  const saudiCccActive = activeRegimes.some(r => SAUDI_CCC_REGIMES.has(r));

  const files = collectDataFiles(sourcePath);
  const prompt = buildDataPrompt(files, saudiCccActive);
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
    console.warn(`[warn] DATA pass: LLM response truncated or non-JSON -- signals skipped.\n${raw.slice(0, 200)}`);
    return {
      pass: { id: 3, name: 'data_classification', signal_prefix: 'DATA', status: 'stub', iter, assessed_at: assessedAt },
      signals: [],
      assessment: { note: 'DATA pass skipped: LLM returned a truncated response. Re-run the assessment to retry.' },
    };
  }

  const signals: Signal[] = parsed.signals.map(normalizeSignal);

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
    assessment: parsed.assessment,
  };
}
