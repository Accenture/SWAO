// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SWAO_MCP_TOOLS, handleSignals } from '@swao/module-mcp';

// #0261 -- MCP completeness gate. Sprint 028's audit (Phase 1 MCP report
// + #0254 fix) revealed that the swao_signals tool was printing
// "Confidence: --" for every signal because the renderer's typeof check
// rejected string confidence values. This test pins:
//
//   1. The set of registered tools (catches accidental removals + flags
//      additions so the audit doc stays in sync).
//   2. The shape of each tool entry (name + description + inputSchema).
//   3. That swao_signals on a known fixture produces text with a
//      non-'--' Confidence line (regression for #0254).
//
// When #0258 adds the 5 new tools (swao_control_detail, swao_costs,
// swao_risks, swao_portfolio_summary, swao_lzr_weights) this test will
// fail loudly until the expected list is updated -- intentional.

const EXPECTED_TOOLS = new Set([
  'swao',
  'swao_assess',
  'swao_report',
  'swao_health_check',
  'swao_challenge',
  'swao_import',
  'swao_signal_detail',
  'swao_signals',
  'swao_explain_landing_zone',
  // #0258 -- audit-grade tools landed in Sprint 028 audit close.
  'swao_control_detail',
  'swao_costs',
  'swao_risks',
  'swao_portfolio_summary',
  'swao_lzr_weights',
  // Publication Engine Foundation + Prism lenses + portal query tools.
  'swao_publish',
  'swao_publish_site',
  'swao_lenses',
  'swao_normalize',
  'swao_portal_query',
  // #0596 -- landing-zone catalogue read access (Design 056).
  'swao_lz_catalogue',
  // #0596 (sprint-073) -- separate list/show/fit tools for CLI/MCP parity.
  'swao_lz_catalogue_list',
  'swao_lz_catalogue_show',
  'swao_lz_fit',
  // swao_hub: workspace-level hub shortcut added in sprint-077.
  'swao_hub',
  // Sprint-104 M32 MCP Integration tools (#1172-#1194).
  'swao_annotate',
  'swao_cloud_provider_catalogue',
  'swao_control_catalogue',
  'swao_evidence_capture',
  'swao_feedback_add',
  'swao_feedback_list',
  'swao_framework_detail',
  'swao_frameworks_list',
  'swao_ingest',
  'swao_passes',
  'swao_portfolio_lz',
  'swao_portfolio_query',
  'swao_portfolio_risks',
  'swao_portfolio_stats',
  'swao_risk_import',
  // #1214 (sprint-105) -- workspace inventory tool.
  'swao_workspace_inventory',
]);

describe('MCP completeness gate (#0261)', () => {
  it('SWAO_MCP_TOOLS registers the expected tool surface', () => {
    const names = new Set(SWAO_MCP_TOOLS.map(t => t.name));
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  it('every tool has a non-empty description and an inputSchema', () => {
    for (const tool of SWAO_MCP_TOOLS) {
      expect(tool.name, `tool ${JSON.stringify(tool)}`).toBeTruthy();
      expect(tool.description, `tool ${tool.name} description`).toBeTruthy();
      expect(tool.description.length, `tool ${tool.name} description length`).toBeGreaterThan(30);
      expect(tool.inputSchema, `tool ${tool.name} inputSchema`).toBeDefined();
      expect((tool.inputSchema as { type?: string }).type, `tool ${tool.name} inputSchema.type`).toBe('object');
    }
  });
});

describe('MCP swao_signals (#0254 regression)', () => {
  let tmp: string;
  let appDir: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-mcp-completeness-'));
    appDir = join(tmp, 'apps', 'audited');
    const runDir = join(appDir, 'wsp', 'runs', '2026-05-14T09-00-00');
    mkdirSync(join(runDir, 'passes'), { recursive: true });

    writeFileSync(join(appDir, 'wsp', 'latest.txt'), 'runs/2026-05-14T09-00-00', 'utf-8');
    writeFileSync(
      join(runDir, 'passes', '09-synth.yaml'),
      `pass:
  id: 9
  name: synthesis
  signal_prefix: SYNTH
  status: complete
  iter: 1
  assessed_at: '2026-05-14T09:00:00Z'
signals:
  - id: SYNTH-01
    source: llm_inference
    category: application
    severity: high
    outcome: negative
    confidence: high
    assessor: llm
    assessed_at: '2026-05-14T09:00:00Z'
    derivation: 'Synthetic Replatform verdict with high confidence used to verify MCP signal rendering.'
    evidence: [INV-01]
    synthesis: true
assessment:
  seven_r_label: Replatform
  modernization_position: invest_modernize_now
  portability_score: 1.0
  confidence: high
`,
      'utf-8',
    );

    // Spine needed by swao_signals to walk apps/<id>/wsp/...
    writeFileSync(
      join(appDir, 'wsp', 'runs', '2026-05-14T09-00-00', 'wsp.yaml'),
      `wsp_version: "0.10"
app:
  id: audited
overall: { seven_r_label: Replatform }
landing_zone: { primary: synthetic-target }
assessed_at: '2026-05-14T09:00:00Z'
`,
      'utf-8',
    );
  });

  afterAll(() => {
    if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it('renders Confidence: <value> (not --) for signals carrying a string confidence', () => {
    const out = handleSignals({ app_id: 'audited', workspace_path: tmp, prefix_filter: 'SYNTH' });
    expect(out).toContain('SYNTH-01');
    // The bug we're guarding against: 'Confidence: --' for non-numeric confidence.
    expect(out).toMatch(/Confidence:\s+high/);
    expect(out).not.toMatch(/Confidence:\s+--\s*\nPass file:\s+09-synth/);
  });
});
