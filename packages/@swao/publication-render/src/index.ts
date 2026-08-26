// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * @swao/publication-render -- the SHARED HTML publication-rendering engine
 * (ADR-0048 modular architecture; Sprint 064 #0582, module-split stage 1).
 *
 * A leaf package (depends only on @swao/core + @swao/community-frameworks +
 * leaf npm; NO react / ink / fastify / commander). It owns the engine that both
 * the Community single-page publication (@swao/module-html-report's renderModeA)
 * and the Consultant HTML portal render through, so the two share ONE pipeline
 * without a sibling import (Design 058 D-PORTAL-1 / D-PORTAL-4).
 *
 * It is NOT a `@swao/module-*`: it ships no SwaoModuleManifest. It is a shared
 * leaf, the rendering counterpart to @swao/tui-kit (which is the shared UI leaf).
 */

// Publication model + zod schemas + types.
export { PublicationModelSchema, CONTRACT_VERSION } from './publish/model.js';
export type {
  PublicationModel,
  PubSignal,
  PubEvidence,
  EvidenceType,
  FrameworkResult,
  ControlResult,
  RiskRegisterItem,
  LZRSummary,
  RunSummary,
  TagIndex,
  TagIndexEntry,
} from './publish/model.js';

// Extractor + PII sanitiser + lens loader.
export { extractPublicationModel, extractLzCatalogPublicationModel, sanitisePII, loadLensDefinition } from './publish/extractor.js';
export type { LensDefinition, SanitisePiiResult, PiiRedaction } from './publish/extractor.js';

// LLM Assessment extractor + data types (#1428, Design 092 s8).
export { extractLlmAssessmentPublicationModel } from './publish/llm-extractor.js';
export type { LlmPubData, LlmLegInfo, LlmGroupResult, LlmFinalResult, LlmFinding, LlmPassGroup, LlmPassLegAggregate, LlmBucketView } from './publish/llm-pub-data.js';

// Block renderers (renderBlock dispatcher + the portal's renderAppCard).
// Component helpers (Steps 2-6 #0946-#0950): swao-tiles-compliance, swao-chart-donut,
// swao-chart-severity-bar, swao-rag-badge, swao-progress-bar, swao-tooltip.
export {
  renderBlock,
  renderAppCard,
  renderComplianceTileGrid,
  renderChartDonut,
  renderChartSeverityBar,
  swaoRagBadge,
  swaoProgressBar,
  swaoTooltip,
} from './publish/blocks.js';

// Render plan builder + publication title map (#0790, Design 067-068).
export { derivePlanForLzRun, derivePlanForHubRun, derivePlanForLlmRun, resolvePublicationTitle, PUBLICATION_TITLE_MAP } from './publish/planner.js';
export type { BlockPlan } from './publish/planner.js';

// Tag + search index.
export { buildTagIndex, buildSearchIndex, serialiseTagIndex } from './publish/tag-index.js';

// Data-quality banner. The conditions contract (evaluateDataQuality +
// buildDataQualityFlagsString + DataQualityCondition) lives in @swao/core
// (#0577); re-exported here for the engine's existing consumers, alongside the
// banner HTML renderer (a presentation concern that lives in this engine).
export {
  evaluateDataQuality,
  buildDataQualityFlagsString,
  buildDataQualityBannerHtml,
} from './publish/data-quality-banner.js';
export type { DataQualityCondition } from './publish/data-quality-banner.js';

// CI/branding token store (D1 -- #0930).
export { TIER1_TOKENS, readCiTokens, buildCiTokenStyleBlock } from './publish/ci-tokens.js';
export type { CiTokens, Tier1TokenName } from './publish/ci-tokens.js';

// Profile YAML reader + variant support + static block registry (Step 10 -- #0943, Design 068 §20.5, Phase 3A #1125).
export { loadProfileOverride, listProfileVariants, resolveProfilePath, BLOCK_PROFILES } from './publish/profiles.js';
export type { ResolvedProfile, ProfileBlockEntry, ProfileVariantInfo } from './publish/profiles.js';

// Component Library registry + OptionSchemas (Step 1 -- #0944, Design 068 §20.5).
export { componentOptions, registeredComponents, COMPONENT_SCHEMAS } from './publish/registry.js';
export type { ComponentName } from './publish/registry.js';

// Canonical slot-marker template (D2 -- #0931; single source in ./publish/template.ts).
// PUBLICATION_TEMPLATE is the primary export; BUNDLED_TEMPLATE_CONTENT is a re-export
// alias for backwards compatibility (editor/template.ts proxies from template.ts).
// LZ_CATALOG_TEMPLATE is the Phase 3A per-type template for landing zone catalog publications.
// LLM_ASSESSMENT_TEMPLATE is the LLM Assessment per-type template (#1428, Design 092 s8).
export { PUBLICATION_TEMPLATE, LZ_CATALOG_TEMPLATE } from './publish/template.js';
export { LLM_ASSESSMENT_TEMPLATE } from './publish/llm-template.js';
export { BUNDLED_TEMPLATE_CONTENT } from './publish/editor/template.js';

// Shared page-assembly pipeline + asset resolver + size error. renderModeA (in
// @swao/module-html-report) wraps assemblePublicationPage with extract/load/write;
// the portal builder reuses assemblePublicationPage + resolvePublishAsset.
export {
  assemblePublicationPage,
  resolvePublishAsset,
  PublicationSizeError,
  MAX_APP_BYTES,
  WARN_APP_BYTES,
} from './publish/renderer-core.js';
