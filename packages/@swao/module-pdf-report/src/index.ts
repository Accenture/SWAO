// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  PDF report module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { SwaoModuleManifest } from '@swao/core';

/**
 * @swao/module-pdf-report -- the PDF report renderer (ADR-0048 modular
 * architecture, Phase 5, #0576). Consultant tier.
 *
 * Only the PDF RENDERING moves here. The `report` command and its ReportScreen
 * stay in the host: Community users keep the text / yaml / view formats; the
 * PDF format is the Consultant-gated surface. The host's existing runtime gate
 * (`guard.requireTier('consultant', { feature: 'report --format pdf' })` in
 * commands/report.ts) is unchanged -- this module adds no gating logic; it only
 * declares `tier: 'consultant'` in the manifest below and provides the renderer.
 *
 * The only host values the renderer needs -- SWAO version / contacts / landing
 * URL (branding is host-only) -- are injected via the `product` field of
 * RenderPdfArgs; the host passes them from its ./branding.js at the call site
 * (the #0575 SWAO_VERSION-injection pattern).
 */

export { renderTextReportToPdf, renderLlmComparisonToPdf, pdfkitSelfTest } from './report-pdf.js';
export type {
  RenderPdfArgs, PdfProductBranding, ComplianceControlRow,
  LlmPdfArgs, LlmPdfLegInfo, LlmPdfGroupResult, LlmPdfPassGroup, LlmPdfPassLegAgg, LlmPdfFinding,
} from './report-pdf.js';

// ReportFormatContribution does not fit this renderer: its shape is
// `(wsp, opts) => Promise<Buffer | string>`, but renderTextReportToPdf needs
// the host-built textBody / data / branding / product inputs and writes to a
// file path (returning void). So the manifest declares the tier + the renderer
// export rather than wiring a reportFormats contribution. `contributions` is a
// required field on SwaoModuleManifest, hence the empty object.
export const manifest: SwaoModuleManifest = {
  id: '@swao/module-pdf-report',
  version: '0.1.0',
  tier: 'consultant',
  contributions: {},
};
