// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * @swao/module-service-assessment -- Service Portfolio Assessment (Design 103, ADR-0064).
 *
 * Phase 1 surface: Excel intake parsing, column mapping, PII scrubbing,
 * SWAO-INFRA-CAT classification, cluster detection, and the `swao service init`
 * scaffold. The runnable `service` assessment-type contribution is registered
 * in a later phase (#3094).
 */

import type { AssessmentTypeContribution, SwaoModuleManifest } from '@swao/core';

export * from './schema/column-map.schema.js';
export * from './schema/service-app.schema.js';
export { cellText, coerceCell } from './intake/cell.js';
export { parseIdNameCell, detectOperationalFlag, normaliseAppId, resolveOperationalStatus } from './intake/column-a.js';
export type { OperationalStatus, ParsedIdName } from './intake/column-a.js';
export { resolveDefaultMap, DEFAULT_HEADER_ALIASES } from './intake/default-template.js';
export { looksLikePersonalName, REDACTED_CONTACT_NAME } from './intake/pii.js';
export { canonicalTerm, resolveGlossary, termKey, DEFAULT_GLOSSARY, CRITICALITY_TERMS, TIME_TERMS, CLASSIFICATION_TERMS } from './intake/terms.js';
export type { TermResult } from './intake/terms.js';
export { parseIntakeSheets, parseIntakeWorkbook, IntakeError } from './intake/parser.js';
export type { IntakeRow, IntakeParseResult, IntakeSheetInfo, SheetLike } from './intake/parser.js';
export {
  loadInfraCatalogue, classify, idPrefix, resolveBuiltinCatalogueDir, tier2Dir, InfraCatError, InfraCatFileSchema,
  InfraCatBuiltinMetaSchema, discoverBuiltinCatalogueFiles, hasBuiltinCatalogueFiles, type BuiltinCatalogueFile,
} from './catalog/infra-cat.js';
export type { InfraCatalogue, InfraCatService, Classification } from './catalog/infra-cat.js';
export { planScaffold, DEFAULT_CLUSTER_THRESHOLD, GENERATED_FIELDS } from './scaffold/plan.js';
export type { AppPlan, ScaffoldPlan } from './scaffold/plan.js';
export { writeScaffold, upsertServicePortfolioBlock, INGESTION_HINT_FOLDERS } from './scaffold/write.js';
export { SERVICE_INTAKE_DIR, IntakeLocationError, resolveServiceIntake, serviceIntakeDir, type ResolvedIntake } from './scaffold/intake-location.js';
export type { ServicePortfolioMeta, WriteResult } from './scaffold/write.js';
export { runServiceInit, loadColumnMapFile } from './scaffold/init.js';
export type { ServiceInitOptions, ServiceInitResult } from './scaffold/init.js';
export * from './research/schema.js';
export { runServiceResearch, discoverServiceApps, readServiceApp, validateStub, ResearchError, DEFAULT_BASE_URLS, llmSkippedNote } from './research/research.js';
export type { ServiceResearchOptions, ServiceResearchResult, AppResearchResult, ResearchBaseUrls, ResearchAppInput, TopicAction } from './research/research.js';
export { LLM_RESEARCH_SIGNAL_CODES, RESEARCH_SIGNALS, RESEARCH_SIGNAL_CODES, RESEARCH_SIGNALS_FILE, ResearchSignalSchema, ResearchSignalsFileSchema, isNegativeFinding, researchSignals, PATCH_CADENCE_SLOW_DAYS } from './research/signals.js';
export type { ResearchSignal, ResearchSignalCode, ResearchSignalsFile, ResearchAppContext } from './research/signals.js';
export { minConfidence, topicConfidence, distribution, formatDistribution } from './research/confidence.js';
export type { ConfidenceDistribution } from './research/confidence.js';
export { readStub, parseStub } from './research/stub-file.js';
export { researchTopicWithLlm, extractJsonObject, toFindings, llmTopicConfidence, LlmResearchResponseSchema, LLM_CONFIDENCE_CAP, parseLlmFacts, LLM_TOPIC_FACT_KEYS } from './research/llm-research.js';
export type { ResearchLlm, LlmResearchOutcome } from './research/llm-research.js';
export { LLM_RESEARCH_PROMPT_VERSION, LLM_RESEARCH_FACT_FIELDS, buildLlmResearchPrompt, llmResearchResponseInstructions } from './research/llm-prompts.js';
export type { LlmResearchTopic, LlmResearchPromptInput } from './research/llm-prompts.js';
export { RateLimiter, realClock } from './research/http.js';
export type { FetchLike, Clock } from './research/http.js';

export { eolSignal, buildIntegrationGraph, blastRadius, planWaves, waveOf, effortDays, renderWaveReport, canonicalVendor, vendorConsolidation, WAVE_LABELS, NOT_ASSESSED_MARK } from './portfolio/analytics.js';
export type { EolSignal, IntegrationGraph, WavePlan, WaveInput, WaveReportApp, VendorGroup } from './portfolio/analytics.js';
export { computeDelta, recordPortfolioDelta, renderDeltaReport, listSnapshots, DELTA_CATEGORIES, MAX_SNAPSHOTS } from './portfolio/delta.js';
export type { DeltaItem, DeltaCategory } from './portfolio/delta.js';
export { estimateCost, resolveCostOptions, selectSku, isWindowsServer, CostOptionsSchema, CostOptionsError, COST_NOTE, WINDOWS_LINUX_PRICED_NOTE, PROVIDER_PARITY_NOTE, NO_PRICE_TABLE_NOTE } from './cost/cost-model.js';
export { loadPriceTable, readPriceTable, resolveBundledPriceTablePath, workspacePriceTablePath, PriceTableError } from './cost/price-table.js';
export type { LoadedPriceTable, PriceTableOrigin } from './cost/price-table.js';
export type { CostBlock, CostOptions, SizedSku } from './cost/cost-model.js';
export { VM_SKUS, PRICE_BASIS, ECB_REFERENCE } from './cost/vm-sku-table.js';
export type { VmSku } from './cost/vm-sku-table.js';
export { parseCapacity } from './intake/cell.js';
export { runBinaryAnalysis, binarySignals, BINARY_ANALYSIS_FILE, GENERATED_BINARY_FILES, UNPARSED_BINARY_FORMATS } from './binary/analyse.js';
export type { BinaryAnalysis, BinaryFileResult } from './binary/analyse.js';
export { parsePe, dotnetVersion } from './binary/pe.js';
export type { PeInfo, PeArch } from './binary/pe.js';
export { parseMsi, decodeMsiStreamName } from './binary/msi.js';
export type { MsiInfo } from './binary/msi.js';
export { parseAuthenticode } from './binary/authenticode.js';
export type { SignatureInfo, CertInfo } from './binary/authenticode.js';
export { BoundedReader, sha256File } from './binary/reader.js';
export { APM_RULES, APM_RULE_NAMES } from './apm/rules.js';
export type { ApmEvidence, ApmRule, ApmSignal } from './apm/rules.js';
export { APM_DOMAINS, APM_FOLDER, ApmControlSchema, loadApmFramework, apmFrameworkDir, validateDomainWeights, ApmFrameworkError } from './apm/framework.js';
export type { ApmDomain, ApmFramework, ApmControl, TimeRules } from './apm/framework.js';
export { scoreApp, classifyTime, gatherEvidence, buildPortfolioSummary } from './apm/score.js';
export { discoverApplicationApps, resolveApplicationRun, gatherApplicationEvidence, scoreApplicationApp, classifyApplicationTime, sevenRToTime, SEVEN_R_TIME, APPLICATION_RULES, type ApplicationEvidence } from './apm/application.js';
export type { AppScore, ControlScore, TimeResult } from './apm/score.js';
export { runServiceCryptoPass, runServiceDataPass, scanConfigFiles, hasDeclaredDataFields } from './profile/service-passes.js';
export { SERVICE_PASS_PROFILE, planServicePasses, buildServiceScopeCoverage, formatSkippedSummary, hintInputDir } from './profile/service-pass-profile.js';
export type { ServicePassDef, ServicePassMode, ServicePassPlan, ServiceScopeCoverage, SkippedPass } from './profile/service-pass-profile.js';
// #3353: the Enterprise portfolio workbook and star schema (licence tier matrix F-133)
// live in the private premium module @swao/module-service-export; the
// combined portfolio view they read (buildPortfolioSummary, PortfolioSummary in
// @swao/core) stays public.

/**
 * Runnable `service` registration for the assessment-type router (ADR-0064, #3094).
 * Like `application`, the pipeline is driven inline by `swao assess`, which
 * applies the service pass profile; run() is never called directly.
 */
export const serviceAssessmentType: AssessmentTypeContribution = {
  type: 'service',
  description: 'Service Portfolio Assessment (Design 103): third-party, SaaS, and COTS apps from an Excel intake.',
  run: async () => {
    throw new Error('service assessment is dispatched inline by swao assess (ADR-0064)');
  },
};

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-service-assessment',
  version: '0.1.0',
  tier: 'community',
  contributions: { assessmentTypes: [serviceAssessmentType] },
};
export { rankServiceApps, rankPortfolioApps, isNotAssessed, type RankedServiceApp } from './portfolio/selection.js';
