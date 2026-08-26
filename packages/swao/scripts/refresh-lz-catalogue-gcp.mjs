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
 * refresh-lz-catalogue-gcp.mjs -- fetch GCP service-by-region availability
 * from GoogleCloudPlatform/region-picker products.json.
 *
 * Builds swao/lz-catalogues/gcp.json: a region-keyed LzServiceCatalogue of
 * GCP service availability with sovereignty facts (D-LZ-07).
 *
 * Data source:
 *   GET https://raw.githubusercontent.com/GoogleCloudPlatform/region-picker/main/data/products.json
 *   Boolean matrix: product display name -> region code -> true/false.
 *   130 GCP products across 41 regions. Maintained by Google Cloud engineers.
 *   Source data extracted from cloud.google.com/about/locations.
 *
 * No credentials required. Treat as confidence: medium (manually maintained).
 *
 * Known limitations:
 * - products.json is manually maintained by Google contributors; freshness
 *   depends on their cadence. Add a staleness warning in `swao doctor` if
 *   the catalogue last_updated is older than 90 days.
 * - Product display names (e.g. "Compute Engine") do not map directly to
 *   GCP API service IDs (e.g. compute.googleapis.com). The SERVICE_FULFILLS
 *   map keys on display names and must be updated on renames.
 * - GCP Sovereign Controls partnerships (T-Systems DE, Thales FR) are a
 *   separate contractual layer. Standard GCP regions carry
 *   operator_jurisdiction: US-entity regardless. Model partner sovereign
 *   offerings as distinct gcp-de-sovereign / gcp-fr-sovereign entries.
 *
 * Usage:
 *   node scripts/refresh-lz-catalogue-gcp.mjs
 *   node scripts/refresh-lz-catalogue-gcp.mjs --dry-run
 *   node scripts/refresh-lz-catalogue-gcp.mjs --products-path /path/to/products.json
 *
 * Output:
 *   swao/lz-catalogues/gcp.json
 *
 * Requires: Node 18+ (built-in fetch). No npm dependencies.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOGUES_DIR = join(__dirname, '..', '..', '..', 'lz-catalogues');

const REGION_PICKER_URL =
  'https://raw.githubusercontent.com/GoogleCloudPlatform/region-picker/main/data/products.json';

const dryRun = process.argv.includes('--dry-run');
const productsPathArg = (() => {
  const idx = process.argv.indexOf('--products-path');
  return idx >= 0 ? process.argv[idx + 1] : null;
})();

