// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Metric catalogue (#1424, Design 092 s5.1).
//
// Every property the LLM Assessment measures is registered here. The
// catalogue is the SINGLE SOURCE for: comparison table row labels, the
// publication tooltips (each description must stand alone -- what is
// measured, how, in which unit, and which direction is better), rendering
// direction arrows, and the aggregation rules (s5.8: neutral metrics are
// informational and never scored).
//
// Adding a metric = one entry here + one collector; tables, tooltips and
// scoring follow automatically. The completeness test in
// metric-catalogue.test.ts refuses entries with missing or thin
// descriptions, duplicate ids, or unknown groups.
//
// Static TypeScript map by design (same pattern as the D-06
// cross-framework map): reviewable in one diff, no runtime YAML parsing,
// and metric_catalogue_version feeds the comparability key (092 s7.1).

/** Bump when entries are added/removed/redefined; part of the
 *  comparability key -- runs with different catalogue versions are not
 *  comparable (092 s7.1). */
export const METRIC_CATALOGUE_VERSION = '1.2.0';

export type MetricDirection = 'lower' | 'higher' | 'neutral';
export type MetricScope = 'per-call' | 'per-pass' | 'per-leg';

/** Property dimension groups (092 s5.3A), in publication render order. */
export const METRIC_GROUPS = [
  'quality-content',
  'quality-structural',
  'performance',
  'cost',
  'reliability',
  'reasoning',
  'security',
  'metadata',
  'challenge',
] as const;
export type MetricGroup = (typeof METRIC_GROUPS)[number];

export interface MetricDefinition {
  /** Dotted id: <group-short>.<metric>; stable across releases. */
  id: string;
  group: MetricGroup;
  /** Row label in comparison tables. */
  label: string;
  /** Display unit; empty string for unitless/categorical values. */
  unit: string;
  /** 'lower'/'higher' = scored via relative min/max normalisation
   *  (092 s5.8); 'neutral' = informational only, never scored. */
  direction: MetricDirection;
  scope: MetricScope;
  /** Tooltip text; must stand alone (operator round 3). */
  description: string;
}

