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

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { load, dump } from 'js-yaml';
import { resolveCatalogsDir, loadRegimeCatalogue, WspRiskImportOverlaySchema, WSP_SCHEMA_VERSION } from '@swao/core';

// Derive a minimal wsp-plan.yaml (#0232) from the assessment's emitted
// signals + the workspace's loaded regime catalogs.
//
// Why this exists:
// The synthesis pass produces per-pass signal YAMLs but does NOT (yet)
// roll them up into a wsp-plan.yaml with compliance.regimes[],
// security_findings[], risk_register[] blocks. The BI star export reads
// from those blocks to populate dim_control / fact_controls / fact_findings
// / fact_risks. Without wsp-plan.yaml the Compliance / Risk / Auditor
// PowerBI pages stay empty.
//
// This module fills the gap deterministically:
// - compliance.regimes[]: every control from each enabled regime catalog,
//   marked outcome=UNKNOWN with a stable rationale. A future LLM-driven
//   mapping pass will refine outcomes.
// - security_findings[]: one finding per high/critical signal whose
//   category indicates security/crypto/data.
// - risk_register[]: one risk per signal whose category indicates risk.
//
// All entries carry a stable id derived from the source signal so the
// output is reproducible across runs.

interface RawSignal {
  id?: string;
  severity?: string;
  outcome?: string;
  category?: string;
  derivation?: string;
  description?: string;
  evidence?: string[];
  pass?: string;
  recommendation?: string;
  rationale?: string;
}

const SECURITY_CATEGORIES = new Set(['security', 'crypto', 'cryptography', 'data', 'data_protection', 'authentication', 'authorisation', 'authorization']);
const RISK_CATEGORIES = new Set(['security', 'crypto', 'data', 'compliance', 'migration', 'operational']);

