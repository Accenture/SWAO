// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Research stub contract (Design 103 §4.4, §6.2, #3086-#3091).
 *
 * One Markdown file per topic at `apps/<id>/wsp/inputs/research/<topic>.md`:
 * YAML front-matter (structured, consumed by synthesis, outputs, and probes)
 * plus a Markdown body. Later phases import these schemas instead of
 * re-deriving field names.
 *
 * Two independent labels per stub and per source block:
 *   confidence  high | medium | low   -- how specific the match is (#3091)
 *   provenance  API-verified | catalogue | LLM-researched | user-provided  -- where it came from (§6.2.6)
 */

import { z } from 'zod';

export const RESEARCH_CONFIDENCES = ['high', 'medium', 'low'] as const;
export const ResearchConfidenceSchema = z.enum(RESEARCH_CONFIDENCES);
export type ResearchConfidence = z.infer<typeof ResearchConfidenceSchema>;

export const PROVENANCES = ['API-verified', 'catalogue', 'LLM-researched', 'user-provided'] as const;
export const ProvenanceSchema = z.enum(PROVENANCES);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const RESEARCH_TOPICS = [
  'cve-summary',
  'eol-status',
  'virustotal',
  'vendor-profile',
  'certifications',
  'data-residency',
  'breach-history',
] as const;
export type ResearchTopic = (typeof RESEARCH_TOPICS)[number];

/** Topics hydrated from public APIs; the rest use LLM-augmented research (LLM_TOPICS, Design 103 §6.2.4). */
export const API_TOPICS: readonly ResearchTopic[] = ['cve-summary', 'eol-status', 'virustotal'];

/**
 * Topics researched through the workspace LLM provider (Design 103 §6.2.4,
 * #3289). Available in every licence tier (Design 110 D-07). Without a
 * configured LLM the stubs are written as `status: skipped` with
 * `skipped_reason: no_llm_configured`.
 */
export const LLM_TOPICS: readonly ResearchTopic[] = ['vendor-profile', 'certifications', 'data-residency', 'breach-history'];

/** skipped_reason values of an LLM topic (#3289). */
export const LLM_SKIP_REASONS = {
  /** No LLM provider configured for the workspace. */
  noLlm: 'no_llm_configured',
  /** An LLM is configured but the provider could not be built (missing key, unknown connector). */
  unavailable: 'llm_unavailable',
  /** The provider call failed (network, HTTP, timeout). */
  error: 'llm_error',
  /** The model answered, but not with the JSON contract of the prompt. */
  malformed: 'llm_malformed_response',
  /** The user skipped the LLM topics (`swao service research --skip-llm`, or the TUI choice, #3304). */
  byUser: 'skipped_by_user',
} as const;

/**
 * skipped_reason written by builds before #3289, when no research path
 * existed. Such a stub is rewritten on the next run.
 */
export const LEGACY_NOT_IMPLEMENTED_REASON = 'not_implemented';

/** Shared fields of every source block. */
const SourceBase = {
  fetched_at: z.string().nullable(),
  confidence: ResearchConfidenceSchema.nullable(),
  error: z.string().optional(),
  note: z.string().optional(),
  skipped_reason: z.string().optional(),
  /** Per-source provenance (#3154): `API-verified` when this source answered; absent or null when it was skipped or failed. */
  provenance: ProvenanceSchema.nullable().optional(),
};

export const CveRefSchema = z.object({
  id: z.string(),
  severity: z.string().nullable(),
  score: z.number().nullable(),
  url: z.string(),
});

export const CveBlockSchema = z.object({
  ...SourceBase,
  source: z.literal('nvd'),
  query: z.string().nullable(),
  count: z.number().int().nonnegative().nullable(),
  critical_count: z.number().int().nonnegative().nullable(),
  high_count: z.number().int().nonnegative().nullable(),
  medium_count: z.number().int().nonnegative().nullable(),
  low_count: z.number().int().nonnegative().nullable(),
  patch_available: z.union([z.boolean(), z.literal('partial')]).nullable(),
  kev_match: z.boolean(),
  cve_ids: z.array(z.string()),
  top: z.array(CveRefSchema),
  evidence_url: z.string().nullable(),
  /** True when NVD reported more results than were paged in (page cap or a failed later page, #3154). */
  truncated: z.boolean().optional(),
});
export type CveBlock = z.infer<typeof CveBlockSchema>;

export const KevBlockSchema = z.object({
  ...SourceBase,
  source: z.literal('cisa-kev'),
  catalog_version: z.string().nullable(),
  matches: z.array(z.object({ cve: z.string(), required_action: z.string().nullable(), due_date: z.string().nullable() })),
});
export type KevBlock = z.infer<typeof KevBlockSchema>;

export const OsvBlockSchema = z.object({
  ...SourceBase,
  source: z.literal('osv'),
  package: z.string().nullable(),
  ecosystem: z.string().nullable(),
  vuln_count: z.number().int().nonnegative().nullable(),
  vuln_ids: z.array(z.string()),
});
export type OsvBlock = z.infer<typeof OsvBlockSchema>;

export const BSI_SEVERITIES = ['niedrig', 'mittel', 'hoch', 'kritisch'] as const;

export const BsiBlockSchema = z.object({
  ...SourceBase,
  source: z.literal('bsi-cert-bund'),
  alert_count: z.number().int().nonnegative().nullable(),
  highest_severity: z.enum(BSI_SEVERITIES).nullable(),
  alerts: z.array(z.object({ id: z.string(), title: z.string(), url: z.string(), severity: z.string().nullable(), published: z.string().nullable() })),
});
export type BsiBlock = z.infer<typeof BsiBlockSchema>;

export const EolBlockSchema = z.object({
  ...SourceBase,
  source: z.literal('endoflife.date'),
  product: z.string().nullable(),
  cycle: z.string().nullable(),
  date: z.string().nullable(),
  is_eol: z.boolean().nullable(),
  support_until: z.string().nullable(),
  extended_support_until: z.string().nullable(),
  months_until_eol: z.number().nullable(),
  evidence_url: z.string().nullable(),
});
export type EolBlock = z.infer<typeof EolBlockSchema>;

export const VtBlockSchema = z.object({
  ...SourceBase,
  source: z.literal('virustotal'),
  sha256: z.string().nullable(),
  detection_ratio: z.string().nullable(),
  malicious: z.number().int().nonnegative().nullable(),
  last_analysis_date: z.string().nullable(),
  permalink: z.string().nullable(),
});
export type VtBlock = z.infer<typeof VtBlockSchema>;

const StubBase = {
  topic: z.enum(RESEARCH_TOPICS),
  app_id: z.string(),
  vendor_name: z.string().nullable(),
  product_name: z.string().nullable(),
  version: z.string().nullable(),
  status: z.enum(['pending', 'researched', 'skipped']),
  retrieved_at: z.string().nullable(),
  confidence: ResearchConfidenceSchema.nullable(),
  provenance: ProvenanceSchema.nullable(),
  /** Set by an analyst to promote a finding to user-provided (§6.2.6); research never overwrites such a stub. */
  reviewed_by: z.string().optional(),
  reviewed_at: z.string().optional(),
};

export const CveSummaryStubSchema = z.object({
  ...StubBase,
  topic: z.literal('cve-summary'),
  cve: CveBlockSchema,
  kev: KevBlockSchema,
  osv: OsvBlockSchema,
  bsi: BsiBlockSchema,
}).passthrough();

export const EolStatusStubSchema = z.object({ ...StubBase, topic: z.literal('eol-status'), eol: EolBlockSchema }).passthrough();
export const VirusTotalStubSchema = z.object({ ...StubBase, topic: z.literal('virustotal'), vt: VtBlockSchema }).passthrough();
/** A source a model cited (#3289). Never fetched or checked by SWAO: `verified` is always false. */
export const LlmSourceSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  cited_by: z.literal('model'),
  verified: z.literal(false),
});
export type LlmSource = z.infer<typeof LlmSourceSchema>;

