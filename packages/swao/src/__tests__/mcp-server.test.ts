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
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT    = resolve(__dirname, '../../../../');
const PRIVATE_ROOT = resolve(__dirname, '../../../../../');
// #0574: the MCP server + `mcp` command relocated to @swao/module-mcp. These
// source-scan assertions follow the code to the module's new location; the
// runtime imports below pull the tool surface from the module package.
const MCP_SRC    = join(REPO_ROOT, 'packages/@swao/module-mcp/src/server.ts');
const MCP_CMD    = join(REPO_ROOT, 'packages/@swao/module-mcp/src/commands/mcp.ts');
// #0583: the mcp command is registered in the shared bootstrap (Community wiring),
// which every per-tier entry + index.ts uses; the registerMcp import + call moved
// from index.ts to bootstrap.ts.
const BOOTSTRAP_SRC = join(REPO_ROOT, 'packages/swao/src/bootstrap.ts');
const MCP_PKG    = join(REPO_ROOT, 'packages/@swao/module-mcp/package.json');
const DOCS_DIR   = join(REPO_ROOT, 'docs');
const DIM_CAT    = join(DOCS_DIR, 'assessment-dimension-catalogue.md');

// ---------------------------------------------------------------------------
// MCP server module -- structure
// ---------------------------------------------------------------------------

describe('MCP server module structure (#0131)', () => {
  it('@swao/module-mcp src/server.ts exists', () => {
    expect(existsSync(MCP_SRC)).toBe(true);
  });

  it('@swao/module-mcp src/commands/mcp.ts exists', () => {
    expect(existsSync(MCP_CMD)).toBe(true);
  });

  it('bootstrap.ts registers the mcp command from @swao/module-mcp (#0583)', () => {
    const src = readFileSync(BOOTSTRAP_SRC, 'utf-8');
    expect(src).toContain('registerMcp');
    expect(src).toContain("from '@swao/module-mcp'");
  });

  it('server.ts exports SWAO_MCP_TOOLS array', () => {
    const src = readFileSync(MCP_SRC, 'utf-8');
    expect(src).toContain('SWAO_MCP_TOOLS');
    expect(src).toContain('export');
  });

  it('server.ts exports startMcpServer function', () => {
    const src = readFileSync(MCP_SRC, 'utf-8');
    expect(src).toContain('startMcpServer');
    expect(src).toContain('StdioServerTransport');
  });

  it('server.ts imports from @modelcontextprotocol/sdk', () => {
    const src = readFileSync(MCP_SRC, 'utf-8');
    expect(src).toContain('@modelcontextprotocol/sdk');
    expect(src).toContain('Server');
  });
});

// ---------------------------------------------------------------------------
// MCP tool definitions -- correct shape and required fields
// ---------------------------------------------------------------------------

