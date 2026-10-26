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

import type { Command } from 'commander';
import type {
  SwaoModuleManifest,
  AssessmentTypeContribution,
  CommandContribution,
} from '@swao/core';
import { registerLz } from './commands/lz.js';

/**
 * @swao/module-landing-zone -- the landing-zone assessment type (Design 056,
 * ADR-0047 / ADR-0039). Three layers:
 *   A) CSP service catalogue (region- + sovereignty-aware "what is available")
 *   B) customer LZ scan (IaC / config-export ingestion + opt-in live read-only)
 *   C) fit/gap report vs the app's assessed needs (headline) + comparison.
 *
 * Scaffold (#0564): the manifest registers `type: landing-zone` as comingSoon
 * `swao assess --type landing-zone` is wired (#0567): the CLI assess command
 * drives it inline (it needs provider/region config + the app WSP's derived
 * required services, bridging the app-assessment loaders + core
 * deriveConstraints). The contribution is registered for routing/discovery;
 * the orchestration entry point is the CLI dispatch (mirrors how the audit type
 * is driven inline). Sovereignty is framework-driven (D-LZ-07): the catalogue
 * stores facts, the installed community frameworks supply the verdict.
 */
export const landingZoneAssessmentType: AssessmentTypeContribution = {
  type: 'landing-zone-catalog',
  description:
    'Landing-zone catalog assessment: CSP service catalog + customer LZ scan + fit/gap report (Design 056, ADR-0051).',
  run: async () => {
    throw new Error(
      'type:landing-zone is dispatched inline by the `swao assess` command (it needs ' +
        'provider/region config + the app WSP). Run `swao assess --type landing-zone --app <id> ' +
        '--lz-provider <p> --lz-region <r>`.',
    );
  },
};

// Layer A catalogue fetchers (#0565): operator-fed normalisers (no SDK/creds).
export { normalizeAwsSsmCatalogue } from './catalogue/fetch-aws.js';
export type { SsmParameter, AwsRegionOverlay } from './catalogue/fetch-aws.js';
export { normalizeAzureProducts, isAzurePseudoRegion } from './catalogue/fetch-azure.js';
export type { AzureAvailabilityRow, AzureRegionOverlay } from './catalogue/fetch-azure.js';
// #3288 (Design 110 D-23): VM price fetchers for the service cost model.
export {
  fetchAzureVmPrices,
  fetchAwsVmPrices,
  buildVmPriceTable,
  VmPriceFetchError,
  AZURE_RETAIL_PRICES_API,
  AWS_PRICE_LIST_BULK_API,
} from './catalogue/fetch-vm-prices.js';
export type { VmPriceFetchOptions, VmPriceFetchResult } from './catalogue/fetch-vm-prices.js';

// Layer B customer LZ scan normalisers (#0566): operator-fed snapshot/IaC/export
// -> normalised LzScanResult (no creds; Mode C live reuses these via a transport).
export { normalizeAwsSnapshot } from './scan/scan-aws.js';
export type { AwsScanOptions } from './scan/scan-aws.js';
export { normalizeAzureSnapshot } from './scan/scan-azure.js';
export type { AzureScanOptions } from './scan/scan-azure.js';

// Layer C fit/gap engine (#0567): the headline LZ deliverable.
export { computeLzFit, sovereigntyFailures, certificationKey, holdsCertification, toLzRequiredServices } from './fit/lz-fit.js';
export { orchestrateLandingZone, deriveSovereigntyRequirements } from './fit/orchestrate-lz.js';
export type { OrchestrateLzInput, FrameworkSovereigntyDecl } from './fit/orchestrate-lz.js';
export { assembleLandingZoneWsp, assembleLzCatalogWsp, readFrameworkSovereigntyDecls, discoverGateCapableFrameworks } from './fit/run-lz.js';
export type { AssembleLzInput, AssembleLzResult, GateCapableFramework } from './fit/run-lz.js';
export type {
  LzFitReport,
  LzFitItem,
  LzFitVerdict,
  LzOverallVerdict,
  LzRequiredService,
  SovereigntyRequirements,
  LzFitInput,
} from './fit/lz-fit.js';

