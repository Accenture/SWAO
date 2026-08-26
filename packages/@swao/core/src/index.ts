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

export { findWorkspace, saveDefaultWorkspace, resolveCatalogsDir } from './workspace.js';
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
export { PassFileSchema, DataSourceSchema } from './wsp-pass.js';
export type { PassFile } from './wsp-pass.js';
export {
  SwaoYmlSchema,
  SwaoYmlCrawlSchema,
  SwaoYmlVcsSchema,
  SwaoYmlAssessmentSchema,
  SwaoYmlPublicationSchema,
  SwaoYmlLlmAssessmentSchema,
  SwaoYmlLlmAssessmentLegSchema,
} from './swao-yml.js';
export type {
  SwaoYml,
  SwaoYmlCrawl,
  SwaoYmlAssessment,
  SwaoYmlPublication,
  SwaoYmlLlmAssessment,
  SwaoYmlLlmAssessmentLeg,
} from './swao-yml.js';
// PII redaction (#0591): relocated from @swao/swao so the app-assessment
// module's `normalize` command can redact without importing from @swao/swao.
// redact-pre-llm holds process-global state (allowlist, person-name opt-in);
// there is one @swao/core instance in the workspace, so the singleton is shared
// across swao (via re-export stubs) and the modules.
export { emptyCounts, redactPiiString, redactPiiValue } from './redact-pii.js';
export type { RedactionCounts } from './redact-pii.js';
export {
  emptyPreLlmCounts,
  setAllowlist,
  setScrubPersonName,
  _resetForTests,
  redactPreLlm,
  redactForReport,
} from './redact-pre-llm.js';
export type { PreLlmRedactionCounts } from './redact-pre-llm.js';
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
export { inferOutcomeFromSeverity, enrichSignal, enrichSignals } from './auditor-enricher.js';
export type { EnrichOptions } from './auditor-enricher.js';
// #0776-C / #0751: shared crawl-section writer for AssessScreen + round-trip tests.
export { writeCrawlSection } from './crawl-config-write.js';
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
  RegimeMetaSchema,
  RegimeControlSchema,
  RegimeCatalogueSchema,
  RegimeIndexSchema,
} from './regime-catalogue.js';
export type {
  RegimeId,
  Scope,
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
export type { RunContext } from './run-context.js';
// Filesystem-based Chromium detection (#0799): shared by SetupWizard, health-check
// Playwright probe, and swao install-playwright. Safe in PKG binaries (no require).
export { findInstalledChromium, isPlaywrightPackageInstalled, PLAYWRIGHT_VERSION } from './playwright-detect.js';
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
export { DEFAULT_PASS_NAMES, TOTAL_DEFAULT_PASSES } from './wsp-pass-profile.js';
// WSP spine schema version (#1496): single source of truth so it tracks the
// product major.minor automatically. Update this string whenever the schema
// gains or removes fields (additive = minor bump per ADR-0012).
export const WSP_SCHEMA_VERSION = '0.10' as const;
