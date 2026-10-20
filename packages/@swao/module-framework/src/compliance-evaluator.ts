// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { load } from 'js-yaml';
import { z } from 'zod';
import type { PassContext, PassResult } from '@swao/core';
import type {
  Signal,
  LlmProvider,
  EvalOptions,
  ComplianceResult,
  ComplianceEvaluatorContribution,
  SwaoModuleManifest,
} from '@swao/core';
import { loadRegimeRegistry, loadRegimeCatalogue } from '@swao/core';
import { communityCatalogueContribution } from './community-catalogue.js';

// Cross-cutting "no LLM provider" marker. The same literal is the de-facto
// contract across the host (doctor, assess, data-quality-banner), core
// (run-manifest), and app-assessment's llm-skip.ts; doctor + the HTML report
// health section detect it uniformly (#0550). Defined locally so the framework
// module owns no app-assessment dependency (the DAG forbids module -> module).
const NO_LLM_REASON = 'no_llm_provider';

// LLM-driven compliance evaluation (#0233).
//
// Reads:
//   - All signals emitted by passes 01-09 from <app>/wsp/runs/<latest>/passes/.
//   - Selected regime IDs from <app>/.swao.yml regimes: [].
//   - Each selected regime's catalog from <workspace>/wsp/inputs/catalogs/
//     via loadRegimeRegistry, which walks both `standard/` (index.yaml shape)
//     and `community/` (folder-per-framework shape, design 029 §11). The
//     community catalogues honour `regime_meta.replaces:` for supersession
//     over same-id standard regimes. Sprint-037 #0341 wired this from the
//     previous standard-only direct readdir path.
//
// Per regime, controls are evaluated in batches of 20. For each batch the
// LLM returns a JSON document with one outcome (SATISFIED / PARTIAL /
// GAP / UNKNOWN / N_A) + rationale + signal_refs + evidence_ids per
// control. Output is Zod-validated; malformed batches fall back to
// UNKNOWN with rationale "evaluation failed".
//
// Output structure consumed by derive-plan.ts -> star.ts:
//   assessment.regimes: [
//     { id, name, version, status: 'evaluated', controls: [<evaluated>...] }
//   ]
// Signals emitted are roll-up COMP-<regime> per regime, summarising
// counts of GAP / PARTIAL / SATISFIED across that regime's controls.

const BATCH_SIZE = 20;

/**
 * #3222: upper bound on in-flight Pass 11 LLM calls. The batch calls of all
 * selected regimes are independent, so they are sent concurrently instead of
 * one after another (a service run spent about 131 s on four sequential
 * calls).
 *
 * #3284 (Design 110 D-14): the provider layer now owns the limit. Pass 11
 * sizes its fan-out from `llm.maxConcurrency` (configured by
 * `providers.llm.max_concurrency`, default 4) and the provider-level limiter
 * bounds in-flight requests across all passes. This constant is only the
 * fallback for providers that do not report a limit (fixtures, stubs).
 */
export const COMPLIANCE_LLM_MAX_CONCURRENCY = 4;

/** Pass 11 fan-out width: the provider's limit, else the fallback (#3284). */
export function complianceLlmConcurrency(llm: { readonly maxConcurrency?: number } | undefined): number {
  const n = llm?.maxConcurrency;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : COMPLIANCE_LLM_MAX_CONCURRENCY;
}

