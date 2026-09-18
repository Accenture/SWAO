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
// ---------------------------------------------------------------------------

interface GcpSovereigntyEntry {
  display: string;
  residency_country: string;
  operator_jurisdiction: string;
  extraterritorial_exposure: string[];
  certifications: string[];
}

const GCP_REGION_OVERLAY: Record<string, GcpSovereigntyEntry> = {
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
