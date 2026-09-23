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

export const REGIME_ID_REGEX = /^[A-Z][A-Z0-9_-]{1,31}$/;

export const RegimeIdSchema = z.string().regex(REGIME_ID_REGEX);

// Scope enum (design 029 §11; sprint-037 #0341; sprint-039 #0358 Phase 3).
// The legacy `overlay` scope from sprint-034 retired sprint-037 (ADR-0035).
// The legacy `standard` scope retired sprint-039 (#0358 Phase 3) -- every
// flagship regime ships as a community framework now (5 thin migrations in
// Phase 1; HIPAA + GDPR already there in earlier sprints). The enum kept as
// a single-element enum (rather than dropping the field entirely) so the
// schema bump is purely subtractive at the wrapper level; an existing
// catalogue with `scope: standard` would fail validation, which is the
// intended forcing function for any straggler operator-overlay files.
//
// The earlier `classification:` field (sprint-037 #0341) was removed in
// sprint-038 #0349 -- it carried no engine semantics beyond a one-line CLI
// display, and `authority:` + `tags:` (#0348) cover the categorisation use
// case more cleanly.
export const ScopeSchema = z.enum(['community']);

const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

const ContributorSchema = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  url: z.string().optional(),
});

const ReplacesEntrySchema = z.union([
  z.string().regex(REGIME_ID_REGEX),
  z.object({
    regime_id: z.string().regex(REGIME_ID_REGEX),
    location: z.string().optional(),
    controls_carried_over: z.array(z.string()).optional(),
    note: z.string().optional(),
  }),
]);

// Design 104 §5.1: typed schema for framework-meta.yaml (raw yaml.load passthrough
// in framework.ts cmdInfo/readReplaces; this schema is used by compliance-registry.ts
// when building the bundled registry from Phase 3 onwards). Exported for Phase 2
// publication-model typing; call sites added in Phase 3.
export const FrameworkMetaSchema = z.object({
  framework: z.object({
    id: RegimeIdSchema,
    name: z.string().min(3).max(120).optional(),
    version: z.string().min(1).optional(),
    contributor: z.union([
      z.string().min(1),
      ContributorSchema,
    ]).optional(),
    description: z.string().optional(),
    applicability_hints: z.array(z.string()).default([]),
    replaces: z.array(ReplacesEntrySchema).optional(),
    // Design 104 §5.1 new meta fields.
    scoring_mode: z.enum(['binary', 'maturity', 'score']).default('binary'),
    effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    next_review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    national_overlay_of: RegimeIdSchema.optional(),
    companion_standards: z.array(z.string()).default([]),
    assessment_type_scope: z.array(z.string()).default([]),
  }),
});

export const RegimeMetaSchema = z.object({
  id: RegimeIdSchema,
  name: z.string().min(3).max(120),
  version: z.string().min(1),
  scope: ScopeSchema.optional(),
  authority: z.string().min(1),
  applicability_hints: z.array(z.string()).default([]),
  // Description optional per design 029 §11: the canonical description lives
  // in the sibling framework-meta.yaml. The regime_meta block in controls.yaml
  // is a minimal back-compat index entry. Sprint-037 #0341.
  description: z.string().min(20).optional(),
  references: z.array(z.string()).default([]),
  last_reviewed: z.string().optional(),
  catalogue_version: SemverSchema,
  // Design 029 §11 community-framework fields (sprint-037 #0341 additive).
  // `classification:` removed in sprint-038 #0349 (see ScopeSchema comment).
  contributor: ContributorSchema.optional(),
  signal_prefix: z.string().optional(),
  source_sha256: z.string().optional(),
  replaces: z.array(ReplacesEntrySchema).optional(),
  // Design 104 §5.1: extended meta-model fields (sprint-138 #2817). All optional
  // / defaulted so existing controls.yaml files without these fields continue
  // to parse cleanly (additive-only change).
  scoring_mode: z.enum(['binary', 'maturity', 'score']).default('binary'),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  next_review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  national_overlay_of: RegimeIdSchema.optional(),
  companion_standards: z.array(z.string()).default([]),
});

