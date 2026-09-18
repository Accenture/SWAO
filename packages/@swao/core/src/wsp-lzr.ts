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

const LzrCheckCategorySchema = z.enum(['quota', 'policy', 'network', 'service', 'compliance']);

const LZBlockerItemSchema = z
  .object({
    check_id: z.string(),
    category: LzrCheckCategorySchema,
    service: z.string().optional(),
    description: z.string(),
    evidence: z.array(z.string()),
    remediation: z.string(),
    blocks_migration: z.boolean(),
  })
  .passthrough();

const LZWarningItemSchema = z
  .object({
    check_id: z.string(),
    category: LzrCheckCategorySchema,
    service: z.string().optional(),
    description: z.string(),
    evidence: z.array(z.string()),
    remediation: z.string().optional(),
  })
  .passthrough();

const LZServiceCheckSchema = z
  .object({
    service: z.string(),
    required: z.boolean(),
    available_in_lz: z.boolean(),
    provisioned_in_lz: z.boolean().nullable().optional(),
    version_compatible: z.boolean().nullable().optional(),
    status: z.enum(['ready', 'warning', 'blocked']),
    note: z.string().optional(),
  })
  .passthrough();

const LZQuotaCheckSchema = z
  .object({
    resource: z.string(),
    required: z.number().optional(),
    available: z.number().nullable().optional(),
    status: z.enum(['ok', 'warning', 'blocked']),
    note: z.string().optional(),
  })
  .passthrough();

const LZPolicyCheckSchema = z
  .object({
    check_id: z.string(),
    rule: z.string(),
    status: z.enum(['pass', 'fail', 'skipped']),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']).optional(),
    note: z.string().optional(),
  })
  .passthrough();

const LZNetworkCheckSchema = z
  .object({
    check_id: z.string(),
    description: z.string(),
    status: z.enum(['pass', 'fail', 'skipped']),
    note: z.string().optional(),
  })
  .passthrough();

export const LandingZoneReadinessResultSchema = z.object({
  provider_id: z.string(),
  landing_zone_id: z.string(),
  assessed_at: z.string(),
  ingestion_strategy: z.enum(['terraform', 'cloud_native', 'meshcloud']),
  blockers: z.array(LZBlockerItemSchema),
  warnings: z.array(LZWarningItemSchema),
  service_checks: z.array(LZServiceCheckSchema),
  quota_checks: z.array(LZQuotaCheckSchema),
  policy_checks: z.array(LZPolicyCheckSchema),
  network_checks: z.array(LZNetworkCheckSchema),
  overall_verdict: z.enum(['ready', 'blocked', 'advisory']),
  // #0479/#0480 (C-23): set by adapters to record which input path was used.
  input_type: z.enum(['snapshot', 'terraform', 'live_api', 'none']).optional(),
});

export type LandingZoneReadinessResult = z.infer<typeof LandingZoneReadinessResultSchema>;
export type LZBlockerItem = z.infer<typeof LZBlockerItemSchema>;
export type LZWarningItem = z.infer<typeof LZWarningItemSchema>;
export type LZServiceCheck = z.infer<typeof LZServiceCheckSchema>;
export type LZQuotaCheck = z.infer<typeof LZQuotaCheckSchema>;
export type LZPolicyCheck = z.infer<typeof LZPolicyCheckSchema>;
export type LZNetworkCheck = z.infer<typeof LZNetworkCheckSchema>;
