// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

export { findWorkspace, saveDefaultWorkspace, readDefaultWorkspace, readSavedDefaultWorkspacePath, defaultWorkspaceChangeLine, defaultWorkspaceConfigPath, resolveCatalogsDir } from './workspace.js';
export {
  LicenseGuard,
  LicenseTierError,
  LicenseLimitError,
  LicenseInvalidError,
  normalizeTier,
  _paths,
  buildLicenseKey,
  FEATURE_GATES,
} from './license-guard.js';
export type { LicenseState, LicenseTier, LicensePayload, FeatureKey } from './license-guard.js';
export {
  AssessmentTypeRouter,
  UnknownAssessmentTypeError,
  KNOWN_ASSESSMENT_TYPES,
  DEFAULT_ASSESSMENT_TYPE,
} from './assess-router.js';
export type { AssessmentRouteDecision } from './assess-router.js';
export { PassStatSchema, RunManifestSchema } from './run-manifest.js';
// #4430: build commit and date of the running bundle.
export { BUILD_INFO, buildShown, buildCommitLabel, buildTag, versionWithBuild, buildProvenance } from './build-info.js';
export type { BuildInfo } from './build-info.js';
// #4399: verdict and identity lines of swao lz probe.
export { lzProbeVerdictText, lzProbeVerdictState, formatLzProbeScopeLine, formatLzProbeIdentityLine, parseLzProbeScopeLine, parseLzProbeIdentityLine, LZ_PROBE_WRITE_CAPABLE_ACCEPTED } from './lz-probe-verdict.js';
export type { LzProbeReadOnly, LzProbeScopeLine } from './lz-probe-verdict.js';
// Data-quality contract (#0577): the manifest -> conditions evaluation + the
// BI-export flag-string serialiser. Shared by @swao/module-html-report (banner
// renderer) and @swao/module-powerbi (star writer's data_quality_flags column);
// lives in core so neither module imports the other (ADR-0048 sibling-import ban).
export { evaluateDataQuality, buildDataQualityFlagsString } from './data-quality.js';
export type { DataQualityCondition } from './data-quality.js';
export type {
  PassStat,
  PassFailed,
  RunManifest,
  LlmRunStats,
  FilesAssessed,
  RunManifestProvenance,
  // NB: run-manifest's internal LandingZoneWeights type is intentionally not
  // re-exported -- the canonical LandingZoneWeights is from cloud-provider-catalogue.
} from './run-manifest.js';
// WSP signal / pass-file / .swao.yml zod schemas (#0575): relocated from
// @swao/swao so @swao/module-html-report's publication extractor can validate
// pass files + .swao.yml without importing from @swao/swao. Re-exported by the
// host schema/* shims for the existing import sites (passes, wsp-schema tests).
// The colliding type names (Signal, SignalOutcome, Assessor from signals.ts;
// DataSource from wsp-pass.ts) are intentionally NOT re-exported here -- they
// already flow from plugin-types.js (the WSP-contract interfaces). Only the zod
// schema values + the non-colliding inferred types are exported.
export {
  SignalIdSchema,
  SignalSchema,
  SIGNAL_ID_REGEX,
  SignalOutcomeSchema,
  AssessorSchema,
  WspOverrideBlockSchema,
} from './signals.js';
export type { SignalId, WspOverrideBlock } from './signals.js';
export {
  SCAFFOLD_SIGNALS,
  SCAFFOLD_SIGNAL_CODES,
  ScaffoldSignalSchema,
  ScaffoldSignalsFileSchema,
  scaffoldSignal,
} from './scaffold-signals.js';
export type { ScaffoldSignal, ScaffoldSignalCode, ScaffoldSignalsFile } from './scaffold-signals.js';
export { BINARY_SIGNALS, BINARY_SIGNAL_CODES, BinarySignalSchema, BinarySignalsFileSchema, binarySignal } from './binary-signals.js';
export type { BinarySignal, BinarySignalCode, BinarySignalsFile } from './binary-signals.js';
export { TIME_QUADRANTS, TimeQuadrantSchema, PortfolioAppSchema, PortfolioSummarySchema, LandingZoneLiveSummarySchema, PORTFOLIO_ASSESSMENT_TYPES, PortfolioAssessmentTypeSchema, portfolioAppType, SEVEN_R_SOURCES, SevenRSourceSchema, CodeHealthKpisSchema } from './portfolio-summary.js';
export { SIGNAL_SEVERITY_RANK, countSignalsBySeverity, countBlockerSignals, sortSignalsBySeverity } from './signal-summary.js';
export { complianceRagStatus, summariseRegimeCompliance, normaliseComplianceOutcome, complianceOutcomeRag, tallyComplianceRag, addRag, complianceScore, COMPLIANCE_OUTCOME_ALIASES, COMPLIANCE_RAG_VALUES, type ComplianceRag, type ComplianceOutcome, type ComplianceRagTally, type ComplianceFrameworkSummary, type RawComplianceRegime } from './compliance-summary.js';
// #3425 follow-up: shared applies_when matcher (Pass 11 + publication extractor).
export { appliesWhenMatches, complianceNotEvaluatedReason, COMPLIANCE_NOT_EVALUATED_REASONS, NOT_EVALUATED_RATIONALE_PREFIX, type ComplianceNotEvaluatedReason, UNVERIFIED_EVIDENCE_RATIONALE_PREFIX, EVIDENCE_BASIS_MARKER, formatEvidenceBasis, splitEvidenceBasis } from './compliance-applicability.js';
export { normalizeRiskLikelihood, normalizeRiskImpact, summariseRiskRegister, type RiskLevel } from './risk-summary.js';
export { lzCatCheckResult, countLzFitBlockers } from './lz-fit-summary.js';
export type { TimeQuadrant, PortfolioApp, PortfolioSummary, LandingZoneLiveSummary, PortfolioAssessmentType, SevenRSource, CodeHealthKpis } from './portfolio-summary.js';
// #4287 (D-9): the 7R to TIME matching, single source of the 7R verdict.
export { SEVEN_R_TIME, TIME_TO_SEVEN_R, sevenRToTime, sevenRMatchesTime, resolveSevenRVerdict } from './seven-r-time.js';
export type { SevenRVerdict } from './seven-r-time.js';
export { PassFileSchema, DataSourceSchema } from './wsp-pass.js';
export type { PassFile } from './wsp-pass.js';
export {
  SwaoYmlSchema,
  SwaoYmlCrawlSchema,
  SwaoYmlVcsSchema,
  SwaoYmlAssessmentSchema,
  SwaoYmlTestCodeSchema,
  SwaoYmlCodeHealthSchema,
  SwaoYmlPublicationSchema,
  SwaoYmlLlmAssessmentSchema,
  SwaoYmlLlmAssessmentLegSchema,
  SwaoYmlContextSchema,
  InfraRoleEntrySchema, // #3429
  SwaoYmlLandingZoneSchema,
  SwaoYmlLzTargetSchema,
  LZ_TARGET_PATTERN,
  SwaoYmlMcpSchema, // #3474
  SWAO_MCP_PROFILE_NAMES, // #3474
  SWAO_MCP_BASELINE_WRITE_MODES, // #4128 BC-05
  SwaoYmlLandingZonesSchema, // #3567
  SwaoYmlLzRegistrationSchema, // #3567
  SwaoYmlLzScopeSchema, // #3567
  SwaoYmlLzScopeTargetSchema, // #3567
  LZ_REGISTRATION_ID_PATTERN, // #3567
  LZ_PROVIDER_ID_PATTERN, // #3567
  LZ_SCOPE_PURPOSES, // #3975
  SwaoYmlAssessmentLlmSchema, // #4190
  SwaoYmlAssessmentLlmCandidateSchema, // #4190
  SwaoYmlServicePortfolioSchema, // #4190
} from './swao-yml.js';
export type {
  SwaoYml,
  SwaoYmlCrawl,
  SwaoYmlAssessment,
  SwaoYmlPublication,
  SwaoYmlLlmAssessment,
  SwaoYmlLlmAssessmentLeg,
  SwaoYmlContext,
  InfraRoleEntry, // #3429
  SwaoYmlLandingZone,
  SwaoYmlMcp, // #3474
  SwaoYmlLzRegistration, // #3567
  SwaoYmlLzScope, // #3567
  LzScopePurpose, // #3975
  SwaoYmlAssessmentLlm, // #4190
  SwaoYmlAssessmentLlmCandidate, // #4190
  SwaoYmlServicePortfolio, // #4190
} from './swao-yml.js';
// #3281: LZ catalogue target selection shared by the CLI, run-context and the TUI.
export {
  parseLzTarget,
  invalidLzTargetEntries,
  parseLzTargetList,
  lzTargetLabel,
  readLzTargetsKey,
  lzTargetsFromAssessment,
  resolveLzTargets,
  setLzTargetsInSwaoYml,
  stripCommentedLzTargetsTemplate,
} from './lz-targets.js';
export type { LzTargetSpec, LzTargetSource, ResolvedLzTargets, ResolveLzTargetsInput } from './lz-targets.js';
// PII redaction (#0591): relocated from @swao/swao so the app-assessment
// module's `normalize` command can redact without importing from @swao/swao.
// redact-pre-llm holds process-global state (allowlist, person-name opt-in);
// there is one @swao/core instance in the workspace, so the singleton is shared
// across swao (via re-export stubs) and the modules.
export { emptyCounts, redactPiiString, redactPiiValue, looksLikePhone, redactPhoneNumbers } from './redact-pii.js';
export type { RedactionCounts } from './redact-pii.js';
// Report-output dash normalisation (CLAUDE.md section 5.1; #3291, Design 110 D-28):
// one implementation shared by the CLI text report and the publication renderer.
export { normalizeDashes } from './normalize-dashes.js';
export { LZ_ACCEPT_WRITE_CAPABLE_PHRASE, LZ_ACCEPT_UNVERIFIED_PHRASE } from './lz-probe-accept-phrases.js';
// #3428: central source scope -- the one walker every assessment pass reads
// the source tree through (canonical skip set, caps, test classification).
export {
  SourceScope,
  SOURCE_SCOPE_SKIP_DIRS,
  SOURCE_SCOPE_MAX_FILES,
  SOURCE_SCOPE_MAX_DEPTH,
  isTestPath,
  isGeneratedPath,
  listSourceFiles,
  findShallowestSourceFile,
  getSourceScope,
  beginSourceScopeRun,
  endSourceScopeRun,
  sourceScopeWalkCount,
  sourceScopeRunTestCode,
  sourceTreeHasFiles,
  listInputFiles,
} from './source-scope.js';
export type {
  SourcePurpose,
  TestCodeMode,
  SourceFile,
  ListSourceFilesOptions,
  SourceScopeSummary,
  InputFile,
  ListInputFilesOptions,
  SourceScopeOptions,
  SourceScopeRunOptions,
} from './source-scope.js';
// #4243: app source root scoped to source.vcs.subdir (leg copy, source_hash, #4266).
export { appSourceRoot, readAppSourceRoot } from './app-source-root.js';
export type { AppSourceRoot } from './app-source-root.js';
// #4272: profile-relative paths (%LOCALAPPDATA%, %APPDATA%, ~) for log context and console lines.
export { shortenProfilePath } from './profile-path.js';
// #4267: stdout pass markers of `swao assess` (Design 098 section 4.1).
export { formatPassMarker, parsePassMarker, passMarkersEnabled, passLabel, parsePassRunningLine, parsePassResultLine, parsePassProgressLine, passLabelsIn, countPassOkLines } from './pass-marker.js';
export type { PassMarker, PassMarkerKind, PassLineRef } from './pass-marker.js';
export { formatPostStepLine, parsePostStepLine, postStepLabel } from './post-step-line.js';
export { formatLzPassStart, formatLzPassDone, formatLzTargetVerdict, formatLzVerdict, parseLzRunMarker, LZ_FIT_PASS, type LzRunMarker } from './lz-run-marker.js';
export type { PostStepLine } from './post-step-line.js';
// #4266: progress of synchronous pass work (source walk, census, input walk) for the run heartbeat.
export { setPassProgressSink, reportPassProgress, yieldPassProgress, createProgressThrottle, createRunHeartbeat } from './pass-progress.js';
export type { PassProgress, PassProgressSink, RunHeartbeat, RunHeartbeatOptions } from './pass-progress.js';
// #4375: removal of the #4278 test profile (links first, never their targets).
export { removeSandboxProfile } from './sandbox-cleanup.js';
export type { RemoveSandboxOptions, RemoveSandboxResult } from './sandbox-cleanup.js';
// #3423: language census, recursive build manifests, coverage contract.
export {
  SOURCE_LANGUAGES,
  SourceLanguageSchema,
  LANGUAGE_BY_EXTENSION,
  languagesForExtensions,
  PACKAGE_ECOSYSTEMS,
  ecosystemLanguages,
  BUILD_MANIFEST_KINDS,
  buildManifestKind,
  manifestKindInfo,
  manifestDetectableLanguages,
  BuildManifestSchema,
  BUILD_MANIFEST_MAX_DEPTH,
  detectBuildManifests,
  LanguageCensusRowSchema,
  LanguageCensusSchema,
  CENSUS_MAX_FILE_BYTES,
  CENSUS_MAX_MANIFESTS,
  countNonBlankLines,
  computeLanguageCensus,
  productionLoc,
  COVERAGE_LEVELS,
  LanguageCoverageSchema,
} from './language-census.js';
export type {
  SourceLanguage,
  PackageEcosystem,
  BuildManifestKind,
  BuildManifest,
  LanguageCensusRow,
  LanguageCensus,
  CoverageLevel,
  LanguageCoverage,
} from './language-census.js';
// #3403: configurable test-code handling (assessment.exclude_test_code /
// assessment.test_code) on top of the source scope's classification.
export {
  TEST_CODE_SETTINGS,
  DEFAULT_TEST_CODE_SETTING,
  SECRET_SIGNAL_IDS,
  readTestCodeSetting,
  resolveTestCodeSetting,
  scopeTestCodeMode,
  globToRegExp,
  testRulesFromBuildFile,
  evidencePaths,
  classifyEvidenceOrigin,
  lowerSeverity,
  applyTestCodeMarker,
} from './test-code.js';
export type {
  TestCodeSetting,
  TestCodeSettingSource,
  ResolvedTestCodeSetting,
  TestCodeRule,
  EvidenceOrigin,
  TestCodeMarkerResult,
} from './test-code.js';
// #3418: chat findings integrity (evidence kind, detection method, compact
// signal index lines, answer post-check), shared by module-mcp and the TUI chat.
export {
  EVIDENCE_KINDS,
  DETECTION_METHODS,
  PATTERN_MATCH_PREFIXES,
  SIGNAL_INDEX_PREFIX,
  SignalIndexEntrySchema,
  signalEvidenceKind,
  signalDetectionMethod,
  signalConfidenceLabel,
  signalSeverityLabel,
  signalIndexEntry,
  formatSignalIndexLine,
  isSignalIndexLine,
  parseSignalIndexLines,
  mergeSignalIndex,
  checkFindingsIntegrity,
  applyFindingsIntegrity,
  citesDocumentEvidence,
  documentNameMatchesInput, // #4050
} from './finding-integrity.js';
export type {
  EvidenceKind,
  DetectionMethod,
  IntegritySeverity,
  IntegritySignalInput,
  SignalIndexEntry,
  IntegrityIssueKind,
  IntegrityIssue,
} from './finding-integrity.js';
// #3405: shared hard-coded endpoint scanner (consumers: Pass 26 code health, #3422, #3424).
export {
  scanEndpoints,
  scanReportableEndpoints,
  isCommentOnlyLine,
  maskUserinfo,
  classifyEndpointHost,
  isEndpointScanCandidate,
  endpointEvidence,
  ENDPOINT_SCAN_EXTENSIONS,
  REPORTABLE_ENDPOINT_CLASSES,
  MAX_SCANNED_LINE_LENGTH,
} from './endpoint-scanner.js';
export type { EndpointKind, EndpointClass, EndpointHit, ScanEndpointsOptions } from './endpoint-scanner.js';
// #3487: endpoint allowlist, Pass 26 settings, optional code health tools and the Windows-safe tool runner.
export { isValidEndpointAllowEntry, normaliseEndpointAllowlist, MAX_ENDPOINT_ALLOW_ENTRY_LENGTH } from './endpoint-scanner.js';
export {
  CODE_HEALTH_DEFAULT_TOP_N,
  CODE_HEALTH_TOP_N_MIN,
  CODE_HEALTH_TOP_N_MAX,
  CODE_HEALTH_ALLOWLIST_MAX,
  CODE_HEALTH_DEFAULT_TOOL_TIMEOUT_S,
  CODE_HEALTH_TOOL_TIMEOUT_MIN_S,
  CODE_HEALTH_TOOL_TIMEOUT_MAX_S,
  DEFAULT_CODE_HEALTH_SETTING,
  resolveCodeHealthSetting,
} from './code-health-config.js';
export type { ResolvedCodeHealthSetting, CodeHealthSettingSource } from './code-health-config.js';
export {
  CODE_HEALTH_TOOL_NAMES,
  CODE_HEALTH_TOOL_VERSIONS,
  TOOL_VERSION_TIMEOUT_MS,
  PROBE_DETECT_OPTIONS,
  formatVersionRange,
  isVersionSupported,
  parseToolVersionNumber,
  resolveJscpdShimEntry,
  toolInvocationCandidates,
  detectCodeHealthTool,
  detectCodeHealthTools,
} from './code-health-tools.js';
export type {
  CodeHealthToolName,
  ToolVersionRange,
  ToolInvocation,
  CodeHealthToolStatus,
  DetectedCodeHealthTool,
  DetectOptions,
} from './code-health-tools.js';
export { fileBackedToolRunner, spawnErrorIsNotFound, treeKillPid, TOOL_OUTPUT_MAX_BYTES } from './tool-runner.js';
// #4384: wait for a TUI child operation; Esc cancel stops its tree by PID.
export { awaitChild } from './cancellable-child.js';
export type { CancellableChild, ChildOutcome, AwaitChildOptions } from './cancellable-child.js';
// #4241: the central self-spawn helper (pkg binary and node dist).
export { isPkgBinary, selfEntryScript, selfSpawnEnv, selfSpawnArgs, selfSpawnCommand } from './self-spawn.js';
export type { SelfSpawnRuntime, SelfSpawnOptions, SelfSpawnCommand } from './self-spawn.js';
export type { ToolRunRequest, ToolRunResult, ToolRunner } from './tool-runner.js';
export {
  emptyPreLlmCounts,
  setAllowlist,
  setScrubPersonName,
  _resetForTests,
  redactPreLlm,
  redactForReport,
} from './redact-pre-llm.js';
export type { PreLlmRedactionCounts } from './redact-pre-llm.js';
// #3415: secret-value masking (mask at source + output guard), Design 032 section 11.6.
export { maskSecretValue, maskKnownSecret, maskCredentials, extractCredentialValues, maskSecretShapes, guardSecretText, guardSecretsDeep } from './secret-mask.js';
export type { SecretMaskResult } from './secret-mask.js';
// Redaction provenance report (#0568): relocated from @swao/swao so the
// LLM-provider module (anthropic/openai egress) and the host both record
// redaction calls into the single shared in-core report. `_resetForTests` is
// aliased to avoid the same-named export from redact-pre-llm.js.
export {
  recordRedaction,
  beginRun,
  buildReport,
  flushRedactionReport,
  _peekCalls,
  _resetForTests as _resetRedactionReportForTests,
} from './redaction-report.js';
export type { RedactionSurface, RedactionCallEntry, RedactionReport } from './redaction-report.js';
// Shared host services relocated to core (#0553) so guest-module TUI screens
// (and other consumers) can use them without importing the host. Leaf modules
// (node built-ins only).
export { logApp, logPortfolio, logPortfolioAt, setWorkspaceRoot, resolveWorkspaceRoot, listSinkPaths } from './log.js'; // logPortfolioAt: #4128 BC-05
export type { LogLevel, LogScope, LogEntry, PortfolioLogOpts, AppLogOpts } from './log.js';
export { openWithDefaultApp, copyToClipboard } from './shell-actions.js';
export { CredentialStore, credentialStore, credentialEnvVarName } from './credential-store.js';
export { writeFileAtomicSync, renameWithRetrySync, atomicTempPath, TRANSIENT_RENAME_CODES } from './atomic-write.js';
export type { AtomicWriteOptions, RenameRetryOptions as AtomicRenameRetryOptions } from './atomic-write.js';
// #3570: scoped landing-zone vault keys, legacy Pass 23 key migration, expiry check
export {
  LZ_CREDENTIAL_FIELDS,
  LEGACY_LZ_CREDENTIAL_KEYS,
  lzCredentialKey,
  parseLzCredentialKey,
  findLegacyLzCredentialKeys,
  moveLegacyLzCredentials,
  resolveLzCredentials,
  LzCredentialExpiredError,
  LzCredentialMissingError,
} from './lz-credentials.js';
export type { LzCredentialField, ParsedLzCredentialKey } from './lz-credentials.js';
export { SIGNAL_SCHEMA_HINT, normalizeSignal } from './signal-normalizer.js';
// #3416: absence statements in signal evidence (derive-plan + publication).
export { isAbsenceEvidenceRef } from './evidence-absence.js';
export { isEvidenceNote } from './evidence-note.js';
// #4477: tolerant wsp-evidence.yaml read (duplicate keys, last wins) for publication and Power BI.
export { loadEvidenceYaml, type EvidenceYamlErrorStage } from './evidence-yaml.js';
export { relativiseWorkspacePaths, inputsRelativePath, hasDriveLetterPath, evidenceRefLookupKeys, evidenceLookupKey, evidenceCatalogueId, secretScanRefShape, trimPathSlashes, type RelativiseOptions } from './evidence-ref.js';
export { inferOutcomeFromSeverity, enrichSignal, enrichSignals } from './auditor-enricher.js';
export type { EnrichOptions } from './auditor-enricher.js';
// #0776-C / #0751: shared crawl-section writer for AssessScreen + round-trip tests.
export { writeCrawlSection } from './crawl-config-write.js';
// #2770: Chat + Agent turn interfaces for PS1 chat bridge + support-bundle v2.2.
export { ChatTurnSchema, AgentToolCallSchema } from './chat.js';
export type { ChatTurn, AgentToolCall } from './chat.js';
export type { CrawlSectionInput } from './crawl-config-write.js';

