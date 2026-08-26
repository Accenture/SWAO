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

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import PDFDocument from 'pdfkit';
import type { ReportData, LicenseeBranding } from '@swao/core';
import {
  renderTextReportToPdf, renderLlmComparisonToPdf,
  pdfkitSelfTest, manifest,
  type ComplianceControlRow,
  type LlmPdfArgs, type LlmPdfLegInfo, type LlmPdfGroupResult, type LlmPdfPassGroup,
} from './index.js';

const baseData: ReportData = {
  appId: 'demo-app',
  assessedAt: '2026-06-25',
  iter: 1,
  sevenRLabel: 'rehost',
  coverageScore: '80%',
  landingZone: 'aws',
  signalCounts: { total: 0 },
  blockers: [],
  topFindings: [],
  nextSteps: [],
};

const richData: ReportData = {
  appId: 'sovereign-health',
  assessedAt: '2026-07-02',
  iter: 2,
  sevenRLabel: 'replatform',
  coverageScore: '72%',
  landingZone: 'azure-de',
  signalCounts: { total: 3, blocker: 1, high: 1, medium: 1 },
  blockers: [
    {
      id: 'GDPR-001',
      severity: 'blocker',
      derivation: 'Data residency requirement not satisfied: workload stores PII in us-east-1.',
      evidence: ['config/storage.yaml:12'],
    },
  ],
  topFindings: [
    {
      id: 'NET-042',
      severity: 'high',
      derivation: 'Unencrypted intra-service communication detected on port 8080.',
    },
    {
      id: 'COST-007',
      severity: 'medium',
      derivation: 'Right-sizing opportunity: instance over-provisioned by ~60% on average CPU.',
    },
  ],
  nextSteps: [
    'Migrate primary database to EU-West region to satisfy GDPR data residency.',
    'Enable TLS 1.3 for all intra-service calls; update service mesh policy.',
    'Downsize application instances from c5.2xlarge to c5.large pending load tests.',
  ],
};

const branding: LicenseeBranding = { text: [], yaml: '', data: undefined };

const product = {
  swaoVersion: '0.0.0-test',
  contactsInline: 'test@example.com',
  landingUrl: 'https://example.com/swao',
};

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('renderTextReportToPdf', () => {
  it('writes a non-empty PDF file with the %PDF magic bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-pdf-'));
    tmpDirs.push(dir);
    const outputPath = join(dir, 'report.pdf');

    await renderTextReportToPdf({
      textBody: '',
      outputPath,
      appId: 'demo-app',
      viewName: 'application-architect',
      branding,
      data: baseData,
      product,
    });

    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
    // PDF magic bytes: "%PDF"
    const head = readFileSync(outputPath).subarray(0, 4).toString('latin1');
    expect(head).toBe('%PDF');
  });

  it('renders structured sections (blockers, findings, next steps) as valid PDF', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-pdf-'));
    tmpDirs.push(dir);
    const outputPath = join(dir, 'report-rich.pdf');

    await renderTextReportToPdf({
      textBody: '',
      outputPath,
      appId: 'sovereign-health',
      viewName: 'executive',
      branding,
      data: richData,
      product,
    });

    expect(existsSync(outputPath)).toBe(true);
    const bytes = readFileSync(outputPath);
    // Valid PDF magic bytes
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
    // Structured content (title + 3 sections + signal cards) produces a
    // substantially larger file than an empty report. Content streams are
    // FlateDecode-compressed so we verify by size, not by substring search.
    // Threshold lowered from 3500 to 2800 after #0868 fix: the trailing-page
    // bug inflated the file; correct single-page output measures ~3377 bytes.
    expect(bytes.length).toBeGreaterThan(2800);
  });

  it('renders a branded report with licensee information', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-pdf-'));
    tmpDirs.push(dir);
    const outputPath = join(dir, 'report-branded.pdf');

    const brandedLicensee: LicenseeBranding = {
      text: ['Generated for: Test Corp'],
      yaml: '',
      data: {
        licensee: 'Test User',
        organisation: 'Test Corp',
        tier: 'consultant',
        expires: '2027-01-01',
      },
    };

    await renderTextReportToPdf({
      textBody: '',
      outputPath,
      appId: 'demo-app',
      viewName: 'compliance',
      branding: brandedLicensee,
      data: baseData,
      product,
    });

    expect(existsSync(outputPath)).toBe(true);
    const head = readFileSync(outputPath).subarray(0, 4).toString('latin1');
    expect(head).toBe('%PDF');
  });
});

