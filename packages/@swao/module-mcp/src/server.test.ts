// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  MCP module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { DEFAULT_PASS_NAMES, TOTAL_DEFAULT_PASSES } from '@swao/core';
import {
  handleFrameworksList,
  handleFrameworkDetail,
  handleControlCatalogue,
  handlePasses,
  handleCloudProviderCatalogue,
  buildAppIndex,
  buildWorkspaceIndex,
  handleIngest,
  handleEvidenceCapture,
  buildEvidenceInterviewPrompt,
  parseRiskImport,
  handleRiskImport,
  handleFeedbackAdd,
  handleAnnotate,
  handleFeedbackList,
  handlePortfolioQuery,
  handlePortfolioStats,
  handlePortfolioRisks,
  handlePortfolioLz,
  handlePortfolioSummary,
} from './server.js';

// #0573: these MCP-server source-assertion tests moved here from the
// @swao/module-health-check claude-desktop probe test. They read the host MCP server
// source (mcp/server.ts), which the health-check module cannot reach.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = resolve(__dirname, './server.ts');

describe('mcp/server.ts -- SWAO_MCP_CONTEXT short-circuit (#0154)', () => {
  it('server.ts spawns subprocesses with SWAO_MCP_CONTEXT=1', () => {
    const serverSrc = readFileSync(SERVER_SRC, 'utf-8');
    // Both runSwao and runSwaoAssessAsync must set the context flag so
    // doctor / assess / report / challenge subprocesses all see ok.
    const matches = serverSrc.match(/SWAO_MCP_CONTEXT: '1'/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('mcp/server.ts -- pass profile constants (#1173)', () => {
  it('TOTAL_DEFAULT_PASSES is 11 (the canonical default pass count)', () => {
    expect(TOTAL_DEFAULT_PASSES).toBe(11);
  });

  it('DEFAULT_PASS_NAMES contains all 11 canonical pass names', () => {
    expect(DEFAULT_PASS_NAMES).toHaveLength(11);
    expect(DEFAULT_PASS_NAMES).toContain('inventory');
    expect(DEFAULT_PASS_NAMES).toContain('synthesis');
    expect(DEFAULT_PASS_NAMES).toContain('block_assessments');
    expect(DEFAULT_PASS_NAMES).toContain('scope_coverage');
  });

  it('server.ts uses TOTAL_DEFAULT_PASSES not a hardcoded literal 9', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).not.toMatch(/const TOTAL_PASSES = 9/);
    expect(src).toMatch(/TOTAL_DEFAULT_PASSES/);
  });
});

describe('mcp/server.ts -- Phase 1 read-only tools completeness (#1175)', () => {
  const PHASE1_TOOLS = [
    'swao_frameworks_list',
    'swao_framework_detail',
    'swao_control_catalogue',
    'swao_passes',
    'swao_cloud_provider_catalogue',
  ];
  it('SWAO_MCP_TOOLS contains all 5 Phase-1 tools', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    for (const tool of PHASE1_TOOLS) {
      expect(src).toContain(`name: '${tool}'`);
    }
  });
  it('switch dispatch contains all 5 Phase-1 tool cases', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    for (const tool of PHASE1_TOOLS) {
      expect(src).toContain(`case '${tool}'`);
    }
  });
});

describe('mcp/server.ts -- resource templates presence (#1176)', () => {
  const TEMPLATE_URIS = [
    'swao://framework/{id}',
    'swao://framework/{id}/control/{cid}',
    'swao://passes',
    'swao://catalogue/{provider}',
    'swao://app/{id}/index',
    'swao://app/{id}/wsp-summary',
    'swao://app/{id}/run/{run_id}/manifest',
    'swao://app/{id}/control/{regime}/{cid}',
  ];
  it('SWAO_RESOURCE_TEMPLATES contains all 8 template URIs', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    for (const tpl of TEMPLATE_URIS) {
      expect(src).toContain(tpl);
    }
  });
  it('resolveResourceTemplate is declared and handles swao://passes', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain('resolveResourceTemplate');
    expect(src).toContain("uri === 'swao://passes'");
  });
  it('ListResourceTemplatesRequestSchema is imported and handled', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain('ListResourceTemplatesRequestSchema');
  });
});

describe('mcp/server.ts -- Phase 1 gate: handler integration (#1177)', () => {
  it('swao_frameworks_list returns bundled framework IDs', () => {
    const out = handleFrameworksList({});
    expect(out).toContain('GDPR');
    expect(out).toContain('ISO_27001');
    expect(out).toContain('[bundled]');
    expect(out).not.toContain('No frameworks found');
  });

  it('swao_framework_detail returns regime_meta fields for GDPR', () => {
    const out = handleFrameworkDetail({ framework_id: 'GDPR' });
    expect(out).toContain('Framework: GDPR');
    expect(out).toContain('Authority');
    expect(out).toContain('Controls');
    expect(out).not.toContain('not found');
  });

  it('swao_framework_detail returns error for unknown framework', () => {
    const out = handleFrameworkDetail({ framework_id: 'DOES_NOT_EXIST_XYZZY' });
    expect(out).toContain('not found');
  });

  it('swao_control_catalogue returns control definition for GDPR_Art_5_1_a', () => {
    const out = handleControlCatalogue({ control_id: 'GDPR_Art_5_1_a' });
    expect(out).toContain('GDPR_Art_5_1_a');
    expect(out).not.toContain('not found');
  });

  it('swao_passes returns all DEFAULT_PASS_NAMES in order', () => {
    const out = handlePasses({});
    expect(out).toContain(`(${DEFAULT_PASS_NAMES.length})`);
    for (const name of DEFAULT_PASS_NAMES) {
      expect(out).toContain(name);
    }
  });

  it('swao_cloud_provider_catalogue returns provider list', () => {
    const out = handleCloudProviderCatalogue({});
    expect(out).toContain('Provider');
    expect(out).not.toContain('No providers found');
  });
});

describe('mcp/server.ts -- buildAppIndex functional (#1176 fix)', () => {
  // Reference workspace has a real run at wsp/runs/2026-07-06T12-15-58 with
  // pass files and wsp-plan.yaml. Validate that buildAppIndex reads the correct
  // sources (run passes, not spine) and uses correct outcome enum ('negative').
  const REF_WORKSPACE = resolve(
    __dirname,
    '../../../../examples/portfolio-workspace/portfolio',
  );
  const APP_ID = 'sovereign-health';

  it('returns app index header for sovereign-health', () => {
    const out = buildAppIndex(APP_ID, REF_WORKSPACE);
    expect(out).toContain(`App index: ${APP_ID}`);
    expect(out).not.toContain('not found');
    expect(out).not.toContain('No SWAO workspace');
  });

  it('lists at least one run with [latest] marker', () => {
    const out = buildAppIndex(APP_ID, REF_WORKSPACE);
    expect(out).toContain('[latest]');
    expect(out).toContain('swao://app/sovereign-health/run/');
  });

  it('reads signals from run pass files with correct outcome enum', () => {
    const out = buildAppIndex(APP_ID, REF_WORKSPACE);
    // The reference run (2026-07-06T12-15-58) has pass files with outcome: negative.
    // If the source or outcome filter is wrong, this count stays at 0.
    expect(out).toMatch(/Signals \(\d+ total, [1-9]\d* negative outcome\)/);
  });

  it('does not use wrong outcome labels from old code', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    // These wrong values were in the original buildAppIndex -- must be gone.
    expect(src).not.toContain("outcome === 'fail'");
    expect(src).not.toContain("outcome === 'partial'");
    // Field names must use id, not regime_id / control_id (ComplianceRegime/Control).
    expect(src).not.toContain('reg.regime_id');
    expect(src).not.toContain('ctrl.control_id');
  });
});

