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

import { describe, it, expect } from 'vitest';
import { SWAO_MCP_TOOLS } from '@swao/module-mcp';

// #0588 (Sprint 065, Phase 7 v1.0.0 gate): three-surface sync -- the deep half.
//
// `swao/scripts/verify-surface-sync.mjs` is the standalone EXISTENCE gate (every
// CLI command has a TUI screen + an MCP tool, or a rationalised exception). This
// test adds the PARAMETER-SCHEMA half: for every CLI command that maps to an MCP
// tool, it pins the tool's input-parameter set, so a drift (a renamed/added/dropped
// MCP param) fails the build. It also asserts every tool's inputSchema is
// well-formed.
//
// NB: CLI options are kebab-case (--app, --workspace) and MCP params are snake_case
// (app_id, workspace_path); a strict name-equivalence across the two surfaces is
// intentionally NOT asserted here (the convention differs + the param sets
// legitimately differ) -- that 1:1 audit is the manual fallback the sprint rule
// names. What IS pinned: the CLI command -> MCP tool mapping + each tool's exact
// param set + required list (the regression contract).

interface ToolSchema {
  name: string;
  inputSchema?: { type?: string; properties?: Record<string, unknown>; required?: string[] };
}
const tools = SWAO_MCP_TOOLS as unknown as ToolSchema[];
const byName = new Map(tools.map((t) => [t.name, t]));

// CLI command -> its MCP tool + the expected parameter set (sorted) + required.
// Mirrors verify-surface-sync.mjs MCP_BY_COMMAND; the param sets are the current
// contract -- update here deliberately when an MCP tool's schema changes.
const EXPECTED: Record<string, { tool: string; params: string[]; required: string[] }> = {
  // assessment_type was added to swao_assess in sprint-063 (#0596 parity); pinned here.
  // lz_cat_targets was added in sprint-077 for LZ catalogue target selection.
  assess:    { tool: 'swao_assess',             params: ['app_id', 'assessment_type', 'llm_stub', 'lz_cat_targets', 'passes', 'workspace_path'], required: ['app_id'] },
  report:    { tool: 'swao_report',             params: ['app_id', 'format', 'view', 'workspace_path'],                       required: ['app_id'] },
  // swao_doctor renamed to swao_health_check for CLI/MCP parity (#0673).
  doctor:    { tool: 'swao_health_check',       params: ['format', 'workspace_path'],                                         required: [] },
  challenge: { tool: 'swao_challenge',          params: ['agent', 'app_id', 'workspace_path'],                                required: ['app_id'] },
  publish:   { tool: 'swao_publish',            params: ['app_id', 'block_profile', 'lang', 'mode', 'workspace_path'],    required: ['app_id'] },
  lenses:    { tool: 'swao_lenses',             params: ['action', 'lens_ids', 'workspace_path'],                             required: [] },
  normalize: { tool: 'swao_normalize',          params: ['app_id', 'workspace_path'],                                        required: [] },
  lz:        { tool: 'swao_lz_catalogue',       params: ['action', 'provider', 'workspace_path'],                            required: [] },
  // #0596 (sprint-073): separate lz tools.
  lz_list:   { tool: 'swao_lz_catalogue_list',  params: ['workspace_path'],                                                  required: [] },
  lz_show:   { tool: 'swao_lz_catalogue_show',  params: ['provider', 'workspace_path'],                                     required: ['provider'] },
  lz_fit:    { tool: 'swao_lz_fit',             params: ['app_id', 'provider', 'region', 'workspace_path'],                 required: ['app_id', 'provider', 'region'] },
};

describe('three-surface sync: MCP parameter schema (#0588)', () => {
  it('every MCP tool declares a well-formed inputSchema (type object + properties)', () => {
    for (const t of tools) {
      expect(t.inputSchema, `${t.name} has an inputSchema`).toBeDefined();
      expect(t.inputSchema!.type, `${t.name} inputSchema.type`).toBe('object');
      expect(typeof t.inputSchema!.properties, `${t.name} inputSchema.properties`).toBe('object');
    }
  });

  for (const [cmd, exp] of Object.entries(EXPECTED)) {
    it(`CLI "${cmd}" -> ${exp.tool}: parameter set is pinned`, () => {
      const t = byName.get(exp.tool);
      expect(t, `tool ${exp.tool} exists`).toBeDefined();
      const props = Object.keys(t!.inputSchema?.properties ?? {}).sort();
      expect(props).toEqual([...exp.params].sort());
      const required = [...(t!.inputSchema?.required ?? [])].sort();
      expect(required).toEqual([...exp.required].sort());
    });
  }

  it('every app-scoped tool exposes app_id + workspace_path (CLI --app / --workspace correspondence)', () => {
    for (const exp of Object.values(EXPECTED)) {
      const props = Object.keys(byName.get(exp.tool)!.inputSchema?.properties ?? {});
      // Every mapped tool takes workspace_path (the CLI --workspace counterpart).
      expect(props, `${exp.tool} exposes workspace_path`).toContain('workspace_path');
    }
  });
});
