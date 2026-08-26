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

/**
 * @swao/core plugin contract types.
 *
 * These are the load-bearing interfaces for the modular architecture
 * (ADR-0047). Every @swao/module-* package imports from here.
 *
 * WSP schema is the contract (Principle 5): Signal and related types
 * are defined here; @swao/swao's Zod schemas validate against this shape.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type LicenceTier = 'community' | 'consultant' | 'enterprise';

export type AssessmentType =
  | 'application'
  | 'audit'
  | 'landing-zone'
  | 'landing-zone-catalog'
  | 'landing-zone-customer'
  | 'hybrid'
  | 'llm';

// ---------------------------------------------------------------------------
// LLM provider interface (minimal; full implementation in @swao/swao)
// ---------------------------------------------------------------------------

export interface LlmProvider {
  complete: (prompt: string) => Promise<string>;
  /** Vision-capable completion (#1802). Optional -- check before calling. */
  completeVision?: (prompt: string, images: Buffer[]) => Promise<string>;
  readonly model?: string;
}

// ---------------------------------------------------------------------------
// Signal types (WSP schema contract, Principle 5)
// Must match the Zod schema in @swao/core/src/signals.ts exactly so
// the two types are mutually assignable without casts.
// ---------------------------------------------------------------------------

export type SignalSource =
  | 'static_analysis'
  | 'dynamic_analysis'
  | 'workshop'
  | 'cmdb'
  | 'cmdb_export'
  | 'finops'
  | 'llm_inference'
  | 'incident'
  | 'ops_runbook'
  | 'ops_runbooks';

export type SignalCategory =
  | 'application'
  | 'infrastructure_platform'
  | 'enablement'
  | 'business_processes';

export type SignalSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational' | 'positive';

export type SignalConfidence = 'high' | 'medium' | 'low';

export type SignalLegacyTier =
  | 'tier_1_blocker'
  | 'tier_2_complicator'
  | 'tier_3_manageable';

export type SignalOutcome = 'positive' | 'negative' | 'neutral' | 'indeterminate';

// 'human' added for the audit assessment type (Design 049 §4): a human was the
// primary assessor from the outset (consultant checklist), distinct from
// 'human_override' (a human overrode a prior automated finding).
export type Assessor = 'rule_engine' | 'llm' | 'human_override' | 'human';

export interface Signal {
  id: string;
  source: SignalSource;
  category: SignalCategory;
  severity?: SignalSeverity;
  synthesis?: boolean;
  derivation: string;
  evidence: string[];
  signal_ref?: string;
  implies?: string[];
  confidence: SignalConfidence;
  legacy_tier?: SignalLegacyTier;
  outcome?: SignalOutcome;
  false_positive_considered?: boolean;
  false_positive_ruled_out?: string;
  assessor?: Assessor;
  assessed_at?: string;
  derivation_chain?: string[];
  false_positive_flag?: boolean;
  false_positive_note?: string;
  provenance?: {
    source: string;
    run_id: string;
    cassette_hit: boolean;
    assessed_at: string;
  };
}

// ---------------------------------------------------------------------------
// WSP result types
// ---------------------------------------------------------------------------