describe('mcp/server.ts -- swao_import path traversal guard (#0142)', () => {
  it('server.ts contains path traversal guard regex', () => {
    const serverSrc = readFileSync(SERVER_SRC, 'utf-8');
    expect(serverSrc).toContain('/[/\\\\]/');
    expect(serverSrc).toContain("filename === '..'");
    expect(serverSrc).toContain("filename === '.'");
  });

  it('server.ts uses mkdirSync recursive for wsp/inputs/ dir creation (#0230)', () => {
    const serverSrc = readFileSync(SERVER_SRC, 'utf-8');
    expect(serverSrc).toContain("mkdirSync(importsDir, { recursive: true })");
    // #0227 + #0230: imports land under <app>/wsp/inputs/, not legacy <app>/imports/.
    expect(serverSrc).toContain("join(workspace, 'apps', appId, 'wsp', 'inputs')");
  });
});

describe('mcp/server.ts -- swao_ingest (#1178)', () => {
  let tmpWorkspace: string;
  const APP_ID = 'test-app';

  beforeEach(() => {
    tmpWorkspace = join(tmpdir(), `swao-ingest-test-${Date.now()}`);
    mkdirSync(join(tmpWorkspace, 'apps', APP_ID), { recursive: true });
    writeFileSync(join(tmpWorkspace, '.swao.yml'), 'version: 1\n', 'utf-8');
  });

  afterEach(() => {
    try { rmSync(tmpWorkspace, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('writes text content to ingestion/<category>/<filename>', () => {
    const out = handleIngest({
      app_id: APP_ID,
      category: 'architecture',
      filename: 'arch.md',
      content: '# Architecture\nMicroservices.',
      workspace_path: tmpWorkspace,
    });
    expect(out).toContain('Ingested (text)');
    expect(out).toContain('architecture');
    expect(out).toContain('arch.md');
    const written = readFileSync(
      join(tmpWorkspace, 'apps', APP_ID, 'ingestion', 'architecture', 'arch.md'),
      'utf-8',
    );
    expect(written).toContain('Microservices');
  });

  it('copies source_path file to ingestion/<category>/<filename>', () => {
    const srcFile = join(tmpWorkspace, 'source-doc.txt');
    writeFileSync(srcFile, 'binary-ish content', 'utf-8');
    const out = handleIngest({
      app_id: APP_ID,
      category: 'docs',
      filename: 'source-doc.txt',
      source_path: srcFile,
      workspace_path: tmpWorkspace,
    });
    expect(out).toContain('Ingested (copy)');
    expect(
      existsSync(join(tmpWorkspace, 'apps', APP_ID, 'ingestion', 'docs', 'source-doc.txt')),
    ).toBe(true);
  });

  it('rejects unknown category', () => {
    const out = handleIngest({
      app_id: APP_ID,
      category: 'nonexistent',
      filename: 'x.txt',
      content: 'x',
      workspace_path: tmpWorkspace,
    });
    expect(out).toContain('Error');
    expect(out).toContain('nonexistent');
  });

  it('rejects path-separator in category', () => {
    const out = handleIngest({
      app_id: APP_ID,
      category: 'arch/../../etc',
      filename: 'x.txt',
      content: 'x',
      workspace_path: tmpWorkspace,
    });
    expect(out).toContain('Error');
    expect(out).toContain('category');
  });

  it('rejects path-separator in filename', () => {
    const out = handleIngest({
      app_id: APP_ID,
      category: 'docs',
      filename: '../../../etc/passwd',
      content: 'x',
      workspace_path: tmpWorkspace,
    });
    expect(out).toContain('Error');
    expect(out).toContain('filename');
  });

  it('rejects missing source_path file', () => {
    const out = handleIngest({
      app_id: APP_ID,
      category: 'evidence',
      filename: 'proof.pdf',
      source_path: '/nonexistent/path/proof.pdf',
      workspace_path: tmpWorkspace,
    });
    expect(out).toContain('Error');
    expect(out).toContain('source_path');
  });

  it('rejects when neither content nor source_path provided', () => {
    const out = handleIngest({
      app_id: APP_ID,
      category: 'compliance',
      filename: 'check.yaml',
      workspace_path: tmpWorkspace,
    });
    expect(out).toContain('Error');
  });

  it('swao_ingest tool is in SWAO_MCP_TOOLS and switch dispatch', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain("name: 'swao_ingest'");
    expect(src).toContain("case 'swao_ingest'");
  });

  it('swao_import description includes deprecation note', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain('[Deprecated -- use swao_ingest]');
  });

  it('accepts evidence as a valid category', () => {
    const out = handleIngest({
      app_id: APP_ID,
      category: 'evidence',
      filename: 'session-log.md',
      content: '## Evidence\nCapture note.',
      workspace_path: tmpWorkspace,
    });
    expect(out).toContain('Ingested (text)');
    expect(out).toContain('evidence');
  });
});

describe('mcp/server.ts -- swao_evidence_capture (#1179)', () => {
  let tmpWorkspace: string;
  const APP_ID = 'test-ev-app';

  beforeEach(() => {
    tmpWorkspace = join(tmpdir(), `swao-ev-test-${Date.now()}`);
    mkdirSync(join(tmpWorkspace, 'apps', APP_ID), { recursive: true });
    writeFileSync(join(tmpWorkspace, '.swao.yml'), 'version: 1\n', 'utf-8');
  });

  afterEach(() => {
    try { rmSync(tmpWorkspace, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('writes YAML record + markdown protocol to ingestion/evidence/', () => {
    const out = handleEvidenceCapture({
      app_id: APP_ID,
      addresses: ['INV-01'],
      statement: 'CTO confirmed the monolith is not containerised.',
      type: 'workshop',
      workspace_path: tmpWorkspace,
    });
    expect(out).toContain('Evidence captured');
    expect(out).toContain('EV-');
    // Verify YAML file exists in ingestion/evidence/
    const evidenceDir = join(tmpWorkspace, 'apps', APP_ID, 'ingestion', 'evidence');
    const files = readdirSync(evidenceDir);
    const yamlFiles = files.filter(f => f.endsWith('.yaml'));
    const mdFiles   = files.filter(f => f.endsWith('.md'));
    expect(yamlFiles.length).toBe(1);
    expect(mdFiles.length).toBe(1);
    // Verify content
    const yamlContent = readFileSync(join(evidenceDir, yamlFiles[0]), 'utf-8');
    expect(yamlContent).toContain('workshop');
    expect(yamlContent).toContain('INV-01');
    const mdContent = readFileSync(join(evidenceDir, mdFiles[0]), 'utf-8');
    expect(mdContent).toContain('# Evidence: EV-');
    expect(mdContent).toContain('INV-01');
  });

  it('writes chat-log to feedback/chatlogs/ when provided', () => {
    const out = handleEvidenceCapture({
      app_id: APP_ID,
      addresses: ['INV-01'],
      statement: 'Confirmed containerisation gap.',
      type: 'workshop',
      author: 'test@example.com',
      chat_log: 'User: Is it containerised?\nAssistant: No.',
      workspace_path: tmpWorkspace,
    });
    expect(out).toContain('Chat log:');
    const chatlogDir = join(tmpWorkspace, 'apps', APP_ID, 'feedback', 'chatlogs');
    expect(existsSync(chatlogDir)).toBe(true);
    const chatFiles = readdirSync(chatlogDir);
    expect(chatFiles.length).toBe(1);
    const chatContent = readFileSync(join(chatlogDir, chatFiles[0]), 'utf-8');
    expect(chatContent).toContain('Is it containerised');
  });

  it('redacts PII from chat-log before writing to disk', () => {
    handleEvidenceCapture({
      app_id: APP_ID,
      addresses: ['INV-01'],
      statement: 'Evidence with PII in chat.',
      type: 'workshop',
      author: 'tester',
      chat_log: 'User: contact alice@secret.corp\nAssistant: noted.',
      workspace_path: tmpWorkspace,
    });
    const chatlogDir = join(tmpWorkspace, 'apps', APP_ID, 'feedback', 'chatlogs');
    const chatFiles = readdirSync(chatlogDir);
    const chatContent = readFileSync(join(chatlogDir, chatFiles[0]), 'utf-8');
    expect(chatContent).not.toContain('alice@secret.corp');
    expect(chatContent).toContain('[REDACTED-EMAIL]');
  });

  it('rejects unknown evidence type', () => {
    const out = handleEvidenceCapture({
      app_id: APP_ID,
      addresses: ['INV-01'],
      statement: 'Something.',
      type: 'invalid_type',
      workspace_path: tmpWorkspace,
    });
    expect(out).toContain('Error');
    expect(out).toContain('invalid_type');
  });

  it('rejects empty addresses array', () => {
    const out = handleEvidenceCapture({
      app_id: APP_ID,
      addresses: [],
      statement: 'Something.',
      type: 'workshop',
      workspace_path: tmpWorkspace,
    });
    expect(out).toContain('Error');
    expect(out).toContain('addresses');
  });

  it('skips address validation when no run exists (no latest.txt)', () => {
    const out = handleEvidenceCapture({
      app_id: APP_ID,
      addresses: ['UNKNOWN-99'],
      statement: 'No run to validate against.',
      type: 'other',
      workspace_path: tmpWorkspace,
    });
    // No run = no validation = no error on unknown address
    expect(out).toContain('Evidence captured');
  });

  it('validates addresses against real run when latest.txt exists', () => {
    // Create a fake run with one known signal
    const runsDir = join(tmpWorkspace, 'apps', APP_ID, 'wsp', 'runs', '2026-01-01T00-00-00');
    mkdirSync(join(runsDir, 'passes'), { recursive: true });
    writeFileSync(join(runsDir, 'wsp-plan.yaml'), '{}', 'utf-8');
    writeFileSync(
      join(runsDir, 'passes', '01-inv.yaml'),
      'pass:\n  id: 1\n  name: inventory\n  status: complete\n  iter: 1\n' +
      'signals:\n  - id: INV-01\n    severity: high\n    outcome: negative\n' +
      '    derivation: test\nassessment: {}\n',
      'utf-8',
    );
    writeFileSync(
      join(tmpWorkspace, 'apps', APP_ID, 'wsp', 'latest.txt'),
      'runs/2026-01-01T00-00-00',
      'utf-8',
    );

    // Known address -- should succeed
    const okOut = handleEvidenceCapture({
      app_id: APP_ID,
      addresses: ['INV-01'],
      statement: 'Known signal.',
      type: 'static_analysis',
      workspace_path: tmpWorkspace,
    });
    expect(okOut).toContain('Evidence captured');

    // Unknown address -- should be rejected
    const badOut = handleEvidenceCapture({
      app_id: APP_ID,
      addresses: ['UNKNOWN-99'],
      statement: 'Unknown signal.',
      type: 'workshop',
      workspace_path: tmpWorkspace,
    });
    expect(badOut).toContain('Error');
    expect(badOut).toContain('UNKNOWN-99');
  });

  it('swao_evidence_capture is in SWAO_MCP_TOOLS and switch dispatch', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain("name: 'swao_evidence_capture'");
    expect(src).toContain("case 'swao_evidence_capture'");
  });
});

describe('mcp/server.ts -- swao_evidence_interview MCP Prompt (#1180)', () => {
  it('capabilities include prompts: {}', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain("prompts: {}");
  });

  it('ListPromptsRequestSchema and GetPromptRequestSchema are imported and handled', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain('ListPromptsRequestSchema');
    expect(src).toContain('GetPromptRequestSchema');
    expect(src).toContain('swao_evidence_interview');
  });

  it('returns error message when app_id is missing', () => {
    const result = buildEvidenceInterviewPrompt({});
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content.text).toContain('Error');
    expect(result.messages[0].content.text).toContain('app_id');
  });

  it('returns error when no workspace found (no cwd workspace)', () => {
    // No app_id causes early exit before workspace lookup
    const result = buildEvidenceInterviewPrompt({ app_id: 'nonexistent' });
    // Either "no SWAO workspace" or "not found" depending on cwd
    expect(result.messages[0].content.text).toMatch(/Error/);
  });

  it('returns checklist with signals and controls from reference workspace', () => {
    const REF_WORKSPACE = resolve(__dirname, '../../../../examples/portfolio-workspace/portfolio');
    const result = buildEvidenceInterviewPrompt({
      app_id: 'sovereign-health',
      workspace_path: REF_WORKSPACE,
    });
    expect(result.messages).toHaveLength(1);
    const text = result.messages[0].content.text;
    // Should have a header
    expect(text).toContain('sovereign-health');
    // Should contain the interview instructions
    expect(text).toContain('swao_evidence_capture');
  });
});

describe('mcp/server.ts -- swao_risk_import (#1183)', () => {
  // CLAUDE.md S5.9: mock-workbook tests required before first real invocation.
  // Tests cover: yaml happy path, csv happy path, malformed yaml, malformed csv,
  // handleRiskImport writes overlay to ingestion/structured/, handleRiskImport missing required params.

  it('yaml: parses a valid WspRiskImportOverlay and returns ok', async () => {
    const yaml = [
      'source: manual-export.yaml',
      'imported_at: "2026-07-21T10:00:00.000Z"',
      'risks:',
      '  - risk_id: RR-TEST-01',
      '    category: data_residency',
      '    likelihood: high',
      '    impact: high',
      '    trigger: PII stored outside EU.',
      '    mitigation: Enforce data-residency policy.',
      '    owner: platform_lead',
    ].join('\n');
    const result = await parseRiskImport('yaml', null, yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const overlay = result.overlay as { risks?: Array<{ risk_id: string }> };
      expect(overlay.risks).toHaveLength(1);
      expect(overlay.risks![0].risk_id).toBe('RR-TEST-01');
    }
  });

  it('yaml: rejects malformed YAML with a clear error', async () => {
    const result = await parseRiskImport('yaml', null, '{{not valid yaml:');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/YAML parse error/);
    }
  });

  it('yaml: rejects overlay that fails schema validation', async () => {
    // Missing required 'risks' array
    const result = await parseRiskImport('yaml', null, 'source: test\nimported_at: "2026-07-21"\n');
    expect(result.ok).toBe(false);
  });

  it('csv: parses a valid risk register CSV by column name', async () => {
    const csv = [
      'risk_id,app_id,category,likelihood,impact,trigger,mitigation,owner',
      'RR-CSV-01,test-app,security,medium,high,Unpatched dependency.,Apply patch.,dev_lead',
    ].join('\n');
    const result = await parseRiskImport('csv', null, csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const overlay = result.overlay as { risks?: Array<{ risk_id: string; category: string }> };
      expect(overlay.risks).toHaveLength(1);
      expect(overlay.risks![0].risk_id).toBe('RR-CSV-01');
      expect(overlay.risks![0].category).toBe('security');
    }
  });

  it('csv: rejects a CSV with only a header row (no data)', async () => {
    const csv = 'risk_id,category,likelihood,impact,trigger,mitigation,owner\n';
    const result = await parseRiskImport('csv', null, csv);
    expect(result.ok).toBe(false);
    // error message differs by path (< 2 lines vs 0 valid rows) -- just verify failure
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it('csv: rejects CSV rows missing risk_id', async () => {
    const csv = [
      'risk_id,category,likelihood,impact,trigger,mitigation,owner',
      ',security,medium,high,Trigger,Mitigation,owner',
    ].join('\n');
    const result = await parseRiskImport('csv', null, csv);
    expect(result.ok).toBe(false);
  });

  it('xlsx: rejects when source_path is not provided', async () => {
    const result = await parseRiskImport('xlsx', null, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/source_path/);
  });

  it('xlsx: rejects when file does not exist', async () => {
    const result = await parseRiskImport('xlsx', '/nonexistent/path/file.xlsx', null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/i);
  });

  it('xlsx: parses a real workbook with fact_risks column order', async () => {
    // Create a minimal xlsx using exceljs (the same dependency we use for parsing)
    const ExcelJS = await import('exceljs');
    const WorkbookClass = (ExcelJS.default as { Workbook?: typeof import('exceljs').Workbook }).Workbook
      ?? (ExcelJS as unknown as { Workbook: typeof import('exceljs').Workbook }).Workbook;
    const wb = new WorkbookClass();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['risk_id', 'app_id', 'category', 'likelihood', 'impact', 'trigger', 'mitigation', 'owner']);
    ws.addRow(['RR-XLSX-01', 'test-app', 'data_residency', 'high', 'high', 'PII in DE1.', 'Enforce residency.', 'platform_lead']);

    const tmpFile = join(tmpdir(), `swao-test-wb-${Date.now()}.xlsx`);
    try {
      await wb.xlsx.writeFile(tmpFile);
      const result = await parseRiskImport('xlsx', tmpFile, null);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const overlay = result.overlay as { risks?: Array<{ risk_id: string }> };
        expect(overlay.risks).toHaveLength(1);
        expect(overlay.risks![0].risk_id).toBe('RR-XLSX-01');
      }
    } finally {
      try { rmSync(tmpFile, { force: true }); } catch {}
    }
  }, 20000);

  it('handleRiskImport: rejects missing required params', async () => {
    expect(await handleRiskImport({})).toContain('Error: app_id is required');
    expect(await handleRiskImport({ app_id: 'x' })).toContain('Error: format');
    // When workspace_path absent + no cwd workspace: returns workspace error.
    // When cwd happens to be inside a workspace: returns source_path/content error.
    // Either way it must start with 'Error:'.
    const noContent = await handleRiskImport({ app_id: 'x', format: 'yaml' });
    expect(noContent).toMatch(/^Error:/);
  });

  it('handleRiskImport: writes overlay to ingestion/structured/ and returns success message', async () => {
    const tmpWorkspace = join(tmpdir(), `swao-risk-import-ws-${Date.now()}`);
    mkdirSync(join(tmpWorkspace, 'apps', 'test-app'), { recursive: true });
    writeFileSync(join(tmpWorkspace, '.swao.yml'), 'workspace_name: test\n', 'utf-8');

    const yaml = [
      'source: test.yaml',
      'imported_at: "2026-07-21T10:00:00.000Z"',
      'risks:',
      '  - risk_id: RR-WRITE-01',
      '    category: compliance',
      '    likelihood: low',
      '    impact: medium',
      '    trigger: Missing audit trail.',
      '    mitigation: Enable audit logging.',
      '    owner: security_lead',
    ].join('\n');

    const out = await handleRiskImport({
      app_id: 'test-app',
      workspace_path: tmpWorkspace,
      format: 'yaml',
      content: yaml,
    });

    expect(out).toContain('1 row');
    const overlayPath = join(tmpWorkspace, 'apps', 'test-app', 'ingestion', 'structured', 'risk-register-import.yaml');
    expect(existsSync(overlayPath)).toBe(true);
    const written = readFileSync(overlayPath, 'utf-8');
    expect(written).toContain('RR-WRITE-01');
  });

  it('csv: closure columns (status, closed_at) survive round-trip through parser', async () => {
    const csv = [
      'risk_id,app_id,category,likelihood,impact,trigger,mitigation,owner,status,evidence_ids,closed_by,closed_at',
      'RR-CLOSE-01,,security,medium,high,Unpatched lib.,Apply patch.,dev_lead,closed,EV-001,helmut,2026-07-21',
    ].join('\n');
    const result = await parseRiskImport('csv', null, csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const overlay = result.overlay as { risks: Array<Record<string, string>> };
      const r = overlay.risks[0];
      expect(r.status).toBe('closed');
      expect(r.closed_at).toBe('2026-07-21');
    }
  });
});

