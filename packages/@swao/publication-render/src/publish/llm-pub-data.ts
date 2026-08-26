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

// LLM Assessment publication data interfaces -- Design 092 s8, L5 (#1428).
//
// These interfaces describe the JSON shape written to
// llm-assessments/swao/<ts>/comparison/publication-model.json by the orchestrator
// (#1421). They are lean TypeScript interfaces, NOT Zod schemas, because the data
// arrives at the publication engine via a runtime extra-field cast (the same
// pattern used by hub.ts for the engagement hub). `@swao/publication-render` must
// NOT import from `@swao/module-llm-assessment` (leaf -> module is a sibling
// import violation per Design 058 D-PORTAL-1); these types are the bridge.

// ---------------------------------------------------------------------------
// Leg
// ---------------------------------------------------------------------------

export interface LlmLegInfo {
  id: string;
  connector: string;
  model: string;
  primary: boolean;
  connector_sha256?: string;
}

// ---------------------------------------------------------------------------
// Group sub-result (one per MetricGroup; 092 s5.3A)
// ---------------------------------------------------------------------------

export interface LlmGroupResult {
  /** Dimension group label (e.g. 'performance', 'cost', 'reliability'). */
  group: string;
  /** Mean normalised score per leg; null = leg not rankable on this group. */
  score: Record<string, number | null>;
  /** Rank within this group (1 = best). Ties share a rank; next skips. */
  rank: Record<string, number | null>;
  /** Traffic-light per leg: 'ok' | 'warn' | 'red' | 'none'. */
  light: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Final weighted result (092 s5.8)
// ---------------------------------------------------------------------------

export interface LlmFinalResult {
  /** Weighted composite score per leg; null = leg not fully rankable. */
  score: Record<string, number | null>;
  /** Final rank (1 = best). */
  rank: Record<string, number | null>;
  /** Normalised dimension weights (sum to 1). */
  weights: Record<string, number>;
  /** Legs whose weights were renormalised over a subset of groups. */
  partial?: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Per-pass dimension groups (092 s5.3B)
// ---------------------------------------------------------------------------

export interface LlmPassLegAggregate {
  calls: number;
  dnf: number;
  latency_p50_ms: number | null;
  prompt_tokens_median: number | null;
  completion_tokens_median: number | null;
  cost_usd: number | null;
  parse_valid_rate: number | null;
  schema_conform_rate: number | null;
  size_bucket: string | null;
  // Security signal counts (#1463, Design 092 s5.2).
  refusal_count: number | null;
  redaction_marker_altered_count: number | null;
  pii_reproduction_count: number | null;
  prompt_injection_count: number | null;
}

export interface LlmPassGroup {
  pass_id: string;
  legs: Record<string, LlmPassLegAggregate>;
  rank: Record<string, number | null>;
}

// ---------------------------------------------------------------------------
// Prompt-size view (092 s6.2)
// ---------------------------------------------------------------------------

export interface LlmBucketView {
  property: 'latency_p50_ms' | 'parse_valid_rate' | 'truncation_count';
  rows: Array<{
    bucket: string;
    values: Record<string, number | null>;
  }>;
}

// ---------------------------------------------------------------------------
// Findings (092 s5.7)
// ---------------------------------------------------------------------------

export interface LlmFinding {
  id: string;
  severity: 'info' | 'warn' | 'error';
  leg?: string;
  pass_id?: string;
  call_ref?: string;
  type: string;
  message: string;
  metric_impact?: string;
}

// ---------------------------------------------------------------------------
// Top-level LLM publication data
// ---------------------------------------------------------------------------

/** Full shape of publication-model.json as written by the orchestrator (#1421).
 *  Attached at runtime as model['llm_assessment'] and read by blocks/llm.ts. */
export interface LlmPubData {
  app_id: string;
  created: string;
  analysis_mode: string;
  legs: LlmLegInfo[];
  weights: Record<string, number>;
  final: LlmFinalResult;
  groups: LlmGroupResult[];
  passGroups: LlmPassGroup[];
  /** C1-namespace challenge pass groups (#1708, Q3/Q4). One entry per challenge
   *  agent; rendered in the per-pass table alongside the 5 standard passes. */
  challengePassGroups?: LlmPassGroup[];
  /** C2-namespace LZ challenge pass groups (#1994). One entry per LZ challenge
   *  agent (lzca-* agents); rendered alongside C1 challenge data in the HTML
   *  publication. Absent when no LZ challenge phase ran. */
  lzChallengePassGroups?: LlmPassGroup[];
  /** Cross-leg challenge resilience score (#1587). Fraction of challenge agent-leg
   *  invocations that completed without DNF; 0-1 range. Present only on Enterprise
   *  runs where challenge prompts were invoked per leg. */
  challengeResilienceScore?: number;
  bucketViews: LlmBucketView[];
  findings: LlmFinding[];
  /** Optional LLM-generated executive summary added by the interpretation
   *  connector (#1431). Absent when interpretation was disabled or failed. */
  narrative?: string;
  /** 7R verdict per leg from the 09-synth pass (null if leg failed or WSP unavailable). */
  verdicts?: Record<string, string | null>;
}
