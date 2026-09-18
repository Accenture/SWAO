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

// Premium landing-zone commands (consultant+): swao lz catalogue update
// Design 065 §5.6 -- the thin CLI wrapper around the botocore refresh logic.
// Wired into the tier entry by consultant.ts / enterprise.ts.
//
// Source of truth for AWS SERVICE_FULFILLS + SOVEREIGNTY_OVERLAY is
// scripts/refresh-lz-catalogue-aws.mjs (dev refresh). Keep in sync on updates.
// Source of truth for STACKIT is fetch-stackit.ts + scripts/refresh-lz-catalogue-stackit.mjs.
// Source of truth for GCP SERVICE_FULFILLS + SOVEREIGNTY_OVERLAY is
// fetch-gcp.ts + scripts/refresh-lz-catalogue-gcp.mjs. Keep in sync on updates.
// Source of truth for AZURE_SERVICE_FULFILLS + AZURE_SOVEREIGNTY_OVERLAY is
// scripts/refresh-lz-catalogue-azure.mjs (dev refresh). Keep in sync on updates.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  LicenseGuard,
  LicenseLimitError,
  LicenseTierError,
  LicenseInvalidError,
  findWorkspace,
  logPortfolio,
} from '@swao/core';
import { resolveLzCataloguesDir, loadLzCatalogueIndex } from '../catalogue/loader.js';
import {
  normalizeStackitSkus,
  type StackitSku,
  type StackitPimResponse,
} from '../catalogue/fetch-stackit.js';
import { normalizeGcpProducts } from '../catalogue/fetch-gcp.js';
import {
  fetchAzureCatalogue,
  AZURE_RETAIL_PRICES_URL,
  type AzureRegionOverlay,
} from '../catalogue/fetch-azure.js';

// ---------------------------------------------------------------------------
// Catalogue merge helper -- preserves retired services across refreshes.
//
// When a service disappears from the upstream source it is kept in the
// catalogue with status 'retired' and a retired_at date rather than being
// silently dropped. This gives operators a stable audit trail and prevents
// the LZR fit pass from flip-flopping on engagements that were assessed
// before a service was retired.
//
// The function is intentionally typed loosely (plain object) so it can be
// used for any provider catalogue, not just AWS.
// ---------------------------------------------------------------------------
interface LooseSvc { code: string; status: string; retired_at?: string; [k: string]: unknown }
interface LooseRegion { id: string; services?: LooseSvc[]; [k: string]: unknown }
interface LooseCatalogue { regions?: LooseRegion[]; [k: string]: unknown }

function mergeRetiredServices(
  fresh: LooseCatalogue,
  existingPath: string,
  today: string,
): LooseCatalogue {
  if (!existsSync(existingPath)) return fresh;
  let existing: LooseCatalogue;
  try {
    existing = JSON.parse(readFileSync(existingPath, 'utf-8')) as LooseCatalogue;
  } catch {
    return fresh;
  }
  for (const freshRegion of fresh.regions ?? []) {
    const existingRegion = existing.regions?.find((r) => r.id === freshRegion.id);
    if (!existingRegion) continue;
    const freshCodes = new Set((freshRegion.services ?? []).map((s) => s.code));
    for (const oldSvc of existingRegion.services ?? []) {
      if (!freshCodes.has(oldSvc.code)) {
        (freshRegion.services ??= []).push({
          ...oldSvc,
          status: 'retired',
          retired_at: oldSvc.retired_at ?? today,
        });
      }
    }
  }
  return fresh;
}

// ---------------------------------------------------------------------------
// Catalogue diff computation (#1261)
//
// Compares two catalogue snapshots and returns per-region change summaries.
// Used by the update command to populate lz.catalogue.update.complete context.
// ---------------------------------------------------------------------------
interface RegionDiff {
  services_added: number;
  services_removed: number;
  certifications_changed: boolean;
}
type CatalogueDiff = Record<string, RegionDiff>;

function computeCatalogueDiff(prev: LooseCatalogue | null, next: LooseCatalogue): CatalogueDiff {
  const diff: CatalogueDiff = {};
  if (!prev) return diff;

  for (const nextRegion of (next.regions ?? [])) {
    const prevRegion = (prev.regions ?? []).find((r) => r.id === nextRegion.id);
    const prevSvcCodes = new Set(
      (prevRegion?.services ?? []).filter((s) => s.status !== 'retired').map((s) => s.code),
    );
    const nextSvcCodes = new Set(
      (nextRegion.services ?? []).filter((s) => s.status !== 'retired').map((s) => s.code),
    );
    const prevCerts: string[] = (prevRegion as Record<string, unknown> | undefined)?.sovereignty
      ? ((prevRegion as Record<string, unknown>).sovereignty as Record<string, unknown>).certifications as string[] ?? []
      : [];
    const nextCerts: string[] = (nextRegion as Record<string, unknown>).sovereignty
      ? ((nextRegion as Record<string, unknown>).sovereignty as Record<string, unknown>).certifications as string[] ?? []
      : [];
    const prevCertSet = new Set(prevCerts);
    const nextCertSet = new Set(nextCerts);
    const certsChanged = prevCertSet.size !== nextCertSet.size
      || [...prevCertSet].some((c) => !nextCertSet.has(c))
      || [...nextCertSet].some((c) => !prevCertSet.has(c));

    diff[nextRegion.id] = {
      services_added: [...nextSvcCodes].filter((c) => !prevSvcCodes.has(c)).length,
      services_removed: [...prevSvcCodes].filter((c) => !nextSvcCodes.has(c)).length,
      certifications_changed: certsChanged,
    };
  }
  return diff;
}

// ---------------------------------------------------------------------------
// Endpoints data source (Design 065 §5.6 revision: HTTP-first, local fallback)
//
// Primary:  GitHub (AWS-owned boto/botocore repo) -- same data that ships with
//           the AWS CLI, always current, no credentials required.
// Fallback: locally installed AWS CLI botocore file -- used when the network is
//           unavailable (air-gapped environments).
// Override: --endpoints-path / --botocore-path flag -- bypasses both sources;
//           intended for CI / testing / air-gapped custom builds.
// ---------------------------------------------------------------------------
const GITHUB_ENDPOINTS_URL =
  'https://raw.githubusercontent.com/boto/botocore/develop/botocore/data/endpoints.json';

// ---------------------------------------------------------------------------
// STACKIT PIM API data source (#0871, Design 056 §4.4)
//
// Unauthenticated endpoint (no contracted public SLA -- see source_note).
// Fallback: if auth is required in future, use stackitcloud/stackit-api-specifications
// service directory names + hand-curated regions (lower confidence to 'low').
// ---------------------------------------------------------------------------
const STACKIT_PIM_URL = 'https://pim.api.stackit.cloud/v1/skus';

