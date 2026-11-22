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
export { computeLzFit, sovereigntyFailures, certificationKey, holdsCertification, toLzRequiredServices, lzFitVerdictForLiveStatus, deriveLzOverallVerdict, computeLzFitFromLiveScan } from './fit/lz-fit.js';
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

// Live evaluation engine (#3579, Design 120 sections 7.3, 8.1, 8.3).
export { evaluateLzLiveScan, lzLiveServiceLight, LZ_LIVE_CHECK_SEVERITY } from './evaluate/lz-live-eval.js';
export type {
  LzLiveLight,
  LzLiveCheckDefinition,
  LzLiveEvalFramework,
  LzLiveEvalInput,
  LzLiveEvalResult,
  LzLiveFindingSeverity,
  LzLiveScopeFinding,
} from './evaluate/lz-live-eval.js';
export {
  resolveLzLiveFrameworkIds,
  selectLzLiveFrameworks,
  lzLiveFrameworkProvenance,
  LzLiveManifestFrameworkSchema,
} from './evaluate/lz-live-frameworks.js';
export type { LzLiveManifestFramework, LzLiveFrameworkSelection } from './evaluate/lz-live-frameworks.js';
export { computeLzLiveDiff } from './evaluate/lz-live-diff.js';
// #4050 (Design 120 section 8.4): document-only evaluation of organisational controls.
export { evaluateLzOrganisationalControls, lzOrganisationalControls, lzOrganisationalExpectedInputs, toLzOrganisationalResult } from './evaluate/lz-organisational-eval.js';
export type { LzOrganisationalDocument, LzOrganisationalCatalogControl, LzOrganisationalFrameworkInput, LzOrganisationalEvalInput, LzOrganisationalEvaluatedControl, LzOrganisationalEvaluation } from './evaluate/lz-organisational-eval.js';
// #3871 (Design 123 section 8): Client LZ Policy Baseline evaluation.
export {
  evaluateLzBaseline,
  baselineServiceDenies,
  baselineCheckSeverity,
  baselineOverallVerdict,
  keyCustodyRank,
  observabilityWithoutEvidence,
  readBaselineControls,
} from './evaluate/lz-baseline-eval.js';
export type { LzBaselineEvalInput, LzBaselineEvalOutput, LzBaselineControl } from './evaluate/lz-baseline-eval.js';
export type { LzLiveSelectedBaseline } from './evaluate/lz-live-frameworks.js';
export { EU_MEMBER_STATES, residencyAllowed } from './fit/lz-fit.js';
export { sovereigntyRequirementProvenance } from './fit/orchestrate-lz.js';
export type { SovereigntyRequirementProvenance } from './fit/orchestrate-lz.js';

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
  collectLzCapabilityTags,  // #3577
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
export { LZ_SOVEREIGNTY_PINS, AWS_SOVEREIGNTY_PINS, AZURE_SOVEREIGNTY_PINS, GCP_SOVEREIGNTY_PINS, LZ_ACCEPTED_UNKNOWN_RESIDENCY } from './catalogue/sovereignty-pins.js';
export type { LzSovereigntyPin, GcpSovereigntyPin, LzAcceptedUnknownResidency } from './catalogue/sovereignty-pins.js';
export { registerLz } from './commands/lz.js';
// Premium CLI: catalogue update (consultant+; Design 065 §5.6).
export { registerLzCatalogueUpdate, runLiveCatalogueUpdateCli } from './commands/lz-premium.js';
// #3582: Update LZ Catalogue from a live run (Design 120 section 10.2)
export { runLiveCatalogueUpdate, mergeLiveIntoCatalogue, mergedConfidence, isManualCatalogueFile, resolveLzLiveCatalogueRun, formatLiveCatalogueDiff, LzLiveCatalogueUpdateError, LZ_NEW_CATALOGUE_SLUG_RE } from './catalogue/live-update.js';
export type { LiveCatalogueDiff, LiveCatalogueUpdateOptions, LiveCatalogueUpdateOutcome } from './catalogue/live-update.js';

