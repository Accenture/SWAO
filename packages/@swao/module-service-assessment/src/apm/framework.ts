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
 * SWAO_APM framework loader (Design 103 §7, Q4, #3099, #3102).
 *
 * Active framework: the workspace copy installed under
 * `wsp/inputs/catalogs/community/swao-apm/` (engagement-specific weights) wins
 * over the bundled community framework. `domain_weights` and `time_rules` live
 * in `framework-meta.yaml` only (Design 103 Q4: no separate weights file).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { z } from 'zod';
import { communityFrameworksDir } from '@swao/community-frameworks';

export const APM_DOMAINS = ['APM-STR', 'APM-VND', 'APM-TCH', 'APM-SEC', 'APM-DAT', 'APM-SOV', 'APM-BIZ', 'APM-HW', 'APM-INT', 'APM-MIG', 'APM-REG'] as const;
export type ApmDomain = (typeof APM_DOMAINS)[number];
export const APM_FOLDER = 'swao-apm';

export const TimeRulesSchema = z.object({
  eliminate_operational_status: z.array(z.string()),
  migrate_critical: z.object({ kev_match: z.boolean(), cve_critical_min: z.number().int().min(1), eol_months_max: z.number() }),
  eol_past_without_extended_support: z.enum(['Eliminate', 'Migrate-Critical']),
  migrate: z.object({
    eol_months_min: z.number(), eol_months_max: z.number(),
    vendor_health_max: z.number(), technical_health_max: z.number(), migration_readiness_min: z.number(),
  }),
  invest: z.object({ strategic_fit_min: z.number(), technical_health_min: z.number(), vendor_health_min: z.number() }),
  eliminate: z.object({ strategic_fit_max: z.number(), business_criticality_max: z.number() }),
});
export type TimeRules = z.infer<typeof TimeRulesSchema>;

export const ApmMetaSchema = z.object({
  framework: z.object({
    id: z.literal('SWAO_APM'),
    version: z.string(),
    status: z.string(),
    assessment_type_scope: z.array(z.string()),
    domains: z.record(z.string(), z.string()),
    domain_weights: z.record(z.string(), z.number().int().nonnegative()).optional(),
    time_rules: TimeRulesSchema,
  }).passthrough(),
});

export const ApmControlSchema = z.object({
  id: z.string().regex(/^APM-[A-Z]+-\d{2}$/),
  title: z.string(),
  pillar: z.string().optional(),
  evidence_basis: z.array(z.record(z.string(), z.unknown())).default([]),
  tags: z.array(z.string()).default([]),
}).passthrough();

export interface ApmControl { id: string; title: string; domain: ApmDomain; rule: string | null; weight: number }

export interface ApmFramework {
  dir: string;
  source: 'workspace' | 'bundled';
  version: string;
  status: string;
  domainWeights: Record<ApmDomain, number>;
  /** True when framework-meta.yaml had no domain_weights key (equal defaults assumed). */
  weightsDefaulted: boolean;
  timeRules: TimeRules;
  controls: ApmControl[];
}

export class ApmFrameworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApmFrameworkError';
  }
}

export function apmFrameworkDir(workspacePath?: string): { dir: string; source: 'workspace' | 'bundled' } | null {
  if (workspacePath) {
    const ws = join(workspacePath, 'wsp', 'inputs', 'catalogs', 'community', APM_FOLDER);
    if (existsSync(join(ws, 'framework-meta.yaml'))) return { dir: ws, source: 'workspace' };
  }
  const bundled = join(communityFrameworksDir, APM_FOLDER);
  return existsSync(join(bundled, 'framework-meta.yaml')) ? { dir: bundled, source: 'bundled' } : null;
}

function readYaml(path: string): unknown {
  try {
    return load(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new ApmFrameworkError(`cannot read ${path}: ${(e as Error).message}`);
  }
}

export function loadApmFramework(opts: { workspacePath?: string; dir?: string } = {}): ApmFramework {
  const located = opts.dir ? { dir: opts.dir, source: 'workspace' as const } : apmFrameworkDir(opts.workspacePath);
  if (!located) throw new ApmFrameworkError('SWAO_APM framework not found (community-frameworks/swao-apm)');
  const meta = ApmMetaSchema.safeParse(readYaml(join(located.dir, 'framework-meta.yaml')));
  if (!meta.success) throw new ApmFrameworkError(`invalid SWAO_APM framework-meta.yaml: ${meta.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const fw = meta.data.framework;
  const raw = readYaml(join(located.dir, 'controls.yaml')) as { controls?: unknown[] } | null;
  const controls = (raw?.controls ?? []).map((c) => {
    const parsed = ApmControlSchema.safeParse(c);
    if (!parsed.success) throw new ApmFrameworkError(`invalid SWAO_APM control: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    const domain = parsed.data.id.slice(0, parsed.data.id.lastIndexOf('-')) as ApmDomain;
    if (!(APM_DOMAINS as readonly string[]).includes(domain)) throw new ApmFrameworkError(`control ${parsed.data.id}: unknown domain ${domain}`);
    const rule = parsed.data.evidence_basis.map((b) => b['apm_export']).find((v): v is string => typeof v === 'string') ?? null;
    const weightTag = parsed.data.tags.map((t) => /^apm-weight\.(\d+)$/.exec(t)?.[1]).find(Boolean);
    return { id: parsed.data.id, title: parsed.data.title, domain, rule, weight: weightTag ? Number(weightTag) : 1 };
  });
  const weightsDefaulted = !fw.domain_weights;
  const equal = Math.floor(100 / APM_DOMAINS.length);
  const domainWeights = Object.fromEntries(APM_DOMAINS.map((d) => [d, fw.domain_weights?.[d] ?? (weightsDefaulted ? equal : 0)])) as Record<ApmDomain, number>;
  return { dir: located.dir, source: located.source, version: fw.version, status: fw.status, domainWeights, weightsDefaulted, timeRules: fw.time_rules, controls };
}

/** Integer validation of domain_weights (Q4): every domain present, sum exactly 100. */
export function validateDomainWeights(weights: Record<string, unknown> | undefined): { errors: string[]; warnings: string[] } {
  if (!weights) return { errors: [], warnings: ['domain_weights not set in SWAO_APM framework-meta.yaml; equal weights assumed'] };
  const errors: string[] = [];
  const missing = APM_DOMAINS.filter((d) => !(d in weights));
  if (missing.length > 0) errors.push(`domain_weights missing domain(s): ${missing.join(', ')}`);
  const bad = Object.entries(weights).filter(([, v]) => !Number.isInteger(v) || (v as number) < 0).map(([k]) => k);
  if (bad.length > 0) errors.push(`domain_weights must be non-negative integers: ${bad.join(', ')}`);
  const sum = Object.values(weights).reduce<number>((a, v) => a + (Number.isInteger(v) ? (v as number) : 0), 0);
  if (sum !== 100) errors.push(`domain_weights sum to ${sum}, expected 100`);
  return { errors, warnings: [] };
}