// ---------------------------------------------------------------------------
// GCP products data source (Design 056 §4.3, #0870)
//
// Primary:  GoogleCloudPlatform/region-picker products.json -- publicly
//           maintained boolean availability matrix, no credentials required.
// Override: --products-path flag -- local file for CI / testing / air-gapped.
// ---------------------------------------------------------------------------
const GITHUB_GCP_PRODUCTS_URL =
  'https://raw.githubusercontent.com/GoogleCloudPlatform/region-picker/main/data/products.json';

/** Partition key used for GCP (region-picker path, not botocore). */
const GCP_PARTITION_KEY = 'gcp';

const BOTOCORE_CANDIDATES = [
  'C:\\Program Files\\Amazon\\AWSCLIV2\\awscli\\botocore\\data\\endpoints.json',
  'C:\\Program Files (x86)\\Amazon\\AWSCLIV2\\awscli\\botocore\\data\\endpoints.json',
  '/usr/local/aws-cli/awscli/botocore/data/endpoints.json',
  '/usr/local/lib/aws-cli/awscli/botocore/data/endpoints.json',
  '/opt/homebrew/lib/aws-cli/awscli/botocore/data/endpoints.json',
];

function findLocalBotocore(): string | null {
  for (const p of BOTOCORE_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

interface EndpointsResult {
  data: string;
  source: string;
}

async function fetchEndpointsJson(override?: string): Promise<EndpointsResult> {
  // Override path: local file supplied explicitly (--endpoints-path / tests)
  if (override) {
    if (!existsSync(override)) throw new Error(`endpoints file not found: ${override}`);
    return { data: readFileSync(override, 'utf-8'), source: override };
  }

  // Primary: fetch from AWS-owned GitHub repo (no credentials required)
  try {
    const resp = await fetch(GITHUB_ENDPOINTS_URL, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const data = await resp.text();
    return { data, source: GITHUB_ENDPOINTS_URL };
  } catch (fetchErr) {
    // Fallback: locally installed AWS CLI botocore file (air-gapped)
    const localPath = findLocalBotocore();
    if (localPath) {
      console.warn(
        `[warn] GitHub fetch failed (${(fetchErr as Error).message}); ` +
        `falling back to local botocore: ${localPath}`,
      );
      return { data: readFileSync(localPath, 'utf-8'), source: localPath };
    }
    console.error('[error] Could not retrieve AWS endpoints data.');
    console.error(`  Network fetch failed: ${(fetchErr as Error).message}`);
    console.error('  No local AWS CLI botocore file found either.');
    console.error('  Options:');
    console.error('    1. Connect to the internet and retry.');
    console.error('    2. Install the AWS CLI v2 (provides a local copy).');
    console.error('    3. Use --endpoints-path <file> to supply a local endpoints.json.');
    throw fetchErr;
  }
}

// ---------------------------------------------------------------------------
// GCP products.json fetch (Design 056 §4.3, #0870)
// ---------------------------------------------------------------------------
async function fetchGcpProducts(override?: string): Promise<EndpointsResult> {
  if (override) {
    if (!existsSync(override)) throw new Error(`products file not found: ${override}`);
    return { data: readFileSync(override, 'utf-8'), source: override };
  }
  try {
    const resp = await fetch(GITHUB_GCP_PRODUCTS_URL, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const data = await resp.text();
    return { data, source: GITHUB_GCP_PRODUCTS_URL };
  } catch (fetchErr) {
    console.error('[error] Could not retrieve GCP region-picker products.json.');
    console.error(`  Network fetch failed: ${(fetchErr as Error).message}`);
    console.error('  Options:');
    console.error('    1. Connect to the internet and retry.');
    console.error('    2. Use --products-path <file> to supply a local products.json.');
    throw fetchErr;
  }
}

// ---------------------------------------------------------------------------
// Azure: Retail Prices API data source (Design 056 §4.2, #0688)
//
// Live fetch is delegated to fetchAzureCatalogue (fetch-azure.ts), which owns
// the HTTP pagination, deduplication, and normalisation. AZURE_RETAIL_PRICES_URL
// is imported from fetch-azure.ts for console.log reporting.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Service code -> SWAO capability vocabulary (Design 056 D-LZ-08).
// Mirror of scripts/refresh-lz-catalogue-aws.mjs SERVICE_FULFILLS.
// ---------------------------------------------------------------------------
const SERVICE_FULFILLS: Record<string, string[]> = {
  'ec2':                   ['vm_compute'],
  'eks':                   ['kubernetes'],
  'eks-auth':              ['kubernetes'],
  'ecs':                   ['container_orchestration'],
  'rds':                   ['postgresql', 'mysql', 'mariadb'],
  'elasticache':           ['redis', 'memcached'],
  's3':                    ['object_storage'],
  's3-control':            ['object_storage'],
  'dynamodb':              ['nosql_database'],
  'streams.dynamodb':      ['nosql_database'],
  'kms':                   ['key_vault'],
  'secretsmanager':        ['secrets_management'],
  'bedrock':               ['managed_llm'],
  'lambda':                ['serverless_compute'],
  'elasticloadbalancing':  ['load_balancer'],
  'cloudfront':            ['cdn'],
  'sqs':                   ['queue'],
  'sns':                   ['messaging'],
  'kafka':                 ['event_streaming'],
  'kinesis':               ['event_streaming'],
  'firehose':              ['event_streaming'],
  'kinesisanalytics':      ['event_streaming'],
  'cognito-idp':           ['identity_management'],
  'cognito-identity':      ['identity_management'],
  'identitystore':         ['identity_management'],
  'api.sagemaker':         ['ml_training', 'ml_inference'],
  'metrics.sagemaker':     ['ml_inference'],
  'runtime.sagemaker':     ['ml_inference'],
  'es':                    ['search'],
  'aoss':                  ['search'],
  'elasticfilesystem':     ['file_storage'],
  'fsx':                   ['file_storage'],
  'backup':                ['backup'],
  'cloudtrail':            ['audit_logging'],
  'guardduty':             ['threat_detection'],
  'config':                ['compliance_monitoring'],
  'wafv2':                 ['waf'],
  'waf-regional':          ['waf'],
  'network-firewall':      ['network_firewall'],
  'apigateway':            ['api_gateway'],
  'elasticbeanstalk':      ['paas_compute'],
  'lightsail':             ['paas_compute'],
  'batch':                 ['batch_compute'],
  'emr-serverless':        ['big_data'],
  'elasticmapreduce':      ['big_data'],
  'glue':                  ['data_integration'],
  'athena':                ['data_analytics'],
  'redshift':              ['data_warehouse'],
  'redshift-serverless':   ['data_warehouse'],
  'quicksight':            ['bi_analytics'],
  'transfer':              ['managed_file_transfer'],
  'datasync':              ['data_migration'],
  'dms':                   ['data_migration'],
  'codecommit':            ['vcs'],
  'codebuild':             ['ci_cd'],
  'codepipeline':          ['ci_cd'],
  'codedeploy':            ['ci_cd'],
  'ecr':                   ['container_registry'],
  'api.ecr':               ['container_registry'],
  'ssm':                   ['systems_management'],
  'cloudformation':        ['iac'],
  'rekognition':           ['ml_vision'],
  'transcribe':            ['ml_speech'],
  'translate':             ['ml_translation'],
  'polly':                 ['ml_speech'],
  'comprehend':            ['ml_nlp'],
  'directconnect':         ['dedicated_connectivity'],
  'route53resolver':       ['dns'],
  'acm':                   ['certificate_management'],
  'acm-pca':               ['certificate_management'],
  'iot':                   ['iot_platform'],
  'data.iot':              ['iot_platform'],
  'gamelift':              ['game_hosting'],
  'mediaconvert':          ['media_processing'],
  'medialive':             ['media_streaming'],
};

// ---------------------------------------------------------------------------
// Region -> sovereignty facts overlay (D-LZ-07).
// Mirror of scripts/refresh-lz-catalogue-aws.mjs SOVEREIGNTY_OVERLAY.
// ---------------------------------------------------------------------------
interface SovereigntyEntry {
  residency_country: string;
  operator_jurisdiction: string;
  extraterritorial_exposure: string[];
  certifications: string[];
}

const SOVEREIGNTY_OVERLAY: Record<string, SovereigntyEntry> = {
  'eu-central-1':   { residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['C5', 'ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'eu-central-2':   { residency_country: 'CH', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'eu-north-1':     { residency_country: 'SE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['C5', 'ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'eu-south-1':     { residency_country: 'IT', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'eu-south-2':     { residency_country: 'ES', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'eu-west-1':      { residency_country: 'IE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'eu-west-2':      { residency_country: 'GB', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'eu-west-3':      { residency_country: 'FR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'us-east-1':      { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS', 'FedRAMP_High'] },
  'us-east-2':      { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS', 'FedRAMP_High'] },
  'us-west-1':      { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'us-west-2':      { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS', 'FedRAMP_High'] },
  'ca-central-1':   { residency_country: 'CA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'ca-west-1':      { residency_country: 'CA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'sa-east-1':      { residency_country: 'BR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'ap-east-1':      { residency_country: 'HK', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'ap-northeast-1': { residency_country: 'JP', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'ap-northeast-2': { residency_country: 'KR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'ap-northeast-3': { residency_country: 'JP', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'ap-south-1':     { residency_country: 'IN', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'ap-south-2':     { residency_country: 'IN', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'ap-southeast-1': { residency_country: 'SG', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'MAS_TRM'] },
  'ap-southeast-2': { residency_country: 'AU', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'IRAP'] },
  'ap-southeast-3': { residency_country: 'ID', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'ap-southeast-4': { residency_country: 'AU', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'me-central-1':   { residency_country: 'AE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'me-south-1':     { residency_country: 'BH', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'af-south-1':     { residency_country: 'ZA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'il-central-1':   { residency_country: 'IL', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'mx-central-1':   { residency_country: 'MX', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'eusc-de-east-1': { residency_country: 'DE', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: ['C5', 'ISO_27001'] },
  'eu-isoe-west-1': { residency_country: 'EU', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: ['C5'] },
};

const DEFAULT_SOVEREIGNTY: SovereigntyEntry = {
  residency_country: 'UNKNOWN',
  operator_jurisdiction: 'US-entity',
  extraterritorial_exposure: ['us_cloud_act', 'fisa_702'],
  certifications: ['ISO_27001'],
};

// ---------------------------------------------------------------------------
// Azure: Service name -> SWAO capability vocabulary (Design 056 D-LZ-08).
// Mirror of scripts/refresh-lz-catalogue-azure.mjs AZURE_SERVICE_FULFILLS.
// ---------------------------------------------------------------------------
const AZURE_SERVICE_FULFILLS: Record<string, string[]> = {
  'Virtual Machines':                           ['vm_compute'],
  'Azure Dedicated Host':                       ['vm_compute'],
  'Azure Kubernetes Service':                   ['kubernetes'],
  'Azure Red Hat OpenShift':                    ['kubernetes'],
  'Container Instances':                        ['container_orchestration'],
  'Azure Container Apps':                       ['container_orchestration'],
  'Container Registry':                         ['container_registry'],
  'Azure Database for PostgreSQL':              ['postgresql'],
  'Azure Database for MySQL':                   ['mysql'],
  'Azure Database for MariaDB':                 ['mariadb'],
  'Azure SQL Database':                         ['postgresql', 'mysql'],
  'SQL Managed Instance':                       ['postgresql'],
  'Azure Cosmos DB':                            ['nosql_database'],
  'Azure Cache for Redis':                      ['redis'],
  'Storage':                                    ['object_storage'],
  'Azure Blob Storage':                         ['object_storage'],
  'Azure Data Lake Storage':                    ['object_storage'],
  'Azure Managed Disks':                        ['object_storage'],
  'Azure Files':                                ['file_storage'],
  'Azure NetApp Files':                         ['file_storage'],
  'Azure Key Vault':                            ['key_vault'],
  'Azure Managed HSM':                          ['key_vault'],
  'Azure Functions':                            ['serverless_compute'],
  'Azure Logic Apps':                           ['serverless_compute'],
  'App Service':                                ['paas_compute'],
  'Azure Spring Apps':                          ['paas_compute'],
  'Azure Static Web Apps':                      ['paas_compute'],
  'Azure Batch':                                ['batch_compute'],
  'Service Bus':                                ['queue', 'messaging'],
  'Event Hubs':                                 ['event_streaming'],
  'Event Grid':                                 ['messaging'],
  'Azure SignalR Service':                      ['messaging'],
  'Azure Notification Hubs':                    ['messaging'],
  'Azure Communication Services':               ['messaging'],
  'Azure Stream Analytics':                     ['event_streaming'],
  'Azure Synapse Analytics':                    ['data_warehouse'],
  'Azure Databricks':                           ['big_data'],
  'HDInsight':                                  ['big_data'],
  'Azure Data Factory':                         ['data_integration'],
  'Azure Data Explorer':                        ['data_analytics'],
  'Power BI Embedded':                          ['bi_analytics'],
  'Azure Load Balancer':                        ['load_balancer'],
  'Azure Application Gateway':                  ['api_gateway', 'load_balancer'],
  'API Management':                             ['api_gateway'],
  'Azure Front Door':                           ['cdn', 'waf'],
  'Content Delivery Network':                   ['cdn'],
  'Azure Firewall':                             ['network_firewall'],
  'Azure DDoS Protection':                      ['waf'],
  'Azure Web Application Firewall':             ['waf'],
  'Azure Sentinel':                             ['threat_detection'],
  'Microsoft Defender for Cloud':               ['threat_detection'],
  'Microsoft Defender for Endpoint':            ['threat_detection'],
  'Azure Monitor':                              ['audit_logging'],
  'Azure Policy':                               ['compliance_monitoring'],
  'Azure Backup':                               ['backup'],
  'Azure Site Recovery':                        ['backup'],
  'Azure Machine Learning':                     ['ml_training', 'ml_inference'],
  'Azure OpenAI':                               ['managed_llm'],
  'Cognitive Services':                         ['managed_llm', 'ml_nlp', 'ml_vision', 'ml_speech'],
  'Azure AI Search':                            ['search'],
  'Azure Search':                               ['search'],
  'Azure ExpressRoute':                         ['dedicated_connectivity'],
  'Azure VPN Gateway':                          ['dedicated_connectivity'],
  'Azure DevOps':                               ['ci_cd', 'vcs'],
  'IoT Hub':                                    ['iot_platform'],
  'Azure IoT Central':                          ['iot_platform'],
  'Azure IoT Edge':                             ['iot_platform'],
  'Azure Media Services':                       ['media_processing'],
  'Azure DNS':                                  ['dns'],
  'Azure Private DNS':                          ['dns'],
  'Azure Arc':                                  ['systems_management'],
  'Azure Automation':                           ['systems_management'],
  'Azure Migrate':                              ['data_migration'],
  'Azure Database Migration Service':           ['data_migration'],
  'Azure Active Directory External Identities': ['identity_management'],
  'Azure Active Directory B2C':                 ['identity_management'],
};

// ---------------------------------------------------------------------------
// Azure: armRegionName -> sovereignty facts overlay (D-LZ-07).
// Mirror of scripts/refresh-lz-catalogue-azure.mjs SOVEREIGNTY_OVERLAY.
// ---------------------------------------------------------------------------
const AZURE_SOVEREIGNTY_OVERLAY: Record<string, SovereigntyEntry> = {
  // Europe
  'germanywestcentral':  { residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['C5', 'ISO_27001', 'SOC_2'] },
  'westeurope':          { residency_country: 'NL', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'northeurope':         { residency_country: 'IE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'swedencentral':       { residency_country: 'SE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'switzerlandnorth':    { residency_country: 'CH', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'switzerlandwest':     { residency_country: 'CH', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'francecentral':       { residency_country: 'FR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'francesouth':         { residency_country: 'FR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'uksouth':             { residency_country: 'GB', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'ukwest':              { residency_country: 'GB', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'italynorth':          { residency_country: 'IT', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'norwayeast':          { residency_country: 'NO', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'norwaywest':          { residency_country: 'NO', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'polandcentral':       { residency_country: 'PL', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'spaincentral':        { residency_country: 'ES', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'austriaeast':         { residency_country: 'AT', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'belgiumcentral':      { residency_country: 'BE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'greececentral':       { residency_country: 'GR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'finlandcentral':      { residency_country: 'FI', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'denmarkeast':         { residency_country: 'DK', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  // Americas
  'eastus':              { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS', 'FedRAMP_High'] },
  'eastus2':             { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS', 'FedRAMP_High'] },
  'westus':              { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'westus2':             { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS', 'FedRAMP_High'] },
  'westus3':             { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'centralus':           { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'northcentralus':      { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'southcentralus':      { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'westcentralus':       { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'canadacentral':       { residency_country: 'CA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'canadaeast':          { residency_country: 'CA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'brazilsouth':         { residency_country: 'BR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'brazilsoutheast':     { residency_country: 'BR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'mexicocentral':       { residency_country: 'MX', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'chilecentral':        { residency_country: 'CL', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  // Asia Pacific
  'eastasia':            { residency_country: 'HK', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'southeastasia':       { residency_country: 'SG', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'MAS_TRM'] },
  'japaneast':           { residency_country: 'JP', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'japanwest':           { residency_country: 'JP', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'koreacentral':        { residency_country: 'KR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'koreasouth':          { residency_country: 'KR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'australiaeast':       { residency_country: 'AU', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'IRAP'] },
  'australiasoutheast':  { residency_country: 'AU', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'australiacentral':    { residency_country: 'AU', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'australiacentral2':   { residency_country: 'AU', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'centralindia':        { residency_country: 'IN', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'southindia':          { residency_country: 'IN', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'westindia':           { residency_country: 'IN', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'jioindiacentral':     { residency_country: 'IN', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'jioindiawest':        { residency_country: 'IN', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'newzealandnorth':     { residency_country: 'NZ', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'indonesiacentral':    { residency_country: 'ID', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'malaysiawest':        { residency_country: 'MY', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'taiwannorth':         { residency_country: 'TW', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  // Middle East and Africa
  'uaenorth':            { residency_country: 'AE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'uaecentral':          { residency_country: 'AE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'southafricanorth':    { residency_country: 'ZA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'southafricawest':     { residency_country: 'ZA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'israelcentral':       { residency_country: 'IL', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'qatarcentral':        { residency_country: 'QA', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
};

const DEFAULT_AZURE_SOVEREIGNTY: SovereigntyEntry = {
  residency_country: 'UNKNOWN',
  operator_jurisdiction: 'US-entity',
  extraterritorial_exposure: ['us_cloud_act', 'fisa_702'],
  certifications: ['ISO_27001'],
};

// ---------------------------------------------------------------------------
// Partition -> provider config
// ---------------------------------------------------------------------------
interface PartitionConfig {
  provider: string;
  name: string;
  outputFile: string;
  source: { mode: string; tool: string };
  confidence: 'high' | 'medium' | 'low';
}

const PARTITION_CONFIG: Record<string, PartitionConfig> = {
  'aws': {
    provider: 'aws',
    name: 'AWS service catalogue',
    outputFile: 'aws.json',
    source: { mode: 'botocore-endpoints', tool: 'swao lz catalogue update' },
    confidence: 'high',
  },
  'aws-eusc': {
    provider: 'aws-esc',
    name: 'AWS European Sovereign Cloud service catalogue',
    outputFile: 'aws-esc.json',
    source: { mode: 'botocore-endpoints', tool: 'swao lz catalogue update' },
    confidence: 'high',
  },
  'aws-iso-e': {
    provider: 'aws-iso-e',
    name: 'AWS ISOE Europe service catalogue (classified)',
    outputFile: 'aws-iso-e.json',
    source: { mode: 'botocore-endpoints', tool: 'swao lz catalogue update' },
    confidence: 'high',
  },
  // STACKIT uses a different fetch path (PIM API, not botocore endpoints).
  // The key 'stackit' is used as both the partition identifier and the
  // provider filter value for --provider stackit.
  'stackit': {
    provider: 'stackit',
    name: 'STACKIT service catalogue',
    outputFile: 'stackit.json',
    source: { mode: 'pim-api-stackit', tool: 'pim.api.stackit.cloud/v1/skus' },
    confidence: 'medium',
  },
  // GCP uses GoogleCloudPlatform/region-picker products.json (Design 056 §4.3).
  'gcp': {
    provider: 'gcp',
    name: 'GCP service catalogue',
    outputFile: 'gcp.json',
    source: { mode: 'scrape', tool: 'region-picker-github' },
    confidence: 'medium',
  },
  // Azure uses the Azure Retail Prices API (anonymous, no credentials required).
  'azure': {
    provider: 'azure',
    name: 'Azure service catalogue',
    outputFile: 'azure.json',
    source: { mode: 'api', tool: 'retail-prices-api' },
    confidence: 'high',
  },
};
// Curated providers are NOT listed here -- they are discovered dynamically from
// index.json (source === "curated"). Adding a new curated catalogue to index.json
// is sufficient; no code change in this file is required.

// ---------------------------------------------------------------------------
// Catalogue builder (mirrors refresh-lz-catalogue-aws.mjs buildCatalogue)
// ---------------------------------------------------------------------------
interface BotocorePartition {
  partition: string;
  regions?: Record<string, { description?: string }>;
  services?: Record<string, { endpoints?: Record<string, unknown> }>;
}

function buildCatalogueFromPartition(
  partition: BotocorePartition,
  config: PartitionConfig,
  today: string,
): unknown {
  const regionEntries = Object.entries(partition.regions ?? {});
  const services = partition.services ?? {};

  const regions = regionEntries.map(([regionId, regionMeta]) => {
    const regionServices = Object.entries(services)
      .filter(([, svc]) => svc.endpoints?.[regionId] != null)
      .map(([code]) => {
        const fulfills = SERVICE_FULFILLS[code] ?? [];
        return {
          code,
          status: 'ga',
          fulfills,
          capabilities: [],
          key_custody: code === 'kms' ? ['provider-managed', 'byok', 'hyok'] :
                       code === 'secretsmanager' ? ['provider-managed', 'byok'] :
                       fulfills.includes('object_storage') ? ['provider-managed', 'byok'] :
                       fulfills.includes('nosql_database') ? ['provider-managed', 'byok'] :
                       fulfills.includes('vm_compute') ? ['provider-managed', 'byok'] :
                       ['provider-managed'],
          last_verified: today,
          source: 'botocore-endpoints',
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    const sov = SOVEREIGNTY_OVERLAY[regionId] ?? DEFAULT_SOVEREIGNTY;

    return {
      id: regionId,
      display: regionMeta.description ?? regionId,
      country: sov.residency_country,
      sovereignty: {
        residency_country: sov.residency_country,
        operator_jurisdiction: sov.operator_jurisdiction,
        extraterritorial_exposure: sov.extraterritorial_exposure,
        certifications: sov.certifications,
      },
      services: regionServices,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  return {
    meta: {
      schema_version: '0.1',
      name: config.name,
      provider: config.provider,
      last_updated: today,
      source: { ...config.source, operator: 'SWAO operator' },
      confidence: config.confidence,
      regions_count: regions.length,
    },
    regions,
  };
}

// ---------------------------------------------------------------------------
// Azure: sovereignty overlay builder (D-LZ-07)
// Converts AZURE_SOVEREIGNTY_OVERLAY into AzureRegionOverlay shape for
// fetchAzureCatalogue. Called just before the live fetch.
// ---------------------------------------------------------------------------
function buildAzureSovereigntyOverlay(): Record<string, AzureRegionOverlay> {
  const overlay: Record<string, AzureRegionOverlay> = {};
  for (const [regionId, sov] of Object.entries(AZURE_SOVEREIGNTY_OVERLAY)) {
    overlay[regionId] = {
      country: sov.residency_country,
      sovereignty: {
        residency_country: sov.residency_country,
        operator_jurisdiction: sov.operator_jurisdiction,
        extraterritorial_exposure: sov.extraterritorial_exposure,
        certifications: sov.certifications,
      },
    };
  }
  return overlay;
}

// ---------------------------------------------------------------------------
// Azure: key-custody heuristic (per service name)
// ---------------------------------------------------------------------------
function keyCustodyForAzure(code: string, fulfills: string[]): string[] {
  if (code === 'Azure Key Vault')              return ['provider-managed', 'byok', 'hyok'];
  if (code === 'Azure Managed HSM')            return ['provider-managed', 'byok', 'hyok'];
  if (fulfills.includes('object_storage'))     return ['provider-managed', 'byok'];
  if (fulfills.includes('postgresql'))         return ['provider-managed', 'byok'];
  if (fulfills.includes('mysql'))              return ['provider-managed', 'byok'];
  if (fulfills.includes('nosql_database'))     return ['provider-managed', 'byok'];
  if (fulfills.includes('vm_compute'))         return ['provider-managed', 'byok'];
  if (fulfills.includes('container_registry')) return ['provider-managed', 'byok'];
  return ['provider-managed'];
}

// ---------------------------------------------------------------------------
// Upgrade message (mirrors generate-tf pattern)
// ---------------------------------------------------------------------------
const UPGRADE_MESSAGE = [
  '[LICENSE] LZ catalogue update requires a Consultant or Enterprise licence.',
  'Run `swao license request` to obtain a licence.',
  'Contact: https://github.com/Accenture/SWAO/discussions',
].join('\n');

// ---------------------------------------------------------------------------
// registerLzCatalogueUpdate
// ---------------------------------------------------------------------------

/**
 * Register `swao lz catalogue update` (premium; consultant+).
 * Attaches to the existing `lz catalogue` command group already registered by
 * `registerLz` (community). Must be called AFTER `registerLz`.
 * Design 065 §5.6 (revised): fetches AWS endpoints.json from the AWS-owned
 * boto/botocore GitHub repo; falls back to a locally installed AWS CLI copy
 * for air-gapped environments. No credentials required.
 */
export function registerLzCatalogueUpdate(program: Command): void {
  const lz = program.commands.find((c) => c.name() === 'lz');
  if (!lz) throw new Error('lz command group not registered; call registerLz before registerLzCatalogueUpdate');

  const catalogue = lz.commands.find((c) => c.name() === 'catalogue');
  if (!catalogue) throw new Error('catalogue subcommand not found on lz group');

  catalogue
    .command('update')
    .description(
      'Refresh the LZ service catalogue (Consultant+; no credentials required). ' +
      'AWS: fetches from the AWS-owned boto/botocore GitHub repo; falls back to a locally installed AWS CLI copy when offline. ' +
      'STACKIT: fetches from the STACKIT PIM API (pim.api.stackit.cloud/v1/skus). ' +
      'GCP: fetches from the GoogleCloudPlatform/region-picker products.json. ' +
      'Azure: fetches the Azure Retail Prices API (prices.azure.com; fully anonymous). ' +
      'The bundled SWAO catalogue is used by default for assessments; run this command before an engagement to get the latest service list.',
    )
    .option('--provider <name>', 'CSP provider: aws, aws-esc, aws-iso-e, stackit, gcp, azure, or "all"', 'all')
    .option('--endpoints-path <path>', 'Local endpoints.json override for AWS (air-gapped / CI; skips GitHub fetch)')
    .option('--botocore-path <path>', 'Alias for --endpoints-path (backward compat)')
    .option('--products-path <path>', 'Local products.json override for GCP (air-gapped / CI; skips GitHub fetch)')
    .option('--azure-prices-path <path>', 'Local JSON file override for Azure Retail Prices data (air-gapped / CI)')
    .option('--catalogues-dir <path>', 'Override the lz-catalogues output directory')
    .option('--dry-run', 'Print catalogue stats without writing files')
    .action(async (opts: {
      provider: string;
      endpointsPath?: string;
      botocorePath?: string;
      productsPath?: string;
      azurePricesPath?: string;
      cataloguesDir?: string;
      dryRun?: boolean;
    }) => {
      // --- tier gate (mirrors generate-tf pattern) -------------------------
      let guard;
      try {
        guard = LicenseGuard.load();
      } catch (e) {
        if (e instanceof LicenseInvalidError) {
          console.error(e.message);
          process.exit(3);
        }
        throw e;
      }
      try {
        guard.requireTier('consultant', { feature: 'lz catalogue update' });
      } catch (e) {
        if (e instanceof LicenseTierError || e instanceof LicenseLimitError) {
          console.error(UPGRADE_MESSAGE);
          process.exit(2);
        }
        throw e;
      }

      // #0921: emit catalogue update start event for log consumers.
      const _catalogueUpdateStartedAt = Date.now();
      try {
        logPortfolio('info', 'lz.catalogue.update.start',
          `LZ catalogue update starting (provider: ${opts.provider})`,
          { context: { provider: opts.provider, dry_run: opts.dryRun ?? false } },
        );
      } catch { /* logging is best-effort */ }

      // --- resolve target partitions ----------------------------------------
      const providerFilter = opts.provider === 'all' ? null : opts.provider;

      // Load catalogue index to discover curated providers dynamically.
      // Any provider with source === "curated" in index.json has no automated
      // adapter and receives a skip message. No code change here is required
      // when new curated catalogues are added to index.json.
      let indexCuratedProviders: string[] = [];
      {
        const bundledDir = resolveLzCataloguesDir();
        if (bundledDir) {
          try {
            const { catalogues } = loadLzCatalogueIndex(bundledDir);
            indexCuratedProviders = catalogues
              .filter((c) => c.source === 'curated')
              .map((c) => c.provider);
          } catch { /* index unreadable; skip curated discovery */ }
        }
      }

      const targetPartitions = Object.keys(PARTITION_CONFIG).filter(
        (p) => !providerFilter || PARTITION_CONFIG[p].provider === providerFilter,
      );

      if (targetPartitions.length === 0) {
        // Check if the requested provider is a known curated catalogue.
        if (providerFilter && indexCuratedProviders.includes(providerFilter)) {
          console.log(
            `${providerFilter}: source.mode "curated" -- no automated adapter. ` +
            `Use \`swao lz catalogue copy ${providerFilter}\` to copy the bundled seed to your workspace for editing.`,
          );
          process.exit(0);
        }
        const valid = [...new Set(Object.values(PARTITION_CONFIG).map((c) => c.provider)), ...indexCuratedProviders, 'all'];
        console.error(`[error] Unknown provider "${opts.provider}". Valid: ${[...new Set(valid)].join(', ')}`);
        process.exit(1);
      }

      // Print skip messages for curated providers when updating 'all'.
      if (!providerFilter) {
        for (const cp of indexCuratedProviders) {
          console.log(
            `${cp}: source.mode "curated" -- no automated adapter. ` +
            `Use \`swao lz catalogue copy ${cp}\` to copy the bundled seed to your workspace for editing.`,
          );
        }
      }

      const automatedPartitions = targetPartitions;

      const botocorePartitions = automatedPartitions.filter((p) => p !== 'stackit' && p !== GCP_PARTITION_KEY && p !== 'azure');
      const needsStackit = automatedPartitions.includes('stackit');
      const needsGcp = automatedPartitions.includes(GCP_PARTITION_KEY);
      const needsAzure = automatedPartitions.includes('azure');

      // today is declared here (before any fetch) so Azure can pass it to
      // fetchAzureCatalogue for stable last_updated across all providers.
      const today = new Date().toISOString().slice(0, 10);

      // --- fetch endpoints.json only when AWS partitions are requested ------
      let endpointsData: string | undefined;
      let endpointsSource = '';

      if (botocorePartitions.length > 0) {
        try {
          const result = await fetchEndpointsJson(opts.endpointsPath ?? opts.botocorePath);
          endpointsData = result.data;
          endpointsSource = result.source;
        } catch {
          process.exit(1);
        }
      }

      // --- fetch STACKIT PIM API when stackit is requested ------------------
      let stackitSkus: StackitSku[] | undefined;

      if (needsStackit) {
        try {
          const resp = await fetch(STACKIT_PIM_URL, { signal: AbortSignal.timeout(30_000) });
          if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
          const body = (await resp.json()) as StackitPimResponse;
          stackitSkus = body.services ?? (body as unknown as StackitSku[]);
          console.log(`[lz catalogue update] STACKIT source: ${STACKIT_PIM_URL} (${stackitSkus.length} SKUs)`);
        } catch (fetchErr) {
          console.error(`[error] STACKIT PIM API fetch failed: ${(fetchErr as Error).message}`);
          console.error('  Fallback: hand-curate stackit.json or use stackitcloud/stackit-api-specifications for service names.');
          process.exit(1);
        }
      }

      // --- fetch GCP products.json when gcp is requested --------------------
      let gcpProductsData: string | undefined;
      let gcpProductsSource = '';

      if (needsGcp) {
        try {
          const result = await fetchGcpProducts(opts.productsPath);
          gcpProductsData = result.data;
          gcpProductsSource = result.source;
          console.log(`[lz catalogue update] GCP source: ${gcpProductsSource}`);
        } catch {
          process.exit(1);
        }
      }

      // --- fetch Azure Retail Prices when azure is requested ----------------
      // Delegates to fetchAzureCatalogue (fetch-azure.ts) which owns HTTP
      // pagination and normalisation. Enrichment (fulfills/key_custody/source)
      // is applied below after the catalogue is returned.
      let azureRawCatalogue: Awaited<ReturnType<typeof fetchAzureCatalogue>> | undefined;

      if (needsAzure) {
        try {
          azureRawCatalogue = await fetchAzureCatalogue({
            pricesPathOverride: opts.azurePricesPath,
            overlay: buildAzureSovereigntyOverlay(),
            operator: 'SWAO operator',
            lastUpdated: today,
          });
          const azureSrc = opts.azurePricesPath ?? AZURE_RETAIL_PRICES_URL;
          console.log(`[lz catalogue update] Azure source: ${azureSrc} (${azureRawCatalogue.meta.regions_count} region(s))`);
        } catch (err) {
          console.error(`[error] Azure Retail Prices fetch failed: ${(err as Error).message}`);
          console.error('  Options:');
          console.error('    1. Connect to the internet and retry.');
          console.error('    2. Use --azure-prices-path <file> to supply a local prices page.');
          process.exit(1);
        }
      }

      // --- find output dir (update writes to workspace; bundled catalogue is read-only) ---
      // When --catalogues-dir is not supplied, resolve the workspace and write to
      // <workspace>/lz-catalogues/.  The bundled _lz-catalogues dir inside the pkg
      // snapshot is read-only; writing there always fails with ENOENT / EROFS.
      let dir: string;
      if (opts.cataloguesDir) {
        dir = resolve(opts.cataloguesDir);
      } else {
        const workspace = findWorkspace(process.cwd());
        if (!workspace) {
          console.error(
            '[error] Cannot find a SWAO workspace (no .swao.yml in current or parent directories). ' +
            'Run `swao init` to initialise one, or use --catalogues-dir to specify an output directory.',
          );
          process.exit(1);
        }
        dir = join(workspace, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
      }

      // Bootstrap the workspace catalogue directory on first refresh.
      if (!existsSync(dir)) {
        if (!opts.dryRun) {
          mkdirSync(dir, { recursive: true });
          const bundledDir = resolveLzCataloguesDir();
          const seedIndex = bundledDir && existsSync(join(bundledDir, 'index.json'))
            ? readFileSync(join(bundledDir, 'index.json'), 'utf-8')
            : JSON.stringify({ catalogues: [], coming_soon: [] }, null, 2) + '\n';
          writeFileSync(join(dir, 'index.json'), seedIndex, 'utf-8');
          console.log(`[lz catalogue update] Created workspace catalogue directory: ${dir}`);
        } else {
          console.log(`[dry-run] Would create workspace catalogue directory: ${dir}`);
        }
      }

      if (endpointsSource) console.log(`[lz catalogue update] source:  ${endpointsSource}`);
      console.log(`[lz catalogue update] output:  ${dir}\n`);

      const updatedEntries: Array<{
        provider: string; file: string; name: string;
        last_updated: string; source: string; confidence: string;
      }> = [];
      const allDiffs: Record<string, CatalogueDiff> = {};

      // --- process botocore (AWS) partitions --------------------------------
      if (endpointsData) {
        const endpoints = JSON.parse(endpointsData) as {
          partitions?: BotocorePartition[];
        };

        for (const partitionId of botocorePartitions) {
          const partitionData = endpoints.partitions?.find((p) => p.partition === partitionId);
          if (!partitionData) {
            console.warn(`[warn] partition "${partitionId}" not found in endpoints.json -- skipping`);
            continue;
          }

          const config = PARTITION_CONFIG[partitionId]!;
          const outPath = join(dir, config.outputFile);
          const prevCatalogueAws = existsSync(outPath) ? (() => { try { return JSON.parse(readFileSync(outPath, 'utf-8')) as LooseCatalogue; } catch { return null; } })() : null;
          const freshCatalogue = buildCatalogueFromPartition(partitionData, config, today) as LooseCatalogue;
          const catalogue = mergeRetiredServices(freshCatalogue, outPath, today);
          allDiffs[config.provider] = computeCatalogueDiff(prevCatalogueAws, catalogue);
          const regionCount = (catalogue.regions ?? []).length;
          const serviceTotal = (catalogue.regions ?? []).reduce((s, r) => s + (r.services?.length ?? 0), 0);
          const retiredTotal = (catalogue.regions ?? []).reduce(
            (s, r) => s + (r.services?.filter((sv) => sv.status === 'retired').length ?? 0), 0,
          );

          console.log(
            `${config.provider}: ${regionCount} region(s), ${serviceTotal - retiredTotal} active + ${retiredTotal} retired service entries`,
          );

          if (opts.dryRun) {
            console.log(`  [dry-run] would write: ${outPath}`);
          } else {
            writeFileSync(outPath, JSON.stringify(catalogue, null, 2) + '\n', 'utf-8');
            console.log(`  written: ${outPath}`);
          }

          updatedEntries.push({
            provider: config.provider,
            file:     config.outputFile,
            name:     config.name,
            last_updated: today,
            source:   'botocore-endpoints',
            confidence: config.confidence,
          });
        }
      }

      // --- process STACKIT partition ----------------------------------------
      if (stackitSkus !== undefined) {
        const config = PARTITION_CONFIG['stackit']!;
        const outPath = join(dir, config.outputFile);
        const prevCatalogueStackit = existsSync(outPath) ? (() => { try { return JSON.parse(readFileSync(outPath, 'utf-8')) as LooseCatalogue; } catch { return null; } })() : null;
        const freshCatalogue = normalizeStackitSkus(stackitSkus, { lastUpdated: today, operator: 'SWAO operator' }) as unknown as LooseCatalogue;
        const catalogue = mergeRetiredServices(freshCatalogue, outPath, today);
        allDiffs[config.provider] = computeCatalogueDiff(prevCatalogueStackit, catalogue);
        const regionCount = (catalogue.regions ?? []).length;
        const serviceTotal = (catalogue.regions ?? []).reduce((s, r) => s + (r.services?.length ?? 0), 0);
        const retiredTotal = (catalogue.regions ?? []).reduce(
          (s, r) => s + (r.services?.filter((sv) => sv.status === 'retired').length ?? 0), 0,
        );
        console.log(
          `${config.provider}: ${regionCount} region(s), ${serviceTotal - retiredTotal} active + ${retiredTotal} retired service entries`,
        );

        if (opts.dryRun) {
          console.log(`  [dry-run] would write: ${outPath}`);
        } else {
          writeFileSync(outPath, JSON.stringify(catalogue, null, 2) + '\n', 'utf-8');
          console.log(`  written: ${outPath}`);
        }

        updatedEntries.push({
          provider: config.provider,
          file:     config.outputFile,
          name:     config.name,
          last_updated: today,
          source:   'pim-api-stackit',
          confidence: config.confidence,
        });
      }

      // --- process GCP partition (region-picker products.json) --------------
      if (gcpProductsData !== undefined) {
        const gcpConfig = PARTITION_CONFIG[GCP_PARTITION_KEY]!;
        const outPath = join(dir, gcpConfig.outputFile);
        const prevCatalogueGcp = existsSync(outPath) ? (() => { try { return JSON.parse(readFileSync(outPath, 'utf-8')) as LooseCatalogue; } catch { return null; } })() : null;
        const matrix = JSON.parse(gcpProductsData) as Record<string, Record<string, boolean>>;
        const freshCatalogue = normalizeGcpProducts(matrix, {
          lastUpdated: today,
          operator: 'SWAO operator',
        }) as unknown as LooseCatalogue;
        const catalogue = mergeRetiredServices(freshCatalogue, outPath, today);
        allDiffs[gcpConfig.provider] = computeCatalogueDiff(prevCatalogueGcp, catalogue);
        const regionCount = (catalogue.regions ?? []).length;
        const serviceTotal = (catalogue.regions ?? []).reduce((s, r) => s + (r.services?.length ?? 0), 0);
        const retiredTotal = (catalogue.regions ?? []).reduce(
          (s, r) => s + (r.services?.filter((sv) => sv.status === 'retired').length ?? 0), 0,
        );

        console.log(
          `${gcpConfig.provider}: ${regionCount} region(s), ${serviceTotal - retiredTotal} active + ${retiredTotal} retired service entries`,
        );

        if (opts.dryRun) {
          console.log(`  [dry-run] would write: ${outPath}`);
        } else {
          writeFileSync(outPath, JSON.stringify(catalogue, null, 2) + '\n', 'utf-8');
          console.log(`  written: ${outPath}`);
        }

        updatedEntries.push({
          provider: gcpConfig.provider,
          file:     gcpConfig.outputFile,
          name:     gcpConfig.name,
          last_updated: today,
          source:   'region-picker-github',
          confidence: gcpConfig.confidence,
        });
      }

      // --- process Azure partition (Retail Prices API) ---------------------
      if (azureRawCatalogue !== undefined) {
        const azureConfig = PARTITION_CONFIG['azure']!;
        const outPath = join(dir, azureConfig.outputFile);
        const prevCatalogueAzure = existsSync(outPath) ? (() => { try { return JSON.parse(readFileSync(outPath, 'utf-8')) as LooseCatalogue; } catch { return null; } })() : null;

        // Enrich fulfills + key_custody + source (fetchAzureCatalogue leaves them empty).
        // Apply DEFAULT_AZURE_SOVEREIGNTY to regions absent from the curated overlay.
        for (const region of azureRawCatalogue.regions) {
          if (!region.sovereignty) {
            (region as Record<string, unknown>).sovereignty = { ...DEFAULT_AZURE_SOVEREIGNTY };
            if (!region.country) (region as Record<string, unknown>).country = DEFAULT_AZURE_SOVEREIGNTY.residency_country;
          }
          for (const svc of region.services) {
            svc.fulfills = AZURE_SERVICE_FULFILLS[svc.code] ?? [];
            svc.key_custody = keyCustodyForAzure(svc.code, svc.fulfills);
            svc.source = 'retail-prices-api';
          }
        }
        azureRawCatalogue.meta.source = { mode: 'api', tool: 'retail-prices-api', operator: 'SWAO operator' };
        azureRawCatalogue.meta.name = azureConfig.name;

        const freshCatalogue = azureRawCatalogue as unknown as LooseCatalogue;
        const catalogue = mergeRetiredServices(freshCatalogue, outPath, today);
        allDiffs[azureConfig.provider] = computeCatalogueDiff(prevCatalogueAzure, catalogue);
        const regionCount = (catalogue.regions ?? []).length;
        const serviceTotal = (catalogue.regions ?? []).reduce((s, r) => s + (r.services?.length ?? 0), 0);
        const retiredTotal = (catalogue.regions ?? []).reduce(
          (s, r) => s + (r.services?.filter((sv) => sv.status === 'retired').length ?? 0), 0,
        );

        console.log(
          `${azureConfig.provider}: ${regionCount} region(s), ${serviceTotal - retiredTotal} active + ${retiredTotal} retired service entries`,
        );

        if (opts.dryRun) {
          console.log(`  [dry-run] would write: ${outPath}`);
        } else {
          writeFileSync(outPath, JSON.stringify(catalogue, null, 2) + '\n', 'utf-8');
          console.log(`  written: ${outPath}`);
        }

        updatedEntries.push({
          provider: azureConfig.provider,
          file:     azureConfig.outputFile,
          name:     azureConfig.name,
          last_updated: today,
          source:   'retail-prices-api',
          confidence: azureConfig.confidence,
        });
      }

      // --- update index.json -----------------------------------------------
      const indexPath = join(dir, 'index.json');
      if (existsSync(indexPath)) {
        const existingIndex = JSON.parse(readFileSync(indexPath, 'utf-8')) as {
          catalogues: Array<{ provider: string }>;
          generated_at?: string;
          seed_generated_at?: string;
        };
        // Preserve original seed date on first refresh (#0914).
        if (!existingIndex.seed_generated_at && existingIndex.generated_at) {
          existingIndex.seed_generated_at = existingIndex.generated_at;
        }
        existingIndex.generated_at = today;
        for (const entry of updatedEntries) {
          const idx = existingIndex.catalogues.findIndex((c) => c.provider === entry.provider);
          if (idx >= 0) existingIndex.catalogues[idx] = entry;
          else existingIndex.catalogues.push(entry);
        }
        if (opts.dryRun) {
          console.log(`\n[dry-run] would update: ${indexPath}`);
        } else {
          writeFileSync(indexPath, JSON.stringify(existingIndex, null, 2) + '\n', 'utf-8');
          console.log(`\nupdated: ${indexPath}`);
        }
      }

      if (!opts.dryRun) console.log('\nDone. Run `swao lz catalogue list` to verify.');

      // #0921: emit catalogue update complete event.
      try {
        const anyCertChanged = Object.values(allDiffs).some(
          (pd) => Object.values(pd).some((rd) => rd.certifications_changed),
        );
        const logLevel = anyCertChanged ? 'warn' : 'info';
        const certWarnMsg = anyCertChanged
          ? ' SOVEREIGNTY CERTIFICATIONS CHANGED -- re-run LZ Assessment to update verdicts.'
          : '';
        logPortfolio(logLevel, 'lz.catalogue.update.complete',
          `LZ catalogue update complete (${updatedEntries.length} provider(s) written).${certWarnMsg}`,
          {
            context: {
              provider: opts.provider,
              providers_updated: updatedEntries.map(e => e.provider),
              duration_ms: Date.now() - _catalogueUpdateStartedAt,
              dry_run: opts.dryRun ?? false,
              diff: Object.keys(allDiffs).length > 0 ? allDiffs : undefined,
            },
          },
        );
      } catch { /* logging is best-effort */ }
    });
}
