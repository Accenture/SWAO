// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Publication engine extractor -- Design 041 §4.2 / issue #0428
 *
 * Reads WSP run-dir artefacts and assembles a PublicationModel v1.0.
 *
 * Schema notes:
 *   - wsp.yaml  is v0.10 on disk (fields: app_id, engagement, landing_zone).
 *     SpineSchema expects v0.9; we read raw to avoid false-fail.  See comment
 *     at rawSpine below.
 *   - wsp-evidence.yaml types are the WSP-internal vocab (imported_artifact,
 *     derived, meeting_transcript etc.) which overlap only partially with the
 *     EvidenceSchema enum; we read raw and map types ourselves.
 *   - wsp-plan.yaml uses PlanSchema.safeParse; on failure risk_register = [].
 *   - passes/*.yaml use PassFileSchema.safeParse per file; failures are skipped.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';

import { PassFileSchema, RunManifestSchema, SwaoYmlSchema, type SwaoYml } from '@swao/core';
import {
  CONTRACT_VERSION,
  PublicationModelSchema,
  type PublicationModel,
  type PubSignal,
  type PubEvidence,
  type TagIndex,
  type EvidenceType,
} from './model.js';
import { redactForReport } from '@swao/core';
import { communityFrameworksDir } from '@swao/community-frameworks';

// ---------------------------------------------------------------------------
// LensDefinition
// ---------------------------------------------------------------------------

export interface LensDefinition {
  id: string;
  passes: string[];
  auto_frameworks: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load a lens definition YAML from controls/lenses/{lensId}.yaml.
 * controlsDir, when omitted, is resolved relative to this file. extractor.ts
 * moved into @swao/module-html-report/src/publish/ (#0575), so the dev path is
 * now 5 levels up (publish -> src -> module-html-report -> @swao -> packages ->
 * swao); dist/publish/ sits at the same depth. The 4-up string is PRESERVED for
 * the pkg binary (controls bundled at ../../controls/** relative to dist/).
 */
export function loadLensDefinition(lensId: string, controlsDir?: string): LensDefinition {
  const baseCandidates = controlsDir
    ? [controlsDir]
    : [
        join(__dirname, '../../../../../controls'),  // dev + module dist
        join(__dirname, '../../../../controls'),     // pkg binary (preserved)
      ];
  const lensPath =
    baseCandidates
      .map(base => join(base, 'lenses', `${lensId}.yaml`))
      .find(p => existsSync(p)) ?? '';
  if (!lensPath) {
    throw new Error(`Unknown lens: ${lensId}`);
  }
  const raw = load(readFileSync(lensPath, 'utf-8')) as {
    id?: unknown;
    passes?: unknown;
    auto_frameworks?: unknown;
  };
  return {
    id: typeof raw.id === 'string' ? raw.id : lensId,
    passes: Array.isArray(raw.passes) ? (raw.passes as string[]) : [],
    auto_frameworks: Array.isArray(raw.auto_frameworks) ? (raw.auto_frameworks as string[]) : [],
  };
}

// ---------------------------------------------------------------------------
// PII redaction exports
// ---------------------------------------------------------------------------

export interface PiiRedaction {
  field: string;
  types: string[];
}

export interface SanitisePiiResult {
  redactions: PiiRedaction[];
}

/**
 * Redact PII from signal derivation fields in place.
 * Applies redactForReport() to each signal.derivation; tracks which fields
 * were changed and which PII classes were found.
 * engagement.partnership_lead is intentionally NOT redacted (verbatim pass-through).
 */