describe('MCP tool definitions (#0131)', { timeout: 30_000 }, () => {
  it('exposes the expected MCP tool surface', async () => {
    const { SWAO_MCP_TOOLS } = await import('@swao/module-mcp');
    const names = SWAO_MCP_TOOLS.map(t => t.name);
    expect(names).toContain('swao');
    expect(names).toContain('swao_assess');
    expect(names).toContain('swao_report');
    // swao_doctor renamed to swao_health_check for CLI/MCP parity (#0673).
    expect(names).toContain('swao_health_check');
    expect(names).toContain('swao_challenge');
    expect(names).toContain('swao_import');
    expect(names.length).toBeGreaterThanOrEqual(6);
  });

  it('every tool has name, description, and inputSchema', async () => {
    const { SWAO_MCP_TOOLS } = await import('@swao/module-mcp');
    for (const tool of SWAO_MCP_TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(10);
      expect(typeof tool.inputSchema).toBe('object');
    }
  });

  it('swao_assess requires app_id input', async () => {
    const { SWAO_MCP_TOOLS } = await import('@swao/module-mcp');
    const assess = SWAO_MCP_TOOLS.find(t => t.name === 'swao_assess');
    expect(assess?.inputSchema.required).toContain('app_id');
  });

  it('swao_report requires app_id input', async () => {
    const { SWAO_MCP_TOOLS } = await import('@swao/module-mcp');
    const report = SWAO_MCP_TOOLS.find(t => t.name === 'swao_report');
    expect(report?.inputSchema.required).toContain('app_id');
  });

  it('swao_health_check has no required inputs', async () => {
    const { SWAO_MCP_TOOLS } = await import('@swao/module-mcp');
    const hc = SWAO_MCP_TOOLS.find(t => t.name === 'swao_health_check');
    expect(hc?.inputSchema.required).toHaveLength(0);
  });

  it('swao_challenge supports 5 agent values', async () => {
    const { SWAO_MCP_TOOLS } = await import('@swao/module-mcp');
    const challenge = SWAO_MCP_TOOLS.find(t => t.name === 'swao_challenge');
    const agentProp = (challenge?.inputSchema.properties as Record<string, { enum?: readonly string[] }>)?.agent;
    expect(agentProp?.enum).toContain('technical');
    expect(agentProp?.enum).toContain('exec');
    expect(agentProp?.enum).toContain('compliance');
    expect(agentProp?.enum).toContain('finops');
    expect(agentProp?.enum).toContain('migration-manager');
  });

  it('swao_import requires app_id, filename, and content', async () => {
    const { SWAO_MCP_TOOLS } = await import('@swao/module-mcp');
    const importTool = SWAO_MCP_TOOLS.find(t => t.name === 'swao_import');
    expect(importTool?.inputSchema.required).toContain('app_id');
    expect(importTool?.inputSchema.required).toContain('filename');
    expect(importTool?.inputSchema.required).toContain('content');
  });

  it('swao_import has workspace_path as optional property', async () => {
    const { SWAO_MCP_TOOLS } = await import('@swao/module-mcp');
    const importTool = SWAO_MCP_TOOLS.find(t => t.name === 'swao_import');
    const props = importTool?.inputSchema.properties as Record<string, unknown>;
    expect(props?.['workspace_path']).toBeDefined();
    expect(importTool?.inputSchema.required).not.toContain('workspace_path');
  });

  it('swao_report supports text and yaml format options', async () => {
    const { SWAO_MCP_TOOLS } = await import('@swao/module-mcp');
    const report = SWAO_MCP_TOOLS.find(t => t.name === 'swao_report');
    const fmtProp = (report?.inputSchema.properties as Record<string, { enum?: readonly string[] }>)?.format;
    expect(fmtProp?.enum).toContain('text');
    expect(fmtProp?.enum).toContain('yaml');
  });

  it('all inputSchemas have type: object', async () => {
    const { SWAO_MCP_TOOLS } = await import('@swao/module-mcp');
    for (const tool of SWAO_MCP_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

// ---------------------------------------------------------------------------
// commands/mcp.ts -- CLI registration
// ---------------------------------------------------------------------------

describe('MCP CLI command registration (#0131)', () => {
  it('commands/mcp.ts exports registerMcp function', () => {
    const src = readFileSync(MCP_CMD, 'utf-8');
    expect(src).toContain('registerMcp');
    expect(src).toContain('export function');
  });

  it('commands/mcp.ts registers "mcp" as the subcommand name', () => {
    const src = readFileSync(MCP_CMD, 'utf-8');
    expect(src).toContain("command('mcp')");
  });

  it('commands/mcp.ts calls startMcpServer', () => {
    const src = readFileSync(MCP_CMD, 'utf-8');
    expect(src).toContain('startMcpServer');
  });

  it('@modelcontextprotocol/sdk is listed in @swao/module-mcp dependencies', () => {
    // #0574: the SDK moved with the server into @swao/module-mcp; the host no
    // longer depends on it directly.
    const pkg = JSON.parse(readFileSync(MCP_PKG, 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@modelcontextprotocol/sdk']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Assessment dimension catalogue (#0071)
// ---------------------------------------------------------------------------

describe('assessment-dimension-catalogue.md (#0071)', () => {
  it('docs/assessment-dimension-catalogue.md exists', () => {
    expect(existsSync(DIM_CAT)).toBe(true);
  });

  it('documents at least 6 dimensions', () => {
    const src = readFileSync(DIM_CAT, 'utf-8');
    const headings = (src.match(/^## \d+\./gm) ?? []);
    expect(headings.length).toBeGreaterThanOrEqual(6);
  });

  it('covers 7R Migration Pattern', () => {
    const src = readFileSync(DIM_CAT, 'utf-8');
    expect(src).toContain('7R Migration Pattern');
  });

  it('covers Portability Score with score range table', () => {
    const src = readFileSync(DIM_CAT, 'utf-8');
    expect(src).toContain('Portability Score');
    expect(src).toContain('0.70');
  });

  it('covers Legacy Indicators with tier definitions', () => {
    const src = readFileSync(DIM_CAT, 'utf-8');
    expect(src).toContain('Legacy Indicators');
    expect(src).toContain('Tier 1');
    expect(src).toContain('Tier 2');
    expect(src).toContain('Tier 3');
  });

  it('covers Data Migration Feasibility', () => {
    const src = readFileSync(DIM_CAT, 'utf-8');
    expect(src).toContain('Data Migration Feasibility');
    expect(src).toContain('feasibility_ratio');
  });

  it('covers CI/CD Pipeline Security', () => {
    const src = readFileSync(DIM_CAT, 'utf-8');
    expect(src).toContain('Pipeline Security');
  });

  it('covers Observability Readiness with score threshold', () => {
    const src = readFileSync(DIM_CAT, 'utf-8');
    expect(src).toContain('Observability');
    expect(src).toContain('0.60');
  });

  it('has no em-dashes (U+2014)', () => {
    const src = readFileSync(DIM_CAT, 'utf-8');
    expect(src.includes('—')).toBe(false);
  });

  it('has no en-dashes (U+2013)', () => {
    const src = readFileSync(DIM_CAT, 'utf-8');
    expect(src.includes('–')).toBe(false);
  });

  it('includes "Suggested consultant language" in at least 4 dimensions', () => {
    const src = readFileSync(DIM_CAT, 'utf-8');
    const count = (src.match(/Suggested consultant language/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Assessment scores dimension descriptions schema (#0070)
// ---------------------------------------------------------------------------

describe('DimensionDescriptionSchema in AssessmentScoresSchema (#0070)', () => {
  it('SpineSchema accepts assessment_scores with benefit + interpretation fields', async () => {
    const { SpineSchema } = await import('../schema/wsp-spine.js');
    const result = SpineSchema.safeParse({
      wsp_version: '0.9',
      meta: { assessor: 'test', assessment_date: '2026-04-29', simulation_type: 'woz', iter: 1 },
      assessed_at: '2026-04-29T00:00:00Z',
      overall: { seven_r_label: 'Replatform', categories: [] },
      passes_executed: [],
      wsp_files: { evidence: 'wsp-evidence.yaml', plan: 'wsp-plan.yaml', passes_dir: 'passes/' },
      app: { name: 'test-app' },
      assessment_scores: {
        seven_r: {
          description: 'Classifies the recommended migration strategy.',
          benefit: 'Anchors the programme business case and timeline.',
          interpretation: 'Score Replatform at 0.82 confidence -- proceed to planning.',
          verdict: 'Replatform',
          confidence: 0.82,
          rationale_signal: 'SYNTH-01',
        },
        portability: {
          description: 'Fraction of external egress with sovereign equivalents.',
          benefit: 'Predicts vendor lock-in risk.',
          interpretation: 'Score 0.75 is above the 0.70 threshold -- sovereign-ready.',
          score: 0.75,
          threshold: 0.70,
          status: 'above_threshold',
          rationale_signal: 'SYNTH-10',
        },
      },
    });
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
  });

  it('benefit and interpretation are optional -- existing fixtures parse without them', async () => {
    const { SpineSchema } = await import('../schema/wsp-spine.js');
    const result = SpineSchema.safeParse({
      wsp_version: '0.9',
      meta: { assessor: 'test', assessment_date: '2026-04-29', simulation_type: 'woz', iter: 1 },
      assessed_at: '2026-04-29T00:00:00Z',
      overall: { seven_r_label: 'Replatform', categories: [] },
      passes_executed: [],
      wsp_files: { evidence: 'wsp-evidence.yaml', plan: 'wsp-plan.yaml', passes_dir: 'passes/' },
      app: { name: 'test-app' },
      assessment_scores: {
        seven_r: {
          description: 'Classifies the recommended migration strategy.',
          verdict: 'Replatform',
          confidence: 0.82,
          rationale_signal: 'SYNTH-01',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('Medplum golden fixture parses with benefit + interpretation fields', async () => {
    const { load } = await import('js-yaml');
    const { readFileSync: rf } = await import('fs');
    const { join: pjoin } = await import('path');
    const { SpineSchema } = await import('../schema/wsp-spine.js');
    const MEDPLUM_WSP = pjoin(PRIVATE_ROOT, 'examples/portfolio-workspace/portfolio/apps/medplum/wsp');
    const raw = load(rf(pjoin(MEDPLUM_WSP, 'wsp.yaml'), 'utf-8'));
    const result = SpineSchema.safeParse(raw);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
  });

  it('Medplum fixture has benefit field on portability dimension', async () => {
    const { load } = await import('js-yaml');
    const { readFileSync: rf } = await import('fs');
    const { join: pjoin } = await import('path');
    const MEDPLUM_WSP = pjoin(PRIVATE_ROOT, 'examples/portfolio-workspace/portfolio/apps/medplum/wsp');
    const raw = load(rf(pjoin(MEDPLUM_WSP, 'wsp.yaml'), 'utf-8')) as {
      assessment_scores?: { portability?: { benefit?: string; interpretation?: string } };
    };
    expect(raw.assessment_scores?.portability?.benefit).toBeTruthy();
    expect(raw.assessment_scores?.portability?.interpretation).toBeTruthy();
  });
});
