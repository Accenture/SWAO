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

import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
// #0576: ReportData / LicenseeBranding moved to @swao/core; a @swao/module-*
// may not import host code (the old `./report.js` / `../branding.js` paths).
import type { ReportData, LicenseeBranding, SignalEntry, ChallengeAgentFinding } from '@swao/core';
import { reportViewToAgentId } from '@swao/core';

/**
 * Host-only branding constants injected by the host at the call site
 * (report.ts reads them from its ./branding.js). The module must not import
 * the host's branding module, so these are passed in via RenderPdfArgs.product.
 */
export interface PdfProductBranding {
  swaoVersion:   string;
  contactsInline: string;
  landingUrl:    string;
}

const MARGIN     = 50;
const FONT_BODY  = 'Helvetica';
const FONT_BOLD  = 'Helvetica-Bold';
const FONT_MONO  = 'Courier';
const SIZE_TITLE = 16;
const SIZE_H2    = 11;
const SIZE_BODY  = 9;
const SIZE_FOOT  = 7;

// Severity badge colours
const SEV_COLORS: Record<string, string> = {
  blocker:  '#c0392b',
  critical: '#e74c3c',
  high:     '#e67e22',
  medium:   '#f39c12',
  low:      '#27ae60',
  positive: '#2980b9',
};
const SEV_COLOR_DEFAULT = '#7f8c8d';

function severityColor(sev: string): string {
  return SEV_COLORS[sev.toLowerCase()] ?? SEV_COLOR_DEFAULT;
}

// #0729: 7R label color by migration complexity
function sevenRColor(label: string): string {
  const l = label.toLowerCase();
  if (l === 'rehost' || l === 'retain') return '#27ae60';
  if (l === 'replatform' || l === 'relocate') return '#f39c12';
  if (l === 'refactor' || l === 're-architect' || l === 'rearchitect' || l === 'retire') return '#e74c3c';
  return '#103a5e';
}

// #0729: coverage score color (>=90% green, 70-89% amber, <70% red)
function coverageColor(score: string): string {
  const num = parseFloat(score);
  if (isNaN(num)) return '#103a5e';
  if (num >= 90) return '#27ae60';
  if (num >= 70) return '#f39c12';
  return '#e74c3c';
}

/** Optional compliance control row for the compliance PDF table (#0729). */
export interface ComplianceControlRow {
  id:        string;
  verdict:   string;
  rationale: string;
}

/** One framework/service requirement item within a LZ target (from lz-fit YAML items). */
export interface LzFrameworkItem {
  id:        string;
  verdict:   string;
  rationale: string;
}

/** LZ target summary row for the CSP/Region comparison table in LZ reports. */
export interface LzTargetRow {
  csp:            string;
  region:         string;
  verdict:        string;
  frameworks:     string;
  services:       string;
  mode:           string;
  /** Per-target framework / sovereignty requirement checks from lz-fit items. */
  frameworkItems: LzFrameworkItem[];
}

export interface RenderPdfArgs {
  /** Kept for backward compatibility; no longer used for body rendering.
   *  Body is rendered from structured `data` fields instead. */
  textBody:   string;
  outputPath: string;
  appId:      string;
  viewName:   string;
  branding:   LicenseeBranding;
  data:       ReportData;
  /** Host-only product branding constants (SWAO version / contacts / landing
   *  URL), injected by the host at the call site (#0576). */
  product:    PdfProductBranding;
  /** #0729: ISO timestamp for the report generation date shown in the title block.
   *  Defaults to new Date().toISOString() when omitted. */
  reportDate?: string;
  /** #0729: compliance controls for the control-summary table in compliance PDFs. */
  complianceControls?: ComplianceControlRow[];
  /** LZ target rows for the CSP/Region comparison table in LZ reports. */
  lzTargets?: LzTargetRow[];
}

/**
 * Render a structured assessment report as a PDF file (#0710).
 * Uses ReportData fields (blockers, topFindings, nextSteps, signalCounts,
 * coverageScore) to produce a styled layout with branded headings, severity
 * colour badges, signal cards, a summary table, and a numbered next-steps list.
 * Returns a Promise that resolves once the write stream has flushed to disk.
 */