export const LlmFindingSchema = z.object({
  statement: z.string(),
  confidence: ResearchConfidenceSchema,
  sources: z.array(LlmSourceSchema),
});
export type LlmFinding = z.infer<typeof LlmFindingSchema>;

/** A yes / no / unknown answer of a structured fact (#3308). */
export const LLM_TRI_STATES = ['yes', 'no', 'unknown'] as const;
export const LlmTriStateSchema = z.enum(LLM_TRI_STATES);
export type LlmTriState = z.infer<typeof LlmTriStateSchema>;

/** EU MDR 2017/745 answers of the certifications topic (#3308); only `class_not_published` emits MDR.CLASS_UNCLEAR. */
export const LLM_MDR_CLASSES = ['I', 'IIa', 'IIb', 'III', 'not_a_medical_device', 'class_not_published', 'unknown'] as const;
export const LlmMdrClassSchema = z.enum(LLM_MDR_CLASSES);

/**
 * Structured facts of an LLM topic (prompt version 1.1, #3308), normalised by
 * parseLlmFacts (llm-research.ts). Every field is optional: a version 1.0 stub
 * has no `facts` block, and a topic carries only its own fields. `unknown`, a
 * null number, or an absent field never produces a signal. `sources` are the
 * model's citations for the facts (`cited_by: model`, never verified).
 */