// Verdict narrative generator (#1358): plain-language reasoning for LZ verdicts.
export { generateLzNarrative } from './fit/lz-narrative.js';
export type {
  LzVerdictNarrative,
  LzSovereigntyNarrative,
  LzServiceCheckNarrative,
  LzSovereigntyFactsInput,
} from './fit/lz-narrative.js';

// CLI surface (#0567): catalogue loader + the `swao lz` command group.
export {
  resolveLzCataloguesDir,
  resolveBundledLzCataloguesDir,
  listLzCatalogueProviders,
  // #3298 (Design 110 E-24): the list is built from each catalogue's own meta block.
  isLzCataloguesDir,
  scanLzCatalogueFiles,
  readLzCatalogueEntry,
  discoverLzCatalogues,
  listLzCatalogues,
  isLzCatalogueEntryError,
  lzCatalogueShortName,
  loadLzComingSoon,
  LZ_COMING_SOON_FILE,
  loadLzCatalogue,
  resolveProviderCatalogue,
  LzCatalogueSchemaError,
  LzCatalogueDuplicateIdError,
  checkLzCatalogueQuality,
} from './catalogue/loader.js';
export type {
  LzCatalogueFileRef,
  LzCatalogueEntry,
  LzCatalogueEntryError,
  LzCatalogueListing,
  LzCatalogueProvenance,
} from './catalogue/loader.js';
// #3282: LZ catalogue quality rules (shared by the health-check probe and the audit gate).
export {
  checkLzCatalogueDir,
  checkLzConfiguredTargets,
  readLzConfiguredTargets,
  lzRegionHint,
  formatLzQualityFindings,
  isLzProviderCatalogueFile,
  parseLzDate,
  LZ_CATALOGUE_QUALITY_RULES,
  LZ_CATALOGUE_MAX_AGE_DAYS,
  LZ_CATALOGUE_CONFIDENCE_VOCABULARY,
  LZ_SOVEREIGNTY_FACT_FIELDS,
} from './catalogue/quality.js';
export type {
  LzCatalogueQualityFinding,
  LzCatalogueQualityReport,
  LzCatalogueQualityOptions,
  LzCatalogueValidator,
  LzConfiguredTarget,
  LzTargetGeographyResolver,
  LzQualityRule,
  LzQualityRuleId,
  LzQualitySeverity,
} from './catalogue/quality.js';
// #3281: geography map for configured LZ targets (azure:Europe -> documented default region).
export {
  LZ_GEOGRAPHIES,
  LZ_GEOGRAPHY_COUNTRIES,
  LZ_GEOGRAPHY_PREFERRED_COUNTRY,
  lzGeographyKey,
  lzRegionResidency,
  lzRegionGeographies,
  lzGeographyDefaultRegion,
  resolveLzGeography,
  lzDeprecatedGeographyAlias,
  LZ_DEPRECATED_GEOGRAPHY_ALIASES,
} from './catalogue/geographies.js';
export type { LzGeography, LzGeographyRegion, LzGeographyResolution } from './catalogue/geographies.js';
export { lzProviderDisplayName, lzProviderLabel, lzRegionDisplayLabel } from './catalogue/labels.js';
export type { LzLabelRegion } from './catalogue/labels.js';
export { LZ_SOVEREIGNTY_PINS, AWS_SOVEREIGNTY_PINS, AZURE_SOVEREIGNTY_PINS, GCP_SOVEREIGNTY_PINS } from './catalogue/sovereignty-pins.js';
export type { LzSovereigntyPin, GcpSovereigntyPin } from './catalogue/sovereignty-pins.js';
export { registerLz } from './commands/lz.js';
// Premium CLI: catalogue update (consultant+; Design 065 §5.6).
export { registerLzCatalogueUpdate } from './commands/lz-premium.js';

export const assessmentTypes: AssessmentTypeContribution[] = [landingZoneAssessmentType];

export const commandContributions: CommandContribution[] = [
  {
    name: 'lz',
    description: 'Landing-zone catalogue + fit helpers (Design 056).',
    register: (program) => registerLz(program as Command),
  },
];

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-landing-zone',
  version: '0.1.0',
  tier: 'community',
  contributions: {
    assessmentTypes,
    commands: commandContributions,
  },
};
