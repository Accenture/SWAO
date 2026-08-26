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
 * refresh-lz-catalogue-azure.mjs -- build azure.json from Azure Retail Prices API.
 *
 * Fetches service-by-region availability from the Azure Retail Prices API
 * (no credentials, no Azure account required) and emits
 * swao/lz-catalogues/azure.json in the standard LzServiceCatalogue schema.
 *
 * API: GET https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview
 *      Paginated via NextPageLink; 1,000 records per page.
 *      Docs: https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices
 *
 * Strategy:
 *   1. Fetch all pages (follow NextPageLink until null), collecting unique
 *      (serviceName, armRegionName) pairs.
 *   2. Map serviceName to SWAO capability vocabulary via SERVICE_FULFILLS.
 *   3. Apply SOVEREIGNTY_OVERLAY for sovereignty facts per armRegionName.
 *   4. Emit azure.json.
 *
 * Known limitations (see issue spec #0869):
 *   - Free services (Azure Active Directory, Resource Manager, IAM) have no
 *     pricing SKU and are absent from the Retail Prices API.
 *   - serviceName uses marketing names, not ARM provider namespaces. The
 *     SERVICE_FULFILLS map keys on marketing names for this provider.
 *
 * Usage:
 *   node scripts/refresh-lz-catalogue-azure.mjs
 *   node scripts/refresh-lz-catalogue-azure.mjs --dry-run
 *   node scripts/refresh-lz-catalogue-azure.mjs --prices-path ./local-prices.json
 *
 * Output:
 *   swao/lz-catalogues/azure.json
 *
 * Requires: Node 18+ (built-in fetch). No npm dependencies.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOGUES_DIR = join(__dirname, '..', '..', '..', 'lz-catalogues');

const RETAIL_PRICES_URL =
  'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview';
const MAX_PAGES = 500; // safety cap -- the API has ~700-900 pages; raise if needed

const dryRun = process.argv.includes('--dry-run');
const pricesFlagIdx = process.argv.indexOf('--prices-path');
const pricesPathOverride = pricesFlagIdx !== -1 ? process.argv[pricesFlagIdx + 1] : null;

// ---------------------------------------------------------------------------
// SERVICE_FULFILLS -- maps Azure Retail Prices API serviceName (marketing name)
// to SWAO capability vocabulary (Design 056 D-LZ-08).
// Mirror of lz-premium.ts AZURE_SERVICE_FULFILLS -- keep in sync on updates.
// ---------------------------------------------------------------------------
const SERVICE_FULFILLS = {
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
  'Azure Notification Hubs':                   ['messaging'],
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
// SOVEREIGNTY_OVERLAY -- per-region sovereignty facts (Design 056 D-LZ-07).
// Key: armRegionName from Azure Retail Prices API.
// Mirror of lz-premium.ts AZURE_SOVEREIGNTY_OVERLAY -- keep in sync on updates.
// ---------------------------------------------------------------------------
const SOVEREIGNTY_OVERLAY = {
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

const DEFAULT_SOVEREIGNTY = {
  residency_country: 'UNKNOWN',
  operator_jurisdiction: 'US-entity',
  extraterritorial_exposure: ['us_cloud_act', 'fisa_702'],
  certifications: ['ISO_27001'],
};

// ---------------------------------------------------------------------------
// Step 1: fetch all pages from Azure Retail Prices API
// ---------------------------------------------------------------------------

/**
 * Fetch all (serviceName, armRegionName) pairs from the Retail Prices API.
 * Follows NextPageLink pagination; stops at MAX_PAGES to avoid infinite loops.
 *
 * @param {string | null} pricesPathArg  local file path (--prices-path) or null
 * @returns {Promise<Map<string, Set<string>>>}  Map<regionId, Set<serviceName>>
 */
async function fetchAllPages(pricesPathArg) {
  // Local file override (--prices-path / CI testing)
  if (pricesPathArg) {
    if (!existsSync(pricesPathArg)) {
      throw new Error(`--prices-path file not found: ${pricesPathArg}`);
    }
    console.log(`[refresh-lz-catalogue-azure] using local file: ${pricesPathArg}`);
    const payload = JSON.parse(readFileSync(pricesPathArg, 'utf-8'));
    const result = new Map();
    for (const item of payload.Items ?? []) {
      if (!item.serviceName || !item.armRegionName) continue;
      if (!result.has(item.armRegionName)) result.set(item.armRegionName, new Set());
      result.get(item.armRegionName).add(item.serviceName);
    }
    // Support a simple concatenated array (no pagination for local files)
    return result;
  }

  // Primary: HTTP fetch with pagination
  const result = new Map();
  let nextUrl = RETAIL_PRICES_URL;
  let pageCount = 0;

  while (nextUrl && pageCount < MAX_PAGES) {
    pageCount++;
    process.stderr.write(`  page ${pageCount} ...\r`);
    const resp = await fetch(nextUrl, {
      headers: { 'User-Agent': 'swao-lz-catalogue-refresh/0.1' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} -- ${nextUrl}`);
    const payload = await resp.json();

    for (const item of payload.Items ?? []) {
      if (!item.serviceName || !item.armRegionName) continue;
      if (!result.has(item.armRegionName)) result.set(item.armRegionName, new Set());
      result.get(item.armRegionName).add(item.serviceName);
    }

    nextUrl = payload.NextPageLink ?? null;
  }

  process.stderr.write('\n');
  if (pageCount >= MAX_PAGES && nextUrl) {
    console.warn(
      `[refresh-lz-catalogue-azure] page cap (${MAX_PAGES}) reached -- ` +
      'some data may be missing. Raise MAX_PAGES if the API has grown.',
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('[refresh-lz-catalogue-azure] fetching Azure Retail Prices API...');
const byRegion = await fetchAllPages(pricesPathOverride);

const regionCount = byRegion.size;
const pairCount = [...byRegion.values()].reduce((s, svcs) => s + svcs.size, 0);
console.log(
  `[refresh-lz-catalogue-azure] ${pairCount} (serviceName, region) pairs ` +
  `across ${regionCount} region(s)`,
);

if (dryRun) {
  console.log('\n[dry-run] regions:');
  for (const [region, svcs] of [...byRegion.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${region}: ${svcs.size} service(s)`);
  }
  console.log('\n[dry-run] --dry-run set, nothing written.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// mergeRetiredServices -- preserve retired services from the previous snapshot.
//
// For each region in `fresh`, any service code present in `old` but absent in
// `fresh` is appended with status "retired" and retired_at = today.
// An existing retired_at is preserved to keep the first-retirement date stable.
// ---------------------------------------------------------------------------

/**
 * @param {{ id: string; services: Array<{ code: string; status: string; retired_at?: string }> }[] } freshRegions
 * @param {{ id: string; services: Array<{ code: string; status: string; retired_at?: string }> }[] } oldRegions
 * @param {string} today  YYYY-MM-DD
 */
function mergeRetiredServices(freshRegions, oldRegions, today) {
  if (!oldRegions || !oldRegions.length) return freshRegions;

  for (const freshRegion of freshRegions) {
    const oldRegion = oldRegions.find((r) => r.id === freshRegion.id);
    if (!oldRegion) continue;

    const freshCodes = new Set(freshRegion.services.map((s) => s.code));

    for (const oldSvc of oldRegion.services) {
      if (freshCodes.has(oldSvc.code)) continue;
      if (oldSvc.status === 'retired') {
        freshRegion.services.push(oldSvc);
      } else {
        freshRegion.services.push({
          ...oldSvc,
          status: 'retired',
          retired_at: today,
        });
      }
    }

    // Stable sort: active first (alphabetical), then retired
    freshRegion.services.sort((a, b) => {
      if (a.status === 'retired' && b.status !== 'retired') return 1;
      if (a.status !== 'retired' && b.status === 'retired') return -1;
      return a.code.localeCompare(b.code);
    });
  }

  return freshRegions;
}

// ---------------------------------------------------------------------------
// Steps 2 + 3: build catalogue
// ---------------------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);

const regions = [...byRegion.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([regionId, serviceNames]) => {
    const sov = SOVEREIGNTY_OVERLAY[regionId] ?? DEFAULT_SOVEREIGNTY;
    const services = [...serviceNames]
      .sort((a, b) => a.localeCompare(b))
      .map((serviceName) => {
        const fulfills = SERVICE_FULFILLS[serviceName] ?? [];
        const keyCustody =
          serviceName === 'Azure Key Vault'   ? ['provider-managed', 'byok', 'hyok'] :
          serviceName === 'Azure Managed HSM' ? ['provider-managed', 'byok', 'hyok'] :
          fulfills.includes('object_storage') ? ['provider-managed', 'byok'] :
          fulfills.includes('postgresql')     ? ['provider-managed', 'byok'] :
          fulfills.includes('mysql')          ? ['provider-managed', 'byok'] :
          fulfills.includes('nosql_database') ? ['provider-managed', 'byok'] :
          fulfills.includes('vm_compute')     ? ['provider-managed', 'byok'] :
          fulfills.includes('container_registry') ? ['provider-managed', 'byok'] :
          ['provider-managed'];
        return {
          code:          serviceName,
          name:          serviceName,
          status:        'ga',
          capabilities:  [],
          fulfills,
          key_custody:   keyCustody,
          last_verified: today,
          source:        'retail-prices-api',
        };
      });
    return {
      id: regionId,
      country: sov.residency_country,
      sovereignty: {
        residency_country:         sov.residency_country,
        operator_jurisdiction:     sov.operator_jurisdiction,
        extraterritorial_exposure: sov.extraterritorial_exposure,
        certifications:            sov.certifications,
      },
      services,
    };
  });

const catalogue = {
  meta: {
    schema_version: '0.1',
    name:           'Azure service catalogue',
    provider:       'azure',
    last_updated:   today,
    source: {
      mode:     'api',
      tool:     'retail-prices-api',
      operator: 'SWAO operator',
    },
    confidence:    'high',
    regions_count: regions.length,
  },
  regions,
};

// ---------------------------------------------------------------------------
// Step 4: merge retired services from existing catalogue
// ---------------------------------------------------------------------------

const outPath = join(CATALOGUES_DIR, 'azure.json');
let existingRegions = [];
if (existsSync(outPath)) {
  try {
    const existing = JSON.parse(readFileSync(outPath, 'utf-8'));
    existingRegions = existing.regions ?? [];
  } catch {
    existingRegions = [];
  }
}

mergeRetiredServices(catalogue.regions, existingRegions, today);

// ---------------------------------------------------------------------------
// Step 5: write output
// ---------------------------------------------------------------------------

writeFileSync(outPath, JSON.stringify(catalogue, null, 2) + '\n', 'utf-8');

const activeCount  = catalogue.regions.reduce(
  (s, r) => s + r.services.filter((sv) => sv.status !== 'retired').length, 0,
);
const retiredCount = catalogue.regions.reduce(
  (s, r) => s + r.services.filter((sv) => sv.status === 'retired').length, 0,
);
const retiredSuffix = retiredCount > 0 ? `, ${retiredCount} retired` : '';
console.log(
  `[refresh-lz-catalogue-azure] done. ` +
  `${catalogue.regions.length} region(s), ${activeCount} active${retiredSuffix}.`,
);
console.log(`[refresh-lz-catalogue-azure] output -> ${outPath}`);