// WSP-contract schema modules (#0548): relocated from @swao/swao so the
// app-assessment module's passes and swao's own validation layer can both
// depend on them without a circular package dependency.
export { LandingZoneCandidateSchema, LandingZoneResultSchema } from './wsp-landing-zone.js';
export type { LandingZoneCandidate, LandingZoneResult, LockInFlag } from './wsp-landing-zone.js';
export {
  LandingZoneReadinessResultSchema,
} from './wsp-lzr.js';
export type {
  LandingZoneReadinessResult,
  LZBlockerItem,
  LZWarningItem,
  LZServiceCheck,
  LZQuotaCheck,
  LZPolicyCheck,
  LZNetworkCheck,
} from './wsp-lzr.js';
export {
  REGIME_ID_REGEX,
  RegimeIdSchema,
  ScopeSchema,
  FrameworkMetaSchema,
  RegimeMetaSchema,
  RegimeControlSchema,
  RegimeCatalogueSchema,
  RegimeIndexSchema,
  controlIdAliases,
  resolveControlIdKey,
} from './regime-catalogue.js';
export type {
  RegimeId,
  Scope,
  FrameworkMeta,
  RegimeMeta,
  RegimeControl,
  RegimeCatalogue,
  RegimeIndex,
  RegimeIndexEntry,
} from './regime-catalogue.js';
// LZ service catalogue (Design 056 Layer A, #0565): region-keyed availability +
// sovereignty facts. Schema + loader live in core; per-provider JSON snapshots
// live under swao/lz-catalogues/.
export {
  LzServiceCatalogueSchema,
  LzCatalogueMetaSchema,
  LzRegionSchema,
  LzServiceSchema,
  LzServiceIacSchema,
  LzServiceIacBaseSchema,
  LzSovereigntyFactsSchema,
  LZ_SERVICE_STATUSES,
  LZ_CATALOGUE_SOURCE_MODES,
  LZ_CATALOGUE_CONFIDENCES,
  LZ_IAC_LEVELS,
  parseLzCatalogue,
  safeParseLzCatalogue,
  regionHasService,
  regionFulfills,
  findRegion,
} from './lz-service-catalogue.js';
export type {
  LzServiceCatalogue,
  LzCatalogueMeta,
  LzRegion,
  LzService,
  LzServiceIac,
  LzSovereigntyFacts,
} from './lz-service-catalogue.js';
// VM price table for the service cost model (#3288, Design 110 D-23).
export {
  VM_PRICE_TABLE_FILE,
  VM_PRICE_PROVIDERS,
  VM_PRICE_OS,
  VM_PRICE_TARGETS,
  VmPriceSourceSchema,
  VmPriceRowSchema,
  VmPriceTableSchema,
  safeParseVmPriceTable,
  findVmPrice,
} from './vm-price-table.js';
export type { VmPriceProvider, VmPriceOs, VmPriceSource, VmPriceRow, VmPriceTable } from './vm-price-table.js';
// LZ scan result (Design 056 Layer B, #0566): normalised customer-LZ inventory.
export {
  LzScanResultSchema,
  LzEnabledServiceSchema,
  LzGuardrailSchema,
  LzQuotaSchema,
  parseLzScanResult,
  scanHasService,
  scanFulfills,
} from './lz-scan-result.js';
export type { LzScanResult, LzEnabledService, LzGuardrail, LzQuota } from './lz-scan-result.js';
// LZ live scan (Design 120 section 7.3, #3565): output contract of one live scope crawl.
export {
  LZ_LIVE_STATUSES,
  LzLiveStatusSchema,
  LzLiveEvidenceSchema,
  LzLiveRegionStatusSchema,
  LzLiveReadOnlySchema,
  LzLiveReadOnlyOverrideSchema,
  LzLiveSourceSchema,
  LzLiveMetaSchema,
  LzLiveSimulatedSchema,
  LzLiveSimulationEvidenceSchema,
  LZ_LIVE_SIMULATION_EVIDENCE,
  LZ_LIVE_SIMULATION_FIDELITIES,
  LzLiveFrameworkResultSchema,
  LzLivePriceSchema,
  LzLiveServiceSchema,
  LzLiveRegionSchema,
  LzLiveOfferingSchema,
  LzLiveResourceSchema,
  LzLiveWorkloadSchema,
  LzLiveQuotaSchema,
  LzLiveActivitySummarySchema,
  LzLiveCheckSchema,
  LZ_LIVE_CHECK_STATUSES, // #3864
  LzLiveCheckStatusSchema, // #3864
  LZ_LIVE_OBSERVABILITY, // #3864
  LzLiveObservabilitySchema, // #3864
  LzLiveBaselineRefSchema, // #3864
  LzLiveFactSourceSchema, // #3864
  LZ_LIVE_KEY_CUSTODY, // #3864
  LZ_LIVE_TLS_VERSIONS, // #3864
  LzLiveEncryptionFactSchema, // #3864
  LzLiveExposureFactSchema, // #3864
  LzLiveIngressRuleSchema, // #3864
  LzLiveBackupFactSchema, // #3864
  LzLiveBudgetFactSchema, // #3936
  LZ_LIVE_BUDGET_PERIODS, // #3936
  LzLiveIdentityPostureSchema, // #3864
  LzLiveLoggingPostureSchema, // #3864
  LzLivePostureSchema, // #3864
  LZ_LIVE_POSTURE_BLOCKS, // #3864
  lzLivePostureEntryKey, // #3864
  LZ_LIVE_HIERARCHY_NODE_KINDS, // #3880
  LzLiveHierarchyNodeKindSchema, // #3880
  LZ_LIVE_NODE_LABEL_PATTERN, // #3880
  LzLiveHierarchyNodeSchema, // #3880
  LzLiveHierarchySchema, // #3880
  LzLiveMergedHierarchySchema, // #3880
  lzLiveHierarchyProblems, // #3880
  lzLiveHierarchyRoots, // #3880
  LzLiveEstateSchema,
  LzLiveDiffSchema,
  LzLiveScanSchema,
  parseLzLiveScan,
  deriveLzScanBaseFields,
  projectLzLiveScan,
  LZ_LIVE_STATUS_PRECEDENCE,
  lzLiveStatusesForRegion,
} from './lz-live-scan.js';
export type {
  LzLiveStatus, LzLiveEvidence, LzLiveRegionStatus, LzLiveSource, LzLiveMeta,
  LzLiveService, LzLiveRegion, LzLiveScan, LzLiveScanInput,
  LzLiveSimulated, LzLiveSimulationEvidence,
  LzLiveCheck, LzLiveCheckStatus, LzLiveObservability, LzLiveBaselineRef, LzLiveFactSource,
  LzLivePosture, LzLivePostureInput, LzLivePostureBlock,
  LzLiveHierarchyNode, LzLiveHierarchyNodeKind, LzLiveHierarchy, LzLiveHierarchyInput, LzLiveMergedHierarchy,
} from './lz-live-scan.js';
// #3886: shared attributes map of resources, posture entries and hierarchy nodes (Design 123 section 5.7)
export { LzLiveAttributesSchema, LzLiveAttributeValueSchema, LZ_LIVE_ATTRIBUTES_MAX } from './lz-live-scan.js';
export type { LzLiveAttributes, LzLiveAttributeValue } from './lz-live-scan.js';
// #3583: scopes of one landing zone merged (Design 120 section 11.1)
export {
  LZ_LIVE_STALENESS_DAYS,
  LZ_LIVE_SCOPE_MERGE_PRECEDENCE,
  LzLiveMergedScopeSchema,
  LzLiveMergedRegionStatusSchema,
  LzLiveMergedServiceSchema,
  LzLiveMergedResourceSchema,
  LzLiveMergedGuardrailSchema,
  LzLiveMergedSchema,
  parseLzLiveMerged,
} from './lz-live-merged.js';
export type { LzLiveMerged, LzLiveMergedScope, LzLiveMergedService } from './lz-live-merged.js';
// #3584: portfolio merge across landing zones (Design 120 sections 11.2, 11.3)
export {
  LZ_LIVE_PORTFOLIO_DIR,
  LZ_LIVE_PORTFOLIO_FILE,
  LZ_LIVE_PORTFOLIO_LATEST,
  LzLivePortfolioScopeSchema,
  LzLivePortfolioLzSchema,
  LzLivePortfolioCapabilitySchema,
  LzLivePortfolioSchema,
  LzLiveBaselineComparisonSchema, // #3872
  LzLiveBaselineComparisonLzSchema, // #3872
  LzLiveBaselineCellSchema, // #3872
  readLatestLzLivePortfolio,
  lzLivePortfolioSummaryEntries,
  lzLiveHierarchySummary, // #3873
  LzLivePortfolioAppFitSchema, // #3822
  lzLivePortfolioAppFitEntries, // #3822
} from './lz-live-portfolio.js';
export type { LzLivePortfolio, LzLivePortfolioLz, LzLivePortfolioCapability, LzLivePortfolioAppFit, LzLiveBaselineComparison } from './lz-live-portfolio.js';
export { ScopeCoverageSchema } from './scope-coverage.js';
export type { ScopeCoverage, BlindSpotEntryResult } from './scope-coverage.js';
// Shared doctor-probe result types (#0573): the host-coupled VCS-auth and
// imports probes stay host-side, but their result types are the single source
// of truth here so module-health-check's formatters can type them without importing
// the host.
export type {
  VcsAuthProbeStatus,
  VcsAuthProbeResult,
  ImportsProbeStatus,
  ImportFinding,
  ImportsProbeResult,
} from './probe-types.js';
// Report data + licensee-branding contract types (#0576): relocated from
// @swao/swao so @swao/module-pdf-report's PDF renderer can type its inputs
// without importing the host. The host's report.ts re-exports these for the
// existing `from './report.js'` import sites.
export type {
  SignalEntry,
  EngagementMeta,
  ReportData,
  ReportLzCatalogueFit,
  LicenseeBranding,
  ChallengeFindingEntry,
  ChallengeAgentFinding,
} from './report-types.js';
// Canonical persona taxonomy (#0580) -- shared contract between the Community
// `report` command and the Enterprise `challenge` module; lives in core so the
// former never depends on the latter (per-tier builds, #0583).
export {
  CANONICAL_AGENT_ORDER,
  PERSONAS,
  AGENT_IDS,
  REPORT_VIEW_ALIASES,
  reportViewToAgentId,
} from './persona-taxonomy.js';
export type { Persona, AgentId } from './persona-taxonomy.js';
export type {
  CrawlConfig,
  NetworkEntry,
  ConsoleEntryType,
  ConsoleEntry,
  ScreenArtefact,
  CrawlResult,
  BinaryCheck,
  CrawlProvider,
} from './crawl-types.js';