// ---------------------------------------------------------------------------
// Product display name -> SWAO capability vocabulary (D-LZ-08).
// Keys match product names from GoogleCloudPlatform/region-picker products.json.
// Mirror of fetch-gcp.ts GCP_SERVICE_FULFILLS -- keep in sync on updates.
// ---------------------------------------------------------------------------
const SERVICE_FULFILLS = {
  'API Gateway':                          ['api_gateway'],
  'AlloyDB':                              ['postgresql'],
  'Anti Money Laundering AI':             ['ml_nlp'],
  'Apigee':                               ['api_gateway'],
  'App Engine':                           ['paas_compute'],
  'Artifact Registry':                    ['container_registry'],
  'AutoML Natural Language':              ['ml_nlp'],
  'AutoML Translation':                   ['ml_translation'],
  'BQML':                                 ['data_analytics', 'ml_training'],
  'Backup and DR':                        ['backup'],
  'Bare Metal Solution':                  ['vm_compute'],
  'Batch':                                ['batch_compute'],
  'BeyondCorp Enterprise':               ['identity_management'],
  'BigQuery':                             ['data_warehouse', 'data_analytics'],
  'Bigtable':                             ['nosql_database'],
  'Certificate Authority Service':        ['certificate_management'],
  'Cloud Armor Control':                  ['waf'],
  'Cloud Build':                          ['ci_cd'],
  'Cloud Composer':                       ['data_integration'],
  'Cloud Data Catalog':                   ['data_analytics'],
  'Cloud Data Fusion':                    ['data_integration'],
  'Cloud Dataflow':                       ['data_integration', 'event_streaming'],
  'Cloud Dataproc':                       ['big_data'],
  'Cloud Datastore':                      ['nosql_database'],
  'Cloud Datastream':                     ['data_migration'],
  'Cloud Deploy':                         ['ci_cd'],
  'Cloud EKM':                            ['key_vault'],
  'Cloud Firestore':                      ['nosql_database'],
  'Cloud HSM':                            ['key_vault'],
  'Cloud Healthcare API':                 ['ml_nlp'],
  'Cloud IDS':                            ['threat_detection'],
  'Cloud Identity':                       ['identity_management'],
  'Cloud Identity-Aware Proxy':           ['identity_management'],
  'Cloud Interconnect':                   ['dedicated_connectivity'],
  'Cloud IoT':                            ['iot_platform'],
  'Cloud Key Management Service':         ['key_vault'],
  'Cloud Life Sciences':                  ['big_data'],
  'Cloud Load Balancing':                 ['load_balancer'],
  'Cloud Logging':                        ['audit_logging'],
  'Cloud Memorystore':                    ['redis'],
  'Cloud Pub/Sub':                        ['queue', 'messaging', 'event_streaming'],
  'Cloud Run':                            ['serverless_compute'],
  'Cloud Run functions':                  ['serverless_compute'],
  'Cloud SQL':                            ['postgresql', 'mysql'],
  'Cloud Scheduler':                      ['batch_compute'],
  'Cloud Storage':                        ['object_storage'],
  'Cloud Tasks':                          ['queue'],
  'Cloud Vision':                         ['ml_vision'],
  'Cloud VPN':                            ['dedicated_connectivity'],
  'Compute Engine':                       ['vm_compute'],
  'Database Migration Service':           ['data_migration'],
  'Dataplex':                             ['data_integration'],
  'Dataproc Metastore':                   ['big_data'],
  'Datastream':                           ['data_migration'],
  'Document AI Processors':               ['ml_nlp'],
  'Eventarc':                             ['event_streaming'],
  'Filestore':                            ['file_storage'],
  'Generative AI on Vertex AI':           ['managed_llm', 'ml_training', 'ml_inference'],
  'Google Distributed Cloud (connected)': ['vm_compute'],
  'Google Kubernetes Engine':             ['kubernetes'],
  'Live Stream API':                      ['media_streaming'],
  'Looker (Google Cloud core)':           ['bi_analytics'],
  'Managed Service for Apache Kafka':     ['event_streaming'],
  'Memorystore':                          ['redis'],
  'Memorystore for Memcache':             ['memcached'],
  'Memorystore for Redis':                ['redis'],
  'Memorystore for Redis Cluster':        ['redis'],
  'Migration Center':                     ['data_migration'],
  'Pub/Sub Lite':                         ['queue', 'messaging', 'event_streaming'],
  'Secret Manager':                       ['secrets_management'],
  'Spanner':                              ['nosql_database'],
  'Speech-to-Text':                       ['ml_speech'],
  'Storage Transfer Service':             ['data_migration'],
  'Transcoder API':                       ['media_processing'],
  'Vertex AI':                            ['managed_llm', 'ml_training', 'ml_inference'],
  'Video Intelligence API':               ['ml_vision'],
  'Video Stitcher API':                   ['media_processing'],
  'Virtual Private Cloud':               ['vpc_networking'],
  'Virtual Private Cloud (VPC)':         ['vpc_networking'],
  'Workflows':                            ['serverless_compute'],
  // Additional products with clear capability mappings (verified 2026-07-07)
  'Access Context Manager':              ['identity_management'],
  'Application Integration':             ['data_integration'],
  'AppSheet':                             ['paas_compute'],
  'Assured Workloads':                   ['compliance_monitoring'],
  'BI Engine':                            ['bi_analytics'],
  'BigQuery Reservation API':            ['data_warehouse'],
  'BigQuery Storage API':                ['data_warehouse', 'data_analytics'],
  'Certificate Manager':                 ['certificate_management'],
  'Cloud Asset Ingestion':               ['compliance_monitoring'],
  'Cloud Dataloss':                      ['data_protection'],
  'Cloud Storage for Firebase':          ['object_storage'],
  'Cloud Workstations':                  ['developer_tools'],
  'Dataform':                            ['data_integration'],
  'Dialogflow CX':                       ['ml_nlp'],
  'Dialogflow ES':                       ['ml_nlp'],
  'DTS (BQ Data Transfer)':              ['data_migration'],
  'Google Attestation Verifier':         ['vm_compute'],
  'Google Cloud VMware Engine':          ['vm_compute'],
  'Hyperdisk':                           ['block_storage'],
  'Infrastructure Manager':              ['iac'],
  'Key Access Justifications':           ['key_vault'],
  'Managed Service for Microsoft Active Directory (AD)': ['identity_management'],
  'NetApp Volumes':                      ['file_storage'],
  'Payment Gateway':                     ['payment_processing'],
  'Persistent Disk':                     ['block_storage'],
  'Sensitive Data Protection':           ['data_protection'],
  'Service Mesh':                        ['kubernetes'],
};

