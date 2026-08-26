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

/**
 * LZ scan result (Design 056 Layer B) -- the normalised inventory of what a
 * customer's real landing zone has ENABLED and CONFIGURED, produced by any
 * collection mode (IaC, config-export, or live read-only API scan). One shape
 * regardless of how it was collected, so the fit engine (Layer C) consumes it
 * uniformly.
 *
 * `confidence`: `declared` (from IaC -- may drift from reality) vs `observed`
 * (from a config export or live scan -- the actual deployed state).
 */

export const LzEnabledServiceSchema = z.object({
  /** Normalised service code, aligned with the catalogue (e.g. "eks", "Microsoft.DBforPostgreSQL/flexibleServers"). */
  code: z.string().min(1),
  /** True when at least one instance is provisioned + running. */
  provisioned: z.boolean(),
  /** Abstract capability keys this enabled service fulfils (e.g. ["kubernetes"]),
   *  so the fit engine can match the app's CSP-agnostic needs without relying on
   *  exact code equality between scan + catalogue. */
  fulfills: z.array(z.string()).default([]),
  /** Number of instances found, if known. */
  count: z.number().int().nonnegative().optional(),
  /** Deployed version, if known. */
  version: z.string().optional(),
  status: z.string().optional(),
}).strict();

export const LzGuardrailSchema = z.object({
  /** e.g. "config-rule", "azure-policy", "scp". */
  type: z.string(),
  id: z.string().optional(),
  status: z.enum(['pass', 'fail', 'unknown']),
  detail: z.string().optional(),
}).strict();

export const LzQuotaSchema = z.object({
  resource: z.string(),
  remaining: z.number().optional(),
}).strict();

export const LzScanResultSchema = z.object({
  provider: z.string().min(1),
  collection_mode: z.enum(['iac', 'export', 'live']),
  confidence: z.enum(['declared', 'observed']),
  scanned_at: z.string(),
  regions: z.array(z.string()).default([]),
  enabled_services: z.array(LzEnabledServiceSchema).default([]),
  guardrails: z.array(LzGuardrailSchema).default([]),
  quotas: z.array(LzQuotaSchema).default([]),
  /** Detected LZ framework, e.g. "aws-control-tower", "azure-landing-zones". */
  lz_framework: z.string().optional(),
  provenance: z.object({
    source: z.string(),
    fabricated: z.boolean().optional(),
  }),
}).strict();

export type LzEnabledService = z.infer<typeof LzEnabledServiceSchema>;
export type LzGuardrail = z.infer<typeof LzGuardrailSchema>;
export type LzQuota = z.infer<typeof LzQuotaSchema>;
export type LzScanResult = z.infer<typeof LzScanResultSchema>;

export function parseLzScanResult(raw: unknown): LzScanResult {
  return LzScanResultSchema.parse(raw);
}

/** Is a service provisioned (enabled + running) in the scanned LZ? */
export function scanHasService(scan: LzScanResult, code: string): boolean {
  return scan.enabled_services.some((s) => s.code === code && s.provisioned);
}

/** Does the scanned LZ have a provisioned service that fulfils the abstract
 *  capability key (e.g. "kubernetes")? Strips @version and +capability qualifiers
 *  before matching -- version/capability verification is catalogue-driven. */
export function scanFulfills(scan: LzScanResult, capability: string): boolean {
  const atIdx = capability.indexOf('@');
  const plusIdx = capability.indexOf('+');
  const base = atIdx !== -1 ? capability.slice(0, atIdx)
             : plusIdx !== -1 ? capability.slice(0, plusIdx)
             : capability;
  return scan.enabled_services.some((s) => s.provisioned && s.fulfills.includes(base));
}