export function sanitisePII(model: PublicationModel): SanitisePiiResult {
  const redactions: PiiRedaction[] = [];
  for (let i = 0; i < model.signals.length; i++) {
    const { text, counts } = redactForReport(model.signals[i].derivation);
    if (text !== model.signals[i].derivation) {
      model.signals[i] = { ...model.signals[i], derivation: text };
      const types = (Object.entries(counts) as [string, number][])
        .filter(([, n]) => n > 0)
        .map(([k]) => k);
      redactions.push({ field: `signals[${i}].derivation`, types });
    }
  }
  return { redactions };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadYaml(filePath: string): unknown {
  try {
    return load(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function slugify(key: string): string {
  return 'ev-' + key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function mapOutcome(outcome: string | undefined): 'positive' | 'negative' | 'informational' {
  if (outcome === 'positive') return 'positive';
  if (outcome === 'negative') return 'negative';
  return 'informational';
}

function mapEvidenceType(raw: string | undefined): EvidenceType {
  if (raw === 'architecture_doc' || raw === 'derived') return 'derived';
  if (raw === 'meeting_transcript') return 'meeting_transcript';
  return 'imported_artifact';
}

function countBySeverity(signals: PubSignal[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of signals) {
    counts[s.severity] = (counts[s.severity] ?? 0) + 1;
  }
  return counts;
}

function buildTagIndex(signals: PubSignal[], _evidence: PubEvidence[]): TagIndex {
  const idx: TagIndex = {};
  for (const s of signals) {
    for (const tag of s.tags) {
      if (!idx[tag]) idx[tag] = [];
      idx[tag].push({ anchor: s.anchor, type: 'signal', label: s.id });
    }
  }
  return idx;
}

// ---------------------------------------------------------------------------
// Compliance mapper
// ---------------------------------------------------------------------------

interface RawControl {
  id?: string;
  pillar?: string;
  title?: string;
  description?: string;
  severity_default?: string;
  remediation?: string;
  tags?: unknown[];
  evidence_basis?: unknown[];
  maps_to?: unknown[];
  references?: unknown[];
}

interface RawControlsCatalogue {
  regime_meta?: { id?: string; name?: string };
  controls?: RawControl[];
}

/**
 * Determine which community frameworks apply based on signal tags, then
 * load controls and compute RAG status per control.
 *
 * Detection heuristic:
 *   - Signal has tag 'gdpr'  → apply GDPR framework
 *   (extend here as more frameworks land)
 *
 * RAG logic per control (simplified for Iteration 1):
 *   All signals whose derivation mentions the control's id or title keywords
 *   → critical/high → fail; medium/low → partial; else → pass.
 */
function buildCompliance(
  signals: PubSignal[],
): import('./model.js').FrameworkResult[] {
  // Map tag → framework slug (community-frameworks/ subdirectory name)
  const TAG_TO_FRAMEWORK: Record<string, string> = {
    gdpr: 'gdpr',
    crypto: 'gdpr',  // CRYPTO signals map to GDPR Art.32
    erasure: 'gdpr', // erasure signals → GDPR Art.17
  };

  const activeFrameworks = new Set<string>();
  for (const sig of signals) {
    for (const tag of sig.tags) {
      const fw = TAG_TO_FRAMEWORK[tag.toLowerCase()];
      if (fw) activeFrameworks.add(fw);
    }
  }

  // If no tags detected, check signal IDs directly
  const SIGNAL_PREFIX_TO_FRAMEWORK: Record<string, string> = {
    DATA: 'gdpr',
    CRYPTO: 'gdpr',
  };
  for (const sig of signals) {
    const prefix = sig.id.split('-')[0];
    const fw = SIGNAL_PREFIX_TO_FRAMEWORK[prefix];
    if (fw) activeFrameworks.add(fw);
  }

  // The bundled community frameworks dir is resolved by the
  // @swao/community-frameworks leaf package (#0572).
  const results: import('./model.js').FrameworkResult[] = [];

  for (const fwSlug of activeFrameworks) {
    const controlsPath = join(communityFrameworksDir, fwSlug, 'controls.yaml');
    const metaPath = join(communityFrameworksDir, fwSlug, 'framework-meta.yaml');
    if (!existsSync(controlsPath)) continue;

    const catalogue = loadYaml(controlsPath) as RawControlsCatalogue | null;
    if (!catalogue) continue;

    const fwMeta = existsSync(metaPath)
      ? (loadYaml(metaPath) as { framework?: { id?: string; name?: string } } | null)
      : null;

    const frameworkId = catalogue.regime_meta?.id ?? fwMeta?.framework?.id ?? fwSlug.toUpperCase();
    const frameworkName = catalogue.regime_meta?.name ?? fwMeta?.framework?.name ?? frameworkId;
    const controls = catalogue.controls ?? [];

    // Severity ordering for comparison
    const sevRank: Record<string, number> = {
      critical: 0, high: 1, medium: 2, low: 3, informational: 4, positive: 5,
    };

    const controlResults: import('./model.js').ControlResult[] = [];
    let failCount = 0, partialCount = 0, passCount = 0;

    // Signal-prefix to control ID pattern mapping (GDPR-specific, Iteration 1).
    // Each entry: find the first control whose id includes `controlPattern`,
    // and map signals with the given prefixes to it.
    // Art_33 (breach notification) has no signals -- assessed as pass by default.
    const GDPR_SIGNAL_MAP: Array<{ prefixes: string[]; controlPattern: string }> = fwSlug === 'gdpr'
      ? [
          { prefixes: ['DATA'],           controlPattern: 'Art_9'     },
          { prefixes: ['DATA'],           controlPattern: 'Art_17'    },
          { prefixes: ['DATA', 'CRYPTO'], controlPattern: 'Art_25'    },
          { prefixes: ['CRYPTO', 'EGR'],  controlPattern: 'Art_32'    },
          { prefixes: ['CRYPTO'],         controlPattern: 'Art_5_1_f' },
          { prefixes: [],                 controlPattern: 'Art_33'    },
        ]
      : [];

    for (const mapping of GDPR_SIGNAL_MAP) {
      const ctrl = controls.find(c =>
        typeof c.id === 'string' &&
        c.id.toLowerCase().includes(mapping.controlPattern.toLowerCase()),
      );
      if (!ctrl || !ctrl.id || !ctrl.title) continue;

      const ctrlId = String(ctrl.id);
      const ctrlTitle = String(ctrl.title);

      const matchingSignals = mapping.prefixes.length === 0
        ? []
        : signals.filter(s => mapping.prefixes.includes(s.id.split('-')[0]));

      let ragStatus: 'pass' | 'partial' | 'fail' = 'pass';
      let worstSev: import('./model.js').Severity | undefined;

      for (const sig of matchingSignals) {
        const rank = sevRank[sig.severity] ?? 99;
        if (worstSev === undefined || rank < (sevRank[worstSev] ?? 99)) {
          worstSev = sig.severity;
        }
        if (sig.severity === 'critical' || sig.severity === 'high') {
          ragStatus = 'fail';
        } else if (ragStatus !== 'fail' && (sig.severity === 'medium' || sig.severity === 'low')) {
          ragStatus = 'partial';
        }
      }

      if (ragStatus === 'fail') failCount++;
      else if (ragStatus === 'partial') partialCount++;
      else passCount++;

      const anchor = `control-${frameworkId}-${ctrlId}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      controlResults.push({
        id: ctrlId,
        title: ctrlTitle,
        rag_status: ragStatus,
        worst_severity: worstSev,
        signals: matchingSignals.map(s => s.id),
        rationale: ctrl.description ? String(ctrl.description) : '',
        article_text: ctrl.remediation ? String(ctrl.remediation) : '',
        evidence: [],
        anchor,
      });
    }

    // remove GDPR_SIGNAL_MAP loop closing brace -- handled above

    if (controlResults.length === 0) continue;

    results.push({
      framework_id: frameworkId,
      framework_name: frameworkName,
      controls: controlResults,
      fail_count: failCount,
      partial_count: partialCount,
      pass_count: passCount,
      not_assessed_count: 0,
    });
  }

  return results;
}

// Raw WSP spine interface -- v0.10 on-disk format.
// SpineSchema expects wsp_version: '0.9' which the v0.10 fixture lacks;
// we read raw here so the extractor is not gated on schema version migration.
interface RawSpine {
  app_id?: string;
  run_id?: string;
  assessed_at?: string;
  overall?: {
    seven_r_label?: unknown;
    coverage_score?: unknown;
    confidence?: unknown;
    migration_rationale?: unknown;
  };
  workload?: { name?: string };
  app?: { name?: string };
  landing_zone?: { primary?: string | null; status?: string };
  engagement?: {
    name?: string;
    client_code?: string;
    partnership_lead?: string | string[]; // YAML [REDACTED-EMAIL] parses as array
    engagement_lead?: string;
    account_executive?: string;
  };
}

// Raw evidence catalogue -- v0.10 types differ from EvidenceSchema enum.
interface RawEvidenceItem {
  type?: string;
  file?: string;
  summary?: string;
  source_path?: string;
  refs?: string[];
}

interface RawEvidenceCatalogue {
  evidence_catalogue?: Record<string, RawEvidenceItem>;
}

// ---------------------------------------------------------------------------
// LZ Catalogue fit helpers
// ---------------------------------------------------------------------------

function lzCatCheckResult(verdict: string): 'pass' | 'fail' | 'not_applicable' {
  if (verdict === 'SUPPORTED') return 'pass';
  if (verdict === 'AVAILABLE_NOT_ENABLED') return 'not_applicable';
  return 'fail';
}

function lzCatOverallLabel(verdict: string): string {
  switch (verdict) {
    case 'READY': return 'Ready';
    case 'READY_WITH_CHANGES': return 'Conditionally Ready';
    case 'NEEDS_VERIFICATION': return 'Needs Verification';
    case 'BLOCKED': return 'Blocked';
    case 'SOVEREIGNTY_BLOCKED': return 'Sovereignty Blocked';
    default: return verdict;
  }
}

const VERDICT_PRIORITY: Record<string, number> = {
  READY: 0,
  READY_WITH_CHANGES: 1,
  NEEDS_VERIFICATION: 2,
  BLOCKED: 3,
  SOVEREIGNTY_BLOCKED: 4,
};

function worstVerdict(verdicts: string[]): string {
  return verdicts.reduce(
    (a, b) => (VERDICT_PRIORITY[b] ?? 0) > (VERDICT_PRIORITY[a] ?? 0) ? b : a,
    'READY',
  );
}

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

/**
 * Assemble a PublicationModel from a WSP run directory.
 *
 * Required:  {wspRunDir}/wsp.yaml
 * Optional:  run-manifest.json, wsp-evidence.yaml, wsp-plan.yaml,
 *            passes/*.yaml, ../../../.swao.yml (app-level config)
 */
export async function extractPublicationModel(
  wspRunDir: string,
  opts?: { swaoVersion?: string; evidenceBaseUrl?: string },
): Promise<PublicationModel> {
  // Resolve the path to eliminate any '../' traversal sequences before any
  // file-system access (CodeQL js/path-injection -- wspRunDir comes from CLI).
  const safeRunDir = resolvePath(wspRunDir);

  // ------------------------------------------------------------------
  // 1. wsp.yaml (required) -- read raw; SpineSchema expects v0.9 format
  //    but on-disk files use schema_version: '0.10'. See interface above.
  // ------------------------------------------------------------------
  const spineRaw = loadYaml(join(safeRunDir, 'wsp.yaml')) as RawSpine | null;
  if (!spineRaw) {
    throw new Error(
      `No assessment results found in the selected run folder.\n` +
      `Run "swao assess --app <name>" first, then return here to publish.\n` +
      `(Looked for wsp.yaml in: ${safeRunDir})`,
    );
  }
  const spine = spineRaw;

  // ------------------------------------------------------------------
  // 2. run-manifest.json (optional)
  // ------------------------------------------------------------------
  let runManifest: { run_id?: string; assessed_at?: string } | null = null;
  const manifestPath = join(safeRunDir, 'run-manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
      const parsed = RunManifestSchema.safeParse(raw);
      if (parsed.success) {
        runManifest = parsed.data;
      }
    } catch {
      // skip malformed manifest
    }
  }

  // ------------------------------------------------------------------
  // 3. wsp-evidence.yaml (optional) -- read raw; EvidenceSchema enum
  //    does not include 'imported_artifact'/'derived'/'meeting_transcript'
  //    which are the actual v0.10 types used on disk.
  // ------------------------------------------------------------------
  const evidenceRaw = loadYaml(join(safeRunDir, 'wsp-evidence.yaml')) as RawEvidenceCatalogue | null;
  const evidenceCatalogue = evidenceRaw?.evidence_catalogue ?? {};

  // ------------------------------------------------------------------
  // 4. wsp-plan.yaml (optional)
  // ------------------------------------------------------------------
  // Read wsp-plan.yaml raw -- PlanSchema rejects v0.10 files that omit
  // required fields like migration_plan/value_case/assumptions/data_gaps.
  // Mirror the raw-read pattern used for wsp.yaml.
  interface RawRiskOverride {
    author?: string;
    role?: string;
    timestamp?: string;
    rationale?: string;
  }
  interface RawPlanRiskItem {
    risk_id?: string;
    signal_ref?: string;
    platform_impact?: string;
    trigger?: string;
    category?: string;
    likelihood?: string;
    impact?: string;
    mitigation?: string;
    owner?: unknown;
    status?: string;
    evidence_ids?: string[];
    closed_rationale?: string;
    closed_at?: string;
    machine_outcome?: string;
    override?: RawRiskOverride;
  }
  interface RawPlanComplianceControl {
    id?: string;
    title?: string;
    severity?: string;
    outcome?: string;
    status?: string;
    rationale?: string;
    signal_refs?: string[];
    assessor?: string;
    evidence_ids?: string[];
    evidence?: string[];
    derived_from?: string;
  }
  interface RawPlanComplianceRegime {
    id?: string;
    name?: string;
    controls?: RawPlanComplianceControl[];
  }
  interface RawPlan {
    risk_register?: RawPlanRiskItem[];
    compliance?: { regimes?: RawPlanComplianceRegime[] };
  }
  let riskRegisterRaw: RawPlanRiskItem[] = [];
  let planComplianceRegimes: RawPlanComplianceRegime[] = [];
  const planPath = join(safeRunDir, 'wsp-plan.yaml');
  if (existsSync(planPath)) {
    const planRaw = loadYaml(planPath) as RawPlan | null;
    riskRegisterRaw = planRaw?.risk_register ?? [];
    planComplianceRegimes = planRaw?.compliance?.regimes ?? [];
  }

  // ------------------------------------------------------------------
  // 5. passes/*.yaml (optional)
  // ------------------------------------------------------------------
  let signals: PubSignal[] = [];
  // #1035: runbook steps derived from block-assessment pass (12-blocks.yaml)
  const runbookSteps: Array<{ step: number; title: string; description: string; pass: string; signals: string[]; anchor: string }> = [];
  // #1359: full block scorecard (all 8 blocks, not just GAP/PARTIAL)
  const blockItems: Array<import('./model.js').BlockAssessmentItem> = [];
  const passesDir = join(safeRunDir, 'passes');
  if (existsSync(passesDir)) {
    const passFiles = readdirSync(passesDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();

    for (const pf of passFiles) {
      const passRaw = loadYaml(join(passesDir, pf));
      const passResult = PassFileSchema.safeParse(passRaw);
      if (!passResult.success) continue;

      const passFile = passResult.data;
      const passId = String(passFile.pass.id);

      for (const sig of passFile.signals) {
        signals.push({
          id: sig.id,
          pass: passId,
          severity: (sig.severity as PubSignal['severity']) ?? 'informational',
          outcome: mapOutcome(sig.outcome),
          derivation: sig.derivation,
          evidence_refs: sig.evidence.map((e: string) => slugify(e)),
          implies: sig.implies ?? [],
          tags: [],
          anchor: `signal-${sig.id}`,
          ...(sig.false_positive_flag ? { false_positive_flag: true } : {}),
        });
      }

      // Extract block assessment outcomes for runbook (#1035) + scorecard (#1359)
      if (pf.startsWith('12-') && typeof passRaw === 'object' && passRaw !== null) {
        const raw12 = passRaw as Record<string, unknown>;
        const assessment = raw12['assessment'] as Record<string, unknown> | undefined;
        const blocks = assessment?.['blocks'] as Record<string, unknown> | undefined;
        if (blocks) {
          let stepNum = 1;
          for (const [blockId, blockVal] of Object.entries(blocks)) {
            if (typeof blockVal !== 'object' || blockVal === null) continue;
            const blk = blockVal as Record<string, unknown>;
            const outcome = String(blk['overall_outcome'] ?? 'UNKNOWN');
            const rationale = String(blk['overall_rationale'] ?? '');
            const keySignals = Array.isArray(blk['key_signals'])
              ? (blk['key_signals'] as string[]).filter((s): s is string => typeof s === 'string')
              : [];
            // Scorecard entry for every block (#1359)
            blockItems.push({
              name: blockId,
              overall_outcome: outcome as import('./model.js').BlockAssessmentItem['overall_outcome'],
              overall_rationale: rationale,
              score: typeof blk['score'] === 'number' ? blk['score'] : 0,
              threshold: typeof blk['threshold'] === 'number' ? blk['threshold'] : 0.7,
              status: (String(blk['status'] ?? 'medium')) as import('./model.js').BlockAssessmentItem['status'],
              key_signals: keySignals,
              assessor: String(blk['assessor'] ?? 'unknown'),
              assessed_at: String(blk['assessed_at'] ?? ''),
            });
            // Runbook step for GAP/PARTIAL only (#1035)
            if (outcome === 'GAP' || outcome === 'PARTIAL') {
              const step = stepNum++;
              runbookSteps.push({
                step,
                title: `Resolve ${blockId.replace(/_/g, ' ')} gap (${outcome})`,
                description: rationale,
                pass: passId,
                signals: keySignals,
                anchor: `runbook-${blockId.replace(/_/g, '-')}-${step}`,
              });
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // 6. .swao.yml (optional) -- 3 levels up from safeRunDir
  //    safeRunDir = .../apps/<app>/wsp/runs/<ts>
  //    so ../../../.swao.yml = .../apps/<app>/.swao.yml
  // ------------------------------------------------------------------
  // Typed as SwaoYml (not narrowly) so publication.* fields are accessible.
  let swaoYml: SwaoYml | null = null;
  const swaoYmlPath = join(safeRunDir, '../../../.swao.yml');
  if (existsSync(swaoYmlPath)) {
    const swaoRaw = loadYaml(swaoYmlPath);
    const swaoResult = SwaoYmlSchema.safeParse(swaoRaw);
    if (swaoResult.success) {
      swaoYml = swaoResult.data;
    }
  }

  // ------------------------------------------------------------------
  // 7. Lens filter
  // ------------------------------------------------------------------
  const activeLenses = swaoYml?.assessment?.lenses ?? null;
  if (activeLenses) {
    const enabledPrefixes = new Set<string>();
    for (const lensId of activeLenses) {
      try {
        const def = loadLensDefinition(lensId);
        def.passes.forEach(p => enabledPrefixes.add(p));
      } catch {
        // skip unknown lenses
      }
    }
    signals = signals.filter(s => {
      const prefix = s.id.split('-')[0];
      return enabledPrefixes.has(prefix);
    });
  }

  // ------------------------------------------------------------------
  // 8. Evidence
  // ------------------------------------------------------------------
  const evidence: PubEvidence[] = [];
  for (const [key, item] of Object.entries(evidenceCatalogue)) {
    const id = slugify(key);
    evidence.push({
      id,
      title: item.summary ?? item.source_path ?? item.file ?? key,
      type: mapEvidenceType(item.type),
      file: item.source_path ?? item.file ?? key,
      date: spine.assessed_at ?? '',
      pii_scrubbed: false,
      used_by: signals.filter(s => s.evidence_refs.includes(id)).map(s => s.id),
      summary: item.summary,
      source_path: item.source_path,
      refs: Array.isArray(item.refs) ? item.refs : undefined,
    });
  }

  // ------------------------------------------------------------------
  // 9. Risk register
  // ------------------------------------------------------------------
  // Parse signal ID from trigger text when signal_ref is not explicitly set.
  // Trigger convention: "Signal <ID> -- <description>" (e.g. "Signal TF-01 -- ...").
  const SIGNAL_FROM_TRIGGER = /\bSignal\s+([A-Z][A-Z0-9-]+)\b/;
  const risk_register = riskRegisterRaw
    .filter(rr => typeof rr.risk_id === 'string' && rr.risk_id.length > 0)
    .map(rr => {
      const rawSignalRef = rr.signal_ref ?? '';
      const triggerText = String(rr.trigger ?? rr.risk_id ?? '');
      const derivedSignalRef = rawSignalRef || (SIGNAL_FROM_TRIGGER.exec(triggerText)?.[1] ?? '');
      // Map wsp-plan status vocabulary to publication model vocabulary.
      // wsp-plan: open | mitigated | accepted | closed
      // pub model: open | in_progress | resolved
      const mapStatus = (s?: string): 'open' | 'in_progress' | 'resolved' => {
        if (!s) return 'open';
        if (s === 'closed' || s === 'mitigated') return 'resolved';
        if (s === 'in_progress') return 'in_progress';
        return 'open';
      };
      return {
        risk_id: String(rr.risk_id),
        signal_ref: derivedSignalRef || undefined,
        trigger: triggerText,
        category: String(rr.category ?? 'general'),
        likelihood: (rr.likelihood === 'high' || rr.likelihood === 'medium' ? rr.likelihood : 'low') as 'low' | 'medium' | 'high',
        impact: (rr.impact === 'critical' || rr.impact === 'high' ? 'high' : rr.impact === 'medium' ? 'medium' : 'low') as 'low' | 'medium' | 'high',
        mitigation: String(rr.mitigation ?? ''),
        owner: String(rr.owner ?? 'unassigned'),
        platform_impact: rr.platform_impact ? String(rr.platform_impact) : undefined,
        evidence_refs: Array.isArray(rr.evidence_ids) ? rr.evidence_ids.map(String) : [],
        status: mapStatus(rr.status),
        resolved_at: rr.closed_at ? String(rr.closed_at) : undefined,
        notes: rr.closed_rationale ? String(rr.closed_rationale) : undefined,
        machine_outcome: rr.machine_outcome ? String(rr.machine_outcome) : undefined,
        override: rr.override != null && typeof rr.override === 'object' ? rr.override : undefined,
        anchor: `rr-${String(rr.risk_id).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      };
    });

  // ------------------------------------------------------------------
  // 10. Compliance mapping
  //
  // Primary: read assessed compliance from wsp-plan.yaml (written by
  // Pass 11 compliance_evaluation). This is the authoritative source.
  // Fallback: buildCompliance from community-frameworks catalogs (used
  // when wsp-plan.yaml has no compliance data, e.g. if Pass 11 was
  // skipped or the assessment pre-dates Pass 11).
  // ------------------------------------------------------------------
  let compliance: import('./model.js').FrameworkResult[];
  if (planComplianceRegimes.length > 0) {
    const statusToRag = (status?: string): 'pass' | 'partial' | 'fail' | 'not-assessed' => {
      if (!status) return 'fail';
      const s = status.toUpperCase();
      if (s === 'SATISFIED' || s === 'PASS') return 'pass';
      if (s === 'PARTIAL') return 'partial';
      if (s === 'UNKNOWN') return 'not-assessed';
      return 'fail';
    };
    compliance = planComplianceRegimes.map(regime => {
      const frameworkId = String(regime.id ?? 'UNKNOWN').toUpperCase();
      const frameworkName = String(regime.name ?? frameworkId);
      const controls = (regime.controls ?? []).map(ctrl => {
        const rag = statusToRag(ctrl.status);
        return {
          id: String(ctrl.id ?? ''),
          title: String(ctrl.title ?? ctrl.id ?? ''),
          rag_status: rag,
          worst_severity: ctrl.severity as import('./model.js').ControlResult['worst_severity'],
          signals: ctrl.signal_refs ?? [],
          rationale: String(ctrl.rationale ?? ''),
          evidence: Array.isArray(ctrl.evidence_ids) ? ctrl.evidence_ids as string[]
            : Array.isArray(ctrl.evidence) ? ctrl.evidence as string[] : [] as string[],
          derived_from: typeof ctrl.derived_from === 'string' ? ctrl.derived_from : undefined,
          anchor: `ctrl-${String(ctrl.id ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        };
      });
      const failCount = controls.filter(c => c.rag_status === 'fail').length;
      const partialCount = controls.filter(c => c.rag_status === 'partial').length;
      const passCount = controls.filter(c => c.rag_status === 'pass').length;
      const notAssessedCount = controls.filter(c => c.rag_status === 'not-assessed').length;
      return { framework_id: frameworkId, framework_name: frameworkName, controls, fail_count: failCount, partial_count: partialCount, pass_count: passCount, not_assessed_count: notAssessedCount };
    });

    // Augment each framework with controls not covered by the assessment.
    // Read the community framework registry to resolve id -> catalogue folder,
    // then load controls.yaml and add any controls absent from the assessed set
    // with rag_status 'not-assessed'. Requires Pass 11 to use catalogue IDs.
    interface RegEntry { id?: string; folder?: string; }
    const registryRaw = loadYaml(join(communityFrameworksDir, '_registry.yaml')) as
      { frameworks?: RegEntry[] } | null;
    const idToFolder = new Map<string, string>();
    for (const entry of registryRaw?.frameworks ?? []) {
      if (typeof entry.id === 'string' && typeof entry.folder === 'string') {
        idToFolder.set(entry.id.toUpperCase(), entry.folder);
      }
    }

    for (const fw of compliance) {
      const folder = idToFolder.get(fw.framework_id);
      if (!folder) continue;
      const ctrlsYamlPath = join(communityFrameworksDir, folder, 'controls.yaml');
      const ctrlsRaw = loadYaml(ctrlsYamlPath) as {
        regime_meta?: { catalogue_version?: string; last_reviewed?: string };
        controls?: Array<RawControl>;
      } | null;
      const allCtrls = ctrlsRaw?.controls ?? [];
      if (allCtrls.length === 0) continue;

      // Set framework-level catalogue metadata from regime_meta (#1371).
      if (ctrlsRaw?.regime_meta?.catalogue_version) {
        (fw as Record<string, unknown>)['catalogue_version'] = ctrlsRaw.regime_meta.catalogue_version;
      }
      if (ctrlsRaw?.regime_meta?.last_reviewed) {
        (fw as Record<string, unknown>)['last_reviewed'] = ctrlsRaw.regime_meta.last_reviewed;
      }

      // Build per-control metadata lookups (#1359, #1365-#1370).
      const remByCtrlId = new Map<string, string>();
      const descByCtrlId = new Map<string, string>();
      const pillarByCtrlId = new Map<string, string>();
      const tagsByCtrlId = new Map<string, string[]>();
      const sevDefaultByCtrlId = new Map<string, string>();
      const evidBasisByCtrlId = new Map<string, string[]>();
      const mapsToByCtrlId = new Map<string, string[]>();
      const refsByCtrlId = new Map<string, string[]>();
      for (const c of allCtrls) {
        if (typeof c.id !== 'string') continue;
        const key = c.id.toLowerCase();
        if (typeof c.remediation === 'string') remByCtrlId.set(key, c.remediation);
        if (typeof c.description === 'string') descByCtrlId.set(key, c.description);
        if (typeof c.pillar === 'string') pillarByCtrlId.set(key, c.pillar);
        if (Array.isArray(c.tags)) tagsByCtrlId.set(key, c.tags.map(t => String(t)));
        if (typeof c.severity_default === 'string') sevDefaultByCtrlId.set(key, c.severity_default);
        if (Array.isArray(c.evidence_basis)) {
          evidBasisByCtrlId.set(key, (c.evidence_basis as Array<Record<string, unknown>>)
            .map(eb => String(eb['context_input'] ?? '')).filter(Boolean));
        }
        if (Array.isArray(c.maps_to)) mapsToByCtrlId.set(key, c.maps_to.map(m => String(m)));
        if (Array.isArray(c.references)) refsByCtrlId.set(key, c.references.map(r => String(r)));
      }
      const tagsMap = tagsByCtrlId;

      // Back-fill article_text on already-assessed controls -- prefer remediation
      // over description to match the buildCompliance() fallback (#1359).
      for (const assessed of fw.controls) {
        const key = assessed.id.toLowerCase();
        if (!assessed.article_text) {
          assessed.article_text = remByCtrlId.get(key) ?? descByCtrlId.get(key) ?? '';
        }
        // Add catalogue metadata to assessed controls (#1365-#1370).
        const ext = assessed as Record<string, unknown>;
        if (!ext['pillar'] && pillarByCtrlId.has(key)) ext['pillar'] = pillarByCtrlId.get(key);
        if (!ext['tags'] && tagsMap.has(key)) ext['tags'] = tagsMap.get(key);
        if (!ext['severity_default'] && sevDefaultByCtrlId.has(key)) ext['severity_default'] = sevDefaultByCtrlId.get(key);
        if (!ext['evidence_basis'] && evidBasisByCtrlId.has(key)) ext['evidence_basis'] = evidBasisByCtrlId.get(key);
        if (!ext['maps_to'] && mapsToByCtrlId.has(key)) ext['maps_to'] = mapsToByCtrlId.get(key);
        if (!ext['references'] && refsByCtrlId.has(key)) ext['references'] = refsByCtrlId.get(key);
      }

      const assessedIds = new Set(fw.controls.map(c => c.id.toLowerCase()));
      let notAssessedCount = 0;
      for (const ctrl of allCtrls) {
        if (typeof ctrl.id !== 'string') continue;
        if (assessedIds.has(ctrl.id.toLowerCase())) continue;
        const key = ctrl.id.toLowerCase();
        fw.controls.push({
          id: ctrl.id,
          title: typeof ctrl.title === 'string' ? ctrl.title : ctrl.id,
          rag_status: 'not-assessed',
          worst_severity: undefined,
          signals: [],
          rationale: 'No signals matched this control during the automated assessment. Manual review or audit evidence is required to determine compliance status.',
          article_text: remByCtrlId.get(key) ?? (typeof ctrl.description === 'string' ? ctrl.description : ''),
          evidence: [],
          anchor: `ctrl-${ctrl.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          ...(pillarByCtrlId.has(key) ? { pillar: pillarByCtrlId.get(key) } : {}),
          ...(tagsMap.has(key) ? { tags: tagsMap.get(key) } : {}),
          ...(sevDefaultByCtrlId.has(key) ? { severity_default: sevDefaultByCtrlId.get(key) } : {}),
          ...(evidBasisByCtrlId.has(key) ? { evidence_basis: evidBasisByCtrlId.get(key) } : {}),
          ...(mapsToByCtrlId.has(key) ? { maps_to: mapsToByCtrlId.get(key) } : {}),
          ...(refsByCtrlId.has(key) ? { references: refsByCtrlId.get(key) } : {}),
        } as import('./model.js').ControlResult & Record<string, unknown>);
        notAssessedCount++;
      }
      fw.not_assessed_count = notAssessedCount;
    }
  } else {
    compliance = buildCompliance(signals);
  }

  // ------------------------------------------------------------------
  // 11. Run history -- scan sibling run dirs
  // ------------------------------------------------------------------
  const run_history: Array<{
    run_id: string;
    assessed_at: string;
    swao_version: string;
    signal_counts: Record<string, number>;
    total_signals: number;
    publication_href?: string;
  }> = [];
  const parentDir = join(safeRunDir, '..');
  // Publications directory: <ws>/apps/<id>/wsp/runs/../../../publications = wsp/publications
  const pubsDir = join(safeRunDir, '..', '..', 'publications');
  const currentDirName = safeRunDir.split(/[\\/]/).pop() ?? '';
  if (existsSync(parentDir)) {
    try {
      // #1711: sort newest-first, cap at 20, so we never scan unbounded run directories.
      // Pass YAML reads are O(N_runs × N_passes × YAML_size) -- dominant cost at 166s for
      // 50 prior runs. We use manifest.total_signals_emitted instead of re-reading pass files.
      const MAX_HISTORY_RUNS = 20;
      const siblings = readdirSync(parentDir)
        .filter(name => {
          if (name === currentDirName) return false;
          try {
            return statSync(join(parentDir, name)).isDirectory();
          } catch {
            return false;
          }
        })
        .sort()
        .reverse()
        .slice(0, MAX_HISTORY_RUNS);
      for (const sibling of siblings) {
        const sibManifestPath = join(parentDir, sibling, 'run-manifest.json');
        if (!existsSync(sibManifestPath)) continue;
        try {
          const sibRaw = JSON.parse(readFileSync(sibManifestPath, 'utf-8')) as unknown;
          const sibParsed = RunManifestSchema.safeParse(sibRaw);
          if (!sibParsed.success) continue;
          const manifest = sibParsed.data;
          if (typeof manifest.run_id !== 'string' || typeof manifest.assessed_at !== 'string') continue;
          const sibVersion = manifest.provenance?.swao_version
            ?? (manifest as Record<string, unknown>)['swao_version'] as string | undefined
            ?? 'unknown';
          // #1711: use manifest.total_signals_emitted instead of reading all pass YAML files.
          // Per-severity breakdown is not stored in the manifest; the history table uses
          // r.total_signals as the display count (see renderRunHistory in meta.ts).
          const sibTotalSignals = manifest.total_signals_emitted;
          // #1013: resolve a publication link for this sibling run if one exists.
          let pubHref = '';
          if (existsSync(pubsDir)) {
            try {
              const matchingFile = readdirSync(pubsDir).find(f =>
                f.startsWith(sibling + '-') && f.endsWith('.html') && !f.startsWith('latest-'),
              );
              if (matchingFile) pubHref = `./${matchingFile}`;
            } catch { /* skip */ }
          }
          run_history.push({
            run_id: manifest.run_id,
            assessed_at: manifest.assessed_at,
            swao_version: sibVersion,
            signal_counts: {},
            total_signals: sibTotalSignals,
            publication_href: pubHref,
          });
        } catch {
          // skip malformed sibling manifest
        }
      }
    } catch {
      // skip if we can't read parent dir
    }
  }

  // ------------------------------------------------------------------
  // 12. Delta -- compare current signals to most recent prior run
  // ------------------------------------------------------------------
  type DeltaResult = {
    run_a: string; run_b: string;
    new_signals: string[]; resolved_signals: string[]; changed_signals: string[];
  };
  let delta: DeltaResult | null = null;
  if (run_history.length > 0) {
    const latestPrior = run_history.sort((a, b) => b.assessed_at.localeCompare(a.assessed_at))[0];
    // Try to find the prior run directory by matching run_id
    const priorPassesDir = join(parentDir,
      (existsSync(parentDir) ? readdirSync(parentDir) : []).find(name => {
        try {
          const m = JSON.parse(readFileSync(join(parentDir, name, 'run-manifest.json'), 'utf-8')) as { run_id?: string };
          return m.run_id === latestPrior.run_id;
        } catch { return false; }
      }) ?? '__not_found__',
      'passes'
    );
    if (existsSync(priorPassesDir)) {
      const priorSignalIds = new Set<string>();
      try {
        const priorFiles = readdirSync(priorPassesDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const pf of priorFiles) {
          const pr = loadYaml(join(priorPassesDir, pf)) as { signals?: Array<{ id?: string }> } | null;
          for (const s of pr?.signals ?? []) { if (s.id) priorSignalIds.add(s.id); }
        }
      } catch { /* skip */ }
      const currentIds = new Set(signals.map(s => s.id));
      delta = {
        run_a: latestPrior.run_id,
        run_b: runManifest?.run_id ?? safeRunDir.split(/[\\/]/).pop() ?? 'current',
        new_signals: [...currentIds].filter(id => !priorSignalIds.has(id)),
        resolved_signals: [...priorSignalIds].filter(id => !currentIds.has(id)),
        changed_signals: [],
      };
    }
  }

  // ------------------------------------------------------------------
  // 13. Summary
  // ------------------------------------------------------------------
  const signalCounts = countBySeverity(signals);
  // #0837: sort by severity before slicing so the 3 highest-priority signals
  // appear in the executive summary tiles, not just the first 3 in pass order.
  const _sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, informational: 4, positive: 5 };
  const topSignals = [...signals]
    .sort((a, b) => (_sevRank[a.severity] ?? 99) - (_sevRank[b.severity] ?? 99))
    .slice(0, 3);
  const summary = {
    seven_r_label: String(spine.overall?.seven_r_label ?? ''),
    coverage_score: Math.min(1, Math.max(0, Number(spine.overall?.coverage_score ?? 0))),
    confidence: String(spine.overall?.confidence ?? 'unknown'),
    signal_counts: signalCounts,
    blocker_count: signals.filter(s => s.severity === 'critical' || s.severity === 'high').length,
    top_findings: topSignals,
  };

  // ------------------------------------------------------------------
  // 13. LZR
  // ------------------------------------------------------------------
  // Catalogue fit (lz-catalogue-fit.yaml) wins over the synthesis-tag `overall`
  // when present. Pass 23 (Terraform LZR) checks remain separate; they are not
  // yet populated here and do not conflict.
  // Multi-target runs (#0923): when no single-target file exists, fall back to
  // globbing lz-catalogue-fit-<provider>-<region>.yaml and aggregating results.
  const lzCatFitPath = join(safeRunDir, 'lz-catalogue-fit.yaml');
  const lzCatFit = existsSync(lzCatFitPath)
    ? (load(readFileSync(lzCatFitPath, 'utf-8')) as Record<string, unknown>)
    : null;
  const lzCatItems = lzCatFit
    ? ((lzCatFit['items'] as Array<Record<string, unknown>>) ?? [])
    : [];
  // Backward compat: old wsp.yaml wrote LLM slug to primary; new writes it to status.
  const lzStatusSlug = spine.landing_zone?.status || (spine.landing_zone?.primary ?? undefined) || undefined;

  // Multi-target fallback: read all per-region files when single-target absent.
  type LzRegion = {
    provider: string;
    region: string;
    overall_verdict: string;
    sovereignty_statement?: string;
    service_count: number;
    blockers: number;
    services: string[];
    service_labels: string[];
    services_detected: string[];
    // Audit-coverage fields (#1361-#1363)
    coverage_warning?: string;
    blocker_category?: string;
    assessment_mode?: string;
    sovereignty_active?: boolean;
    // #1591: selected frameworks that contributed sovereignty requirements
    selected_frameworks?: string[];
  };
  const lzRegions: LzRegion[] = [];
  if (!lzCatFit) {
    const perRegionFiles = readdirSync(safeRunDir).filter(
      f => f.startsWith('lz-catalogue-fit-') && f.endsWith('.yaml'),
    );
    for (const fname of perRegionFiles) {
      const parsed = load(readFileSync(join(safeRunDir, fname), 'utf-8')) as Record<string, unknown>;
      const items = (parsed['items'] as Array<Record<string, unknown>>) ?? [];
      const regionBlockers = items.filter(
        i => lzCatCheckResult(String(i['verdict'] ?? '')) === 'fail',
      ).length;
      lzRegions.push({
        provider: String(parsed['provider'] ?? ''),
        region: String(parsed['region'] ?? ''),
        overall_verdict: String(parsed['overall'] ?? 'READY'),
        sovereignty_statement: parsed['sovereignty_statement']
          ? String(parsed['sovereignty_statement'])
          : undefined,
        service_count: items.length,
        blockers: regionBlockers,
        services: items.map(i => String(i['service_code'] ?? '')).filter(Boolean),
        service_labels: items.map(i => String(i['label'] ?? i['service_code'] ?? '')).filter(Boolean),
        services_detected: [],
        coverage_warning: parsed['coverage_warning'] ? String(parsed['coverage_warning']) : undefined,
        blocker_category: parsed['blocker_category'] ? String(parsed['blocker_category']) : undefined,
        assessment_mode: parsed['assessment_mode'] ? String(parsed['assessment_mode']) : undefined,
        sovereignty_active: typeof parsed['sovereignty_active'] === 'boolean' ? parsed['sovereignty_active'] : undefined,
        selected_frameworks: Array.isArray(parsed['selected_frameworks']) ? parsed['selected_frameworks'] as string[] : undefined,
      });
    }
  }

  // Fallback: when catalogue fit produced no service items, surface service_dep signals
  // detected in this run's inventory passes so the Services column shows something useful
  // on first-run or unconfigured assessments.
  if (lzRegions.length > 0 && lzRegions.every(r => r.services.length === 0)) {
    const detected = new Set<string>();
    const passesDir = join(safeRunDir, 'passes');
    if (existsSync(passesDir)) {
      for (const pf of readdirSync(passesDir)) {
        if (!pf.endsWith('.yaml') && !pf.endsWith('.yml')) continue;
        try {
          const raw = load(readFileSync(join(passesDir, pf), 'utf-8')) as Record<string, unknown>;
          for (const sig of (Array.isArray(raw['signals']) ? raw['signals'] as Array<Record<string, unknown>> : [])) {
            for (const imp of (Array.isArray(sig['implies']) ? sig['implies'] as string[] : [])) {
              if (typeof imp === 'string' && imp.startsWith('service_dep:')) {
                detected.add(imp.slice('service_dep:'.length));
              }
            }
          }
        } catch { /* skip malformed */ }
      }
    }
    const detectedArr = [...detected];
    for (const r of lzRegions) r.services_detected = detectedArr;
  }

  // #1024/#1505: derive current_infra from the workspace-level primary pointer file
  // or first READY/NEEDS_VERIFICATION region when spine.landing_zone.primary is absent.
  // latest-lz-primary.yaml is written by the LZ catalogue assessment at
  // apps/<app>/wsp/latest-lz-primary.yaml (one level above runs/).
  const lzPrimaryFilePath = join(dirname(safeRunDir), '..', 'latest-lz-primary.yaml');
  const lzPrimaryFromFile = (() => {
    if (spine.landing_zone?.primary || !existsSync(lzPrimaryFilePath)) return null;
    try {
      const raw = load(readFileSync(lzPrimaryFilePath, 'utf-8')) as Record<string, unknown> | null;
      const lz = raw?.['landing_zone'] as Record<string, unknown> | undefined;
      return typeof lz?.['primary'] === 'string' ? lz['primary'] : null;
    } catch { return null; }
  })();
  const effectiveLzPrimary = spine.landing_zone?.primary ?? lzPrimaryFromFile ?? null;
  const lzReadyRegion = effectiveLzPrimary
    ? undefined
    : lzRegions.find(r => r.overall_verdict === 'READY' || r.overall_verdict === 'NEEDS_VERIFICATION') ?? lzRegions[0];
  const lzInfraFromCat = lzCatFit
    ? (effectiveLzPrimary || `${String(lzCatFit['provider'] ?? '')}/${String(lzCatFit['region'] ?? '')}`)
    : lzReadyRegion
      ? (effectiveLzPrimary || `${lzReadyRegion.provider}/${lzReadyRegion.region}`)
      : effectiveLzPrimary;

  const lzr = lzCatFit
    ? {
        overall: lzCatOverallLabel(String(lzCatFit['overall'] ?? 'Unknown')),
        blockers: lzCatItems.filter(i => lzCatCheckResult(String(i['verdict'] ?? '')) === 'fail').length,
        checks: lzCatItems.map((item, idx) => ({
          id: `LZ-CAT-${String(idx + 1).padStart(2, '0')}`,
          label: `${item['label'] ?? item['service_code'] ?? 'unknown'}: ${item['detail'] ?? ''}`,
          result: lzCatCheckResult(String(item['verdict'] ?? '')),
          signal_ref: String(item['service_code'] ?? ''),
          raw_verdict: String(item['verdict'] ?? ''),
          detail: String(item['detail'] ?? ''),
          remediation: String(item['remediation'] ?? ''),
          provider: String(lzCatFit['provider'] ?? ''),
          region: String(lzCatFit['region'] ?? ''),
          sovereignty_statement: String(lzCatFit['sovereignty_statement'] ?? ''),
          signal_source: String(item['signalId'] ?? ''),
        })),
        current_infra: lzInfraFromCat || undefined,
        lz_status: lzStatusSlug,
        lz_catalogue: {
          provider: String(lzCatFit['provider'] ?? ''),
          region: String(lzCatFit['region'] ?? ''),
          overall_verdict: String(lzCatFit['overall'] ?? ''),
        },
        selected_frameworks: Array.isArray(lzCatFit['selected_frameworks']) ? lzCatFit['selected_frameworks'] as string[] : undefined,
      }
    : lzRegions.length > 0
      ? {
          overall: lzCatOverallLabel(worstVerdict(lzRegions.map(r => r.overall_verdict))),
          blockers: lzRegions.reduce((sum, r) => sum + r.blockers, 0),
          checks: [] as Array<{ id: string; label: string; result: 'pass' | 'fail' | 'not_applicable'; signal_ref?: string }>,
          current_infra: lzInfraFromCat || undefined,
          lz_status: lzStatusSlug,
          lz_catalogue: undefined,
          regions: lzRegions,
          selected_frameworks: [...new Set(lzRegions.flatMap(r => r.selected_frameworks ?? []))],
        }
      : {
          overall: 'Not Assessed',
          blockers: 0,
          checks: [] as Array<{ id: string; label: string; result: 'pass' | 'fail' | 'not_applicable'; signal_ref?: string }>,
          current_infra: undefined,
          lz_status: lzStatusSlug,
          lz_catalogue: undefined,
        };

  // ------------------------------------------------------------------
  // 14. Stakeholder Challenge (#0920)
  // ------------------------------------------------------------------
  // Read individual agent YAML files from wsp/challenge-app/ (written by the
  // TUI one-per-agent). safeRunDir = apps/<app>/wsp/runs/<ts>;
  // challenge-app dir is two levels up then into challenge-app/.
  const challengeReports: import('./model.js').ChallengeAgentReport[] = [];
  try {
    const challengeDir = join(safeRunDir, '..', '..', 'challenge-app');
    if (existsSync(challengeDir)) {
      // TUI writes per-agent files into a timestamped subdirectory
      // (wsp/challenge-app/<ts>/AA_<agent>.yaml). Fall back to files
      // directly in challenge-app/ for the legacy pre-#0919 layout.
      const entries = readdirSync(challengeDir, { withFileTypes: true });
      const hasDirectYaml = entries.some(
        e => e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')),
      );
      const effectiveChallengeDir = hasDirectYaml
        ? challengeDir
        : (() => {
            const latest = entries
              .filter(e => e.isDirectory())
              .map(e => e.name)
              .sort()
              .at(-1);
            return latest ? join(challengeDir, latest) : challengeDir;
          })();
      const challengeFiles = readdirSync(effectiveChallengeDir)
        .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
      for (const cf of challengeFiles) {
        try {
          const raw = load(readFileSync(join(effectiveChallengeDir, cf), 'utf-8')) as Record<string, unknown>;
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            // Skip combined.yaml outer envelope -- it wraps multiple reports
            if ('reports' in raw && Array.isArray(raw['reports'])) continue;
            // Support old format (pre-#0919): findings nested at challenge_report.findings.
            const rawFindings: unknown[] =
              Array.isArray(raw['findings'])
                ? (raw['findings'] as unknown[])
                : Array.isArray((raw['challenge_report'] as Record<string, unknown> | undefined)?.['findings'])
                  ? ((raw['challenge_report'] as Record<string, unknown>)['findings'] as unknown[])
                  : [];
            const parsed = (await import('./model.js')).ChallengeAgentReportSchema.safeParse({
              agent_id: cf.replace(/^AA_/, '').replace(/\.ya?ml$/, ''),
              findings: rawFindings,
              ...raw,
            });
            if (parsed.success) challengeReports.push(parsed.data);
          }
        } catch { /* skip unparseable challenge files */ }
      }
    }
  } catch { /* challenge dir absent or unreadable -- treat as empty */ }

  // ------------------------------------------------------------------
  // 15. Meta
  // ------------------------------------------------------------------
  const appName =
    spine.workload?.name ??
    spine.app?.name ??
    spine.app_id ??
    '';

  // Populate publication_config from .swao.yml (Design 006 §10.2).
  // All fields have safe defaults so this always produces a complete object.
  // pub is SwaoYmlPublication | undefined; optional chaining avoids {} union.
  const pub = swaoYml?.publication;
  const publication_config = {
    classification_band: String(pub?.classification_band ?? 'SWAO - Sovereign Workload Assessment & Onboarding'),
    logo_name: String(pub?.logo_name ?? 'SWAO'),
    logo_sub: String(pub?.logo_sub ?? 'Publication'),
    footer_note: String(pub?.footer_note ?? ''),
    engagement_lead_label: String(pub?.engagement_lead_label ?? 'Engagement Lead'),
    primary_contact_label: String(pub?.primary_contact_label ?? 'Primary Contact'),
    secondary_contact_label: String(pub?.secondary_contact_label ?? 'Secondary Contact'),
    ...(pub?.github_url ? { github_url: pub.github_url } : {}),
    ...(pub?.docs_url   ? { docs_url:   pub.docs_url }   : {}),
    ...(opts?.evidenceBaseUrl ? { evidence_base_url: opts.evidenceBaseUrl } : {}),
  };

  const meta = {
    app_id: spine.app_id ?? '',
    app_name: appName,
    assessed_at: spine.assessed_at ?? '',
    run_id: runManifest?.run_id ?? spine.run_id ?? 'unknown',
    swao_version: opts?.swaoVersion ?? 'unknown',
    engagement: {
      engagement_name: spine.engagement?.name ?? '',
      client_code: spine.engagement?.client_code,
      // partnership_lead: prefer .swao.yml publication.engagement_lead (never PII-scrubbed)
      // over wsp.yaml which may have been scrubbed to "[REDACTED-EMAIL]" by the
      // post-assess PII sweep. Operator adds `publication: engagement_lead: name@co.com`
      // to .swao.yml to restore their name in publications.
      partnership_lead: (() => {
        const fromYml = (swaoYml as Record<string, unknown>)?.['publication'] as Record<string, unknown> | undefined;
        const ymlLead = fromYml?.['engagement_lead'];
        if (typeof ymlLead === 'string' && ymlLead.trim()) return ymlLead.trim();
        const raw = spine.engagement?.partnership_lead;
        if (Array.isArray(raw)) return raw.length > 0 ? String(raw[0]) : '';
        return raw ?? '';
      })(),
      engagement_lead: spine.engagement?.engagement_lead || undefined,
      account_executive: spine.engagement?.account_executive || undefined,
    },
    licensee: 'Accenture',
    tier: 'community' as const,
    publication_config,
  };

  // ------------------------------------------------------------------
  // 15. Assemble + validate
  // ------------------------------------------------------------------
  const model = {
    contract_version: CONTRACT_VERSION,
    meta,
    summary: { ...summary, top_findings: topSignals },
    signals,
    compliance,
    risk_register,
    runbook: runbookSteps,
    evidence,
    input_files: [] as [],
    tags: buildTagIndex(signals, evidence),
    lzr,
    run_history,
    delta: delta ?? undefined,
    ...(challengeReports.length > 0 ? { challenge: challengeReports } : {}),
    ...(blockItems.length > 0 ? { blocks: blockItems } : {}),
  };

  return PublicationModelSchema.parse(model);
}

// ---------------------------------------------------------------------------
// LZ Catalog extractor (#0788, Design 067 §3.2)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LZ evidence builder (#1595)
// Emits PubEvidence items from pass files (derived) and certification URLs
// from cloud-provider-catalogue.yaml (imported_artifact) for assessed providers.
// ---------------------------------------------------------------------------

interface LzPassRef { provider: string; region: string; generatedAt: string; file: string }

function buildLzEvidence(passRefs: LzPassRef[], assessedProviders: string[], fallbackDate: string): PubEvidence[] {
  const evidence: PubEvidence[] = [];

  for (const ref of passRefs) {
    evidence.push({
      id: `lz-pass-${ref.provider.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${ref.region.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      title: `LZ Assessment Pass: ${ref.provider.toUpperCase()} / ${ref.region}`,
      type: 'derived',
      file: ref.file,
      date: ref.generatedAt.slice(0, 10) || fallbackDate,
      pii_scrubbed: true,
      used_by: ['lzr-catalog-verdict', 'lz-catalog-services', 'lzr-catalog-findings'],
      summary: `LZ catalogue fit assessment pass for ${ref.provider.toUpperCase()} region ${ref.region}`,
    });
  }

  // Certification evidence from cloud-provider-catalogue.yaml
  const catalogueCandidates = [
    join(__dirname, '../../../controls/cloud-provider-catalogue.yaml'),
    join(__dirname, '../../../../../../controls/cloud-provider-catalogue.yaml'),
    join(__dirname, '../../../../../controls/cloud-provider-catalogue.yaml'),
    join(__dirname, '../../../../controls/cloud-provider-catalogue.yaml'),
  ];
  for (const cpath of catalogueCandidates) {
    try {
      const raw = load(readFileSync(cpath, 'utf-8')) as {
        providers?: Array<{
          id?: string;
          certifications?: Record<string, { status?: string; evidence_url?: string; last_audited?: string }>;
        }>;
      } | null;
      if (!raw?.providers) continue;
      for (const p of raw.providers) {
        if (typeof p.id !== 'string') continue;
        const pid = p.id.toLowerCase();
        const assessed = assessedProviders.some(ap => {
          const n = ap.toLowerCase();
          return n === pid || pid.startsWith(n) || n.startsWith(pid);
        });
        if (!assessed) continue;
        for (const [certId, certVal] of Object.entries(p.certifications ?? {})) {
          if (!certVal?.evidence_url) continue;
          if (certVal.status !== 'attested' && certVal.status !== 'certified') continue;
          evidence.push({
            id: `cert-${pid.replace(/[^a-z0-9]/g, '-')}-${certId.replace(/[^a-z0-9]/g, '-')}`,
            title: `${p.id.toUpperCase()}: ${certId} Certification Evidence`,
            type: 'imported_artifact',
            file: `${p.id}-${certId}-evidence`,
            date: certVal.last_audited ?? fallbackDate,
            link: certVal.evidence_url,
            pii_scrubbed: true,
            used_by: ['lzr-catalog-header'],
            summary: `${certId} certification attestation for ${p.id.toUpperCase()} (${certVal.status})`,
          });
        }
      }
      break;
    } catch { /* try next candidate */ }
  }

  return evidence;
}

/**
 * Assemble a PublicationModel v1.1 from a landing-zone-catalog WSP run directory.
 *
 * Required:  {runDir}/passes/lz-fit.yaml  (or lz-catalog-fit.yaml / lz-catalogue-fit.yaml)
 *            OR {runDir}/passes/lz-fit-<provider>-<region>.yaml (multi-target)
 * Optional:  run-manifest.json, .swao.yml
 *
 * opts.appDir -- absolute path to the app directory (e.g. .../apps/sovereign-health).
 *               When provided, resolves .swao.yml relative to it and derives appId from it.
 *               Falls back to 3-level-up path derivation (correct for wsp/runs/<ts>/ depth).
 */
export async function extractLzCatalogPublicationModel(
  runDir: string,
  opts?: { swaoVersion?: string; appDir?: string },
): Promise<PublicationModel> {
  const safeRunDir = resolvePath(runDir);

  // 1. Pass file(s) -- single-target candidates first, then multi-target glob.
  const passCandidates = [
    join(safeRunDir, 'passes', 'lz-fit.yaml'),
    join(safeRunDir, 'passes', 'lz-catalog-fit.yaml'),
    join(safeRunDir, 'passes', 'lz-catalogue-fit.yaml'),
  ];
  const singlePassPath = passCandidates.find(p => existsSync(p));

  let lzProvider = '';
  let lzRegion = '';
  let lzOverall: string;
  let lzSovereigntyStatement = '';
  let lzItems: Array<Record<string, unknown>> = [];
  let generatedAt = new Date().toISOString().slice(0, 10);
  let rawSignals: Array<Record<string, unknown>> = [];
  let assessedRegions: string[] = [];
  const passFileRefs: LzPassRef[] = [];
  const regionSummaries: Array<{
    provider: string; region: string; overall_verdict: string;
    sovereignty_statement: string; service_count: number; blockers: number;
    service_labels: string[];
    // Audit-coverage region qualifiers (#1361-#1363) -- #1380: these were
    // extracted on the application-run path only, so LZ-catalog publications
    // never rendered the blocker_category badge / coverage_warning callout /
    // assessment_mode note despite the pass files carrying the data.
    coverage_warning?: string;
    blocker_category?: string;
    assessment_mode?: string;
    sovereignty_active?: boolean;
    // #1612: selected frameworks for certification / compliance filtering.
    selected_frameworks?: string[];
  }> = [];
  // #1612: aggregated selected_frameworks across all regions (single or multi-target).
  let lzCatSelectedFrameworks: string[] = [];

  if (singlePassPath) {
    const passRaw = loadYaml(singlePassPath) as Record<string, unknown> | null;
    if (!passRaw) throw new Error(`Failed to read LZ pass file at ${singlePassPath}`);
    const assessment = (passRaw['assessment'] ?? {}) as Record<string, unknown>;
    lzProvider = String(assessment['provider'] ?? '');
    lzRegion = String(assessment['region'] ?? '');
    lzOverall = String(assessment['overall'] ?? 'UNKNOWN');
    lzSovereigntyStatement = String(assessment['sovereignty_statement'] ?? '');
    const rawItems = (assessment['items'] ?? []) as Array<Record<string, unknown>>;
    lzItems = rawItems.map(item => ({
      ...item,
      _lz_provider: lzProvider,
      _lz_region: lzRegion,
      _lz_sovereignty_statement: lzSovereigntyStatement,
    }));
    generatedAt = String(assessment['generated_at'] ?? generatedAt);
    rawSignals = (passRaw['signals'] ?? []) as Array<Record<string, unknown>>;
    assessedRegions = [lzRegion].filter(Boolean);
    if (lzProvider) passFileRefs.push({ provider: lzProvider, region: lzRegion, generatedAt, file: `passes/${singlePassPath.split(/[\\/]/).pop() ?? 'lz-fit.yaml'}` });
    // #1612: extract selected_frameworks for cert / compliance filtering.
    const sfSingle = assessment['selected_frameworks'];
    lzCatSelectedFrameworks = Array.isArray(sfSingle) ? (sfSingle as string[]) : [];
  } else {
    // Multi-target: scan passes/lz-fit-<provider>-<region>.yaml
    const passesDir = join(safeRunDir, 'passes');
    const multiFiles = existsSync(passesDir)
      ? readdirSync(passesDir)
          .filter(f => f.startsWith('lz-fit-') && (f.endsWith('.yaml') || f.endsWith('.yml')))
          .sort()
      : [];
    if (multiFiles.length === 0) {
      throw new Error(
        `No landing-zone-catalog pass file found in ${join(safeRunDir, 'passes')}.\n` +
        `Run "swao assess --type landing-zone-catalog" first.`,
      );
    }
    const verdicts: string[] = [];
    for (const fname of multiFiles) {
      const pr = loadYaml(join(passesDir, fname)) as Record<string, unknown> | null;
      if (!pr) continue;
      const assessment = (pr['assessment'] ?? {}) as Record<string, unknown>;
      const provider = String(assessment['provider'] ?? '');
      const region = String(assessment['region'] ?? '');
      const sovereigntyStatement = String(assessment['sovereignty_statement'] ?? '');
      if (!lzProvider) lzProvider = provider;
      if (!lzRegion) lzRegion = region;
      if (!lzSovereigntyStatement) lzSovereigntyStatement = sovereigntyStatement;
      if (generatedAt === new Date().toISOString().slice(0, 10)) {
        const ga = String(assessment['generated_at'] ?? '');
        if (ga) generatedAt = ga;
      }
      if (region) assessedRegions.push(region);
      if (provider) passFileRefs.push({ provider, region, generatedAt: String(assessment['generated_at'] ?? generatedAt), file: `passes/${fname}` });
      // Tag each item with its source provider/region + sovereignty statement.
      const regionRawItems = ((assessment['items'] ?? []) as Array<Record<string, unknown>>);
      const regionItems = regionRawItems
        .map(item => ({
          ...item,
          _lz_provider: provider,
          _lz_region: region,
          _lz_sovereignty_statement: sovereigntyStatement,
        }));
      lzItems = [...lzItems, ...regionItems];
      verdicts.push(String(assessment['overall'] ?? 'UNKNOWN'));
      rawSignals = [...rawSignals, ...(pr['signals'] ?? []) as Array<Record<string, unknown>>];
      // Collect per-region summary for the multi-provider header table.
      const regionBlockers = regionRawItems.filter(i => String(i['verdict'] ?? '') !== 'SUPPORTED').length;
      regionSummaries.push({
        provider,
        region,
        overall_verdict: String(assessment['overall'] ?? 'UNKNOWN'),
        sovereignty_statement: sovereigntyStatement,
        service_count: regionRawItems.length,
        blockers: regionBlockers,
        service_labels: regionRawItems
          .map(i => String(i['label'] ?? i['service_code'] ?? ''))
          .filter(Boolean),
        coverage_warning: assessment['coverage_warning'] ? String(assessment['coverage_warning']) : undefined,
        blocker_category: assessment['blocker_category'] ? String(assessment['blocker_category']) : undefined,
        assessment_mode: assessment['assessment_mode'] ? String(assessment['assessment_mode']) : undefined,
        sovereignty_active: typeof assessment['sovereignty_active'] === 'boolean' ? assessment['sovereignty_active'] : undefined,
        selected_frameworks: Array.isArray(assessment['selected_frameworks']) ? (assessment['selected_frameworks'] as string[]) : undefined,
      });
      // #1612: aggregate selected_frameworks across all regions.
      const sfRegion = assessment['selected_frameworks'];
      if (Array.isArray(sfRegion)) lzCatSelectedFrameworks.push(...(sfRegion as string[]));
    }
    lzCatSelectedFrameworks = [...new Set(lzCatSelectedFrameworks)];
    lzOverall = worstVerdict(verdicts) || 'UNKNOWN';
  }

  // 2. Convert WSP signals -> PubSignals
  const signals: PubSignal[] = rawSignals.map((s, i) => {
    const id = String(s['id'] ?? `LZ-${String(i + 1).padStart(2, '0')}`);
    return {
      id,
      pass: 'lz_fit',
      severity: (s['severity'] as PubSignal['severity']) ?? 'medium',
      outcome: mapOutcome(s['outcome'] as string),
      derivation: String(s['derivation'] ?? ''),
      evidence_refs: [],
      implies: [],
      tags: ['landing-zone', 'infrastructure'],
      anchor: `signal-${id.toLowerCase()}`,
    };
  });

  // 3. run-manifest.json (optional)
  let appId = '';
  let runId = safeRunDir.split(/[\\/]/).pop() ?? 'unknown';
  let assessedAt = generatedAt;
  let swaoVersion = opts?.swaoVersion ?? 'unknown';

  const manifestPath = join(safeRunDir, 'run-manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
      const parsed = RunManifestSchema.safeParse(raw);
      if (parsed.success) {
        appId = parsed.data.app ?? '';
        runId = parsed.data.run_id ?? runId;
        assessedAt = parsed.data.assessed_at ?? assessedAt;
        swaoVersion = parsed.data.provenance?.swao_version ?? swaoVersion;
      }
    } catch { /* skip malformed manifest */ }
  }

  // 4. .swao.yml (optional) -- path depends on run dir depth.
  //    Standard: runs/<ts>/ = 3 levels up from runDir to app dir.
  //    Non-standard (e.g. lz-assessment-fixture/): caller provides opts.appDir.
  const appDirResolved = opts?.appDir
    ? resolvePath(opts.appDir)
    : join(safeRunDir, '../../..');
  if (!appId) {
    appId = appDirResolved.replace(/\\/g, '/').split('/').pop() ?? 'unknown';
  }
  const swaoYmlRaw = loadYaml(join(appDirResolved, '.swao.yml')) as Record<string, unknown> | null;
  const swaoYmlPub = swaoYmlRaw?.['publication'] as Record<string, unknown> | undefined;
  const swaoYmlApp = swaoYmlRaw?.['app'] as Record<string, unknown> | undefined;
  const swaoYmlEngage = swaoYmlRaw?.['engagement'] as Record<string, unknown> | undefined;

  const appName = String(swaoYmlApp?.['name'] ?? appId);

  const publication_config = {
    classification_band: String(swaoYmlPub?.['classification_band'] ?? 'SWAO - Landing Zone Catalog Assessment'),
    logo_name: String(swaoYmlPub?.['logo_name'] ?? 'SWAO'),
    logo_sub: String(swaoYmlPub?.['logo_sub'] ?? 'LZ Catalog'),
    footer_note: String(swaoYmlPub?.['footer_note'] ?? ''),
    engagement_lead_label: String(swaoYmlPub?.['engagement_lead_label'] ?? 'Engagement Lead'),
    primary_contact_label: String(swaoYmlPub?.['primary_contact_label'] ?? 'Primary Contact'),
    secondary_contact_label: String(swaoYmlPub?.['secondary_contact_label'] ?? 'Secondary Contact'),
  };

  const partnership_lead = (() => {
    const lead = swaoYmlPub?.['engagement_lead'];
    if (typeof lead === 'string' && lead.trim()) return lead.trim();
    return '';
  })();

  const engagement = {
    engagement_name: String(
      swaoYmlEngage?.['name'] ??
      swaoYmlApp?.['engagement_name'] ??
      ''
    ),
    client_code: swaoYmlEngage?.['client_code'] as string | undefined,
    partnership_lead,
    engagement_lead: swaoYmlEngage?.['engagement_lead'] as string | undefined || undefined,
    account_executive: swaoYmlEngage?.['account_executive'] as string | undefined || undefined,
  };

  // 5. LZR section
  const blockerCount = lzItems.filter(i =>
    lzCatCheckResult(String(i['verdict'] ?? '')) === 'fail'
  ).length;

  const lzr = {
    overall: lzCatOverallLabel(lzOverall),
    blockers: blockerCount,
    checks: lzItems.map((item, idx) => ({
      id: `LZ-${String(idx + 1).padStart(2, '0')}`,
      label: `${String(item['label'] ?? item['service_code'] ?? 'unknown')}: ${String(item['detail'] ?? '')}`,
      result: lzCatCheckResult(String(item['verdict'] ?? '')),
      signal_ref: String(item['service_code'] ?? ''),
      raw_verdict: String(item['verdict'] ?? ''),
      provider: String(item['_lz_provider'] ?? lzProvider),
      region: String(item['_lz_region'] ?? lzRegion),
      detail: String(item['detail'] ?? ''),
      remediation: String(item['remediation'] ?? ''),
      sovereignty_statement: String(item['_lz_sovereignty_statement'] ?? lzSovereigntyStatement),
      signal_source: String(item['signalId'] ?? ''),
    })),
    catalog: {
      provider: lzProvider,
      region: lzRegion,
      overall_verdict: lzOverall,
      assessed_regions: assessedRegions.length > 0 ? assessedRegions : [lzRegion].filter(Boolean),
      service_count: lzItems.length,
    },
    ...(regionSummaries.length > 1 ? { regions: regionSummaries } : {}),
    ...(lzCatSelectedFrameworks.length > 0 ? { selected_frameworks: lzCatSelectedFrameworks } : {}),
  };

  // 6. Summary
  const supportedCount = lzItems.filter(i => i['verdict'] === 'SUPPORTED').length;
  const signalCounts = countBySeverity(signals);
  const summary = {
    seven_r_label: lzOverall === 'READY' ? 'Rehost' : 'Assess',
    coverage_score: lzItems.length > 0 ? supportedCount / lzItems.length : 0,
    signal_counts: signalCounts,
    blocker_count: blockerCount,
    top_findings: signals.slice(0, 3),
  };

  const meta = {
    app_id: appId,
    app_name: appName,
    assessed_at: assessedAt,
    run_id: runId,
    swao_version: swaoVersion,
    engagement,
    licensee: 'Accenture',
    tier: 'community' as const,
    publication_config,
  };

  // Build evidence items: pass files (derived) + catalogue attestation URLs (#1595)
  const uniqueProviders = [...new Set(passFileRefs.map(r => r.provider))];
  const lzEvidence = buildLzEvidence(passFileRefs, uniqueProviders, assessedAt.slice(0, 10));

  const model = {
    contract_version: CONTRACT_VERSION,
    meta,
    summary,
    signals,
    compliance: [] as [],
    risk_register: [] as [],
    runbook: [] as [],
    evidence: lzEvidence,
    input_files: [] as [],
    tags: buildTagIndex(signals, lzEvidence),
    lzr,
    run_history: [] as [],
    assessment_type: 'landing-zone-catalog',
    block_profile: 'lz-catalog',
  };

  return PublicationModelSchema.parse(model);
}