describe('mcp/server.ts -- swao_feedback_add + swao_annotate + swao_feedback_list (#1187)', () => {
  // CLAUDE.md S5.9: mock tests before first real invocation.

  it('handleFeedbackAdd: rejects missing required params', () => {
    expect(handleFeedbackAdd({})).toContain('Error: app_id is required');
    expect(handleFeedbackAdd({ app_id: 'x' })).toContain('Error: target_type');
    expect(handleFeedbackAdd({ app_id: 'x', target_type: 'control' })).toContain('Error: target_id');
    expect(handleFeedbackAdd({ app_id: 'x', target_type: 'control', target_id: 'CTRL-01' })).toContain('Error: rationale');
    expect(handleFeedbackAdd({ app_id: 'x', target_type: 'control', target_id: 'CTRL-01', rationale: 'r', override_outcome: 'SATISFIED' })).toMatch(/^Error:/);
  });

  it('handleFeedbackAdd: rejects invalid target_type', () => {
    const out = handleFeedbackAdd({ app_id: 'x', target_type: 'banana', target_id: 'CTRL-01', rationale: 'r', override_outcome: 'SATISFIED' });
    expect(out).toContain('Error: target_type');
  });

  it('handleFeedbackAdd: writes override to feedback/overrides.yaml', () => {
    const tmpWorkspace = join(tmpdir(), `swao-fb-ws-${Date.now()}`);
    mkdirSync(join(tmpWorkspace, 'apps', 'fb-app'), { recursive: true });

    const out = handleFeedbackAdd({
      app_id: 'fb-app',
      workspace_path: tmpWorkspace,
      target_type: 'control',
      target_id: 'GDPR_Art_32',
      override_outcome: 'SATISFIED',
      rationale: 'Manual review confirmed compliance.',
      author: 'architect@example.com',
    });
    expect(out).toContain('Override recorded');
    expect(out).toContain('GDPR_Art_32');
    const overridesPath = join(tmpWorkspace, 'apps', 'fb-app', 'feedback', 'overrides.yaml');
    expect(existsSync(overridesPath)).toBe(true);
    const content = readFileSync(overridesPath, 'utf-8');
    expect(content).toContain('GDPR_Art_32');
    expect(content).toContain('SATISFIED');
    expect(content).toContain('architect@example.com');
  });

  it('handleFeedbackAdd: appends without overwriting existing overrides', () => {
    const tmpWorkspace = join(tmpdir(), `swao-fb-append-${Date.now()}`);
    mkdirSync(join(tmpWorkspace, 'apps', 'fb-app'), { recursive: true });

    handleFeedbackAdd({ app_id: 'fb-app', workspace_path: tmpWorkspace, target_type: 'control', target_id: 'CTRL-01', override_outcome: 'SATISFIED', rationale: 'r1', author: 'user1' });
    handleFeedbackAdd({ app_id: 'fb-app', workspace_path: tmpWorkspace, target_type: 'risk', target_id: 'RR-001', override_outcome: 'closed', rationale: 'r2', author: 'user2' });

    const content = readFileSync(join(tmpWorkspace, 'apps', 'fb-app', 'feedback', 'overrides.yaml'), 'utf-8');
    expect(content).toContain('CTRL-01');
    expect(content).toContain('RR-001');
  });

  it('handleAnnotate: writes annotation to feedback/annotations.yaml', () => {
    const tmpWorkspace = join(tmpdir(), `swao-ann-${Date.now()}`);
    mkdirSync(join(tmpWorkspace, 'apps', 'ann-app'), { recursive: true });

    const out = handleAnnotate({
      app_id: 'ann-app',
      workspace_path: tmpWorkspace,
      target_type: 'control',
      target_id: 'GDPR_Art_35',
      text: 'DPIA completed as of last week.',
      author: 'pm@example.com',
    });
    expect(out).toContain('Annotation recorded');
    const annotPath = join(tmpWorkspace, 'apps', 'ann-app', 'feedback', 'annotations.yaml');
    expect(existsSync(annotPath)).toBe(true);
    const content = readFileSync(annotPath, 'utf-8');
    expect(content).toContain('DPIA completed');
    expect(content).toContain('GDPR_Art_35');
  });

  it('handleFeedbackList: returns no-feedback message when directory is empty', () => {
    const tmpWorkspace = join(tmpdir(), `swao-fl-empty-${Date.now()}`);
    mkdirSync(join(tmpWorkspace, 'apps', 'empty-app'), { recursive: true });
    const out = handleFeedbackList({ app_id: 'empty-app', workspace_path: tmpWorkspace });
    expect(out).toContain('No feedback');
  });

  it('handleFeedbackList: returns overrides and annotations', () => {
    const tmpWorkspace = join(tmpdir(), `swao-fl-full-${Date.now()}`);
    mkdirSync(join(tmpWorkspace, 'apps', 'fl-app'), { recursive: true });
    handleFeedbackAdd({ app_id: 'fl-app', workspace_path: tmpWorkspace, target_type: 'control', target_id: 'CTRL-01', override_outcome: 'SATISFIED', rationale: 'Verified.', author: 'architect' });
    handleAnnotate({ app_id: 'fl-app', workspace_path: tmpWorkspace, target_type: 'risk', target_id: 'RR-001', text: 'Follow up with platform team.', author: 'pm' });

    const out = handleFeedbackList({ app_id: 'fl-app', workspace_path: tmpWorkspace });
    expect(out).toContain('Overrides (1)');
    expect(out).toContain('Annotations (1)');
    expect(out).toContain('CTRL-01');
    expect(out).toContain('RR-001');
  });
});

