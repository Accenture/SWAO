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

// #4128 BC-06 (Design 123 section 17.4): `policy-guidance.yaml`, the guidance of
// the baseline consultation. A content file of the shipped Client LZ Policy
// Baseline folder, like service-controls.yaml: per policy the deciding
// question, the options (a parameter fragment of the policy's kind, optionally
// a state) with pros, cons and a source, and considerations. Per-kind entries
// are the fallback for client-added `X-` policies. The MCP tools read it from
// the bundled shipped baseline, never from the client copy (SWAO never updates
// the copy, D-07). Strict schema; the loader never throws.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { z } from 'zod';
import { RegimeIdSchema } from './regime-catalogue.js';
import { POLICY_KINDS, POLICY_PARAM_SCHEMAS, POLICY_STATES, SHIPPED_POLICY_ID_PATTERN, type Policy, type PolicyKind } from './policy-baseline.js';

export const POLICY_GUIDANCE_FILE = 'policy-guidance.yaml';

/** Review status of the guidance prose (Design 123 section 17.11, O-4: agent draft, owner review before release). */
export const POLICY_GUIDANCE_STATUSES = ['draft', 'reviewed'] as const;

const text = z.string().min(1).max(400);

export const PolicyGuidanceOptionSchema = z
  .object({
    /** Parameter fragment of the policy's kind (validated against the kind by the content guard and the tools). */
    params: z.record(z.string(), z.unknown()).default({}),
    /** A state this option sets, for example disabled. */
    state: z.enum(POLICY_STATES).optional(),
    summary: text,
    pros: z.array(text).min(1),
    cons: z.array(text).min(1),
    /** A citation in the form of default_source, or the literal `assumption`. */
    source: text,
  })
  .strict();

export const PolicyGuidanceEntrySchema = z
  .object({
    /** The deciding question for the stakeholders. */
    question: text,
    options: z.array(PolicyGuidanceOptionSchema).default([]),
    considerations: z.array(text).default([]),
  })
  .strict();

export const PolicyGuidanceSchema = z
  .object({
    schema_version: z.literal('0.1'),
    framework: RegimeIdSchema,
    status: z.enum(POLICY_GUIDANCE_STATUSES),
    /** Entries by shipped policy id (CPB-...). */
    policies: z.record(z.string().regex(SHIPPED_POLICY_ID_PATTERN, 'policy guidance keys are shipped policy ids (CPB-<CAT>-NN)'), PolicyGuidanceEntrySchema).default({}),
    /** Fallback entries by kind, for client-added policies. */
    kinds: z.partialRecord(z.enum(POLICY_KINDS), PolicyGuidanceEntrySchema).default({}),
  })
  .strict();

export type PolicyGuidanceOption = z.infer<typeof PolicyGuidanceOptionSchema>;
export type PolicyGuidanceEntry = z.infer<typeof PolicyGuidanceEntrySchema>;
export type PolicyGuidance = z.infer<typeof PolicyGuidanceSchema>;

export type PolicyGuidanceLoadResult =
  | { status: 'absent'; file: string; guidance: null; errors: [] }
  | { status: 'ok'; file: string; guidance: PolicyGuidance; errors: [] }
  | { status: 'invalid'; file: string; guidance: null; errors: string[] };

/** Option params that do not pass the kind's parameter schema (content guard; errors name the option). */
export function policyGuidanceOptionErrors(kind: PolicyKind, entry: PolicyGuidanceEntry, label: string): string[] {
  const schema = POLICY_PARAM_SCHEMAS[kind] as z.ZodType;
  return entry.options.flatMap((o, i) => {
    const r = schema.safeParse(o.params);
    return r.success ? [] : [`${label}.options.${i}.params: ${r.error.issues.map((x) => `${x.path.join('.') || '(root)'} ${x.message}`).join('; ')} (kind ${kind})`];
  });
}

/** Read `<frameworkDir>/policy-guidance.yaml`. Never throws. */
export function loadPolicyGuidance(frameworkDir: string, expectedFrameworkId?: string): PolicyGuidanceLoadResult {
  const file = join(frameworkDir, POLICY_GUIDANCE_FILE);
  try {
    if (!existsSync(file)) return { status: 'absent', file, guidance: null, errors: [] };
    let raw: unknown;
    try {
      raw = load(readFileSync(file, 'utf-8'));
    } catch (e) {
      return { status: 'invalid', file, guidance: null, errors: [`not valid YAML (${(e as Error).message.split('\n')[0]})`] };
    }
    const parsed = PolicyGuidanceSchema.safeParse(raw);
    if (!parsed.success) {
      return { status: 'invalid', file, guidance: null, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
    }
    if (expectedFrameworkId !== undefined && parsed.data.framework !== expectedFrameworkId) {
      return { status: 'invalid', file, guidance: null, errors: [`framework: "${parsed.data.framework}" does not match "${expectedFrameworkId}"`] };
    }
    return { status: 'ok', file, guidance: parsed.data, errors: [] };
  } catch (e) {
    return { status: 'invalid', file, guidance: null, errors: [`could not be read (${(e as Error).message.split('\n')[0]})`] };
  }
}

/**
 * The guidance entry of a policy: its own entry for a shipped id, else the
 * kind's fallback entry, else null ("no guidance shipped").
 */
export function policyGuidanceFor(guidance: PolicyGuidance | null, policy: Pick<Policy, 'id' | 'kind'>): { entry: PolicyGuidanceEntry; via: 'policy' | 'kind' } | null {
  if (!guidance) return null;
  const own = guidance.policies[policy.id];
  if (own) return { entry: own, via: 'policy' };
  const byKind = guidance.kinds[policy.kind];
  return byKind ? { entry: byKind, via: 'kind' } : null;
}
