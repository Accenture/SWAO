// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Analytics domain blocklist loader for DYN-06 (#1268)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Loads swao/controls/dynamic-analysis/analytics-domains.yaml at runtime.
// Operators can update the blocklist without a binary rebuild (#1268).

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { z } from 'zod';

const AnalyticsDomainSchema = z.object({
  domain: z.string().min(1),
  category: z.string().min(1),
  severity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});

export const AnalyticsBlocklistSchema = z.object({
  version: z.string(),
  description: z.string(),
  updated: z.string(),
  domains: z.array(AnalyticsDomainSchema),
});

export type AnalyticsDomain = z.infer<typeof AnalyticsDomainSchema>;
export type AnalyticsBlocklist = z.infer<typeof AnalyticsBlocklistSchema>;

// Resolve the canonical blocklist path relative to the swao package root.
// In the binary (pkg snapshot), controls/ is bundled at the same relative
// location as in the repo: swao/controls/dynamic-analysis/.
function resolveBlocklistPath(): string {
  // Walk up from this file (packages/@swao/module-app-assessment/src/passes/phase2/)
  // to the repo root, then into controls/dynamic-analysis/.
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // dev: src/passes/phase2 -> ../../../../.. -> swao/
  const swaoRoot = join(thisDir, '..', '..', '..', '..', '..', '..');
  return join(swaoRoot, 'controls', 'dynamic-analysis', 'analytics-domains.yaml');
}

let _cachedBlocklist: AnalyticsBlocklist | null = null;

export function loadAnalyticsBlocklist(customPath?: string): AnalyticsBlocklist {
  if (_cachedBlocklist && !customPath) return _cachedBlocklist;

  const filePath = customPath ?? resolveBlocklistPath();
  if (!existsSync(filePath)) {
    return { version: '0.0', description: 'empty', updated: '', domains: [] };
  }

  const raw = load(readFileSync(filePath, 'utf-8'));
  const parsed = AnalyticsBlocklistSchema.parse(raw);
  if (!customPath) _cachedBlocklist = parsed;
  return parsed;
}

export function getAnalyticsDomainSet(customPath?: string): Set<string> {
  const blocklist = loadAnalyticsBlocklist(customPath);
  return new Set(blocklist.domains.map((d) => d.domain));
}
