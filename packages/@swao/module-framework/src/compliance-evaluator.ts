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
import { loadRegimeRegistry, loadRegimeCatalogue, appliesWhenMatches, NOT_EVALUATED_RATIONALE_PREFIX, type ComplianceNotEvaluatedReason } from '@swao/core';
import { signalEvidenceKind, signalDetectionMethod, evidencePaths, isTestPath, UNVERIFIED_EVIDENCE_RATIONALE_PREFIX, formatEvidenceBasis, type EvidenceKind } from '@swao/core';
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
// #3425: before batching, each control passes a deterministic pre-filter
// (controlApplicability): an `applies_when` that does not match the app's
// `.swao.yml` framework_context yields N_A, and a control whose
// `assessment_type_scope` excludes the run's type yields UNKNOWN ("not
// evaluated"); both are `assessor: rule_engine` and never reach the LLM.
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
  // #3425: Design 104 Q-CODE-7 condition matched against .swao.yml
  // framework_context, and the assessment types the control is scoped to.
  applies_when?: Record<string, string>;
  assessment_type_scope?: string[];
  // #3426: catalogue evidence basis (context_input names the expected input).
  evidence_basis?: Array<Record<string, unknown>>;
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
  // #3425 follow-up / #3426 / #3436: why an UNKNOWN control has no model verdict.
  not_evaluated_reason?: ComplianceNotEvaluatedReason;
  // #3426: inputs the catalogue expects (evidence_basis.context_input) when a
  // GAP was downgraded for insufficient evidence.
  missing_input?: string[];
  // #3414: present when the evidence-quality guard capped a model GAP.
  verdict_guard?: VerdictGuard;
}

// ---------------------------------------------------------------------------
// #3414: evidence-quality guard (deterministic post-check after #3426)
// ---------------------------------------------------------------------------

/**
 * Why a cited signal does not verify a GAP:
 *   - `test_code`: its evidence is test code only (#3403 marker, or every cited
 *     code path is a test path by the built-in rules);
 *   - `low_confidence`: the signal carries confidence low (Pass 08 / 21 bare
 *     tokens and test-only catalogue hits, #3410 / #3411);
 *   - `llm_inferred`: an LLM-derived signal that cites no file at all.
 */
export type EvidenceQualityIssue = 'test_code' | 'low_confidence' | 'llm_inferred';

/** Guard record written on a capped control (`verdict_guard`) and in `assessment.evidence_guard`. */
export interface VerdictGuard {
  original_outcome: 'GAP';
  outcome: 'PARTIAL';
  reason: 'unverified_evidence';
  /** Cited signals (insufficient-input signals excluded) with their issues. */
  cited: Array<{ id: string; issues: EvidenceQualityIssue[] }>;
}

/** Legacy numeric confidence (0-1) below 0.5 counts as low; a missing confidence never does. */
function isLowConfidence(c: unknown): boolean {
  if (typeof c === 'number') return c < 0.5;
  return c === 'low';
}

/**
 * #3414: evidence kind for the compliance guard. Like `signalEvidenceKind`,
 * except that documents inside test folders (fixtures such as
 * `src/test/resources/users.csv`) count as test code: fake personal data in
 * test resources must not verify a GAP. Kept local so the #3418 chat
 * classification is unchanged.
 */
export function complianceEvidenceKind(s: Signal, sourceRoot?: string): EvidenceKind {
  const kind = signalEvidenceKind(s, sourceRoot);
  if (kind !== 'document') return kind;
  const paths = (Array.isArray(s.evidence) ? s.evidence : []).flatMap((e) => evidencePaths(String(e), sourceRoot));
  return paths.length > 0 && paths.every((p) => isTestPath(p)) ? 'test-code' : kind;
}

