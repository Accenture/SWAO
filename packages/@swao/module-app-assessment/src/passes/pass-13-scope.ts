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
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import {
  BlindSpotsCatalogueSchema,
  type BlindSpotsCatalogue,
  type BlindSpotEntry,
  type BlindSpotEvidenceKind,
} from '../schema/blind-spots-catalogue.js';
import type { BlindSpotEntryResult, ScopeCoverage } from '@swao/core';

// Sprint 029 Phase 1 (#0263) -- Pass 13 Scope Coverage.
//
// Deterministic rule-engine pass; no LLM cost. For each entry in the
// blind-spots catalogue:
//   1. Walk `input_paths` (relative to apps/<id>/).
//   2. If any path exists and is non-empty, mark coverage closed.
//   3. If absent and catalogue's current_swao_coverage is "partial",
//      mark coverage partial. (Spec ambiguity resolved Option B: input
//      present overrides partial baseline -> closed.)
//   4. Otherwise mark coverage open.
//
// Emits one SCOPE-<id> signal per blind spot plus a `scope_coverage`
// block on the assessment for derive-plan to surface in wsp-plan.yaml.
//
// coverage_ratio formula: (closed + 0.5 * partial) / total. Pinned
// here to a single computation; downstream code should not re-implement.

const PASS_ID = 13;
const PASS_NAME = 'scope_coverage';
const SIGNAL_PREFIX = 'SCOPE';

// ---------------------------------------------------------------------------
// Catalogue resolution + load
// ---------------------------------------------------------------------------

export function resolveDefaultBlindSpotsCataloguePath(): string {
  // The catalogue lives at `swao/controls/blind-spots-catalogue.yaml`.
  // Reaching it depends on the runtime layout. Since this pass moved into
  // @swao/module-app-assessment (#0548), the package nests one level deeper
  // than @swao/swao, so the dev paths are 5 levels up:
  //
  //   module src (vitest)    -> __dirname = packages/@swao/module-app-assessment/src/passes  (5 up)
  //   module compiled (tsc)  -> __dirname = packages/@swao/module-app-assessment/dist/passes (5 up)
  //   bundled (pkg snapshot) -> __dirname = packages/swao/dist (3 up; esbuild collapses the
  //                             module's code into swao's bundle.cjs)
  //
  // Try candidate path-lengths (5 for module dev, 4 for the legacy swao
  // layout, 3 for the bundle) and return the first that exists.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(__dirname, '../../../../../controls/blind-spots-catalogue.yaml'),
    resolve(__dirname, '../../../../controls/blind-spots-catalogue.yaml'),
    resolve(__dirname, '../../../controls/blind-spots-catalogue.yaml'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] as string;
}

export function loadBlindSpotsCatalogue(cataloguePath: string): BlindSpotsCatalogue {
  const raw = readFileSync(cataloguePath, 'utf-8');
  const parsed = load(raw) as unknown;
  return BlindSpotsCatalogueSchema.parse(parsed);
}

// ---------------------------------------------------------------------------
// Input-path detection
// ---------------------------------------------------------------------------

// `input_paths` is interpreted relative to apps/<id>/. The runner walks
// each candidate; if any is present AND has content (file with bytes, or
// directory containing at least one non-empty entry), the blind spot
// closes. Empty dirs and empty files do NOT close a blind spot --
// that prevents accidental `mkdir wsp/inputs/iam` from suggesting a
// closed gap.
//
// Exported for the unit tests.
export function inputPathSatisfied(workspaceAppDir: string, relativePath: string): boolean {
  const abs = join(workspaceAppDir, relativePath);
  if (!existsSync(abs)) return false;
  let stat;
  try { stat = statSync(abs); } catch { return false; }
  if (stat.isFile()) return stat.size > 0;
  if (stat.isDirectory()) {
    try {
      const entries = readdirSync(abs);
      // Empty directory does not count.
      if (entries.length === 0) return false;
      // At least one entry must be a non-empty file or non-empty subdir.
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const child = join(abs, entry);
        let childStat;
        try { childStat = statSync(child); } catch { continue; }
        if (childStat.isFile() && childStat.size > 0) return true;
        if (childStat.isDirectory()) return true;  // recursive non-empty check is overkill; one subdir is enough signal
      }
      return false;
    } catch { return false; }
  }
  return false;
}

