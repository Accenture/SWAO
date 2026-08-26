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
 * Publication block library -- Design 041-PUB-06 + issue #0456
 *
 * Barrel re-exporting all block renderers and the renderBlock dispatcher.
 * Implementation split into domain files under ./blocks/ (Design 068 §20.9 Step 9).
 * TypeScript strict; NodeNext module resolution.
 */

import type { PublicationModel } from './model.js';

// Assessment blocks
import {
  renderCover,
  renderExecSummary,
  renderCoverageBar,
  renderSevenRCard,
  renderSignalList,
  renderQuickNav,
  renderBlockScorecard,
} from './blocks/assessment.js';

// Compliance blocks
import {
  renderComplianceMatrix,
  renderComplianceRegime,
  renderControls,
  renderComplianceFrameworkDetail,
  renderComplianceRequirements,
} from './blocks/compliance.js';

// Risk blocks
import {
  renderRiskRegister,
  renderEvidenceGallery,
} from './blocks/risk.js';

// Meta blocks
import {
  renderRunHistory,
  renderTagTaxonomy,
  renderGlossary,
  renderPassExplainer,
  renderFrameworkExplainer,
  renderAssessmentScope,
  renderMethodology,
  renderPersonaPortal,
  renderFooter,
  renderToc,
  renderRunbook,
  renderDeltaView,
  renderAppendixRawWsp,
} from './blocks/meta.js';

// LZ blocks
import {
  renderLzrSummary,
  renderLzCatalogServices,
  renderLzrCatalogHeader,
  renderLzrCatalogVerdict,
  renderLzrCatalogFindings,
  renderLzrCatalogRemediation,
  renderLzrCatalogFinops,
} from './blocks/lz.js';

// Hub blocks
import {
  renderHubHeader,
  renderHubAppList,
  renderHubCrossLinks,
  renderHubWorkspaceSummary,
  renderChallengeBlock,
  renderPortfolioGrid,
} from './blocks/hub.js';

// LLM Assessment blocks (#1428, Design 092 s8; #1587 challenge-results)
import {
  renderLlmHeader,
  renderLlmFinalRanking,
  renderLlmGroupBreakdown,
  renderLlmPassTable,
  renderLlmFindings,
  renderLlmMethodology,
  renderLlmNarrative,
  renderLlmModelDetail,
  renderLlmPassDeepDive,
  renderLlmChallengeResults,
} from './blocks/llm.js';

// ---------------------------------------------------------------------------
// Re-exports for external consumers (index.ts, blocks.test.ts)
// ---------------------------------------------------------------------------

export {
  renderComplianceTileGrid,
  renderChartDonut,
  renderChartSeverityBar,
  swaoRagBadge,
  swaoProgressBar,
  swaoTooltip,
} from './blocks/helpers.js';

export { renderAppCard } from './blocks/hub.js';

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function renderBlock(
  name: string,
  params: Record<string, string>,
  model: PublicationModel,
  logger?: { warn(msg: string): void },
  componentOptions?: Record<string, Record<string, string>>,
): string {
  const tableOpts = componentOptions?.['swao-table'];
  const tileOpts  = componentOptions?.['swao-tiles-compliance'];
  const donutOpts = componentOptions?.['swao-chart-donut'];
  const sevBarOpts = componentOptions?.['swao-chart-severity-bar'];
  // ragBadgeOpts reserved for callers that directly render rag badges with profile options
  void componentOptions?.['swao-rag-badge'];
  switch (name) {
    case 'cover':
      return renderCover(model);
    case 'quick-nav':
      return renderQuickNav(model);
    case 'exec-summary':
      return renderExecSummary(model);
    case 'signal-list':
      return renderSignalList(model, params, tableOpts);
    case 'compliance-regime':
      return renderComplianceRegime(model, tableOpts, tileOpts);
    case 'compliance-matrix':
      return renderComplianceMatrix(model);
    case 'controls':
      return renderControls(model, tableOpts);
    case 'risk-register':
      return renderRiskRegister(model, tableOpts);
    case 'evidence-gallery':
      return renderEvidenceGallery(model, tableOpts);
    case 'lzr-summary':
      return renderLzrSummary(model);
    case 'stakeholder-challenge':
      return renderChallengeBlock(model);
    case 'coverage-bar':
      return renderCoverageBar(model, donutOpts, sevBarOpts);
    case 'seven-r-card':
      return renderSevenRCard(model);
    case 'footer':
      return renderFooter(model);
    case 'toc':
      return renderToc(params);
    case 'run-history':
      return renderRunHistory(model, tableOpts);
    case 'tag-taxonomy':
      return renderTagTaxonomy(model);
    case 'glossary':
      return renderGlossary(tableOpts);
    case 'pass-explainer':
      return renderPassExplainer(model);
    case 'framework-explainer':
      return renderFrameworkExplainer(model);
    case 'compliance-framework-detail':
      return renderComplianceFrameworkDetail(model, params);
    case 'methodology':
      return renderMethodology();
    case 'persona-portal':
      return renderPersonaPortal(model, params);
    case 'runbook':
      return renderRunbook(model);
    case 'delta-view':
      return renderDeltaView(model);
    case 'portfolio-grid':
      return renderPortfolioGrid(model, params);
    case 'compliance-requirements':
      return renderComplianceRequirements(model);
    case 'assessment-scope':
      return renderAssessmentScope(params, model);
    case 'appendix-raw-wsp':
      return renderAppendixRawWsp(params, model);
    case 'lz-catalog-services':
      return renderLzCatalogServices(model);
    case 'lzr-catalog-header':
      return renderLzrCatalogHeader(model);
    case 'lzr-catalog-verdict':
      return renderLzrCatalogVerdict(model);
    case 'lzr-catalog-findings':
      return renderLzrCatalogFindings(model);
    case 'lzr-catalog-remediation':
      return renderLzrCatalogRemediation(model);
    case 'lzr-catalog-finops':
      return renderLzrCatalogFinops(model);
    case 'hub.header':
      return renderHubHeader(model);
    case 'hub.app_list':
      return renderHubAppList(model);
    case 'hub.cross_links':
      return renderHubCrossLinks(model);
    case 'hub.workspace_summary':
      return renderHubWorkspaceSummary(model);
    case 'block-scorecard':
      return renderBlockScorecard(model);
    case 'llm.header':
      return renderLlmHeader(model);
    case 'llm.final-ranking':
      return renderLlmFinalRanking(model);
    case 'llm.group-breakdown':
      return renderLlmGroupBreakdown(model);
    case 'llm.pass-table':
      return renderLlmPassTable(model);
    case 'llm.findings':
      return renderLlmFindings(model);
    case 'llm.methodology':
      return renderLlmMethodology(model);
    case 'llm.narrative':
      return renderLlmNarrative(model);
    case 'llm.model-detail':
      return renderLlmModelDetail(model);
    case 'llm.pass-deep-dive':
      return renderLlmPassDeepDive(model);
    case 'llm.challenge-results':
      return renderLlmChallengeResults(model);
    default:
      (logger ?? console).warn(`[swao publish] Unknown block "${name}" -- skipped`);
      return `<section class="swao-block swao-block--skipped" aria-hidden="true"></section>`;
  }
}
