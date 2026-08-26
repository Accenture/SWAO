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

import { existsSync, readFileSync } from 'node:fs';
import type { LzServiceCatalogue, LzRegion, LzSovereigntyFacts } from '@swao/core';

/**
 * Azure catalogue fetcher (Design 056 §4.2, #0565). Azure availability comes
 * from the "products available by region" dataset + the resource-provider
 * locations SKU APIs (Microsoft.Compute, Microsoft.Storage, ...). As with AWS,
 * refresh is operator-fed: the operator produces an
 * availability dump (flattened to {region, service} rows) and passes it to
 * `swao lz catalogue update --provider azure --from <dump>`; a live-SDK
 * transport (Resource Graph / SKUs) is a thin premium add.
 *
 * Availability comes from the dump; sovereignty FACTS (D-LZ-07) come from the
 * curated per-region overlay.
 */

/** Flattened availability row (one service available in one region). */
export interface AzureAvailabilityRow {
  region: string;
  service: string;
  serviceName?: string;
}

export interface AzureRegionOverlay {
  display?: string;
  country?: string;
  sovereignty?: LzSovereigntyFacts;
}

export function normalizeAzureProducts(
  rows: AzureAvailabilityRow[],
  opts: { lastUpdated: string; overlay?: Record<string, AzureRegionOverlay>; operator?: string },
): LzServiceCatalogue {
  const byRegion = new Map<string, Map<string, string | undefined>>();
  for (const r of rows) {
    if (!r.region || !r.service) continue;
    if (!byRegion.has(r.region)) byRegion.set(r.region, new Map());
    byRegion.get(r.region)!.set(r.service, r.serviceName);
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
        services: [...services.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([code, name]) => ({
            code,
            name,
            status: 'ga' as const,
            capabilities: [],
            // products-by-region gives availability, not capability mapping;
            // fulfills is enriched by the curated overlay / a later step.
            fulfills: [],
            key_custody: [],
            last_verified: opts.lastUpdated,
            source: 'products-by-region',
          })),
      };
    });

  return {
    meta: {
      schema_version: '0.1',
      name: 'Azure service catalogue',
      provider: 'azure',
      last_updated: opts.lastUpdated,
      source: { mode: 'api', tool: 'products-by-region', operator: opts.operator },
      confidence: 'high',
      regions_count: regions.length,
    },
    regions,
  };
}

// ---------------------------------------------------------------------------
// Live Azure Retail Prices API transport (Design 056 §4.2, #0688)
//
// Primary:  Azure Retail Prices API (fully anonymous, no credentials required).
//           https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview
// Override: pricesPathOverride -- local JSON file with the same shape as one
//           API page (Items + optional NextPageLink); intended for CI /
//           testing / air-gapped environments.
//
// Premium gate: NOT applied here. The caller (lz-premium.ts registerLzCatalogueUpdate)
// holds the LicenseGuard.requireTier('consultant') gate. This function is a
// pure HTTP + normalise transport.
// ---------------------------------------------------------------------------

/** Public Azure Retail Prices API endpoint (no authentication required). */
export const AZURE_RETAIL_PRICES_URL =
  'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview';

const AZURE_MAX_PAGES = 500;

interface AzureRetailItem {
  serviceName: string;
  armRegionName: string;
}

interface AzureRetailPage {
  Items?: AzureRetailItem[];
  NextPageLink?: string | null;
}

/**
 * Options for fetchAzureCatalogue (Design 056 §4.2, #0688).
 */
export interface FetchAzureCatalogueOpts {
  /**
   * Local JSON file override (one Azure Retail Prices API page shape:
   * {Items?: [...], NextPageLink?: string | null}).
   * When supplied the live API is not called; intended for CI / testing /
   * air-gapped environments.
   */
  pricesPathOverride?: string;
  /**
   * Curated per-region sovereignty + display overlay (D-LZ-07).
   * Regions absent from the overlay will have sovereignty: undefined in the
   * returned catalogue; callers should apply a default if needed.
   */
  overlay?: Record<string, AzureRegionOverlay>;
  /** Operator tag written into meta.source.operator. */
  operator?: string;
  /** ISO-date string for meta.last_updated. Defaults to today (UTC). */
  lastUpdated?: string;
}