/**
 * Run `fn` over `items` with at most `limit` calls in flight. Results keep
 * the order of `items`. `fn` must not throw (callers catch per item).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: width }, () => worker()));
  return out;
}

const ControlEvaluationSchema = z.object({
  id: z.string(),
  outcome: z.enum(['SATISFIED', 'PARTIAL', 'GAP', 'UNKNOWN', 'N_A']),
  rationale: z.string(),
  signal_refs: z.array(z.string()).optional().default([]),
  evidence_ids: z.array(z.string()).optional().default([]),
  remediation: z.string().optional().default(''),
});

const BatchResponseSchema = z.object({
  controls: z.array(ControlEvaluationSchema),
});

interface CatalogControl {
  id: string;
  title?: string;
  description?: string;
  severity_default?: string;
  references?: string[];
  // #0348 (sprint-038) tag taxonomy: per-framework `axis.value` +
  // universal `applies-to.*` strings. #0360 (sprint-039) carries these
  // through Pass 11 into wsp-plan.yaml so the auditor view can render
  // them inline.
  tags?: string[];
}

interface RegimeCatalog {
  regime_meta?: { id?: string; name?: string; version?: string };
  controls?: CatalogControl[];
}

interface EvaluatedControl {
  id: string;
  title: string;
  description: string;
  severity: string;
  outcome: string;
  status: string;
  rationale: string;
  signal_refs: string[];
  evidence_ids: string[];
  remediation: string;
  assessor: string;
  assessed_at: string;
  // #0360 -- tags copied from catalogue; LLM does not generate them.
  // Always present (empty array if catalogue carries none).
  tags: string[];
}

// Resolve the current run's passes/ dir via latest.txt. Falls back to
// the legacy flat <wspDir>/passes/ if no run is recorded yet.
function resolvePassesDir(workspacePath: string): string {
  const wspDir = join(workspacePath, 'wsp');
  const latestFile = join(wspDir, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const rel = readFileSync(latestFile, 'utf-8').trim();
      const candidate = join(wspDir, rel, 'passes');
      if (existsSync(candidate)) return candidate;
    } catch { /* fall through */ }
  }
  return join(wspDir, 'passes');
}

// #1282: accept ctx.passesDir override (current run, before latest.txt is written).
// Falls back to resolvePassesDir (latest.txt) for standalone / post-run callers.
export function loadAllSignals(workspacePath: string, passesDirOverride?: string): Signal[] {
  const passesDir = passesDirOverride ?? resolvePassesDir(workspacePath);
  const signals: Signal[] = [];
  for (const file of existsSync(passesDir) ? readdirSync(passesDir).sort() : []) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    // Don't re-ingest our own output if a previous Pass 11 run wrote one.
    if (file.startsWith('11-')) continue;
    try {
      const parsed = load(readFileSync(join(passesDir, file), 'utf-8')) as { signals?: Signal[] } | null;
      if (parsed?.signals) signals.push(...parsed.signals);
    } catch { /* skip unreadable */ }
  }
  // #3154: service-mode signals written outside the passes folder (Pass 24
  // RESEARCH, Pass 25 BINARY) are evidence for the same controls.
  for (const file of APP_SIGNAL_FILES) {
    try {
      const parsed = JSON.parse(readFileSync(join(workspacePath, 'wsp', 'signals', file), 'utf-8')) as { signals?: Signal[] } | null;
      if (Array.isArray(parsed?.signals)) signals.push(...parsed.signals);
    } catch { /* absent or unreadable */ }
  }
  return signals;
}

/** App-level signal files read in addition to the run's pass files (#3154). */
export const APP_SIGNAL_FILES = ['research-signals.json', 'binary-signals.json'] as const;

function readRegimesActive(ymlPath: string): string[] {
  if (!existsSync(ymlPath)) return [];
  try {
    // Written by writeRegimesActive() in compliance/regime-picker.ts.
    // Field path: assessment.regimes_active. Round-trip test: regime-picker.test.ts (#0748/#0751).
    const yml = load(readFileSync(ymlPath, 'utf-8')) as { assessment?: { regimes_active?: string[] } } | null;
    return Array.isArray(yml?.assessment?.regimes_active) ? yml.assessment!.regimes_active : [];
  } catch { return []; }
}

/**
 * The app's own selection wins; when the app has none, the workspace-wide
 * selection applies (#3148: `swao regime-select` without `--app` writes the
 * workspace `.swao.yml`, which was previously never read).
 */
export function loadSelectedRegimes(workspacePath: string): string[] {
  const own = readRegimesActive(join(workspacePath, '.swao.yml'));
  if (own.length > 0) return own;
  // Only an app folder (<workspace>/apps/<id>) has a workspace two levels up.
  if (basename(dirname(resolve(workspacePath))) !== 'apps') return [];
  return readRegimesActive(join(resolveWorkspaceRoot(workspacePath), '.swao.yml'));
}

// Workspace root sits two levels above an app dir: <workspace>/apps/<app>.
function resolveWorkspaceRoot(workspacePath: string): string {
  return resolve(workspacePath, '..', '..');
}