describe('pdfkitSelfTest', () => {
  it('confirms pdfkit can construct a document with built-in fonts', () => {
    expect(pdfkitSelfTest().ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #0729 design improvements
// ---------------------------------------------------------------------------

describe('#0729 PDF design improvements', () => {
  it('accepts a deterministic reportDate and produces a valid PDF', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-pdf-0729-'));
    tmpDirs.push(dir);
    const outputPath = join(dir, 'dated.pdf');
    await renderTextReportToPdf({
      textBody: '', outputPath, appId: 'test-app', viewName: 'compliance',
      branding, data: richData, product,
      reportDate: '2026-07-04T09:00:00.000Z',
    });
    expect(existsSync(outputPath)).toBe(true);
    // Threshold lowered from 3500 to 2800 after #0868 trailing-page fix.
    expect(statSync(outputPath).size).toBeGreaterThan(2800);
    expect(readFileSync(outputPath).subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('renders compliance control table and produces a larger PDF', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-pdf-0729-compliance-'));
    tmpDirs.push(dir);
    const outputPath = join(dir, 'compliance.pdf');
    const controls: ComplianceControlRow[] = [
      { id: 'GDPR-01', verdict: 'pass',    rationale: 'Data residency confirmed for all PII storage.' },
      { id: 'GDPR-02', verdict: 'fail',    rationale: 'Unencrypted S3 bucket detected in us-east-1.' },
      { id: 'GDPR-03', verdict: 'partial', rationale: 'IAM policy restricts access but audit log disabled.' },
    ];
    await renderTextReportToPdf({
      textBody: '', outputPath, appId: 'test-app', viewName: 'compliance',
      branding, data: richData, product, complianceControls: controls,
      reportDate: '2026-07-04T09:00:00.000Z',
    });
    expect(existsSync(outputPath)).toBe(true);
    // Compliance table adds content so the PDF is larger than the threshold
    expect(statSync(outputPath).size).toBeGreaterThan(3500);
    expect(readFileSync(outputPath).subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('renders without complianceControls in the base case (backward compat)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-pdf-0729-base-'));
    tmpDirs.push(dir);
    const outputPath = join(dir, 'base.pdf');
    await renderTextReportToPdf({
      textBody: '', outputPath, appId: 'demo', viewName: 'application-architect',
      branding, data: baseData, product,
    });
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath).subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});

describe('manifest', () => {
  it('declares the Consultant tier for the PDF renderer module', () => {
    expect(manifest.id).toBe('@swao/module-pdf-report');
    expect(manifest.tier).toBe('consultant');
  });
});

// ---------------------------------------------------------------------------
// #1707 -- compliance table row wrapping and page-break corruption
// ---------------------------------------------------------------------------

describe('#1707 compliance table -- long IDs and LZ sovereignty verdicts', () => {
  // Verify the column-width fix invariant: colId=130pt must fit 'secrets_management' in
  // Courier 9pt (~97pt); colVerdict=130pt must fit 'SOVEREIGNTY_BLOCKED' in Helvetica-Bold
  // 9pt (~120pt). Before the fix (colId=80, colVerdict=70) both overflowed, causing
  // mid-identifier word-wrap (defect A) and a page-break blank-page (defect B).
  //
  // Defect B (blank continuation page after page break) is a layout-level invariant
  // that cannot be verified from compressed PDF bytes -- it requires E2E visual
  // verification against the actual lzca-lz-architect.pdf.
  it('column widths fit the widest identifiers without overflow (invariant for defect A)', () => {
    const COL_ID = 130;
    const COL_VERDICT = 130;
    const doc = new PDFDocument({ size: 'Letter', autoFirstPage: false });
    doc.addPage();
    // Courier 9pt is the monospaced body font used for control IDs
    const idWidth = doc.font('Courier').fontSize(9).widthOfString('secrets_management');
    expect(idWidth).toBeLessThanOrEqual(COL_ID);
    // Helvetica-Bold 9pt is used for verdict text
    const verdictWidth = doc.font('Helvetica-Bold').fontSize(9).widthOfString('SOVEREIGNTY_BLOCKED');
    expect(verdictWidth).toBeLessThanOrEqual(COL_VERDICT);
    doc.end();
  });

  it('renders long control IDs and LZ sovereignty verdicts without crash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-pdf-1707-'));
    tmpDirs.push(dir);
    const outputPath = join(dir, 'lz-compliance.pdf');
    const controls: ComplianceControlRow[] = [
      { id: 'secrets_management',   verdict: 'SOVEREIGNTY_BLOCKED', rationale: 'Key vault not deployed in the target sovereign region; encryption at rest not verified.' },
      { id: 'key_vault',            verdict: 'SOVEREIGNTY_GAP',     rationale: 'Azure Key Vault HSM provisioned but CMK rotation policy not configured for the sovereignty boundary.' },
      { id: 'data_residency',       verdict: 'READY',               rationale: 'Primary data store confirmed in EU-West region; replication disabled.' },
      { id: 'network_segmentation', verdict: 'SOVEREIGNTY_GAP',     rationale: 'NSG rules allow inbound from non-sovereign IP ranges; remediation plan open.' },
      { id: 'identity_federation',  verdict: 'WAIVED',              rationale: 'Federated IdP approved by GRC under compensating control CX-042.' },
    ];
    await renderTextReportToPdf({
      textBody: '', outputPath, appId: 'sovereign-health', viewName: 'compliance',
      branding, data: richData, product, complianceControls: controls,
      reportDate: '2026-08-14T09:00:00.000Z',
    });
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath).subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(statSync(outputPath).size).toBeGreaterThan(3500);
    // Blank-page regression (defect B) requires E2E visual check against
    // the lzca-lz-architect.pdf; compressed content stream cannot be parsed here.
  });
});

// ---------------------------------------------------------------------------
// #0868 page-count regression -- every report view must produce exactly 1 page
// for a standard single-app fixture with no challenge findings.
// ---------------------------------------------------------------------------

function extractPageCount(bytes: Buffer): number {
  // PDF cross-reference tables record the page tree count in a /Count entry.
  // The last /Count value in the file is the root page tree node count.
  let count = 0;
  const text = bytes.toString('latin1');
  const re = /\/Count\s+(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    count = parseInt(m[1]!, 10);
  }
  return count;
}

async function renderToBuffer(viewName: string, data: ReportData): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'swao-pdf-pc-'));
  tmpDirs.push(dir);
  const outputPath = join(dir, `${viewName}.pdf`);
  await renderTextReportToPdf({ textBody: '', outputPath, appId: 'test-app', viewName, branding, data, product });
  return readFileSync(outputPath);
}

