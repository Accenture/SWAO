#!/usr/bin/env node
// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * refresh-lz-catalogue-stackit.mjs -- fetch service availability from the
 * STACKIT PIM API and write swao/lz-catalogues/stackit.json.
 *
 * Data source (Design 056 §4.4, #0871):
 *   GET https://pim.api.stackit.cloud/v1/skus
 *   Returns { lastUpdatedAt, services: [...] } -- no credentials required.
 *
 * Fallback: if the PIM API adds authentication in future, use the
 *   stackitcloud/stackit-api-specifications GitHub service directory
 *   (https://github.com/stackitcloud/stackit-api-specifications) for
 *   canonical service names and hand-curate region availability. Lower
 *   confidence to 'low' and set source.mode to 'curated'.
 *
 * Strategy:
 *   1. Fetch PIM API SKU list.
 *   2. Filter deprecated SKUs (deprecated === 'Yes' or
 *      maturityModelState === 'deprecated').
 *   3. Group by product, collecting regions (eu01, eu02, or global).
 *      global means available in all regions -- expand to eu01 + eu02.
 *   4. Deduplicate per (region, product); ga status beats beta.
 *   5. Map product names to SWAO capability vocabulary via SERVICE_FULFILLS.
 *   6. Apply SOVEREIGNTY_OVERLAY for eu01 and eu02.
 *   7. Merge retired services: services present in the existing stackit.json
 *      but absent from the fresh PIM data are carried forward with
 *      status: 'retired' and retired_at: today (or the existing retired_at
 *      if already retired).
 *   8. Write swao/lz-catalogues/stackit.json.
 *
 * Usage:
 *   node scripts/refresh-lz-catalogue-stackit.mjs
 *   node scripts/refresh-lz-catalogue-stackit.mjs --dry-run
 *
 * Output:
 *   swao/lz-catalogues/stackit.json
 *
 * Requires: Node 18+ (built-in fetch). No npm dependencies.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOGUES_DIR = join(__dirname, '..', '..', '..', 'lz-catalogues');

const STACKIT_PIM_URL = 'https://pim.api.stackit.cloud/v1/skus';

const dryRun = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Service -> SWAO capability vocabulary (Design 056 D-LZ-08).
// Keys are the exact `product` strings from the STACKIT PIM API.
// Note: this map requires manual updates when STACKIT launches an entirely
// new service category not covered below. Cross-reference
// stackitcloud/stackit-api-specifications when updating.
// ---------------------------------------------------------------------------
const SERVICE_FULFILLS = {
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
// Sovereignty overlay -- fixed per region for STACKIT (D-LZ-07).
// ---------------------------------------------------------------------------
const SOVEREIGNTY_OVERLAY = {
  eu01: {
    display:  'STACKIT eu01 (Germany)',
    country:  'DE',
    sovereignty: {
      residency_country:          'DE',
      operator_jurisdiction:      'EU-entity',
      extraterritorial_exposure:  [],
      certifications:             ['BSI_C5', 'ISO_27001'],
    },
  },
  eu02: {
    display:  'STACKIT eu02 (Austria)',
    country:  'AT',
    sovereignty: {
      residency_country:          'AT',
      operator_jurisdiction:      'EU-entity',
      extraterritorial_exposure:  [],
      certifications:             ['ISO_27001'],
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function lzStatus(mms) {
  return mms === 'ga' ? 'ga' : 'preview';
}

function keyCustodyFor(product) {
  if (product === 'KMS') return ['provider-managed', 'byok', 'hyok'];
  if (product === 'Object Storage' || product === 'Block Storage' || product === 'PostgreSQL Flex') {
    return ['provider-managed', 'byok'];
  }
  return ['provider-managed'];
}

// ---------------------------------------------------------------------------
// Merge retired services: services present in the existing catalogue but
// absent from the fresh PIM data are carried forward as 'retired'.
// ---------------------------------------------------------------------------
function mergeRetiredServices(freshRegions, existingPath, today) {
  if (!existsSync(existingPath)) return freshRegions;
  let existing;
  try {
    existing = JSON.parse(readFileSync(existingPath, 'utf-8'));
  } catch {
    return freshRegions;
  }
  for (const freshRegion of freshRegions) {
    const existingRegion = (existing.regions ?? []).find((r) => r.id === freshRegion.id);
    if (!existingRegion) continue;
    const freshCodes = new Set(freshRegion.services.map((s) => s.code));
    for (const oldSvc of existingRegion.services ?? []) {
      if (!freshCodes.has(oldSvc.code)) {
        freshRegion.services.push({
          ...oldSvc,
          status:     'retired',
          retired_at: oldSvc.retired_at ?? today,
        });
      }
    }
  }
  return freshRegions;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('[refresh-lz-catalogue-stackit] fetching PIM API...');
let rawSkus;
try {
  const resp = await fetch(STACKIT_PIM_URL, {
    headers: { 'User-Agent': 'swao-lz-catalogue-refresh/0.1' },
    signal:  AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  const body = await resp.json();
  rawSkus = body.services ?? body;
} catch (err) {
  console.error(`[refresh-lz-catalogue-stackit] fetch failed: ${err.message}`);
  console.error('  Fallback: use stackitcloud/stackit-api-specifications for service names,');
  console.error('  hand-curate region availability, and set source.mode to "curated".');
  process.exit(1);
}

console.log(`[refresh-lz-catalogue-stackit] fetched ${rawSkus.length} SKUs`);

// Filter deprecated
const active = rawSkus.filter(
  (s) => s.deprecated !== 'Yes' && s.maturityModelState !== 'deprecated',
);
console.log(`[refresh-lz-catalogue-stackit] ${active.length} active SKUs (${rawSkus.length - active.length} deprecated filtered)`);

// Expand and group by (region, product) -> best maturity
const regionProducts = { eu01: new Map(), eu02: new Map() };
const regionIds = Object.keys(regionProducts);

function recordProduct(regionId, product, mms) {
  const map = regionProducts[regionId];
  if (!map) return;
  const current = map.get(product);
  if (!current || (current !== 'ga' && mms === 'ga')) {
    map.set(product, mms);
  }
}

for (const s of active) {
  if (s.region === 'global') {
    for (const r of regionIds) recordProduct(r, s.product, s.maturityModelState);
  } else {
    recordProduct(s.region, s.product, s.maturityModelState);
  }
}

const today = new Date().toISOString().slice(0, 10);

// Build regions
const freshRegions = regionIds.map((regionId) => {
  const ov = SOVEREIGNTY_OVERLAY[regionId];
  const entries = [...regionProducts[regionId].entries()]
    .sort(([a], [b]) => slugify(a).localeCompare(slugify(b)));

  return {
    id:         regionId,
    display:    ov.display,
    country:    ov.country,
    sovereignty: ov.sovereignty,
    services:   entries.map(([product, mms]) => ({
      code:          slugify(product),
      name:          product,
      status:        lzStatus(mms),
      capabilities:  [],
      fulfills:      SERVICE_FULFILLS[product] ?? [],
      key_custody:   keyCustodyFor(product),
      last_verified: today,
      source:        'pim-api-stackit',
    })),
  };
});

// Merge retired services from existing catalogue
const outPath = join(CATALOGUES_DIR, 'stackit.json');
const regions = mergeRetiredServices(freshRegions, outPath, today);

// Count active vs retired per region
for (const r of regions) {
  const active = r.services.filter((s) => s.status !== 'retired').length;
  const retired = r.services.filter((s) => s.status === 'retired').length;
  console.log(`[refresh-lz-catalogue-stackit] ${r.id}: ${active} active + ${retired} retired`);
}

const catalogue = {
  meta: {
    schema_version: '0.1',
    name:           'STACKIT service catalogue',
    provider:       'stackit',
    last_updated:   today,
    source: {
      mode:        'pim-api-stackit',
      tool:        'pim.api.stackit.cloud/v1/skus',
      operator:    'SWAO team',
      source_note: 'PIM API endpoint is not publicly contracted; fallback to curated YAML if auth is added',
    },
    confidence:    'medium',
    regions_count: regions.length,
  },
  regions,
};

if (dryRun) {
  console.log('[refresh-lz-catalogue-stackit] --dry-run: would write', outPath);
  console.log('[refresh-lz-catalogue-stackit] done (dry-run, no file written)');
} else {
  writeFileSync(outPath, JSON.stringify(catalogue, null, 2) + '\n', 'utf-8');
  console.log('[refresh-lz-catalogue-stackit] written:', outPath);
  console.log('[refresh-lz-catalogue-stackit] done.');
}
