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

export { findWorkspace, saveDefaultWorkspace, readDefaultWorkspace, resolveCatalogsDir } from './workspace.js';
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
export { TIME_QUADRANTS, TimeQuadrantSchema, PortfolioAppSchema, PortfolioSummarySchema, PORTFOLIO_ASSESSMENT_TYPES, PortfolioAssessmentTypeSchema, portfolioAppType, SEVEN_R_SOURCES, SevenRSourceSchema, CodeHealthKpisSchema } from './portfolio-summary.js';
export { SIGNAL_SEVERITY_RANK, countSignalsBySeverity, countBlockerSignals, sortSignalsBySeverity } from './signal-summary.js';
export { complianceRagStatus, summariseRegimeCompliance, normaliseComplianceOutcome, complianceOutcomeRag, tallyComplianceRag, addRag, complianceScore, COMPLIANCE_OUTCOME_ALIASES, COMPLIANCE_RAG_VALUES, type ComplianceRag, type ComplianceOutcome, type ComplianceRagTally, type ComplianceFrameworkSummary, type RawComplianceRegime } from './compliance-summary.js';
// #3425 follow-up: shared applies_when matcher (Pass 11 + publication extractor).
export { appliesWhenMatches, complianceNotEvaluatedReason, COMPLIANCE_NOT_EVALUATED_REASONS, NOT_EVALUATED_RATIONALE_PREFIX, type ComplianceNotEvaluatedReason, UNVERIFIED_EVIDENCE_RATIONALE_PREFIX, EVIDENCE_BASIS_MARKER, formatEvidenceBasis, splitEvidenceBasis } from './compliance-applicability.js';
export { normalizeRiskLikelihood, normalizeRiskImpact, summariseRiskRegister, type RiskLevel } from './risk-summary.js';
export { lzCatCheckResult, countLzFitBlockers } from './lz-fit-summary.js';
export type { TimeQuadrant, PortfolioApp, PortfolioSummary, PortfolioAssessmentType, SevenRSource, CodeHealthKpis } from './portfolio-summary.js';
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
} from './swao-yml.js';
// #3281: LZ catalogue target selection shared by the CLI, run-context and the TUI.
export {
  parseLzTarget,
  parseLzTargetList,
  lzTargetLabel,
  readLzTargetsKey,
  lzTargetsFromAssessment,
  resolveLzTargets,
  setLzTargetsInSwaoYml,
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
export { fileBackedToolRunner, treeKillPid, TOOL_OUTPUT_MAX_BYTES } from './tool-runner.js';
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
export { logApp, logPortfolio, setWorkspaceRoot, resolveWorkspaceRoot, listSinkPaths } from './log.js';
export type { LogLevel, LogScope, LogEntry, PortfolioLogOpts, AppLogOpts } from './log.js';
export { openWithDefaultApp, copyToClipboard } from './shell-actions.js';
export { CredentialStore, credentialStore } from './credential-store.js';
export { SIGNAL_SCHEMA_HINT, normalizeSignal } from './signal-normalizer.js';
// #3416: absence statements in signal evidence (derive-plan + publication).
export { isAbsenceEvidenceRef } from './evidence-absence.js';
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
  LzSovereigntyFactsSchema,
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
} from './cloud-provider-catalogue.js';
export type {
  CatalogueProvider,
  RequiredService,
  LandingZoneConstraints,
  LandingZoneWeights,
} from './cloud-provider-catalogue.js';
export {
  loadRegimeRegistry,
  loadBundledRegimeRegistry,
  validateRegimeIdAgainstRegistry,
  regimeFiles,
  loadRegimeCatalogue,
} from './compliance-registry.js';
export type { ResolvedRegime, RegimeRegistry } from './compliance-registry.js';
export { discoverFrameworks, findFramework, frameworkContributorName } from './framework-discovery.js';
export type { DiscoveredFramework, DiscoverFrameworksOptions } from './framework-discovery.js';
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
export type { ChallengedRunRef, ChallengeKind, ChallengeMatch, ChallengeSelection, ChallengeFreshness, ChallengeOffer } from './challenge-run.js';
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
export const WSP_SCHEMA_VERSION = '0.10' as const;
// #3342: LZ fit artefact file names (single-target lz-fit.yaml and
// multi-target lz-fit-<p>-<r>.yaml); every lz-fit reader goes through these.
export {
  LZ_FIT_PASS_FILE_RE,
  LZ_CATALOGUE_FIT_FILE_RE,
  isLzFitPassFile,
  isLzCatalogueFitFile,
  listLzFitPassFiles,
  listLzCatalogueFitFiles,
} from './lz-fit-files.js';