function loadRegimeCatalog(workspaceRoot: string, regimeId: string): RegimeCatalog | null {
  const catalogsDir = join(workspaceRoot, 'wsp', 'inputs', 'catalogs');
  if (!existsSync(catalogsDir)) return null;
  let registry;
  try {
    registry = loadRegimeRegistry(catalogsDir);
  } catch {
    return null;
  }
  const resolved = registry.byId.get(regimeId);
  if (!resolved) return null;
  try {
    return loadRegimeCatalogue(resolved.catalogueFile) as unknown as RegimeCatalog;
  } catch {
    return null;
  }
}

function summariseSignals(signals: Signal[]): string {
  if (signals.length === 0) return '(no signals emitted in this run)';
  const lines: string[] = [];
  for (const s of signals) {
    const sev = s.severity ?? 'informational';
    const derivation = (s.derivation ?? '').replace(/\s+/g, ' ').slice(0, 280);
    lines.push(`  - ${s.id} [${sev}]: ${derivation}`);
  }
  return lines.join('\n');
}

function summariseControls(controls: CatalogControl[]): string {
  return controls.map((c) => {
    const desc = (c.description ?? '').replace(/\s+/g, ' ').slice(0, 400);
    return `  - id: ${c.id}\n    title: "${c.title ?? c.id}"\n    description: "${desc}"\n    severity_default: ${c.severity_default ?? 'medium'}`;
  }).join('\n');
}

// B-02 (#0604): keep only refs that name a real signal, and report the rest.
// The compliance LLM is told to cite signal IDs from ASSESSMENT_SIGNALS; any id
// it returns that is not in `validIds` is a hallucination. Previously these were
// dropped silently (signal_refs) or passed through unchecked (evidence_ids).
// Now both are validated and any dropped ids are logged with control context so
// a reviewer can see what the model invented.
export function validateCitedRefs(
  ids: string[],
  validIds: Set<string>,
  field: 'signal_refs' | 'evidence_ids',
  regimeId: string,
  controlId: string,
): string[] {
  const clean: string[] = [];
  const dropped: string[] = [];
  for (const id of ids) (validIds.has(id) ? clean : dropped).push(id);
  if (dropped.length > 0) {
    console.warn(
      `[warn] COMP: ${regimeId}/${controlId} dropped ${dropped.length} hallucinated ` +
      `${field} not present in assessment signals: ${dropped.join(', ')}`,
    );
  }
  return clean;
}

function buildCompliancePrompt(
  regime: { id: string; name: string; version: string },
  controls: CatalogControl[],
  signals: Signal[],
): string {
  return [
    'COMPLIANCE_EVALUATION_PASS',
    `Regime: ${regime.id} -- ${regime.name} (v${regime.version})`,
    '',
    'You are an auditor evaluating a workload against compliance controls.',
    'For each control in CONTROLS_BATCH, decide an outcome based ONLY on the',
    'evidence in ASSESSMENT_SIGNALS. Do not invent facts. If signals neither',
    'support nor contradict a control, return outcome: UNKNOWN.',
    '',
    'Outcomes:',
    '  - SATISFIED: signals positively confirm the control is met.',
    '  - PARTIAL:   signals show some elements present but gaps remain.',
    '  - GAP:       signals demonstrate the control is not met.',
    '  - N_A:       control is not applicable to this workload (justify).',
    '  - UNKNOWN:   no signals address this control either way.',
    '',
    'Cite signal IDs in signal_refs (only IDs that appear in ASSESSMENT_SIGNALS;',
    'do not invent). Provide a 2-3 sentence rationale. For PARTIAL or GAP,',
    'add a 1-sentence remediation.',
    '',
    'Output JSON ONLY, no prose, matching this shape:',
    '  { "controls": [',
    '      { "id": "<control_id>", "outcome": "SATISFIED|PARTIAL|GAP|UNKNOWN|N_A",',
    '        "rationale": "<2-3 sentences>",',
    '        "signal_refs": ["<signal_id>", ...],',
    '        "remediation": "<1 sentence; empty for SATISFIED/N_A/UNKNOWN>" },',
    '      ...',
    '    ] }',
    '',
    'ASSESSMENT_SIGNALS:',
    summariseSignals(signals),
    '',
    'CONTROLS_BATCH:',
    summariseControls(controls),
    '',
  ].join('\n');
}