export function renderTextReportToPdf(args: RenderPdfArgs): Promise<void> {
  const { outputPath, appId, viewName, branding, data, product, complianceControls, lzTargets } = args;
  const reportDate = args.reportDate ?? new Date().toISOString();

  return new Promise((resolve, reject) => {
    let doc: PDFKit.PDFDocument;
    try {
      doc = new PDFDocument({
        size:    'A4',
        margins: { top: MARGIN, bottom: MARGIN + 40, left: MARGIN, right: MARGIN },
        // bufferPages is required so we can iterate already-emitted pages
        // to draw the footer on each one. Without it, switchToPage() does
        // not work and per-page footer writes accidentally trigger new
        // empty pages.
        bufferPages: true,
        info: {
          Title:    `SWAO Assessment Report -- ${appId} (${viewName})`,
          Author:   branding.data?.organisation ?? 'SWAO',
          Subject:  `SWAO ${viewName} view for ${appId}`,
          Creator:  `SWAO v${product.swaoVersion}`,
          Producer: `SWAO v${product.swaoVersion} (pdfkit)`,
        },
      });
    } catch (err) {
      reject(err);
      return;
    }

    const stream = createWriteStream(outputPath);
    stream.on('finish', () => resolve());
    stream.on('error', reject);
    // Handle errors on the source (pdfkit) stream too -- otherwise
    // they vanish silently into the pipe without rejecting the promise.
    doc.on('error', reject);
    doc.pipe(stream);

    try {
      drawTitleBlock(doc, appId, viewName, reportDate);
      drawBrandingBlock(doc, branding);
      drawEngagementBlock(doc, data);
      drawStructuredBody(doc, data, viewName, complianceControls, lzTargets);
      drawFooters(doc, product, appId, viewName);
      // After footer writes, doc.y is past the page's bottom-margin boundary.
      // Reset the cursor on the last content page before end() to prevent
      // PDFKit from detecting overflow and auto-adding a spurious trailing page.
      const bufRange = doc.bufferedPageRange();
      doc.switchToPage(bufRange.start + bufRange.count - 1);
      doc.y = MARGIN;
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawTitleBlock(doc: PDFKit.PDFDocument, appId: string, viewName: string, reportDate: string): void {
  doc.font(FONT_BOLD).fontSize(SIZE_TITLE).fillColor('#103a5e')
    .text(`SWAO Assessment Report`, { align: 'left' });
  doc.moveDown(0.2);
  doc.font(FONT_BODY).fontSize(SIZE_H2).fillColor('#103a5e')
    .text(`${appId}   --   ${viewName} view`, { align: 'left' });
  doc.moveDown(0.15);
  // #0729: report generation date in the title block subtitle
  const reportDateDisplay = reportDate.replace('T', '  ').replace(/\.\d+Z$/, ' UTC');
  doc.font(FONT_BODY).fontSize(SIZE_FOOT).fillColor('#888')
    .text(`Report date: ${reportDateDisplay}`, { align: 'left' });
  doc.moveDown(0.4);
  doc.strokeColor('#103a5e').lineWidth(1)
    .moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
  doc.moveDown(0.6);
}

function drawBrandingBlock(doc: PDFKit.PDFDocument, branding: LicenseeBranding): void {
  if (!branding.data) return;
  const b = branding.data;
  doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#333');
  doc.text('Generated for:    ', { continued: true });
  doc.font(FONT_BODY).text(`${b.licensee}${b.organisation ? `, ${b.organisation}` : ''}`);
  doc.font(FONT_BOLD).text('License:          ', { continued: true });
  const tierLabel = b.tier === 'enterprise' ? 'Enterprise' : 'Consultant';
  const expSuffix = b.expires ? ` -- expires ${b.expires}` : '';
  doc.font(FONT_BODY).text(`${tierLabel}${expSuffix}`);
  doc.moveDown(0.5);
}

function drawEngagementBlock(doc: PDFKit.PDFDocument, data: ReportData): void {
  const eng = data.engagement;
  if (!eng) return;
  doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#333');
  const row = (label: string, value: string | undefined) => {
    if (!value) return;
    doc.font(FONT_BOLD).text(`${label}: `.padEnd(18, ' '), { continued: true });
    doc.font(FONT_BODY).text(value);
  };
  row('Engagement',       eng.name);
  row('Client code',      eng.client_code);
  row('Partnership lead', eng.partnership_lead);
  row('Start date',       eng.start_date);
  row('Assessed',         data.assessedAt || undefined);
  doc.moveDown(0.5);
}

// ---------------------------------------------------------------------------
// Structured body rendering (#0710)
// ---------------------------------------------------------------------------

function drawH2Heading(doc: PDFKit.PDFDocument, title: string, color = '#103a5e'): void {
  // Page break guard: if less than 80pt remain, add a new page.
  if (doc.y > doc.page.height - MARGIN - 80) doc.addPage();
  doc.moveDown(1.0);
  // #0817-A: always reset x to MARGIN before heading text so a prior
  // lineBreak:false rendering (e.g. signal counts strip) does not shift
  // the heading to a corrupted x position.
  doc.font(FONT_BOLD).fontSize(SIZE_H2).fillColor(color)
    .text(title, MARGIN, doc.y, { width: doc.page.width - MARGIN * 2 });
  doc.moveDown(0.15);
  doc.strokeColor(color).lineWidth(0.5)
    .moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
  doc.moveDown(0.35);
}

function drawSummaryTable(doc: PDFKit.PDFDocument, data: ReportData): void {
  const pageW = doc.page.width - MARGIN * 2;
  const colLabel = 130;
  const rowGap = 4; // #0729: 4pt gap between summary rows

  // Plain row (black value)
  const row = (label: string, value: string, valueColor?: string) => {
    const y0 = doc.y;
    doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#555')
      .text(label, MARGIN, y0, { width: colLabel });
    doc.font(FONT_BODY).fillColor(valueColor ?? '#333')
      .text(value || '-', MARGIN + colLabel, y0, { width: pageW - colLabel });
    // #1771: ensure doc.y advances by at least one line height so an empty
    // value string cannot leave the cursor mid-row and cause the next row
    // to overlap with the label text of this row.
    doc.y = Math.max(doc.y, y0 + doc.currentLineHeight()) + rowGap;
  };

  // #0729: color-coded coverage score
  const covColor = coverageColor(data.coverageScore ?? '');
  row('Coverage score:', data.coverageScore ?? '-', covColor);

  // #0729: color-coded 7R label; skip row entirely for LZ reports (sevenRLabel === '')
  const label7r = data.sevenRLabel ?? '-';
  if (label7r) row('7R classification:', label7r, sevenRColor(label7r));

  row('Landing zone:', data.landingZone || '-');
  row('Assessed:', data.assessedAt || '-');

  // #0729: per-severity colored signal counts as mini color-band strip
  if (data.signalCounts && Object.keys(data.signalCounts).length > 0) {
    const y0 = doc.y;
    doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#555')
      .text('Signal counts:', MARGIN, y0, { width: colLabel });
    let x = MARGIN + colLabel;
    const total = data.signalCounts['total'];
    if (total !== undefined) {
      doc.font(FONT_BODY).fillColor('#333')
        .text(`${total} total`, x, y0, { width: 60, lineBreak: false });
      x += 65;
    }
    const SEV_ORDER = ['blocker', 'critical', 'high', 'medium', 'low', 'positive', 'informational'];
    for (const sev of SEV_ORDER) {
      const count = data.signalCounts[sev];
      if (count === undefined) continue;
      doc.font(FONT_BODY).fillColor(severityColor(sev))
        .text(`  ${count} ${sev}`, x, y0, { width: 90, lineBreak: false });
      x += 80;
      if (x > doc.page.width - MARGIN - 40) break;
    }
    doc.y = y0 + doc.currentLineHeight() + rowGap;
    // #0817-A: reset x after the lineBreak:false strip to prevent subsequent
    // text calls (drawH2Heading etc.) from inheriting the shifted x position.
    doc.x = MARGIN;
  }

  doc.moveDown(0.3);
  doc.strokeColor('#ddd').lineWidth(0.5)
    .moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
  doc.moveDown(0.3);
}

function drawSignalCard(doc: PDFKit.PDFDocument, signal: SignalEntry): void {
  const pageW = doc.page.width - MARGIN * 2;
  const sevColor = severityColor(signal.severity);

  // Guard: add a page if < 60pt remain
  if (doc.y > doc.page.height - MARGIN - 60) doc.addPage();

  // Severity label + signal ID on one line.
  // Explicit x,y + lineBreak:false on both calls: prevents cursor drift (#1006)
  // and stops pdfkit from breaking the ID at hyphens in long LZ signal IDs.
  const signalRowY = doc.y;
  doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor(sevColor)
    .text(`[${signal.severity.toUpperCase()}]`, MARGIN, signalRowY, { width: 70, lineBreak: false });
  doc.font(FONT_BODY).fillColor('#333')
    .text(`  ${signal.id}`, MARGIN + 70, signalRowY, { width: pageW - 70, lineBreak: false });
  doc.x = MARGIN;

  // Derivation text -- left-aligned, full column width (no indent so text
  // is not right-truncated: indent + width would overflow the right margin).
  if (signal.derivation) {
    doc.font(FONT_BODY).fontSize(SIZE_BODY).fillColor('#555')
      .text(signal.derivation, MARGIN, doc.y, { width: pageW, align: 'left' });
  }

  // Evidence count hint -- indented 10pt; width reduced by same amount.
  if (signal.evidence && signal.evidence.length > 0) {
    doc.font(FONT_BODY).fontSize(SIZE_FOOT).fillColor('#888')
      .text(`${signal.evidence.length} evidence item(s)`, MARGIN + 10, doc.y, { width: pageW - 10 });
  }

  doc.moveDown(0.35);
  doc.strokeColor('#eee').lineWidth(0.5)
    .moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
  doc.moveDown(0.2);
}

function drawNextStepsList(doc: PDFKit.PDFDocument, steps: string[]): void {
  const pageW = doc.page.width - MARGIN * 2;
  const numWidth = 20;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] ?? '';
    // #1769: pre-compute item height before rendering so the page break fires
    // at item boundaries, not mid-item. The old fixed 40pt guard failed for
    // multi-line items that start near the bottom and overflow the page.
    const itemH = doc.font(FONT_BODY).fontSize(SIZE_BODY).heightOfString(step, { width: pageW - numWidth });
    if (doc.y + itemH + 4 > doc.page.height - MARGIN) doc.addPage();
    // #0727: explicit x,y for both columns prevents PDFKit from wrapping the
    // body text at `numWidth` (20pt) when `continued: true` is set on the number.
    const y0 = doc.y;
    doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#103a5e')
      .text(`${i + 1}.`, MARGIN, y0, { width: numWidth, lineBreak: false });
    doc.font(FONT_BODY).fillColor('#333')
      .text(step, MARGIN + numWidth, y0, { width: pageW - numWidth, align: 'left' });
    doc.moveDown(0.2);
  }
}

function drawComplianceTable(doc: PDFKit.PDFDocument, controls: ComplianceControlRow[]): void {
  const pageW = doc.page.width - MARGIN * 2;
  const colId = 130;      // #1707: was 80; widened to fit secrets_management (18 chars, mono 9pt)
  const colVerdict = 130; // #1707: was 70; widened to fit SOVEREIGNTY_BLOCKED (20 chars, bold 9pt)
  const colRationale = pageW - colId - colVerdict;

  // Header row
  const y0 = doc.y;
  doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#555');
  doc.text('Control ID', MARGIN, y0, { width: colId, lineBreak: false });
  doc.text('Verdict', MARGIN + colId, y0, { width: colVerdict, lineBreak: false });
  doc.text('Rationale', MARGIN + colId + colVerdict, y0, { width: colRationale });
  doc.moveDown(0.15);
  doc.strokeColor('#103a5e').lineWidth(0.5)
    .moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
  doc.moveDown(0.15);

  // Alternating row shading
  const VERDICT_COLORS: Record<string, string> = {
    pass: '#27ae60', fail: '#e74c3c', partial: '#f39c12', n_a: '#888888', unknown: '#7f8c8d',
    ready: '#27ae60', sovereignty_blocked: '#e74c3c', sovereignty_gap: '#f39c12', waived: '#888888',
  };
  for (let i = 0; i < controls.length; i++) {
    const ctrl = controls[i]!;
    // Pre-compute row height to avoid clipping and page-break corruption (#1707).
    // Uses the same heightOfString pattern as drawLzTargetSummaryTable.
    const idH        = doc.font(FONT_MONO).fontSize(SIZE_BODY).heightOfString(ctrl.id, { width: colId });
    const verdictH   = doc.font(FONT_BOLD).fontSize(SIZE_BODY).heightOfString(ctrl.verdict.toUpperCase(), { width: colVerdict });
    const rationaleH = doc.font(FONT_BODY).fontSize(SIZE_BODY).heightOfString(ctrl.rationale, { width: colRationale });
    const rowH = Math.max(idH, verdictH, rationaleH) + 4;
    if (doc.y + rowH > doc.page.height - MARGIN) doc.addPage();
    const rowY = doc.y;
    if (i % 2 === 0) {
      doc.rect(MARGIN - 2, rowY - 1, pageW + 4, rowH).fill('#f7f7f7');
    }
    const verdictColor = VERDICT_COLORS[ctrl.verdict.toLowerCase()] ?? '#333';
    doc.font(FONT_MONO).fontSize(SIZE_BODY).fillColor('#333')
      .text(ctrl.id, MARGIN, rowY, { width: colId });
    doc.font(FONT_BOLD).fillColor(verdictColor)
      .text(ctrl.verdict.toUpperCase(), MARGIN + colId, rowY, { width: colVerdict });
    doc.font(FONT_BODY).fillColor('#555')
      .text(ctrl.rationale, MARGIN + colId + colVerdict, rowY, { width: colRationale });
    doc.y = rowY + rowH;
  }
}

// #0817-E: per-view one-line context sentence shown before the summary table.
const VIEW_INTROS: Record<string, string> = {
  exec:               'Executive summary: migration classification, top blockers, and recommended next steps for stakeholder decision-making.',
  compliance:         'Compliance view: control evaluation outcomes and coverage gaps across the active regulatory frameworks.',
  finops:             'FinOps view: cost and resource optimisation signals alongside the migration classification and operational baseline.',
  'migration-manager': 'Migration manager view: actionable findings, blockers, and phased next steps to guide the migration programme.',
  technical:          'Technical deep-dive: full signal inventory across all passes (inventory, state, data, egress, cryptography, infrastructure).',
  'lz-report':        'Landing Zone Assessment: sovereignty compliance verdict, CSP/region comparison, and per-stakeholder challenge findings.',
};

function drawChallengeSection(doc: PDFKit.PDFDocument, agentFindings: ChallengeAgentFinding[]): void {
  const pageW = doc.page.width - MARGIN * 2;
  for (const agent of agentFindings) {
    // Each stakeholder section starts on a new page so the heading is never
    // orphaned at the bottom of the preceding page (#1070).
    doc.addPage();
    drawH2Heading(doc, `Stakeholder Challenge: ${agent.agentRole}`);
    // Opening summary provides agent context before findings.
    if (agent.openingSummary) {
      doc.font(FONT_BODY).fontSize(SIZE_BODY).fillColor('#444')
        .text(agent.openingSummary, MARGIN, doc.y, { width: pageW });
      doc.moveDown(0.5);
    }
    for (const f of agent.findings) {
      // #1781: pre-compute the full block height before writing any content so
      // the entire finding (ID + concern + optional evidence/question) lands on
      // the same page. The fixed 80pt guard was insufficient for verbose LZCA
      // findings (200-400pt), causing orphaned IDs at the page bottom.
      const idH = doc.font(FONT_BOLD).fontSize(SIZE_BODY).heightOfString(f.id, { width: pageW });
      let blockH = idH;
      blockH += doc.font(FONT_BODY).fontSize(SIZE_BODY).heightOfString(f.concern, { width: pageW });
      if (f.evidenceGap) {
        blockH += doc.currentLineHeight() * 1.5;
        blockH += doc.font(FONT_BODY).fontSize(SIZE_BODY).heightOfString(f.evidenceGap, { width: pageW });
      }
      if (f.recommendedQuestion) {
        blockH += doc.currentLineHeight() * 1.5;
        blockH += doc.font(FONT_BODY).fontSize(SIZE_BODY).heightOfString(f.recommendedQuestion, { width: pageW });
      }
      if (doc.y + blockH > doc.page.height - MARGIN) {
        doc.addPage();
      } else {
        doc.moveDown(0.8);
      }
      doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#103a5e')
        .text(f.id, MARGIN, doc.y, { width: pageW });
      doc.font(FONT_BODY).fontSize(SIZE_BODY).fillColor('#222')
        .text(f.concern, MARGIN, doc.y, { width: pageW });
      if (f.evidenceGap) {
        doc.moveDown(0.2);
        doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#555')
          .text('Evidence gap:  ', MARGIN, doc.y, { continued: true });
        doc.font(FONT_BODY).fillColor('#333')
          .text(f.evidenceGap, { width: pageW });
      }
      if (f.recommendedQuestion) {
        doc.moveDown(0.2);
        doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#555')
          .text('Recommended question:  ', MARGIN, doc.y, { continued: true });
        doc.font(FONT_BODY).fillColor('#333')
          .text(f.recommendedQuestion, { width: pageW });
      }
      doc.moveDown(0.6);
    }
  }
}

function drawLzTargetSummaryTable(doc: PDFKit.PDFDocument, rows: LzTargetRow[]): void {
  const pageW = doc.page.width - MARGIN * 2;
  // #1530: rebalanced columns -- wider Frameworks column to prevent overflow.
  // colVerdict=130 still fits "SOVEREIGNTY_BLOCKED" at 9pt.
  const colCsp      = 55;
  const colRegion   = 100;
  const colVerdict  = 130;
  const colFw       = 120;
  const colServices = pageW - colCsp - colRegion - colVerdict - colFw;

  const LZ_VERDICT_COLORS: Record<string, string> = {
    READY:               '#27ae60',
    READY_WITH_CHANGES:  '#f39c12',
    SOVEREIGNTY_BLOCKED: '#e74c3c',
    BLOCKED:             '#e74c3c',
  };

  const y0 = doc.y;
  doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#555');
  doc.text('CSP',        MARGIN,                                        y0, { width: colCsp,      lineBreak: false });
  doc.text('Region',     MARGIN + colCsp,                               y0, { width: colRegion,   lineBreak: false });
  doc.text('Verdict',    MARGIN + colCsp + colRegion,                   y0, { width: colVerdict,  lineBreak: false });
  doc.text('Frameworks', MARGIN + colCsp + colRegion + colVerdict,      y0, { width: colFw,       lineBreak: false });
  doc.text('Services',   MARGIN + colCsp + colRegion + colVerdict + colFw, y0, { width: colServices });
  doc.moveDown(0.15);
  doc.strokeColor('#103a5e').lineWidth(0.5)
    .moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
  doc.moveDown(0.15);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (doc.y > doc.page.height - MARGIN - 40) doc.addPage();
    const rowY = doc.y;

    // #1530: pre-compute row height so we can draw the stripe background before the text.
    // Multi-line cells (Frameworks, Services) are split on commas for readability.
    const fwText  = r.frameworks.split(',').map(s => s.trim()).filter(Boolean).join('\n') || r.frameworks;
    const svcText = r.services.split(',').map(s => s.trim()).filter(Boolean).join('\n')   || r.services;
    doc.font(FONT_BODY).fontSize(SIZE_BODY);
    const lineH  = doc.currentLineHeight();
    const fwH    = doc.heightOfString(fwText,  { width: colFw });
    const svcH   = doc.heightOfString(svcText, { width: colServices });
    const rowH   = Math.max(lineH, fwH, svcH) + 4;

    // Stripe background before text so it doesn't obscure anything.
    if (i % 2 === 0) {
      doc.rect(MARGIN - 2, rowY - 1, pageW + 4, rowH).fill('#f7f7f7');
    }

    const verdictColor = LZ_VERDICT_COLORS[r.verdict] ?? '#333';
    doc.font(FONT_BODY).fontSize(SIZE_BODY).fillColor('#555')
      .text(r.csp,     MARGIN,                                     rowY, { width: colCsp,      lineBreak: false });
    doc.font(FONT_BODY).fillColor('#333')
      .text(r.region,  MARGIN + colCsp,                            rowY, { width: colRegion,   lineBreak: false });
    doc.font(FONT_BOLD).fillColor(verdictColor)
      .text(r.verdict, MARGIN + colCsp + colRegion,                rowY, { width: colVerdict,  lineBreak: false });
    doc.font(FONT_BODY).fillColor('#555')
      .text(fwText,    MARGIN + colCsp + colRegion + colVerdict,   rowY, { width: colFw });
    doc.font(FONT_BODY).fillColor('#333')
      .text(svcText,   MARGIN + colCsp + colRegion + colVerdict + colFw, rowY, { width: colServices });

    doc.y = rowY + rowH;
  }

  doc.moveDown(0.3);
}

function drawStructuredBody(doc: PDFKit.PDFDocument, data: ReportData, viewName: string, complianceControls?: ComplianceControlRow[], lzTargets?: LzTargetRow[]): void {
  // Show view intro for known views; for per-agent LZ views (lz-ciso etc.)
  // fall back to the generic lz-report intro sentence.
  const introKey = viewName.toLowerCase().startsWith('lz-') ? 'lz-report' : viewName.toLowerCase();
  const intro = VIEW_INTROS[introKey];
  if (intro) {
    doc.font(FONT_BODY).fontSize(SIZE_BODY).fillColor('#555')
      .text(intro, MARGIN, doc.y, { width: doc.page.width - MARGIN * 2 });
    doc.moveDown(0.4);
  }
  drawH2Heading(doc, 'Assessment Summary');
  drawSummaryTable(doc, data);

  // LZ comparison table: CSP / Region / Verdict / Frameworks / Services
  if (lzTargets && lzTargets.length > 0) {
    drawH2Heading(doc, 'Landing Zone Comparison');
    drawLzTargetSummaryTable(doc, lzTargets);

    // Per-target sovereignty gate checks (framework requirement items from lz-fit YAML)
    const targetsWithItems = lzTargets.filter(t => t.frameworkItems.length > 0);
    if (targetsWithItems.length > 0) {
      drawH2Heading(doc, 'Sovereignty Gate Checks');
      for (const tgt of targetsWithItems) {
        if (doc.y > doc.page.height - MARGIN - 100) doc.addPage();
        doc.moveDown(0.4);
        doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#103a5e')
          .text(`${tgt.csp} / ${tgt.region}  [${tgt.verdict}]`, MARGIN, doc.y, { width: doc.page.width - MARGIN * 2 });
        doc.moveDown(0.2);
        drawComplianceTable(doc, tgt.frameworkItems);
      }
    }
  }

  if (data.blockers.length > 0) {
    // #0729: Migration Blockers heading in red to indicate severity
    drawH2Heading(doc, `Migration Blockers (${data.blockers.length})`, '#e74c3c');
    for (const b of data.blockers) {
      drawSignalCard(doc, b);
    }
  }

  const blockerIds = new Set(data.blockers.map((b) => b.id));
  const findings = data.topFindings.filter((f) => !blockerIds.has(f.id));
  if (findings.length > 0) {
    drawH2Heading(doc, `Top Findings (${findings.length})`);
    for (const f of findings) {
      drawSignalCard(doc, f);
    }
  }

  if (data.nextSteps.length > 0) {
    drawH2Heading(doc, 'Recommended Next Steps');
    drawNextStepsList(doc, data.nextSteps);
  }

  // #0729: compliance control summary table when controls are provided
  if (complianceControls && complianceControls.length > 0) {
    drawH2Heading(doc, 'Compliance Control Summary');
    drawComplianceTable(doc, complianceControls);
  }

  // #0851: stakeholder challenge findings -- show only the finding for the
  // persona that matches this PDF's viewName (one agent per stakeholder PDF).
  // #1120: for LZ report (viewName='lz-report', no matching agentId), show
  // all challenge findings so every LZCA persona section appears.
  if (data.challengeFindings && data.challengeFindings.length > 0) {
    const agentId = reportViewToAgentId(viewName);
    const relevant = agentId
      ? data.challengeFindings.filter((f) => f.agentId === agentId)
      : data.challengeFindings;
    if (relevant.length > 0) {
      drawChallengeSection(doc, relevant);
    }
  }
}

function drawFooters(doc: PDFKit.PDFDocument, product: PdfProductBranding, appId: string, viewName: string): void {
  const range = doc.bufferedPageRange();
  const pageCount = range.count;
  // #0817-B: iterate with a 0-based counter so page 0 is always included
  // regardless of whether pdfkit returns range.start=0 or range.start>0.
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(range.start + i);
    const footY = doc.page.height - MARGIN;
    doc.font(FONT_BODY).fontSize(SIZE_FOOT).fillColor('#666');
    // #0868: do NOT pass `width` here -- pdfkit triggers page-break detection
    // when an explicit y coordinate below maxY() is combined with a `width`
    // option, even with lineBreak:false, producing spurious trailing pages.
    doc.text(
      `SWAO v${product.swaoVersion}   --   Page ${i + 1} of ${pageCount}`,
      MARGIN, footY, { lineBreak: false },
    );
    doc.text(
      `${product.landingUrl}   --   ${product.contactsInline}`,
      MARGIN, footY + 9, { lineBreak: false },
    );
    // #0817-D: running header on pages 2+.
    if (i > 0) {
      const headerY = Math.floor(MARGIN / 2);
      doc.font(FONT_BODY).fontSize(SIZE_FOOT).fillColor('#aaa')
        .text(
          `${appId}  --  ${viewName} view  --  Page ${i + 1} of ${pageCount}`,
          MARGIN, headerY, { lineBreak: false },
        );
    }
  }
}

