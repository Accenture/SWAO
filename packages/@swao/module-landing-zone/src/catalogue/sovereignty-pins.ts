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

// #3282: refresh overlay pins -- the curated region -> sovereignty facts that
// `swao lz catalogue update` (lz-premium.ts, fetch-gcp.ts) and the dev refresh
// scripts (scripts/refresh-lz-catalogue-*.mjs) stamp onto every refreshed
// catalogue (D-LZ-07). Moved here unchanged from lz-premium.ts and
// fetch-gcp.ts so the LZ catalogue quality checks (catalogue/quality.ts) and
// the audit gate (tests/audit-gates/lz-catalogue-quality.gate.mjs) compare the
// shipped catalogues against the very same pins the refresh writes.
//
// This file must stay free of runtime imports: the audit gate loads it with
// Node's TypeScript type stripping on a source-only checkout.

/** Sovereignty facts pinned for one region (the four D-LZ-07 fact fields). */
export interface LzSovereigntyPin {
  residency_country: string;
  operator_jurisdiction: string;
  extraterritorial_exposure: string[];
  certifications: string[];
}

/** GCP pins also carry the region display name used by the refresh. */
export interface GcpSovereigntyPin extends LzSovereigntyPin {
  display: string;
}

// ---------------------------------------------------------------------------
// AWS (all partitions: aws, aws-eusc, aws-iso-e), keyed by region id.
// Single source (#3302): the dev refresh scripts import this table.
// ---------------------------------------------------------------------------
export const AWS_SOVEREIGNTY_PINS: Record<string, LzSovereigntyPin> = {
  'eu-central-1':   { residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['BSI_C5', 'ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'eu-central-2':   { residency_country: 'CH', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'eu-north-1':     { residency_country: 'SE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['BSI_C5', 'ISO_27001', 'SOC_2', 'PCI_DSS'] },
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
  // #3287 (2026-10-17): residency from the AWS Regions page (LZ_SOVEREIGNTY_PIN_SOURCES);
  // the other facts are the refresh defaults the catalogue already carried.
  'ap-east-2':      { residency_country: 'TW', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'ap-southeast-5': { residency_country: 'MY', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'ap-southeast-6': { residency_country: 'NZ', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'ap-southeast-7': { residency_country: 'TH', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'eusc-de-east-1': { residency_country: 'DE', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: ['BSI_C5', 'ISO_27001'] },
  // #1382: operator entity, exposure, and certifications of the ISOE partition are
  // not publicly substantiated; keep the conservative facts and low confidence.
  'eu-isoe-west-1': { residency_country: 'EU', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: [] },
};

// ---------------------------------------------------------------------------
// Azure, keyed by armRegionName.
// Single source (#3302): the dev refresh scripts import this table.
// ---------------------------------------------------------------------------
export const AZURE_SOVEREIGNTY_PINS: Record<string, LzSovereigntyPin> = {
  // Europe
  'germanywestcentral':  { residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['BSI_C5', 'ISO_27001', 'SOC_2'] },
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
  // #3287 (2026-10-17): residency from Microsoft region documentation
  // (LZ_SOVEREIGNTY_PIN_SOURCES); the other facts are the refresh defaults the
  // catalogue already carried.
  'germanynorth':        { residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'swedensouth':         { residency_country: 'SE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'indiasouthcentral':   { residency_country: 'IN', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'taiwannorthwest':     { residency_country: 'TW', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'eastus3':             { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'usgovarizona':        { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'usgovtexas':          { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'usgovvirginia':       { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'usgoviowa':           { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
  'usdodeast':           { residency_country: 'US', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
};

// ---------------------------------------------------------------------------
// GCP, keyed by region code (see the C5 note in fetch-gcp.ts).
// ---------------------------------------------------------------------------
export const GCP_SOVEREIGNTY_PINS: Record<string, GcpSovereigntyPin> = {
  // Europe
  'europe-west1':          { display: 'Belgium',                   residency_country: 'BE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'europe-west2':          { display: 'London, United Kingdom',    residency_country: 'GB', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'europe-west3':          { display: 'Frankfurt, Germany',        residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['BSI_C5', 'ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'europe-west4':          { display: 'Netherlands',               residency_country: 'NL', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['BSI_C5', 'ISO_27001', 'SOC_2', 'PCI_DSS'] },
  'europe-west6':          { display: 'Zurich, Switzerland',       residency_country: 'CH', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'europe-west8':          { display: 'Milan, Italy',              residency_country: 'IT', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'europe-west9':          { display: 'Paris, France',             residency_country: 'FR', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'europe-west10':         { display: 'Berlin, Germany',           residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['BSI_C5', 'ISO_27001', 'SOC_2'] },
  'europe-west12':         { display: 'Turin, Italy',              residency_country: 'IT', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'europe-north1':         { display: 'Finland',                   residency_country: 'FI', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'europe-central2':       { display: 'Warsaw, Poland',            residency_country: 'PL', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  'europe-southwest1':     { display: 'Madrid, Spain',             residency_country: 'ES', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001', 'SOC_2'] },
  // #3287 (2026-10-17): residency from the GCP regions and zones page (LZ_SOVEREIGNTY_PIN_SOURCES).
  'europe-north2':         { display: 'Stockholm, Sweden',         residency_country: 'SE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: ['ISO_27001'] },
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

/**
 * Pins per catalogue provider id. Providers without a refresh overlay
 * (curated catalogues, STACKIT) have no entry; their facts are sourced by the
 * catalogue's `meta.source.source_note`.
 */
export const LZ_SOVEREIGNTY_PINS: Record<string, Record<string, LzSovereigntyPin>> = {
  'aws': AWS_SOVEREIGNTY_PINS,
  'aws-esc': AWS_SOVEREIGNTY_PINS,
  'aws-iso-e': AWS_SOVEREIGNTY_PINS,
  'azure': AZURE_SOVEREIGNTY_PINS,
  'gcp': GCP_SOVEREIGNTY_PINS,
};

// ---------------------------------------------------------------------------
// #3287 (Design 110 D-17): provenance of residency pins added from provider
// region documentation, keyed `<pin table>/<region id>` (aws covers the aws,
// aws-esc and aws-iso-e catalogues). Kept apart from the pin objects because
// the catalogue schema's sovereignty block is strict. Older pins predate this
// map and are sourced by the refresh scripts' review history.
// ---------------------------------------------------------------------------
export interface LzSovereigntyPinSource {
  /** Public provider page that states the region's country. */
  url: string;
  /** Date the page was retrieved (YYYY-MM-DD). */
  retrieved: string;
  /** What the page states for the region. */
  note: string;
}

export const LZ_SOVEREIGNTY_PIN_SOURCES: Record<string, LzSovereigntyPinSource> = {
  'aws/ap-east-2': { url: 'https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html', retrieved: '2026-10-17', note: 'Code ap-east-2, Asia Pacific (Taipei), geography Taiwan' },
  'aws/ap-southeast-5': { url: 'https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html', retrieved: '2026-10-17', note: 'Code ap-southeast-5, Asia Pacific (Malaysia), geography Malaysia' },
  'aws/ap-southeast-6': { url: 'https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html', retrieved: '2026-10-17', note: 'Code ap-southeast-6, Asia Pacific (New Zealand), geography New Zealand' },
  'aws/ap-southeast-7': { url: 'https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html', retrieved: '2026-10-17', note: 'Code ap-southeast-7, Asia Pacific (Thailand), geography Thailand' },
  'azure/germanynorth': { url: 'https://learn.microsoft.com/en-us/azure/reliability/regions-list', retrieved: '2026-10-17', note: 'Germany North, physical location Berlin, geography Germany' },
  'azure/swedensouth': { url: 'https://learn.microsoft.com/en-us/azure/reliability/regions-list', retrieved: '2026-10-17', note: 'Sweden South, restricted paired region of Sweden Central, geography Sweden' },
  'azure/indiasouthcentral': { url: 'https://learn.microsoft.com/en-us/azure/reliability/regions-list', retrieved: '2026-10-17', note: 'India South Central, physical location Hyderabad, geography India' },
  'azure/taiwannorthwest': { url: 'https://learn.microsoft.com/en-us/azure/reliability/regions-list', retrieved: '2026-10-17', note: 'Taiwan Northwest, restricted paired region of Taiwan North, geography Taiwan' },
  'azure/eastus3': { url: 'https://azure.microsoft.com/en-us/blog/microsofts-commitment-to-supporting-cloud-infrastructure-demand-in-the-united-states/', retrieved: '2026-10-17', note: 'East US 3 region in the Greater Atlanta Metro area (Azure blog, 2025-12-09)' },
  'azure/usgovarizona': { url: 'https://learn.microsoft.com/en-us/azure/azure-government/documentation-government-welcome', retrieved: '2026-10-17', note: 'Azure Government region US Gov Arizona; Azure Government datacenters are located in the US only' },
  'azure/usgovtexas': { url: 'https://learn.microsoft.com/en-us/azure/azure-government/documentation-government-welcome', retrieved: '2026-10-17', note: 'Azure Government region US Gov Texas; Azure Government datacenters are located in the US only' },
  'azure/usgovvirginia': { url: 'https://learn.microsoft.com/en-us/azure/azure-government/documentation-government-welcome', retrieved: '2026-10-17', note: 'Azure Government region US Gov Virginia; Azure Government datacenters are located in the US only' },
  'azure/usgoviowa': { url: 'https://devblogs.microsoft.com/azuregov/?p=7346', retrieved: '2026-10-17', note: 'Azure Government blog (2017-08-01) lists US Gov Iowa among all Azure Government regions; Azure Government datacenters are located in the US only (https://learn.microsoft.com/en-us/azure/azure-government/documentation-government-welcome)' },
  'azure/usdodeast': { url: 'https://learn.microsoft.com/en-us/azure/azure-government/documentation-government-overview-dod', retrieved: '2026-10-17', note: 'US DoD East is an Azure Government region; Azure Government datacenters are located in the US only (https://learn.microsoft.com/en-us/azure/azure-government/documentation-government-welcome)' },
  'gcp/europe-north2': { url: 'https://docs.cloud.google.com/compute/docs/regions-zones', retrieved: '2026-10-17', note: 'Zones europe-north2-a/b/c: Stockholm, Sweden, Europe' },
};
