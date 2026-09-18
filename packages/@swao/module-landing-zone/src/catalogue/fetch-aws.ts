// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { LzServiceCatalogue, LzRegion, LzSovereigntyFacts } from '@swao/core';

/**
 * AWS catalogue fetcher (Design 056 §4.1, #0565). AWS publishes its
 * service-by-region matrix as SSM public parameters:
 *   /aws/service/global-infrastructure/regions/<region>/services/<service>
 *
 * The refresh is operator-fed (no SDK/creds held by SWAO, matching the scan
 * ethos): the operator runs
 *   aws ssm get-parameters-by-path \
 *     --path /aws/service/global-infrastructure/services --recursive   (and per-region)
 * and passes the JSON dump to `swao lz catalogue update --provider aws --from <dump>`.
 * This module's job is the NORMALISATION of that dump into LzServiceCatalogue.
 * A live-SDK transport is a thin premium add (see registerLzCatalogue).
 *
 * SSM gives AVAILABILITY only. Sovereignty FACTS (D-LZ-07) are a curated overlay
 * keyed by region id -- merged here, never invented.
 */

/** One raw SSM parameter as returned by get-parameters-by-path. */
export interface SsmParameter {
  Name: string;
  Value?: string;
}

/** Curated, per-region overlay: facts SSM cannot provide. */
export interface AwsRegionOverlay {
  display?: string;
  country?: string;
  sovereignty?: LzSovereigntyFacts;
}

const REGION_SVC_RE =
  /^\/aws\/service\/global-infrastructure\/regions\/([a-z0-9-]+)\/services\/([a-z0-9-]+)$/;

/**
 * Normalise a list of SSM region-service parameters into an LzServiceCatalogue.
 * `overlay` supplies curated region metadata + sovereignty facts (availability
 * comes from SSM; facts come from the overlay).
 */
export function normalizeAwsSsmCatalogue(
  params: SsmParameter[],
  opts: { lastUpdated: string; overlay?: Record<string, AwsRegionOverlay>; operator?: string },
): LzServiceCatalogue {
  const byRegion = new Map<string, Set<string>>();
  for (const p of params) {
    const m = REGION_SVC_RE.exec(p.Name);
    if (!m) continue;
    const [, region, service] = m;
    if (!byRegion.has(region)) byRegion.set(region, new Set());
    byRegion.get(region)!.add(service);
  }

  const overlay = opts.overlay ?? {};
  const regions: LzRegion[] = [...byRegion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, services]) => {
      const ov = overlay[id] ?? {};
      return {
        id,
        display: ov.display,
        country: ov.country,
        sovereignty: ov.sovereignty,
        services: [...services].sort().map((code) => ({
          code,
          status: 'ga' as const,
          capabilities: [],
          // SSM gives availability, not capability classification. fulfills is
          // enriched by the curated overlay / a later capability-mapping step.
          fulfills: [],
          key_custody: [],
          last_verified: opts.lastUpdated,
          source: 'ssm',
        })),
      };
    });

  return {
    meta: {
      schema_version: '0.1',
      name: 'AWS service catalogue',
      provider: 'aws',
      last_updated: opts.lastUpdated,
      source: { mode: 'api', tool: 'ssm-global-infrastructure', operator: opts.operator },
      confidence: 'high',
      regions_count: regions.length,
    },
    regions,
  };
}