export function loadAppRegimes(workspaceAppDir: string): string[] {
  const ymlPath = join(workspaceAppDir, '.swao.yml');
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

function loadSignalsFromRun(runDir: string): RawSignal[] {
  const passesDir = join(runDir, 'passes');
  if (!existsSync(passesDir)) return [];
  const out: RawSignal[] = [];
  for (const file of readdirSync(passesDir)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    try {
      const parsed = load(readFileSync(join(passesDir, file), 'utf-8')) as { signals?: RawSignal[] } | null;
      if (parsed?.signals) out.push(...parsed.signals);
    } catch { /* skip malformed pass file */ }
  }
  return out;
}

// Read the synthesis pass assessment block. Populates spine.overall so
// the BI export's dim_app row carries seven_r_label / coverage_score /
// landing_zone (#0232 follow-up; fixes the "Coverage --" Dashboard tile).
interface SynthAssessment {
  seven_r_label?: string;
  modernization_position?: string;
  coverage_score?: number;
  cloud_native_score?: number;
  portability_score?: number;
  confidence?: string;
  landing_zone?: string;
  migration_rationale?: string;
}
function loadSynthAssessment(runDir: string): SynthAssessment | null {
  const synthFile = join(runDir, 'passes', '09-synth.yaml');
  if (!existsSync(synthFile)) return null;
  try {
    const parsed = load(readFileSync(synthFile, 'utf-8')) as { assessment?: SynthAssessment } | null;
    return parsed?.assessment ?? null;
  } catch { return null; }
}

// Derive cloud_native_score from the TF pass twelve_factor_pass_rate (#1503).
// The synth pass does not emit this field; use the TF rate (0-1) as a proxy
// when the synth assessment is absent or blank.
function loadTfPassRate(runDir: string): number | null {
  const tfFile = join(runDir, 'passes', '06-tf.yaml');
  if (!existsSync(tfFile)) return null;
  try {
    const parsed = load(readFileSync(tfFile, 'utf-8')) as { assessment?: { twelve_factor_pass_rate?: unknown } } | null;
    const rate = parsed?.assessment?.twelve_factor_pass_rate;
    return typeof rate === 'number' ? rate : null;
  } catch { return null; }
}

// Read engagement block from the workspace-level .swao.yml. These fields
// are captured by the TUI Setup wizard and should flow into the BI export
// so the Dashboard shows engagement / client / lead context.
interface EngagementBlock {
  name?: string;
  client_code?: string;
  start_date?: string;
  partnership_lead?: string;
}
function loadEngagement(workspaceRoot: string): EngagementBlock | null {
  const ymlPath = join(workspaceRoot, '.swao.yml');
  if (!existsSync(ymlPath)) return null;
  try {
    const yml = load(readFileSync(ymlPath, 'utf-8')) as { engagement?: EngagementBlock } | null;
    return yml?.engagement ?? null;
  } catch { return null; }
}

interface AppMeta { name?: string; business_domain?: string; business_criticality?: string }
function loadAppMeta(workspaceAppDir: string): AppMeta | null {
  const ymlPath = join(workspaceAppDir, '.swao.yml');
  if (!existsSync(ymlPath)) return null;
  try {
    const yml = load(readFileSync(ymlPath, 'utf-8')) as { app_name?: string; business_domain?: string; business_criticality?: string } | null;
    if (!yml) return null;
    return {
      name: yml.app_name,
      business_domain: yml.business_domain,
      business_criticality: yml.business_criticality,
    };
  } catch { return null; }
}

// Read Pass 11 (compliance_evaluation) output if it exists. The pass
// writes its evaluated regimes block to runs/<ts>/passes/11-comp.yaml
// under `assessment.regimes`. derive-plan prefers this real evaluation
// over the UNKNOWN fallback when present (#0233).
function loadCompliancePassOutput(runDir: string): Array<Record<string, unknown>> | null {
  const passFile = join(runDir, 'passes', '11-comp.yaml');
  if (!existsSync(passFile)) return null;
  try {
    const parsed = load(readFileSync(passFile, 'utf-8')) as {
      assessment?: { regimes?: Array<Record<string, unknown>> };
    } | null;
    const regimes = parsed?.assessment?.regimes;
    if (Array.isArray(regimes) && regimes.length > 0) return regimes;
  } catch { /* fall through to UNKNOWN derivation */ }
  return null;
}

// Read Pass 12 (block_assessments) output if it exists. The pass writes
// eight operational block evaluations under `assessment.blocks`, keyed by
// block name (observability, licence_compliance, testing_maturity,
// architecture_assessment, database_assessment, integration_assessment,
// iam_assessment, dr_assessment). derive-plan spreads each block as a
// top-level key on wsp-plan.yaml so star.ts finds them via plan[blockName]
// and emits one row per block into fact_assessments.csv (#0236).
// #0263 Phase 1 -- read Pass 13 scope_coverage block from disk so
// derive-plan can surface it on wsp-plan.yaml. Returns null if Pass 13
// didn't run.
function loadScopePassOutput(runDir: string): Record<string, unknown> | null {
  const passFile = join(runDir, 'passes', '13-scope.yaml');
  if (!existsSync(passFile)) return null;
  try {
    const parsed = load(readFileSync(passFile, 'utf-8')) as {
      assessment?: { scope_coverage?: Record<string, unknown> };
    } | null;
    const scope = parsed?.assessment?.scope_coverage;
    if (scope && typeof scope === 'object') return scope;
  } catch { /* fall through */ }
  return null;
}

function loadBlocksPassOutput(runDir: string): Record<string, unknown> | null {
  const passFile = join(runDir, 'passes', '12-blocks.yaml');
  if (!existsSync(passFile)) return null;
  try {
    const parsed = load(readFileSync(passFile, 'utf-8')) as {
      assessment?: { blocks?: Record<string, unknown> };
    } | null;
    const blocks = parsed?.assessment?.blocks;
    if (blocks && typeof blocks === 'object' && Object.keys(blocks).length > 0) return blocks;
  } catch { /* fall through */ }
  return null;
}

function buildComplianceBlock(workspaceDir: string, regimeIds: string[], runDir: string): unknown {
  if (regimeIds.length === 0) return undefined;

  // Prefer real Pass 11 evaluation when available.
  const passRegimes = loadCompliancePassOutput(runDir);
  if (passRegimes) {
    return { regimes: passRegimes };
  }

  // Fallback: auto-derived UNKNOWN block (legacy path; emitted when
  // Pass 11 didn't run -- e.g. user explicitly skipped it via --passes).
  // Sprint-039 #0358 Phase 3 -- standard scope retired; the fallback
  // now walks community/<id>/controls.yaml (folder-per-framework shape).
  const catalogsDir = resolveCatalogsDir(workspaceDir);
  const communityDir = join(catalogsDir, 'community');
  if (!existsSync(communityDir)) return undefined;

  const byId = new Map<string, unknown>();
  for (const entry of readdirSync(communityDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const controlsPath = join(communityDir, entry.name, 'controls.yaml');
    if (!existsSync(controlsPath)) continue;
    try {
      const cat = loadRegimeCatalogue(controlsPath) as { regime_meta: { id: string }; controls?: Array<Record<string, unknown>> };
      byId.set(cat.regime_meta.id, cat);
    } catch { /* skip unparseable */ }
  }

  const regimes: unknown[] = [];
  for (const rid of regimeIds) {
    const cat = byId.get(rid) as { regime_meta?: { name?: string; version?: string }; controls?: Array<Record<string, unknown>> } | undefined;
    if (!cat) continue;
    const controls = (cat.controls ?? []).map((c) => ({
      id: c['id'],
      title: c['title'] ?? '',
      description: c['description'] ?? '',
      severity: c['severity_default'] ?? 'medium',
      outcome: 'UNKNOWN',
      status: 'UNKNOWN',
      rationale: 'No LLM compliance evaluation pass ran. Re-run assess with the `comp` pass enabled (default) to get SATISFIED / PARTIAL / GAP verdicts.',
      signal_refs: [],
      evidence_ids: [],
      assessor: 'auto-derived',
      assessed_at: new Date().toISOString().slice(0, 10),
      remediation: c['rationale'] ?? '',
    }));
    regimes.push({
      id: rid,
      name: cat.regime_meta?.name ?? rid,
      version: cat.regime_meta?.version ?? '',
      status: 'auto-derived',
      controls,
    });
  }
  if (regimes.length === 0) return undefined;
  return { regimes };
}

// #0256 + #0257 -- evidence pipeline. The catalogue is keyed by an opaque
// deterministic slug ('EVD-...'); the index maps original ref strings back
// to those slugs so star.ts can rewrite signal.evidence[] entries to
// opaque IDs when emitting link_signal_evidence / link_control_evidence.
//
// Absence sentinels ("0 source files scanned", "No application code
// provided", etc.) are recognised here and dropped; they are not evidence,
// they are a pass communicating "nothing to evidence" -- they should never
// appear as a foreign key.

const ABSENCE_SENTINEL_RE = /^(no [a-z]|0 source files|n\/a|none|missing|undetermined)/i;

interface EvidenceCatalogueEntry {
  type: string;
  source_path: string;
  summary: string;
  context_input: string;
  collected_at: string;
  // Retained for back-compat with v0.10 readers that key on `date`.
  date: string;
  reliability_weight: number;
  // The original ref strings that resolved to this opaque ID. Used by
  // star.ts as a reverse lookup when building link tables.
  refs: string[];
}

const RELIABILITY_BY_CONTEXT: Record<string, number> = {
  cmdb_export: 1.0,
  finops_export: 1.0,
  apm: 0.95,
  static_analysis: 0.9,
  incident_record: 0.85,
  architecture_doc: 0.7,
  ops_runbook: 0.75,
  workshop_transcript: 0.6,
  derived: 0.5,
  imported_artifact: 0.9,
  meeting_transcript: 0.6,
};

function classifyEvidence(ref: string): { type: string; context_input: string } {
  if (/(cmdb|servicenow)/i.test(ref)) return { type: 'imported_artifact', context_input: 'cmdb_export' };
  if (/(finops|cloudability|cost)/i.test(ref)) return { type: 'imported_artifact', context_input: 'finops_export' };
  if (/incident|inc-\d|outage/i.test(ref)) return { type: 'imported_artifact', context_input: 'incident_record' };
  if (/workshop|interview|meeting|participant/i.test(ref)) return { type: 'meeting_transcript', context_input: 'workshop_transcript' };
  if (/runbook|ops\//i.test(ref)) return { type: 'imported_artifact', context_input: 'ops_runbook' };
  if (/architecture|diagram|adr/i.test(ref)) return { type: 'imported_artifact', context_input: 'architecture_doc' };
  if (/\.(json|yaml|yml|toml|tf|tfstate|tfvars|dockerfile)\b/i.test(ref)) return { type: 'static_analysis', context_input: 'static_analysis' };
  if (/(package\.json|cargo\.toml|requirements\.txt|go\.mod|pom\.xml|gemfile)/i.test(ref)) return { type: 'static_analysis', context_input: 'static_analysis' };
  return { type: 'derived', context_input: 'derived' };
}

// #0267 -- normalise every evidence ref to a single canonical shape:
// workspace-root relative. The dim_evidence.source_path column previously
// emitted two shapes (file rows dropped the wsp/inputs/ prefix; directory
// rows retained it), forcing the PowerBI evidence_link M-code to wrap a
// conditional prepend. After this normaliser the M-code workaround can
// collapse to `EvidenceUrlPrefix & source_path` with no conditional.
//
// Three cases:
//   1. Ref already workspace-root prefixed (starts with `wsp/`) -> keep.
//   2. Static-analysis ref (package.json, *.tf, *.yaml, etc.) ->
//      prepend `wsp/inputs/source/` (source code is cloned into
//      wsp/inputs/source/ per design 011 + pass-04-ctx.ts).
//   3. Other evidence types (compliance docs, workshops, CMDB exports,
//      etc.) -> prepend `wsp/inputs/`.
//
// Sentinel / narrative refs (e.g. `Zero files scanned`, derived sentences,
// or refs with parenthetical annotations like `package.json (foo: 1.0)`)
// pass through untouched -- they are not file paths, the link will be
// dead on click as expected (see AUTHORING-GUIDE.md §6 Step A comment).
export function normaliseSourcePath(ref: string, type: string): string {
  // Empty or non-string -> pass through (defensive; should not happen).
  if (typeof ref !== 'string' || ref.length === 0) return ref;
  // Already canonical.
  if (ref.startsWith('wsp/')) return ref;
  // Sentinel sentences (start with a capital letter + a space, then no
  // slash before a path-like character) are not paths. Heuristic: refs
  // with no `/` AND no `.` AND containing spaces are likely sentences.
  if (!ref.includes('/') && !ref.includes('\\') && !ref.includes('.') && ref.includes(' ')) return ref;
  if (type === 'static_analysis') return `wsp/inputs/source/${ref}`;
  return `wsp/inputs/${ref}`;
}

function slugEvidenceRef(ref: string): string | null {
  if (ABSENCE_SENTINEL_RE.test(ref.trim())) return null;
  // Bound the input before the regex chain: evidence refs are short labels, but
  // they can carry LLM-/source-derived text. The `\([^)]*\)` parenthetical-drop
  // is O(n^2) over many failing start positions (a string of unmatched '('),
  // so cap the length first to keep it constant-time (CodeQL js/polynomial-redos).
  // The slug is capped at 64 below regardless.
  const slug = (ref.length > 200 ? ref.slice(0, 200) : ref)
    .replace(/\([^)]*\)/g, '')  // drop parenthetical narrative
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 64);
  if (!slug || slug.length < 2) return null;
  return `EVD-${slug}`;
}

function summariseRef(ref: string): string {
  // Path-shaped refs: keep the basename + parent dir as summary.
  const parts = ref.split(/[\\/]/);
  if (parts.length > 1 && parts[parts.length - 1].length > 0) {
    return parts.slice(-2).join('/').slice(0, 200);
  }
  return ref.slice(0, 200);
}

interface PlanLikeForEvidence {
  compliance?: { regimes?: Array<{ controls?: Array<{ evidence_ids?: string[]; evidence?: string[] }> }> };
}

// Context-input label mapped from WspEvidenceRecord.type (Design 080 §5.2).
const EVIDENCE_TYPE_TO_CONTEXT: Record<string, string> = {
  workshop:       'workshop_transcript',
  architecture_doc: 'architecture_doc',
  cmdb:           'cmdb_export',
  finops:         'finops_export',
  incident:       'incident_record',
  ops_runbook:    'ops_runbook',
  apm:            'apm',
  static_analysis: 'static_analysis',
  other:          'derived',
};

interface IngestionEvidenceRecord {
  evidence_id?: string;
  type?: string;
  statement?: string;
  captured_at?: string;
  source_chatlog?: string;
  addresses?: unknown[];
}

// Reads *.yaml files from ingestion/evidence/ and returns parsed records.
// Silently skips unparseable files so a corrupt capture doesn't abort the run.
export function loadIngestionEvidenceRecords(appDir: string): IngestionEvidenceRecord[] {
  const evidenceDir = join(appDir, 'ingestion', 'evidence');
  if (!existsSync(evidenceDir)) return [];
  const results: IngestionEvidenceRecord[] = [];
  let entries: string[];
  try { entries = readdirSync(evidenceDir); } catch { return []; }
  for (const f of entries) {
    if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
    try {
      const parsed = load(readFileSync(join(evidenceDir, f), 'utf-8')) as IngestionEvidenceRecord;
      if (parsed && typeof parsed === 'object' && parsed.evidence_id) results.push(parsed);
    } catch { /* skip corrupt file */ }
  }
  return results;
}

// Cross-reference propagation (#1180 AC2-3): for each captured evidence record,
// propagate it to controls in the compliance plan that reference the same signals
// via their `signal_refs` field OR by direct control ID. Modifies the compliance block in-place.
// Each propagated control gets a `derived_from` annotation so an auditor can
// reverse a single propagation without touching the source evidence record.
// Multiple propagations accumulate in `derived_from` ('; '-separated) so no annotation is lost.
export function propagateIngestionEvidence(
  compliance:
    | {
        regimes?: Array<{
          id: string;
          controls?: Array<{ id: string; signal_refs?: string[]; evidence_ids?: string[]; derived_from?: string }>;
        }>;
      }
    | undefined,
  knownSignalIds: ReadonlySet<string>,
  ingestionEvidence: IngestionEvidenceRecord[],
): void {
  if (!compliance?.regimes?.length || !ingestionEvidence.length) return;

  type CtrlRef = { id: string; signal_refs?: string[]; evidence_ids?: string[]; derived_from?: string };

  // Build signal -> [control] index and controlId -> control index from the plan's controls.
  const signalToControls = new Map<string, CtrlRef[]>();
  const controlById = new Map<string, CtrlRef>();
  for (const regime of compliance.regimes ?? []) {
    for (const ctrl of regime.controls ?? []) {
      controlById.set(ctrl.id, ctrl);
      for (const sid of ctrl.signal_refs ?? []) {
        if (!signalToControls.has(sid)) signalToControls.set(sid, []);
        signalToControls.get(sid)!.push(ctrl);
      }
    }
  }

  function appendDerivedFrom(ctrl: CtrlRef, annotation: string): void {
    ctrl.derived_from = ctrl.derived_from
      ? `${ctrl.derived_from}; ${annotation}`
      : annotation;
  }

  for (const rec of ingestionEvidence) {
    const evidenceId = rec.evidence_id!;
    const addresses = Array.isArray(rec.addresses)
      ? (rec.addresses as unknown[]).map(String).filter(Boolean)
      : [];

    for (const addr of addresses) {
      if (knownSignalIds.has(addr)) {
        // Signal-based: propagate to all controls that reference this signal via signal_refs.
        for (const ctrl of signalToControls.get(addr) ?? []) {
          const ids = ctrl.evidence_ids ?? [];
          if (!ids.includes(evidenceId)) {
            ctrl.evidence_ids = [...ids, evidenceId];
            appendDerivedFrom(ctrl, `${evidenceId} via signal_refs:${addr}`);
          }
        }
      } else {
        // Direct control link: evidence explicitly addresses a control by ID.
        const ctrl = controlById.get(addr);
        if (ctrl) {
          const ids = ctrl.evidence_ids ?? [];
          if (!ids.includes(evidenceId)) {
            ctrl.evidence_ids = [...ids, evidenceId];
            // No derived_from for direct links -- the evidence_id itself is the attribution.
          }
        }
      }
    }
  }
}

export function buildEvidenceCatalogue(
  signals: RawSignal[],
  plan: PlanLikeForEvidence,
  assessedAt: string,
): { catalogue: Record<string, EvidenceCatalogueEntry>; index: Record<string, string> } {
  const catalogue = new Map<string, EvidenceCatalogueEntry>();
  const index: Record<string, string> = {};

  function register(ref: string): void {
    if (typeof ref !== 'string' || ref.length === 0) return;
    if (Object.prototype.hasOwnProperty.call(index, ref)) return;
    const slug = slugEvidenceRef(ref);
    if (slug === null) return;  // absence sentinel
    index[ref] = slug;
    const existing = catalogue.get(slug);
    if (existing) {
      if (!existing.refs.includes(ref)) existing.refs.push(ref);
      return;
    }
    const { type, context_input } = classifyEvidence(ref);
    catalogue.set(slug, {
      type,
      // #0267 -- source_path is now uniformly workspace-root relative.
      source_path: normaliseSourcePath(ref, type),
      summary: summariseRef(ref),
      context_input,
      collected_at: assessedAt,
      date: assessedAt,
      reliability_weight: RELIABILITY_BY_CONTEXT[context_input] ?? 0.5,
      refs: [ref],
    });
  }

  for (const s of signals) {
    for (const ref of s.evidence ?? []) register(ref);
  }
  for (const regime of plan.compliance?.regimes ?? []) {
    for (const c of regime.controls ?? []) {
      for (const ref of c.evidence_ids ?? []) register(ref);
      for (const ref of c.evidence ?? []) register(ref);
    }
  }

  const out: Record<string, EvidenceCatalogueEntry> = {};
  for (const [slug, entry] of catalogue) out[slug] = entry;
  return { catalogue: out, index };
}

function buildFindingsAndRisks(signals: RawSignal[]): { findings: unknown[]; risks: unknown[] } {
  const findings: unknown[] = [];
  const risks: unknown[] = [];
  let findingIdx = 0;
  let riskIdx = 0;

  for (const s of signals) {
    const sev = (s.severity ?? '').toLowerCase();
    const cat = (s.category ?? '').toLowerCase();
    const sigId = s.id ?? '';

    // Security findings: severity high/critical and category looks security-relevant.
    const highSev = sev === 'high' || sev === 'critical';
    const securityish = SECURITY_CATEGORIES.has(cat) || /security|crypto|data|auth|secret|pii/i.test(`${sigId} ${s.derivation ?? ''}`);
    if (highSev && securityish) {
      findingIdx += 1;
      findings.push({
        id: `SEC-${String(findingIdx).padStart(3, '0')}`,
        category: cat || 'security',
        severity: sev,
        description: s.description ?? s.derivation ?? `Auto-derived from signal ${sigId}`,
        remediation: s.recommendation ?? s.rationale ?? 'Triage in next review cycle.',
        blocks_migration: sev === 'critical',
        signal_ref: sigId,
      });
    }

    // Risks: any signal with category that maps to a risk dimension, severity >= medium.
    const riskish = RISK_CATEGORIES.has(cat) || /risk|blocker|gap|compliance/i.test(`${sigId} ${s.derivation ?? ''}`);
    const mediumPlus = sev === 'medium' || sev === 'high' || sev === 'critical';
    if (riskish && mediumPlus) {
      riskIdx += 1;
      const likelihood = sev === 'critical' ? 'high' : sev === 'high' ? 'medium' : 'low';
      const impact = sev === 'critical' ? 'critical' : sev === 'high' ? 'high' : 'medium';
      risks.push({
        risk_id: `RR-${String(riskIdx).padStart(3, '0')}`,
        category: cat || 'operational',
        likelihood,
        impact,
        trigger: `Signal ${sigId} -- ${s.derivation ?? s.description ?? 'see assessment'}`,
        mitigation: s.recommendation ?? 'Address during pre-migration triage.',
        owner: 'platform_lead',
      });
    }
  }
  return { findings, risks };
}

// Design 080 §5.4: load attributed overrides from feedback/overrides.yaml.
function loadFeedbackOverrides(workspaceAppDir: string): Array<Record<string, unknown>> {
  const overridePath = join(workspaceAppDir, 'feedback', 'overrides.yaml');
  if (!existsSync(overridePath)) return [];
  try {
    const raw = load(readFileSync(overridePath, 'utf-8')) as { overrides?: unknown[] } | unknown[] | null;
    const arr: unknown[] = Array.isArray(raw) ? raw : (raw as { overrides?: unknown[] } | null)?.overrides ?? [];
    return arr.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object') as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

// Apply attributed overrides: machine verdict preserved, override wins (decision Q8).
function applyFeedbackOverrides(
  plan: Record<string, unknown>,
  overrides: Array<Record<string, unknown>>,
): void {
  if (overrides.length === 0) return;
  const compliance = plan['compliance'] as { regimes?: Array<{ controls?: Array<Record<string, unknown>> }> } | undefined;
  const riskRegister = plan['risk_register'] as Array<Record<string, unknown>> | undefined;

  const controlById = new Map<string, Record<string, unknown>>();
  for (const regime of compliance?.regimes ?? []) {
    for (const ctrl of regime.controls ?? []) {
      if (typeof ctrl['id'] === 'string') controlById.set(ctrl['id'], ctrl);
    }
  }
  const riskById = new Map<string, Record<string, unknown>>();
  for (const risk of riskRegister ?? []) {
    if (typeof risk['risk_id'] === 'string') riskById.set(risk['risk_id'], risk);
  }

  for (const ov of overrides) {
    const targetType = String(ov['target_type'] ?? '');
    const targetId   = String(ov['target_id'] ?? '');
    if (!targetId) continue;
    const overrideBlock: Record<string, unknown> = {
      author: ov['author'], role: ov['role'], timestamp: ov['timestamp'], rationale: ov['rationale'],
    };
    if (ov['evidence_ids']) overrideBlock['evidence_ids'] = ov['evidence_ids'];

    if (targetType === 'control') {
      const ctrl = controlById.get(targetId);
      if (ctrl) {
        ctrl['machine_outcome'] = ctrl['outcome'] ?? ctrl['status'];
        ctrl['outcome'] = ov['override_outcome'];
        ctrl['override'] = overrideBlock;
      }
    } else if (targetType === 'risk') {
      const risk = riskById.get(targetId);
      if (risk) {
        risk['machine_outcome'] = risk['status'] ?? risk['outcome'];
        risk['status'] = ov['override_outcome'];
        risk['override'] = overrideBlock;
      }
    }
  }
}

// Design 080 §5.3: load the durable risk overlay written by swao_risk_import.
function loadRiskOverlay(workspaceAppDir: string): Array<Record<string, unknown>> {
  const overlayPath = join(workspaceAppDir, 'ingestion', 'structured', 'risk-register-import.yaml');
  if (!existsSync(overlayPath)) return [];
  try {
    const raw = load(readFileSync(overlayPath, 'utf-8'));
    const parsed = WspRiskImportOverlaySchema.safeParse(raw);
    if (!parsed.success) return [];
    return parsed.data.risks as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

// Union by risk_id; overlay wins on status/evidence_ids/closed_rationale/closed_at.
// Consultant-authored rows (ids not in machine register) are appended.
function mergeRiskOverlay(
  machineRisks: Array<Record<string, unknown>>,
  overlayRisks: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (overlayRisks.length === 0) return machineRisks;
  const OVERLAY_WINS = ['status', 'evidence_ids', 'closed_rationale', 'closed_at'] as const;
  const byId = new Map<string, Record<string, unknown>>(
    machineRisks.map(r => [String(r['risk_id']), r]),
  );
  for (const ov of overlayRisks) {
    const id = String(ov['risk_id'] ?? '');
    if (!id) continue;
    const existing = byId.get(id);
    if (existing) {
      for (const field of OVERLAY_WINS) {
        const val = ov[field];
        if (val !== undefined && val !== '') existing[field] = val;
      }
    } else {
      byId.set(id, { ...ov });
    }
  }
  return [...byId.values()];
}

// #0060 sprint-038: data-migration feasibility computation. Reads
// `.swao.yml migration:` for operator-supplied overrides. Returns
// undefined when neither volume nor RTO is available -- the schema
// requires `feasibility_verdict` and we'd rather skip the block than
// emit an unsupported verdict.
interface DataMigrationOutput {
  feasibility_verdict: 'feasible' | 'marginal' | 'requires_phased_migration';
  total_stateful_volume_gb: number;
  storage_source: 'finops_export' | 'cmdb' | 'swao_yml_override' | 'assumed_default';
  transfer_rate_gbph: number;
  estimated_transfer_hours: number;
  rto_hours: number;
  feasibility_note: string;
  risk_register_ref?: string;
}

export function computeDataMigrationFeasibility(workspaceAppDir: string): DataMigrationOutput | undefined {
  const swaoYmlPath = join(workspaceAppDir, '.swao.yml');
  if (!existsSync(swaoYmlPath)) return undefined;
  let yml: { migration?: { transfer_rate_gbph?: number; total_storage_gb_override?: number; rto_hours_override?: number } } = {};
  try {
    yml = (load(readFileSync(swaoYmlPath, 'utf-8')) as typeof yml) ?? {};
  } catch {
    return undefined;
  }
  const mig = yml.migration;
  // FinOps + CMDB automatic extraction is sprint-039 follow-up; today
  // require operator override OR skip.
  const total_storage_gb = mig?.total_storage_gb_override;
  const rto_hours = mig?.rto_hours_override;
  if (typeof total_storage_gb !== 'number' || typeof rto_hours !== 'number') {
    return undefined;
  }
  const transfer_rate_gbph = mig?.transfer_rate_gbph ?? 100; // conservative default
  const estimated_transfer_hours = total_storage_gb / transfer_rate_gbph;
  let feasibility_verdict: DataMigrationOutput['feasibility_verdict'];
  let feasibility_note: string;
  if (estimated_transfer_hours <= rto_hours * 0.6) {
    feasibility_verdict = 'feasible';
    feasibility_note = `Estimated transfer time (${estimated_transfer_hours.toFixed(1)}h) fits comfortably within the RTO (${rto_hours}h). Blue/green cutover is viable.`;
  } else if (estimated_transfer_hours <= rto_hours) {
    feasibility_verdict = 'marginal';
    feasibility_note = `Estimated transfer time (${estimated_transfer_hours.toFixed(1)}h) approaches the RTO ceiling (${rto_hours}h). Run a dry-run before committing to a single-window cutover.`;
  } else {
    feasibility_verdict = 'requires_phased_migration';
    feasibility_note = `Estimated transfer time (${estimated_transfer_hours.toFixed(1)}h) exceeds RTO (${rto_hours}h). Single-window cutover is not feasible; recommend phased migration with logical replication.`;
  }
  return {
    feasibility_verdict,
    total_stateful_volume_gb: total_storage_gb,
    storage_source: 'swao_yml_override',
    transfer_rate_gbph,
    estimated_transfer_hours,
    rto_hours,
    feasibility_note,
  };
}

export interface DerivePlanResult {
  planPath: string;
  spinePath: string;
  evidencePath: string;
  regimesIncluded: string[];
  controlsCount: number;
  findingsCount: number;
  risksCount: number;
}

export function derivePlanForRun(
  workspaceRoot: string,
  workspaceAppDir: string,
  runDir: string,
  appId: string,
  runId: string,
  assessedAt: string,
): DerivePlanResult {
  const regimeIds = loadAppRegimes(workspaceAppDir);
  const signals = loadSignalsFromRun(runDir);
  const compliance = buildComplianceBlock(workspaceRoot, regimeIds, runDir) as { regimes?: Array<{ id: string; controls?: unknown[] }> } | undefined;
  const { findings, risks } = buildFindingsAndRisks(signals);

  const controlsCount = (compliance?.regimes ?? []).reduce((sum, r) => sum + (r.controls?.length ?? 0), 0);

  const plan: Record<string, unknown> = {};
  if (compliance) plan['compliance'] = compliance;
  if (findings.length > 0) plan['security_findings'] = findings;
  if (risks.length > 0) plan['risk_register'] = risks;

  // #0236: spread Pass 12 block assessments as top-level keys so star.ts
  // emits one row per block into fact_assessments.csv (Auditor PowerBI tab).
  const blocks = loadBlocksPassOutput(runDir);
  if (blocks) {
    for (const [blockName, block] of Object.entries(blocks)) {
      plan[blockName] = block;
    }
  }

  // #0263 Phase 1: surface Pass 13 scope_coverage as a top-level key on
  // wsp-plan.yaml so the auditor view + doctor probe can read it.
  const scopeCoverage = loadScopePassOutput(runDir);
  if (scopeCoverage) {
    plan['scope_coverage'] = scopeCoverage;
  }

  // #0060 sprint-038: data-migration feasibility computation. Reads
  // `.swao.yml migration:` overrides (operator-supplied), falls back to
  // 100 GB/hr transfer rate and skips computation entirely if neither
  // volume nor RTO is available. FinOps + CMDB automatic volume
  // extraction is a sprint-039 follow-up; this lands the schema +
  // computation so operator-furnished engagements get the verdict today.
  const dataMigration = computeDataMigrationFeasibility(workspaceAppDir);
  if (dataMigration) {
    plan['migration_plan'] = {
      ...(plan['migration_plan'] as Record<string, unknown> ?? {}),
      data_migration: dataMigration,
    };
    // Seed a risk register entry for marginal / requires_phased_migration.
    if (dataMigration.feasibility_verdict !== 'feasible') {
      const existingRisks = (plan['risk_register'] as Array<Record<string, unknown>>) ?? [];
      const riskId = 'RR-DATA-01';
      const risk: Record<string, unknown> = {
        risk_id: riskId,
        category: 'data_migration',
        likelihood: 'high',
        impact: dataMigration.feasibility_verdict === 'requires_phased_migration' ? 'high' : 'medium',
        trigger: dataMigration.feasibility_note ?? 'Data-migration feasibility verdict is not "feasible".',
        mitigation: dataMigration.feasibility_verdict === 'requires_phased_migration'
          ? 'Recommend phased migration with logical replication; align cutover plan with extended RTO window.'
          : 'Validate the transfer-rate assumption against a pre-cutover dry-run; consider phased migration if the dry-run exceeds the marginal threshold.',
        owner: 'platform_lead',
      };
      existingRisks.push(risk);
      plan['risk_register'] = existingRisks;
      dataMigration.risk_register_ref = riskId;
    }
  }

  // Design 080 §5.3: merge durable risk overlay (written by swao_risk_import).
  // Runs after the data-migration seed so RR-DATA-01 is eligible for overlay.
  const overlayRisks = loadRiskOverlay(workspaceAppDir);
  if (overlayRisks.length > 0) {
    const currentRisks = (plan['risk_register'] as Array<Record<string, unknown>>) ?? [];
    plan['risk_register'] = mergeRiskOverlay(currentRisks, overlayRisks);
  }

  // Design 080 §5.4: apply attributed overrides (written by swao_feedback_add).
  // Runs after the risk overlay merge so overlay-added risks are eligible for override.
  const feedbackOverrides = loadFeedbackOverrides(workspaceAppDir);
  if (feedbackOverrides.length > 0) {
    applyFeedbackOverrides(plan, feedbackOverrides);
  }

  // Cross-reference propagation (#1180 AC2-3): evidence captured via
  // swao_evidence_capture propagates to controls that share the addressed
  // signal via signal_refs. Runs before wsp-plan.yaml is written so the
  // propagated evidence_ids appear in the plan and the HTML report.
  const ingestionEvidence = loadIngestionEvidenceRecords(workspaceAppDir);
  const knownSignalSet = new Set(signals.map(s => s.id ?? '').filter(Boolean));
  if (compliance && ingestionEvidence.length > 0) {
    propagateIngestionEvidence(
      compliance as Parameters<typeof propagateIngestionEvidence>[0],
      knownSignalSet,
      ingestionEvidence,
    );
  }

  const planPath = join(runDir, 'wsp-plan.yaml');
  writeFileSync(planPath, dump(plan, { lineWidth: 120, noRefs: true }), 'utf-8');

  // Spine populated from synth pass + .swao.yml so the BI export's
  // dim_app row carries name, 7R label, coverage_score, landing_zone,
  // and the engagement metadata is available downstream (#0228 wiring
  // continues in star.ts).
  const synth = loadSynthAssessment(runDir);
  const engagement = loadEngagement(workspaceRoot);
  const appMeta = loadAppMeta(workspaceAppDir);
  const spine: Record<string, unknown> = {
    schema_version: WSP_SCHEMA_VERSION,
    app_id: appId,
    run_id: runId,
    assessed_at: assessedAt,
    iter: 1,
    workload: {
      name: appMeta?.name || appId,
      business_domain: appMeta?.business_domain ?? '',
      business_criticality: appMeta?.business_criticality ?? '',
    },
    overall: {
      seven_r_label: synth?.seven_r_label ?? '',
      modernization_position: synth?.modernization_position ?? '',
      coverage_score: synth?.coverage_score ?? '',
      cloud_native_score: synth?.cloud_native_score ?? loadTfPassRate(runDir) ?? '',
      portability_score: synth?.portability_score ?? '',
      confidence: synth?.confidence ?? '',
    },
    landing_zone: {
      primary: null,
      status: synth?.landing_zone ?? '',
    },
  };
  if (engagement) {
    spine['engagement'] = {
      name: engagement.name ?? '',
      client_code: engagement.client_code ?? '',
      partnership_lead: engagement.partnership_lead ?? '',
      start_date: engagement.start_date ?? '',
    };
  }
  const spinePath = join(runDir, 'wsp.yaml');
  writeFileSync(spinePath, dump(spine, { lineWidth: 120 }), 'utf-8');

  // Evidence catalogue derived from per-signal evidence refs (#0232).
  // The export reads `evidence_catalogue:` (a map) at the top level and
  // builds `dim_evidence` from it.
  //
  // #0257 -- evidence IDs are opaque deterministic slugs ('EVD-...'),
  //          not descriptive sentences; absence sentinels are dropped.
  // #0256 -- catalogue entries carry summary, context_input, collected_at,
  //          reliability_weight so dim_evidence ships populated.
  //
  // Cross-ref: `evidence_index` is a top-level map { originalRef -> EVD-id }
  // used by star.ts to rewrite signal.evidence[] when emitting
  // link_signal_evidence / link_control_evidence rows. Star walks signals
  // for those link tables, so it needs the lookup to translate refs without
  // re-deriving the slug rules here.
  const { catalogue: evidenceCatalogue, index: evidenceIndex } =
    buildEvidenceCatalogue(signals, plan, assessedAt);

  // Fold in MCP-captured evidence from ingestion/evidence/*.yaml (Design 080 §5.2, #1179 AC3).
  // Each record was written by swao_evidence_capture; derive merges it into the catalogue
  // so the PowerBI star export and HTML report can reference it alongside signal-derived evidence.
  for (const rec of loadIngestionEvidenceRecords(workspaceAppDir)) {
    const id = rec.evidence_id!;
    if (Object.prototype.hasOwnProperty.call(evidenceCatalogue, id)) continue;
    const contextInput = EVIDENCE_TYPE_TO_CONTEXT[rec.type ?? ''] ?? 'derived';
    evidenceCatalogue[id] = {
      type: rec.type ?? 'other',
      source_path: rec.source_chatlog ?? `ingestion/evidence/${id}.yaml`,
      summary: rec.statement ?? id,
      context_input: contextInput,
      collected_at: rec.captured_at ?? assessedAt,
      date: rec.captured_at ?? assessedAt,
      reliability_weight: RELIABILITY_BY_CONTEXT[contextInput] ?? 0.5,
      refs: [id],
    };
    evidenceIndex[id] = id;
  }

  const evidencePath = join(runDir, 'wsp-evidence.yaml');
  writeFileSync(evidencePath, dump({
    evidence_catalogue: evidenceCatalogue,
    evidence_index: evidenceIndex,
  }, { lineWidth: 120 }), 'utf-8');

  return {
    planPath,
    spinePath,
    evidencePath,
    regimesIncluded: regimeIds,
    controlsCount,
    findingsCount: findings.length,
    risksCount: risks.length,
  };
}