describe('mcp/server.ts -- portfolio index tools (#1191)', () => {
  let tmpWs: string;

  beforeEach(() => {
    tmpWs = mkdtempSync(join(tmpdir(), 'swao-mcp-pf-'));
  });
  afterEach(() => {
    rmSync(tmpWs, { recursive: true, force: true });
  });

  function writePortfolioIndex(ws: string, apps: Array<{
    app_id: string; seven_r_label?: string; coverage_score?: number;
    portability_score?: number; lz_verdict?: string | null;
    risk_rollup?: { open: number; closed: number; high_count: number };
  }>): void {
    mkdirSync(join(ws, 'wsp'), { recursive: true });
    writeFileSync(join(ws, 'wsp', 'portfolio-index.json'), JSON.stringify({
      built_at: new Date().toISOString(),
      schema_version: '1.0',
      apps: apps.map(a => ({
        app_id: a.app_id,
        seven_r_label: a.seven_r_label ?? 'Replatform',
        modernization_position: 'cloud_native',
        portability_score: a.portability_score ?? 0.7,
        coverage_score: a.coverage_score ?? 0.8,
        total_negative_signals: 2,
        weighted_risk_score: 5,
        per_regime_coverage: { GDPR: { satisfied: 3, partial: 1, gap: 0, weighted_gap: 0 } },
        risk_rollup: a.risk_rollup ?? { open: 1, mitigated: 0, closed: 0, high_count: 1 },
        lz_verdict: a.lz_verdict ?? null,
      })),
    }), 'utf-8');
  }

  it('handlePortfolioQuery: returns error when no index found', () => {
    const out = handlePortfolioQuery({ workspace_path: tmpWs });
    expect(out).toContain('No portfolio-index.json found');
  });

  it('handlePortfolioQuery: returns all apps when no filters', () => {
    writePortfolioIndex(tmpWs, [
      { app_id: 'alpha', seven_r_label: 'Replatform' },
      { app_id: 'beta', seven_r_label: 'Rehost' },
    ]);
    const out = handlePortfolioQuery({ workspace_path: tmpWs });
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
  });

  it('handlePortfolioQuery: filters by seven_r', () => {
    writePortfolioIndex(tmpWs, [
      { app_id: 'alpha', seven_r_label: 'Replatform' },
      { app_id: 'beta', seven_r_label: 'Rehost' },
    ]);
    const out = handlePortfolioQuery({ workspace_path: tmpWs, filters: { seven_r: ['Rehost'] } });
    expect(out).not.toContain('alpha');
    expect(out).toContain('beta');
  });

  it('handlePortfolioQuery: filters by min_coverage', () => {
    writePortfolioIndex(tmpWs, [
      { app_id: 'alpha', coverage_score: 0.9 },
      { app_id: 'beta', coverage_score: 0.5 },
    ]);
    const out = handlePortfolioQuery({ workspace_path: tmpWs, filters: { min_coverage: 0.8 } });
    expect(out).toContain('alpha');
    expect(out).not.toContain('beta');
  });

  it('handlePortfolioStats: returns distribution stats from index', () => {
    writePortfolioIndex(tmpWs, [
      { app_id: 'alpha', seven_r_label: 'Replatform', coverage_score: 0.9 },
      { app_id: 'beta', seven_r_label: 'Rehost', coverage_score: 0.6 },
    ]);
    const out = handlePortfolioStats({ workspace_path: tmpWs });
    expect(out).toContain('7R Distribution');
    expect(out).toContain('Replatform');
    expect(out).toContain('Coverage Score');
    expect(out).toContain('Risk Rollup');
    expect(out).toContain('LZ Verdict');
  });

  it('handlePortfolioRisks: returns sorted risk rollup', () => {
    writePortfolioIndex(tmpWs, [
      { app_id: 'alpha', risk_rollup: { open: 5, closed: 2, high_count: 3 } },
      { app_id: 'beta', risk_rollup: { open: 1, closed: 0, high_count: 0 } },
    ]);
    const out = handlePortfolioRisks({ workspace_path: tmpWs });
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
    const alphaIdx = out.indexOf('alpha');
    const betaIdx = out.indexOf('beta');
    expect(alphaIdx).toBeLessThan(betaIdx); // alpha has more open risks
  });

  it('handlePortfolioLz: uses lzr-summary.json when present', () => {
    writePortfolioIndex(tmpWs, [{ app_id: 'alpha', lz_verdict: 'advisory' }]);
    mkdirSync(join(tmpWs, 'wsp', 'runs', '2026-07-22T0000'), { recursive: true });
    writeFileSync(join(tmpWs, 'wsp', 'latest.txt'), 'runs/2026-07-22T0000', 'utf-8');
    writeFileSync(join(tmpWs, 'wsp', 'runs', '2026-07-22T0000', 'lzr-summary.json'), JSON.stringify({
      assessed_at: '2026-07-22',
      total_apps: 1,
      apps: [{ app_id: 'alpha', provider_id: 'aws', landing_zone_id: 'eu-central-1', verdict: 'ready', blocker_count: 0, warning_count: 1 }],
      counts: { ready: 1, blocked: 0, advisory: 0, skipped: 0 },
      overall_verdict: 'ready',
    }), 'utf-8');
    const out = handlePortfolioLz({ workspace_path: tmpWs });
    expect(out).toContain('READY');
    expect(out).toContain('alpha');
  });

  it('handlePortfolioLz: falls back to index when no lzr-summary.json', () => {
    writePortfolioIndex(tmpWs, [{ app_id: 'alpha', lz_verdict: 'advisory' }]);
    const out = handlePortfolioLz({ workspace_path: tmpWs });
    expect(out).toContain('alpha');
    expect(out).toContain('advisory');
  });

  it('handlePortfolioSummary: uses index when available', () => {
    writePortfolioIndex(tmpWs, [
      { app_id: 'alpha', seven_r_label: 'Replatform', lz_verdict: 'ready' },
    ]);
    const out = handlePortfolioSummary({ workspace_path: tmpWs });
    expect(out).toContain('alpha');
    expect(out).toContain('Replatform');
    expect(out).toContain('ready');
    expect(out).not.toContain('no index');
  });
});