export const LlmFactsSchema = z.object({
  eu_entity: LlmTriStateSchema.optional(),
  patch_cadence_days_estimate: z.number().positive().nullable().optional(),
  mdr_class: LlmMdrClassSchema.optional(),
  bfarm_listed: LlmTriStateSchema.optional(),
  gdpr_dpa_available: LlmTriStateSchema.optional(),
  sources: z.array(LlmSourceSchema).optional(),
});
export type LlmFacts = z.infer<typeof LlmFactsSchema>;

/** Front-matter block of an LLM topic (#3289). */
export const LlmBlockSchema = z.object({
  ...SourceBase,
  source: z.literal('llm'),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  prompt_version: z.string().nullable(),
  summary: z.string().nullable(),
  findings: z.array(LlmFindingSchema),
  /** Structured facts (#3308); absent in version 1.0 stubs and in topics without facts. */
  facts: LlmFactsSchema.optional(),
});
export type LlmBlock = z.infer<typeof LlmBlockSchema>;

export const LlmTopicStubSchema = z.object({
  ...StubBase,
  topic: z.enum(['vendor-profile', 'certifications', 'data-residency', 'breach-history']),
  note: z.string().optional(),
  /** Why the topic was not researched (LLM_SKIP_REASONS, `no_input`). */
  skipped_reason: z.string().optional(),
  llm: LlmBlockSchema.optional(),
}).passthrough();
/** @deprecated name kept for importers; the LLM topics are no longer placeholders (#3289). */
export const PendingStubSchema = LlmTopicStubSchema;

export type CveSummaryStub = z.infer<typeof CveSummaryStubSchema>;
export type EolStatusStub = z.infer<typeof EolStatusStubSchema>;
export type VirusTotalStub = z.infer<typeof VirusTotalStubSchema>;
export type LlmTopicStub = z.infer<typeof LlmTopicStubSchema>;
export type PendingStub = LlmTopicStub;
export type ResearchStub = CveSummaryStub | EolStatusStub | VirusTotalStub | LlmTopicStub;

/** Schema for a topic's front-matter. */
export function stubSchemaFor(topic: ResearchTopic): z.ZodTypeAny {
  switch (topic) {
    case 'cve-summary': return CveSummaryStubSchema;
    case 'eol-status': return EolStatusStubSchema;
    case 'virustotal': return VirusTotalStubSchema;
    case 'vendor-profile':
    case 'certifications':
    case 'data-residency':
    case 'breach-history':
      return LlmTopicStubSchema;
  }
}

/** Per-app `confidence.json` (#3091). */
export const ResearchConfidenceFileSchema = z.object({
  app_id: z.string(),
  generated_at: z.string(),
  /** Minimum over researched topics; null when no topic produced a confidence. */
  composite: ResearchConfidenceSchema.nullable(),
  topics: z.record(z.string(), ResearchConfidenceSchema.nullable()),
});
export type ResearchConfidenceFile = z.infer<typeof ResearchConfidenceFileSchema>;

/** Per-app binary hash input written by Pass 25 BINARY (Phase 5): `apps/<id>/wsp/inputs/binary/binary-analysis.json`. */
export const BinaryAnalysisFileSchema = z.object({
  files: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/i) }).passthrough()),
}).passthrough();
export type BinaryAnalysisFile = z.infer<typeof BinaryAnalysisFileSchema>;

export const STUB_TTL_DAYS = { nvd: 7, 'cisa-kev': 1, osv: 7, 'bsi-cert-bund': 1, 'endoflife.date': 30, virustotal: 7, llm: 30 } as const;
