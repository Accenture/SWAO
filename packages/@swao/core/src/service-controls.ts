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

// Service-to-control mapping per community framework (#3577, Design 120 §8.2,
// owner decisions Q-04, Q-05, Q-23). One `service-controls.yaml` per framework
// folder, next to framework-meta.yaml, keyed by SWAO capability tags (the
// `fulfills` vocabulary of the LZ catalogues, lz-service-catalogue.ts), never
// by CSP service codes, so one mapping serves every CSP and the on-prem case.
//
// Capability tags are validated for syntax only. The vocabulary is data, not a
// closed enum (LzServiceSchema.fulfills is a free string list): which tags are
// "in use" depends on the catalogues a workspace resolves, so a tag that no
// catalogue uses is reported by the coverage function, not rejected here.
//
// A capability without a mapping is grey, never green (ADR-0041): see
// serviceMappingStatus().

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { z } from 'zod';
import { RegimeIdSchema } from './regime-catalogue.js';

export const SERVICE_CONTROLS_FILE = 'service-controls.yaml';

/** SWAO capability tag syntax: every tag in the bundled LZ catalogues is snake_case. */
export const CapabilityTagSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'capability tag must be snake_case (e.g. key_vault)');

export const ServiceControlMappingSchema = z.object({
  capability: CapabilityTagSchema,
  /** Control ids of the framework (controls.yaml) this capability bears on. */
  controls: z.array(z.string().min(1)).default([]),
  /** supports: the capability helps meet the controls; configure: it meets them
   *  only when configured accordingly; n/a: the framework does not apply. */
  relevance: z.enum(['supports', 'configure', 'n/a']),
  /** derived: drafted (for example with LLM assistance), not yet reviewed;
   *  curated: human-reviewed (Q-23). */
  confidence: z.enum(['derived', 'curated']),
  source: z.string().min(1).optional(),
}).strict().superRefine((m, ctx) => {
  if (m.relevance !== 'n/a' && m.controls.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['controls'], message: `relevance "${m.relevance}" needs at least one control` });
  }
});

export const ServiceControlsSchema = z.object({
  schema_version: z.literal('0.1'),
  /** framework.id from the sibling framework-meta.yaml (RegimeId, e.g. BSI_C5). */
  framework: RegimeIdSchema,
  mappings: z.array(ServiceControlMappingSchema).default([]),
}).strict().superRefine((doc, ctx) => {
  const seen = new Set<string>();
  doc.mappings.forEach((m, i) => {
    if (seen.has(m.capability)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mappings', i, 'capability'], message: `duplicate capability "${m.capability}"` });
    }
    seen.add(m.capability);
  });
});

export type ServiceControlMapping = z.infer<typeof ServiceControlMappingSchema>;
export type ServiceControls = z.infer<typeof ServiceControlsSchema>;

export type ServiceControlsLoadResult =
  /** No service-controls.yaml: the framework has no mapping (every capability grey). */
  | { status: 'absent'; file: string; mapping: null; errors: [] }
  | { status: 'ok'; file: string; mapping: ServiceControls; errors: [] }
  | { status: 'invalid'; file: string; mapping: null; errors: string[] };

/**
 * Read `<frameworkDir>/service-controls.yaml`. Never throws. `expectedFrameworkId`
 * is the framework.id of the folder's framework-meta.yaml; a file that names a
 * different framework is invalid. Callers pass framework folders of the
 * workspace community catalogue only (Design 120 §8.1).
 */
export function loadServiceControls(frameworkDir: string, expectedFrameworkId?: string): ServiceControlsLoadResult {
  const file = join(frameworkDir, SERVICE_CONTROLS_FILE);
  if (!existsSync(file)) return { status: 'absent', file, mapping: null, errors: [] };
  let raw: unknown;
  try {
    raw = load(readFileSync(file, 'utf-8'));
  } catch (e) {
    return { status: 'invalid', file, mapping: null, errors: [`not valid YAML (${(e as Error).message.split('\n')[0]})`] };
  }
  const parsed = ServiceControlsSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', file, mapping: null, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  if (expectedFrameworkId !== undefined && parsed.data.framework !== expectedFrameworkId) {
    return { status: 'invalid', file, mapping: null, errors: [`framework: "${parsed.data.framework}" does not match framework-meta.yaml id "${expectedFrameworkId}"`] };
  }
  return { status: 'ok', file, mapping: parsed.data, errors: [] };
}

export interface ServiceMappingCoverage {
  /** Number of distinct capability tags in use. */
  in_use: number;
  /** In-use tags that have a mapping. */
  mapped: number;
  /** In-use tags without a mapping (grey), sorted. */
  unmapped: string[];
  /** Mapped tags that no resolved catalogue uses (possible typo or other CSP), sorted. */
  unused_mappings: string[];
}

/** Coverage of one framework mapping against the capability tags in use (Design 120 §8.2). */
export function computeServiceMappingCoverage(mapping: ServiceControls | null, tagsInUse: Iterable<string>): ServiceMappingCoverage {
  const inUse = [...new Set(tagsInUse)].sort();
  const mappedTags = new Set((mapping?.mappings ?? []).map((m) => m.capability));
  const unmapped = inUse.filter((t) => !mappedTags.has(t));
  const inUseSet = new Set(inUse);
  return {
    in_use: inUse.length,
    mapped: inUse.length - unmapped.length,
    unmapped,
    unused_mappings: [...mappedTags].filter((t) => !inUseSet.has(t)).sort(),
  };
}

/** Mapping state of a service from its capability tags (input to the lights of Design 120 §8.3). */
export type ServiceMappingStatus = 'grey' | 'n/a' | 'mapped';

/**
 * grey: no mapping for any of the service's capability tags (including a
 * service without tags); n/a: every mapped relevance is n/a; mapped: at least
 * one mapping applies. Never returns a "green": the full light needs findings,
 * IaC level and sovereignty (Design 120 §8.3).
 */
export function serviceMappingStatus(mapping: ServiceControls | null, capabilityTags: readonly string[]): ServiceMappingStatus {
  const byTag = new Map((mapping?.mappings ?? []).map((m) => [m.capability, m] as const));
  const hits = capabilityTags.map((t) => byTag.get(t)).filter((m): m is ServiceControlMapping => m !== undefined);
  if (hits.length === 0) return 'grey';
  return hits.every((m) => m.relevance === 'n/a') ? 'n/a' : 'mapped';
}