/**
 * Fetch the Azure Retail Prices API and normalise the response into an
 * LzServiceCatalogue (Design 056 §4.2, #0688).
 *
 * Authentication: none. The Azure Retail Prices API is fully public.
 * Pagination: follows NextPageLink until exhausted or AZURE_MAX_PAGES is reached.
 * Deduplication: each (region, serviceName) pair is counted at most once across
 * all pages.
 *
 * The returned catalogue has fulfills=[] and key_custody=[] on each service.
 * The caller is responsible for enriching these from a capability vocabulary
 * (see AZURE_SERVICE_FULFILLS in lz-premium.ts).
 *
 * Not premium-gated -- the gate is enforced by the CLI caller (lz-premium.ts).
 */
export async function fetchAzureCatalogue(
  opts: FetchAzureCatalogueOpts = {},
): Promise<LzServiceCatalogue> {
  const { pricesPathOverride, overlay, operator } = opts;
  const today = opts.lastUpdated ?? new Date().toISOString().slice(0, 10);

  // region -> Set<serviceName> deduplication map
  const seen = new Map<string, Set<string>>();

  if (pricesPathOverride) {
    if (!existsSync(pricesPathOverride)) {
      throw new Error(
        `fetchAzureCatalogue: azure prices file not found: ${pricesPathOverride}`,
      );
    }
    const payload = JSON.parse(
      readFileSync(pricesPathOverride, 'utf-8'),
    ) as AzureRetailPage;
    for (const item of payload.Items ?? []) {
      if (!item.serviceName || !item.armRegionName) continue;
      if (!seen.has(item.armRegionName)) seen.set(item.armRegionName, new Set());
      seen.get(item.armRegionName)!.add(item.serviceName);
    }
  } else {
    let nextUrl: string | null = AZURE_RETAIL_PRICES_URL;
    let pageCount = 0;
    let retriesThisPage = 0;
    const MAX_RETRIES_PER_PAGE = 5;
    while (nextUrl && pageCount < AZURE_MAX_PAGES) {
      pageCount++;
      const resp = await fetch(nextUrl, {
        headers: { 'User-Agent': 'swao-lz-catalogue-refresh/0.1' },
        signal: AbortSignal.timeout(60_000),
      });
      if (resp.status === 429) {
        if (retriesThisPage >= MAX_RETRIES_PER_PAGE) {
          throw new Error(
            `fetchAzureCatalogue: Azure Retail Prices API continued to rate-limit after ` +
            `${MAX_RETRIES_PER_PAGE} retries at page ${pageCount} (${nextUrl})`,
          );
        }
        retriesThisPage++;
        pageCount--; // don't consume a page slot for the throttled attempt
        const retryAfterHeader = resp.headers.get('Retry-After');
        const retryAfterMs = resp.headers.get('x-ms-retry-after-ms');
        const waitSecs = retryAfterHeader
          ? Math.min(parseInt(retryAfterHeader, 10) || 60, 300)
          : retryAfterMs
            ? Math.min(Math.ceil(parseInt(retryAfterMs, 10) / 1_000) || 60, 300)
            : 60;
        console.warn(
          `[warn] fetchAzureCatalogue: 429 rate-limit at page ${pageCount + 1}, ` +
          `retry ${retriesThisPage}/${MAX_RETRIES_PER_PAGE} -- waiting ${waitSecs}s`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, waitSecs * 1_000));
        continue;
      }
      retriesThisPage = 0; // reset per-page retry budget on a successful response
      if (!resp.ok) {
        throw new Error(
          `fetchAzureCatalogue: Azure Retail Prices API returned HTTP ${resp.status} ${resp.statusText} ` +
          `from ${nextUrl}`,
        );
      }
      const payload = (await resp.json()) as AzureRetailPage;
      for (const item of payload.Items ?? []) {
        if (!item.serviceName || !item.armRegionName) continue;
        if (!seen.has(item.armRegionName)) seen.set(item.armRegionName, new Set());
        seen.get(item.armRegionName)!.add(item.serviceName);
      }
      nextUrl = payload.NextPageLink ?? null;
    }
    if (pageCount >= AZURE_MAX_PAGES && nextUrl) {
      console.warn(
        `[warn] fetchAzureCatalogue: Azure Retail Prices page cap (${AZURE_MAX_PAGES}) reached -- ` +
        'some data may be missing. Raise AZURE_MAX_PAGES if needed.',
      );
    }
  }

  const rows: AzureAvailabilityRow[] = [];
  for (const [region, serviceNames] of seen) {
    for (const serviceName of serviceNames) {
      rows.push({ region, service: serviceName, serviceName });
    }
  }

  return normalizeAzureProducts(rows, { lastUpdated: today, overlay, operator });
}