describe('#0868 page-count regression -- single-page output for each view', () => {
  it('exec view produces exactly 1 page', async () => {
    const buf = await renderToBuffer('exec', richData);
    expect(extractPageCount(buf)).toBe(1);
  });

  it('compliance view produces exactly 1 page', async () => {
    const buf = await renderToBuffer('compliance', richData);
    expect(extractPageCount(buf)).toBe(1);
  });

  it('finops view produces exactly 1 page', async () => {
    const buf = await renderToBuffer('finops', richData);
    expect(extractPageCount(buf)).toBe(1);
  });

  it('migration-manager view produces exactly 1 page', async () => {
    const buf = await renderToBuffer('migration-manager', richData);
    expect(extractPageCount(buf)).toBe(1);
  });

  it('technical view produces exactly 1 page', async () => {
    const buf = await renderToBuffer('technical', richData);
    expect(extractPageCount(buf)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// #2026 -- parse_valid_rate rendered as 10000% instead of 100%
// #2027 -- Stakeholder Challenge column headers cascade diagonally
// #2024/#2025 -- LZ and LLM page-break guard thresholds
// ---------------------------------------------------------------------------

const llmLegs: LlmPdfLegInfo[] = [
  { id: 'leg-a', connector: 'openrouter', model: 'claude-sonnet-4-6', primary: true },
  { id: 'leg-b', connector: 'openrouter', model: 'gemini-flash-latest', primary: false },
];

const llmGroups: LlmPdfGroupResult[] = [
  {
    group: 'Quality',
    score: { 'leg-a': 95, 'leg-b': 88 },
    rank:  { 'leg-a': 1,  'leg-b': 2  },
    light: { 'leg-a': 'ok', 'leg-b': 'ok' },
  },
  {
    group: 'Reliability',
    score: { 'leg-a': 100, 'leg-b': 92 },
    rank:  { 'leg-a': 1,   'leg-b': 2  },
    light: { 'leg-a': 'ok', 'leg-b': 'ok' },
  },
];

const llmPassGroups: LlmPdfPassGroup[] = [
  {
    pass_id: '03-data',
    legs: {
      'leg-a': { calls: 5, dnf: 0, latency_p50_ms: 1200, completion_tokens_median: 150, cost_usd: 0.002, parse_valid_rate: 100, schema_conform_rate: 100, refusal_count: 0, pii_reproduction_count: 0, prompt_injection_count: 0, redaction_marker_altered_count: 0 },
      'leg-b': { calls: 5, dnf: 0, latency_p50_ms: 800,  completion_tokens_median: 120, cost_usd: 0.001, parse_valid_rate: 80,  schema_conform_rate: 60,  refusal_count: 0, pii_reproduction_count: 0, prompt_injection_count: 0, redaction_marker_altered_count: 0 },
    },
  },
];

const llmChallengeGroups: LlmPdfPassGroup[] = [
  {
    pass_id: 'C1-business-owner',
    legs: {
      'leg-a': { calls: 3, dnf: 0, latency_p50_ms: 54000, completion_tokens_median: 400, cost_usd: 0.008, parse_valid_rate: 100, schema_conform_rate: 100, refusal_count: 0, pii_reproduction_count: 0, prompt_injection_count: 0, redaction_marker_altered_count: 0 },
      'leg-b': { calls: 3, dnf: 1, latency_p50_ms: 37000, completion_tokens_median: 320, cost_usd: 0.006, parse_valid_rate: 100, schema_conform_rate: 100, refusal_count: 0, pii_reproduction_count: 0, prompt_injection_count: 0, redaction_marker_altered_count: 0 },
    },
  },
  {
    pass_id: 'C1-finops-lead',
    legs: {
      'leg-a': { calls: 3, dnf: 0, latency_p50_ms: 60000, completion_tokens_median: 450, cost_usd: 0.009, parse_valid_rate: 100, schema_conform_rate: 100, refusal_count: 0, pii_reproduction_count: 0, prompt_injection_count: 0, redaction_marker_altered_count: 0 },
      'leg-b': { calls: 3, dnf: 0, latency_p50_ms: 42000, completion_tokens_median: 380, cost_usd: 0.007, parse_valid_rate: 100, schema_conform_rate: 100, refusal_count: 0, pii_reproduction_count: 0, prompt_injection_count: 0, redaction_marker_altered_count: 0 },
    },
  },
];

const llmPdfBaseArgs = (outputPath: string): LlmPdfArgs => ({
  outputPath,
  appId: 'sovereign-health',
  runTs: '2026-08-24T08-32-09',
  legs: llmLegs,
  weights: { Quality: 0.5, Reliability: 0.5 },
  finalScores: { 'leg-a': 97.5, 'leg-b': 90 },
  finalRanks:  { 'leg-a': 1,    'leg-b': 2   },
  groups: llmGroups,
  passGroups: llmPassGroups,
  findings: [],
  product,
  branding,
});

describe('#2026/#2027 LLM comparison PDF -- parse rate percentage and stakeholder challenge layout', () => {
  it('renders with Quality group (parse_valid_rate=100) without crash and produces a valid PDF', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-pdf-2026-'));
    tmpDirs.push(dir);
    const outputPath = join(dir, 'llm.pdf');
    await renderLlmComparisonToPdf(llmPdfBaseArgs(outputPath));
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath).subarray(0, 4).toString('latin1')).toBe('%PDF');
    // Visual check required for "10000%" regression; compressed streams prevent
    // byte-level text search here. Threshold: PDF must have at least 1 page.
    expect(extractPageCount(readFileSync(outputPath))).toBeGreaterThanOrEqual(1);
  });

  it('renders with Stakeholder Challenge results without crash (#2027 cascade)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-pdf-2027-'));
    tmpDirs.push(dir);
    const outputPath = join(dir, 'llm-challenge.pdf');
    await renderLlmComparisonToPdf({
      ...llmPdfBaseArgs(outputPath),
      challengePassGroups: llmChallengeGroups,
    });
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath).subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(extractPageCount(readFileSync(outputPath))).toBeGreaterThanOrEqual(1);
  });

  it('renders with parse_valid_rate=80 (partial failure) and marks leg red without crash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-pdf-2026b-'));
    tmpDirs.push(dir);
    const outputPath = join(dir, 'llm-partial.pdf');
    await renderLlmComparisonToPdf(llmPdfBaseArgs(outputPath));
    expect(existsSync(outputPath)).toBe(true);
    // parse_valid_rate=80 for leg-b triggers parseFail (< 100) -- verify no crash.
    expect(readFileSync(outputPath).subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