function firstSatisfiedPath(workspaceAppDir: string, paths: string[]): string | null {
  for (const p of paths) {
    if (inputPathSatisfied(workspaceAppDir, p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-entry evaluation
// ---------------------------------------------------------------------------

export interface BlindSpotEvaluation {
  entry: BlindSpotEntry;
  coverage: 'closed' | 'partial' | 'open';
  inputProvided: string | null;
}

export function evaluateBlindSpot(
  workspaceAppDir: string,
  entry: BlindSpotEntry,
): BlindSpotEvaluation {
  const inputProvided = firstSatisfiedPath(workspaceAppDir, entry.input_paths);
  if (inputProvided !== null) {
    // Input present: closes regardless of baseline. (Option B per
    // post-advisor design clarification in #0263 issue body.)
    return { entry, coverage: 'closed', inputProvided };
  }
  // No input: baseline determines status.
  if (entry.current_swao_coverage === 'partial') {
    return { entry, coverage: 'partial', inputProvided: null };
  }
  if (entry.current_swao_coverage === 'full') {
    // current_swao_coverage='full' without input still counts as closed
    // (SWAO covers it natively). Unlikely in the v1 catalogue but the
    // schema permits it.
    return { entry, coverage: 'closed', inputProvided: null };
  }
  return { entry, coverage: 'open', inputProvided: null };
}

// ---------------------------------------------------------------------------
// Applicability (#3246, #3290)
// ---------------------------------------------------------------------------

/** Kubernetes, OpenShift, service-mesh, or container-orchestration wording. */
export const CONTAINER_PLATFORM_PATTERN =
  /\b(kubernetes|k8s|openshift|helm|istio|linkerd|service[- ]mesh|rancher|aks|eks|gke|kubelet|container orchestration|docker swarm|networkpolic(?:y|ies))\b/i;

export interface BlindSpotNotApplicable {
  id: string;
  name: string;
  reason: string;
}

function readAppYml(workspaceAppDir: string): Record<string, unknown> | null {
  const p = join(workspaceAppDir, '.swao.yml');
  if (!existsSync(p)) return null;
  try {
    const doc = load(readFileSync(p, 'utf-8'));
    return doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : null;
  } catch { return null; }
}

/** Signals already on disk for this run (passes before Pass 13), excluding any earlier SCOPE output. */
function readRunSignals(passesDir: string | undefined): Signal[] {
  if (!passesDir || !existsSync(passesDir)) return [];
  const out: Signal[] = [];
  for (const f of readdirSync(passesDir).sort()) {
    if (!/\.ya?ml$/.test(f) || f.startsWith('13-')) continue;
    try {
      const doc = load(readFileSync(join(passesDir, f), 'utf-8')) as { signals?: Signal[] } | null;
      if (Array.isArray(doc?.signals)) out.push(...doc!.signals);
    } catch { /* unreadable pass file: no evidence from it */ }
  }
  return out;
}

/** A negation just before the match ("No Kubernetes manifests", "without a service mesh"). */
const NEGATED_BEFORE = /\b(?:no|not|without|kein|keine|keinen|ohne)\b[^.;:\n]{0,30}$/i;

/** True when `text` matches `pattern` other than in a negated phrase. */
function mentionsOutsideNegation(text: string, pattern: RegExp): boolean {
  const re = new RegExp(pattern.source, 'gi');
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (!NEGATED_BEFORE.test(text.slice(Math.max(0, m.index - 40), m.index))) return true;
  }
  return false;
}

/** True when `text` mentions a container platform other than in a negated phrase. */
export function mentionsContainerPlatform(text: string): boolean {
  return mentionsOutsideNegation(text, CONTAINER_PLATFORM_PATTERN);
}

/**
 * #3290 (Design 110 D-25): web or API exposure wording. A URL, HTTP(S), a web
 * UI, portal or browser access, a REST / SOAP / GraphQL API or API endpoint,
 * a web or application server (IIS, nginx, Apache HTTP, Tomcat, JBoss,
 * WebSphere, WebLogic), a reverse proxy, load balancer, API gateway or WAF,
 * and web single sign-on (SAML, OAuth, OpenID Connect). English and common
 * German wording. Bare words such as "rest", "endpoint" or "server" do not
 * match: "endpoint protection" and "Windows Server" are not web exposure.
 */
export const WEB_FACING_PATTERN =
  /(?:https?:\/\/|\b(?:https?|web[- ]?(?:server|ui|apps?|applications?|anwendung|portal|frontend|front[- ]end|interface|oberfl(?:\u00e4|ae)che|client|services?|shop|site|zugriff|access)|web[- ]based|webbasiert|browser|portal|intranet|extranet|rest(?:ful)?[- ]?apis?|restful|apis?|soap|graphql|api[- ]endpoints?|http endpoints?|iis|nginx|httpd|apache[- ]http|tomcat|jboss|wildfly|websphere|weblogic|haproxy|reverse[- ]proxy|api[- ]gateway|load[- ]balancer|waf|saml|oauth2?|openid|oidc)\b)/i;

/** True when `text` mentions web or API exposure other than in a negated phrase. */
export function mentionsWebFacing(text: string): boolean {
  return mentionsOutsideNegation(text, WEB_FACING_PATTERN);
}

/** Network zones that face the internet or sit at the perimeter. */
const WEB_ZONE_PATTERN = /\b(?:dmz|internet|public|extern|external|perimeter)\b/i;

/**
 * Does the workload show container-platform evidence? Any of: a deterministic
 * signal of this run, or the app record (name, OS, category, vendor), mentions
 * Kubernetes, OpenShift, a service mesh or similar outside a negated phrase.
 * LLM-inferred signals (`source: llm_inference`, for example CTX) are not
 * evidence here: their wording ("shows an EKS cluster ... fabricated") is too
 * loose to decide applicability. Exported for tests.
 */
export function hasContainerPlatformEvidence(appYml: Record<string, unknown> | null, signals: readonly Signal[]): boolean {
  for (const s of signals) {
    if (s.source === 'llm_inference') continue;
    if (mentionsContainerPlatform(`${s.derivation ?? ''} ${(s.implies ?? []).join(' ')}`)) return true;
  }
  if (appYml) {
    const vendor = appYml['vendor'] as Record<string, unknown> | undefined;
    const platform = appYml['platform'] as Record<string, unknown> | undefined;
    const text = [appYml['app_name'], appYml['infra_category'], appYml['os_class'], vendor?.['name'], platform?.['os']]
      .filter((v): v is string => typeof v === 'string').join(' ');
    if (mentionsContainerPlatform(text)) return true;
  }
  return false;
}

/**
 * #3290 (Design 110 D-25): does the service workload show web-facing
 * evidence? Any of:
 *
 * - a deterministic signal of this run mentions web or API exposure
 *   (`WEB_FACING_PATTERN`, outside a negated phrase; LLM-inferred signals are
 *   not evidence, as for container platforms);
 * - the app record: `vendor_type: saas` (delivered over the web), a network
 *   zone such as DMZ, internet or external, or web or API wording in the app
 *   name, business function, authentication method (SAML, OAuth, OpenID
 *   Connect) or the free-text integration notes.
 *
 * `vendor.url` is not evidence: the intake column is the vendor's website,
 * not an endpoint of this workload. Exported for tests.
 */
export function hasWebFacingEvidence(appYml: Record<string, unknown> | null, signals: readonly Signal[]): boolean {
  for (const s of signals) {
    if (s.source === 'llm_inference') continue;
    if (mentionsWebFacing(`${s.derivation ?? ''} ${(s.implies ?? []).join(' ')}`)) return true;
  }
  if (appYml) {
    if (appYml['vendor_type'] === 'saas') return true;
    const network = appYml['network'] as Record<string, unknown> | undefined;
    if (typeof network?.['zone'] === 'string' && WEB_ZONE_PATTERN.test(network['zone'])) return true;
    const business = appYml['business'] as Record<string, unknown> | undefined;
    const platform = appYml['platform'] as Record<string, unknown> | undefined;
    const text = [appYml['app_name'], business?.['function'], platform?.['auth_method'], appYml['integrations_notes']]
      .filter((v): v is string => typeof v === 'string').join(' ; ');
    if (mentionsWebFacing(text)) return true;
  }
  return false;
}

/** Per evidence kind: the check and the not-applicable reason (#3246, #3290). */
const EVIDENCE_CHECKS: Record<BlindSpotEvidenceKind, {
  has: (appYml: Record<string, unknown> | null, signals: readonly Signal[]) => boolean;
  reason: string;
}> = {
  container_platform: {
    has: hasContainerPlatformEvidence,
    reason: 'Service workload with no container-platform evidence (no deterministic Kubernetes, OpenShift or service-mesh signal, app record entry or input); this blind spot does not apply to a server or VM.',
  },
  web_facing: {
    has: hasWebFacingEvidence,
    reason: 'Service workload with no web-facing evidence (no deterministic HTTP endpoint, URL, web server, API or API gateway signal; no SaaS delivery, internet-facing network zone, or web or API wording in the app record; no edge-control input); a WAF or API gateway gap does not apply to a batch or back-end server.',
  },
};

/**
 * Split the catalogue into the blind spots that apply to this workload and
 * those that do not. Only service workloads (`assessment.type: service`) are
 * scoped: an application assessment keeps the full catalogue. A blind spot
 * applies to a service workload only when the workload shows every evidence
 * kind in its `requires_evidence`. A blind spot whose own input paths were
 * supplied always applies (the analyst provided the evidence).
 */
export function applicableBlindSpots(
  catalogue: BlindSpotsCatalogue,
  workspaceAppDir: string,
  passesDir: string | undefined,
): { applicable: BlindSpotEntry[]; notApplicable: BlindSpotNotApplicable[] } {
  const appYml = readAppYml(workspaceAppDir);
  const isService = (appYml?.['assessment'] as { type?: unknown } | undefined)?.type === 'service';
  if (!isService) return { applicable: [...catalogue.blind_spots], notApplicable: [] };
  let signals: Signal[] | undefined;
  const evidence = new Map<BlindSpotEvidenceKind, boolean>();
  const shows = (kind: BlindSpotEvidenceKind): boolean => {
    let v = evidence.get(kind);
    if (v === undefined) {
      signals ??= readRunSignals(passesDir);
      v = EVIDENCE_CHECKS[kind].has(appYml, signals);
      evidence.set(kind, v);
    }
    return v;
  };
  const applicable: BlindSpotEntry[] = [];
  const notApplicable: BlindSpotNotApplicable[] = [];
  for (const entry of catalogue.blind_spots) {
    const required = entry.requires_evidence ?? [];
    if (required.length > 0 && firstSatisfiedPath(workspaceAppDir, entry.input_paths) === null) {
      const missing = required.find((kind) => !shows(kind));
      if (missing !== undefined) {
        notApplicable.push({ id: entry.id, name: entry.name, reason: EVIDENCE_CHECKS[missing].reason });
        continue;
      }
    }
    applicable.push(entry);
  }
  return { applicable, notApplicable };
}

// ---------------------------------------------------------------------------
// Aggregate -> scope_coverage block
// ---------------------------------------------------------------------------

export function buildScopeCoverage(
  catalogue: BlindSpotsCatalogue,
  evaluations: BlindSpotEvaluation[],
  assessedAt: string,
): ScopeCoverage {
  const counts = { closed: 0, partial: 0, open: 0 };
  for (const ev of evaluations) counts[ev.coverage] += 1;
  const total = evaluations.length;
  // Formula pinned: (closed + 0.5 * partial) / total. Zero-protected.
  const ratio = total === 0 ? 0 : (counts.closed + 0.5 * counts.partial) / total;

  const blindSpotResults: BlindSpotEntryResult[] = evaluations.map((ev) => ({
    id: ev.entry.id,
    name: ev.entry.name,
    category: ev.entry.category,
    coverage: ev.coverage,
    severity: ev.entry.severity_default,
    input_required: ev.coverage === 'open' ? ev.entry.input_path_hint : undefined,
    input_provided: ev.inputProvided ?? undefined,
    partial_coverage_note: ev.coverage === 'partial' && ev.entry.current_swao_coverage === 'partial'
      ? `SWAO covers a subset (${ev.entry.input_that_closes}); supply ${ev.entry.input_path_hint} to close fully.`
      : undefined,
    related_regimes: ev.entry.related_regimes,
    assessor: 'rule_engine',
    assessed_at: assessedAt,
  }));

  return {
    catalogue_version: catalogue.catalogue_version,
    total_blind_spots: total,
    closed: counts.closed,
    partial: counts.partial,
    open: counts.open,
    coverage_ratio: Math.round(ratio * 10000) / 10000,  // 4 decimal places
    blind_spots: blindSpotResults,
  };
}

// ---------------------------------------------------------------------------
// Signal emission
// ---------------------------------------------------------------------------

const COVERAGE_TO_SEVERITY: Record<'closed' | 'partial' | 'open', Signal['severity']> = {
  closed: 'positive',
  partial: 'medium',
  open: 'medium',   // overridden below by entry.severity_default when open
};

const COVERAGE_TO_OUTCOME: Record<'closed' | 'partial' | 'open', Signal['outcome']> = {
  closed: 'positive',
  partial: 'indeterminate',
  open: 'indeterminate',
};

// Blind-spot categories are free-form taxonomy in the catalogue
// (network, secrets, detection, ...). Signal.category is constrained
// to the four Stage-D signal taxonomies; map accordingly.
function mapToSignalCategory(blindSpotCategory: string): Signal['category'] {
  switch (blindSpotCategory) {
    case 'process':
    case 'governance':
    case 'contractual':
      return 'business_processes';
    default:
      return 'infrastructure_platform';
  }
}

function buildScopeSignal(ev: BlindSpotEvaluation, index: number, assessedAt: string): Signal {
  // Signal ID matches PREFIX-NN per SIGNAL_ID_REGEX. The blind-spot's
  // semantic identifier (BS_NETWORK_POLICY etc.) is carried in
  // signal_ref so downstream code can join SCOPE-NN to a catalogue row.
  const id = `SCOPE-${String(index + 1).padStart(2, '0')}`;
  const severity = ev.coverage === 'open' ? ev.entry.severity_default : COVERAGE_TO_SEVERITY[ev.coverage];
  let derivation: string;
  if (ev.coverage === 'closed') {
    derivation = `Blind-spot ${ev.entry.id} (${ev.entry.name}) is in scope: ${ev.inputProvided ?? 'native SWAO coverage'} provides the input that closes it.`;
  } else if (ev.coverage === 'partial') {
    derivation = `Blind-spot ${ev.entry.id} (${ev.entry.name}) is partially covered: SWAO assesses a baseline subset (${ev.entry.input_that_closes}); the rest needs ${ev.entry.input_path_hint} to close fully.`;
  } else {
    derivation = `Blind-spot ${ev.entry.id} (${ev.entry.name}) is out of scope for this assessment. Closure needs: ${ev.entry.input_path_hint}.`;
  }
  return {
    id,
    source: 'static_analysis',
    category: mapToSignalCategory(ev.entry.category),
    severity,
    outcome: COVERAGE_TO_OUTCOME[ev.coverage],
    confidence: 'high',
    assessor: 'rule_engine',
    assessed_at: assessedAt,
    derivation,
    evidence: ev.inputProvided ? [ev.inputProvided] : [],
    // implies carries the catalogue link in shape `blind_spot_<coverage>:<BS_ID>`
    // so downstream code can join SCOPE-NN signals back to their catalogue
    // row. signal_ref intentionally not set: it requires the SIGNAL_ID_REGEX
    // shape, and BS_* ids are catalogue IDs not signal IDs.
    implies: [`blind_spot_${ev.coverage}:${ev.entry.id}`],
  };
}

// ---------------------------------------------------------------------------
// Public runner
// ---------------------------------------------------------------------------

export async function runScopePass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, workspacePath, iter, assessedAt } = ctx;
  // Pass 13 reads inputs at apps/<id>/wsp/inputs/. PassContext's
  // workspacePath IS apps/<id>/ when invoked by the assess command.
  // sourcePath is the cloned source tree; not used here.
  void sourcePath;

  const cataloguePath = resolveDefaultBlindSpotsCataloguePath();
  let catalogue: BlindSpotsCatalogue;
  try {
    catalogue = loadBlindSpotsCatalogue(cataloguePath);
  } catch (err) {
    // Catalogue unreachable (e.g. in-tree test isolation): emit a single
    // SCOPE-CATALOGUE-UNREACHABLE signal and an empty scope_coverage block
    // so the report and doctor still render something coherent.
    const signal: Signal = {
      id: 'SCOPE-99',  // sentinel id reserved for catalogue-unreachable
      source: 'static_analysis',
      category: 'business_processes',
      severity: 'informational',
      outcome: 'indeterminate',
      confidence: 'low',
      assessor: 'rule_engine',
      assessed_at: assessedAt,
      derivation: `Blind-spots catalogue could not be loaded from ${cataloguePath}: ${(err as Error).message}. Scope coverage report skipped.`,
      evidence: [],
      implies: ['scope_catalogue_unreachable'],
    };
    return {
      pass: { id: PASS_ID, name: PASS_NAME, signal_prefix: SIGNAL_PREFIX, status: 'complete', iter, assessed_at: assessedAt },
      signals: [signal],
      assessment: { scope_coverage: {
        catalogue_version: 'unknown',
        total_blind_spots: 0, closed: 0, partial: 0, open: 0,
        coverage_ratio: 0, blind_spots: [],
      } },
    };
  }

  // #3246: blind spots that cannot apply to this workload are left out of the
  // coverage totals and emit no SCOPE signal, so later passes (COMP, SYNTH)
  // never reason from them. They are listed in scope_not_applicable.
  const { applicable, notApplicable } = applicableBlindSpots(catalogue, workspacePath, ctx.passesDir);
  const evaluations = applicable.map((entry) => evaluateBlindSpot(workspacePath, entry));
  const scopeCoverage = buildScopeCoverage(catalogue, evaluations, assessedAt);
  const signals = evaluations.map((ev, i) => buildScopeSignal(ev, i, assessedAt));

  return {
    pass: { id: PASS_ID, name: PASS_NAME, signal_prefix: SIGNAL_PREFIX, status: 'complete', iter, assessed_at: assessedAt },
    signals,
    assessment: {
      scope_coverage: scopeCoverage,
      ...(notApplicable.length > 0 ? { scope_not_applicable: notApplicable } : {}),
    },
  };
}