// ─── LLM Assessment PDF: Model Comparison Matrix (#1531) ────────────────────
//
// Inline types mirror LlmPubData from @swao/publication-render.
// Defined here to avoid a cross-module sibling import (Design 058 D-PORTAL-1).
// The caller (report.ts) maps LlmPubData fields to LlmPdfArgs.

export interface LlmPdfLegInfo {
  id: string;
  connector: string;
  model: string;
  primary: boolean;
}

export interface LlmPdfGroupResult {
  group: string;
  score: Record<string, number | null>;
  rank: Record<string, number | null>;
  light: Record<string, string>;
}

export interface LlmPdfPassLegAgg {
  calls: number;
  dnf: number;
  latency_p50_ms: number | null;
  completion_tokens_median: number | null;
  cost_usd: number | null;
  parse_valid_rate: number | null;
  schema_conform_rate: number | null;
  refusal_count: number | null;
  pii_reproduction_count: number | null;
  prompt_injection_count: number | null;
  redaction_marker_altered_count: number | null;
}

export interface LlmPdfPassGroup {
  pass_id: string;
  /** Keyed by leg id. Absent when the leg did not participate in this pass. */
  legs: Record<string, LlmPdfPassLegAgg | undefined>;
}

export interface LlmPdfFinding {
  id: string;
  severity: string;
  leg?: string;
  pass_id?: string;
  message: string;
}