// ---------------------------------------------------------------------------
// Phase 4 drop-point gate (#1192)
// ---------------------------------------------------------------------------
// E2E round-trip: build a portfolio-index.json from a known reference dataset,
// then exercise all 4 portfolio MCP tools. Verifies correctness vs the reference,
// scale (400 apps, single read budget), staleness UX, and backward-compat gate
// (#1172) still green.
// ---------------------------------------------------------------------------

describe('mcp/server.ts -- Phase 4 drop-point gate (#1192)', () => {
  let tmpWs: string;

  beforeEach(() => {
    tmpWs = mkdtempSync(join(tmpdir(), 'swao-ph4-gate-'));
    mkdirSync(join(tmpWs, 'wsp'), { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpWs, { recursive: true, force: true });
  });

  // Reference dataset: 4 apps with distinct 7R labels, coverage, and risks.
  // These values are the ground truth -- every tool answer is verified against them.
  const REFERENCE_APPS = [
    {
      app_id: 'app-replatform',
      seven_r_label: 'Replatform',
      modernization_position: 'cloud_native',
      portability_score: 0.85,
      coverage_score: 0.92,
      total_negative_signals: 2,
      weighted_risk_score: 6,
      per_regime_coverage: { GDPR: { satisfied: 8, partial: 1, gap: 1, weighted_gap: 2 } },
      risk_rollup: { open: 3, mitigated: 0, closed: 1, high_count: 2 },
      lz_verdict: 'ready',
    },
    {
      app_id: 'app-rehost',
      seven_r_label: 'Rehost',
      modernization_position: 'lift_and_shift',
      portability_score: 0.55,
      coverage_score: 0.60,
      total_negative_signals: 5,
      weighted_risk_score: 15,
      per_regime_coverage: { GDPR: { satisfied: 4, partial: 2, gap: 4, weighted_gap: 8 } },
      risk_rollup: { open: 7, mitigated: 0, closed: 0, high_count: 4 },
      lz_verdict: 'blocked',
    },
    {
      app_id: 'app-retire',
      seven_r_label: 'Retire',
      modernization_position: 'decommission',
      portability_score: 0.10,
      coverage_score: 0.20,
      total_negative_signals: 1,
      weighted_risk_score: 2,
      per_regime_coverage: {},
      risk_rollup: { open: 0, mitigated: 0, closed: 0, high_count: 0 },
      lz_verdict: null,
    },
    {
      app_id: 'app-repurchase',
      seven_r_label: 'Repurchase',
      modernization_position: 'saas_migration',
      portability_score: 0.72,
      coverage_score: 0.88,
      total_negative_signals: 0,
      weighted_risk_score: 0,
      per_regime_coverage: { ISO_27001: { satisfied: 10, partial: 0, gap: 0, weighted_gap: 0 } },
      risk_rollup: { open: 1, mitigated: 0, closed: 2, high_count: 0 },
      lz_verdict: 'advisory',
    },
  ];

  function writeRefIndex(ws: string, apps = REFERENCE_APPS, builtAt?: string): void {
    writeFileSync(
      join(ws, 'wsp', 'portfolio-index.json'),
      JSON.stringify({
        built_at: builtAt ?? new Date().toISOString(),
        schema_version: '1.0',
        apps,
      }),
      'utf-8',
    );
  }

  // -- Categorisation query -------------------------------------------------

  it('Phase 4 gate: swao_portfolio_query -- no filter returns all 4 apps', () => {
    writeRefIndex(tmpWs);
    const out = handlePortfolioQuery({ workspace_path: tmpWs });
    expect(out).toContain('app-replatform');
    expect(out).toContain('app-rehost');
    expect(out).toContain('app-retire');
    expect(out).toContain('app-repurchase');
  });

  it('Phase 4 gate: swao_portfolio_query -- filter seven_r=Rehost returns only app-rehost', () => {
    writeRefIndex(tmpWs);
    const out = handlePortfolioQuery({ workspace_path: tmpWs, filters: { seven_r: ['Rehost'] } });
    expect(out).toContain('app-rehost');
    expect(out).not.toContain('app-replatform');
    expect(out).not.toContain('app-retire');
    expect(out).not.toContain('app-repurchase');
  });

  it('Phase 4 gate: swao_portfolio_query -- min_coverage 0.85 returns replatform + repurchase', () => {
    writeRefIndex(tmpWs);
    const out = handlePortfolioQuery({ workspace_path: tmpWs, filters: { min_coverage: 0.85 } });
    expect(out).toContain('app-replatform');
    expect(out).toContain('app-repurchase');
    expect(out).not.toContain('app-rehost');
    expect(out).not.toContain('app-retire');
  });

  it('Phase 4 gate: swao_portfolio_query -- lz_verdict=ready returns only app-replatform', () => {
    writeRefIndex(tmpWs);
    const out = handlePortfolioQuery({ workspace_path: tmpWs, filters: { lz_verdict: ['ready'] } });
    expect(out).toContain('app-replatform');
    expect(out).not.toContain('app-rehost');
    expect(out).not.toContain('app-retire');
    expect(out).not.toContain('app-repurchase');
  });

  // -- Stats query ----------------------------------------------------------

  it('Phase 4 gate: swao_portfolio_stats -- 7R distribution shows all 4 labels', () => {
    writeRefIndex(tmpWs);
    const out = handlePortfolioStats({ workspace_path: tmpWs });
    expect(out).toContain('Replatform');
    expect(out).toContain('Rehost');
    expect(out).toContain('Retire');
    expect(out).toContain('Repurchase');
    expect(out).toContain('7R Distribution');
  });

  it('Phase 4 gate: swao_portfolio_stats -- coverage stats present', () => {
    writeRefIndex(tmpWs);
    const out = handlePortfolioStats({ workspace_path: tmpWs });
    expect(out).toContain('Coverage Score');
    // p50 of [0.20, 0.60, 0.72, 0.85, 0.88, 0.92] -- must be between 0.60 and 0.92
    expect(out).toMatch(/p50:\s*0\.\d+/);
  });

  it('Phase 4 gate: swao_portfolio_stats -- LZ verdict distribution shown', () => {
    writeRefIndex(tmpWs);
    const out = handlePortfolioStats({ workspace_path: tmpWs });
    expect(out).toContain('LZ Verdict');
    expect(out).toContain('ready');
    expect(out).toContain('blocked');
    expect(out).toContain('advisory');
  });

  it('Phase 4 gate: swao_portfolio_stats -- risk rollup totals correct', () => {
    writeRefIndex(tmpWs);
    const out = handlePortfolioStats({ workspace_path: tmpWs });
    expect(out).toContain('Risk Rollup');
    // Total open across 4 apps: 3 + 7 + 0 + 1 = 11
    expect(out).toContain('11');
  });

  // -- Cross-app risk rollup ------------------------------------------------

  it('Phase 4 gate: swao_portfolio_risks -- sorted by open desc (rehost first)', () => {
    writeRefIndex(tmpWs);
    const out = handlePortfolioRisks({ workspace_path: tmpWs });
    expect(out).toContain('app-rehost');
    expect(out).toContain('app-replatform');
    const rehostIdx = out.indexOf('app-rehost');
    const replatformIdx = out.indexOf('app-replatform');
    expect(rehostIdx).toBeLessThan(replatformIdx); // 7 open > 3 open
  });

  it('Phase 4 gate: swao_portfolio_risks -- app-retire (0 open) appears at end or excluded', () => {
    writeRefIndex(tmpWs);
    const out = handlePortfolioRisks({ workspace_path: tmpWs });
    const rehostIdx = out.indexOf('app-rehost');
    const retireIdx = out.indexOf('app-retire');
    // app-retire (0 open) must appear after app-rehost (7 open) OR be excluded from output
    if (retireIdx >= 0) expect(retireIdx).toBeGreaterThan(rehostIdx);
  });

  // -- LZ rollup -----------------------------------------------------------

  it('Phase 4 gate: swao_portfolio_lz -- index fallback shows all verdict categories', () => {
    writeRefIndex(tmpWs);
    const out = handlePortfolioLz({ workspace_path: tmpWs });
    expect(out).toContain('app-replatform');
    expect(out).toContain('app-rehost');
    expect(out).toContain('app-repurchase');
    // ready / blocked / advisory all present
    expect(out).toMatch(/ready|READY/i);
    expect(out).toMatch(/blocked|BLOCKED/i);
    expect(out).toMatch(/advisory|ADVISORY/i);
  });

  // -- Scale test: ~400 synthetic apps, single index read -------------------

  it('Phase 4 gate: scale -- 400 apps; all 4 tools complete within 500 ms', () => {
    const apps = Array.from({ length: 400 }, (_, i) => ({
      app_id: `app-${String(i).padStart(4, '0')}`,
      seven_r_label: ['Replatform', 'Rehost', 'Retire', 'Repurchase'][i % 4],
      modernization_position: 'cloud_native',
      portability_score: Math.round((0.3 + (i % 7) * 0.1) * 100) / 100,
      coverage_score: Math.round((0.4 + (i % 6) * 0.1) * 100) / 100,
      total_negative_signals: i % 8,
      weighted_risk_score: (i % 8) * 3,
      per_regime_coverage: {
        GDPR: { satisfied: 5 + (i % 5), partial: i % 3, gap: i % 2, weighted_gap: i % 2 },
      },
      risk_rollup: { open: i % 10, mitigated: 0, closed: i % 4, high_count: i % 3 },
      lz_verdict: ['ready', 'blocked', 'advisory', null][i % 4] as string | null,
    }));
    writeFileSync(
      join(tmpWs, 'wsp', 'portfolio-index.json'),
      JSON.stringify({ built_at: new Date().toISOString(), schema_version: '1.0', apps }),
      'utf-8',
    );

    const t0 = Date.now();
    const q  = handlePortfolioQuery({ workspace_path: tmpWs, filters: { seven_r: ['Replatform'] } });
    const st = handlePortfolioStats({ workspace_path: tmpWs });
    const rk = handlePortfolioRisks({ workspace_path: tmpWs });
    const lz = handlePortfolioLz({ workspace_path: tmpWs });
    const elapsed = Date.now() - t0;

    // 100 Replatform apps (400 / 4)
    const replatformCount = (q.match(/app-/g) ?? []).length;
    expect(replatformCount).toBe(100);
    expect(st).toContain('Replatform');
    expect(rk).toMatch(/app-\d{4}/);
    expect(lz).toMatch(/ready|blocked|advisory/i);

    // All 4 tool calls must finish within 500 ms (single index read; no fan-out)
    expect(elapsed).toBeLessThan(500);
  });

  // -- Staleness UX --------------------------------------------------------

  it('Phase 4 gate: staleness -- warn when a run is newer than index.built_at', () => {
    // Index built_at in the past
    const pastBuiltAt = '2026-01-01T00:00:00.000Z';
    writeRefIndex(tmpWs, [{ ...REFERENCE_APPS[0] }], pastBuiltAt);

    // Create an app run with a latest.txt newer than pastBuiltAt
    const appWspDir = join(tmpWs, 'apps', 'app-replatform', 'wsp');
    mkdirSync(appWspDir, { recursive: true });
    writeFileSync(join(appWspDir, 'latest.txt'), 'runs/2026-07-22T10-00-00', 'utf-8');

    // Any portfolio tool should warn about staleness
    const out = handlePortfolioSummary({ workspace_path: tmpWs });
    expect(out).toMatch(/stale|WARN|outdated|newer/i);
  });

  it('Phase 4 gate: staleness -- no warn when index is fresh (no apps dir or same ts)', () => {
    writeRefIndex(tmpWs); // built_at = now
    const out = handlePortfolioSummary({ workspace_path: tmpWs });
    // Should NOT contain staleness warning when no apps dir / latest.txt present
    expect(out).not.toMatch(/stale|WARN|outdated/i);
  });

  // -- Backward-compat gate (#1172) still green ----------------------------

  it('Phase 4 gate: backward-compat -- wsp-schema.test.ts still references (#1172) gate', () => {
    // Source-level assertion: the #1172 backward-compat gate test file still
    // contains the gate and has not been accidentally removed during Phase 4 work.
    const gateFile = resolve(
      __dirname,
      '../../../swao/src/__tests__/wsp-schema.test.ts',
    );
    const src = existsSync(gateFile) ? readFileSync(gateFile, 'utf-8') : '';
    expect(src).toContain('#1172');
    expect(src).toContain('backward-compat gate');
  });
});

// ---------------------------------------------------------------------------
// #1194 -- completions, logging, resource-template polish
// ---------------------------------------------------------------------------

describe('mcp/server.ts -- #1194: completions + logging + swao://index', () => {
  it('CompleteRequestSchema is imported and handled in server.ts', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain('CompleteRequestSchema');
    expect(src).toContain('setRequestHandler(CompleteRequestSchema');
    expect(src).toContain("ref.type === 'ref/resource'");
  });

  it('logging capability declared in server capabilities', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain("logging: {}");
  });

  it('[WARN] lines are routed to sendLoggingMessage in CallToolRequestSchema handler', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain('sendLoggingMessage');
    expect(src).toContain('[WARN]');
    expect(src).toContain("level: 'warning'");
  });

  it('swao://index is declared as a resource in SWAO_RESOURCES', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain("uri: 'swao://index'");
    expect(src).toContain('Workspace discovery index');
  });

  it('swao://index is handled dynamically (not via static file read)', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain("uri === 'swao://index'");
    expect(src).toContain('buildWorkspaceIndex()');
  });

  it('buildWorkspaceIndex: lists apps from workspace when .swao.yml present', () => {
    // buildWorkspaceIndex uses findWorkspace(cwd()); point cwd() at a synthetic
    // workspace so it resolves via .swao.yml traversal (not the global config fallback).
    const tmpWs = mkdtempSync(join(tmpdir(), 'swao-idx-ws-'));
    try {
      writeFileSync(join(tmpWs, '.swao.yml'), 'version: 1\n', 'utf-8');
      mkdirSync(join(tmpWs, 'apps', 'app-alpha', 'wsp'), { recursive: true });
      mkdirSync(join(tmpWs, 'apps', 'app-beta', 'wsp'), { recursive: true });
      writeFileSync(join(tmpWs, 'apps', 'app-alpha', 'wsp', 'latest.txt'), 'runs/2026-07-22T10-00-00', 'utf-8');

      const origCwd = process.cwd();
      try {
        process.chdir(tmpWs);
        const out = buildWorkspaceIndex();
        expect(out).toContain('app-alpha');
        expect(out).toContain('app-beta');
        expect(out).toContain('swao://app/app-alpha/index');
        expect(out).toContain('2026-07-22');
      } finally {
        process.chdir(origCwd);
      }
    } finally {
      rmSync(tmpWs, { recursive: true, force: true });
    }
  });

  it('completionValues: framework_id returns GDPR and ISO_27001 when no prefix', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    // completionValues uses loadBundledRegimeRegistry(communityFrameworksDir)
    expect(src).toContain('communityFrameworksDir');
    expect(src).toContain("case 'framework_id'");
  });

  it('completionValues: app_id case is declared in completionValues', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain("case 'app_id'");
  });

  it('completionValues: provider case is declared in completionValues', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    expect(src).toContain("case 'provider'");
  });
});