// #3571: LiveLzDriver registry, read-only HTTP layer, endpoint seam, recorder
// and the connect / probe flow (Design 120 sections 6.3, 7.1, 13.2).
export { registerLiveLzDriver, getLiveLzDriver, registeredLiveLzProviders, unregisterLiveLzDriver, omitLzCollectors } from './live/registry.js';
export type { OmittableLzCollector } from './live/registry.js';
export { createReadOnlyFetch, ReadOnlyViolationError, LiveTokenRejectedError, AuthFailureLatch } from './live/http.js';
export type { ReadOnlyFetchOptions } from './live/http.js';
export { resolveEndpoints, isLoopbackHost, EndpointOverrideError, MOCK_ENDPOINTS_ENV } from './live/endpoints.js';
export { createRecordingFetch, validateRecordingDir, routeOf, routePathOf, assertRecordingRootAllowed, RecordedRunSchema, RecordedRequestSchema, RecordingLocationError, RECORD_ENV } from './live/record.js';
export { evaluateReadOnlyGate, probeDisplayLevel, buildScopeCtx, runLzProbe, runLzConnect, readLandingZones, writeLandingZones, upsertScope, removeRegistration, parseCredentialsFile, LzLiveError, WRITE_CAPABLE_ACCEPTED_REASON, UNVERIFIED_ACCEPTED_REASON } from './live/session.js';
// #3589: Landing Zone Connections (list, remove, offline state) shared by CLI, TUI and health check.
export { describeLandingZones, formatLandingZones, legacyCredentialCounts, runLzRemove } from './live/connections.js';
export { storedCredentialSets, reusableCredentialSets, parseCredentialsFrom, copyLzCredentialSet } from './live/credential-reuse.js';
export type { StoredCredentialSet, ReuseAuthMethod, ReuseDriverInfo, ReuseRegistration } from './live/credential-reuse.js';
export type { LzConnection, LzScopeConnection, LzScopeCredentialState, RemoveResult } from './live/connections.js';
export { lzListAction, lzRemoveAction, lzConnectAction, lzProbeAction, lzDiffAction, lzHierarchyAction } from './live/cli.js';
// #3885: tenant hierarchy view (CLI and TUI)
export { runLzHierarchy, formatLzHierarchy, lzHierarchyViewOfRun } from './live/hierarchy-view.js';
export type { LzHierarchyResult, LzHierarchyOptions } from './live/hierarchy-view.js';
// #3830: swao lz diff (Design 120 section 13.2).
export { runLzDiff, formatLzDiff, LzDiffError } from './live/run-diff.js';
export type { LzRunDiffResult, LzScopeDiff } from './live/run-diff.js';
export { MOCK_CSP_RESPONSE_HEADER, SimulationEvidence, describeSimulation, SimulatedRunError, createSimulationEvidenceFetch, parseMockCspHeader, hasSwaoMockClaim, simulatedScopesOfRun, assertLzLiveRunNotSimulated, splitSimulatedScopes } from './live/simulation.js';
export type { SimulatedScopeRef } from './live/simulation.js';
// #3574: the `aws` live driver and the Pass 23 AWS live path on it (Design 120 section 7.5).
export { awsDriver, readAwsPass23State, assumedRoleName, parseArn, AWS_PROBE_WRITE_ACTIONS, AWS_PROBE_READ_ACTIONS } from './live/aws/aws-driver.js';
export type { AwsPass23State } from './live/aws/aws-driver.js';
export { readAwsPass23StateForScope } from './live/aws/aws-pass23.js';
export type { AwsPass23Options } from './live/aws/aws-pass23.js';
export { readAzurePass23StateForScope } from './live/azure/azure-pass23.js';
export type { AzurePass23Options } from './live/azure/azure-pass23.js';
// #3590: live capability -> FEATURE_GATES key (Design 120 section 15).
export { LZ_LIVE_FEATURE_GATES, LZ_LIVE_TIER_EXIT_CODE, requireLzLiveFeature } from './live/tier.js';
// #3572: OTC live driver, scan assembler, built-in registration (Q-21 gate).
export { otcDriver, OTC_DRIVER_VERSION } from './live/otc/otc-driver.js';
// #3880 / #3881: tenant hierarchy at the scan boundary and in the merge.
export { prepareHierarchy, mergeLzLiveHierarchy, pseudonymiseNodeLabel } from './live/hierarchy.js';
export type { DriverHierarchy, DriverHierarchyNode } from './live/types.js';
// #3685: OTC AK/SK request signing (the mock pack verifies signatures with it).
export { signOtcRequest, otcSdkDate, OTC_SIGN_ALGORITHM } from './live/otc/otc-sign.js';
export { signObsRequest, OBS_ROUTE, OTC_SECURITY_TOKENS_ROUTE } from './live/otc/otc-obs.js';
export { azureDriver, AZURE_DRIVER_VERSION, AZURE_ARM_ALIASES, readAzurePass23State, readAzureBudgets, AZURE_BUDGETS_SOURCE, AZURE_POSTURE_ROUTES } from './live/azure/azure-driver.js';
export type { AzureBudgetFact } from './live/azure/azure-posture.js';
export { AZURE_API_VERSIONS } from './live/azure/azure-client.js';
export { OTC_SERVICES } from './live/otc/otc-services.js';
// #3601: STACKIT driver facts the mock pack builds its fixtures from.
export { stackitDriver, STACKIT_DRIVER_VERSION, STACKIT_SERVICE_IDS, STACKIT_IAAS_KINDS } from './live/stackit/stackit-driver.js';
export { isReadPermission } from './live/stackit/stackit-probe.js';
export { parseStackitKey, buildAssertion } from './live/stackit/stackit-client.js';
export { runLzLiveScan, mergeServices, DEFAULT_ACTIVITY_DAYS } from './live/scan.js';
// #3751 / #3804: shared 429 retry of the driver context.
export { createThrottleRetryFetch, retryAfterSeconds, setThrottleSleepForTests, MAX_RETRIES as LZ_THROTTLE_MAX_RETRIES, MAX_WAIT_S as LZ_THROTTLE_MAX_WAIT_S, MAX_TOTAL_WAIT_S as LZ_THROTTLE_MAX_TOTAL_WAIT_S } from './live/retry.js';
// #3766: Landing Zone Live Assessment runner and run writer (Design 120 sections 7.4, 13.2)
export { runLzLiveAssessment, lzLiveRunId, lzLiveWspDir, LZ_LIVE_MANIFEST_FILE, LZ_LIVE_RUN_STATUS_FILE, LZ_LIVE_LATEST_FILE } from './live/assess.js';
// #4233: the last read-only probe and the last run facts per scope (health check, no network call).
export { recordLzProbe, readLzProbeRecords, readLzLastRunFacts, LZ_PROBE_RECORD_FILE, LZ_PROBE_RECORD_SCHEMA } from './live/probe-record.js';
export type { LzProbeRecord, LzProbeReadOnly, LzLastRunFacts } from './live/probe-record.js';
export type { LzLiveAssessOptions, LzLiveAssessOutcome, LzLiveScopeRun } from './live/assess.js';
export { lzLiveAssessAction, runLzLiveAssessCli } from './live/cli.js';
export { lzLivePortfolioAction, runLzLivePortfolioCli } from './live/cli.js';
export type { LzLivePortfolioCliOptions, LzLivePortfolioCliDeps } from './live/cli.js';
export { readLzLiveRunForPortfolio, buildLzLivePortfolio, findLzLiveCapabilities, runLzLivePortfolio, formatLzLivePortfolio, lzLiveAppFitReports } from './live/portfolio.js';
export type { LzLiveAppFitReportsInput } from './live/portfolio.js';
export { buildBaselineComparison, rollUpBaselineScopes, formatBaselineComparison } from './live/baseline-comparison.js'; // #3872
export type { BaselineComparisonLzInput, BaselineComparisonScope } from './live/baseline-comparison.js';
export type { LzLiveRunInput, CapabilityQuery, LzLivePortfolioRunOutcome } from './live/portfolio.js';
export type { LzLiveAssessCliOptions } from './live/cli.js';
// #3587: privacy defaults (Design 120 section 6.4)
export { pseudonymisePerson, pseudonymiseTags, pseudonymiseResources, lzPseudonymSalt, lzPseudonymSaltKey, PERSON_TAG_KEYS, resourceIdNameSegments, resourceTypeNameLeaks, scrubResourceTypes } from './live/privacy.js';
// #3886: attributes maps, their one privacy filter and the ROLES.md read-call coverage list (Design 123 section 5.7)
export { filterAttributes, filterResourceAttributes, attributeKeyRule, pseudonymiseName } from './live/privacy.js';
export type { AttributeFilterResult, AttributeRule } from './live/privacy.js';
export { flattenAttributes } from './live/attributes.js';
export { parseCoverageList, CoverageRowSchema, COVERAGE_HEADING } from './live/coverage-list.js';
export type { CoverageRow, CoverageFeed } from './live/coverage-list.js';
export { awsOperationOf } from './live/aws/aws-client.js';
// #3931: capability tags of a deployed resource by its live resource type (estate side of service_deny / service_allow_list)
export { liveResourceCapabilityTags, LIVE_RESOURCE_CAPABILITY_MAPS } from './live/resource-capabilities.js';
export { awsResourceType } from './live/aws/aws-arn.js';
// #3581: live LZ catalogue artefact (Design 120 section 10.1)
export { buildLzLiveCatalogue, LZ_LIVE_CATALOGUE_FILE, LZ_LIVE_CATALOGUE_STATUSES } from './live/live-catalogue.js';
// #3583: scopes of one landing zone merged (Design 120 section 11.1)
export { mergeLzLiveScopes, LZ_LIVE_MERGED_FILE } from './live/merge.js';
export type { LiveScanOutcome, ScopeScanResult } from './live/scan.js';
export { registerBuiltInLiveLzDrivers, BUILT_IN_LIVE_LZ_DRIVERS, UNVERIFIED_DRIVERS_ENV } from './live/builtin.js';
export { LiveSourceUnavailableError, LiveAuthError } from './live/errors.js';
export type { LzLiveFeature } from './live/tier.js';
export { ReadOnlyProbeSchema, AuthMethodSchema, ReadAllowRuleSchema, LiveLzDriverDescriptorSchema } from './live/types.js';
export type { LiveLzDriver, ScopeCtx, ReadOnlyProbe, AuthMethod, ReadAllowRule, FetchLike as LiveFetchLike } from './live/types.js';
export type { ReadOnlyGate, ReadOnlyFlags, ProbeDisplayLevel, ProbeOutcome, ConnectOutcome, RemoveOutcome, ScopeProbeResult } from './live/session.js';

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
// #3888: rule engine of the Client LZ Policy Baseline controls in app runs (Design 123 section 8.4)
export { evaluateAppBaselineRules } from './evaluate/app-baseline-rules.js';
export type { AppBaselineRulesInput, AppBaselineCatalogueTarget } from './evaluate/app-baseline-rules.js';
// #4459: AWS SSO refresh of a session-keys scope (device sign-in), shared by CLI and TUI.
export { refreshAwsSsoScope, awsSsoProfilesForScope, listAwsSsoProfiles, storeScopeAwsProfile, isAwsSignInUrl, openAwsSignInUrl, AWS_SSO_REFRESH_AUTH, AWS_SSO_REFRESH_FIELDS } from './live/aws/aws-sso-scope.js';
export type { AwsSsoScopeOptions, AwsSsoScopeOutcome } from './live/aws/aws-sso-scope.js';
export { readAwsSsoProfiles, pickAwsSsoProfile, runAwsSsoDeviceFlow, AwsSsoRefreshError } from './live/aws/aws-sso-refresh.js';
export type { AwsSsoProfile, AwsSsoPrompt } from './live/aws/aws-sso-refresh.js';
export { lzCredentialsRefreshAction, AWS_SSO_CODE_LINE_PREFIX } from './live/cli.js';