// Shared assessment infrastructure (#0548): cloud-provider catalogue +
// compliance regime registry. Used by swao (assess.ts, exports/star.ts,
// derive-plan.ts) and by the app-assessment module's Pass 09 / Pass 11.
export {
  DEFAULT_WEIGHTS,
  resolveDefaultCataloguePath,
  loadCatalogue,
  deriveConstraints,
  matchLandingZone,
  loadCatalogueDocument,
  marketScan,
  MARKET_SCAN_MAX_REVIEW_AGE_DAYS,
} from './cloud-provider-catalogue.js';
export type {
  CatalogueProvider,
  RequiredService,
  LandingZoneConstraints,
  LandingZoneWeights,
  CatalogueDocument,
  MarketScanCandidate,
  MarketScanNotReviewed,
  MarketScanResult,
} from './cloud-provider-catalogue.js';
export {
  loadRegimeRegistry,
  withCatalogueParseCache,
  loadYamlFile as loadCatalogueYamlFile,
  loadBundledRegimeRegistry,
  resolveRegimeCatalogue,
  validateRegimeIdAgainstRegistry,
  regimeFiles,
  loadRegimeCatalogue,
} from './compliance-registry.js';
export type { ResolvedRegime, RegimeRegistry, ResolvedRegimeCatalogue, RegimeCatalogueSource } from './compliance-registry.js';
export { discoverFrameworks, findFramework, frameworkContributorName } from './framework-discovery.js';
export type { DiscoveredFramework, DiscoverFrameworksOptions } from './framework-discovery.js';
export {
  SERVICE_CONTROLS_FILE,
  CapabilityTagSchema,
  ServiceControlMappingSchema,
  ServiceControlsSchema,
  loadServiceControls,
  computeServiceMappingCoverage,
  serviceMappingStatus,
} from './service-controls.js';  // #3577 Design 120 §8.2
export type {
  ServiceControlMapping,
  ServiceControls,
  ServiceControlsLoadResult,
  ServiceMappingCoverage,
  ServiceMappingStatus,
} from './service-controls.js';
export {
  POLICY_BASELINE_FILE,
  SHIPPED_POLICY_ID_PATTERN,
  CLIENT_POLICY_ID_PATTERN,
  POLICY_STATES,
  POLICY_CATEGORIES,
  POLICY_KINDS,
  POLICY_KIND_CATEGORY,
  KEY_CUSTODY_LEVELS,
  POLICY_PARAM_SCHEMAS,
  PolicySchema,
  PolicyBaselineSchema,
  policyKindParamNames,
  policyBaselineCapabilityTags,
  loadPolicyBaseline,
  compareCatalogueVersions, // #3869
  findShippedPolicyBaseline, // #3869
  shippedPolicyIdsOf, // #3869
  policyBaselineDrift, // #3869
  policyBaselineSovereigntyRequirements, // #3871
  parsePolicyBaselineText, // #4128 BC-01
  readPolicyBaselineControlIds, // #4128 BC-01
  policyBaselineFindings, // #4128 BC-01
  POLICY_BASELINE_SCHEMA_VERSIONS, // #4128 BC-02
  POLICY_DECISION_RATIONALE_MAX, // #4128 BC-02
  PolicyDecisionSchema, // #4128 BC-02
} from './policy-baseline.js'; // #3862 Design 123 section 7.2
export {
  POLICY_BASELINE_MAX_CHANGES,
  PolicyBaselineChangeSchema,
  validatePolicyBaselineChanges,
  patchPolicyBaselineText,
  applyPolicyBaselineChanges,
  policyBaselineLineDiff,
  canonicalJson,
} from './policy-baseline-patch.js'; // #4128 BC-02 Design 123 section 17.5.2
export {
  POLICY_GUIDANCE_FILE,
  POLICY_GUIDANCE_STATUSES,
  PolicyGuidanceSchema,
  PolicyGuidanceEntrySchema,
  PolicyGuidanceOptionSchema,
  loadPolicyGuidance,
  policyGuidanceFor,
  policyGuidanceOptionErrors,
} from './policy-guidance.js'; // #4128 BC-06 Design 123 section 17.4
export type { PolicyGuidance, PolicyGuidanceEntry, PolicyGuidanceOption, PolicyGuidanceLoadResult } from './policy-guidance.js';
export type {
  PolicyBaselineChange,
  PolicyBaselinePatchCounts,
  PolicyBaselinePatchItem,
  PolicyBaselinePatchResult,
  PatchPolicyBaselineOptions,
} from './policy-baseline-patch.js';
export {
  patchSwaoYmlText,
  patchSwaoYmlFile,
  patchSwaoYmlFileOrThrow,
  splitInlineComment,
} from './swao-yml-patch.js'; // #4283 the one minimal-patch writer for .swao.yml (Design 125 section 7)
export type { SwaoYmlEdit, SwaoYmlKeyPath, SwaoYmlValueStyle, SwaoYmlPatchResult, SwaoYmlPatchOptions } from './swao-yml-patch.js';
export {
  LZ_BASELINE_RESULT_SCHEMA,
  LZ_BASELINE_RESULT_SUFFIX,
  LZ_BASELINE_OFFERING_VERDICTS,
  LzBaselineOfferingVerdictSchema,
  LzBaselineSeveritySchema,
  LzBaselinePolicyResultSchema,
  LzRequirementProvenanceSchema,
  LzBaselineResultSchema,
  baselineOverallVerdict, // #3874 (moved from module-landing-zone)
  rollUpBaselineScopes, // #3874 (moved from module-landing-zone)
  compareBaselineWorstFirst, // #4052 Design 123 section 9.6
  sameBaselineRank, // #4052
  baselineTieAtCut, // #4052
} from './lz-baseline-result.js'; // #3871 Design 123 sections 8 and 9.1
export {
  LZ_SOURCES,
  isLzSource,
  resolveLzSource,
  listLzLiveRunIds,
  lzSourceCliArgs,
  lzLinkedLandingZones,
  lzAppLinks,
  describeLzAppLinks,
  LZ_LIVE_LINK_CATALOGUE_NOTICE,
  LZ_LIVE_APP_SOURCE_REFUSAL,
  LZ_LIVE_LINK_NO_TARGETS_NOTICE,
  LZ_LIVE_LINK_NO_LZ_FIT_NOTICE,
  seedLinkedCatalogueTargets,
  seedCatalogueTargetsForApp,
  isLzCatalogueSeedSource,
  LZ_CATALOGUE_SEED_SOURCES,
} from './lz-source.js'; // #3887 Design 123 section 8.4; #3980 link fallback; #4244 catalogue only
export type { LzSource, LzSourceOrigin, LzSourceSelection, LzAppLink, ResolveLzSourceInput, ResolveLzSourceResult, LzCatalogueSeed, LzCatalogueSeedSource } from './lz-source.js';
export type {
  LzBaselineOfferingVerdict,
  LzBaselinePolicyResult,
  LzRequirementProvenance,
  LzBaselineResult,
  LzBaselineResultInput,
  BaselineRollUpScope,
  RolledBaselinePolicy,
  BaselineRankKey,
} from './lz-baseline-result.js';
export type {
  PolicyState,
  PolicyCategory,
  PolicyKind,
  KeyCustodyLevel,
  Policy,
  PolicyBaseline,
  LoadPolicyBaselineOptions,
  PolicyBaselineLoadResult,
  ShippedPolicyBaseline, // #3869
  PolicyBaselineDrift, // #3869
  PolicyBaselineSovereigntyRequirements, // #3871
  PolicyBaselineControlIds, // #4128 BC-01
  ParsePolicyBaselineOptions, // #4128 BC-01
  PolicyBaselineParseResult, // #4128 BC-01
  PolicyBaselineFindings, // #4128 BC-01
  PolicyDecision, // #4128 BC-02
} from './policy-baseline.js';
export type {
  LicenceTier,
  AssessmentType,
  LlmProvider,
  DataSource,
  SignalSource,
  SignalCategory,
  SignalSeverity,
  SignalConfidence,
  SignalLegacyTier,
  SignalOutcome,
  Assessor,
  Signal,
  WspResult,
  PassContext,
  PassHeader,
  PassResult,
  PassRunner,
  WorkspaceContext,
  LicenceState,
  AssessmentRunContext,
  EvalOptions,
  ComplianceResult,
  CommandContribution,
  PassContribution,
  ReportFormatContribution,
  ExportFormatContribution,
  CatalogueContribution,
  TuiScreenContribution,
  ProbeContribution,
  AssessmentTypeContribution,
  ComplianceEvaluatorContribution,
  ModuleContributions,
  SwaoModuleManifest,
  CoreContext,
} from './plugin-types.js';
export { RunContextSchema } from './run-context.js';
// #4190 SET-01 (Design 125): setup per assessment type, shared vocabulary.
export {
  SETUP_ASSESSMENT_TYPES,
  SETUP_SCOPES,
  SETUP_BRANCH_STATES,
  SETUP_ASSESSMENT_TYPE_LABELS,
  SETUP_SCOPE_LABELS,
  SETUP_BRANCH_STATE_LABELS,
  SETUP_ASSESSMENT_TYPE_MIN_TIER,
  SetupAssessmentTypeSchema,
  SetupScopeSchema,
  SetupBranchStateSchema,
  SetupBranchRecordSchema,
  SetupStateRecordSchema,
  isSetupTypeAvailable,
  setupTypeToAssessmentType,
  parseSetupAssessmentType,
  branchStateFromHealth,
  setupBranchStateNote,
} from './setup-types.js';
export type {
  SetupAssessmentType,
  SetupScope,
  SetupBranchState,
  SetupBranchRecord,
  SetupStateRecord,
  SetupHealthCounts,
} from './setup-types.js';
// #3245 / #3281: run-status.json lifecycle marker (skipped targets of a partial run).
export {
  RUN_STATUS_FILE,
  RUN_STATUS_SCHEMA_VERSION,
  RunStatusSchema,
  RunStatusValueSchema,
  RunStatusFailedTargetSchema,
  RunStatusResolvedTargetSchema,
  readRunStatus,
  readSkippedTargets,
  isRunUsable,
  isRunStale,
  USABLE_RUN_STATUSES,
  RUN_STATUS_STALE_MS,
} from './run-status.js';
export type { RunStatus, RunStatusValue, RunStatusFailedTarget, RunStatusResolvedTarget } from './run-status.js';
// #3330: pair stakeholder challenges with the run they challenged.
export {
  CHALLENGED_RUN_FIELD,
  CHALLENGE_OTHER_RUN_NOTE,
  selectChallengeForRun,
  challengeTargetsDiffer,
  readChallengedRun,
  challengeSourceLabel,
  toFolderTs,
  // #3427: freshness, command and stale-challenge note.
  challengeFreshness,
  challengeCommand,
  otherChallengeLabel,
  staleChallengeNote,
  challengeOfferForRun,
} from './challenge-run.js';
export type { ChallengedRunRef, ChallengeKind, ChallengeMatch, ChallengeSelection, ChallengeFreshness, ChallengeOffer, SelectChallengeOptions } from './challenge-run.js';
export type { RunContext } from './run-context.js';
// Filesystem-based Chromium detection (#0799): shared by SetupWizard, health-check
// Playwright probe, and swao install-playwright. Safe in PKG binaries (no require).
export { findInstalledChromium, isPlaywrightPackageInstalled, PLAYWRIGHT_VERSION } from './playwright-detect.js';
// #3163: single Claude Desktop config resolver for the wizard, `swao init --mcp`, `swao mcp install` and the MCP health-check probe.
export {
  resolveClaudeDesktopConfigs,
  claudeDesktopConfigPath,
  claudeDesktopConfigHasSwaoEntry,
  selectClaudeDesktopPatchTargets,
  findSwaoServerKey,
  SWAO_BIN_RE,
  CLAUDE_DESKTOP_CONFIG_FILE,
} from './claude-desktop-config.js';
export type { ClaudeDesktopConfigCandidate, ClaudeDesktopConfigKind, ClaudeDesktopResolveOptions } from './claude-desktop-config.js';
// WSP compliance + risk-register schemas (Design 080 Phase 0, #1172): relocated from
// @swao/swao so @swao/module-mcp can import them without a circular package dependency.
// Re-exported from packages/swao/src/schema/wsp-plan.ts for existing import sites.
export {
  ComplianceRegimeIdSchema,
  ComplianceControlOutcomeSchema,
  ComplianceControlSchema,
  ComplianceRegimeSchema,
  RiskRegisterItemSchema,
} from './wsp-compliance.js';
export type {
  ComplianceControl,
  ComplianceRegime,
  RiskRegisterItem,
  ComplianceRegimeId,
} from './wsp-compliance.js';
// Durable-input schemas for MCP evidence/override/annotation (Design 080 §7 table, Phase 0).
export {
  WspEvidenceRecordSchema,
  WspRiskImportOverlaySchema,
  WspOverrideRecordSchema,
  WspAnnotationRecordSchema,
} from './wsp-feedback.js';
export type {
  WspEvidenceRecord,
  WspRiskImportOverlay,
  WspOverrideRecord,
  WspAnnotationRecord,
} from './wsp-feedback.js';
// Default pass profile constants (Design 080 §7.1, #1173): shared between
// @swao/module-mcp and @swao/module-app-assessment without a circular dep.
export { DEFAULT_PASS_NAMES, TOTAL_DEFAULT_PASSES, DEFAULT_PASS_PROFILE, CANONICAL_DEFAULT_PASS_KEYS } from './wsp-pass-profile.js';
// #3419 / #3436: pass coverage vocabulary (passes_not_run, passes_degraded).
export {
  PassNotRunReasonSchema,
  PassNotRunEntrySchema,
  PassDegradedReasonSchema,
  PassDegradedRegimeSchema,
  PassDegradedEntrySchema,
  PassCoverageReasonSchema,
  passCoverageReasonLabel,
} from './pass-coverage.js';
export type { PassNotRunReason, PassNotRunEntry, PassDegradedReason, PassDegradedEntry, PassCoverageReason } from './pass-coverage.js';
// WSP spine schema version (#1496): single source of truth so it tracks the
// product major.minor automatically. Update this string whenever the schema
// gains or removes fields (additive = minor bump per ADR-0012).
// #3873 (Design 123 section 9.2): '0.10' -> '0.11'. 0.11 is the generation the
// spine already accepts and the audit / landing zone writers already stamp
// (#0597); the bump closes that lag and covers the additive portfolio-summary.json
// fields (landing_zones[].baseline, .hierarchy, checks.unverified, apps[].lz_source).
export const WSP_SCHEMA_VERSION = '0.11' as const;
// #3342: LZ fit artefact file names (single-target lz-fit.yaml and
// multi-target lz-fit-<p>-<r>.yaml); every lz-fit reader goes through these.
export {
  LZ_FIT_PASS_FILE_RE,
  LZ_CATALOGUE_FIT_FILE_RE,
  isLzFitPassFile,
  isLzCatalogueFitFile,
  listLzFitPassFiles,
  listLzCatalogueFitFiles,
  lzCatalogueFitFileName,
} from './lz-fit-files.js';
// #3888: rule-engine decisions of Client LZ Policy Baseline controls in app runs (Design 123 section 8.4)
export { BASELINE_CONTROL_OUTCOMES, BASELINE_OUTCOME_RANK, BASELINE_DECISIONS_FILE, BaselineControlContributionSchema, BaselineControlDecisionSchema, BaselineControlDecisionsSchema, rankBaselineContributions, baselineContributionLabel, formatBaselineContributions, readBaselineDecisions, formatBaselineDecisionLines } from './baseline-decisions.js';
export type { BaselineControlOutcome, BaselineControlContribution, BaselineControlDecision, BaselineControlDecisions } from './baseline-decisions.js';
export { lzProviderBrand } from './lz-provider-brand.js';
// #4296: the one provider name map (abbreviation plus full name) of the SWAO ecosystem
export { PROVIDER_NAMES, PROVIDER_ABBR_WIDTH, providerName, providerLabel, providerColumns, brandProviderNames } from './provider-names.js';
export type { ProviderName, ProviderLabelForm } from './provider-names.js';
export { LZ_SCOPE_KIND_LABELS, LZ_SCOPE_KIND_DEFINITIONS, lzScopeKindLabel } from './lz-scope-kinds.js';
export type { LzScopeKind } from './lz-scope-kinds.js';
// #4239: the kinds of the workspace apps (applications, service apps) and the subject app of the setup, for every app picker.
export { appDisplayName, APP_INDEX_FILE, APP_KIND_GROUP, appKind, listWorkspaceApps, preselectedAppIndex, readSubjectApp, serviceAppsNoteText } from './workspace-app-kinds.js';
export type { AppKind, WorkspaceApp } from './workspace-app-kinds.js';
// #3885: tenant tree view shared by `swao lz hierarchy`, the TUI and the lz-live-hierarchy block (Design 123 sections 5.6, 9.3)
// #4050 (Design 120 section 8.4): document-only result of the organisational controls of a live LZ run.
export {
  LZ_ORGANISATIONAL_RESULT_SCHEMA, LZ_ORGANISATIONAL_RESULT_FILE, LZ_ORGANISATIONAL_OUTCOMES, LZ_ORGANISATIONAL_REASONS,
  LzOrganisationalOutcomeSchema, LzOrganisationalReasonSchema, LzOrganisationalControlSchema, LzOrganisationalCountsSchema,
  LzOrganisationalFrameworkSchema, LzOrganisationalResultSchema, lzOrganisationalCounts, lzOrganisationalDecided, readLzOrganisationalResult,
} from './lz-organisational-result.js';
export type { LzOrganisationalOutcome, LzOrganisationalReason, LzOrganisationalControl, LzOrganisationalCounts, LzOrganisationalFramework, LzOrganisationalResult } from './lz-organisational-result.js';
export { LzHierarchyViewSchema, LzHierarchyViewNodeSchema, buildLzHierarchyView, formatLzHierarchyTree, lzHierarchyNodeName } from './lz-hierarchy-view.js';
export type { LzHierarchyView, LzHierarchyViewNode, LzHierarchyViewInput } from './lz-hierarchy-view.js';
// #3956 (Design 123 section 9.5): evidence references, resolved locally; console links from documented patterns only.
export {
  LZ_EVIDENCE_MAP_FILE, LZ_EVIDENCE_MAP_SCHEMA, LZ_EVIDENCE_KINDS, LZ_EVIDENCE_SUBJECT, LZ_EVIDENCE_LABEL_PATTERN,
  LzEvidenceNativeSchema, LzEvidenceEntrySchema, LzEvidenceMapSchema, LzEvidenceRefError,
  parseLzEvidenceRef, formatLzEvidenceRef, lzEvidenceLabel, lzEvidenceKindsForPolicy, buildLzEvidenceMap,
  readLzEvidenceMap, lzEvidencePublicIndex, resolveLzEvidenceRef,
} from './lz-evidence-refs.js';
export type { LzEvidenceKind, LzEvidenceNative, LzEvidenceEntry, LzEvidenceMap, ParsedLzEvidenceRef, BuildLzEvidenceMapInput, LzEvidencePublicIndex, ResolvedLzEvidence } from './lz-evidence-refs.js';
export { LZ_CONSOLE_LINK_PRECISION, LZ_CONSOLE_LINK_URLS, LzConsoleLinkSchema, isLzConsoleLinkUrl, lzConsoleLink } from './lz-console-links.js';
export type { LzConsoleLink, LzConsoleLinkPrecision, LzConsoleTarget } from './lz-console-links.js';
// #3981: native-id regex mask for LZ free text (moved from publication-render).
export { maskNativeIds } from './lz-native-id-mask.js';
// #4270: LLM call context (caller, app_id, per-caller call count and cost).
export { withLlmCallContext, currentLlmCallContext, llmCallContextFields, recordLlmCallUsage, roundCostUsd, withLlmRetryCounter, recordLlmAttempt, recordLlmRetry } from './llm-call-context.js';
export type { LlmCallContext, LlmRetryCounter } from './llm-call-context.js';
// #4372: short LLM Assessment candidate labels (result table, run screen, publication).
export { candidateLabel, candidateLabels, CANDIDATE_LABEL_MAX } from './llm-candidate-label.js';
// #4372: total LLM cost wording with the unpriced calls ("plus N unpriced calls", "not measured").
export { formatCostTotal, unpricedCallsSuffix, costAllUnpriced, COST_NOT_MEASURED } from './llm-cost-total.js';
export type { CostTotalInput } from './llm-cost-total.js';
export { providerDescription } from './provider-names.js';
export { lzTokenRefreshHint, lzSessionExpiry, lzExpiredSessionLine, LZ_EXPIRED_SESSION_LINE_PREFIX } from './lz-credentials.js';
