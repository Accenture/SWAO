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
 * STACKIT catalogue normalizer (Design 056 §4.4, #0871).
 *
 * STACKIT PIM API (pim.api.stackit.cloud/v1/skus) returns an unauthenticated
 * JSON payload with one SKU entry per service+region combination. This module
 * normalizes that payload into the standard LzServiceCatalogue shape.
 *
 * Availability comes from the PIM API; sovereignty FACTS (D-LZ-07) come from
 * the hard-coded STACKIT_REGION_OVERLAY (fixed for STACKIT -- they do not
 * change per-service).
 *
 * Fallback: if pim.api.stackit.cloud/v1/skus begins requiring auth in future,
 * fall back to the stackitcloud/stackit-api-specifications GitHub service
 * directory for canonical service names, hand-curate region availability, and
 * lower confidence to "low" with source mode "curated".
 */

// ---------------------------------------------------------------------------
// PIM API response types
// ---------------------------------------------------------------------------

/** One SKU entry from the STACKIT PIM API response. */
export interface StackitSku {
  product: string;
  region: string;              // 'eu01' | 'eu02' | 'global'
  deprecated: string;          // 'Yes' | 'No' (string, not boolean)
  maturityModelState: string;  // 'ga' | 'beta' | 'deprecated'
  [key: string]: unknown;
}

/** Top-level PIM API response envelope. */
export interface StackitPimResponse {
  lastUpdatedAt?: string;
  services: StackitSku[];
}

// ---------------------------------------------------------------------------
// Service -> SWAO capability vocabulary (Design 056 D-LZ-08).
// Keys are the exact `product` strings returned by the PIM API.
// ---------------------------------------------------------------------------
export const STACKIT_SERVICE_FULFILLS: Record<string, string[]> = {
  'AI Model Serving':           ['ml_inference'],
  'Application Load Balancer':  ['load_balancer'],
  'Archiving':                  ['backup'],
  'Backup Storage':             ['backup'],
  'Block Storage':              ['block_storage'],
  'CDN':                        ['cdn'],
  'Cloud Foundry':              ['paas_compute'],
  'Confidential Kubernetes':    ['kubernetes'],
  'Confidential Server':        ['vm_compute'],
  'Container Registry':         ['container_registry'],
  'DNS':                        ['dns'],
  'Dremio':                     ['data_analytics'],
  'Edge Cloud':                 ['cdn'],
  'File Storage':               ['file_storage'],
  'Git':                        ['vcs'],
  'GPU Server':                 ['gpu_compute'],
  'Intake':                     ['event_streaming'],
  'Key Value Store':            ['redis'],
  'KMS':                        ['key_vault'],
  'Kubernetes Engine':          ['kubernetes'],
  'LogMe':                      ['log_management'],
  'Logs':                       ['log_management'],
  'MariaDB':                    ['mariadb'],
  'MongoDB Flex':               ['nosql_database'],
  'Network Load Balancer':      ['load_balancer'],
  'Object Storage':             ['object_storage'],
  'Observability':              ['monitoring', 'metrics'],
  'OpenSearch':                 ['search'],
  'Pipelines':                  ['ci_cd'],
  'PostgreSQL Flex':            ['postgresql'],
  'Public IP Address':          ['networking'],
  'RabbitMQ':                   ['messaging', 'queue'],
  'Red Hat Enterprise Linux':   ['vm_compute'],
  'Redis':                      ['redis'],
  'Secrets Manager':            ['secrets_management'],
  'Server':                     ['vm_compute'],
  'Server Backup Management':   ['backup'],
  'Server Update Management':   ['systems_management'],
  'ServiceNow':                 ['itsm'],
  'SQLServer Flex':             ['sql_server'],
  'Telemetry Router':           ['monitoring'],
  'VPN':                        ['vpn'],
  'Windows Server':             ['vm_compute'],
  'Workflows':                  ['serverless_compute'],
};

// ---------------------------------------------------------------------------
// Service capability tags for specific products (#1318 postgresql enrichment).
// Keys are the exact `product` strings returned by the PIM API.
// Tags: pgaudit_supported -- service is known to support the pgaudit extension.
// ---------------------------------------------------------------------------
export const STACKIT_SERVICE_CAPABILITIES: Record<string, string[]> = {
  'PostgreSQL Flex': ['pgaudit_supported'],
};

// Highest supported major version per product (#1323 semantic version matching).
export const STACKIT_SERVICE_MAX_VERSIONS: Record<string, number> = {
  'PostgreSQL Flex': 17,
};

// ---------------------------------------------------------------------------
// Region sovereignty overlay (D-LZ-07).
// STACKIT has two service regions; facts are fixed per region.
// ---------------------------------------------------------------------------
interface StackitRegionOverlay {
  display: string;
  country: string;
  sovereignty: LzSovereigntyFacts;
}

export const STACKIT_REGION_OVERLAY: Record<string, StackitRegionOverlay> = {
  eu01: {
    display: 'STACKIT eu01 (Germany)',
    country: 'DE',
    sovereignty: {
      residency_country: 'DE',
      operator_jurisdiction: 'EU-entity',
      extraterritorial_exposure: [],
      certifications: ['BSI_C5', 'ISO_27001'],
    },
  },
  eu02: {
    display: 'STACKIT eu02 (Austria)',
    country: 'AT',
    sovereignty: {
      residency_country: 'AT',
      operator_jurisdiction: 'EU-entity',
      extraterritorial_exposure: [],
      certifications: ['ISO_27001'],
    },
  },
};

// ---------------------------------------------------------------------------
// Key-custody heuristic (per service product name)
// ---------------------------------------------------------------------------
function keyCustodyFor(product: string): string[] {
  if (product === 'KMS') return ['provider-managed', 'byok', 'hyok'];
  if (product === 'Object Storage' || product === 'Block Storage' || product === 'PostgreSQL Flex') {
    return ['provider-managed', 'byok'];
  }
  return ['provider-managed'];
}

// ---------------------------------------------------------------------------
// Slugify: product name -> stable service code
// ---------------------------------------------------------------------------
export function slugifyProductName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// LZ status mapping
// ---------------------------------------------------------------------------
type LzStatus = 'ga' | 'preview';

function lzStatus(mms: string): LzStatus {
  return mms === 'ga' ? 'ga' : 'preview';
}

// ---------------------------------------------------------------------------
// normalizeStackitSkus
// ---------------------------------------------------------------------------

export interface StackitNormalizeOpts {
  lastUpdated: string;
  operator?: string;
}

/**
 * Normalize a STACKIT PIM API SKU list into an LzServiceCatalogue.
 *
 * Rules:
 *  1. Filter out SKUs where deprecated === 'Yes' or maturityModelState === 'deprecated'.
 *  2. Expand region === 'global' to both eu01 and eu02.
 *  3. Deduplicate: each product appears at most once per region (taking the
 *     most mature status: 'ga' beats 'beta').
 *  4. Map product names to fulfills tags via STACKIT_SERVICE_FULFILLS.
 *  5. Apply STACKIT_REGION_OVERLAY for sovereignty facts.
 */
export function normalizeStackitSkus(
  skus: StackitSku[],
  opts: StackitNormalizeOpts,
): LzServiceCatalogue {
  const { lastUpdated, operator = 'SWAO operator' } = opts;

  // Step 1: filter deprecated
  const active = skus.filter(
    (s) => s.deprecated !== 'Yes' && s.maturityModelState !== 'deprecated',
  );

  // Step 2+3: expand global -> both regions, deduplicate, track best maturity
  const regionProducts = new Map<string, Map<string, string>>();
  // initialise known regions
  for (const regionId of Object.keys(STACKIT_REGION_OVERLAY)) {
    regionProducts.set(regionId, new Map());
  }

  for (const s of active) {
    const targetRegions = s.region === 'global'
      ? Object.keys(STACKIT_REGION_OVERLAY)
      : [s.region];

    for (const regionId of targetRegions) {
      if (!regionProducts.has(regionId)) continue;
      const map = regionProducts.get(regionId)!;
      const current = map.get(s.product);
      // ga beats anything else
      if (!current || (current !== 'ga' && s.maturityModelState === 'ga')) {
        map.set(s.product, s.maturityModelState);
      }
    }
  }

  // Step 4+5: build region entries
  const regions: LzRegion[] = [...regionProducts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([regionId, productMap]) => {
      const ov = STACKIT_REGION_OVERLAY[regionId]!;
      const services = [...productMap.entries()]
        .sort(([a], [b]) => slugifyProductName(a).localeCompare(slugifyProductName(b)))
        .map(([product, mms]) => ({
          code:          slugifyProductName(product),
          name:          product,
          status:        lzStatus(mms) as 'ga' | 'preview' | 'announced' | 'retired',
          capabilities:  STACKIT_SERVICE_CAPABILITIES[product] ?? [],
          fulfills:      STACKIT_SERVICE_FULFILLS[product] ?? [],
          key_custody:   keyCustodyFor(product),
          last_verified: lastUpdated,
          source:        'pim-api-stackit',
          ...(STACKIT_SERVICE_MAX_VERSIONS[product] !== undefined && { max_version: STACKIT_SERVICE_MAX_VERSIONS[product] }),
        }));

      return {
        id:         regionId,
        display:    ov.display,
        country:    ov.country,
        sovereignty: ov.sovereignty,
        services,
      };
    });

  return {
    meta: {
      schema_version: '0.1',
      name:           'STACKIT service catalogue',
      provider:       'stackit',
      last_updated:   lastUpdated,
      source: {
        mode:        'pim-api-stackit',
        tool:        'pim.api.stackit.cloud/v1/skus',
        operator,
        source_note: 'PIM API endpoint is not publicly contracted; fallback to curated YAML if auth is added',
      },
      confidence:    'medium',
      regions_count: regions.length,
    },
    regions,
  };
}