// Evidence-basis variants per design 029 §4.5. The first three (signal_prefix,
// context_input, pass) shipped in design 018 §2.1; the remaining three
// (local_signal_regex, manual_questionnaire, external_scanner) were defined
// in design 029 §4.5 as the sprint-034 schema additions but were never landed.
// Sprint-037 #0341 closes that implementation gap so the operator-authored
// community frameworks (GDPR, AI-10-Pillars, Gartner-G00840416) parse cleanly.
const EvidenceBasisEntrySchema = z.union([
  z.object({ signal_prefix: z.string() }),
  z.object({ context_input: z.string() }),
  z.object({ pass: z.union([z.number(), z.string()]) }),
  z.object({ local_signal_regex: z.string().min(3) }),
  z.object({ manual_questionnaire: z.string().regex(/\.ya?ml$/) }),
  z.object({ external_scanner: z.string().regex(/^[a-z_]+::.+/) }),
  // Design 104 §5.2: new evidence-basis variants (sprint-138 #2817).
  z.object({ scorecard_api: z.string() }),
  z.object({ csp_certification: z.string() }),
  z.object({ regulatory_approval: z.string() }),
  z.object({ sbom_scan: z.string() }),
  z.object({ apm_export: z.string() }),
]);

export const RegimeControlSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(3),
  description: z.string().min(10),
  severity_default: z
    .enum(['critical', 'high', 'medium', 'low', 'informational'])
    .optional(),
  evidence_basis: z.array(EvidenceBasisEntrySchema).default([]),
  references: z.array(z.string()).default([]),
  overrides: z.array(z.string()).default([]),
  // Design 029 §4.5 + §11 community-framework fields (sprint-037 #0341).
  pillar: z.string().optional(),
  maps_to: z.array(z.string()).default([]),
  remediation: z.string().optional(),
  // Sprint-038 #0348: secondary categorisation axis orthogonal to `pillar`.
  // Tag taxonomies live in each framework's controls.yaml (not in source);
  // see design 029 §13.7-§13.10 for the per-framework conventions. The
  // CLI `swao framework info <id>` surfaces tags to the operator; PowerBI
  // slicers are a sprint-039 follow-up.
  tags: z.array(z.string()).default([]),
  // Design 104 §5.2: extended control fields (sprint-138 #2817). All optional
  // / defaulted so existing controls.yaml files without these fields continue
  // to parse cleanly (additive-only change).
  csp_inherited: z.boolean().default(false),
  csp_evidence_required: z.array(z.string()).default([]),
  // applies_when: YAML key-value map evaluated against framework_context in
  // .swao.yml (Q-CODE-7 decision). Missing keys -> not_assessed/not_applicable.
  applies_when: z.record(z.string(), z.string()).optional(),
  maturity_required: z.number().int().min(0).max(5).optional(),
  score_threshold: z.number().int().min(0).max(10).optional(),
  regulatory_basis: z.string().optional(),
  official_control_id: z.string().optional(),
  reliability: z.enum(['automated', 'verified', 'self-asserted']).optional(),
  layer: z.enum(['runtime', 'devops', 'governance']).optional(),
});

export const RegimeCatalogueSchema = z.object({
  regime_meta: RegimeMetaSchema,
  controls: z.array(RegimeControlSchema).min(1),
});

const IndexEntrySchema = z.object({
  id: RegimeIdSchema,
  name: z.string().min(3),
  version: z.string().min(1),
  file: z.string().regex(/\.ya?ml$/),
  controls_count: z.number().int().min(1),
  applicability_hints: z.array(z.string()).default([]),
});

export const RegimeIndexSchema = z.object({
  schema_version: z.literal('1'),
  scope: ScopeSchema,
  regimes: z.array(IndexEntrySchema),
});

export type RegimeId = z.infer<typeof RegimeIdSchema>;
export type Scope = z.infer<typeof ScopeSchema>;
export type FrameworkMeta = z.infer<typeof FrameworkMetaSchema>;
export type RegimeMeta = z.infer<typeof RegimeMetaSchema>;
export type RegimeControl = z.infer<typeof RegimeControlSchema>;
export type RegimeCatalogue = z.infer<typeof RegimeCatalogueSchema>;
export type RegimeIndex = z.infer<typeof RegimeIndexSchema>;
export type RegimeIndexEntry = z.infer<typeof IndexEntrySchema>;
