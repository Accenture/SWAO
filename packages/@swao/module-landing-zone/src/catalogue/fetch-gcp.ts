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
import {
  GCP_SOVEREIGNTY_PINS as GCP_REGION_OVERLAY,
  type GcpSovereigntyPin as GcpSovereigntyEntry,
} from './sovereignty-pins.js';

/**
 * GCP catalogue fetcher (Design 056 §4.3, #0870). GCP availability comes from
 * the GoogleCloudPlatform/region-picker `products.json` (public GitHub raw,
 * no credentials required). The file is a boolean matrix:
 *   { "Compute Engine": { "europe-west3": true, "asia-east1": false }, ... }
 *
 * This module normalises that matrix into an LzServiceCatalogue. Sovereignty
 * facts (D-LZ-07) are supplied by the curated per-region overlay.
 *
 * Known limitation: product display names (e.g. "Compute Engine") do not map
 * to GCP API service IDs (e.g. compute.googleapis.com). The SERVICE_FULFILLS
 * map keys on display names and must be updated when Google renames a product.
 * Treat as `confidence: medium` -- the source is manually maintained.
 */

/** Boolean availability matrix from region-picker products.json. */
export type GcpProductsMatrix = Record<string, Record<string, boolean>>;

export interface GcpRegionOverlay {
  display?: string;
  country?: string;
  sovereignty?: LzSovereigntyFacts;
}

// ---------------------------------------------------------------------------
// Product display name -> SWAO capability vocabulary (D-LZ-08).
// Keys match the product display names used in the GoogleCloudPlatform/
// region-picker products.json exactly; add entries when new products appear.
// Verified against products.json fetched 2026-07-07 (110 distinct products).
// Mirror of refresh-lz-catalogue-gcp.mjs SERVICE_FULFILLS -- keep in sync.
// ---------------------------------------------------------------------------
const GCP_SERVICE_FULFILLS: Record<string, string[]> = {
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
  'Managed Service for Apache Kafka':     ['event_streaming', 'kafka'], // #3430
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
// Service capability tags for specific products (#1318 postgresql enrichment).
// pgaudit_supported -- service is known to support the pgaudit extension.
// ---------------------------------------------------------------------------
const GCP_SERVICE_CAPABILITIES: Record<string, string[]> = {
  'AlloyDB':    ['pgaudit_supported'],
  'Cloud SQL':  ['pgaudit_supported'],
};

// Highest supported major version per product (#1323 semantic version matching).
const GCP_SERVICE_MAX_VERSIONS: Record<string, number> = {
  'AlloyDB':   16,
  'Cloud SQL': 16,
};

// ---------------------------------------------------------------------------
// Region code -> sovereignty facts overlay (D-LZ-07).
// All standard GCP regions carry operator_jurisdiction: US-entity.
// GCP Sovereign Controls partnerships (T-Systems DE, Thales FR) are separate
// contractual offerings and are NOT modelled here; treat as gcp-de-sovereign /
// gcp-fr-sovereign distinct providers when in scope.
// C5 certification: applies to europe-west3 (Frankfurt), europe-west4 (Amsterdam),
// europe-west10 (Berlin); source: cloud.google.com/security/compliance/c5.
// The pinned table lives in catalogue/sovereignty-pins.ts (#3282).
// ---------------------------------------------------------------------------
const DEFAULT_GCP_SOVEREIGNTY: GcpSovereigntyEntry = {
  display: '',
  residency_country: 'UNKNOWN',
  operator_jurisdiction: 'US-entity',
  extraterritorial_exposure: ['us_cloud_act', 'fisa_702'],
  certifications: ['ISO_27001'],
};

/**
 * Determine key-custody options for a GCP service given its fulfills tags.
 * Mirrors the AWS key_custody derivation in lz-premium.ts.
 */
function gcpKeyCustody(fulfills: string[]): string[] {
  if (fulfills.includes('key_vault')) return ['provider-managed', 'byok', 'hyok'];
  if (fulfills.includes('secrets_management')) return ['provider-managed', 'byok'];
  if (fulfills.includes('object_storage')) return ['provider-managed', 'byok'];
  if (fulfills.includes('nosql_database')) return ['provider-managed', 'byok'];
  if (fulfills.includes('vm_compute')) return ['provider-managed', 'byok'];
  if (fulfills.includes('postgresql') || fulfills.includes('mysql')) return ['provider-managed', 'byok'];
  return ['provider-managed'];
}

/**
 * Normalise the region-picker products.json matrix into an LzServiceCatalogue.
 *
 * The matrix keys are product display names; the inner maps are region codes
 * with a boolean availability flag. Only `true` entries are included.
 *
 * An optional `overlay` overrides the built-in GCP_REGION_OVERLAY (useful for
 * testing with a minimal fixture).
 */
export function normalizeGcpProducts(
  matrix: GcpProductsMatrix,
  opts: {
    lastUpdated: string;
    overlay?: Record<string, GcpRegionOverlay>;
    operator?: string;
  },
): LzServiceCatalogue {
  // Invert the matrix: region -> Set<productName> (where availability is true).
  const byRegion = new Map<string, Set<string>>();
  for (const [productName, regionMap] of Object.entries(matrix)) {
    for (const [regionCode, available] of Object.entries(regionMap)) {
      if (!available) continue;
      if (!byRegion.has(regionCode)) byRegion.set(regionCode, new Set());
      byRegion.get(regionCode)!.add(productName);
    }
  }

  const regions: LzRegion[] = [...byRegion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([regionId, products]) => {
      // Resolve overlay: caller-supplied overlay takes precedence per-field;
      // built-in GCP_REGION_OVERLAY provides defaults for each region.
      const builtIn = GCP_REGION_OVERLAY[regionId] ?? DEFAULT_GCP_SOVEREIGNTY;
      const callerOv: GcpRegionOverlay = opts.overlay ? (opts.overlay[regionId] ?? {}) : {};

      const display = callerOv.display ?? builtIn.display;
      const country = callerOv.country ?? builtIn.residency_country;
      const sovereignty: LzSovereigntyFacts = callerOv.sovereignty ?? {
        residency_country: builtIn.residency_country,
        operator_jurisdiction: builtIn.operator_jurisdiction,
        extraterritorial_exposure: builtIn.extraterritorial_exposure,
        certifications: builtIn.certifications,
      };

      return {
        id: regionId,
        display: display || undefined,
        country: country || undefined,
        sovereignty,
        services: [...products]
          .sort()
          .map((productName) => {
            const fulfills = GCP_SERVICE_FULFILLS[productName] ?? [];
            return {
              code: productName,
              status: 'ga' as const,
              fulfills,
              capabilities: GCP_SERVICE_CAPABILITIES[productName] ?? [],
              key_custody: gcpKeyCustody(fulfills),
              last_verified: opts.lastUpdated,
              source: 'region-picker-github',
              ...(GCP_SERVICE_MAX_VERSIONS[productName] !== undefined && { max_version: GCP_SERVICE_MAX_VERSIONS[productName] }),
            };
          }),
      };
    });

  return {
    meta: {
      schema_version: '0.1',
      name: 'GCP service catalogue',
      provider: 'gcp',
      last_updated: opts.lastUpdated,
      source: {
        mode: 'scrape',
        tool: 'region-picker-github',
        operator: opts.operator,
      },
      confidence: 'medium',
      regions_count: regions.length,
    },
    regions,
  };
}