export interface LlmPdfArgs {
  outputPath: string;
  appId: string;
  runTs: string;
  legs: LlmPdfLegInfo[];
  weights: Record<string, number>;
  finalScores: Record<string, number | null>;
  finalRanks: Record<string, number | null>;
  groups: LlmPdfGroupResult[];
  passGroups: LlmPdfPassGroup[];
  /** C1-namespace challenge pass groups from buildChallengePassGroups (#1708). */
  challengePassGroups?: LlmPdfPassGroup[];
  findings: LlmPdfFinding[];
  product: PdfProductBranding;
  branding: LicenseeBranding;
}

// Module-private LLM formatting helpers

function llmFmtNum(val: number | null | undefined, digits = 1): string {
  if (val == null) return '--';
  return val.toFixed(digits);
}

function llmFmtMs(ms: number | null | undefined): string {
  if (ms == null) return '--';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
}

function llmFmtCost(usd: number | null | undefined): string {
  if (usd == null) return '--';
  return usd < 0.001 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(4)}`;
}

function llmFmtPct(rate: number | null | undefined): string {
  if (rate == null) return '--';
  return `${(rate * 100).toFixed(0)}%`;
}
// For rates already stored on the 0-100 scale (parse_valid_rate, schema_conform_rate).
function llmFmtPct100(rate: number | null | undefined): string {
  if (rate == null) return '--';
  return `${rate.toFixed(0)}%`;
}

function llmLightColor(light: string): string {
  if (light === 'ok')                   return '#27ae60';
  if (light === 'warn' || light === 'amber') return '#f39c12';
  if (light === 'red')                  return '#e74c3c';
  return '#888';
}

function llmRankLabel(rank: number | null | undefined): string {
  return rank == null ? '(partial)' : `#${rank}`;
}

