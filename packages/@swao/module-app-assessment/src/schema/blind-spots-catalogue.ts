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

import { z } from 'zod';

// Sprint 029 Phase 1 (#0263) -- Blind-Spots Catalogue schema.
//
// The catalogue declares categories that SWAO structurally does not
// assess by default from a source-only static analysis. Pass 13 (Scope
// Coverage) cross-references each entry with the workspace's
// wsp/inputs/ directory; if any `input_paths` candidate exists and is
// non-empty, the entry's coverage is "closed". Otherwise it remains
// "open" (or "partial" if SWAO has baseline coverage of a subset).
//
// See: ADR-0030, SPEC.md §10.1c, controls/blind-spots-catalogue.yaml.

export const SeverityDefaultSchema = z.enum([
  'critical', 'high', 'medium', 'low', 'informational',
]);

export const CurrentCoverageSchema = z.enum(['none', 'partial', 'full']);

/**
 * Evidence kinds a blind spot can require before it applies to a service
 * workload (Pass 13). `container_platform` (#3246): Kubernetes, OpenShift or
 * service-mesh evidence. `web_facing` (#3290, Design 110 D-25): an HTTP
 * endpoint, URL, web UI, API, web server or API gateway, an internet-facing
 * network zone, or SaaS delivery.
 */
export const BLIND_SPOT_EVIDENCE_KINDS = ['container_platform', 'web_facing'] as const;
export type BlindSpotEvidenceKind = (typeof BLIND_SPOT_EVIDENCE_KINDS)[number];

export const BlindSpotEntrySchema = z.object({
  id: z.string().regex(/^BS_[A-Z0-9_]+$/, 'blind-spot id must match ^BS_[A-Z0-9_]+$'),
  name: z.string().min(3),
  category: z.string().min(2),
  description: z.string().min(20),
  severity_default: SeverityDefaultSchema,
  current_swao_coverage: CurrentCoverageSchema,
  input_that_closes: z.string().min(2),
  /** Machine-parseable candidate paths (relative to apps/<id>/).
   *  Rule engine walks these; if ANY exists and is non-empty,
   *  coverage closes. */
  input_paths: z.array(z.string().min(1)).min(1),
  /** Human-readable instruction shown in reports. */
  input_path_hint: z.string().min(10),
  /** Regimes this blind spot maps to. `[all]` expands at load time
   *  to the full registered regime set. */
  related_regimes: z.array(z.string()).min(1),
  /** #3246 / #3290: evidence the workload must show before the blind spot
   *  applies (every listed kind). `container_platform`: Kubernetes /
   *  OpenShift / service-mesh evidence. `web_facing`: web or API exposure.
   *  Absent = always applies. Pass 13 enforces it for service workloads. */
  requires_evidence: z.array(z.enum(BLIND_SPOT_EVIDENCE_KINDS)).optional(),
});

export const BlindSpotsCatalogueSchema = z.object({
  schema_version: z.literal('1'),
  catalogue_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  blind_spots: z.array(BlindSpotEntrySchema).min(1),
});

export type SeverityDefault = z.infer<typeof SeverityDefaultSchema>;
export type CurrentCoverage = z.infer<typeof CurrentCoverageSchema>;
export type BlindSpotEntry = z.infer<typeof BlindSpotEntrySchema>;
export type BlindSpotsCatalogue = z.infer<typeof BlindSpotsCatalogueSchema>;