/** Evidence-quality issues of one signal; empty = verified evidence (#3414). */
export function signalEvidenceIssues(s: Signal, sourceRoot?: string): EvidenceQualityIssue[] {
  const issues: EvidenceQualityIssue[] = [];
  const kind: EvidenceKind = complianceEvidenceKind(s, sourceRoot);
  switch (kind) {
    case 'test-code':
      issues.push('test_code');
      break;
    case 'none':
      if (signalDetectionMethod(s) === 'llm') issues.push('llm_inferred');
      break;
    case 'production':
    case 'mixed':
    case 'document':
      break;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
  if (isLowConfidence(s.confidence)) issues.push('low_confidence');
  return issues;
}

const ISSUE_LABEL: Readonly<Record<EvidenceQualityIssue, string>> = {
  test_code: 'test code only',
  low_confidence: 'low confidence',
  llm_inferred: 'LLM-inferred without file evidence',
};

/**
 * #3414 post-check over a model GAP (after downgradeUnsupportedGap). The GAP is
 * capped at PARTIAL when no cited signal (insufficient-input signals aside) is
 * verified evidence, i.e. every cited signal is test code only, low confidence
 * or LLM-inferred without file evidence, or the GAP cites no signal at all.
 * A GAP backed by at least one verified signal (production, mixed or document
 * evidence, confidence not low) stays GAP. Rule-decided controls and every
 * other outcome are returned unchanged.
 */
export function guardUnverifiedGap(
  control: EvaluatedControl,
  signalsById: ReadonlyMap<string, Signal>,
  sourceRoot?: string,
): EvaluatedControl {
  if (control.outcome !== 'GAP' || control.assessor !== 'llm') return control;
  const cited = control.signal_refs
    .filter((id) => !isInsufficientInputSignal(id))
    .map((id) => {
      const s = signalsById.get(id);
      return { id, issues: s ? signalEvidenceIssues(s, sourceRoot) : (['llm_inferred'] as EvidenceQualityIssue[]) };
    });
  if (cited.some((c) => c.issues.length === 0)) return control;
  const why = cited.length > 0
    ? `no cited signal is verified evidence (${cited.map((c) => `${c.id}: ${c.issues.map((i) => ISSUE_LABEL[i]).join(', ')}`).join('; ')})`
    : 'it cites no signal';
  return {
    ...control,
    outcome: 'PARTIAL',
    status: 'PARTIAL',
    rationale: `${UNVERIFIED_EVIDENCE_RATIONALE_PREFIX}: the model proposed GAP, but ${why}. Test code, low-confidence pattern matches and inference without file evidence do not demonstrate that the control is unmet. Model rationale: ${control.rationale}`,
    remediation: `Verify the cited finding in production code and re-run the assessment.${control.remediation ? ` ${control.remediation}` : ''}`,
    assessor: 'rule_engine',
    verdict_guard: { original_outcome: 'GAP', outcome: 'PARTIAL', reason: 'unverified_evidence', cited },
  };
}

/**
 * #3414: append "Evidence basis: based on N signals, M in test code, K low
 * confidence." to a model verdict (SATISFIED / PARTIAL / GAP, or any outcome
 * that cites signals). Rule-decided controls without citations stay unchanged.
 */
export function withEvidenceBasis(
  control: EvaluatedControl,
  signalsById: ReadonlyMap<string, Signal>,
  sourceRoot?: string,
): EvaluatedControl {
  const refs = control.signal_refs;
  const resolved = control.outcome === 'SATISFIED' || control.outcome === 'PARTIAL' || control.outcome === 'GAP';
  if (refs.length === 0 && !resolved) return control;
  let testCode = 0;
  let low = 0;
  for (const id of refs) {
    const s = signalsById.get(id);
    if (!s) continue;
    const issues = signalEvidenceIssues(s, sourceRoot);
    if (issues.includes('test_code')) testCode += 1;
    if (issues.includes('low_confidence')) low += 1;
  }
  return { ...control, rationale: `${control.rationale} ${formatEvidenceBasis(refs.length, testCode, low)}` };
}

// ---------------------------------------------------------------------------
// #3426: GAP vs insufficient evidence (deterministic post-check after the LLM)
// ---------------------------------------------------------------------------

/**
 * A signal that reports missing input rather than a finding: a scope signal
 * (`SCOPE-*`, e.g. SCOPE-10 "data processing agreements not supplied") or a
 * skipped-pass marker (`<PREFIX>-00`, see llmSkipResult). Citing it proves
 * that evidence is absent, not that a control is unmet. #3414: the
 * evidence-quality guard (guardUnverifiedGap) leaves these signals to this check.
 * #3426: distinct from @swao/core isAbsenceEvidenceRef, which classifies an
 * entry of `signal.evidence[]` ("0 source files scanned"); this classifies a
 * cited signal id.
 */
export function isInsufficientInputSignal(id: string): boolean {
  return /^SCOPE-/i.test(id) || /-00$/.test(id);
}

/** A cited signal that demonstrates a shortcoming (negative outcome or a finding severity). */
function isRealNegativeSignal(s: Signal | undefined): boolean {
  if (!s || isInsufficientInputSignal(s.id)) return false;
  if (s.outcome !== undefined) return s.outcome === 'negative';
  return s.severity === 'critical' || s.severity === 'high' || s.severity === 'medium' || s.severity === 'low';
}

/** `evidence_basis` entries of kind `context_input` (the catalogue's expected inputs). */
export function contextInputsOf(c: Pick<CatalogControl, 'evidence_basis'>): string[] {
  return (c.evidence_basis ?? [])
    .map((e) => (typeof e?.['context_input'] === 'string' ? e['context_input'] : ''))
    .filter((x) => x !== '');
}

/**
 * #3426 post-check over an LLM verdict (signal_refs already validated). A GAP
 * becomes UNKNOWN with `not_evaluated_reason: insufficient_evidence` when
 *   1. every cited signal is an insufficient-input signal (SCOPE-* / *-00), or
 *   2. the control expects a `context_input` and no cited signal is a real
 *      negative finding (missing input is not non-compliance).
 * A GAP backed by at least one real negative signal (CRYPTO-*, DATA-*, ...)
 * stays GAP. Other outcomes are returned unchanged.
 */
export function downgradeUnsupportedGap(
  control: EvaluatedControl,
  catalogControl: Pick<CatalogControl, 'evidence_basis'>,
  signalsById: ReadonlyMap<string, Signal>,
): EvaluatedControl {
  if (control.outcome !== 'GAP') return control;
  const refs = control.signal_refs;
  const onlyInsufficient = refs.length > 0 && refs.every(isInsufficientInputSignal);
  const expected = contextInputsOf(catalogControl);
  const anyRealNegative = refs.some((id) => isRealNegativeSignal(signalsById.get(id)));
  if (!onlyInsufficient && (expected.length === 0 || anyRealNegative)) return control;
  const missing = expected.length > 0 ? `; missing input: ${expected.join(', ')}` : '';
  const cited = refs.length > 0 ? ` citing only ${refs.join(', ')}` : ' without a cited negative finding';
  return {
    ...control,
    outcome: 'UNKNOWN',
    status: 'UNKNOWN',
    not_evaluated_reason: 'insufficient_evidence',
    ...(expected.length > 0 ? { missing_input: expected } : {}),
    rationale: `${NOT_EVALUATED_RATIONALE_PREFIX.insufficient_evidence}${missing}). The model proposed GAP${cited}; missing or out-of-scope input is not evidence of non-compliance. Model rationale: ${control.rationale}`,
    evidence_ids: [],
    remediation: expected.length > 0
      ? `Supply ${expected.join(', ')} (or the artefact named by the cited signal) and re-run the assessment.`
      : 'Supply the missing input named by the cited signal and re-run the assessment.',
    assessor: 'rule_engine',
  };
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

// ---------------------------------------------------------------------------
// #3425: deterministic applicability pre-filter (no LLM call)
// ---------------------------------------------------------------------------

/** Short tokens used by catalogue `assessment_type_scope` lists. */
export type AssessmentScopeToken = 'app' | 'aud' | 'lz' | 'llm' | 'service';

/**
 * Map an assessment type (`assessment.type` in .swao.yml, router vocabulary
 * incl. deprecated aliases) to the scope tokens a control must list to be
 * evaluated. Absent type = the router default (application). An unrecognised
 * type returns null: no scope filter is applied.
 */
export function assessmentScopeTokens(assessmentType: string | undefined): AssessmentScopeToken[] | null {
  switch ((assessmentType ?? 'application').trim().toLowerCase()) {
    case 'application':
    case 'source-code':
      return ['app'];
    case 'audit':
    case 'human':
      return ['aud'];
    case 'hybrid':
      return ['app', 'aud'];
    case 'landing-zone':
    case 'landing-zone-catalog':
    case 'landing-zone-customer':
      return ['lz'];
    case 'llm':
      return ['llm'];
    case 'service':
      return ['service'];
    default:
      return null;
  }
}

// #3425 follow-up: the Design 104 Q-CODE-7 matcher lives in @swao/core
// (compliance-applicability.ts), shared with the publication extractor.
// Re-exported so this module's public surface is unchanged.
export { appliesWhenMatches };

/** Pass 11 applicability decision for one catalogue control. */
export type ControlApplicability =
  | { kind: 'evaluate' }
  | { kind: 'not_applicable'; rationale: string }
  | { kind: 'out_of_scope'; rationale: string };

export interface ApplicabilityContext {
  frameworkContext?: Readonly<Record<string, string>>;
  /** From assessmentScopeTokens(); null = no scope filter. */
  scopeTokens: readonly AssessmentScopeToken[] | null;
}

/**
 * Decide whether Pass 11 sends a control to the LLM. Order matters: an
 * applies_when mismatch is definitive (N_A) and wins over the scope check, so
 * a sector control scoped `[aud]` is N/A, not merely out of scope.
 */
export function controlApplicability(
  c: Pick<CatalogControl, 'applies_when' | 'assessment_type_scope'>,
  ctx: ApplicabilityContext,
): ControlApplicability {
  if (!appliesWhenMatches(c.applies_when, ctx.frameworkContext)) {
    const keys = Object.keys(c.applies_when ?? {});
    const cond = keys.map((k) => `${k}: ${c.applies_when![k]}`).join(', ');
    const actual = keys.map((k) => `${k}: ${ctx.frameworkContext?.[k] ?? 'not set'}`).join(', ');
    return {
      kind: 'not_applicable',
      rationale: `Not applicable: the control applies when ${cond}; framework_context in .swao.yml has ${actual}. Decided by rule, no LLM evaluation.`,
    };
  }
  const scope = c.assessment_type_scope ?? [];
  const tokens = ctx.scopeTokens;
  if (tokens && scope.length > 0 && !scope.some((t) => (tokens as readonly string[]).includes(t))) {
    return {
      kind: 'out_of_scope',
      // #3425 follow-up: shared prefix so the publication recognises out-of-scope controls.
      rationale: `${NOT_EVALUATED_RATIONALE_PREFIX.out_of_scope} [${scope.join(', ')}] and this run is [${tokens.join(', ')}]. Assess it in a matching assessment.`,
    };
  }
  return { kind: 'evaluate' };
}

const SwaoYmlApplicabilitySchema = z.object({
  framework_context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  assessment: z.object({ type: z.string().optional() }).passthrough().optional(),
}).passthrough();

/**
 * Read the applicability context from the app's own .swao.yml (the file the
 * publication extractor reads). Scalars are stringified so an unquoted
 * `has_ot_systems: true` matches the catalogue's "true". The run type comes
 * from `routedType` (PassContext.assessmentType: the routed decision incl. a
 * CLI `--type` override) when given, else `.swao.yml` assessment.type, else the
 * application default.
 */
export function loadApplicabilityContext(workspacePath: string, routedType?: string): ApplicabilityContext {
  const ymlPath = join(workspacePath, '.swao.yml');
  let parsed: z.infer<typeof SwaoYmlApplicabilitySchema> | null = null;
  if (existsSync(ymlPath)) {
    try {
      const r = SwaoYmlApplicabilitySchema.safeParse(load(readFileSync(ymlPath, 'utf-8')));
      if (r.success) parsed = r.data;
    } catch { /* unreadable: no context */ }
  }
  const fc = parsed?.framework_context;
  return {
    frameworkContext: fc ? Object.fromEntries(Object.entries(fc).map(([k, v]) => [k, String(v)])) : undefined,
    // #3425 follow-up: the routed type (CLI override aware) wins over .swao.yml.
    scopeTokens: assessmentScopeTokens(routedType ?? parsed?.assessment?.type),
  };
}

/** A control decided by rule (#3425): N_A for applies_when, UNKNOWN when out of scope. */
function ruleControl(c: CatalogControl, assessedAt: string, decision: Exclude<ControlApplicability, { kind: 'evaluate' }>): EvaluatedControl {
  const outcome = decision.kind === 'not_applicable' ? 'N_A' : 'UNKNOWN';
  const base = { ...fallbackControl(c, assessedAt, decision.rationale), outcome, status: outcome };
  // #3425 follow-up: structured marker so consumers can tell out-of-scope UNKNOWN
  // from an ordinary or failed-LLM UNKNOWN.
  return decision.kind === 'out_of_scope' ? { ...base, not_evaluated_reason: 'out_of_scope' } : base;
}

/** Regime-level Pass 11 status written to `assessment.regimes[].status`. */
export type RegimeEvaluationStatus = 'evaluated' | 'insufficient_evidence' | 'pending-llm' | 'out_of_scope' | 'degraded';

/**
 * #3425 follow-up: a regime none of whose controls is in scope for this
 * assessment type (every control out of scope or N/A, at least one out of
 * scope) is `out_of_scope`, not `insufficient_evidence` / `pending-llm`.
 * #3436: a regime with any control that has no model verdict because the LLM
 * evaluation failed is `degraded` (not fully evaluated). Rule-engine decisions
 * (N_A, out of scope) stay valid verdicts and never make a regime degraded.
 */
export function regimeEvaluationStatus(
  controls: ReadonlyArray<Pick<EvaluatedControl, 'outcome' | 'not_evaluated_reason'>>,
  llmPresent: boolean,
): RegimeEvaluationStatus {
  const anyOutOfScope = controls.some((c) => c.not_evaluated_reason === 'out_of_scope');
  if (anyOutOfScope && controls.every((c) => c.not_evaluated_reason === 'out_of_scope' || c.outcome === 'N_A')) {
    return 'out_of_scope';
  }
  if (!llmPresent) return 'pending-llm';
  if (controls.some((c) => c.not_evaluated_reason === 'llm_unavailable')) return 'degraded';
  const anyResolved = controls.some((c) => c.outcome === 'SATISFIED' || c.outcome === 'PARTIAL' || c.outcome === 'GAP');
  return anyResolved ? 'evaluated' : 'insufficient_evidence';
}

/** #3414: evidence path class as the prompt names it (never "test code" for production evidence). */
function evidenceClassLabel(kind: EvidenceKind): string {
  switch (kind) {
    case 'test-code': return 'test code';
    case 'production': return 'production';
    case 'mixed': return 'production and tests';
    case 'document': return 'document';
    case 'none': return 'no file';
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function summariseSignals(signals: Signal[], sourceRoot?: string): string {
  if (signals.length === 0) return '(no signals emitted in this run)';
  const lines: string[] = [];
  for (const s of signals) {
    const sev = s.severity ?? 'informational';
    const derivation = (s.derivation ?? '').replace(/\s+/g, ' ').slice(0, 280);
    // #3403 / #3414: confidence, evidence path class (test_code marker or test
    // paths count as test code) and evidence count per signal.
    const conf = typeof s.confidence === 'string' || typeof s.confidence === 'number' ? `, confidence ${String(s.confidence)}` : '';
    const n = Array.isArray(s.evidence) ? s.evidence.length : 0;
    const evidence = `, evidence: ${evidenceClassLabel(complianceEvidenceKind(s, sourceRoot))}${n > 0 ? ` (${n})` : ''}`;
    lines.push(`  - ${s.id} [${sev}${conf}${evidence}]: ${derivation}`);
  }
  return lines.join('\n');
}

/** #3414: the run has a signal a GAP must not rest on alone (test code or low confidence). */
function hasWeakSignals(signals: Signal[], sourceRoot?: string): boolean {
  return signals.some((s) => {
    const issues = signalEvidenceIssues(s, sourceRoot);
    return issues.includes('test_code') || issues.includes('low_confidence');
  });
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
  sourceRoot?: string,
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
    // #3426: missing input is not non-compliance.
    'Signals stating that an artefact is out of scope, missing or not supplied',
    '(e.g. SCOPE-* signals) and skipped-pass markers (IDs ending in -00) mean',
    'UNKNOWN, never GAP: they show that evidence is absent, not that the control',
    'is unmet. Return GAP only when a signal demonstrates a shortcoming.',
    '',
    // #3403 / #3414: only when a signal rests on test code or has low
    // confidence, so prompts of runs without such signals carry no extra rule.
    ...(hasWeakSignals(signals, sourceRoot)
      ? ['Signals with "evidence: test code" rest on test code only (tests, fixtures,',
        'test data); they do not show how production code behaves. Signals with',
        '"confidence low" are unverified pattern matches. Never return GAP on such',
        'signals alone: use PARTIAL or UNKNOWN and name the limitation in the',
        'rationale. GAP needs at least one production signal that is not low confidence.', '']
      : []),
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
    summariseSignals(signals, sourceRoot),
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

/**
 * #3436: rationale for a control whose LLM evaluation did not happen. Starts
 * with the shared `llm_unavailable` prefix so the publication can say
 * "compliance not fully evaluated" from the rationale alone.
 */
export function llmUnavailableRationale(callError: string | undefined, raw: string | null, batchParsed: boolean): string {
  const p = NOT_EVALUATED_RATIONALE_PREFIX.llm_unavailable;
  if (callError !== undefined) {
    return `${p} failed: the model call did not succeed after its retries (${callError}). No verdict for this control; re-run the assessment when the LLM provider is reachable.`;
  }
  if (raw === null || !batchParsed) {
    return `${p} returned no usable answer for this control's batch (empty or invalid JSON). No verdict for this control; re-run the assessment.`;
  }
  return `${p} returned no verdict for this control. No verdict recorded; re-run the assessment.`;
}

/** #3436: UNKNOWN without a model verdict (llm_unavailable); never a confident outcome. */
function llmUnavailableControl(c: CatalogControl, assessedAt: string, rationale: string): EvaluatedControl {
  return { ...fallbackControl(c, assessedAt, rationale), not_evaluated_reason: 'llm_unavailable' };
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
  const applicabilityCtx = loadApplicabilityContext(workspacePath, ctx.assessmentType);
  const workspaceRoot = resolveWorkspaceRoot(workspacePath);

  const validSignalIds = new Set(signals.map((s) => s.id));
  // #3426: cited-signal lookup for the GAP post-check.
  const signalsById = new Map<string, Signal>(signals.map((s) => [s.id, s]));
  // #3414: absolute evidence paths under the source root are classified relative to it.
  const sourceRoot = ctx.sourcePath;
  // #3414: GAP verdicts the evidence-quality guard capped (logged in the pass output).
  const evidenceGuard: Array<{ regime: string; control: string } & VerdictGuard> = [];
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
  // #3436: regimes with controls that never got a model verdict.
  const degradedRegimes: Array<{ id: string; controls_without_verdict: number }> = [];

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
  // #3425: decide applicability once per control; only `evaluate` controls are
  // batched for the LLM (phase A) and consumed in the same order (phase B).
  const decisions = catalogs.map((catalog) =>
    (catalog?.controls ?? []).map((c) => controlApplicability(c, applicabilityCtx)));
  const evaluable = catalogs.map((catalog, r) =>
    (catalog?.controls ?? []).filter((_, i) => decisions[r]![i]!.kind === 'evaluate'));

  // #3222 phase A: send every regime's batch prompts concurrently (bounded by
  // the provider's limit, #3284: complianceLlmConcurrency). Prompts are built exactly as before; a
  // failed call yields null and falls back to UNKNOWN in phase B, as the
  // sequential loop did. Phase B below consumes the responses in the original
  // regime and batch order, so signal numbering and output are unchanged.
  const rawResponses: Array<Array<string | null>> = regimeIds.map(() => []);
  const regimeHasBatches: boolean[] = regimeIds.map(() => false);
  // #3436: per-batch call failure (error name), undefined when the call returned.
  const batchErrors: Array<Array<string | undefined>> = regimeIds.map(() => []);
  if (llm) {
    const jobs: Array<{ r: number; b: number; prompt: string }> = [];
    regimeIds.forEach((regimeId, r) => {
      const catalog = catalogs[r];
      if (!catalog) return;
      const controls = evaluable[r]!;
      const meta = regimeMetaOf(catalog, regimeId);
      for (let i = 0, b = 0; i < controls.length; i += BATCH_SIZE, b += 1) {
        jobs.push({ r, b, prompt: buildCompliancePrompt(meta, controls.slice(i, i + BATCH_SIZE), signals, sourceRoot) });
      }
    });
    const pending = regimeIds.map((_, r) => jobs.filter((j) => j.r === r).length);
    pending.forEach((n, r) => { regimeHasBatches[r] = n > 0; });
    await mapWithConcurrency(jobs, complianceLlmConcurrency(llm), async (job) => {
      let raw: string | null = null;
      try { raw = await llm.complete(job.prompt); } catch (e) {
        raw = null; /* UNKNOWN fallback in phase B */
        // #3436: remember that this batch never got a model response (retries
        // exhausted / provider error); its controls are marked llm_unavailable.
        batchErrors[job.r]![job.b] = e instanceof Error && e.name ? e.name : 'Error';
      }
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

    const controls = evaluable[r]!;
    const regimeMeta = regimeMetaOf(catalog, regimeId);

    const llmEvaluated = new Map<string, EvaluatedControl>();

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
          // #3436: with a provider configured, a missing verdict means the
          // evaluation did not happen (call failed after its retries, unusable
          // or incomplete answer): UNKNOWN + llm_unavailable, never a verdict.
          llmEvaluated.set(c.id, llm
            ? llmUnavailableControl(c, assessedAt, llmUnavailableRationale(batchErrors[r]![b], rawResponses[r]![b] ?? null, batchResults !== null))
            : fallbackControl(c, assessedAt, 'No LLM provider configured; control marked UNKNOWN. Re-run with a real LLM for evaluation.'));
          continue;
        }
        // B-02 (#0604): validate the LLM-cited signal_refs against the real signal set.
        const cleanRefs = validateCitedRefs(
          llmEval.signal_refs ?? [], validSignalIds, 'signal_refs', regimeMeta.id, c.id,
        );
        // #1507: derive evidence_ids from the source-file evidence of each cited signal
        // rather than trusting the LLM to populate them (LLM was told to leave them empty).
        const derivedEvidenceIds = resolveEvidenceIds(cleanRefs, llmEval.outcome, signalEvidenceMap);
        // #3426: post-check the verdict; a GAP backed only by missing-input
        // signals becomes UNKNOWN (insufficient evidence).
        const checked = downgradeUnsupportedGap({
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
        }, c, signalsById);
        // #3414: then the evidence-quality guard (a surviving GAP needs one
        // verified signal), then the evidence-basis line on the rationale.
        const guarded = guardUnverifiedGap(checked, signalsById, sourceRoot);
        if (guarded.verdict_guard) {
          evidenceGuard.push({ regime: regimeMeta.id, control: c.id, ...guarded.verdict_guard });
          console.warn(
            `[warn] COMP: ${regimeMeta.id}/${c.id} GAP capped at PARTIAL (unverified evidence): ` +
            (guarded.verdict_guard.cited.map((x) => `${x.id} [${x.issues.join(', ')}]`).join(', ') || 'no cited signal'),
          );
        }
        llmEvaluated.set(c.id, withEvidenceBasis(guarded, signalsById, sourceRoot));
      }
    }

    // #3425: emit every catalogue control in catalogue order; rule-decided
    // controls (N_A / out of scope) never reached the LLM.
    let outOfScope = 0;
    const evaluated: EvaluatedControl[] = (catalog.controls ?? []).map((c, i) => {
      const decision = decisions[r]![i]!;
      switch (decision.kind) {
        case 'evaluate':
          return llmEvaluated.get(c.id) ?? (llm
            ? llmUnavailableControl(c, assessedAt, llmUnavailableRationale(undefined, null, true))
            : fallbackControl(c, assessedAt, 'No LLM provider configured; control marked UNKNOWN. Re-run with a real LLM for evaluation.'));
        case 'out_of_scope':
          outOfScope += 1;
          return ruleControl(c, assessedAt, decision);
        case 'not_applicable':
          return ruleControl(c, assessedAt, decision);
        default: {
          const unreachable: never = decision;
          return unreachable;
        }
      }
    });

    regimesOut.push({
      ...regimeMeta,
      status: regimeEvaluationStatus(evaluated, Boolean(llm)),
      controls: evaluated,
    });

    const counts = {
      satisfied: evaluated.filter((c) => c.outcome === 'SATISFIED').length,
      partial:   evaluated.filter((c) => c.outcome === 'PARTIAL').length,
      gap:       evaluated.filter((c) => c.outcome === 'GAP').length,
      unknown:   evaluated.filter((c) => c.outcome === 'UNKNOWN').length,
      na:        evaluated.filter((c) => c.outcome === 'N_A').length,
    };
    // #3436: name the controls without a model verdict in the roll-up.
    const unavailable = evaluated.filter((c) => c.not_evaluated_reason === 'llm_unavailable').length;
    if (unavailable > 0) degradedRegimes.push({ id: regimeMeta.id, controls_without_verdict: unavailable });
    // #3414: name the GAP verdicts the evidence-quality guard capped.
    const capped = evaluated.filter((c) => c.verdict_guard !== undefined).length;
    const summaryDerivation = `${regimeId}: ${counts.satisfied} SATISFIED, ${counts.partial} PARTIAL, ${counts.gap} GAP, ${counts.unknown} UNKNOWN, ${counts.na} N/A out of ${evaluated.length} controls.${outOfScope > 0 ? ` ${outOfScope} UNKNOWN are outside the assessment type scope.` : ''}${unavailable > 0 ? ` Compliance not fully evaluated: ${unavailable} UNKNOWN have no model verdict because the LLM evaluation failed; re-run the assessment.` : ''}${capped > 0 ? ` ${capped} PARTIAL were proposed as GAP and capped for unverified evidence (test code only, low confidence or no file evidence).` : ''}`;
    const sev = counts.gap > 0 ? 'high' : (counts.partial > 0 || unavailable > 0) ? 'medium' : 'informational';
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
      // #3436: the pass header status vocabulary (complete | stub |
      // not_applicable) has no degraded value, so the degradation is carried
      // here: `degraded: true`, the reason and the affected regimes. Pass
      // header status stays `complete` until the WSP pass schema gains one.
      ...(degradedRegimes.length > 0
        ? { degraded: true, degraded_reason: 'llm_unavailable', degraded_regimes: degradedRegimes }
        : {}),
      // #3414: guard decisions (absent when the guard changed nothing).
      ...(evidenceGuard.length > 0 ? { evidence_guard: evidenceGuard } : {}),
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
 *
 * #3425 follow-up: this path does NOT apply the applicability pre-filter
 * (controlApplicability). It is unreachable from `swao assess` and the MCP
 * server: assess runs runCompliancePass (packages/swao assess.ts and
 * passes/index.ts), module-mcp does not import this module, and no host
 * code constructs a CoreContext or resolves
 * `complianceEvaluators` from this manifest (repo-wide grep, 2026-10-23). It
 * also has no app directory, so no `.swao.yml` framework_context or
 * assessment type to filter with. A caller that wires it up must pass that
 * context and reuse controlApplicability before batching.
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
