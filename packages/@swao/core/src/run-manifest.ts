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

import { z } from 'zod';

// Relocated to @swao/core (#0591) so the app-assessment module's `diff` command
// can validate run manifests without importing from @swao/swao. @swao/swao's
// schema/run-manifest.ts now re-exports from here for its existing call sites.

// v1.2 (Sprint 020 stretch): per-pass LLM-call stats added (optional).
// `tokens_in` + `tokens_out` are the integer prompt + completion token
// counts returned by the provider when available. `cost_usd` is the
// per-pass cost as best estimated by the provider integration.
// Fields are optional so older v1.1 manifests keep loading; the LLM
// providers populate them per ADR-0025 v0.10 auditor surface.
export const PassStatSchema = z.object({
  pass: z.string(),
  num: z.string(),
  wall_clock_ms: z.number().int().nonnegative(),
  signals_emitted: z.number().int().nonnegative(),
  // #0389 (sprint-040): items_emitted is the canonical "how much did
  // this pass produce" count. For most passes it equals signals_emitted;
  // for Pass 12 (block_assessments) it carries the assessment.blocks_evaluated
  // count because that pass emits blocks rather than signals. Optional so
  // older v1.1/1.2/1.3 manifests keep loading.
  items_emitted: z.number().int().nonnegative().optional(),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
  // #1417 (design 092 s3.4): LLM calls made by this pass, from the
  // per-pass usage tracker snapshot. Validates the call-site registry
  // (looping sites make call counts vary per app). Optional for
  // manifests that predate the field.
  llm_calls: z.number().int().nonnegative().optional(),
  // #0994: iteration label (1 = assessment, 2 = challenge). Optional for
  // backward-compat with older manifests that predate this field.
  iter: z.number().int().positive().optional(),
});

const LlmRunStatsSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  total_tokens_in: z.number().int().nonnegative().optional(),
  total_tokens_out: z.number().int().nonnegative().optional(),
  total_cost_usd: z.number().nonnegative().optional(),
  call_count: z.number().int().nonnegative().optional(),
  // SWAO LLM-Gateway provenance (Design 090, #1401): which connector FILE
  // (by id + content hash) served the run. Additive-optional; absent for
  // legacy type-based configurations.
  gateway: z.object({
    connector_id: z.string(),
    connector_sha256: z.string().optional(),
    connector_origin: z.enum(['workspace', 'bundled']).optional(),
    protocol: z.string().optional(),
    base_url: z.string().optional(),
  }).optional(),
});

const FilesAssessedSchema = z.object({
  inventory_count: z.number().int().nonnegative().optional(),
  source_files_total: z.number().int().nonnegative().optional(),
  imports_files_total: z.number().int().nonnegative().optional(),
});

// v1.3 (Sprint 022): record the four landing-zone fit-score weights used
// for THIS run so the audit trail and BI fact_runs can show them. The
// weights live in cloud-provider-catalogue.ts as DEFAULT_WEIGHTS today;
// recording them per-run lets future overrides remain auditable.
const LandingZoneWeightsSchema = z.object({
  sovereign_score: z.number().min(0).max(1),
  service_coverage: z.number().min(0).max(1),
  portability: z.number().min(0).max(1),
  cost_tier: z.number().min(0).max(1),
});

// v1.4 (#0474 C-17): data quality provenance aggregated from all pass-level
// data_source blocks. llm_provider/llm_model are NOT duplicated here --
// they live in run-manifest.llm.{provider,model} (v1.2+). This block adds
// the fields absent from the existing llm block.
const ProvenanceSchema = z.object({
  temperature: z.number(),
  seed: z.number().optional(),
  cassette_hits: z.array(z.string()),
  placeholder_inputs: z.array(z.string()),
  false_positive_flags: z.number().int().nonnegative(),
  lzr_input_type: z.enum(['snapshot', 'terraform', 'live_api', 'catalogue', 'none']),
  lzr_snapshot_file: z.string().optional(),
  lzr_snapshot_age_days: z.number().nonnegative().optional(),
  lzr_snapshot_fabricated: z.boolean().optional(),
  crawl_type: z.enum(['playwright', 'stub', 'none']),
  swao_version: z.string(),
  // #0550: LLM-dependent passes that degraded to no_llm_provider skip signals
  // because no LLM provider was configured. Empty / absent when an LLM ran.
  // The HTML report health section surfaces this list.
  llm_skipped_passes: z.array(z.string()).optional(),
  // #0989 Design 074 §3.3: lens identifiers active during this assessment run.
  // Additive optional field -- absent on runs predating v0.7.x.
  lenses_used: z.array(z.string()).optional(),
});

// #1702: record passes that degraded (connectivity failure, provider error) so the
// manifest is not silently incomplete. Optional for back-compat with older manifests.
const PassFailedSchema = z.object({
  pass: z.string(),
  reason: z.enum(['connectivity_failure', 'provider_error']),
});

export const RunManifestSchema = z.object({
  // schema_version 1.1 retained for back-compat; 1.2 adds llm +
  // files_assessed; 1.3 adds landing_zone_weights; 1.4 adds provenance;
  // 1.5 adds passes_failed (additive, no existing manifests break).
  schema_version: z.union([
    z.literal('1.1'), z.literal('1.2'), z.literal('1.3'), z.literal('1.4'), z.literal('1.5'),
  ]),
  run_id: z.string(),
  app: z.string(),
  iter: z.number().int().positive(),
  assessed_at: z.string(),
  started_at: z.string().datetime({ offset: true }),
  finished_at: z.string().datetime({ offset: true }),
  duration_ms: z.number().int().nonnegative(),
  passes_executed: z.array(z.string()),
  total_signals_emitted: z.number().int().nonnegative(),
  pass_stats: z.array(PassStatSchema),

  // v1.2 additions (optional)
  llm: LlmRunStatsSchema.optional(),
  files_assessed: FilesAssessedSchema.optional(),

  // v1.3 additions (optional)
  landing_zone_weights: LandingZoneWeightsSchema.optional(),

  // v1.4 additions (optional for back-compat with older manifests)
  provenance: ProvenanceSchema.optional(),

  // #1437 (sprint-114): per-provider LZ catalogue provenance recorded per run
  // so the audit trail can show which providers used workspace-local overrides
  // and detect edits to workspace catalogues between runs via sha256.
  // Additive-optional; absent on runs predating this field.
  lz_catalogues: z.record(z.string(), z.object({
    origin: z.enum(['workspace', 'installed', 'bundled']),
    sha256: z.string(),
    last_updated: z.string().optional(),
  })).optional(),

  // #1702: passes that degraded during the run (connectivity or provider error).
  // Empty / absent = all passes completed normally. Non-empty = partial assessment.
  passes_failed: z.array(PassFailedSchema).optional(),
});

export type PassStat = z.infer<typeof PassStatSchema>;
export type PassFailed = z.infer<typeof PassFailedSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
export type LlmRunStats = z.infer<typeof LlmRunStatsSchema>;
export type FilesAssessed = z.infer<typeof FilesAssessedSchema>;
export type LandingZoneWeights = z.infer<typeof LandingZoneWeightsSchema>;
export type RunManifestProvenance = z.infer<typeof ProvenanceSchema>;
