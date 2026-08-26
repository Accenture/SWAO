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

// Per-call record -- the measurement atom (#1422/#1426, Design 092 s5.2).
//
// Written once per LLM call per leg by the recording decorator (#1422) and
// consumed by the per-pass dimension groups (#1426), the prompt-size views
// (s6) and the future fan-out/golden-replay modes (063 s17.5, which share
// exactly this schema). Response BODIES are working data (s7.2); records
// carry the sha256 only.

import { z } from 'zod';

// Prompt-size buckets (092 s6.1). Boundaries are spec constants so
// cross-run comparisons stay stable.
export const SIZE_BUCKETS = ['S', 'M', 'L', 'XL'] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];

export const SIZE_BUCKET_BOUNDS_TOKENS = {
  S: 2_000,   // < 2k
  M: 16_000,  // 2k..16k
  L: 64_000,  // 16k..64k
  // XL: everything above L
} as const;

export function sizeBucket(promptTokens: number): SizeBucket {
  if (promptTokens < SIZE_BUCKET_BOUNDS_TOKENS.S) return 'S';
  if (promptTokens < SIZE_BUCKET_BOUNDS_TOKENS.M) return 'M';
  if (promptTokens < SIZE_BUCKET_BOUNDS_TOKENS.L) return 'L';
  return 'XL';
}

export const CallRecordSchema = z.object({
  leg: z.object({
    /** Stable leg id: <connector>--<model-slug>. */
    id: z.string().min(1),
    connector: z.string().min(1),
    model: z.string().min(1),
    connector_sha256: z.string().optional(),
  }),
  pass_id: z.string().min(1),          // e.g. "04-ctx"
  call_site: z.string().min(1),        // registry site (092 s3.4)
  call_index: z.number().int().nonnegative(), // iteration within looping sites
  prompt: z.object({
    sha256: z.string(),
    chars: z.number().int().nonnegative(),
    tokens_est: z.number().int().nonnegative(),
    size_bucket: z.enum(SIZE_BUCKETS),
  }),
  timing: z.object({
    started: z.string(),               // ISO timestamp
    total_ms: z.number().nonnegative(),
    ttfb_ms: z.number().nonnegative().optional(),
  }),
  tokens: z.object({
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
    reasoning: z.number().int().nonnegative().optional(),
    cached_prompt: z.number().int().nonnegative().optional(),
  }),
  cost_usd: z.object({
    computed: z.number().nonnegative().nullable(), // null = no price row (092 s4)
    source: z.enum(['billed', 'configured', 'local']),
  }),
  quality: z.object({
    parse_valid: z.boolean(),
    schema_conform: z.boolean(),
    truncated: z.boolean(),
    refusal_detected: z.boolean(),
    /** Which response field carried the output (#1690): 'content' or 'reasoning_content'.
     *  Absent for providers that always use content (anthropic, openai). */
    content_source: z.enum(['content', 'reasoning_content']).optional(),
  }),
  reliability: z.object({
    retries: z.number().int().nonnegative(),
    rate_limited: z.boolean(),
    error: z.string().optional(),
    dnf: z.boolean(),
  }),
  security: z.object({
    redaction_marker_altered: z.boolean(),
    foreign_path_count: z.number().int().nonnegative(),
    /** PII reproduction heuristic: model tried to infer or state a value
     *  hidden behind a redaction marker (#1463 security-pii-redaction). */
    pii_reproduction_detected: z.boolean(),
    /** Prompt injection heuristic: response contains signals that injected
     *  instructions were followed rather than the SWAO schema (#1463). */
    prompt_injection_detected: z.boolean(),
  }),
  response_sha256: z.string().optional(), // absent on DNF
  /** Distinguishes vision calls from standard text calls (Design 092 s5.2). */
  call_type: z.enum(['text', 'vision']).optional(),
  /** Number of images sent in a vision call. */
  image_count: z.number().int().nonnegative().optional(),
  /** Aggregate byte size of all images in a vision call. */
  image_bytes_total: z.number().int().nonnegative().optional(),
});

export type CallRecord = z.infer<typeof CallRecordSchema>;

/** Analysis mode (092 s3.3, OQ-92-12): with exactly two legs there is no
 *  majority, so majority metrics are disabled, agreement is vs primary
 *  only, and the publication is labelled head-to-head. */
export type AnalysisMode = 'head-to-head' | 'field';

export function analysisMode(legCount: number): AnalysisMode {
  if (legCount < 2 || legCount > 5) {
    throw new RangeError(`LLM Assessment requires 2..5 legs (got ${legCount})`);
  }
  return legCount === 2 ? 'head-to-head' : 'field';
}
