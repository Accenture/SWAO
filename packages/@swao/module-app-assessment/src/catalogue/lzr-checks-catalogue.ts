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

import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The catalogue lives at `swao/controls/landing-zone-checks-catalogue.yaml`.
// Reaching it depends on the runtime layout. Since this catalogue moved into
// @swao/module-app-assessment (#0548), the package nests one level deeper than
// @swao/swao, so the dev paths are 5 levels up; the bundle collapses into
// swao's bundle.cjs at 3 levels up. Try each candidate and use the first
// that exists (mirrors the resolver pattern in pass-13-scope.ts).
function resolveCataloguePath(): string {
  const candidates = [
    resolve(__dirname, '../../../../../controls/landing-zone-checks-catalogue.yaml'),
    resolve(__dirname, '../../../../controls/landing-zone-checks-catalogue.yaml'),
    resolve(__dirname, '../../../controls/landing-zone-checks-catalogue.yaml'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] as string;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const LzrCheckSeveritySchema = z.enum(['blocker', 'warning', 'info']);
const LzrCheckCategorySchema = z.enum(['service', 'quota', 'policy', 'network', 'compliance']);

const LzrCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: LzrCheckCategorySchema,
  severity: LzrCheckSeveritySchema,
  providers: z.union([z.literal('all'), z.array(z.string())]),
  description: z.string(),
  rationale: z.string().optional(),
  remediation: z.string().optional(),
  terraform_resource_types: z.array(z.string()).optional(),
  pulumi_resource_types: z.array(z.string()).optional(),
  checkov_rule_ids: z.array(z.string()).optional(),
  // Service codes from service_dep:* signal implies tags that trigger this check
  // when evaluating a source-environment tfstate (no target provider resources present).
  service_dep_codes: z.array(z.string()).optional(),
});

const CatalogueFileSchema = z.object({
  version: z.string(),
  schema: z.string(),
  checks: z.array(LzrCheckSchema),
});

export type LzrCheck = z.infer<typeof LzrCheckSchema>;
export type LzrCheckSeverity = z.infer<typeof LzrCheckSeveritySchema>;
export type LzrCheckCategory = z.infer<typeof LzrCheckCategorySchema>;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

let _cached: LzrCheck[] | null = null;

export function loadLzrChecksCatalogue(): LzrCheck[] {
  if (_cached) return _cached;

  const raw = load(readFileSync(resolveCataloguePath(), 'utf-8')) as unknown;
  const parsed = CatalogueFileSchema.parse(raw);
  _cached = parsed.checks;
  return _cached;
}

export function getChecksForProvider(providerId: string): LzrCheck[] {
  const all = loadLzrChecksCatalogue();
  return all.filter((c) => c.providers === 'all' || (c.providers as string[]).includes(providerId));
}

export function getChecksByCategory(category: LzrCheckCategory): LzrCheck[] {
  const all = loadLzrChecksCatalogue();
  return all.filter((c) => c.category === category);
}

export function getBlockerChecks(providerId?: string): LzrCheck[] {
  const checks = providerId ? getChecksForProvider(providerId) : loadLzrChecksCatalogue();
  return checks.filter((c) => c.severity === 'blocker');
}