function avgNonNull(vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => typeof v === 'number');
  return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
}

function sumNonNull(vals: (number | null | undefined)[]): number {
  return vals.filter((v): v is number => typeof v === 'number').reduce((a, b) => a + b, 0);
}

interface LlmSubMetricDef {
  label: string;
  getValue: (legId: string) => string;
}

/** Render an LLM Assessment Model Comparison Matrix as a PDF (#1531). */
export function renderLlmComparisonToPdf(args: LlmPdfArgs): Promise<void> {
  const {
    outputPath, appId, runTs, legs, weights,
    finalScores, finalRanks, groups, passGroups, challengePassGroups, findings, product, branding,
  } = args;

  return new Promise((resolve, reject) => {
    let doc: PDFKit.PDFDocument;
    try {
      doc = new PDFDocument({
        size:    'A4',
        margins: { top: MARGIN, bottom: MARGIN + 40, left: MARGIN, right: MARGIN },
        bufferPages: true,
        info: {
          Title:    `SWAO LLM Assessment Report -- ${appId}`,
          Author:   branding.data?.organisation ?? 'SWAO',
          Subject:  `SWAO LLM Model Comparison for ${appId}`,
          Creator:  `SWAO v${product.swaoVersion}`,
          Producer: `SWAO v${product.swaoVersion} (pdfkit)`,
        },
      });
    } catch (err) { reject(err); return; }

    const stream = createWriteStream(outputPath);
    stream.on('finish', () => resolve());
    stream.on('error',  reject);
    doc.on('error', reject);
    doc.pipe(stream);

    try {
      const pageW      = doc.page.width - MARGIN * 2;
      const tsDisplay  = runTs.replace(/T(\d{2})-(\d{2})-(\d{2})$/, '  $1:$2:$3 UTC');

      // --- Title block ---
      doc.font(FONT_BOLD).fontSize(SIZE_TITLE).fillColor('#103a5e')
        .text('SWAO LLM Assessment Report', { align: 'left' });
      doc.moveDown(0.2);
      doc.font(FONT_BODY).fontSize(SIZE_H2).fillColor('#103a5e')
        .text(`${appId}   --   Model Comparison Matrix`, { align: 'left' });
      doc.moveDown(0.15);
      doc.font(FONT_BODY).fontSize(SIZE_FOOT).fillColor('#888')
        .text(`Run: ${tsDisplay}`, { align: 'left' });
      doc.moveDown(0.4);
      doc.strokeColor('#103a5e').lineWidth(1)
        .moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
      doc.moveDown(0.6);

      drawBrandingBlock(doc, branding);

      // Sort legs by final rank (ascending); unranked last.
      const legsSorted = [...legs].sort((a, b) => {
        const ra = finalRanks[a.id] ?? 999;
        const rb = finalRanks[b.id] ?? 999;
        return ra - rb;
      });
      const MAX_LEGS   = 5;
      const displayLegs = legsSorted.slice(0, MAX_LEGS);

      // --- Executive Summary ---
      drawH2Heading(doc, 'Executive Summary');

      const totalCalls = passGroups.reduce(
        (sum, pg) => sum + Object.values(pg.legs).reduce((s, l) => s + (l?.calls ?? 0), 0),
        0,
      );
      doc.font(FONT_BODY).fontSize(SIZE_BODY).fillColor('#555')
        .text(
          `Models evaluated: ${legs.length}  |  Passes run: ${passGroups.length}  |  Total calls: ${totalCalls}`,
          MARGIN, doc.y, { width: pageW },
        );
      doc.moveDown(0.5);

      // Top-ranked model recommendation
      const topLeg = displayLegs[0];
      if (topLeg && (finalRanks[topLeg.id] ?? 999) < 999) {
        const topScore = finalScores[topLeg.id];
        doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#103a5e')
          .text('Recommended:  ', MARGIN, doc.y, { continued: true });
        doc.font(FONT_BODY).fillColor('#27ae60')
          .text(`${topLeg.model}  (${topLeg.connector})  --  Score: ${llmFmtNum(topScore)} / 100`);
        doc.moveDown(0.5);
      }

      // Applied dimension weights
      const weightParts = Object.entries(weights)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}: ${(v * 100).toFixed(0)}%`)
        .join('  |  ');
      if (weightParts) {
        doc.font(FONT_BODY).fontSize(SIZE_BODY).fillColor('#555')
          .text(`Weights: ${weightParts}`, MARGIN, doc.y, { width: pageW });
        doc.moveDown(0.5);
      }

      // Model ranking table
      const colRank  = 40;
      const colModel = 185;
      const colConn  = 110;
      const colScore = pageW - colRank - colModel - colConn;

      const rankHdrY = doc.y;
      doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#888');
      doc.text('Rank',  MARGIN,                                 rankHdrY, { width: colRank,  lineBreak: false });
      doc.text('Model', MARGIN + colRank,                       rankHdrY, { width: colModel, lineBreak: false });
      doc.text('Conn.', MARGIN + colRank + colModel,            rankHdrY, { width: colConn,  lineBreak: false });
      doc.text('Score', MARGIN + colRank + colModel + colConn,  rankHdrY, { width: colScore });
      doc.x = MARGIN;
      doc.moveDown(0.1);
      doc.strokeColor('#103a5e').lineWidth(0.5)
        .moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
      doc.moveDown(0.15);

      for (let i = 0; i < displayLegs.length; i++) {
        const leg   = displayLegs[i]!;
        const rank  = finalRanks[leg.id];
        const score = finalScores[leg.id];
        const rowY  = doc.y;
        if (i % 2 === 0) {
          doc.rect(MARGIN - 2, rowY - 1, pageW + 4, doc.currentLineHeight() + 2).fill('#f7f7f7');
        }
        const rankColor  = rank === 1 ? '#27ae60' : '#333';
        const scoreColor = score == null ? '#888' : score >= 80 ? '#27ae60' : score >= 50 ? '#f39c12' : '#e74c3c';
        doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor(rankColor)
          .text(llmRankLabel(rank),  MARGIN,                                rowY, { width: colRank,  lineBreak: false });
        doc.font(FONT_BODY).fillColor('#222')
          .text(leg.model,           MARGIN + colRank,                      rowY, { width: colModel, lineBreak: false });
        doc.font(FONT_BODY).fillColor('#555')
          .text(leg.connector,       MARGIN + colRank + colModel,           rowY, { width: colConn,  lineBreak: false });
        doc.font(FONT_BOLD).fillColor(scoreColor)
          .text(llmFmtNum(score),    MARGIN + colRank + colModel + colConn, rowY, { width: colScore });
        doc.x = MARGIN;
        doc.y = Math.max(doc.y, rowY + doc.currentLineHeight()) + 2;
      }
      if (legs.length > MAX_LEGS) {
        doc.font(FONT_BODY).fontSize(SIZE_FOOT).fillColor('#888')
          .text(
            `... and ${legs.length - MAX_LEGS} more model(s) not shown (display capped at ${MAX_LEGS}).`,
            MARGIN, doc.y, { width: pageW },
          );
      }
      doc.moveDown(0.5);

      // --- Group Comparison Matrix ---
      if (doc.y > doc.page.height - MARGIN - 120) doc.addPage();
      drawH2Heading(doc, 'Model Comparison Matrix');

      const metricCol = 135;
      const legColW   = Math.max(55, Math.floor((pageW - metricCol) / Math.max(1, displayLegs.length)));

      const makeSubMetrics = (groupName: string): LlmSubMetricDef[] => {
        const g = groupName.toLowerCase();
        if (g.includes('quality') || g.includes('structural')) {
          return [
            {
              label: 'Parse valid rate',
              getValue: (id) => llmFmtPct100(avgNonNull(passGroups.map(pg => pg.legs[id]?.parse_valid_rate))),
            },
            {
              label: 'Schema conform rate',
              getValue: (id) => llmFmtPct100(avgNonNull(passGroups.map(pg => pg.legs[id]?.schema_conform_rate))),
            },
          ];
        }
        if (g.includes('reliability')) {
          return [
            {
              label: 'DNF rate',
              getValue: (id) => {
                const dn = sumNonNull(passGroups.map(pg => pg.legs[id]?.dnf));
                const cl = sumNonNull(passGroups.map(pg => pg.legs[id]?.calls));
                return cl > 0 ? llmFmtPct(dn / cl) : '--';
              },
            },
            {
              label: 'Refusal count',
              getValue: (id) => String(sumNonNull(passGroups.map(pg => pg.legs[id]?.refusal_count))),
            },
          ];
        }
        if (g.includes('performance') || g.includes('latency')) {
          return [
            {
              label: 'Latency p50 (ms)',
              getValue: (id) => llmFmtMs(avgNonNull(passGroups.map(pg => pg.legs[id]?.latency_p50_ms))),
            },
            {
              label: 'Tokens/call (med)',
              getValue: (id) => llmFmtNum(avgNonNull(passGroups.map(pg => pg.legs[id]?.completion_tokens_median)), 0),
            },
          ];
        }
        if (g.includes('cost')) {
          return [
            {
              label: 'Avg cost/call (USD)',
              getValue: (id) => llmFmtCost(avgNonNull(passGroups.map(pg => pg.legs[id]?.cost_usd))),
            },
          ];
        }
        if (g.includes('security')) {
          return [
            {
              label: 'PII reproduction',
              getValue: (id) => String(sumNonNull(passGroups.map(pg => pg.legs[id]?.pii_reproduction_count))),
            },
            {
              label: 'Prompt injection',
              getValue: (id) => String(sumNonNull(passGroups.map(pg => pg.legs[id]?.prompt_injection_count))),
            },
            {
              label: 'Redaction altered',
              getValue: (id) => String(sumNonNull(passGroups.map(pg => pg.legs[id]?.redaction_marker_altered_count))),
            },
          ];
        }
        return [];
      };

      for (const grp of groups) {
        if (doc.y > doc.page.height - MARGIN - 120) doc.addPage();

        const wt = weights[grp.group];
        const wtLabel = wt != null && wt > 0
          ? `  (weight: ${(wt * 100).toFixed(0)}%)`
          : '  (informational)';
        doc.moveDown(0.6);
        doc.font(FONT_BOLD).fontSize(SIZE_H2).fillColor('#103a5e')
          .text(`${grp.group}${wtLabel}`, MARGIN, doc.y, { width: pageW });
        doc.moveDown(0.2);
        doc.strokeColor('#aaa').lineWidth(0.5)
          .moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
        doc.moveDown(0.2);

        // Table header: metric label col + one col per leg
        const thY = doc.y;
        doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#555')
          .text('Metric', MARGIN, thY, { width: metricCol, lineBreak: false });
        for (let li = 0; li < displayLegs.length; li++) {
          const leg      = displayLegs[li]!;
          const rank     = finalRanks[leg.id];
          const colX     = MARGIN + metricCol + li * legColW;
          const shortNm  = leg.model.length > 14 ? `${leg.model.slice(0, 12)}..` : leg.model;
          doc.font(FONT_BOLD).fillColor('#103a5e')
            .text(`${shortNm} ${llmRankLabel(rank)}`, colX, thY, { width: legColW, lineBreak: false });
        }
        doc.x = MARGIN;
        doc.y = Math.max(doc.y, thY + doc.currentLineHeight()) + 2;
        doc.strokeColor('#103a5e').lineWidth(0.5)
          .moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
        doc.moveDown(0.15);

        const subMetrics = makeSubMetrics(grp.group);
        const allRows: Array<{ label: string; values: string[]; isScore: boolean }> = [
          ...subMetrics.map(sm => ({
            label:   sm.label,
            values:  displayLegs.map(l => sm.getValue(l.id)),
            isScore: false,
          })),
          {
            label:   'Group score',
            values:  displayLegs.map(l => llmFmtNum(grp.score[l.id] ?? null)),
            isScore: true,
          },
        ];

        for (let ri = 0; ri < allRows.length; ri++) {
          const row = allRows[ri]!;
          const isLastRow = ri === allRows.length - 1;
          if (doc.y > doc.page.height - MARGIN - (isLastRow ? 160 : 20)) doc.addPage();
          const rowY = doc.y;
          if (ri % 2 === 0) {
            doc.rect(MARGIN - 2, rowY - 1, pageW + 4, doc.currentLineHeight() + 2).fill('#f7f7f7');
          }
          doc.font(row.isScore ? FONT_BOLD : FONT_BODY).fontSize(SIZE_BODY).fillColor('#444')
            .text(row.label, MARGIN, rowY, { width: metricCol, lineBreak: false });
          for (let li = 0; li < displayLegs.length; li++) {
            const leg    = displayLegs[li]!;
            const val    = row.values[li] ?? '--';
            const colX   = MARGIN + metricCol + li * legColW;
            const valColor = row.isScore ? llmLightColor(grp.light[leg.id] ?? 'none') : '#333';
            doc.font(row.isScore ? FONT_BOLD : FONT_BODY).fillColor(valColor)
              .text(val, colX, rowY, { width: legColW, lineBreak: false });
          }
          doc.x = MARGIN;
          doc.y = Math.max(doc.y, rowY + doc.currentLineHeight()) + 2;
        }
      }

      // --- Pass-Level Breakdown ---
      if (passGroups.length > 0) {
        if (doc.y > doc.page.height - MARGIN - 150) doc.addPage();
        drawH2Heading(doc, 'Pass-Level Breakdown');

        const passCol   = 90;
        const legBlockW = Math.max(55, Math.floor((pageW - passCol) / Math.max(1, displayLegs.length)));

        // Header row
        const phY = doc.y;
        doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor('#555')
          .text('Pass', MARGIN, phY, { width: passCol, lineBreak: false });
        for (let li = 0; li < displayLegs.length; li++) {
          const leg     = displayLegs[li]!;
          const shortNm = leg.model.length > 12 ? `${leg.model.slice(0, 10)}..` : leg.model;
          doc.font(FONT_BOLD).fillColor('#103a5e')
            .text(shortNm, MARGIN + passCol + li * legBlockW, phY, { width: legBlockW, lineBreak: false });
        }
        doc.x = MARGIN;
        doc.y = Math.max(doc.y, phY + doc.currentLineHeight()) + 2;
        doc.strokeColor('#103a5e').lineWidth(0.5)
          .moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
        doc.moveDown(0.15);

        for (let pi = 0; pi < passGroups.length; pi++) {
          const pg = passGroups[pi]!;
          if (doc.y > doc.page.height - MARGIN - 20) doc.addPage();
          const rowY = doc.y;
          if (pi % 2 === 0) {
            doc.rect(MARGIN - 2, rowY - 1, pageW + 4, doc.currentLineHeight() + 2).fill('#f7f7f7');
          }
          doc.font(FONT_MONO).fontSize(SIZE_BODY).fillColor('#555')
            .text(pg.pass_id, MARGIN, rowY, { width: passCol, lineBreak: false });
          for (let li = 0; li < displayLegs.length; li++) {
            const leg  = displayLegs[li]!;
            const la   = pg.legs[leg.id];
            const colX = MARGIN + passCol + li * legBlockW;
            if (!la || la.calls === 0) {
              doc.font(FONT_BODY).fillColor('#aaa')
                .text('--', colX, rowY, { width: legBlockW, lineBreak: false });
            } else {
              const parseFail = la.parse_valid_rate != null && la.parse_valid_rate < 100;
              doc.font(FONT_BODY).fillColor(parseFail ? '#e74c3c' : '#333')
                .text(
                  `${llmFmtMs(la.latency_p50_ms)} / ${llmFmtCost(la.cost_usd)} / ${llmFmtPct100(la.parse_valid_rate)}`,
                  colX, rowY, { width: legBlockW, lineBreak: false },
                );
            }
          }
          doc.x = MARGIN;
          doc.y = Math.max(doc.y, rowY + doc.currentLineHeight()) + 2;
        }
        doc.moveDown(0.3);
        doc.font(FONT_BODY).fontSize(SIZE_FOOT).fillColor('#888')
          .text('Per model: latency p50  /  avg cost per call  /  parse valid rate', MARGIN, doc.y, { width: pageW });
      }

      // --- Stakeholder Challenge Results (#1708) ---
      const visibleChallenge = (challengePassGroups ?? []).filter((pg) => pg.pass_id.startsWith('C1-'));
      if (visibleChallenge.length > 0) {
        if (doc.y > doc.page.height - MARGIN - 100) doc.addPage();
        drawH2Heading(doc, 'Stakeholder Challenge Results');
        doc.font(FONT_BODY).fontSize(SIZE_FOOT).fillColor('#888')
          .text('Per agent and model leg: calls (dialogue turns)  /  incomplete (0=ok, 1=dnf)  /  duration', MARGIN, doc.y, { width: pageW });
        doc.moveDown(0.4);

        const displayLegs = legs;
        const passColC  = 120;
        const legBlockWC = displayLegs.length > 0 ? Math.min(130, Math.floor((pageW - passColC) / displayLegs.length)) : 0;
        const chdrY = doc.y;
        doc.font(FONT_BOLD).fontSize(SIZE_FOOT).fillColor('#555')
          .text('Agent', MARGIN, chdrY, { width: passColC, lineBreak: false });
        for (let li = 0; li < displayLegs.length; li++) {
          const colX = MARGIN + passColC + li * legBlockWC;
          doc.font(FONT_BOLD).fontSize(SIZE_FOOT).fillColor('#103a5e')
            .text(`${displayLegs[li]!.model.split('/').pop() ?? displayLegs[li]!.model}`, colX, chdrY, { width: legBlockWC, lineBreak: false });
        }
        doc.x = MARGIN;
        doc.y = Math.max(doc.y, chdrY + doc.currentLineHeight()) + 2;
        doc.moveDown(0.1);

        for (let pi = 0; pi < visibleChallenge.length; pi++) {
          const pg = visibleChallenge[pi]!;
          if (doc.y > doc.page.height - MARGIN - 40) doc.addPage();
          const rowY = doc.y;
          if (pi % 2 === 0) {
            doc.rect(MARGIN - 2, rowY - 1, pageW + 4, doc.currentLineHeight() + 2).fill('#f7f7f7');
          }
          const agentLabel = pg.pass_id.replace(/^C1-/, '');
          doc.font(FONT_MONO).fontSize(SIZE_FOOT).fillColor('#555')
            .text(agentLabel, MARGIN, rowY, { width: passColC, lineBreak: false });
          for (let li = 0; li < displayLegs.length; li++) {
            const legId  = displayLegs[li]!.id;
            const la     = pg.legs[legId];
            const colX   = MARGIN + passColC + li * legBlockWC;
            if (!la || la.calls === 0) {
              doc.font(FONT_BODY).fontSize(SIZE_FOOT).fillColor('#ccc')
                .text('--', colX, rowY, { width: legBlockWC, lineBreak: false });
            } else {
              const dnfFlag  = la.dnf > 0 ? '1' : '0';
              const latency  = llmFmtMs(la.latency_p50_ms);
              const cell     = `${la.calls} calls / dnf:${dnfFlag} / ${latency}`;
              doc.font(FONT_BODY).fontSize(SIZE_FOOT).fillColor(la.dnf > 0 ? '#e74c3c' : '#333')
                .text(cell, colX, rowY, { width: legBlockWC, lineBreak: false });
            }
          }
          doc.x = MARGIN;
          doc.y = Math.max(doc.y, rowY + doc.currentLineHeight()) + 2;
        }
        doc.moveDown(0.3);
      }

      // --- Findings ---
      if (findings.length > 0) {
        if (doc.y > doc.page.height - MARGIN - 100) doc.addPage();
        drawH2Heading(doc, `Findings (${findings.length})`);
        for (const f of findings) {
          if (doc.y > doc.page.height - MARGIN - 50) doc.addPage();
          const sevColor = f.severity === 'error' ? '#e74c3c' : f.severity === 'warn' ? '#f39c12' : '#888';
          doc.font(FONT_BOLD).fontSize(SIZE_BODY).fillColor(sevColor)
            .text(`[${f.severity.toUpperCase()}]  ${f.id}`, MARGIN, doc.y, { width: pageW });
          if (f.leg || f.pass_id) {
            const ctxParts = [
              f.leg     ? `Leg: ${f.leg}`    : '',
              f.pass_id ? `Pass: ${f.pass_id}` : '',
            ].filter(Boolean).join('  |  ');
            doc.font(FONT_BODY).fontSize(SIZE_FOOT).fillColor('#888')
              .text(ctxParts, MARGIN, doc.y, { width: pageW });
          }
          doc.font(FONT_BODY).fontSize(SIZE_BODY).fillColor('#333')
            .text(f.message, MARGIN, doc.y, { width: pageW });
          doc.moveDown(0.35);
          doc.strokeColor('#eee').lineWidth(0.5)
            .moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
          doc.moveDown(0.2);
        }
      }

      drawFooters(doc, product, appId, 'LLM Assessment');
      const bufRange = doc.bufferedPageRange();
      doc.switchToPage(bufRange.start + bufRange.count - 1);
      doc.y = MARGIN;
      doc.end();
    } catch (err) { reject(err); }
  });
}

// Probe used by tests / doctor: confirms pdfkit can construct a document
// and load its built-in fonts in the current process (catches pkg snapshot
// asset-path errors fast).
export function pdfkitSelfTest(): { ok: boolean; reason?: string } {
  try {
    const doc = new PDFDocument({ size: 'A4' });
    doc.font(FONT_BODY).fontSize(10).text('probe');
    doc.end();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