// ---------------------------------------------------------------------------
// Region code -> sovereignty facts overlay (D-LZ-07).
// All standard GCP regions carry operator_jurisdiction: US-entity.
// Mirror of fetch-gcp.ts GCP_REGION_OVERLAY -- keep in sync on updates.
// ---------------------------------------------------------------------------
const SOVEREIGNTY_OVERLAY = {
  // Europe
  'europe-west1':          { display: 'Belgium',                   residency_country: 'BE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'europe-west2':          { display: 'London, United Kingdom',    residency_country: 'GB', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'europe-west3':          { display: 'Frankfurt, Germany',        residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['C5', 'ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'europe-west4':          { display: 'Netherlands',               residency_country: 'NL', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['C5', 'ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'europe-west6':          { display: 'Zurich, Switzerland',       residency_country: 'CH', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'europe-west8':          { display: 'Milan, Italy',              residency_country: 'IT', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'europe-west9':          { display: 'Paris, France',             residency_country: 'FR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'europe-west10':         { display: 'Berlin, Germany',           residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['C5', 'ISO_27001', 'SOC_2'] },
  'europe-west12':         { display: 'Turin, Italy',              residency_country: 'IT', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'europe-north1':         { display: 'Finland',                   residency_country: 'FI', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'europe-central2':       { display: 'Warsaw, Poland',            residency_country: 'PL', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'europe-southwest1':     { display: 'Madrid, Spain',             residency_country: 'ES', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  // USA
  'us-central1':           { display: 'Iowa, USA',                 residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS', 'FedRAMP_High'] },
  'us-east1':              { display: 'South Carolina, USA',       residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS', 'FedRAMP_High'] },
  'us-east4':              { display: 'Northern Virginia, USA',    residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS', 'FedRAMP_High'] },
  'us-east5':              { display: 'Columbus, USA',             residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'us-south1':             { display: 'Dallas, USA',               residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'us-west1':              { display: 'Oregon, USA',               residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'us-west2':              { display: 'Los Angeles, USA',          residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'us-west3':              { display: 'Salt Lake City, USA',       residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'us-west4':              { display: 'Las Vegas, USA',            residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  // North America (non-US)
  'northamerica-northeast1': { display: 'Montreal, Canada',        residency_country: 'CA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'northamerica-northeast2': { display: 'Toronto, Canada',         residency_country: 'CA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'northamerica-south1':   { display: 'Queretaro, Mexico',         residency_country: 'MX', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  // South America
  'southamerica-east1':    { display: 'Sao Paulo, Brazil',         residency_country: 'BR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'southamerica-west1':    { display: 'Santiago, Chile',           residency_country: 'CL', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  // Asia
  'asia-east1':            { display: 'Taiwan',                    residency_country: 'TW', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'asia-east2':            { display: 'Hong Kong',                 residency_country: 'HK', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'asia-northeast1':       { display: 'Tokyo, Japan',              residency_country: 'JP', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'asia-northeast2':       { display: 'Osaka, Japan',              residency_country: 'JP', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'asia-northeast3':       { display: 'Seoul, South Korea',        residency_country: 'KR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'asia-south1':           { display: 'Mumbai, India',             residency_country: 'IN', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'asia-south2':           { display: 'Delhi, India',              residency_country: 'IN', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'asia-southeast1':       { display: 'Singapore',                 residency_country: 'SG', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'MAS_TRM'] },
  'asia-southeast2':       { display: 'Jakarta, Indonesia',        residency_country: 'ID', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  // Oceania
  'australia-southeast1':  { display: 'Sydney, Australia',         residency_country: 'AU', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'IRAP'] },
  'australia-southeast2':  { display: 'Melbourne, Australia',      residency_country: 'AU', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  // Middle East
  'me-central1':           { display: 'Doha, Qatar',               residency_country: 'QA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'me-central2':           { display: 'Dammam, Saudi Arabia',      residency_country: 'SA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'me-west1':              { display: 'Tel Aviv, Israel',          residency_country: 'IL', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  // Africa
  'africa-south1':         { display: 'Johannesburg, South Africa', residency_country: 'ZA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
};

const DEFAULT_SOVEREIGNTY = {
  residency_country: 'UNKNOWN',
  operator_jurisdiction: 'US-entity',
  extraterritorial_exposure: ['us_cloud_act', 'fisa_702'],
  certifications: ['ISO_27001'],
};

// ---------------------------------------------------------------------------
// Fetch products.json
// ---------------------------------------------------------------------------

async function fetchProducts(overridePath) {
  if (overridePath) {
    console.log(`[refresh-lz-catalogue-gcp] using local file: ${overridePath}`);
    return { data: JSON.parse(readFileSync(overridePath, 'utf-8')), source: overridePath };
  }
  console.log(`[refresh-lz-catalogue-gcp] fetching: ${REGION_PICKER_URL}`);
  const res = await fetch(REGION_PICKER_URL, {
    headers: { 'User-Agent': 'swao-lz-catalogue-refresh/0.1' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} ${REGION_PICKER_URL}`);
  return { data: await res.json(), source: REGION_PICKER_URL };
}

// ---------------------------------------------------------------------------
// Key-custody derivation
// ---------------------------------------------------------------------------

function keyCustody(fulfills) {
  if (fulfills.includes('key_vault')) return ['provider-managed', 'byok', 'hyok'];
  if (fulfills.includes('secrets_management')) return ['provider-managed', 'byok'];
  if (fulfills.includes('object_storage')) return ['provider-managed', 'byok'];
  if (fulfills.includes('nosql_database')) return ['provider-managed', 'byok'];
  if (fulfills.includes('vm_compute')) return ['provider-managed', 'byok'];
  if (fulfills.includes('postgresql') || fulfills.includes('mysql')) return ['provider-managed', 'byok'];
  return ['provider-managed'];
}

// ---------------------------------------------------------------------------
// Build catalogue
// ---------------------------------------------------------------------------

function buildCatalogue(matrix, today) {
  // Invert matrix: region -> Set<productName> (only where availability === true).
  const byRegion = new Map();
  for (const [productName, regionMap] of Object.entries(matrix)) {
    for (const [regionCode, available] of Object.entries(regionMap)) {
      if (!available) continue;
      if (!byRegion.has(regionCode)) byRegion.set(regionCode, new Set());
      byRegion.get(regionCode).add(productName);
    }
  }

  const regions = [...byRegion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([regionId, products]) => {
      const sov = SOVEREIGNTY_OVERLAY[regionId] ?? DEFAULT_SOVEREIGNTY;
      return {
        id: regionId,
        display: sov.display || regionId,
        country: sov.residency_country,
        sovereignty: {
          residency_country: sov.residency_country,
          operator_jurisdiction: sov.operator_jurisdiction,
          extraterritorial_exposure: sov.extraterritorial_exposure,
          certifications: sov.certifications,
        },
        services: [...products]
          .sort()
          .map((productName) => {
            const fulfills = SERVICE_FULFILLS[productName] ?? [];
            return {
              code: productName,
              status: 'ga',
              fulfills,
              capabilities: [],
              key_custody: keyCustody(fulfills),
              last_verified: today,
              source: 'region-picker-github',
            };
          }),
      };
    });

  return {
    meta: {
      schema_version: '0.1',
      name: 'GCP service catalogue',
      provider: 'gcp',
      last_updated: today,
      source: {
        mode: 'scrape',
        tool: 'region-picker-github',
        operator: 'SWAO team',
      },
      confidence: 'medium',
      regions_count: regions.length,
    },
    regions,
  };
}

// ---------------------------------------------------------------------------
// mergeRetiredServices -- preserve removed services across catalogue refreshes
// ---------------------------------------------------------------------------

/**
 * Carry forward services present in an existing region but absent from the
 * fresh data, marking them as retired.
 * Preserves any existing retired_at date so it remains stable across runs.
 */
function mergeRetiredServices(freshServices, existingServices, today) {
  const freshCodes = new Set(freshServices.map((s) => s.code));
  const retiredToAdd = [];
  for (const svc of existingServices) {
    if (freshCodes.has(svc.code)) continue;
    retiredToAdd.push({
      ...svc,
      status: 'retired',
      retired_at: svc.status === 'retired' && svc.retired_at ? svc.retired_at : today,
    });
  }
  return [...freshServices, ...retiredToAdd];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { data: matrix, source } = await fetchProducts(productsPathArg);
const today = new Date().toISOString().slice(0, 10);
const freshCatalogue = buildCatalogue(matrix, today);

const outPath = join(CATALOGUES_DIR, 'gcp.json');

// Load existing catalogue (if any) so retired services are preserved.
let existingRegions = [];
try {
  const existing = JSON.parse(readFileSync(outPath, 'utf-8'));
  existingRegions = existing.regions ?? [];
} catch {
  // No existing file or parse error -- start fresh.
}

// Merge retired services per region.
const mergedRegions = freshCatalogue.regions.map((region) => {
  const existingRegion = existingRegions.find((r) => r.id === region.id);
  if (!existingRegion) return region;
  return { ...region, services: mergeRetiredServices(region.services, existingRegion.services, today) };
});

const catalogue = { ...freshCatalogue, regions: mergedRegions };

const regionCount = catalogue.regions.length;
let activeTotal = 0;
let retiredTotal = 0;
for (const r of catalogue.regions) {
  for (const svc of r.services) {
    if (svc.status === 'retired') retiredTotal++;
    else activeTotal++;
  }
}

console.log(
  `[refresh-lz-catalogue-gcp] ${regionCount} region(s), ${activeTotal} active, ${retiredTotal} retired service entries`,
);
console.log(`[refresh-lz-catalogue-gcp] source: ${source}`);

if (dryRun) {
  console.log('[refresh-lz-catalogue-gcp] --dry-run: not writing output.');
  process.exit(0);
}

writeFileSync(outPath, JSON.stringify(catalogue, null, 2) + '\n', 'utf-8');
console.log(`[refresh-lz-catalogue-gcp] written: ${outPath}`);