// #1507: resolve signal_refs -> source file evidence -> evidence_ids.
// Unions the .evidence arrays of all cited signals. If a meaningful verdict
// (SATISFIED / PARTIAL / GAP) cites signals but none carry file evidence,
// falls back to the 'llm-inference' sentinel so auditors know the rationale
// is LLM-derived rather than document-backed.
function resolveEvidenceIds(
  signalRefs: string[],
  outcome: string,
  evidenceMap: Map<string, readonly string[]>,
): string[] {
  if (signalRefs.length === 0) {
    return ['SATISFIED', 'PARTIAL', 'GAP'].includes(outcome) ? ['llm-inference'] : [];
  }
  const evidence = new Set<string>();
  for (const ref of signalRefs) {
    for (const e of (evidenceMap.get(ref) ?? [])) evidence.add(e);
  }
  return evidence.size > 0 ? [...evidence] : ['llm-inference'];
}

function fallbackControl(c: CatalogControl, assessedAt: string, reason: string): EvaluatedControl {
  return {
    id: c.id,
    title: c.title ?? c.id,
    description: c.description ?? '',
    severity: c.severity_default ?? 'medium',
    outcome: 'UNKNOWN',
    status: 'UNKNOWN',
    rationale: reason,
    signal_refs: [],
    evidence_ids: [],
    remediation: '',
    assessor: 'rule_engine',
    assessed_at: assessedAt,
    tags: c.tags ?? [],
  };
}

function safeJsonParse(raw: string): unknown {
  // Tolerate leading prose or code-fence wrappers.
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const candidate = fenced ? fenced[1]! : raw;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first < 0 || last < 0) return null;
  try { return JSON.parse(candidate.slice(first, last + 1)); }
  catch { return null; }
}

function regimeMetaOf(catalog: RegimeCatalog, regimeId: string): { id: string; name: string; version: string } {
  return {
    id: catalog.regime_meta?.id ?? regimeId,
    name: catalog.regime_meta?.name ?? regimeId,
    version: catalog.regime_meta?.version ?? '',
  };
}

