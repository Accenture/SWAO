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

describe('swao_explain_landing_zone MCP tool (#0151)', () => {
  it('is registered in SWAO_MCP_TOOLS', () => {
    const names = SWAO_MCP_TOOLS.map((t) => t.name);
    expect(names).toContain('swao_explain_landing_zone');
  });

  it('declares app_id as a required input', () => {
    const tool = SWAO_MCP_TOOLS.find((t) => t.name === 'swao_explain_landing_zone');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toContain('app_id');
  });

  it('description references fit scores and disqualifications (the rationale surface)', () => {
    const tool = SWAO_MCP_TOOLS.find((t) => t.name === 'swao_explain_landing_zone');
    expect(tool?.description).toMatch(/fit score/i);
    expect(tool?.description).toMatch(/disqualified/i);
    expect(tool?.description).toMatch(/why/i);
  });

  it('exposes workspace_path and app_id as input properties', () => {
    const tool = SWAO_MCP_TOOLS.find((t) => t.name === 'swao_explain_landing_zone');
    expect(tool).toBeDefined();
    if (tool) {
      const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      expect(props).toHaveProperty('app_id');
      expect(props).toHaveProperty('workspace_path');
    }
  });
});