export interface WspResult {
  wsp_version: string;
  generated_at: string;
  signals: Signal[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Data source (LLM provenance for a pass run)
// ---------------------------------------------------------------------------

export interface DataSource {
  llm_provider: string;
  llm_model: string;
  llm_temperature: number;
  llm_seed?: number | null;
  cassette_hit: boolean;
  placeholder_inputs: string[];
  false_positive_flags: number;
  assessed_at: string;
}

// ---------------------------------------------------------------------------
// Pass types (will be moved to pass-types.ts in #0544; kept here for the
// plugin contract so PassContribution compiles without circular deps)
// ---------------------------------------------------------------------------

export interface PassContext {
  appId: string;
  sourcePath: string;
  workspacePath: string;
  iter: number;
  assessedAt: string;
  /** Populated when an LLM provider is configured; absent means LLM-optional
   *  passes skip gracefully (Principle 10). The concrete LlmProvider in
   *  @swao/swao satisfies this interface structurally. */
  llm?: LlmProvider;
  landingZoneRegion?: string;
  /** Run-scoped passes directory for the current assessment run. When set,
   *  synthesis and other late passes read prior-pass YAMLs from this path
   *  directly instead of going through wsp/latest.txt (which is written
   *  only AFTER the run completes). Injected by assess.ts. (#1055) */
  passesDir?: string;
}

export interface PassHeader {
  id: number;
  name: string;
  signal_prefix: string;
  status: 'complete' | 'stub' | 'not_applicable';
  iter: number;
  assessed_at: string;
}

export interface PassResult {
  pass: PassHeader;
  data_source?: DataSource;
  signals: Signal[];
  assessment: Record<string, unknown>;
}

export type PassRunner = (ctx: PassContext) => Promise<PassResult>;

// ---------------------------------------------------------------------------
// Workspace context (will be extended in workspace.ts when #0543 runs)
// ---------------------------------------------------------------------------

export interface WorkspaceContext {
  workspacePath: string;
  appId?: string;
}

// ---------------------------------------------------------------------------
// Licence state (will be extended in license-guard.ts when #0546 runs)
// ---------------------------------------------------------------------------

export interface LicenceState {
  tier: LicenceTier;
  fingerprint: string;
  firstRun: string;
  assessmentCount: number;
  daysElapsed: number;
  assessmentLimit?: number | null;
  exp?: string;
  licensee?: string;
  email?: string;
  organisation?: string;
}

// ---------------------------------------------------------------------------
// Assessment run context (passed to AssessmentTypeContribution.run)
// ---------------------------------------------------------------------------

export interface AssessmentRunContext {
  appId: string;
  workspacePath: string;
  iter: number;
  assessedAt: string;
  core: CoreContext;
}

// ---------------------------------------------------------------------------
// Compliance evaluation types
// ---------------------------------------------------------------------------

export interface EvalOptions {
  assessmentType: AssessmentType;
  [key: string]: unknown;
}

export interface ComplianceResult {
  frameworks: string[];
  results: Array<{
    framework: string;
    score?: number;
    controls: Array<{
      id: string;
      verdict: string;
      evidence?: string[];
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Module contribution types
// ---------------------------------------------------------------------------

export interface CommandContribution {
  name: string;
  description: string;
  register: (program: unknown) => void;
}

export interface PassContribution {
  id: string;
  name: string;
  signal_prefix: string;
  run: PassRunner;
}

export interface ReportFormatContribution {
  format: string;
  description: string;
  render: (wsp: WspResult, opts: Record<string, unknown>) => Promise<Buffer | string>;
}

export interface ExportFormatContribution {
  format: string;
  description: string;
  export: (wsp: WspResult, opts: Record<string, unknown>) => Promise<Buffer | string>;
}

export interface CatalogueContribution {
  id: string;
  tier: LicenceTier;
  load: () => Promise<unknown>;
}

export interface TuiScreenContribution {
  name: string;
  tier: LicenceTier;
  component: unknown;
}

export interface ProbeContribution {
  id: string;
  name: string;
  run: (ctx: WorkspaceContext) => Promise<{ ok: boolean; message: string }>;
}

export interface AssessmentTypeContribution {
  type: AssessmentType;
  run: (ctx: AssessmentRunContext) => Promise<WspResult>;
  /** When true, the assess router prints a coming-soon notice and exits 0
   *  instead of invoking run(). Lets a module register a skeleton type before
   *  its orchestration is implemented. */
  comingSoon?: boolean;
  /** Optional one-line description shown by the coming-soon notice and in the
   *  unknown-type error's list of registered types. */
  description?: string;
}

export interface ComplianceEvaluatorContribution {
  evaluate: (
    signals: Signal[],
    frameworks: string[],
    opts: EvalOptions,
  ) => Promise<ComplianceResult>;
}

// ---------------------------------------------------------------------------
// Module manifest
// ---------------------------------------------------------------------------

export interface ModuleContributions {
  commands?: CommandContribution[];
  passes?: PassContribution[];
  reportFormats?: ReportFormatContribution[];
  exportFormats?: ExportFormatContribution[];
  catalogues?: CatalogueContribution[];
  tuiScreens?: TuiScreenContribution[];
  probes?: ProbeContribution[];
  assessmentTypes?: AssessmentTypeContribution[];
  complianceEvaluators?: ComplianceEvaluatorContribution[];
}

export interface SwaoModuleManifest {
  id: string;
  version: string;
  tier: LicenceTier;
  contributions: ModuleContributions;
}

// ---------------------------------------------------------------------------
// Core context (injected into every module contribution at startup)
// ---------------------------------------------------------------------------

export interface CoreContext {
  workspace: WorkspaceContext;
  licence: LicenceState;
  complianceEvaluator: ComplianceEvaluatorContribution;
  /** When SWAO_MODULE_VERBOSE=1, core logs each registered module to stderr. */
  verbose: boolean;
}