export const METRIC_CATALOGUE: readonly MetricDefinition[] = [
  // -- quality (content) ---------------------------------------------------
  {
    id: 'qc.verdict',
    group: 'quality-content',
    label: 'Verdict delivered',
    unit: '',
    direction: 'neutral',
    scope: 'per-leg',
    description:
      'The 7R sovereignty verdict this model produced for the application (READY, CONDITIONAL, BLOCKED, ...). Categorical; shown for comparison, never scored -- without ground truth no verdict is "better" (Design 092 s3.2).',
  },
  {
    id: 'qc.verdict_agreement',
    group: 'quality-content',
    label: 'Verdict agreement',
    unit: '',
    direction: 'neutral',
    scope: 'per-leg',
    description:
      'Whether this leg\'s verdict matches the primary leg and the majority of legs (agree / conflict; head-to-head runs compare vs primary only). A conflict raises a finding and a red mark but never caps the final rank (092 s5.6). Proxy for consistency, not correctness.',
  },
  {
    id: 'qc.grounded_signal_rate',
    group: 'quality-content',
    label: 'Grounded signal rate',
    unit: '%',
    direction: 'higher',
    scope: 'per-leg',
    description:
      'Share of emitted signals whose evidence resolves against the assessed workspace (files present in the inventory, config keys that occur in the source). The core anti-hallucination quality measure: raw signal count is NOT a quality metric (092 s5.6).',
  },
  {
    id: 'qc.evidence_citation_density',
    group: 'quality-content',
    label: 'Evidence citations per signal',
    unit: 'refs/signal',
    direction: 'higher',
    scope: 'per-leg',
    description:
      'Average number of resolvable evidence references attached per emitted signal. Higher density means richer, more verifiable output -- counted only across grounded signals (092 s5.6 item 5).',
  },
  {
    id: 'qc.report_completeness',
    group: 'quality-content',
    label: 'Report completeness',
    unit: 'sections',
    direction: 'higher',
    scope: 'per-leg',
    description:
      'Number of expected assessment output sections (passes with schema-valid content, evaluated blocks) this leg populated, out of the pass-suite total. A pass the model failed to complete leaves a gap the consultant must fill by hand.',
  },
  {
    id: 'qc.signal_agreement_rate',
    group: 'quality-content',
    label: 'Signal agreement rate',
    unit: '%',
    direction: 'higher',
    scope: 'per-leg',
    description:
      'Share of this leg\'s signals that are consensus or majority signals across all legs (matched by signal id; semantic matching is a future upgrade, 063 OQ-02). Outlier-heavy legs may be wrong OR uniquely right -- read together with the grounded rate.',
  },

  // -- quality (structural) ------------------------------------------------
  {
    id: 'qs.parse_valid_rate',
    group: 'quality-structural',
    label: 'Parse validity',
    unit: '%',
    direction: 'higher',
    scope: 'per-call',
    description:
      'Share of LLM responses that parsed as the expected format (JSON/YAML extraction succeeded) across all calls of the leg. A response SWAO cannot parse contributes nothing to the assessment regardless of its prose quality.',
  },
  {
    id: 'qs.schema_conform_rate',
    group: 'quality-structural',
    label: 'Schema conformance',
    unit: '%',
    direction: 'higher',
    scope: 'per-call',
    description:
      'Share of parsed responses that also validated against the pass\'s Zod response schema (required fields, enums, reference shapes). Parse validity without schema conformance means the model invented its own structure.',
  },
  {
    id: 'qs.degenerate_count',
    group: 'quality-structural',
    label: 'Empty / degenerate responses',
    unit: 'count',
    direction: 'lower',
    scope: 'per-call',
    description:
      'Responses that parsed but carried no usable content (empty arrays, placeholder text, echo of the prompt). Counted per call across the leg.',
  },

  // -- performance ---------------------------------------------------------
  {
    id: 'perf.latency_p50_ms',
    group: 'performance',
    label: 'Latency p50',
    unit: 'ms',
    direction: 'lower',
    scope: 'per-call',
    description:
      'Median wall-clock time from request start to complete response, measured client-side per LLM call from SWAO\'s seat (includes network and platform queueing -- exactly the latency an operator experiences).',
  },
  {
    id: 'perf.latency_p95_ms',
    group: 'performance',
    label: 'Latency p95',
    unit: 'ms',
    direction: 'lower',
    scope: 'per-call',
    description:
      '95th-percentile wall-clock time per LLM call. Captures tail behaviour: a model with good medians but heavy tails stalls real assessment runs.',
  },
  {
    id: 'perf.throughput_tok_s',
    group: 'performance',
    label: 'Throughput',
    unit: 'tok/s',
    direction: 'higher',
    scope: 'per-call',
    description:
      'Completion tokens divided by response wall-clock time, averaged across the leg\'s calls. Reasoning tokens count as produced output where the platform bills them.',
  },
  {
    id: 'perf.wallclock_total_ms',
    group: 'performance',
    label: 'Wall-clock total',
    unit: 'ms',
    direction: 'lower',
    scope: 'per-leg',
    description:
      'Total duration of this leg\'s complete assessment run, LLM and non-LLM phases included. The end-to-end "how long until I have the assessment" number.',
  },

  // -- cost ----------------------------------------------------------------
  {
    id: 'cost.total_usd',
    group: 'cost',
    label: 'Total cost',
    unit: 'USD',
    direction: 'lower',
    scope: 'per-leg',
    description:
      'Sum of per-call costs across the leg, computed from the connector\'s per-million token prices (platform-discovered or operator-configured). Legs without a price row render "local" and are excluded from cost ranking (092 s4); a missing price raises the cost-unavailable finding, never a silent zero.',
  },
  {
    id: 'cost.reasoning_share',
    group: 'cost',
    label: 'Reasoning share of output',
    unit: '%',
    direction: 'neutral',
    scope: 'per-leg',
    description:
      'Share of billed completion tokens that were reasoning tokens. Informational: high reasoning share is neither good nor bad, but explains cost and latency differences between reasoning and non-reasoning models.',
  },
  {
    id: 'cost.predicted_delta_pct',
    group: 'cost',
    label: 'Predicted vs actual',
    unit: '%',
    direction: 'neutral',
    scope: 'per-leg',
    description:
      'Deviation of the actual leg cost from the pre-run cost preview (positive = more expensive than predicted). Keeps the estimator honest; informational, not scored.',
  },

  // -- reliability ---------------------------------------------------------
  {
    id: 'rel.dnf_count',
    group: 'reliability',
    label: 'DNF (did not finish)',
    unit: 'count',
    direction: 'lower',
    scope: 'per-call',
    description:
      'Calls that produced no usable response within the per-call timeout cap (timeout, terminal error after retries). Every DNF is also a finding; affected passes render explicitly rather than being averaged away (092 s5.7).',
  },
  {
    id: 'rel.retry_count',
    group: 'reliability',
    label: 'Retries',
    unit: 'count',
    direction: 'lower',
    scope: 'per-call',
    description:
      'Driver-level retries across the leg (rate limits, 5xx, transient network). Retries succeed eventually but signal platform instability and inflate wall-clock time.',
  },
  {
    id: 'rel.rate_limited_count',
    group: 'reliability',
    label: 'Rate-limit incidents',
    unit: 'count',
    direction: 'lower',
    scope: 'per-call',
    description:
      'Calls that received HTTP 429 or an equivalent platform throttle at least once. On shared-platform parallel runs these are additionally flagged shared-platform so a starved leg is not read as a slow model (092 s3.5).',
  },
  {
    id: 'rel.truncated_count',
    group: 'reliability',
    label: 'Truncated responses',
    unit: 'count',
    direction: 'lower',
    scope: 'per-call',
    description:
      'Responses cut off at the model\'s max output token limit before completing the requested structure. Truncation usually breaks parse validity downstream; each occurrence is also a finding.',
  },

  // -- reasoning -----------------------------------------------------------
  {
    id: 'rsn.tokens_total',
    group: 'reasoning',
    label: 'Reasoning tokens',
    unit: 'tokens',
    direction: 'neutral',
    scope: 'per-leg',
    description:
      'Total reasoning tokens the platform reported for the leg. Informational: shows how much hidden deliberation the model spent on SWAO\'s prompts (billed as output on most platforms).',
  },

  // -- security signals ----------------------------------------------------
  {
    id: 'sec.refusal_count',
    group: 'security',
    label: 'Refusals',
    unit: 'count',
    direction: 'lower',
    scope: 'per-call',
    description:
      'Calls the model refused to answer (refusal-phrase heuristics). SWAO prompts contain only redacted workspace content, so a refusal indicates over-triggering safety filters on legitimate consulting material; each is a finding with the pass named.',
  },
  {
    id: 'sec.redaction_marker_altered',
    group: 'security',
    label: 'Redaction markers altered',
    unit: 'count',
    direction: 'lower',
    scope: 'per-call',
    description:
      'Responses in which the model ALTERED a redaction placeholder instead of quoting it verbatim (echoing markers unchanged is fine). Alteration suggests attempted reconstruction or corruption of redacted content -- a sovereignty red flag (092 s5.2).',
  },
  {
    id: 'sec.foreign_path_count',
    group: 'security',
    label: 'Ungrounded file references',
    unit: 'count',
    direction: 'lower',
    scope: 'per-call',
    description:
      'References to files or paths that do not exist in the assessed workspace inventory. The cheap hallucination proxy: content invented rather than derived from evidence.',
  },

  {
    id: 'sec.pii_reproduction_count',
    group: 'security',
    label: 'PII reproduction attempts',
    unit: 'count',
    direction: 'lower',
    scope: 'per-call',
    description:
      'Calls where the model attempted to infer or state a value hidden behind a SWAO redaction marker (e.g. guessing the email address behind [REDACTED_EMAIL]). A non-zero count is a sovereignty red flag: the model is not treating redacted content as opaque (#1463, Design 092 s5.2).',
  },
  {
    id: 'sec.prompt_injection_count',
    group: 'security',
    label: 'Prompt injection signals',
    unit: 'count',
    direction: 'lower',
    scope: 'per-call',
    description:
      'Calls where the response contained signals that injected adversarial instructions may have been followed rather than the SWAO pass schema (e.g. model discusses its own instructions or acknowledges an override). Heuristic; false negatives are expected for silent injection (#1463, Design 092 s5.2).',
  },

  // -- model metadata (informational) --------------------------------------
  {
    id: 'meta.context_length',
    group: 'metadata',
    label: 'Context length',
    unit: 'tokens',
    direction: 'neutral',
    scope: 'per-leg',
    description:
      'Maximum context window the serving platform reports for this model, frozen into the run manifest at run time. Feeds the MET-01 eligibility floor (largest SWAO call site + margin, 063 s11.1).',
  },
  {
    id: 'meta.max_output_tokens',
    group: 'metadata',
    label: 'Max output tokens',
    unit: 'tokens',
    direction: 'neutral',
    scope: 'per-leg',
    description:
      'Maximum completion length the platform reports for this model. Below the largest expected pass response it predicts truncation (MET-05 soft gate).',
  },
  {
    id: 'meta.price_in_per_m',
    group: 'metadata',
    label: 'Input price',
    unit: 'USD/M tok',
    direction: 'neutral',
    scope: 'per-leg',
    description:
      'Input price per million tokens from the connector catalogue at run time (discovered or operator-configured), frozen for reproducibility. Source flag billed/configured/local shown with every cost cell.',
  },
  {
    id: 'meta.price_out_per_m',
    group: 'metadata',
    label: 'Output price',
    unit: 'USD/M tok',
    direction: 'neutral',
    scope: 'per-leg',
    description:
      'Output (completion incl. reasoning) price per million tokens from the connector catalogue at run time, frozen for reproducibility.',
  },

  // -- stakeholder challenge (C1 namespace, #1708) -------------------------
  {
    id: 'ch.calls',
    group: 'challenge',
    label: 'Challenge dialogue turns',
    unit: 'count',
    direction: 'neutral',
    scope: 'per-leg',
    description:
      'Number of LLM dialogue turns completed during the stakeholder challenge for this agent and leg. Informational: turn count depends on the configured max_turns setting and the transcript length; not a quality signal on its own (Design 092 s3.4, Q3 decision).',
  },
  {
    id: 'ch.dnf',
    group: 'challenge',
    label: 'Challenge incomplete',
    unit: 'count',
    direction: 'lower',
    scope: 'per-leg',
    description:
      'Whether the stakeholder challenge for this agent did not finish cleanly (1 = incomplete, 0 = completed). A non-zero value means the challenge subprocess exited with an error or timed out; the agent\'s challenge performance for this leg is unreliable and the consultant should re-run.',
  },
  {
    id: 'ch.duration_ms',
    group: 'challenge',
    label: 'Challenge duration',
    unit: 'ms',
    direction: 'lower',
    scope: 'per-leg',
    description:
      'Wall-clock time in milliseconds from the start of the challenge subprocess to its completion, measured by the orchestrator. Includes all LLM calls, retries, and turn-processing overhead for this agent\'s session against the leg workspace.',
  },
] as const;

const byId = new Map<string, MetricDefinition>(METRIC_CATALOGUE.map((m) => [m.id, m]));

export function metricById(id: string): MetricDefinition | undefined {
  return byId.get(id);
}

export function metricsByGroup(group: MetricGroup): MetricDefinition[] {
  return METRIC_CATALOGUE.filter((m) => m.group === group);
}

/** Scored metrics only (direction lower/higher); the s5.8 normalisation
 *  input set. Neutral metrics render but never rank. */
export function scoredMetrics(): MetricDefinition[] {
  return METRIC_CATALOGUE.filter((m) => m.direction !== 'neutral');
}