export async function runCompliancePass(ctx: PassContext): Promise<PassResult> {
  const { workspacePath, iter, assessedAt, llm, passesDir } = ctx;

  const signals = loadAllSignals(workspacePath, passesDir);
  const regimeIds = loadSelectedRegimes(workspacePath);
  const workspaceRoot = resolveWorkspaceRoot(workspacePath);

  const validSignalIds = new Set(signals.map((s) => s.id));
  // #1507: build a map of signal ID -> source file evidence paths so that
  // evidence_ids can be populated from signal_refs rather than from the LLM.
  const signalEvidenceMap = new Map<string, readonly string[]>(
    signals
      .filter((s) => Array.isArray(s.evidence) && (s.evidence as string[]).length > 0)
      .map((s) => [s.id, s.evidence as string[]]),
  );
  const regimesOut: Array<{
    id: string;
    name: string;
    version: string;
    status: string;
    controls: EvaluatedControl[];
  }> = [];
  const summarySignals: Signal[] = [];
  let signalCounter = 0;

  if (regimeIds.length === 0) {
    return {
      pass: {
        id: 11,
        name: 'compliance_evaluation',
        signal_prefix: 'COMP',
        status: 'not_applicable',
        iter,
        assessed_at: assessedAt,
      },
      signals: [],
      assessment: {
        regimes: [],
        regimes_evaluated: 0,
        controls_total: 0,
        skipped_reason: 'No regimes configured in .swao.yml',
      },
    };
  }

  // #0246: emit per-regime progress so the AssessScreen progress bar
  // can advance during the long LLM evaluation instead of looking
  // stuck at one position for 60-90 seconds. #3222: a regime with LLM
  // batches reports progress when its last batch returns; a regime without
  // batches reports when the evaluation loop below reaches it.
  let regimeProgress = 0;
  const reportProgress = (regimeId: string): void => {
    regimeProgress += 1;
    console.log(`[progress] Pass 11 -- ${regimeId} (${regimeProgress}/${regimeIds.length})`);
  };
  const catalogs = regimeIds.map((regimeId) => loadRegimeCatalog(workspaceRoot, regimeId));

  // #3222 phase A: send every regime's batch prompts concurrently (bounded by
  // the provider's limit, #3284: complianceLlmConcurrency). Prompts are built exactly as before; a
  // failed call yields null and falls back to UNKNOWN in phase B, as the
  // sequential loop did. Phase B below consumes the responses in the original
  // regime and batch order, so signal numbering and output are unchanged.
  const rawResponses: Array<Array<string | null>> = regimeIds.map(() => []);
  const regimeHasBatches: boolean[] = regimeIds.map(() => false);
  if (llm) {
    const jobs: Array<{ r: number; b: number; prompt: string }> = [];
    regimeIds.forEach((regimeId, r) => {
      const catalog = catalogs[r];
      if (!catalog) return;
      const controls = catalog.controls ?? [];
      const meta = regimeMetaOf(catalog, regimeId);
      for (let i = 0, b = 0; i < controls.length; i += BATCH_SIZE, b += 1) {
        jobs.push({ r, b, prompt: buildCompliancePrompt(meta, controls.slice(i, i + BATCH_SIZE), signals) });
      }
    });
    const pending = regimeIds.map((_, r) => jobs.filter((j) => j.r === r).length);
    pending.forEach((n, r) => { regimeHasBatches[r] = n > 0; });
    await mapWithConcurrency(jobs, complianceLlmConcurrency(llm), async (job) => {
      let raw: string | null = null;
      try { raw = await llm.complete(job.prompt); } catch { raw = null; /* UNKNOWN fallback in phase B */ }
      rawResponses[job.r]![job.b] = raw;
      pending[job.r]! -= 1;
      if (pending[job.r] === 0) reportProgress(regimeIds[job.r]!);
    });
  }

  for (let r = 0; r < regimeIds.length; r += 1) {
    const regimeId = regimeIds[r]!;
    if (!regimeHasBatches[r]) reportProgress(regimeId);
    const catalog = catalogs[r];
    if (!catalog) {
      signalCounter += 1;
      summarySignals.push({
        id: `COMP-${String(signalCounter).padStart(2, '0')}`,
        source: 'llm_inference',
        category: 'application',
        severity: 'medium',
        derivation: `Regime ${regimeId} is listed in .swao.yml but no catalog found under wsp/inputs/catalogs/{standard,community}/. Run 'swao init --reconfigure' to refresh standard catalogs, or 'swao framework install ${regimeId}' for community frameworks.`,
        evidence: [],
        confidence: 'high',
      } as Signal);
      continue;
    }

    // #0695: LLM_SELECTION controls are evaluated from LLM provider context
    // files (model cards, DPAs, conformity docs) placed in apps/{app}/context/.
    // Without those files Pass 11 will return every control as 'unknown'.
    // Warn once per regime so the operator can act rather than silently seeing
    // an empty compliance page.
    if ((catalog.regime_meta?.id ?? regimeId) === 'LLM_SELECTION') {
      const ctxDir = join(workspacePath, 'context');
      const hasContextFiles = existsSync(ctxDir) &&
        readdirSync(ctxDir).some((f) => !f.startsWith('.'));
      if (!hasContextFiles) {
        signalCounter += 1;
        summarySignals.push({
          id: `COMP-${String(signalCounter).padStart(2, '0')}`,
          source: 'static_analysis',
          category: 'application',
          severity: 'informational',
          derivation:
            '[warn] LLM_SELECTION: no provider context found -- controls will appear unverified. ' +
            'Place LLM provider documentation (model card, DPA, conformity assessment) in ' +
            `apps/{app}/context/ and re-run Pass 11 to evaluate this framework.`,
          evidence: [],
          confidence: 'high',
        } as Signal);
      }
    }

    const controls = catalog.controls ?? [];
    const regimeMeta = regimeMetaOf(catalog, regimeId);

    const evaluated: EvaluatedControl[] = [];

    for (let i = 0, b = 0; i < controls.length; i += BATCH_SIZE, b += 1) {
      const batch = controls.slice(i, i + BATCH_SIZE);
      let batchResults: z.infer<typeof BatchResponseSchema> | null = null;

      if (llm) {
        try {
          const raw = rawResponses[r]![b] ?? null;
          const parsed = raw === null ? null : safeJsonParse(raw);
          if (parsed !== null) {
            const validation = BatchResponseSchema.safeParse(parsed);
            if (validation.success) batchResults = validation.data;
          }
        } catch { /* fall through to UNKNOWN fallback */ }
      }

      for (const c of batch) {
        const llmEval = batchResults?.controls.find((ec) => ec.id === c.id);
        if (!llmEval) {
          evaluated.push(fallbackControl(c, assessedAt, llm
            ? 'LLM returned no evaluation for this control; falling back to UNKNOWN.'
            : 'No LLM provider configured; control marked UNKNOWN. Re-run with a real LLM for evaluation.'));
          continue;
        }
        // B-02 (#0604): validate the LLM-cited signal_refs against the real signal set.
        const cleanRefs = validateCitedRefs(
          llmEval.signal_refs ?? [], validSignalIds, 'signal_refs', regimeMeta.id, c.id,
        );
        // #1507: derive evidence_ids from the source-file evidence of each cited signal
        // rather than trusting the LLM to populate them (LLM was told to leave them empty).
        const derivedEvidenceIds = resolveEvidenceIds(cleanRefs, llmEval.outcome, signalEvidenceMap);
        evaluated.push({
          id: c.id,
          title: c.title ?? c.id,
          description: c.description ?? '',
          severity: c.severity_default ?? 'medium',
          outcome: llmEval.outcome,
          status: llmEval.outcome,
          rationale: llmEval.rationale,
          signal_refs: cleanRefs,
          evidence_ids: derivedEvidenceIds,
          remediation: llmEval.remediation ?? '',
          assessor: 'llm',
          assessed_at: assessedAt,
          tags: c.tags ?? [],
        });
      }
    }

    const anyResolved = evaluated.some(c => c.outcome === 'SATISFIED' || c.outcome === 'PARTIAL' || c.outcome === 'GAP');
    regimesOut.push({
      ...regimeMeta,
      status: llm ? (anyResolved ? 'evaluated' : 'insufficient_evidence') : 'pending-llm',
      controls: evaluated,
    });

    const counts = {
      satisfied: evaluated.filter((c) => c.outcome === 'SATISFIED').length,
      partial:   evaluated.filter((c) => c.outcome === 'PARTIAL').length,
      gap:       evaluated.filter((c) => c.outcome === 'GAP').length,
      unknown:   evaluated.filter((c) => c.outcome === 'UNKNOWN').length,
      na:        evaluated.filter((c) => c.outcome === 'N_A').length,
    };
    const summaryDerivation = `${regimeId}: ${counts.satisfied} SATISFIED, ${counts.partial} PARTIAL, ${counts.gap} GAP, ${counts.unknown} UNKNOWN, ${counts.na} N/A out of ${evaluated.length} controls.`;
    const sev = counts.gap > 0 ? 'high' : counts.partial > 0 ? 'medium' : 'informational';
    signalCounter += 1;
    summarySignals.push({
      id: `COMP-${String(signalCounter).padStart(2, '0')}`,
      source: 'llm_inference',
      category: 'application',
      severity: sev,
      derivation: summaryDerivation,
      evidence: [],
      confidence: 'high',
    } as Signal);
  }

  const controlsTotal = regimesOut.reduce((sum, r) => sum + r.controls.length, 0);

  return {
    pass: {
      id: 11,
      name: 'compliance_evaluation',
      signal_prefix: 'COMP',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals: summarySignals,
    assessment: {
      regimes: regimesOut,
      regimes_evaluated: regimesOut.length,
      controls_total: controlsTotal,
      // LLM-optional alignment (#0550): uniform marker so doctor + HTML can
      // detect that controls degraded to UNKNOWN for want of an LLM.
      ...(llm ? {} : { skipped_reason: NO_LLM_REASON }),
    },
  };
}

// ---------------------------------------------------------------------------
// ComplianceEvaluatorContribution -- the lean programmatic service surface
// ---------------------------------------------------------------------------

/** Load a regime catalogue directly from a catalogs dir (vs the app-dir-relative
 *  resolution runCompliancePass uses). Mirrors that loader; kept separate so the
 *  rich host path stays byte-untouched. */
function loadRegimeCatalogByDir(catalogsDir: string, regimeId: string): RegimeCatalog | null {
  if (!existsSync(catalogsDir)) return null;
  let registry;
  try {
    registry = loadRegimeRegistry(catalogsDir);
  } catch {
    return null;
  }
  const resolved = registry.byId.get(regimeId);
  if (!resolved) return null;
  try {
    return loadRegimeCatalogue(resolved.catalogueFile) as unknown as RegimeCatalog;
  } catch {
    return null;
  }
}

/**
 * Lean compliance API (the manifest-declared ComplianceEvaluatorContribution).
 *
 * Given in-memory signals + framework ids, evaluate controls and return the
 * compact ComplianceResult. It reuses the SAME prompt + JSON validation as
 * runCompliancePass (the rich host path) -- only the I/O wrapper differs:
 * `evaluate()` takes signals in memory and returns the compact shape, whereas
 * runCompliancePass reads the run's signals from disk and emits the full WSP
 * PassResult (regimes[] + COMP-NN roll-ups). The host uses the rich path for
 * the assessment WSP; this compact surface exists for guest modules that
 * cannot import this module directly (the DAG forbids module -> module) and
 * reach compliance via CoreContext.complianceEvaluator.
 *
 * `opts` extras honoured: `llm?: LlmProvider`, `catalogsDir?: string`.
 */
export async function evaluate(
  signals: Signal[],
  frameworks: string[],
  opts: EvalOptions,
): Promise<ComplianceResult> {
  const llm = opts['llm'] as LlmProvider | undefined;
  const catalogsDir = typeof opts['catalogsDir'] === 'string' ? (opts['catalogsDir'] as string) : undefined;
  const validSignalIds = new Set(signals.map((s) => s.id));
  const results: ComplianceResult['results'] = [];

  for (const regimeId of frameworks) {
    const catalogue = catalogsDir ? loadRegimeCatalogByDir(catalogsDir, regimeId) : null;
    const controls = catalogue?.controls ?? [];
    const regimeMeta = {
      id: catalogue?.regime_meta?.id ?? regimeId,
      name: catalogue?.regime_meta?.name ?? regimeId,
      version: catalogue?.regime_meta?.version ?? '',
    };
    const controlsOut: ComplianceResult['results'][number]['controls'] = [];

    for (let i = 0; i < controls.length; i += BATCH_SIZE) {
      const batch = controls.slice(i, i + BATCH_SIZE);
      let batchResults: z.infer<typeof BatchResponseSchema> | null = null;
      if (llm) {
        try {
          const parsed = safeJsonParse(await llm.complete(buildCompliancePrompt(regimeMeta, batch, signals)));
          if (parsed !== null) {
            const v = BatchResponseSchema.safeParse(parsed);
            if (v.success) batchResults = v.data;
          }
        } catch { /* UNKNOWN fallback below */ }
      }
      for (const c of batch) {
        const ev = batchResults?.controls.find((e) => e.id === c.id);
        controlsOut.push({
          id: c.id,
          verdict: ev?.outcome ?? 'UNKNOWN',
          evidence: (ev?.signal_refs ?? []).filter((id) => validSignalIds.has(id)),
        });
      }
    }
    results.push({ framework: regimeMeta.id, controls: controlsOut });
  }

  return { frameworks, results };
}

/** The compliance evaluator contribution registered by this module. */
export const complianceEvaluator: ComplianceEvaluatorContribution = { evaluate };

/** Module manifest (#0570). Declares the compliance evaluator so the host can
 *  resolve CoreContext.complianceEvaluator from the registered contribution. */
export const frameworkModuleManifest: SwaoModuleManifest = {
  id: '@swao/module-framework',
  version: '0.1.0',
  tier: 'community',
  contributions: {
    complianceEvaluators: [complianceEvaluator],
    catalogues: [communityCatalogueContribution],
  },
};
