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

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CompleteRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { spawnSync, spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname, join as pathJoin } from 'path';
import { tmpdir } from 'os';
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, copyFileSync, statSync } from 'fs';
import { load, dump as yamlDump } from 'js-yaml';
import {
  findWorkspace,
  DEFAULT_PASS_NAMES,
  TOTAL_DEFAULT_PASSES,
  loadRegimeRegistry,
  loadBundledRegimeRegistry,
  loadRegimeCatalogue,
  resolveCatalogsDir,
  resolveDefaultCataloguePath,
  loadCatalogue,
  redactPiiString,
  emptyCounts,
} from '@swao/core';
import type { ComplianceControl, ComplianceRegime, RiskRegisterItem, RegimeCatalogue, ResolvedRegime } from '@swao/core';
import { WspRiskImportOverlaySchema, WspOverrideRecordSchema, WspAnnotationRecordSchema } from '@swao/core';
import { communityFrameworksDir } from '@swao/community-frameworks';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Host injection (#0574, mirrors the #0573 doctor DI pattern). After this module
 * was extracted from the host, `__dirname` no longer resolves the host CLI: a
 * relative `../index.js` now points inside `@swao/module-mcp/dist`, not at
 * `packages/swao/dist/index.js`. So the MCP tools (which spawn the swao CLI to
 * run assessments / reports / etc.) must be told, by the host, which CLI to
 * invoke and whether it is a node script or a native pkg binary.
 *
 * The pre-extraction `swaoCliPath()` probed `join(__dirname, '../../dist-bin/swao-*')`
 * candidates; those resolved to `packages/swao/dist-bin` (never the real
 * `<workspace>/dist-bin`) and so never matched in practice. The dead candidate
 * probe is intentionally dropped in favour of an explicit host-provided path.
 */
export interface McpHostDeps {
  /** Absolute path to the swao CLI entry the server should spawn for tool calls.
   *  In a pkg binary this is process.execPath; in dev it is the host index.js/ts. */
  swaoCliPath: string;
  /** True when swaoCliPath is a .js/.ts to run via the node execPath; false when it is a native binary. */
  cliIsScript: boolean;
}

// Module-scoped host deps, set by startMcpServer before any transport connects.
// Threading a deps object through ~20 handler signatures would balloon the diff
// and risk a behavioural change; a module-scoped reference keeps every handler
// and WHY-comment untouched while still honouring the injection.
let hostDeps: McpHostDeps | null = null;

// Workspace path pinned via `swao mcp --workspace <path>` (#1203). When set,
// resolveWorkspace falls back to this value when no workspace_path arg is
// provided and findWorkspace(cwd) returns nothing. Allows launching the MCP
// server from any directory while still resolving a known workspace.
let mcpPinnedWorkspace: string | null = null;

// Pure resolver for the spawn command/args from the injected host deps (#0574).
// Exported so the DI branches are unit-testable without spawning a subprocess
// (the named MCP integration tests do not exercise the spawn path). The `deps`
// argument is explicit rather than read from the module global so the function
// stays pure; runSwao / runSwaoAssessAsync pass the module-scoped `hostDeps`.
//   - cliIsScript: spawn the node execPath with [swaoCliPath, ...args]  (dev)
//   - else:        spawn swaoCliPath directly with args                 (pkg binary; execPath IS swao)
//   - null deps:   defensive fallback (a handler reached without injection)
export function resolveSpawn(
  deps: McpHostDeps | null,
  args: string[],
): { cmd: string; cmdArgs: string[] } {
  if (!deps) {
    return { cmd: process.execPath, cmdArgs: [process.argv[1] ?? '', ...args] };
  }
  if (deps.cliIsScript) {
    return { cmd: process.execPath, cmdArgs: [deps.swaoCliPath, ...args] };
  }
  return { cmd: deps.swaoCliPath, cmdArgs: args };
}

function runSwao(args: string[], cwd?: string): { stdout: string; stderr: string; ok: boolean } {
  const { cmd, cmdArgs } = resolveSpawn(hostDeps, args);
  const result = spawnSync(cmd, cmdArgs, {
    encoding: 'utf-8',
    cwd: cwd ?? process.cwd(),
    // #0154: flag every MCP-spawned subprocess so the SWAO-MCP doctor
    // probe knows MCP is demonstrably working and short-circuits its
    // config-file inspection. Matches the precedent set by
    // runSwaoAssessAsync.
    // PKG_EXECPATH: '' prevents the pkg spawn-patch from injecting the parent
    // binary path, which would cause the child binary to treat argv[1] ('assess'
    // etc.) as the module entry instead of its bundled default (#0807-P3).
    env: { ...process.env, SWAO_MCP_CONTEXT: '1', PKG_EXECPATH: '' },
    timeout: 300_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ok: result.status === 0,
  };
}

// Sprint-105 build identifier -- ask Claude "what MCP build is loaded?" to verify
const MCP_BUILD_ID = 'v0.9.0-sprint-105 | tools: swao_health_check, swao_workspace_inventory';

const WELCOME = `
================================================================
S W A O: Sovereign Workload Assessment and Onboarding
================================================================
Accenture x meshcloud GmbH  |  Sovereign Workload Assessment
MCP Build: ${MCP_BUILD_ID}

Assessment Workflow
-------------------
  1. Health Check      Verify LLM connectivity, workspace layout,
                       credentials, and Playwright availability.

  2. Run Assessment    Analyse source code, dependencies, egress
                       destinations, TF config, and compliance posture.
                       Produces a Workload Sovereignty Profile (WSP).

  3. Generate Report   Summarise findings, migration blockers, risk
                       register, and recommended next steps.
                       Role views: application-architect | business-owner |
                       grc-compliance-officer | finops-lead |
                       programme-manager | lzr. Legacy aliases (technical /
                       exec / compliance / finops / migration-manager) still
                       accepted with a deprecation warning.

  4. Challenge Session Run a stakeholder critique from five perspectives:
                       - Architect    (Application Architect)
                       - Business     (Business Owner)
                       - Compliance   (GRC / Compliance Officer)
                       - FinOps       (FinOps Lead)
                       - Migration    (Migration / Programme Manager)

Available Tools
---------------
  swao                       This screen, workflow overview and quick-start guide.
  swao_health_check          Health check: LLM, credentials, workspace, Playwright.
  swao_assess                Run a sovereignty assessment for one application.
  swao_report                Generate a report from an existing assessment.
  swao_challenge             Run a stakeholder challenge session against a WSP.
  swao_import                Stage a context file into an application's wsp/inputs/ directory.
  swao_signal_detail         Look up one signal by ID and return its full derivation
                             text plus all evidence file paths and line numbers.
                             Use to answer "what exactly did SWAO find for DATA-03?"
  swao_signals               List every signal from the latest assessment, sorted by
                             severity. Full text -- no truncation. Optional prefix
                             filter: DATA, CRYPTO, EGR, SBOM, STATE, etc.
  swao_explain_landing_zone  Show how the landing zone was selected: fit scores,
                             scoring weights, disqualification reasons, and BSI C5
                             / GDPR coverage per provider. Use to answer
                             "why was provider X chosen over Y?"

Quick Start
-----------
  "Run swao_health_check"
  "Run swao_assess for app ghostfolio at workspace <absolute-path>"
  "Show me the business-owner report for medplum"
  "Run a grc-compliance-officer challenge for sovereign-health"
  "What did SWAO find for DATA-03 in sovereign-health?"
  "Show all critical signals for sovereign-health"

Tip: all tools accept workspace_path (absolute path to the portfolio
     root that contains .swao.yml) and app_id (folder name under
     portfolio/apps/).

Knowledge Base (ask to read these)
-----------------------------------
  swao://getting-started        First-time user tutorial: concepts,
                                workflow, and step-by-step guide.
  swao://assessment-dimensions  Plain-language explanation of all
                                eight scoring dimensions.
================================================================
`.trim();

export const SWAO_MCP_TOOLS = [
  {
    name: 'swao',
    description:
      'Show the SWAO welcome screen: MCP build version, assessment workflow overview, ' +
      'available tools, and quick-start guide. Call this to check the loaded MCP build ID ' +
      'or get a tool overview. Use this as the entry point.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'swao_assess',
    description:
      'Run a sovereign workload assessment for an application. ' +
      'Analyses source code, SBOM, egress destinations, and configuration. ' +
      'Returns a Workload Sovereignty Profile (WSP) summary. ' +
      'Note: this runs for 2-3 minutes. Before calling, tell the user the ' +
      'assessment has started and they will see a full progress log when it ' +
      'completes; per-pass progress notifications stream during the run when ' +
      'the client provides a progressToken.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: {
          type: 'string',
          description: 'Application identifier (matches folder name under portfolio/apps/)',
        },
        workspace_path: {
          type: 'string',
          description: 'Absolute path to the portfolio workspace root (contains .swao.yml)',
        },
        passes: {
          type: 'string',
          description:
            'Comma-separated list of passes to run (e.g. "inv,state,egr"). Omit to run all.',
        },
        llm_stub: {
          type: 'boolean',
          description: 'Use stub LLM responses (no API call). Useful for testing.',
        },
        assessment_type: {
          type: 'string',
          description:
            'Assessment type: application (default), landing-zone. ' +
            'Omit for a standard Application Assessment. ' +
            'Audit and LLM types are coming soon.',
        },
        lz_cat_targets: {
          type: 'string',
          description:
            'Comma-separated provider:region pairs for landing-zone catalogue fits ' +
            '(e.g. "aws-esc:eusc-de-east-1" or "aws-esc:eusc-de-east-1,azure:westeurope"). ' +
            'Each pair produces a separate lz-catalogue-fit-<provider>-<region>.yaml artefact. ' +
            'Supersedes lz_cat_provider/lz_cat_region when provided.',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'swao_report',
    description:
      'Generate a human-readable sovereignty assessment report for an application. ' +
      'Requires a prior swao_assess run. Returns formatted findings, blockers, and next steps.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: {
          type: 'string',
          description: 'Application identifier',
        },
        workspace_path: {
          type: 'string',
          description: 'Absolute path to the portfolio workspace root',
        },
        format: {
          type: 'string',
          enum: ['text', 'yaml'],
          description: 'Output format. Default: text.',
        },
        view: {
          type: 'string',
          enum: [
            // Canonical persona IDs (#0286)
            'application-architect',
            'business-owner',
            'grc-compliance-officer',
            'finops-lead',
            'programme-manager',
            // Legacy aliases (deprecated; CLI prints a warning, MCP relays it)
            'technical',
            'exec',
            'compliance',
            'finops',
            'migration-manager',
          ],
          description:
            'Role-specific report view. Canonical IDs: application-architect (default), ' +
            'business-owner, grc-compliance-officer, finops-lead, programme-manager. ' +
            'Legacy aliases (technical, exec, compliance, finops, migration-manager) ' +
            'still accepted with a deprecation warning. Omit for the default Application Architect view.',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'swao_health_check',
    description:
      'Run SWAO health checks: LLM connectivity, credential store, workspace structure, ' +
      'Playwright availability, and licence status. Returns a structured health report.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_path: {
          type: 'string',
          description: 'Workspace path to check (optional; checks global config if omitted)',
        },
        format: {
          type: 'string',
          enum: ['text', 'yaml', 'json'],
          description: 'Output format. Default: text.',
        },
      },
      required: [],
    },
  },
  {
    name: 'swao_challenge',
    description:
      'Run a stakeholder challenge session against an existing assessment. ' +
      'Generates critical questions a given stakeholder would ask about the migration findings.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: {
          type: 'string',
          description: 'Application identifier',
        },
        workspace_path: {
          type: 'string',
          description: 'Absolute path to the portfolio workspace root',
        },
        agent: {
          type: 'string',
          enum: ['technical', 'exec', 'compliance', 'finops', 'migration-manager'],
          description: 'Stakeholder perspective. Default: technical.',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'swao_ingest',
    description:
      'Capture a file into an application\'s ingestion/<category>/ directory so Pass 00 ' +
      '(SHA-256 delta, binary extraction) processes it on the next assessment run. ' +
      'Prefer source_path for binary or large files; use content for inline text. ' +
      'Valid categories: architecture, compliance, operations, workshops, structured, ' +
      'terraform, docs, intake, other, source, catalogs, yara-rules, checklists, ' +
      'evidence, interviews, cmdb.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: {
          type: 'string',
          description: 'Application identifier (matches folder name under portfolio/apps/)',
        },
        workspace_path: {
          type: 'string',
          description: 'Absolute path to the portfolio workspace root (contains .swao.yml)',
        },
        category: {
          type: 'string',
          description: 'Ingestion subfolder (e.g. architecture, evidence, compliance). ' +
            'Must not contain path separators.',
        },
        filename: {
          type: 'string',
          description: 'Target filename (e.g. arch-review.md, gdpr-assessment.pdf). ' +
            'Must not contain path separators.',
        },
        content: {
          type: 'string',
          description: 'Text content to write (use for inline markdown/YAML/plain text).',
        },
        source_path: {
          type: 'string',
          description: 'Absolute path to a local file to copy into ingestion/ ' +
            '(preferred for binary/large files).',
        },
      },
      required: ['app_id', 'category', 'filename'],
    },
  },
  {
    name: 'swao_evidence_capture',
    description:
      'Capture a structured evidence record linked to specific signal/control IDs. ' +
      'Writes a YAML record + markdown protocol to ingestion/evidence/ and an ' +
      'optional chat-log to feedback/chatlogs/. Pass 00 + derive fold it into ' +
      'wsp-evidence.yaml on the next assessment run. ' +
      'Addresses are validated against the current run\'s signals and controls.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: {
          type: 'string',
          description: 'Application identifier (matches folder name under portfolio/apps/)',
        },
        workspace_path: {
          type: 'string',
          description: 'Absolute path to the portfolio workspace root (contains .swao.yml)',
        },
        addresses: {
          type: 'array',
          items: { type: 'string' },
          description: 'Signal or control IDs this evidence addresses (e.g. ["CRYPTO-05", "GDPR_Art_32"]).',
        },
        statement: {
          type: 'string',
          description: 'Human-readable summary of what this evidence proves or disproves.',
        },
        type: {
          type: 'string',
          description: 'Evidence type: static_analysis, cmdb, finops, incident, ops_runbook, ' +
            'workshop, architecture_doc, apm, other.',
        },
        author: {
          type: 'string',
          description: 'Who captured this evidence (e.g. email address or name).',
        },
        chat_log: {
          type: 'string',
          description: 'Full chat transcript to store as supporting log. ' +
            'Redaction runs during ingestion pipeline processing.',
        },
      },
      required: ['app_id', 'addresses', 'statement', 'type'],
    },
  },
  {
    name: 'swao_risk_import',
    description:
      'Use this when the user uploads or references an Excel spreadsheet, CSV file, or YAML ' +
      'file with risk remediation data, closure confirmations, or override decisions. ' +
      'This is the correct tool for importing a filled-in signal remediation register. ' +
      'Do NOT use swao_import or swao_ingest for Excel/binary files -- they accept text only. ' +
      'Accepts xlsx (columns: risk_id, app_id, category, likelihood, impact, trigger, mitigation, owner), ' +
      'csv (same column order), or yaml (WspRiskImportOverlay schema). ' +
      'Prefer source_path for binary files (xlsx); pass content for text formats (csv/yaml). ' +
      'Writes to apps/<app>/ingestion/structured/risk-register-import.yaml. ' +
      'On the next assessment run, derive-plan merges this overlay into the generated plan ' +
      '(overlay rows win on status/evidence_ids/closed_rationale/closed_at per Design 080 S5.3).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: {
          type: 'string',
          description: 'Application identifier (matches folder name under portfolio/apps/)',
        },
        workspace_path: {
          type: 'string',
          description: 'Absolute path to the portfolio workspace root (contains .swao.yml)',
        },
        source_path: {
          type: 'string',
          description: 'Absolute path to the xlsx/csv/yaml file to import. Preferred for binary (xlsx).',
        },
        content: {
          type: 'string',
          description: 'File content as a string. Use for csv or yaml; use source_path for xlsx.',
        },
        format: {
          type: 'string',
          enum: ['xlsx', 'csv', 'yaml'],
          description: 'Import format. Required.',
        },
      },
      required: ['app_id', 'format'],
    },
  },
  {
    name: 'swao_feedback_add',
    description:
      'Record an attributed human override on a machine verdict. Writes to ' +
      'apps/<app>/feedback/overrides.yaml; applied on the next assessment run ' +
      '(machine_outcome preserved beside the override per Design 080 §5.4, C5). ' +
      'Author is required -- pass author param or set SWAO_OPERATOR env; no anonymous overrides.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id:           { type: 'string', description: 'Application identifier.' },
        workspace_path:   { type: 'string', description: 'Absolute path to workspace root.' },
        target_type:      { type: 'string', enum: ['control', 'risk', 'signal'], description: 'Type of artefact being overridden.' },
        target_id:        { type: 'string', description: 'ID of the control, risk, or signal.' },
        override_outcome: { type: 'string', description: 'New verdict to apply (e.g. SATISFIED, closed).' },
        rationale:        { type: 'string', description: 'Reason for the override (required, auditable).' },
        author:           { type: 'string', description: 'Author identity (role + name). Falls back to SWAO_OPERATOR env.' },
        role:             { type: 'string', description: 'Author role label (optional).' },
        evidence_ids:     { type: 'array', items: { type: 'string' }, description: 'Evidence IDs supporting the override.' },
      },
      required: ['app_id', 'target_type', 'target_id', 'override_outcome', 'rationale'],
    },
  },
  {
    name: 'swao_annotate',
    description:
      'Add a non-verdict comment on a control, risk, or signal. ' +
      'Writes to apps/<app>/feedback/annotations.yaml. Author required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id:         { type: 'string', description: 'Application identifier.' },
        workspace_path: { type: 'string', description: 'Absolute path to workspace root.' },
        target_type:    { type: 'string', description: 'Type of artefact being annotated.' },
        target_id:      { type: 'string', description: 'ID of the control, risk, or signal.' },
        text:           { type: 'string', description: 'Annotation text.' },
        author:         { type: 'string', description: 'Author identity. Falls back to SWAO_OPERATOR env.' },
      },
      required: ['app_id', 'target_type', 'target_id', 'text'],
    },
  },
  {
    name: 'swao_feedback_list',
    description:
      'List all overrides and annotations recorded for an app ' +
      '(reads apps/<app>/feedback/overrides.yaml + annotations.yaml).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id:         { type: 'string', description: 'Application identifier.' },
        workspace_path: { type: 'string', description: 'Absolute path to workspace root.' },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'swao_import',
    description:
      '[Deprecated -- use swao_ingest] ' +
      'Stage a context file into an application\'s wsp/inputs/ directory. ' +
      'Pass 04 (Context Ingestion) reads these files during assessment to detect ' +
      'contradictions between stated architecture and code reality.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: {
          type: 'string',
          description: 'Application identifier (matches folder name under portfolio/apps/)',
        },
        workspace_path: {
          type: 'string',
          description: 'Absolute path to the portfolio workspace root (contains .swao.yml)',
        },
        filename: {
          type: 'string',
          description: 'Target filename (e.g. cmdb.yaml, architecture-review.md). Must not contain path separators.',
        },
        content: {
          type: 'string',
          description: 'File content to write into the wsp/inputs/ directory.',
        },
      },
      required: ['app_id', 'filename', 'content'],
    },
  },
  {
    name: 'swao_signal_detail',
    description:
      'Return the full detail for a specific assessment signal: complete derivation text (never truncated), ' +
      'all evidence file paths with line numbers, severity, and confidence. ' +
      'Use this to answer "what exactly did SWAO find for DATA-03?" or ' +
      '"what code evidence backs up CRYPTO-01?"',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: { type: 'string', description: 'Application identifier' },
        signal_id: { type: 'string', description: 'Signal ID to look up (e.g. "DATA-03", "CRYPTO-01")' },
        workspace_path: { type: 'string', description: 'Absolute path to portfolio workspace root' },
      },
      required: ['app_id', 'signal_id'],
    },
  },
  {
    name: 'swao_signals',
    description:
      'List all assessment signals for an application, sorted by severity. ' +
      'Returns complete derivation text and evidence for every signal -- no truncation. ' +
      'Use this to see everything SWAO found, not just the top 3 findings in the report. ' +
      'Optionally filter to specific signal prefixes (DATA, CRYPTO, EGR, SBOM, STATE, etc.).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: { type: 'string', description: 'Application identifier' },
        workspace_path: { type: 'string', description: 'Absolute path to portfolio workspace root' },
        prefix_filter: {
          type: 'string',
          description: 'Comma-separated signal prefixes to include (e.g. "DATA,CRYPTO"). Omit for all.',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'swao_explain_landing_zone',
    description:
      'Explain how the landing zone was selected for an application. ' +
      'Returns all evaluated cloud providers ranked by fit score, the scoring weights applied, ' +
      'which providers were disqualified and why (e.g. BSI C5 not attested), ' +
      'and the constraints derived from assessment signals. ' +
      'Use this to answer "why was provider X chosen?" or "why was Y disqualified?"',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: {
          type: 'string',
          description: 'Application identifier',
        },
        workspace_path: {
          type: 'string',
          description: 'Absolute path to the portfolio workspace root',
        },
      },
      required: ['app_id'],
    },
  },
  // #0258 -- audit-grade deep-dive tools. Each closes a row in the
  // MCP coverage matrix (Q2 / Q3 / Q6 / Q7 / Q9 of the Sprint 028 audit).
  {
    name: 'swao_control_detail',
    description:
      'Return the assessed verdict for a specific compliance control from the latest assessment run: ' +
      'outcome (SATISFIED / PARTIAL / GAP / UNKNOWN / N_A), regime, severity, rationale, ' +
      'remediation, the signals that back it, and the evidence IDs that support it. ' +
      'Requires a completed assessment run (wsp-plan.yaml must exist). ' +
      'For a static listing of framework controls without a prior assessment, use swao_control_catalogue. ' +
      'Use to answer "why is GDPR_Art_32 marked PARTIAL?" or "what evidence backs BSI_C5_OPS-04?"',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: { type: 'string', description: 'Application identifier' },
        control_id: { type: 'string', description: 'Control identifier (e.g. BSI_C5_OPS-04, GDPR_Art_32)' },
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root' },
      },
      required: ['app_id', 'control_id'],
    },
  },
  {
    name: 'swao_costs',
    description:
      'Return the per-pass cost breakdown for the latest assessment run: tokens_in / ' +
      'tokens_out / cost_usd per pass plus run totals. Use to answer "how much did this ' +
      'cost?" or "which pass dominates the bill?"',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: { type: 'string', description: 'Application identifier' },
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root' },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'swao_risks',
    description:
      'List the risk register entries for an application: risk_id, category, likelihood, ' +
      'impact, trigger, mitigation, owner. Sorted by impact (critical / high / medium / low) ' +
      'unless sort_by overrides. Use to answer "what are the top risks?"',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: { type: 'string', description: 'Application identifier' },
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root' },
        sort_by: {
          type: 'string',
          enum: ['impact', 'likelihood', 'id'],
          description: 'Sort order. Default: impact (critical -> low).',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'swao_portfolio_summary',
    description:
      'Compare 7R verdicts, modernization_position, coverage_score, and portability_score ' +
      'across every app in the workspace portfolio. Returns one row per assessed app. Use to ' +
      'answer "which app is furthest along?" or "show me the portfolio at a glance".',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root' },
      },
      required: [],
    },
  },
  {
    name: 'swao_lzr_weights',
    description:
      'Return the landing zone readiness weights used during the latest run plus the ' +
      'BSI C5 / GDPR / DORA attestation status of each candidate landing zone. Use to ' +
      'answer "why was this landing zone chosen?" or "what does the LZR scoring look like?"',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id: {
          type: 'string',
          description: 'Application identifier. Omit to read portfolio-level LZR run.',
        },
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root' },
      },
      required: [],
    },
  },
  {
    name: 'swao_portfolio_query',
    description:
      'Faceted query over the portfolio index. Filters by 7R label, minimum coverage score, ' +
      'or LZ verdict. Returns a table of matching apps. Requires portfolio-index.json ' +
      '(built by swao export --portfolio). Design 080 §6.2.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root' },
        filters: {
          type: 'object',
          description: 'Optional filter object. Keys: seven_r (string[]), min_coverage (number 0..1), lz_verdict (string[])',
        },
      },
      required: [],
    },
  },
  {
    name: 'swao_portfolio_stats',
    description:
      'Distribution statistics for the full portfolio: 7R mix, coverage p50/p75/p90, ' +
      'portability p50, risk rollup totals, LZ verdict distribution. ' +
      'Requires portfolio-index.json. Design 080 §6.2.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root' },
      },
      required: [],
    },
  },
  {
    name: 'swao_portfolio_risks',
    description:
      'Cross-app risk rollup from the portfolio index: open, closed, and high-impact risk ' +
      'counts per app, sorted by open risks descending. Filter with min_high_count. ' +
      'Requires portfolio-index.json. Design 080 §6.2.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root' },
        min_high_count: { type: 'number', description: 'Only show apps with at least this many high-impact open risks' },
      },
      required: [],
    },
  },
  {
    name: 'swao_portfolio_lz',
    description:
      'Landing zone readiness rollup across all apps. Reads lzr-summary.json (from portfolio ' +
      'LZR run) when present; falls back to lz_verdict in portfolio-index.json. ' +
      'Design 080 §6.2.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root' },
      },
      required: [],
    },
  },
  {
    name: 'swao_publish',
    description:
      'Generate a SWAO Assessment Publication for one application. ' +
      'Mode A (default): produces a self-contained single-file HTML. ' +
      'Mode B (--site): produces a multi-page static site directory. ' +
      'Returns the output path on success.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id:         { type: 'string', description: 'Application ID to publish.' },
        workspace_path: { type: 'string', description: 'Absolute workspace path (optional; defaults to cwd).' },
        mode:           { type: 'string', enum: ['html', 'site', 'headless'], description: 'html=Mode A single-file, site=Mode B multi-page, headless=JSON only. Default: html.' },
        lang:           { type: 'string', description: 'Output language: en (default) or de.' },
        block_profile:  { type: 'string', enum: ['application', 'lz-catalog', 'hub'], description: 'Override block profile (#0793). Defaults to the profile auto-detected from the run type.' },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'swao_publish_site',
    description:
      'Generate a SWAO multi-page static site (Mode B) for one application. ' +
      'Returns the output directory path on success.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id:         { type: 'string' },
        workspace_path: { type: 'string' },
        lang:           { type: 'string', description: 'en (default) or de.' },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'swao_hub',
    description:
      'Generate a SWAO Engagement Hub page. Without app_id: generates workspace-level ' +
      'apps/engagement-hub.html listing all apps with their publications. With app_id: ' +
      'generates apps/<id>/wsp/publications/engagement-hub.html for a single app. (#0795)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id:         { type: 'string', description: 'Optional app ID. Omit for workspace-level hub.' },
        workspace_path: { type: 'string', description: 'Absolute workspace path (optional; defaults to cwd).' },
      },
      required: [],
    },
  },
  {
    name: 'swao_lenses',
    description:
      'List available SWAO Prism assessment lenses and show which are active in the workspace. ' +
      'Use action="add" to activate a lens, action="set" to replace all, action="remove" to deactivate one.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_path: { type: 'string' },
        action: {
          type: 'string',
          enum: ['list', 'add', 'set', 'remove'],
          description: 'list (default): show all lenses; add/set/remove: modify active lenses.',
        },
        lens_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lens IDs to add/set/remove (e.g. ["cloud-migration", "security-focus"]).',
        },
      },
      required: [],
    },
  },
  {
    name: 'swao_normalize',
    description:
      'Preview the SWAO Input Normalizer classification for files in wsp/intake/. ' +
      'Always runs in dry-run mode via MCP (file writes require the CLI). ' +
      'Returns a classification table showing what would happen to each file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_path: { type: 'string' },
        app_id:         { type: 'string', description: 'Normalize one app\'s intake (optional; omit for portfolio-level).' },
      },
      required: [],
    },
  },
  {
    name: 'swao_portal_query',
    description:
      'Query the SWAO Live Portal REST API (requires the portal to be running via swao publish --serve). ' +
      'Returns JSON from GET /api/v1/<endpoint>.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        endpoint:   { type: 'string', description: 'API endpoint path, e.g. "apps" or "apps/sovereign-health/signals".' },
        portal_url: { type: 'string', description: 'Portal base URL. Default: http://localhost:4000.' },
        token:      { type: 'string', description: 'Bearer token for authenticated endpoints (optional).' },
      },
      required: ['endpoint'],
    },
  },
  // swao_audit_* tools removed at #1435: the audit assessment surface
  // (including the `swao audit` CLI command group they wrapped) was
  // deleted at #1434; a tool that always errors is worse than no tool.
  {
    name: 'swao_lz_catalogue',
    description:
      'List the bundled landing-zone CSP service catalogues, or show one provider\'s regions, ' +
      'sovereignty facts, and services (Design 056). Read-only. action="list" (default) or ' +
      'action="show" with a provider id (aws, azure, stackit, ...).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['list', 'show'], description: 'list (default) or show.' },
        provider: { type: 'string', description: 'Provider id for action=show (e.g. aws, azure, stackit).' },
        workspace_path: { type: 'string' },
      },
      required: [],
    },
  },
  // #0596 (sprint-073): separate swao_lz_* tools for clear CLI/MCP parameter-schema parity.
  {
    name: 'swao_lz_catalogue_list',
    description:
      'List all bundled landing-zone CSP service catalogues (Design 056). ' +
      'Returns provider names and available regions. Read-only.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_path: { type: 'string', description: 'Absolute path to the workspace root (optional).' },
      },
      required: [],
    },
  },
  {
    name: 'swao_lz_catalogue_show',
    description:
      'Show a specific provider\'s landing-zone catalogue: regions, sovereignty facts, and available services ' +
      '(Design 056). Read-only.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', description: 'Provider id (e.g. aws, azure, stackit, ovh, hetzner).' },
        workspace_path: { type: 'string' },
      },
      required: ['provider'],
    },
  },
  {
    name: 'swao_lz_fit',
    description:
      'Fit an app\'s assessment against a landing-zone catalogue region. ' +
      'Scores the app\'s sovereignty requirements against the provider\'s sovereign-by-default ' +
      'service availability for that region (Design 056). Returns a fit verdict.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_id:         { type: 'string', description: 'Application ID (matches folder name under apps/).' },
        provider:       { type: 'string', description: 'CSP provider id (e.g. aws, azure, stackit).' },
        region:         { type: 'string', description: 'Region id within the provider catalogue.' },
        workspace_path: { type: 'string' },
      },
      required: ['app_id', 'provider', 'region'],
    },
  },
  // Phase 1 read-only tools -- Design 080 §4.1 (#1175)
  {
    name: 'swao_frameworks_list',
    description:
      'List all compliance frameworks SWAO knows about -- also called community frameworks, ' +
      'regulatory frameworks, assessment frameworks, compliance standards, or rules. ' +
      'ALWAYS call this tool when the user asks "what frameworks does SWAO support?", ' +
      '"what regulations can you assess?", "what compliance standards are available?", ' +
      '"show me the frameworks", or any similar question. ' +
      'IMPORTANT: this tool always returns the full set of SWAO bundled frameworks ' +
      '(GDPR, BSI C5, ISO 27001, NIST SP 800-66 R2, and others) regardless of workspace ' +
      'catalogue state -- do NOT skip this call because the health check reported no workspace catalogs. ' +
      'Pass workspace_path to additionally include any workspace-installed custom frameworks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root (optional; includes workspace custom frameworks when provided).' },
      },
      required: [],
    },
  },
  {
    name: 'swao_framework_detail',
    description:
      'Show the full regime metadata and complete control list for a single compliance framework ' +
      '(also called a regulatory framework, assessment framework, or community framework). ' +
      'Returns name, version, authority, description, applicability hints, and all controls with severity. ' +
      'Use swao_frameworks_list first to discover available framework IDs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        framework_id:   { type: 'string', description: 'Framework identifier (e.g. GDPR, ISO_27001, NIST_SP_800_66R2).' },
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root (optional; workspace frameworks take precedence over bundled).' },
      },
      required: ['framework_id'],
    },
  },
  {
    name: 'swao_control_catalogue',
    description:
      'List or look up compliance controls from the bundled framework registry. ' +
      'Does NOT require a completed assessment run -- reads the source catalogue directly. ' +
      'Use this to enumerate controls for any framework (GDPR, BSI C5, NIST, ISO 27001, etc.) ' +
      'without needing a prior assessment. Also use for "show GDPR controls", ' +
      '"what controls does BSI C5 have?", or "list compliance controls for NIST". ' +
      'Returns control title, severity, description, remediation guidance, and tags. ' +
      'For the assessed verdict of a specific control against an app run, use swao_control_detail.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        control_id:     { type: 'string', description: 'Control identifier (e.g. GDPR_ART-5-1-A, ISO27001_A.5.1).' },
        framework_id:   { type: 'string', description: 'Narrow the search to a specific framework (optional).' },
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root (optional).' },
      },
      required: ['control_id'],
    },
  },
  {
    name: 'swao_passes',
    description:
      'Always call this tool when the user asks what passes SWAO runs, how many passes ' +
      'there are, or what each pass does. Returns the live authoritative pass list from ' +
      'the binary -- do not answer from training data as the pass list changes between ' +
      'releases. Returns the full ordered list of default pass names and the total pass count.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'swao_cloud_provider_catalogue',
    description:
      'Show cloud provider facts from the Design-012 CSP catalogue: sovereign score, ' +
      'cost tier, vendor lock-in risk, data residency guarantees, and compliance regime coverage. ' +
      'Optionally filter by provider ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', description: 'Provider ID to filter by (e.g. aws-esc, azure, gcp). Omit to list all.' },
      },
      required: [],
    },
  },
  {
    name: 'swao_workspace_inventory',
    description:
      'Return a structured inventory of the workspace: registered apps, their context ' +
      'file counts (ingested documents and staged inputs), installed compliance framework ' +
      'names, and run history. ' +
      'ALWAYS call this tool when the user asks: "what is in my workspace?", ' +
      '"what apps do I have?", "what context files exist for <app>?", ' +
      '"what evidence has been imported?", "what documents has SWAO processed?", ' +
      '"what ingested data exists?", "show me my workspace structure", ' +
      '"what files are in the workspace?", "what has been imported or ingested?". ' +
      'Do NOT suggest terminal commands or PowerShell scripts when you can call this tool instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_path: { type: 'string', description: 'Absolute path to the portfolio workspace root.' },
      },
      required: [],
    },
  },
] as const;

type ToolInput = Record<string, unknown>;

function resolveWorkspace(input: ToolInput): string | undefined {
  if (input.workspace_path) return String(input.workspace_path);
  const detected = findWorkspace(process.cwd());
  if (detected) return detected;
  if (mcpPinnedWorkspace) return mcpPinnedWorkspace;
  return undefined;
}

// (The old synchronous _handleAssess was removed in the #0574 cleanup -- the
// swao_assess tool dispatches handleAssessWithProgress below; the sync path had
// no caller. Surfaced by noUnusedLocals.)

// ---------------------------------------------------------------------------
// Async assess with MCP progress notifications (#0155)
// ---------------------------------------------------------------------------

const TOTAL_PASSES = TOTAL_DEFAULT_PASSES;
const ASSESS_TIMEOUT_MS = 300_000;

const PASS_START_REGEX = /\[info\]\s+Running\s+Pass\s+(\d+)\s+--\s+(\w+)/;
const PASS_OK_REGEX = /\[ok\]\s+Pass\s+(\d+)\s+--\s+(\w+)/;
const PASS_FAIL_REGEX = /\[fail\]\s+Pass\s+(\d+)\s+--\s+(\w+)/;

export interface AssessProgressEvent {
  progress: number;
  total: number;
  message: string;
}

export interface AssessProgressNotifier {
  (event: AssessProgressEvent): void;
}

/**
 * Parse a chunk of assess stdout and return zero-or-more progress events to
 * notify. Pure function so it can be unit-tested without spawning a child.
 *
 * - Counts completed passes from `[ok] Pass NN -- name` lines.
 * - Emits a "running" event for each `[info] Running Pass NN -- name` line.
 * - Emits a "complete" event for each `[ok]` line, with progress = passCountAfter/TOTAL.
 * - Emits a "failed" event for each `[fail]` line; progress unchanged.
 */
export function parseAssessProgress(
  chunk: string,
  passCountBefore: number,
): { events: AssessProgressEvent[]; passCountAfter: number } {
  let count = passCountBefore;
  const events: AssessProgressEvent[] = [];
  for (const line of chunk.split(/\r?\n/)) {
    const failMatch = line.match(PASS_FAIL_REGEX);
    if (failMatch) {
      events.push({
        progress: count / TOTAL_PASSES,
        total: 1,
        message: `Pass ${failMatch[1]} (${failMatch[2]}) FAILED`,
      });
      continue;
    }
    const okMatch = line.match(PASS_OK_REGEX);
    if (okMatch) {
      count += 1;
      events.push({
        progress: count / TOTAL_PASSES,
        total: 1,
        message: `Pass ${okMatch[1]} (${okMatch[2]}) complete`,
      });
      continue;
    }
    const startMatch = line.match(PASS_START_REGEX);
    if (startMatch) {
      events.push({
        progress: count / TOTAL_PASSES,
        total: 1,
        message: `Running Pass ${startMatch[1]} -- ${startMatch[2]}...`,
      });
    }
  }
  return { events, passCountAfter: count };
}

export interface AssessAcknowledgement {
  appId: string;
  startedAt: string;
  passes: string;
}

export function buildAssessAcknowledgement(
  appId: string,
  passes: string | undefined,
): string {
  const passList = passes && passes.trim().length > 0
    ? passes
    : DEFAULT_PASS_NAMES.join(', ');
  const startedAt = new Date().toISOString();
  return [
    `Assessment started for "${appId}" at ${startedAt}`,
    `Running passes: ${passList}`,
    '-----------------------------------------------------------------',
  ].join('\n');
}

/**
 * Run `swao assess` as an async child process. Parses stdout for per-pass
 * progress markers and invokes the notifier when one is supplied.
 *
 * Behaviour parity with `runSwao`:
 * - Same args, same cwd, same env (plus SWAO_MCP_CONTEXT=1).
 * - Same 300 s timeout.
 * - Returns the joined stdout/stderr exactly as `handleAssess` did.
 */
export function runSwaoAssessAsync(
  args: string[],
  cwd: string | undefined,
  notifier: AssessProgressNotifier | null,
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  return new Promise((resolveOuter) => {
    const { cmd, cmdArgs } = resolveSpawn(hostDeps, args);

    const child = spawn(cmd, cmdArgs, {
      cwd: cwd ?? process.cwd(),
      // PKG_EXECPATH: '' prevents the pkg spawn-patch from injecting the
      // parent binary path into the child (#0807-P3 -- see runSwao comment).
      env: { ...process.env, SWAO_MCP_CONTEXT: '1', PKG_EXECPATH: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let passCount = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, ASSESS_TIMEOUT_MS);

    child.stdout?.setEncoding('utf-8');
    child.stderr?.setEncoding('utf-8');

    child.stdout?.on('data', (chunk: string) => {
      stdoutChunks.push(chunk);
      if (notifier) {
        const { events, passCountAfter } = parseAssessProgress(chunk, passCount);
        passCount = passCountAfter;
        for (const ev of events) {
          try { notifier(ev); }
          catch { /* notifier errors must not affect the assess flow */ }
        }
      }
    });
    child.stderr?.on('data', (chunk: string) => { stderrChunks.push(chunk); });

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = stdoutChunks.join('');
      const stderrRaw = stderrChunks.join('');
      const stderr = timedOut
        ? `${stderrRaw}${stderrRaw && !stderrRaw.endsWith('\n') ? '\n' : ''}[error] swao assess timed out after ${ASSESS_TIMEOUT_MS / 1000}s\n`
        : stderrRaw;
      resolveOuter({ stdout, stderr, ok: !timedOut && code === 0 });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      stderrChunks.push(`spawn error: ${err.message}`);
      resolveOuter({ stdout: stdoutChunks.join(''), stderr: stderrChunks.join(''), ok: false });
    });
  });
}

/**
 * MCP-aware assess handler. When `notifier` is non-null, emits one
 * progress event per pass start and one per pass completion. When null,
 * behaves identically to the synchronous `handleAssess` path -- no
 * regression for callers that do not provide a `progressToken`.
 */
export async function handleAssessWithProgress(
  input: ToolInput,
  notifier: AssessProgressNotifier | null,
): Promise<string> {
  const appId = String(input.app_id ?? '');
  const workspace = resolveWorkspace(input);
  const passes = input.passes ? String(input.passes) : undefined;
  const passesArgs = passes ? ['--passes', passes] : [];
  const assessmentType = input.assessment_type ? String(input.assessment_type) : undefined;
  const typeArgs = assessmentType ? ['--type', assessmentType] : [];
  const lzCatTargets = input.lz_cat_targets ? String(input.lz_cat_targets) : undefined;
  const lzTargetsArgs = lzCatTargets ? ['--lz-cat-targets', lzCatTargets] : [];
  const args = ['assess', '--app', appId, ...passesArgs, ...typeArgs, ...lzTargetsArgs];

  const ack = buildAssessAcknowledgement(appId, passes);

  const r = await runSwaoAssessAsync(args, workspace, notifier);
  if (!r.ok && !r.stdout) {
    return `${ack}\nAssessment failed.\n${r.stderr}`.trim();
  }
  return [ack, r.stdout, r.stderr ? `[stderr]\n${r.stderr}` : ''].filter(Boolean).join('\n').trim();
}

// ---------------------------------------------------------------------------
// Landing zone explanation tool
// ---------------------------------------------------------------------------


function handleExplainLandingZone(input: ToolInput): string {
  const appId = String(input.app_id ?? '');
  const workspace = resolveWorkspace(input);
  if (!workspace) return 'Error: workspace_path required (or run from within a SWAO workspace).';

  const runDir = resolveLatestRunDir(workspace, appId, 'latest-application.txt');
  if (!runDir) return `No completed assessment found for "${appId}". Run swao_assess first.`;

  const synthFile = join(runDir, 'passes', '09-synth.yaml');
  if (!existsSync(synthFile)) {
    return `No synthesis pass (09-synth.yaml) found in the latest run for "${appId}".\nRun swao_assess without --passes to include synthesis (pass 09).`;
  }

  // Read configured lz_targets from run-context.yaml (ground truth for this run).
  let configuredTargets: string[] = [];
  const runContextFile = join(runDir, 'run-context.yaml');
  if (existsSync(runContextFile)) {
    try {
      const ctx = load(readFileSync(runContextFile, 'utf-8')) as Record<string, unknown>;
      const raw_targets = ctx['lz_targets'];
      if (Array.isArray(raw_targets)) {
        configuredTargets = raw_targets.map(String);
      }
    } catch { /* non-fatal */ }
  }

  try {
    const raw = readFileSync(synthFile, 'utf-8');

    // Extract assessment block fields
    const lzMatch       = raw.match(/^\s{2}landing_zone:\s+(\S+)/m);
    const confMatch     = raw.match(/^\s{2}landing_zone_recommendation_confidence:\s+(\S+)/m);
    const sevenRMatch   = raw.match(/^\s{2}seven_r_label:\s+(\S+)/m);
    const recMatch      = raw.match(/^\s{2}recommended_landing_zone:\s+(\S+)/m);
    const lzrVerdict    = raw.match(/^\s{4}verdict:\s+(\S+)/m);
    const lzrNote       = raw.match(/^\s{4}note:\s+"?(.+)"?$/m);

    const recommendedLz    = recMatch?.[1]    ?? lzMatch?.[1]    ?? 'unknown';
    const confidence        = confMatch?.[1]  ?? 'unknown';
    const sevenR            = sevenRMatch?.[1] ?? 'unknown';

    const lines: string[] = [
      `Landing Zone Selection -- ${appId}`,
      '='.repeat(`Landing Zone Selection -- ${appId}`.length),
    ];

    if (configuredTargets.length > 0) {
      lines.push(`Configured targets (run-context.yaml):`);
      for (const t of configuredTargets) lines.push(`  - ${t}`);
    } else {
      lines.push('Configured targets: not recorded in run-context.yaml');
    }

    lines.push(
      `Recommended:   ${recommendedLz}`,
      `Confidence:    ${confidence}`,
      `7R verdict:    ${sevenR}`,
    );

    if (lzrVerdict?.[1]) {
      lines.push(`LZR check:     ${lzrVerdict[1]}${lzrNote?.[1] ? ` -- ${lzrNote[1].trim().replace(/^"|"$/g, '')}` : ''}`);
    }

    // Extract and render landing_zone_candidates block
    const candidatesSection = raw.match(/landing_zone_candidates:([\s\S]*?)(?=\n\w|\n {2}[a-z_]+: [^[]|\n {2}recommended_landing_zone|\n {2}lzr_adjustment|$)/);
    if (candidatesSection) {
      lines.push('', 'Candidates (ranked by fit score)');
      lines.push('-'.repeat(33));

      const candidateBlocks = candidatesSection[1].split(/\n {2}- /).slice(1);
      let rank = 1;
      for (const block of candidateBlocks) {
        const idM        = block.match(/id:\s+(\S+)/);
        const nameM      = block.match(/name:\s+"?([^"\n]+)"?/);
        const scoreM     = block.match(/fit_score:\s+([0-9.]+)/);
        const disqM      = block.match(/disqualified:\s+(true|false)/);
        const disqReason = block.match(/disqualification_reason:\s+"?([^"\n]+)"?/);
        const rationaleM = block.match(/rationale:\s+(.+)/);
        const certsM     = block.match(/certifications_matched:\s*\[([^\]]*)\]/);
        const gapsM      = block.match(/service_gaps:\s*\[([^\]]*)\]/);
        const lockInM    = block.match(/overall_lock_in_risk:\s+(\S+)/);

        const id         = idM?.[1]        ?? 'unknown';
        const name       = nameM?.[1]      ?? id;
        const score      = scoreM?.[1]     ?? '--';
        const disqualified = disqM?.[1] === 'true';
        const rationale  = rationaleM?.[1] ?? '';
        const certs      = certsM?.[1]?.split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean) ?? [];
        const gaps       = gapsM?.[1]?.split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean) ?? [];
        const lockIn     = lockInM?.[1]    ?? '--';

        const status = disqualified ? 'DISQUALIFIED' : (id === recommendedLz ? 'RECOMMENDED' : '');
        const scoreLine = disqualified ? '' : `  fit ${score}`;
        lines.push('');
        lines.push(`  ${rank}. ${name.trim()}${scoreLine}  ${status}`);
        if (disqualified && disqReason?.[1]) {
          lines.push(`     Disqualified: ${disqReason[1].trim().replace(/^"|"$/g, '')}`);
        } else if (rationale) {
          lines.push(`     ${rationale.trim()}`);
        }
        if (certs.length > 0) lines.push(`     Certifications:    ${certs.join(', ')}`);
        if (gaps.length > 0)  lines.push(`     Service gaps:      ${gaps.join(', ')}`);
        if (!disqualified)    lines.push(`     Lock-in risk:      ${lockIn}`);
        // meshStack delivery readiness (not part of fit score)
        const msMatch = block.match(/meshstack_integration:([\s\S]*?)(?=\n {4}\w|\n {2}- |$)/);
        if (msMatch) {
          const msSupported = msMatch[1].match(/supported:\s+(true|false)/)?.[1];
          const msBBs       = msMatch[1].match(/building_blocks:\s*\[([^\]]*)\]/)?.[1];
          const msNote      = msMatch[1].match(/note:\s+"?([^"\n]+)"?/)?.[1];
          const msLabel     = msSupported === 'true' ? 'yes' : 'no';
          const bbList      = msBBs ? ` (${msBBs.split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean).join(', ')})` : '';
          lines.push(`     meshStack delivery: ${msLabel}${bbList}${msNote ? ` -- ${msNote.trim()}` : ''}`);
        }
        rank++;
      }
    }

    // Weights note
    lines.push('');
    lines.push('Fit score weights (sovereignty-first)');
    lines.push('-'.repeat(37));
    lines.push('  sovereign_score:  0.50   (sovereignty strength, BSI C5, jurisdiction)');
    lines.push('  service_coverage: 0.35   (required services available on provider)');
    lines.push('  portability:      0.10   (open standards, low proprietary surface)');
    lines.push('  cost_tier:        0.05   (relative cost vs hyperscaler EU pricing)');
    lines.push('');
    lines.push('Note: meshStack integration is listed separately under each provider');
    lines.push('      as delivery readiness -- it does not affect the fit score.');
    lines.push('');
    lines.push(`Source: ${synthFile}`);

    return lines.join('\n');
  } catch (e) {
    return `Error parsing landing zone data: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ---------------------------------------------------------------------------
// Signal detail and listing tools
// ---------------------------------------------------------------------------

interface RawPassSignal {
  id?: string;
  severity?: string;
  outcome?: string;
  derivation?: string;
  evidence?: unknown;
  confidence?: unknown;
}

function loadAllSignals(runDir: string): Array<RawPassSignal & { _file: string }> {
  const passesDir = join(runDir, 'passes');
  if (!existsSync(passesDir)) return [];
  const results: Array<RawPassSignal & { _file: string }> = [];
  for (const file of readdirSync(passesDir).filter(f => f.endsWith('.yaml')).sort()) {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = load(readFileSync(join(passesDir, file), 'utf-8')) as Record<string, unknown>;
    } catch { continue; }
    if (!parsed || !Array.isArray(parsed['signals'])) continue;
    for (const s of (parsed['signals'] as RawPassSignal[])) {
      if (s.id) results.push({ ...s, _file: file });
    }
  }
  return results;
}

function formatSignalBlock(s: RawPassSignal & { _file: string }): string[] {
  const lines: string[] = [
    `Signal:     ${s.id}`,
    `Severity:   ${s.severity ?? '--'}`,
    // Confidence is a string ('high' | 'medium' | 'low') in v0.10+ schemas
    // and a number (0-1) in legacy fixtures. Render either; '--' only when
    // genuinely missing. Before #0265 the string case fell through to '--'
    // because of the strict typeof check.
    `Confidence: ${typeof s.confidence === 'number' ? s.confidence.toFixed(2) : (typeof s.confidence === 'string' && s.confidence.length > 0 ? s.confidence : '--')}`,
    `Pass file:  ${s._file}`,
    '',
    'Derivation',
    '----------',
    (s.derivation ?? '(none)').trim(),
    '',
  ];
  const evArr = Array.isArray(s.evidence) ? (s.evidence as unknown[]).map(String) : [];
  if (evArr.length > 0) {
    lines.push('Evidence');
    lines.push('--------');
    for (const ev of evArr) lines.push(`  - ${ev.trim()}`);
    lines.push('');
  }
  return lines;
}

function handleSignalDetail(input: ToolInput): string {
  const appId    = String(input.app_id ?? '');
  const signalId = String(input.signal_id ?? '').toUpperCase();
  const workspace = resolveWorkspace(input);
  if (!workspace) return 'Error: workspace_path required.';

  const runDir = resolveLatestRunDir(workspace, appId, 'latest-application.txt');
  if (!runDir) return `No completed assessment found for "${appId}". Run swao_assess first.`;

  const all = loadAllSignals(runDir);
  const match = all.find(s => (s.id ?? '').toUpperCase() === signalId);
  if (!match) {
    const ids = all.map(s => s.id).filter(Boolean).join(', ');
    return `Signal "${input.signal_id}" not found in latest assessment for "${appId}".\nAvailable signal IDs: ${ids}`;
  }
  return formatSignalBlock(match).join('\n');
}

const SEVERITY_ORDER_MCP = ['critical', 'high', 'medium', 'low', 'informational', 'positive'];
function severityRankMcp(s: string): number {
  const i = SEVERITY_ORDER_MCP.indexOf(s);
  return i >= 0 ? i : 99;
}

export function handleSignals(input: ToolInput): string {
  const appId = String(input.app_id ?? '');
  const workspace = resolveWorkspace(input);
  if (!workspace) return 'Error: workspace_path required.';

  const runDir = resolveLatestRunDir(workspace, appId, 'latest-application.txt');
  if (!runDir) return `No completed assessment found for "${appId}". Run swao_assess first.`;

  const prefixFilter = input.prefix_filter
    ? String(input.prefix_filter).split(',').map(p => p.trim().toUpperCase()).filter(Boolean)
    : [];

  let signals = loadAllSignals(runDir);
  if (prefixFilter.length > 0) {
    signals = signals.filter(s => {
      const prefix = (s.id ?? '').split('-')[0].toUpperCase();
      return prefixFilter.includes(prefix);
    });
  }
  signals.sort((a, b) => severityRankMcp(a.severity ?? '') - severityRankMcp(b.severity ?? ''));

  if (signals.length === 0) {
    return prefixFilter.length > 0
      ? `No signals with prefix ${prefixFilter.join(',')} found for "${appId}".`
      : `No signals found for "${appId}".`;
  }

  const header = prefixFilter.length > 0
    ? `Signals for "${appId}" (filter: ${prefixFilter.join(',')}) -- ${signals.length} result(s)`
    : `All signals for "${appId}" -- ${signals.length} signal(s) sorted by severity`;

  const lines: string[] = [header, '='.repeat(header.length), ''];
  for (const s of signals) {
    lines.push(...formatSignalBlock(s));
    lines.push('-'.repeat(50));
    lines.push('');
  }
  return lines.join('\n');
}

// preferFile allows callers that need an application-assessment run (wsp-plan.yaml,
// wsp.yaml) to try latest-application.txt first (#1203). Falls back to latest.txt
// so a workspace with only LZ runs still returns something for cost/signal tools.
function resolveLatestRunDir(
  workspace: string,
  appId: string,
  preferFile = 'latest.txt',
): string | null {
  const wspDir = join(workspace, 'apps', appId, 'wsp');
  const candidates =
    preferFile !== 'latest.txt'
      ? [join(wspDir, preferFile), join(wspDir, 'latest.txt')]
      : [join(wspDir, 'latest.txt')];
  for (const latestFile of candidates) {
    if (!existsSync(latestFile)) continue;
    try {
      const latestPath = readFileSync(latestFile, 'utf-8').trim();
      const runDir = join(wspDir, latestPath);
      if (existsSync(runDir)) return runDir;
    } catch { /* try next candidate */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// #0258 -- audit-grade MCP tools
// ---------------------------------------------------------------------------
// Each tool follows the same shape: resolve workspace + latest run, read the
// relevant artifact (wsp-plan.yaml / run-manifest.json), format as text. No
// subprocess; pure file reads so they return fast.

const SEVERITY_RANK_FOR_RISK: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3, informational: 4,
};

function safeReadYamlMcp<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try { return load(readFileSync(filePath, 'utf-8')) as T; }
  catch { return null; }
}

function safeReadJsonMcp<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try { return JSON.parse(readFileSync(filePath, 'utf-8')) as T; }
  catch { return null; }
}

// Weak-read types for wsp-plan.yaml: all fields optional since safeReadYamlMcp
// does not validate (it casts). Derived from core schema types (#1173) so new
// fields added to ComplianceControl / ComplianceRegime / RiskRegisterItem
// propagate here automatically (Design 080 §7.1).
type PlanControl = Partial<ComplianceControl>;
type PlanRegime = Partial<Omit<ComplianceRegime, 'controls'>> & { controls?: PlanControl[] };
type PlanShape = {
  compliance?: { regimes?: PlanRegime[] };
  risk_register?: Array<Partial<RiskRegisterItem>>;
};

export function handleControlDetail(input: ToolInput): string {
  const appId = String(input.app_id ?? '');
  const controlId = String(input.control_id ?? '');
  if (!appId || !controlId) return 'Error: app_id and control_id required.';
  const workspace = resolveWorkspace(input);
  if (!workspace) return 'Error: workspace_path required.';
  const runDir = resolveLatestRunDir(workspace, appId, 'latest-application.txt');
  if (!runDir) return `No completed assessment found for "${appId}". Run swao_assess first.`;
  const plan = safeReadYamlMcp<PlanShape>(join(runDir, 'wsp-plan.yaml'));
  if (!plan) return `No wsp-plan.yaml in latest run for "${appId}".`;

  let match: { regime: PlanRegime; control: PlanControl } | null = null;
  for (const regime of plan.compliance?.regimes ?? []) {
    for (const c of regime.controls ?? []) {
      if (c.id === controlId) { match = { regime, control: c }; break; }
    }
    if (match) break;
  }
  if (!match) return `Control "${controlId}" not found for "${appId}". Check the control_id (e.g. BSI_C5_OPS-04).`;

  const { regime, control } = match;
  const lines: string[] = [
    `Control:      ${control.id}`,
    `Regime:       ${regime.id ?? '?'}`,
    `Outcome:      ${control.outcome ?? '--'}`,
    `Status:       ${control.status ?? '--'}`,
    `Severity:     ${control.severity ?? '--'}`,
    `Assessor:     ${control.assessor ?? '--'}`,
    `Assessed at:  ${control.assessed_at ?? '--'}`,
    '',
    'Rationale',
    '---------',
    control.rationale ?? '(none)',
    '',
    'Remediation',
    '-----------',
    control.remediation ?? '(none)',
    '',
    'Backing signals',
    '---------------',
    ...(control.signal_refs ?? []).map(s => `  - ${s}`),
    ...((control.signal_refs ?? []).length === 0 ? ['  (none)'] : []),
    '',
    'Evidence IDs',
    '------------',
    ...((control.evidence_ids ?? control.evidence ?? []).map(e => `  - ${e}`)),
    ...((control.evidence_ids ?? control.evidence ?? []).length === 0 ? ['  (none)'] : []),
  ];
  return lines.join('\n');
}

interface ManifestShape {
  run_id?: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  llm?: {
    provider?: string;
    model?: string;
    total_tokens_in?: number;
    total_tokens_out?: number;
    total_cost_usd?: number;
    call_count?: number;
  };
  pass_stats?: Array<{
    num?: string;
    pass?: string;
    wall_clock_ms?: number;
    signals_emitted?: number;
    tokens_in?: number;
    tokens_out?: number;
    cost_usd?: number;
  }>;
  landing_zone_weights?: Record<string, number>;
}

export function handleCosts(input: ToolInput): string {
  const appId = String(input.app_id ?? '');
  const workspace = resolveWorkspace(input);
  if (!workspace) return 'Error: workspace_path required.';
  const runDir = resolveLatestRunDir(workspace, appId);
  if (!runDir) return `No completed assessment found for "${appId}".`;
  const manifest = safeReadJsonMcp<ManifestShape>(join(runDir, 'run-manifest.json'));
  if (!manifest) return `No run-manifest.json in latest run for "${appId}".`;

  const stats = manifest.pass_stats ?? [];
  const lines: string[] = [
    `Per-pass cost breakdown for "${appId}"`,
    `Run: ${manifest.run_id ?? '(no id)'}  -- model: ${manifest.llm?.model ?? '?'}  provider: ${manifest.llm?.provider ?? '?'}`,
    '',
    'Pass                            Wall(ms)  Signals  Tokens(in)  Tokens(out)  Cost (USD)',
    '------------------------------- --------- -------- ----------- ------------ ----------',
  ];
  for (const p of stats) {
    const name = (p.pass ?? '?').slice(0, 31).padEnd(31);
    const ms = String(p.wall_clock_ms ?? '').padStart(9);
    const sig = String(p.signals_emitted ?? '').padStart(8);
    const tin = String(p.tokens_in ?? '').padStart(11);
    const tout = String(p.tokens_out ?? '').padStart(12);
    const cost = typeof p.cost_usd === 'number' ? `$${p.cost_usd.toFixed(4)}`.padStart(10) : '       --'.padStart(10);
    lines.push(`${name} ${ms} ${sig} ${tin} ${tout} ${cost}`);
  }
  lines.push('', `Total tokens in:   ${manifest.llm?.total_tokens_in ?? '--'}`);
  lines.push(`Total tokens out:  ${manifest.llm?.total_tokens_out ?? '--'}`);
  lines.push(`Total LLM calls:   ${manifest.llm?.call_count ?? '--'}`);
  lines.push(`Total cost (USD):  ${typeof manifest.llm?.total_cost_usd === 'number'
    ? `$${manifest.llm.total_cost_usd.toFixed(4)}`
    : '--'}`);
  return lines.join('\n');
}

export function handleRisks(input: ToolInput): string {
  const appId = String(input.app_id ?? '');
  const workspace = resolveWorkspace(input);
  if (!workspace) return 'Error: workspace_path required.';
  const runDir = resolveLatestRunDir(workspace, appId, 'latest-application.txt');
  if (!runDir) return `No completed assessment found for "${appId}".`;
  const plan = safeReadYamlMcp<PlanShape>(join(runDir, 'wsp-plan.yaml'));
  if (!plan) return `No wsp-plan.yaml in latest run for "${appId}".`;
  const risks = (plan.risk_register ?? []).slice();
  const sortBy = String(input.sort_by ?? 'impact').toLowerCase();
  risks.sort((a, b) => {
    if (sortBy === 'likelihood') {
      return (SEVERITY_RANK_FOR_RISK[a.likelihood ?? ''] ?? 9) - (SEVERITY_RANK_FOR_RISK[b.likelihood ?? ''] ?? 9);
    }
    if (sortBy === 'id') return (a.risk_id ?? '').localeCompare(b.risk_id ?? '');
    return (SEVERITY_RANK_FOR_RISK[a.impact ?? ''] ?? 9) - (SEVERITY_RANK_FOR_RISK[b.impact ?? ''] ?? 9);
  });
  if (risks.length === 0) return `No risk register entries for "${appId}".`;
  const lines: string[] = [
    `Risk register for "${appId}" (${risks.length} entries, sorted by ${sortBy})`,
    '',
  ];
  for (const r of risks) {
    lines.push(`${r.risk_id ?? '?'}  [${r.likelihood ?? '?'} likelihood / ${r.impact ?? '?'} impact]  ${r.category ?? ''}`);
    if (r.trigger) lines.push(`  Trigger:    ${r.trigger}`);
    if (r.mitigation) lines.push(`  Mitigation: ${r.mitigation}`);
    if (r.owner) lines.push(`  Owner:      ${r.owner}`);
    lines.push('');
  }
  return lines.join('\n');
}

interface SpineShape {
  app?: { id?: string; name?: string };
  overall?: {
    seven_r_label?: string;
    modernization_position?: string;
    coverage_score?: number | string;
    confidence?: number | string;
    portability_score?: number | string;
  };
  landing_zone?: { primary?: string };
}

export function handlePortfolioSummary(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  if (!workspace) return 'Error: workspace_path required.';

  // Use portfolio-index.json when available (one read vs N per-app reads). Fall back to fan-out.
  const index = loadPortfolioIndex(workspace);
  if (index) {
    const stale = checkIndexStaleness(workspace, index);
    const lines: string[] = [];
    if (stale) lines.push(stale, '');
    lines.push(`Portfolio summary for "${workspace}" (${index.apps.length} app(s), index ${index.built_at})`, '');
    lines.push('App                 7R           Modernization                          Coverage  Portability  LZ Verdict');
    lines.push('------------------- ------------ -------------------------------------- --------- ------------ -----------');
    for (const a of index.apps) {
      const name = a.app_id.slice(0, 19).padEnd(19);
      const sevenR = (a.seven_r_label || '--').slice(0, 12).padEnd(12);
      const modern = (a.modernization_position || '--').slice(0, 38).padEnd(38);
      const cov = String(a.coverage_score.toFixed(2)).padStart(9);
      const port = String(a.portability_score.toFixed(2)).padStart(12);
      const lz = (a.lz_verdict ?? '--').slice(0, 11);
      lines.push(`${name} ${sevenR} ${modern} ${cov} ${port} ${lz}`);
    }
    if (index.apps.length === 0) lines.push('No apps in index. Run: swao export --portfolio');
    return lines.join('\n');
  }

  // Fan-out fallback (no index present)
  const appsDir = join(workspace, 'apps');
  if (!existsSync(appsDir)) return `No apps/ directory under workspace "${workspace}".`;

  const lines: string[] = [
    `Portfolio summary for "${workspace}" (no index -- run swao export --portfolio for faster results)`,
    '',
    'App                 7R           Modernization                          Coverage  Portability  Landing zone',
    '------------------- ------------ -------------------------------------- --------- ------------ -----------------------',
  ];
  let appCount = 0;
  for (const appId of readdirSync(appsDir).sort()) {
    const runDir = resolveLatestRunDir(workspace, appId, 'latest-application.txt');
    if (!runDir) continue;
    const spine = safeReadYamlMcp<SpineShape>(join(runDir, 'wsp.yaml'));
    if (!spine) continue;
    appCount += 1;
    const o = spine.overall ?? {};
    const name = appId.slice(0, 19).padEnd(19);
    const sevenR = String(o.seven_r_label ?? '--').slice(0, 12).padEnd(12);
    const modern = String(o.modernization_position ?? '--').slice(0, 38).padEnd(38);
    const cov = String(o.coverage_score ?? '--').slice(0, 9).padStart(9);
    const port = String(o.portability_score ?? '--').slice(0, 12).padStart(12);
    const lz = String(spine.landing_zone?.primary ?? '--');
    lines.push(`${name} ${sevenR} ${modern} ${cov} ${port} ${lz}`);
  }
  if (appCount === 0) return `No completed assessments found in "${appsDir}". Run swao_assess on at least one app first.`;
  return lines.join('\n');
}

export function handleLzrWeights(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  if (!workspace) return 'Error: workspace_path required.';
  const appId = input.app_id ? String(input.app_id) : null;

  // Read whichever manifest is relevant: per-app or portfolio-scope.
  let manifestPath: string | null = null;
  let scopeLabel = '';
  if (appId) {
    const runDir = resolveLatestRunDir(workspace, appId);
    if (runDir) {
      manifestPath = join(runDir, 'run-manifest.json');
      scopeLabel = `app "${appId}"`;
    }
  }
  if (!manifestPath) {
    // Portfolio scope (no app or app run missing).
    const portfolioWsp = join(workspace, 'wsp');
    const latestFile = join(portfolioWsp, 'latest.txt');
    if (existsSync(latestFile)) {
      try {
        const rel = readFileSync(latestFile, 'utf-8').trim();
        const candidate = join(portfolioWsp, rel, 'lzr-summary.json');
        if (existsSync(candidate)) {
          // Portfolio LZR uses lzr-summary.json, not run-manifest.json
          const summary = safeReadJsonMcp<Record<string, unknown>>(candidate);
          if (summary) return `Portfolio LZR weights and verdicts\n\n${JSON.stringify(summary, null, 2)}`;
        }
      } catch { /* fall through */ }
    }
    return `No LZR data found. Either app_id with completed assess, or a portfolio LZR run, is required.`;
  }
  const manifest = safeReadJsonMcp<ManifestShape>(manifestPath);
  if (!manifest?.landing_zone_weights) return `No landing_zone_weights in manifest for ${scopeLabel}.`;

  const w = manifest.landing_zone_weights;
  const lines: string[] = [
    `Landing zone weights -- ${scopeLabel}`,
    '',
    'Weight              Value',
    '------------------- -----',
  ];
  for (const [k, v] of Object.entries(w)) {
    lines.push(`${k.slice(0, 19).padEnd(19)} ${String(v).padStart(5)}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Portfolio index helpers (Design 080 §6.2, #1191)
// ---------------------------------------------------------------------------

interface PortfolioIndexApp {
  app_id: string;
  seven_r_label: string;
  modernization_position: string;
  portability_score: number;
  coverage_score: number;
  total_negative_signals: number;
  weighted_risk_score: number;
  per_regime_coverage: Record<string, { satisfied: number; partial: number; gap: number; weighted_gap: number }>;
  risk_rollup: { open: number; mitigated: number; closed: number; high_count: number };
  lz_verdict: string | null;
}

interface PortfolioIndexShape {
  built_at: string;
  schema_version: string;
  apps: PortfolioIndexApp[];
}

function loadPortfolioIndex(workspaceRoot: string): PortfolioIndexShape | null {
  const indexPath = join(workspaceRoot, 'wsp', 'portfolio-index.json');
  if (!existsSync(indexPath)) return null;
  try { return JSON.parse(readFileSync(indexPath, 'utf-8')) as PortfolioIndexShape; }
  catch { return null; }
}

function checkIndexStaleness(workspaceRoot: string, index: PortfolioIndexShape): string | null {
  const builtAt = new Date(index.built_at);
  const appsDir = join(workspaceRoot, 'apps');
  if (!existsSync(appsDir)) return null;
  let newestRun: Date | null = null;
  for (const appId of readdirSync(appsDir)) {
    const latestFile = join(appsDir, appId, 'wsp', 'latest.txt');
    if (!existsSync(latestFile)) continue;
    try {
      const rel = readFileSync(latestFile, 'utf-8').trim().replace(/^runs\//, '');
      // Run IDs use YYYY-MM-DDTHH-mm-ss (dashes in the time part); convert to ISO.
      const iso = rel.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
      const d = new Date(iso);
      if (!isNaN(d.getTime()) && d > builtAt) {
        if (!newestRun || d > newestRun) newestRun = d;
      }
    } catch { /* skip */ }
  }
  if (newestRun) {
    return `[WARN] Portfolio index is stale (built ${index.built_at}; newest run ${newestRun.toISOString()}). Run: swao export --portfolio`;
  }
  return null;
}

export function handlePortfolioQuery(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  if (!workspace) return 'Error: workspace_path required.';
  const index = loadPortfolioIndex(workspace);
  if (!index) return 'No portfolio-index.json found. Run: swao export --portfolio';
  const stale = checkIndexStaleness(workspace, index);

  // Filters
  const rawFilters = typeof input.filters === 'object' && input.filters !== null
    ? (input.filters as Record<string, unknown>) : {};
  const sevenRFilter = Array.isArray(rawFilters['seven_r']) ? (rawFilters['seven_r'] as string[]) : null;
  const minCoverage = typeof rawFilters['min_coverage'] === 'number' ? (rawFilters['min_coverage'] as number) : null;
  const lzFilter = Array.isArray(rawFilters['lz_verdict']) ? (rawFilters['lz_verdict'] as string[]) : null;

  let apps = index.apps;
  if (sevenRFilter) apps = apps.filter(a => sevenRFilter.includes(a.seven_r_label));
  if (minCoverage !== null) apps = apps.filter(a => a.coverage_score >= minCoverage);
  if (lzFilter) apps = apps.filter(a => a.lz_verdict !== null && lzFilter.includes(a.lz_verdict));

  if (apps.length === 0) return `${stale ?? ''}No apps match the query filters.`;

  const lines: string[] = [];
  if (stale) lines.push(stale, '');
  lines.push(`Portfolio query: ${apps.length} app(s) match`, '');
  lines.push('App                 7R           Coverage  Portability  LZ Verdict');
  lines.push('------------------- ------------ --------- ------------ -----------');
  for (const a of apps) {
    const name = a.app_id.slice(0, 19).padEnd(19);
    const sevenR = (a.seven_r_label || '--').slice(0, 12).padEnd(12);
    const cov = String(a.coverage_score.toFixed(2)).padStart(9);
    const port = String(a.portability_score.toFixed(2)).padStart(12);
    const lz = (a.lz_verdict ?? '--').slice(0, 11);
    lines.push(`${name} ${sevenR} ${cov} ${port} ${lz}`);
  }
  return lines.join('\n');
}

export function handlePortfolioStats(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  if (!workspace) return 'Error: workspace_path required.';
  const index = loadPortfolioIndex(workspace);
  if (!index) return 'No portfolio-index.json found. Run: swao export --portfolio';
  const stale = checkIndexStaleness(workspace, index);

  const apps = index.apps;
  const n = apps.length;
  if (n === 0) return `${stale ?? ''}No assessed apps in index.`;

  // 7R distribution
  const sevenRCount: Record<string, number> = {};
  for (const a of apps) sevenRCount[a.seven_r_label] = (sevenRCount[a.seven_r_label] ?? 0) + 1;

  // Coverage percentiles
  const coverages = apps.map(a => a.coverage_score).sort((x, y) => x - y);
  const p50 = coverages[Math.floor(n * 0.5)] ?? 0;
  const p75 = coverages[Math.floor(n * 0.75)] ?? 0;
  const p90 = coverages[Math.floor(n * 0.9)] ?? 0;

  // Portability percentiles
  const ports = apps.map(a => a.portability_score).sort((x, y) => x - y);
  const pp50 = ports[Math.floor(n * 0.5)] ?? 0;

  // Risk high-count histogram
  const totalOpen = apps.reduce((s, a) => s + a.risk_rollup.open, 0);
  const totalHigh = apps.reduce((s, a) => s + a.risk_rollup.high_count, 0);

  // LZ verdict distribution
  const lzCount: Record<string, number> = {};
  for (const a of apps) {
    const v = a.lz_verdict ?? 'not_assessed';
    lzCount[v] = (lzCount[v] ?? 0) + 1;
  }

  const lines: string[] = [];
  if (stale) lines.push(stale, '');
  lines.push(`Portfolio statistics (${n} apps, index built ${index.built_at})`, '');
  lines.push('7R Distribution');
  lines.push('---------------');
  for (const [label, count] of Object.entries(sevenRCount).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${label.padEnd(30)} ${count}`);
  }
  lines.push('', 'Coverage Score (0..1)');
  lines.push('---------------------');
  lines.push(`  p50: ${p50.toFixed(2)}   p75: ${p75.toFixed(2)}   p90: ${p90.toFixed(2)}`);
  lines.push('', 'Portability Score (0..1)');
  lines.push('------------------------');
  lines.push(`  p50: ${pp50.toFixed(2)}`);
  lines.push('', 'Risk Rollup');
  lines.push('-----------');
  lines.push(`  Total open risks: ${totalOpen}   High-impact: ${totalHigh}`);
  lines.push('', 'LZ Verdict Distribution');
  lines.push('-----------------------');
  for (const [v, c] of Object.entries(lzCount).sort()) {
    lines.push(`  ${v.padEnd(20)} ${c}`);
  }
  return lines.join('\n');
}

export function handlePortfolioRisks(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  if (!workspace) return 'Error: workspace_path required.';
  const index = loadPortfolioIndex(workspace);
  if (!index) return 'No portfolio-index.json found. Run: swao export --portfolio';
  const stale = checkIndexStaleness(workspace, index);
  const minHigh = typeof input.min_high_count === 'number' ? (input.min_high_count as number) : 0;

  const apps = index.apps
    .filter(a => a.risk_rollup.high_count >= minHigh || a.risk_rollup.open > 0)
    .sort((x, y) => y.risk_rollup.open - x.risk_rollup.open || y.risk_rollup.high_count - x.risk_rollup.high_count);

  if (apps.length === 0) return `${stale ?? ''}No apps with open risks match the filter.`;

  const lines: string[] = [];
  if (stale) lines.push(stale, '');
  lines.push(`Cross-app risk rollup (${apps.length} app(s))`, '');
  lines.push('App                  Open  Closed  High-impact');
  lines.push('-------------------- ----- ------- -----------');
  for (const a of apps) {
    const name = a.app_id.slice(0, 20).padEnd(20);
    lines.push(`${name} ${String(a.risk_rollup.open).padStart(5)} ${String(a.risk_rollup.closed).padStart(7)} ${String(a.risk_rollup.high_count).padStart(11)}`);
  }
  return lines.join('\n');
}

export function handlePortfolioLz(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  if (!workspace) return 'Error: workspace_path required.';

  // Try lzr-summary.json first (richer; has per-app blocker+warning counts)
  const portfolioWsp = join(workspace, 'wsp');
  const latestFile = join(portfolioWsp, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const rel = readFileSync(latestFile, 'utf-8').trim();
      const candidate = join(portfolioWsp, rel, 'lzr-summary.json');
      if (existsSync(candidate)) {
        const summary = safeReadJsonMcp<Record<string, unknown>>(candidate);
        if (summary) {
          const apps = Array.isArray(summary['apps']) ? (summary['apps'] as Array<Record<string, unknown>>) : [];
          const counts = summary['counts'] as Record<string, number> | undefined;
          const lines: string[] = [
            `Portfolio LZ readiness (${summary['assessed_at'] ?? '--'})`,
            `Overall verdict: ${String(summary['overall_verdict'] ?? '--').toUpperCase()}`,
            '',
            `Ready: ${counts?.['ready'] ?? 0}  Advisory: ${counts?.['advisory'] ?? 0}  Blocked: ${counts?.['blocked'] ?? 0}  Skipped: ${counts?.['skipped'] ?? 0}`,
            '',
            'App                  Verdict    Blockers  Warnings',
            '-------------------- ---------- --------- --------',
          ];
          for (const a of apps) {
            const name = String(a['app_id'] ?? '--').slice(0, 20).padEnd(20);
            const verdict = String(a['verdict'] ?? '--').slice(0, 10).padEnd(10);
            lines.push(`${name} ${verdict} ${String(a['blocker_count'] ?? 0).padStart(9)} ${String(a['warning_count'] ?? 0).padStart(8)}`);
          }
          return lines.join('\n');
        }
      }
    } catch { /* fall through to index */ }
  }

  // Fall back to index lz_verdict column
  const index = loadPortfolioIndex(workspace);
  if (!index) return 'No LZR data found. Run: swao assess --portfolio --lzr <id> or swao export --portfolio.';
  const stale = checkIndexStaleness(workspace, index);

  const lines: string[] = [];
  if (stale) lines.push(stale, '');
  lines.push('Portfolio LZ readiness (from portfolio-index.json)', '');
  lines.push('App                  LZ Verdict');
  lines.push('-------------------- ----------');
  for (const a of index.apps) {
    lines.push(`${a.app_id.slice(0, 20).padEnd(20)} ${a.lz_verdict ?? 'not_assessed'}`);
  }
  return lines.join('\n');
}

function _handlePublish(input: ToolInput): string {
  const appId = String(input.app_id ?? '');
  const workspace = resolveWorkspace(input);
  const mode = String(input.mode ?? 'html');
  const lang = input.lang ? ['--lang', String(input.lang)] : [];
  const blockProfile = input.block_profile ? ['--block-profile', String(input.block_profile)] : [];
  let args: string[];
  if (mode === 'site') {
    args = ['publish', '--site', '--app', appId, ...lang];
  } else if (mode === 'headless') {
    args = ['publish', '--headless', '--app', appId, ...lang];
  } else {
    args = ['publish', '--app', appId, ...lang, ...blockProfile];
  }
  const r = runSwao(args, workspace);
  if (!r.ok && !r.stdout) return `Publication failed.\n${r.stderr}`.trim();
  return (r.stdout + (r.stderr ? `\n[info]\n${r.stderr}` : '')).trim();
}

function _handlePublishSite(input: ToolInput): string {
  return _handlePublish({ ...input, mode: 'site' });
}

function _handleHub(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  const appId = input.app_id ? String(input.app_id) : undefined;
  const args = appId
    ? ['publish', '--block-profile', 'hub', '--app', appId]
    : ['publish', '--block-profile', 'hub'];
  const r = runSwao(args, workspace);
  if (!r.ok && !r.stdout) return `Hub generation failed.\n${r.stderr}`.trim();
  return (r.stdout + (r.stderr ? `\n[info]\n${r.stderr}` : '')).trim();
}

function _handleLenses(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  const action = String(input.action ?? 'list');
  const lensIds = Array.isArray(input.lens_ids) ? (input.lens_ids as string[]) : [];
  let args: string[];
  if (action === 'list') {
    args = ['lenses', 'list'];
  } else if (action === 'add') {
    args = ['lenses', 'add', ...lensIds];
  } else if (action === 'set') {
    args = ['lenses', 'set', ...lensIds];
  } else if (action === 'remove') {
    args = ['lenses', 'remove', ...lensIds];
  } else {
    args = ['lenses', 'list'];
  }
  const r = runSwao(args, workspace);
  return (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim() || 'No lenses output.';
}

function _handleNormalize(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  const appArgs = input.app_id ? ['--app', String(input.app_id)] : [];
  const r = runSwao(['normalize', '--dry-run', ...appArgs], workspace);
  return (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim() || 'No files found in wsp/intake/.';
}

// #0596: read-only LZ catalogue access. Wraps the `swao lz catalogue` CLI
// (list / show), which only reads the bundled snapshots -- no side effects.
function _handleLzCatalogue(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  const action = input.action === 'show' ? 'show' : 'list';
  const args = ['lz', 'catalogue', action];
  if (action === 'show') {
    if (!input.provider) return 'swao_lz_catalogue action="show" requires a provider id (e.g. aws, azure, stackit).';
    args.push(String(input.provider));
  }
  const r = runSwao(args, workspace);
  return (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim() || 'No landing-zone catalogues found.';
}

// #0596 (sprint-073): separate swao_lz_catalogue_list / _show / _fit handlers.
function _handleLzCatalogueList(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  const r = runSwao(['lz', 'catalogue', 'list'], workspace);
  return (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim() || 'No landing-zone catalogues found.';
}

function _handleLzCatalogueShow(input: ToolInput): string {
  if (!input.provider) return 'swao_lz_catalogue_show requires a provider id (e.g. aws, azure, stackit).';
  const workspace = resolveWorkspace(input);
  const r = runSwao(['lz', 'catalogue', 'show', String(input.provider)], workspace);
  return (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim() || `No catalogue found for provider '${String(input.provider)}'.`;
}

function _handleLzFit(input: ToolInput): string {
  const appId    = String(input.app_id ?? '');
  const provider = String(input.provider ?? '');
  const region   = String(input.region ?? '');
  if (!appId || !provider || !region) {
    return 'swao_lz_fit requires app_id, provider, and region.';
  }
  const workspace = resolveWorkspace(input);
  const r = runSwao(['lz', 'fit', '--app', appId, '--provider', provider, '--region', region], workspace);
  return (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim() || 'No fit result produced.';
}

function _handlePortalQuery(input: ToolInput): string {
  const endpoint = String(input.endpoint ?? '');
  const portalUrl = String(input.portal_url ?? 'http://localhost:4000');
  const token = input.token ? String(input.token) : '';
  // Pass user-controlled values via environment variables, NOT via script interpolation.
  // This prevents CodeQL js/incomplete-sanitization: endpoint/portalUrl could contain
  // backticks, ${...} or other JS-injection characters if embedded in a template literal.
  const script = `
    const http = require('http'), https = require('https');
    const endpoint = process.env.SWAO_MCP_ENDPOINT || '';
    const portalUrl = process.env.SWAO_MCP_PORTAL_URL || 'http://localhost:4000';
    const token = process.env.SWAO_MCP_TOKEN || '';
    const u = new URL('/api/v1/' + endpoint, portalUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    let body = '';
    lib.get({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, headers }, res => {
      res.on('data', d => body += d);
      res.on('end', () => { process.stdout.write(body); });
    }).on('error', e => { process.stderr.write(e.message); process.exit(1); });
  `.trim();
  const env = { ...process.env, SWAO_MCP_ENDPOINT: endpoint, SWAO_MCP_PORTAL_URL: portalUrl, SWAO_MCP_TOKEN: token };
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf-8', timeout: 8_000, env });
  if (r.status !== 0) {
    return `Portal query failed: ${(r.stderr ?? '').trim()}. Is the portal running at ${portalUrl}?`;
  }
  return r.stdout?.trim() || '(empty response)';
}

function handleReport(input: ToolInput): string {
  const appId = String(input.app_id ?? '');
  const workspace = resolveWorkspace(input);
  const fmt = input.format ? ['--format', String(input.format)] : [];
  const view = input.view ? ['--view', String(input.view)] : [];

  const outputArgs: string[] = [];
  if (workspace) {
    const runDir = resolveLatestRunDir(workspace, appId, 'latest-application.txt');
    if (runDir) {
      const viewName = input.view ? String(input.view) : 'report';
      outputArgs.push('--output', join(runDir, `${viewName}.txt`));
    }
  }

  const args = ['report', '--app', appId, ...fmt, ...view, ...outputArgs];
  const r = runSwao(args, workspace);

  if (outputArgs.length > 0 && r.ok) {
    const savedPath = outputArgs[1];
    try {
      const fileContent = readFileSync(savedPath, 'utf-8');
      return `Report saved to: ${savedPath}\n\n${fileContent}`;
    } catch {
      return `Report saved to: ${savedPath}\n\n${r.stdout.trim()}`;
    }
  }
  return (r.stdout + (r.stderr && !r.ok ? `\n[stderr]\n${r.stderr}` : '')).trim();
}

function handleHealthCheck(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  const fmt = input.format ? ['--format', String(input.format)] : [];
  const r = runSwao(['health-check', ...fmt], workspace);
  return (r.stdout + (r.stderr && !r.ok ? `\n[stderr]\n${r.stderr}` : '')).trim();
}

function handleChallenge(input: ToolInput): string {
  const appId = String(input.app_id ?? '');
  const workspace = resolveWorkspace(input);
  const agent = input.agent ? ['--agent', String(input.agent)] : [];
  const args = ['challenge', '--app', appId, ...agent, '--report'];
  const r = runSwao(args, workspace);
  return (r.stdout + (r.stderr && !r.ok ? `\n[stderr]\n${r.stderr}` : '')).trim();
}

// Valid ingestion categories (IngestCategory enum + RESERVED_SUBFOLDERS from pass-00-ingest.ts).
const VALID_INGEST_CATEGORIES = new Set([
  'architecture', 'compliance', 'operations', 'workshops',
  'structured', 'terraform', 'docs', 'intake', 'other',
  'source', 'catalogs', 'yara-rules', 'checklists', 'evidence',
  'interviews', 'cmdb',
]);

// Design 080 §5.1, C2 (#1178): write to ingestion/<category>/ so Pass 00
// (SHA-256 delta, binary extraction) runs on the next assessment.
export function handleIngest(input: ToolInput): string {
  const appId    = String(input.app_id ?? '');
  const category = String(input.category ?? '');
  const filename = String(input.filename ?? '');
  const workspace = resolveWorkspace(input);

  if (!appId) return 'Error: app_id is required.';
  if (!category) return 'Error: category is required.';
  if (!filename) return 'Error: filename is required.';

  // Path-traversal guards on category + filename
  if (/[/\\]/.test(category) || category === '..' || category === '.') {
    return `Error: category must not contain path separators: ${category}`;
  }
  if (!VALID_INGEST_CATEGORIES.has(category)) {
    return `Error: unknown category "${category}". Valid values: ${[...VALID_INGEST_CATEGORIES].sort().join(', ')}`;
  }
  if (/[/\\]/.test(filename) || filename === '..' || filename === '.') {
    return `Error: filename must not contain path separators or be a traversal sequence: ${filename}`;
  }
  if (!workspace) return 'Error: workspace_path is required (or run from within a SWAO workspace).';

  const ingestionDir = join(workspace, 'apps', appId, 'ingestion', category);
  const targetPath   = join(ingestionDir, filename);

  const sourcePath = input.source_path ? String(input.source_path) : null;
  const content    = input.content    != null ? String(input.content) : null;

  if (!sourcePath && content === null) {
    return 'Error: either content or source_path is required.';
  }

  try {
    mkdirSync(ingestionDir, { recursive: true });

    if (sourcePath) {
      // Validate source_path: must exist and be a regular file
      if (!existsSync(sourcePath)) {
        return `Error: source_path not found: ${sourcePath}`;
      }
      let stat;
      try { stat = statSync(sourcePath); } catch (e) {
        return `Error: cannot stat source_path: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (!stat.isFile()) {
        return `Error: source_path must be a regular file: ${sourcePath}`;
      }
      copyFileSync(sourcePath, targetPath);
      return `Ingested (copy): ${targetPath}\nPass 00 will process this file on the next swao_assess run.`;
    } else {
      writeFileSync(targetPath, content!, 'utf-8');
      return `Ingested (text): ${targetPath}\nPass 00 will process this file on the next swao_assess run.`;
    }
  } catch (e) {
    return `Error writing ingestion file: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// Evidence type enum from WspEvidenceRecordSchema (wsp-feedback.ts).
const VALID_EVIDENCE_TYPES = new Set([
  'static_analysis', 'cmdb', 'finops', 'incident',
  'ops_runbook', 'workshop', 'architecture_doc', 'apm', 'other',
]);

// Design 080 §5.2, §5.5, C4 (#1179): capture structured evidence from an
// AI chat into ingestion/evidence/ with deterministic linkage.
export function handleEvidenceCapture(input: ToolInput): string {
  const appId     = String(input.app_id ?? '');
  const statement = String(input.statement ?? '');
  const type      = String(input.type ?? '');
  const workspace = resolveWorkspace(input);

  if (!appId) return 'Error: app_id is required.';
  if (!statement) return 'Error: statement is required.';
  if (!type) return 'Error: type is required.';
  if (!VALID_EVIDENCE_TYPES.has(type)) {
    return `Error: unknown type "${type}". Valid values: ${[...VALID_EVIDENCE_TYPES].sort().join(', ')}`;
  }
  if (!workspace) return 'Error: workspace_path is required (or run from within a SWAO workspace).';

  const addressesRaw = input.addresses;
  const addresses: string[] = Array.isArray(addressesRaw)
    ? (addressesRaw as unknown[]).map(String).filter(Boolean)
    : [];
  if (addresses.length === 0) {
    return 'Error: addresses[] must contain at least one signal or control ID.';
  }

  const author   = input.author ? String(input.author) : '';
  const chatLog  = input.chat_log ? String(input.chat_log) : null;

  // Validate addresses against the current run's known signal + control IDs.
  // Skipped when no run exists (nothing to validate against).
  const runDir = resolveLatestRunDir(workspace, appId, 'latest-application.txt');
  if (runDir) {
    const knownIds = new Set<string>();
    for (const s of loadAllSignals(runDir)) { if (s.id) knownIds.add(s.id); }
    const plan = safeReadYamlMcp<PlanShape>(join(runDir, 'wsp-plan.yaml'));
    for (const reg of plan?.compliance?.regimes ?? []) {
      for (const ctrl of reg.controls ?? []) { if (ctrl.id) knownIds.add(ctrl.id); }
    }
    if (knownIds.size > 0) {
      const unknown = addresses.filter(a => !knownIds.has(a));
      if (unknown.length > 0) {
        const sample = [...knownIds].slice(0, 5).join(', ');
        return `Error: unknown addresses not in current run: ${unknown.join(', ')}.\n` +
               `Known IDs include: ${sample}${knownIds.size > 5 ? ', ...' : ''}.`;
      }
    }
  }

  // Deterministic ID: EV-<yyyymmdd>-<uuid-prefix>
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const shortId = randomUUID().replace(/-/g, '').slice(0, 8);
  const evidenceId = `EV-${today}-${shortId}`;
  const capturedAt = new Date().toISOString();

  // Write structured YAML record + markdown protocol to ingestion/evidence/
  const evidenceDir = join(workspace, 'apps', appId, 'ingestion', 'evidence');

  const record: Record<string, unknown> = {
    evidence_id: evidenceId,
    type,
    statement,
    addresses,
    captured_at: capturedAt,
  };
  if (author) record['captured_by'] = author;

  let chatlogPath: string | null = null;

  if (chatLog) {
    const feedbackDir = join(workspace, 'apps', appId, 'feedback', 'chatlogs');
    const tsSlug = capturedAt.replace(/[:.]/g, '-').slice(0, 19);
    const authorSlug = author ? `-${author.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 30)}` : '';
    const chatlogFile = `${tsSlug}${authorSlug}.md`;
    chatlogPath = join('apps', appId, 'feedback', 'chatlogs', chatlogFile);
    try {
      mkdirSync(feedbackDir, { recursive: true });
      const redacted = redactPiiString(chatLog, emptyCounts());
      writeFileSync(join(feedbackDir, chatlogFile), redacted, 'utf-8');
      record['source_chatlog'] = chatlogPath;
    } catch (e) {
      return `Error writing chat log: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // Build markdown protocol
  const mdLines = [
    `# Evidence: ${evidenceId}`,
    '',
    `**Type:** ${type}`,
    `**Date:** ${capturedAt.slice(0, 10)}`,
    author ? `**Captured by:** ${author}` : null,
    '',
    '## Statement',
    '',
    statement,
    '',
    '## Addresses',
    '',
    ...addresses.map(a => `- ${a}`),
  ].filter((l): l is string => l !== null);
  if (chatlogPath) {
    mdLines.push('', '## Source', '', `Chat log: ${chatlogPath}`);
  }

  try {
    mkdirSync(evidenceDir, { recursive: true });
    const yamlFile = join(evidenceDir, `${evidenceId}.yaml`);
    const mdFile   = join(evidenceDir, `${evidenceId}.md`);
    writeFileSync(yamlFile, yamlDump(record, { lineWidth: 120 }), 'utf-8');
    writeFileSync(mdFile, mdLines.join('\n') + '\n', 'utf-8');
    return [
      `Evidence captured: ${evidenceId}`,
      `YAML record:  ${yamlFile}`,
      `Protocol:     ${mdFile}`,
      chatlogPath ? `Chat log:     ${join(workspace, ...chatlogPath.split('/'))}` : null,
      '',
      `Addresses: ${addresses.join(', ')}`,
      'Pass 00 + derive will link this to the next assessment run.',
    ].filter((l): l is string => l !== null).join('\n');
  } catch (e) {
    return `Error writing evidence files: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// fact_risks column order from star.ts:662 -- used to map xlsx/csv rows by position.
// Kept in sync with factRisksHeader in star.ts (closure fields added in #1184).
const FACT_RISKS_COLUMNS = ['risk_id', 'app_id', 'category', 'likelihood', 'impact', 'trigger', 'mitigation', 'owner', 'status', 'evidence_ids', 'closed_by', 'closed_at'] as const;

// Parse a risk-register workbook/text and return a WspRiskImportOverlay-shaped object.
// Returns { ok: true, overlay } or { ok: false, error: string }.
export async function parseRiskImport(
  format: 'xlsx' | 'csv' | 'yaml',
  sourcePath: string | null,
  content: string | null,
): Promise<{ ok: true; overlay: unknown } | { ok: false; error: string }> {
  const source = sourcePath ?? `inline.${format}`;
  const importedAt = new Date().toISOString();

  if (format === 'yaml') {
    const raw = content ?? (sourcePath ? (() => { try { return readFileSync(sourcePath, 'utf-8'); } catch (e) { return null; } })() : null);
    if (!raw) return { ok: false, error: 'yaml format requires content or a readable source_path.' };
    let parsed: unknown;
    try { parsed = load(raw); } catch (e) { return { ok: false, error: `YAML parse error: ${e instanceof Error ? e.message : String(e)}` }; }
    const result = WspRiskImportOverlaySchema.safeParse(parsed);
    if (!result.success) return { ok: false, error: `Schema validation failed: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
    return { ok: true, overlay: result.data };
  }

  if (format === 'csv') {
    const raw = content ?? (sourcePath ? (() => { try { return readFileSync(sourcePath, 'utf-8'); } catch (e) { return null; } })() : null);
    if (!raw) return { ok: false, error: 'csv format requires content or a readable source_path.' };
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return { ok: false, error: 'CSV must have a header row and at least one data row.' };
    const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const risks: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      for (let j = 0; j < header.length; j++) row[header[j]] = cells[j] ?? '';
      // Accept both column-name and positional (FACT_RISKS_COLUMNS order)
      const risk_id = row['risk_id'] ?? cells[0] ?? '';
      if (!risk_id) continue;
      const r: Record<string, string> = { risk_id };
      for (const col of FACT_RISKS_COLUMNS) {
        if (col !== 'app_id') r[col] = row[col] ?? '';
      }
      risks.push(r);
    }
    if (risks.length === 0) return { ok: false, error: 'CSV contained no valid risk rows (risk_id required).' };
    const overlay = { source, imported_at: importedAt, risks };
    const result = WspRiskImportOverlaySchema.safeParse(overlay);
    if (!result.success) return { ok: false, error: `Schema validation failed: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
    return { ok: true, overlay: result.data };
  }

  // xlsx: use exceljs, prefer source_path
  if (!sourcePath) return { ok: false, error: 'xlsx format requires source_path (binary file path).' };
  if (!existsSync(sourcePath)) return { ok: false, error: `File not found: ${sourcePath}` };

  try {
    const ExcelJS = await import('exceljs');
    const WorkbookClass = (ExcelJS.default as { Workbook?: typeof import('exceljs').Workbook }).Workbook
      ?? (ExcelJS as unknown as { Workbook: typeof import('exceljs').Workbook }).Workbook;
    const wb = new WorkbookClass();
    await wb.xlsx.readFile(sourcePath);
    const ws = wb.getWorksheet(1);
    if (!ws) return { ok: false, error: 'xlsx workbook has no worksheets.' };

    const risks: Record<string, unknown>[] = [];
    let headerRow: string[] = [];
    ws.eachRow((row, rowNum) => {
      const cells = (row.values as (string | null | undefined)[]).slice(1).map(v => (v == null ? '' : String(v)));
      if (rowNum === 1) {
        headerRow = cells;
        return;
      }
      const r: Record<string, string> = {};
      for (let j = 0; j < headerRow.length; j++) {
        const col = headerRow[j] ?? FACT_RISKS_COLUMNS[j] ?? `col_${j}`;
        r[col] = cells[j] ?? '';
      }
      // Positional fallback if header is absent or doesn't match
      const risk_id = r['risk_id'] || cells[0] || '';
      if (!risk_id) return;
      const risk: Record<string, string> = { risk_id };
      for (const col of FACT_RISKS_COLUMNS) {
        if (col !== 'app_id') risk[col] = r[col] ?? '';
      }
      risks.push(risk);
    });
    if (risks.length === 0) return { ok: false, error: 'xlsx worksheet has no valid risk rows (risk_id required in column A or header).' };
    const overlay = { source, imported_at: importedAt, risks };
    const result = WspRiskImportOverlaySchema.safeParse(overlay);
    if (!result.success) return { ok: false, error: `Schema validation failed: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
    return { ok: true, overlay: result.data };
  } catch (e) {
    return { ok: false, error: `xlsx parse error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function handleRiskImport(input: ToolInput): Promise<string> {
  const appId  = String(input.app_id ?? '');
  const format = String(input.format ?? '') as 'xlsx' | 'csv' | 'yaml' | '';
  const workspace = resolveWorkspace(input);

  if (!appId) return 'Error: app_id is required.';
  if (!['xlsx', 'csv', 'yaml'].includes(format)) return 'Error: format must be xlsx, csv, or yaml.';
  if (!workspace) return 'Error: workspace_path is required (or run from within a SWAO workspace).';

  const sourcePath = input.source_path ? String(input.source_path) : null;
  const content    = input.content ? String(input.content) : null;
  if (!sourcePath && !content) return 'Error: source_path or content is required.';

  const result = await parseRiskImport(format as 'xlsx' | 'csv' | 'yaml', sourcePath, content);
  if (!result.ok) return `Error: ${result.error}`;

  const structuredDir = join(workspace, 'apps', appId, 'ingestion', 'structured');
  const outputPath    = join(structuredDir, 'risk-register-import.yaml');

  try {
    mkdirSync(structuredDir, { recursive: true });
    writeFileSync(outputPath, yamlDump(result.overlay, { lineWidth: 120, noRefs: true }), 'utf-8');
    const overlay = result.overlay as { risks?: unknown[] };
    const count = Array.isArray(overlay.risks) ? overlay.risks.length : 0;
    return [
      `Risk register imported: ${count} row(s)`,
      `Overlay written: ${outputPath}`,
      '',
      'On the next assessment run, derive-plan will merge these rows into the risk register.',
      '(Overlay rows win on status, evidence_ids, closed_rationale, closed_at per Design 080 S5.3.)',
    ].join('\n');
  } catch (e) {
    return `Error writing overlay: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// Design 080 §5.4 (#1187): author sourcing (Q7) -- prefer explicit param,
// fall back to SWAO_OPERATOR env; return null if no identity available.
function resolveAuthor(input: ToolInput): string | null {
  if (input.author) return String(input.author);
  if (process.env['SWAO_OPERATOR']) return String(process.env['SWAO_OPERATOR']);
  return null;
}

// Append a record to a list-keyed YAML file (key = 'overrides' | 'annotations').
// File format: { <key>: [...records] } -- created if absent.
function appendToFeedbackFile(
  filePath: string,
  key: string,
  record: Record<string, unknown>,
): void {
  let existing: Record<string, unknown[]> = { [key]: [] };
  if (existsSync(filePath)) {
    try {
      const raw = load(readFileSync(filePath, 'utf-8')) as { [k: string]: unknown[] } | null;
      const list = raw?.[key];
      existing = { [key]: Array.isArray(list) ? list : [] };
    } catch { /* start fresh */ }
  }
  existing[key].push(record);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, yamlDump(existing, { lineWidth: 120, noRefs: true }), 'utf-8');
}

// swao_feedback_add: write attributed override to feedback/overrides.yaml.
export function handleFeedbackAdd(input: ToolInput): string {
  const appId       = String(input.app_id ?? '');
  const targetType  = String(input.target_type ?? '');
  const targetId    = String(input.target_id ?? '');
  const rationale   = String(input.rationale ?? '');
  const overrideVal = String(input.override_outcome ?? '');
  const workspace   = resolveWorkspace(input);
  const author      = resolveAuthor(input);

  if (!appId)      return 'Error: app_id is required.';
  if (!targetType || !['control', 'risk', 'signal'].includes(targetType)) {
    return 'Error: target_type must be control, risk, or signal.';
  }
  if (!targetId)   return 'Error: target_id is required.';
  if (!rationale)  return 'Error: rationale is required.';
  if (!overrideVal) return 'Error: override_outcome is required.';
  if (!workspace)  return 'Error: workspace_path is required (or run from within a SWAO workspace).';
  if (!author)     return 'Error: author is required (or set SWAO_OPERATOR env; no anonymous overrides per Design 080 C5).';

  const evidenceIds = input.evidence_ids;
  const record: Record<string, unknown> = {
    target_type: targetType,
    target_id: targetId,
    author,
    role: input.role ? String(input.role) : undefined,
    timestamp: new Date().toISOString(),
    rationale,
    override_outcome: overrideVal,
  };
  if (Array.isArray(evidenceIds) && evidenceIds.length > 0) {
    record['evidence_ids'] = evidenceIds.map(String);
  }
  // Validate against schema
  const parsed = WspOverrideRecordSchema.safeParse(record);
  if (!parsed.success) return `Error: invalid override record: ${parsed.error.message}`;

  const overridesPath = join(workspace, 'apps', appId, 'feedback', 'overrides.yaml');
  try {
    appendToFeedbackFile(overridesPath, 'overrides', record);
    return [
      `Override recorded: ${targetType} "${targetId}" -> ${overrideVal}`,
      `Author: ${author}`,
      `File: ${overridesPath}`,
      '',
      'On the next assessment run, derive-plan will apply this override (machine_outcome preserved).',
    ].join('\n');
  } catch (e) {
    return `Error writing override: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// swao_annotate: write a non-verdict annotation to feedback/annotations.yaml.
export function handleAnnotate(input: ToolInput): string {
  const appId      = String(input.app_id ?? '');
  const targetType = String(input.target_type ?? '');
  const targetId   = String(input.target_id ?? '');
  const text       = String(input.text ?? '');
  const workspace  = resolveWorkspace(input);
  const author     = resolveAuthor(input);

  if (!appId)       return 'Error: app_id is required.';
  if (!targetType)  return 'Error: target_type is required.';
  if (!targetId)    return 'Error: target_id is required.';
  if (!text)        return 'Error: text is required.';
  if (!workspace)   return 'Error: workspace_path is required (or run from within a SWAO workspace).';
  if (!author)      return 'Error: author is required (or set SWAO_OPERATOR env).';

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const shortId = randomUUID().replace(/-/g, '').slice(0, 8);
  const record: Record<string, unknown> = {
    annotation_id: `ANN-${today}-${shortId}`,
    target_type: targetType,
    target_id: targetId,
    author,
    timestamp: new Date().toISOString(),
    text,
  };
  const parsed = WspAnnotationRecordSchema.safeParse(record);
  if (!parsed.success) return `Error: invalid annotation: ${parsed.error.message}`;

  const annotationsPath = join(workspace, 'apps', appId, 'feedback', 'annotations.yaml');
  try {
    appendToFeedbackFile(annotationsPath, 'annotations', record);
    return [
      `Annotation recorded: ${targetType} "${targetId}"`,
      `ID: ${String(record['annotation_id'])}`,
      `Author: ${author}`,
    ].join('\n');
  } catch (e) {
    return `Error writing annotation: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// swao_feedback_list: read overrides + annotations for an app.
export function handleFeedbackList(input: ToolInput): string {
  const appId     = String(input.app_id ?? '');
  const workspace = resolveWorkspace(input);

  if (!appId)     return 'Error: app_id is required.';
  if (!workspace) return 'Error: workspace_path is required (or run from within a SWAO workspace).';

  const feedbackDir   = join(workspace, 'apps', appId, 'feedback');
  const overridesPath = join(feedbackDir, 'overrides.yaml');
  const annotPath     = join(feedbackDir, 'annotations.yaml');

  const overrides: unknown[] = [];
  const annotations: unknown[] = [];

  if (existsSync(overridesPath)) {
    try {
      const raw = load(readFileSync(overridesPath, 'utf-8')) as { overrides?: unknown[] } | null;
      const list = raw?.overrides;
      if (Array.isArray(list)) overrides.push(...list);
    } catch { /* ignore parse error */ }
  }

  if (existsSync(annotPath)) {
    try {
      const raw = load(readFileSync(annotPath, 'utf-8')) as { annotations?: unknown[] } | null;
      const list = raw?.annotations;
      if (Array.isArray(list)) annotations.push(...list);
    } catch { /* ignore parse error */ }
  }

  if (overrides.length === 0 && annotations.length === 0) {
    return `No feedback recorded for app "${appId}".`;
  }

  const lines: string[] = [`Feedback for app "${appId}":`];
  if (overrides.length > 0) {
    lines.push('', `Overrides (${overrides.length}):`);
    for (const ov of overrides) {
      const o = ov as Record<string, unknown>;
      lines.push(`  [${String(o['target_type'])}] ${String(o['target_id'])} -> ${String(o['override_outcome'])} (${String(o['author'])}, ${String(o['timestamp'])})`);
      if (o['rationale']) lines.push(`    rationale: ${String(o['rationale'])}`);
    }
  }
  if (annotations.length > 0) {
    lines.push('', `Annotations (${annotations.length}):`);
    for (const an of annotations) {
      const a = an as Record<string, unknown>;
      lines.push(`  [${String(a['target_type'])}] ${String(a['target_id'])} (${String(a['author'])}, ${String(a['timestamp'])})`);
      lines.push(`    ${String(a['text'])}`);
    }
  }
  return lines.join('\n');
}

// #1214: workspace inventory -- answers "what context files exist?", "what apps?", etc.
// without falling back to PowerShell suggestions.
function countFilesRecursive(dir: string): { total: number; bySubdir: Record<string, number> } {
  const bySubdir: Record<string, number> = {};
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) {
        total++;
      } else if (entry.isDirectory()) {
        const sub = countFilesRecursive(join(dir, entry.name));
        total += sub.total;
        bySubdir[entry.name] = sub.total;
      }
    }
  } catch { /* skip */ }
  return { total, bySubdir };
}

function handleWorkspaceInventory(input: ToolInput): string {
  const workspace = resolveWorkspace(input);
  if (!workspace) {
    return 'No workspace found. Pass workspace_path or start the MCP server with --workspace <path>.';
  }

  const lines: string[] = [`Workspace: ${workspace}`, ''];

  // Registered apps
  const appsDir = join(workspace, 'apps');
  const appEntries: string[] = [];
  let totalRuns = 0;
  if (existsSync(appsDir)) {
    let appDirs: string[];
    try {
      appDirs = readdirSync(appsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch { appDirs = []; }
    for (const appId of appDirs) {
      const hasConfig = existsSync(join(appsDir, appId, '.swao.yml'));
      const ingDir = join(appsDir, appId, 'ingestion');
      const wspDir = join(appsDir, appId, 'wsp', 'inputs');

      const ingResult = existsSync(ingDir) ? countFilesRecursive(ingDir) : { total: 0, bySubdir: {} };
      const wspResult = existsSync(wspDir) ? countFilesRecursive(wspDir) : { total: 0, bySubdir: {} };

      // Per-app run count
      const appRunsDir = join(appsDir, appId, 'wsp', 'runs');
      let appRunCount = 0;
      try { appRunCount = existsSync(appRunsDir) ? readdirSync(appRunsDir, { withFileTypes: true }).filter(d => d.isDirectory()).length : 0; } catch { /* skip */ }
      totalRuns += appRunCount;

      const latestAppTxt = join(appsDir, appId, 'wsp', 'latest-application.txt');
      const latestRun = existsSync(latestAppTxt) ? readFileSync(latestAppTxt, 'utf-8').trim().split('/').pop() ?? '' : '';

      const cfg = hasConfig ? '' : ' [no .swao.yml]';
      const runInfo = appRunCount > 0 ? ` | ${appRunCount} run(s)${latestRun ? ` (latest: ${latestRun})` : ''}` : '';

      const fileParts: string[] = [];
      if (ingResult.total > 0) {
        const subdirSummary = Object.entries(ingResult.bySubdir)
          .map(([k, v]) => `${k}: ${v}`).join(', ');
        const detail = subdirSummary ? ` (${subdirSummary})` : '';
        fileParts.push(`${ingResult.total} ingested file(s)${detail}`);
      }
      if (wspResult.total > 0) {
        const subdirSummary = Object.entries(wspResult.bySubdir)
          .map(([k, v]) => `${k}: ${v}`).join(', ');
        const detail = subdirSummary ? ` (${subdirSummary})` : '';
        fileParts.push(`${wspResult.total} context file(s) in wsp/inputs${detail}`);
      }
      if (fileParts.length === 0) fileParts.push('no context files yet');
      appEntries.push(`  ${appId}${cfg} -- ${fileParts.join(' | ')}${runInfo}`);
    }
  }
  lines.push(`Registered apps (${appEntries.length}):`);
  if (appEntries.length === 0) lines.push('  (none -- use the Setup Wizard or swao init)');
  else lines.push(...appEntries);
  lines.push('');

  // Workspace-level catalogs
  const catalogsDir = resolveCatalogsDir(workspace);
  const communityDir = join(catalogsDir, 'community');
  let fwFolders: string[] = [];
  try { fwFolders = existsSync(communityDir) ? readdirSync(communityDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : []; } catch { /* skip */ }
  lines.push(`Workspace compliance frameworks (${fwFolders.length}):`);
  if (fwFolders.length === 0) {
    lines.push(`  (none installed at ${catalogsDir})`);
    lines.push('  SWAO bundled frameworks (GDPR, BSI C5, ISO 27001, etc.) are always available via swao_frameworks_list.');
  } else {
    fwFolders.forEach(f => lines.push(`  ${f}`));
    lines.push('  Note: call swao_frameworks_list with workspace_path to see full details including bundled frameworks.');
  }
  lines.push('');

  lines.push(`Total assessment runs across all apps: ${totalRuns}`);

  return lines.join('\n');
}

function handleImport(input: ToolInput): string {
  const appId = String(input.app_id ?? '');
  const filename = String(input.filename ?? '');
  const content = String(input.content ?? '');
  const workspace = resolveWorkspace(input);

  if (!appId) return 'Error: app_id is required.';
  if (!filename) return 'Error: filename is required.';
  if (/[/\\]/.test(filename) || filename === '..' || filename === '.') {
    return `Error: filename must not contain path separators or be a traversal sequence: ${filename}`;
  }
  if (!workspace) return 'Error: workspace_path is required (or run from within a SWAO workspace).';

  // #0227 + #0230: context inputs live under <app>/wsp/inputs/, not the
  // legacy <app>/imports/. The MCP "import file" tool does not know the
  // category (cmdb / finops / ...), so the file lands at the wsp/inputs/
  // root; the operator can move it into a category subdir before the run.
  const importsDir = join(workspace, 'apps', appId, 'wsp', 'inputs');
  const targetPath = join(importsDir, filename);
  try {
    mkdirSync(importsDir, { recursive: true });
    writeFileSync(targetPath, content, 'utf-8');
    return `Imported: ${targetPath}\nPass 04 (Context Ingestion) will read this file during the next swao_assess run.`;
  } catch (e) {
    return `Error writing import file: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ---------------------------------------------------------------------------
// Phase 1 read-only tools -- Design 080 §4.1 (#1175)
// ---------------------------------------------------------------------------

export function handleFrameworksList(input: ToolInput): string {
  const workspace =
    typeof input.workspace_path === 'string' && input.workspace_path.trim()
      ? input.workspace_path.trim()
      : null;

  type FrameworkSummary = {
    id: string;
    name: string;
    authority: string;
    scope: string;
    controls_count: number;
    replaces: string[];
    source: 'bundled' | 'workspace';
  };
  const frameworks = new Map<string, FrameworkSummary>();

  const bundledReg = loadBundledRegimeRegistry(communityFrameworksDir);
  for (const [id, resolved] of bundledReg.byId) {
    if (resolved.entry.id !== id) continue;
    let name = resolved.entry.name;
    let authority = '';
    const replaces: string[] = [];
    try {
      const cat = loadRegimeCatalogue(resolved.catalogueFile);
      name = cat.regime_meta.name;
      authority = cat.regime_meta.authority;
      for (const r of cat.regime_meta.replaces ?? []) {
        replaces.push(typeof r === 'string' ? r : r.regime_id);
      }
    } catch { /* skip malformed catalogue */ }
    frameworks.set(id, {
      id,
      name,
      authority,
      scope: resolved.scope,
      controls_count: resolved.entry.controls_count,
      replaces,
      source: 'bundled',
    });
  }

  if (workspace) {
    try {
      const wsReg = loadRegimeRegistry(resolveCatalogsDir(workspace));
      for (const [id, resolved] of wsReg.byId) {
        if (resolved.entry.id !== id) continue;
        let name = resolved.entry.name;
        let authority = '';
        const replaces: string[] = [];
        try {
          const cat = loadRegimeCatalogue(resolved.catalogueFile);
          name = cat.regime_meta.name;
          authority = cat.regime_meta.authority;
          for (const r of cat.regime_meta.replaces ?? []) {
            replaces.push(typeof r === 'string' ? r : r.regime_id);
          }
        } catch { /* skip */ }
        frameworks.set(id, {
          id,
          name,
          authority,
          scope: resolved.scope,
          controls_count: resolved.entry.controls_count,
          replaces,
          source: 'workspace',
        });
      }
    } catch { /* skip unreadable workspace registry */ }
  }

  const sorted = Array.from(frameworks.values()).sort((a, b) => a.id.localeCompare(b.id));
  if (sorted.length === 0) return 'No frameworks found.';

  const lines: string[] = [`Frameworks (${sorted.length})`, '========='];
  for (const fw of sorted) {
    lines.push(`${fw.id}  [${fw.source}]`);
    lines.push(`  Name     : ${fw.name}`);
    lines.push(`  Authority: ${fw.authority}`);
    lines.push(`  Controls : ${fw.controls_count}`);
    if (fw.replaces.length > 0) lines.push(`  Replaces : ${fw.replaces.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function handleFrameworkDetail(input: ToolInput): string {
  const frameworkId =
    typeof input.framework_id === 'string' ? input.framework_id.trim() : '';
  if (!frameworkId) return 'Error: framework_id is required.';
  const workspace =
    typeof input.workspace_path === 'string' && input.workspace_path.trim()
      ? input.workspace_path.trim()
      : null;

  let catalogueFile: string | null = null;
  if (workspace) {
    try {
      const wsReg = loadRegimeRegistry(resolveCatalogsDir(workspace));
      const resolved = wsReg.byId.get(frameworkId);
      if (resolved) catalogueFile = resolved.catalogueFile;
    } catch { /* fall through to bundled */ }
  }
  if (!catalogueFile) {
    const bundledReg = loadBundledRegimeRegistry(communityFrameworksDir);
    const resolved = bundledReg.byId.get(frameworkId);
    if (resolved) catalogueFile = resolved.catalogueFile;
  }
  if (!catalogueFile) return `Framework "${frameworkId}" not found.`;

  let cat: RegimeCatalogue;
  try {
    cat = loadRegimeCatalogue(catalogueFile);
  } catch (e) {
    return `Error loading framework "${frameworkId}": ${e instanceof Error ? e.message : String(e)}`;
  }

  const m = cat.regime_meta;
  const lines: string[] = [
    `Framework: ${m.id}`,
    '='.repeat(50),
    `Name      : ${m.name}`,
    `Version   : ${m.version}`,
    `Authority : ${m.authority}`,
  ];
  if (m.description) lines.push(`Description: ${m.description}`);
  if (m.applicability_hints.length > 0)
    lines.push(`Applicable : ${m.applicability_hints.join(', ')}`);
  lines.push('');
  lines.push(`Controls (${cat.controls.length})`);
  lines.push('-'.repeat(40));
  for (const ctrl of cat.controls) {
    const sev = ctrl.severity_default ?? 'unknown';
    lines.push(`  ${ctrl.id}  [${sev}]`);
    lines.push(`    ${ctrl.title}`);
  }
  return lines.join('\n');
}

export function handleControlCatalogue(input: ToolInput): string {
  const controlId =
    typeof input.control_id === 'string' ? input.control_id.trim() : '';
  if (!controlId) return 'Error: control_id is required.';
  const workspace =
    typeof input.workspace_path === 'string' && input.workspace_path.trim()
      ? input.workspace_path.trim()
      : null;
  const filterFramework =
    typeof input.framework_id === 'string' ? input.framework_id.trim() : '';

  const tryFind = (
    byId: Map<string, ResolvedRegime>,
  ): RegimeCatalogue['controls'][number] | null => {
    for (const [id, resolved] of byId) {
      if (resolved.entry.id !== id) continue;
      if (filterFramework && resolved.entry.id !== filterFramework) continue;
      try {
        const cat = loadRegimeCatalogue(resolved.catalogueFile);
        const ctrl = cat.controls.find(c => c.id === controlId);
        if (ctrl) return ctrl;
      } catch { /* skip malformed */ }
    }
    return null;
  };

  let ctrl: RegimeCatalogue['controls'][number] | null = null;
  if (workspace) {
    try {
      ctrl = tryFind(loadRegimeRegistry(resolveCatalogsDir(workspace)).byId);
    } catch { /* fall through */ }
  }
  if (!ctrl) ctrl = tryFind(loadBundledRegimeRegistry(communityFrameworksDir).byId);
  if (!ctrl)
    return `Control "${controlId}" not found${filterFramework ? ` in framework "${filterFramework}"` : ''}.`;

  const lines: string[] = [`Control: ${ctrl.id}`, '='.repeat(50), `Title     : ${ctrl.title}`];
  if (ctrl.severity_default) lines.push(`Severity  : ${ctrl.severity_default}`);
  if (ctrl.description) lines.push(`Description: ${ctrl.description}`);
  if (ctrl.remediation) lines.push(`Remediation: ${ctrl.remediation}`);
  if (ctrl.tags.length > 0) lines.push(`Tags      : ${ctrl.tags.join(', ')}`);
  return lines.join('\n');
}

export function handlePasses(_input: ToolInput): string {
  const lines: string[] = [
    `SWAO Default Assessment Passes (${DEFAULT_PASS_NAMES.length})`,
    '='.repeat(50),
  ];
  DEFAULT_PASS_NAMES.forEach((name, i) => {
    lines.push(`  ${String(i + 1).padStart(2, ' ')}. ${name}`);
  });
  lines.push('');
  lines.push(
    `Total: ${TOTAL_DEFAULT_PASSES} passes (default; additional passes dispatched per assessment type).`,
  );
  return lines.join('\n');
}

export function handleCloudProviderCatalogue(input: ToolInput): string {
  const filterProvider =
    typeof input.provider === 'string' ? input.provider.trim().toLowerCase() : '';

  let cataloguePath: string;
  try {
    cataloguePath = resolveDefaultCataloguePath();
  } catch (e) {
    return `Error resolving cloud provider catalogue: ${e instanceof Error ? e.message : String(e)}`;
  }
  let providers;
  try {
    providers = loadCatalogue(cataloguePath);
  } catch (e) {
    return `Error loading cloud provider catalogue: ${e instanceof Error ? e.message : String(e)}`;
  }

  const filtered = filterProvider
    ? providers.filter(p => p.id.toLowerCase() === filterProvider)
    : providers;
  if (filtered.length === 0)
    return `No providers found${filterProvider ? ` matching "${filterProvider}"` : ''}.`;

  const lines: string[] = [
    `Cloud Provider Catalogue (${filtered.length} provider${filtered.length === 1 ? '' : 's'})`,
    '='.repeat(50),
  ];
  for (const prov of filtered) {
    lines.push(`Provider : ${prov.id}`);
    lines.push(`  Name            : ${prov.name}`);
    lines.push(`  Sovereign score : ${prov.sovereign_score}`);
    lines.push(`  Cost tier       : ${prov.cost_tier}`);
    lines.push(`  Lock-in risk    : ${prov.vendor_lock_in.overall_risk} (portability ${prov.vendor_lock_in.portability_score})`);
    const residency = prov.residency.data_residency_guarantees;
    if (residency.length > 0) lines.push(`  Residency       : ${residency.join('; ')}`);
    const regimes = Object.entries(prov.compliance_regime_coverage);
    if (regimes.length > 0) {
      lines.push(`  Regime coverage :`);
      for (const [regime, level] of regimes) lines.push(`    ${regime}: ${level}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const DOCS_ROOT = join(__dirname, '../../../../docs');

const SWAO_RESOURCES = [
  {
    uri: 'swao://getting-started',
    name: 'Getting Started with SWAO',
    description:
      'First-time user tutorial: what SWAO is, core concepts (signal, pass, WSP, ' +
      'dimension), step-by-step first assessment, how to read results, and common questions.',
    mimeType: 'text/markdown',
    filePath: join(DOCS_ROOT, 'getting-started.md'),
  },
  {
    uri: 'swao://assessment-dimensions',
    name: 'Assessment Dimension Catalogue',
    description:
      'Plain-language explanation of all eight scoring dimensions: 7R Migration Pattern, ' +
      'Portability Score, Legacy Indicators, Data Migration Feasibility, CI/CD Pipeline Security, ' +
      'Observability Readiness, Licence Compliance, and Testing and Quality Maturity. ' +
      'Includes score ranges, worked examples, and consultant language.',
    mimeType: 'text/markdown',
    filePath: join(DOCS_ROOT, 'assessment-dimension-catalogue.md'),
  },
  {
    uri: 'swao://index',
    name: 'Workspace discovery index',
    description:
      'Top-level discovery index for the current workspace: lists all assessed apps with ' +
      'their latest run ID, 7R label, and coverage score. Use this to enumerate apps before ' +
      'drilling into swao://app/{id}/index or calling swao_portfolio_summary.',
    mimeType: 'text/plain',
    filePath: '',
  },
] as const;

// ---------------------------------------------------------------------------
// Resource templates -- Design 080 §4.2 (#1176)
// ---------------------------------------------------------------------------

const SWAO_RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'swao://framework/{id}',
    name: 'Framework catalogue',
    description: 'Full regime metadata + controls list for framework {id}.',
    mimeType: 'text/plain',
  },
  {
    uriTemplate: 'swao://framework/{id}/control/{cid}',
    name: 'Control source definition',
    description: 'Source definition for control {cid} within framework {id}.',
    mimeType: 'text/plain',
  },
  {
    uriTemplate: 'swao://passes',
    name: 'Assessment passes',
    description: 'Canonical ordered list of all default SWAO assessment passes.',
    mimeType: 'text/plain',
  },
  {
    uriTemplate: 'swao://catalogue/{provider}',
    name: 'Cloud provider facts',
    description: 'Design-012 CSP facts for provider {provider}: sovereign score, residency, regime coverage.',
    mimeType: 'text/plain',
  },
  {
    uriTemplate: 'swao://app/{id}/index',
    name: 'App discovery index',
    description: 'Per-app enumeration of runs, signals, compliance controls, and feedback records.',
    mimeType: 'text/plain',
  },
  {
    uriTemplate: 'swao://app/{id}/wsp-summary',
    name: 'WSP summary',
    description: 'Sovereignty scores and key signals from the latest assessment run for app {id}.',
    mimeType: 'text/plain',
  },
  {
    uriTemplate: 'swao://app/{id}/run/{run_id}/manifest',
    name: 'Run manifest',
    description: 'Pass-level stats and metadata for a specific assessment run.',
    mimeType: 'text/plain',
  },
  {
    uriTemplate: 'swao://app/{id}/control/{regime}/{cid}',
    name: 'Assessed control verdict',
    description: 'Assessed outcome and evidence for control {cid} from regime {regime} in the latest run for app {id}.',
    mimeType: 'text/plain',
  },
] as const;

// App-scope discovery index (#1176 §4.3): enumerates runs, signals, controls,
// and feedback records for one app. Workspace resolved from cwd (resources do
// not accept input parameters -- all context comes from the URI).
// workspaceOverride is for testing only; production callers omit it.
export function buildAppIndex(appId: string, workspaceOverride?: string): string {
  const workspace = workspaceOverride ?? findWorkspace(process.cwd());
  if (!workspace) return `No SWAO workspace found in working directory. Run from within a workspace.`;
  const appDir = join(workspace, 'apps', appId);
  if (!existsSync(appDir)) return `App "${appId}" not found in workspace ${workspace}.`;

  const wspDir = join(appDir, 'wsp');
  const lines: string[] = [`App index: ${appId}`, '='.repeat(50)];

  // Runs -- filter to runs that contain wsp-plan.yaml (SWAO v0.7+)
  const runsDir = join(wspDir, 'runs');
  // Prefer latest-application.txt so the index marks the latest APP run (not
  // a subsequent LZ or challenge run which has no wsp-plan.yaml).
  let latestRun = '';
  for (const candidate of [join(wspDir, 'latest-application.txt'), join(wspDir, 'latest.txt')]) {
    if (existsSync(candidate)) {
      try { latestRun = readFileSync(candidate, 'utf-8').trim(); break; } catch { /* try next */ }
    }
  }
  if (existsSync(runsDir)) {
    try {
      const runs = readdirSync(runsDir).filter(e => {
        try { return readdirSync(join(runsDir, e)).includes('wsp-plan.yaml'); } catch { return false; }
      }).sort().reverse().slice(0, 10);
      lines.push('');
      lines.push(`Runs (showing latest ${runs.length})`);
      lines.push('-'.repeat(30));
      for (const run of runs) {
        const marker = `runs/${run}` === latestRun ? ' [latest]' : '';
        lines.push(`  ${run}${marker}`);
        lines.push(`    swao://app/${appId}/run/${run}/manifest`);
      }
    } catch { /* skip */ }
  }

  // Signals from latest run pass files (outcome enum: positive/negative/neutral/indeterminate)
  const latestRunDir = latestRun ? join(wspDir, latestRun) : null;
  if (latestRunDir && existsSync(latestRunDir)) {
    try {
      const allSignals = loadAllSignals(latestRunDir);
      const negativeSignals = allSignals.filter(s => s.outcome === 'negative');
      lines.push('');
      lines.push(`Signals (${allSignals.length} total, ${negativeSignals.length} negative outcome)`);
      lines.push('-'.repeat(30));
      for (const s of negativeSignals.slice(0, 20)) {
        lines.push(`  [${s.severity ?? '?'}] ${s.id ?? 'unknown'}`);
      }
      if (negativeSignals.length > 20) lines.push(`  ... and ${negativeSignals.length - 20} more`);
    } catch { /* skip */ }
  }

  // Compliance controls from latest run wsp-plan.yaml (control fields: id, outcome)
  const planYaml = latestRunDir ? join(latestRunDir, 'wsp-plan.yaml') : null;
  if (planYaml && existsSync(planYaml)) {
    try {
      const plan = safeReadYamlMcp<PlanShape>(planYaml);
      const regimes = plan?.compliance?.regimes ?? [];
      let total = 0;
      let failed = 0;
      for (const reg of regimes) {
        for (const ctrl of reg.controls ?? []) {
          total++;
          if (ctrl.outcome === 'GAP' || ctrl.outcome === 'PARTIAL') failed++;
        }
      }
      lines.push('');
      lines.push(`Compliance controls (${total} total, ${failed} failed/gap)`);
      lines.push('-'.repeat(30));
      for (const reg of regimes) {
        const regFailed = (reg.controls ?? []).filter(c => c.outcome === 'GAP' || c.outcome === 'PARTIAL');
        if (regFailed.length > 0) {
          lines.push(`  Regime: ${reg.id ?? '?'}`);
          for (const ctrl of regFailed.slice(0, 10)) {
            lines.push(`    [${ctrl.outcome ?? '?'}] ${ctrl.id ?? '?'}  -- swao://app/${appId}/control/${reg.id ?? '?'}/${ctrl.id ?? '?'}`);
          }
        }
      }
    } catch { /* skip */ }
  }

  // Evidence and feedback records
  const evidenceYaml = join(wspDir, 'wsp-evidence.yaml');
  if (existsSync(evidenceYaml)) {
    try {
      type EvidenceShape = { evidence?: unknown[] };
      const ev = load(readFileSync(evidenceYaml, 'utf-8')) as EvidenceShape | null;
      const count = Array.isArray(ev?.evidence) ? ev.evidence.length : 0;
      lines.push('');
      lines.push(`Evidence records: ${count}`);
    } catch { /* skip */ }
  }

  return lines.join('\n');
}

// Resolve a parameterised resource URI to text content.
// Returns null if the URI does not match any template.
function resolveResourceTemplate(uri: string): string | null {
  // swao://passes (static pass list -- reuses handlePasses)
  if (uri === 'swao://passes') return handlePasses({});

  // swao://framework/{id}
  const fwMatch = uri.match(/^swao:\/\/framework\/([^/]+)$/);
  if (fwMatch) return handleFrameworkDetail({ framework_id: fwMatch[1] });

  // swao://framework/{id}/control/{cid}
  const fwCtrlMatch = uri.match(/^swao:\/\/framework\/([^/]+)\/control\/([^/]+)$/);
  if (fwCtrlMatch)
    return handleControlCatalogue({ framework_id: fwCtrlMatch[1], control_id: fwCtrlMatch[2] });

  // swao://catalogue/{provider}
  const catMatch = uri.match(/^swao:\/\/catalogue\/([^/]+)$/);
  if (catMatch) return handleCloudProviderCatalogue({ provider: catMatch[1] });

  // swao://app/{id}/index
  const appIndexMatch = uri.match(/^swao:\/\/app\/([^/]+)\/index$/);
  if (appIndexMatch) return buildAppIndex(appIndexMatch[1]);

  // swao://app/{id}/wsp-summary
  const wspSummaryMatch = uri.match(/^swao:\/\/app\/([^/]+)\/wsp-summary$/);
  if (wspSummaryMatch) {
    const appId = wspSummaryMatch[1];
    const workspace = findWorkspace(process.cwd());
    if (!workspace) return 'No SWAO workspace found in working directory.';
    return handleSignals({ app_id: appId, workspace_path: workspace });
  }

  // swao://app/{id}/run/{run_id}/manifest
  const manifestMatch = uri.match(/^swao:\/\/app\/([^/]+)\/run\/([^/]+)\/manifest$/);
  if (manifestMatch) {
    const [, appId, runId] = manifestMatch;
    const workspace = findWorkspace(process.cwd());
    if (!workspace) return 'No SWAO workspace found in working directory.';
    const runDir = join(workspace, 'apps', appId, 'wsp', 'runs', runId);
    const manifestPath = join(runDir, 'run-manifest.json');
    if (!existsSync(manifestPath)) return `Run manifest not found for ${appId}/${runId}.`;
    try {
      return JSON.stringify(JSON.parse(readFileSync(manifestPath, 'utf-8')), null, 2);
    } catch { return `Error reading manifest for ${appId}/${runId}.`; }
  }

  // swao://app/{id}/control/{regime}/{cid}
  const ctrlDetailMatch = uri.match(/^swao:\/\/app\/([^/]+)\/control\/([^/]+)\/([^/]+)$/);
  if (ctrlDetailMatch) {
    const [, appId, _regime, cid] = ctrlDetailMatch;
    const workspace = findWorkspace(process.cwd());
    if (!workspace) return 'No SWAO workspace found in working directory.';
    return handleControlDetail({ app_id: appId, control_id: cid, workspace_path: workspace });
  }

  return null;
}

// MCP Prompt: swao_evidence_interview (#1180)
// Returns a PromptMessage[] checklist of open signals + open GAP/PARTIAL controls
// so the LLM can walk the user through gathering evidence for each item.
export function buildEvidenceInterviewPrompt(
  args: Record<string, string>,
): { description: string; messages: Array<{ role: string; content: { type: string; text: string } }> } {
  const appId      = args['app_id'] ?? '';
  const sigFilter  = args['signal_filter'] ?? '';
  const ctlFilter  = args['control_filter'] ?? '';
  const minSev     = (args['min_severity'] ?? '').toLowerCase();
  const wsOverride = args['workspace_path'] ?? '';

  if (!appId) {
    return {
      description: 'swao_evidence_interview -- error',
      messages: [{ role: 'user', content: { type: 'text', text: 'Error: app_id is required.' } }],
    };
  }

  const workspace = wsOverride || findWorkspace(process.cwd());
  if (!workspace) {
    return {
      description: 'swao_evidence_interview -- error',
      messages: [{ role: 'user', content: { type: 'text', text: 'Error: no SWAO workspace found.' } }],
    };
  }

  const wspDir = join(workspace, 'apps', appId, 'wsp');
  if (!existsSync(wspDir)) {
    return {
      description: 'swao_evidence_interview -- error',
      messages: [{ role: 'user', content: { type: 'text', text: `Error: app "${appId}" not found in workspace.` } }],
    };
  }

  const SEV_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const minSevIdx = SEV_ORDER[minSev] ?? 0;

  // --- Signals ---
  const latestRun = resolveLatestRunDir(workspace, appId, 'latest-application.txt');
  const signalLines: string[] = [];
  if (latestRun) {
    const signals = loadAllSignals(latestRun);
    for (const s of signals) {
      if (s.outcome !== 'negative') continue;
      if (sigFilter && s.id !== sigFilter) continue;
      const sev = (s.severity ?? 'low').toLowerCase();
      if ((SEV_ORDER[sev] ?? 0) < minSevIdx) continue;
      const desc = s.derivation ?? s.id ?? '(no description)';
      signalLines.push(`- [${s.id ?? '?'}] ${desc} (severity: ${s.severity ?? 'unknown'})`);
    }
  }

  // --- Open controls (GAP or PARTIAL) ---
  const controlLines: string[] = [];
  const planPath = latestRun ? join(latestRun, 'wsp-plan.yaml') : null;
  if (planPath && existsSync(planPath)) {
    try {
      const plan = load(readFileSync(planPath, 'utf-8')) as {
        compliance?: { regimes?: Array<{ id: string; controls?: Array<{ id: string; outcome?: string }> }> };
      } | null;
      for (const regime of plan?.compliance?.regimes ?? []) {
        for (const ctrl of regime.controls ?? []) {
          const outcome = ctrl.outcome ?? '';
          if (outcome !== 'GAP' && outcome !== 'PARTIAL') continue;
          if (ctlFilter && ctrl.id !== ctlFilter) continue;
          controlLines.push(`- [${ctrl.id}] (${regime.id}) -- ${outcome}`);
        }
      }
    } catch { /* no plan available */ }
  }

  const sections: string[] = [];
  sections.push(`# Evidence Interview: ${appId}`);
  sections.push('');
  sections.push('Below is a checklist of open issues. For each item:');
  sections.push('1. Ask the user to describe the evidence they have (or plan to gather).');
  sections.push('2. Record the evidence with `swao_evidence_capture`, setting `addresses` to the item id.');
  sections.push('3. Note: a single evidence record can address multiple items -- pass all relevant ids.');
  sections.push('');

  if (signalLines.length > 0) {
    sections.push('## Negative Signals');
    sections.push(...signalLines);
    sections.push('');
  }
  if (controlLines.length > 0) {
    sections.push('## Open Compliance Controls (GAP / PARTIAL)');
    sections.push(...controlLines);
    sections.push('');
  }
  if (signalLines.length === 0 && controlLines.length === 0) {
    sections.push('No open issues found for this application.');
    if (!latestRun) sections.push('(No assessment run has been completed yet.)');
  }

  sections.push('---');
  sections.push(`app_id for swao_evidence_capture: ${appId}`);

  return {
    description: `Evidence interview checklist for ${appId} (${signalLines.length} signals, ${controlLines.length} controls)`,
    messages: [{ role: 'user', content: { type: 'text', text: sections.join('\n') } }],
  };
}

// ---------------------------------------------------------------------------
// swao://index -- workspace discovery (#1194)
// ---------------------------------------------------------------------------

export function buildWorkspaceIndex(): string {
  const workspace = findWorkspace(process.cwd());
  if (!workspace) return 'No SWAO workspace found. Run from inside a workspace directory.';
  const appsDir = join(workspace, 'apps');
  if (!existsSync(appsDir)) return `No apps directory found in workspace ${workspace}.`;
  let appIds: string[];
  try { appIds = readdirSync(appsDir); } catch { return 'Could not read apps directory.'; }
  if (appIds.length === 0) return 'No apps found in workspace.';
  const lines = [
    `Workspace: ${workspace}`,
    `Apps: ${appIds.length}`,
    '',
    'App ID               Latest Run                   See',
    '-------------------- ---------------------------- ----------------------------------------',
  ];
  for (const appId of appIds) {
    const latestFile = join(appsDir, appId, 'wsp', 'latest.txt');
    let latestRun = '(none)';
    if (existsSync(latestFile)) {
      try { latestRun = readFileSync(latestFile, 'utf-8').trim(); } catch { /* skip */ }
    }
    const seeUri = `swao://app/${appId}/index`;
    lines.push(`${appId.padEnd(20)} ${latestRun.padEnd(28)} ${seeUri}`);
  }
  lines.push('');
  lines.push('Use swao_portfolio_summary for aggregate stats across all apps.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Argument completions (#1194 -- Design 080 §9)
// ---------------------------------------------------------------------------

function completionValues(argName: string, argValue: string): string[] {
  const prefix = argValue.toLowerCase();
  switch (argName) {
    case 'framework_id': {
      try {
        const reg = loadBundledRegimeRegistry(communityFrameworksDir);
        const ids: string[] = [];
        for (const [id] of reg.byId) {
          if (id.toLowerCase().startsWith(prefix)) ids.push(id);
          if (ids.length >= 20) break;
        }
        return ids;
      } catch { return []; }
    }
    case 'provider': {
      const workspace = findWorkspace(process.cwd());
      if (!workspace) return [];
      const catalogsDir = resolveCatalogsDir(workspace);
      if (!existsSync(catalogsDir)) return [];
      const providers: string[] = [];
      try {
        for (const entry of readdirSync(catalogsDir)) {
          if (entry.toLowerCase().startsWith(prefix)) providers.push(entry);
          if (providers.length >= 20) break;
        }
      } catch { /* ignore */ }
      return providers;
    }
    case 'app_id': {
      const workspace = findWorkspace(process.cwd());
      if (!workspace) return [];
      const appsDir = join(workspace, 'apps');
      if (!existsSync(appsDir)) return [];
      try {
        return readdirSync(appsDir)
          .filter(id => id.toLowerCase().startsWith(prefix))
          .slice(0, 20);
      } catch { return []; }
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------

function buildMcpServer(): Server {
  const server = new Server(
    { name: 'swao', version: '1.0.0' },
    {
      capabilities: { tools: {}, resources: {}, prompts: {}, logging: {}, completions: {} },
      instructions:
        'SWAO (Sovereign Workload Assessment and Onboarding) tools for cloud migration analysis. ' +
        'TOOL NAMING: The health check tool is swao_health_check -- never call it "doctor" or "swao doctor". ' +
        'For the MCP build version or a tool overview, call the swao tool (not swao_health_check). ' +
        'GROUNDING RULE: Base all answers about a specific application -- cloud providers, landing zone ' +
        'targets, compliance findings, remediation steps, service names, and any other factual claims -- ' +
        'exclusively on data returned by SWAO tools in this session (swao_assess, swao_report, ' +
        'swao_signals, swao_explain_landing_zone, swao_risks, swao_costs). ' +
        'Do NOT introduce provider names, compliance interpretations, or remediation details from your ' +
        'general training knowledge unless SWAO\'s output is explicitly absent on that point. ' +
        'When SWAO data is missing or incomplete, say so explicitly (e.g. "SWAO did not record a primary ' +
        'landing zone for this run") rather than inferring or substituting from training knowledge. ' +
        'CRITICAL WRITING RULE: Never output em-dash characters (Unicode U+2014) or en-dash characters (Unicode U+2013). ' +
        'Use two hyphens (--) or a plain hyphen (-) in their place. ' +
        'Additional rules: British English spelling, no emojis, evidence-first (cite file paths and section numbers).',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: SWAO_MCP_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const input = (args ?? {}) as ToolInput;

    const progressToken = (request.params._meta as Record<string, unknown> | undefined)?.progressToken as
      | string
      | number
      | undefined;
    const progressNotifier: AssessProgressNotifier | null = progressToken !== undefined
      ? (event) => {
          void server.notification({
            method: 'notifications/progress',
            params: { progressToken, progress: event.progress, total: event.total, message: event.message },
          });
        }
      : null;

    let text: string;
    switch (name) {
      case 'swao':                        text = WELCOME;                          break;
      case 'swao_assess':                 text = await handleAssessWithProgress(input, progressNotifier); break;
      case 'swao_report':                 text = handleReport(input);              break;
      case 'swao_health_check':           text = handleHealthCheck(input);         break;
      case 'swao_challenge':              text = handleChallenge(input);           break;
      case 'swao_ingest':                  text = handleIngest(input);             break;
      case 'swao_evidence_capture':        text = handleEvidenceCapture(input);    break;
      case 'swao_risk_import':            text = await handleRiskImport(input);   break;
      case 'swao_feedback_add':           text = handleFeedbackAdd(input);         break;
      case 'swao_annotate':              text = handleAnnotate(input);             break;
      case 'swao_feedback_list':          text = handleFeedbackList(input);        break;
      case 'swao_import':                 text = handleImport(input);              break;
      case 'swao_signal_detail':           text = handleSignalDetail(input);       break;
      case 'swao_signals':                 text = handleSignals(input);             break;
      case 'swao_explain_landing_zone':   text = handleExplainLandingZone(input); break;
      case 'swao_control_detail':         text = handleControlDetail(input);       break;
      case 'swao_costs':                  text = handleCosts(input);               break;
      case 'swao_risks':                  text = handleRisks(input);               break;
      case 'swao_portfolio_summary':      text = handlePortfolioSummary(input);    break;
      case 'swao_portfolio_query':        text = handlePortfolioQuery(input);      break;
      case 'swao_portfolio_stats':        text = handlePortfolioStats(input);      break;
      case 'swao_portfolio_risks':        text = handlePortfolioRisks(input);      break;
      case 'swao_portfolio_lz':           text = handlePortfolioLz(input);         break;
      case 'swao_lzr_weights':            text = handleLzrWeights(input);          break;
      case 'swao_publish':                text = _handlePublish(input);            break;
      case 'swao_publish_site':           text = _handlePublishSite(input);        break;
      case 'swao_hub':                    text = _handleHub(input);                break;
      case 'swao_lenses':                 text = _handleLenses(input);             break;
      case 'swao_normalize':              text = _handleNormalize(input);          break;
      case 'swao_portal_query':           text = _handlePortalQuery(input);        break;
      case 'swao_lz_catalogue':           text = _handleLzCatalogue(input);        break;
      case 'swao_lz_catalogue_list':      text = _handleLzCatalogueList(input);    break;
      case 'swao_lz_catalogue_show':      text = _handleLzCatalogueShow(input);    break;
      case 'swao_lz_fit':                 text = _handleLzFit(input);              break;
      case 'swao_frameworks_list':        text = handleFrameworksList(input);           break;
      case 'swao_framework_detail':       text = handleFrameworkDetail(input);          break;
      case 'swao_control_catalogue':      text = handleControlCatalogue(input);         break;
      case 'swao_passes':                 text = handlePasses(input);                   break;
      case 'swao_cloud_provider_catalogue': text = handleCloudProviderCatalogue(input); break;
      case 'swao_workspace_inventory':    text = handleWorkspaceInventory(input);    break;
      default:
        return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
    }

    // Logging: surface [WARN] lines as notifications/message to the client log pane (#1194).
    if (text.includes('[WARN]')) {
      for (const line of text.split('\n')) {
        if (line.startsWith('[WARN]')) {
          void server.sendLoggingMessage({ level: 'warning', data: line });
        }
      }
    }

    return { content: [{ type: 'text' as const, text }] };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: SWAO_RESOURCES.map(r => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: SWAO_RESOURCE_TEMPLATES.map(t => ({
      uriTemplate: t.uriTemplate,
      name: t.name,
      description: t.description,
      mimeType: t.mimeType,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    // Dynamic workspace discovery index -- swao://index (#1194)
    if (uri === 'swao://index') {
      return { contents: [{ uri, mimeType: 'text/plain', text: buildWorkspaceIndex() }] };
    }

    // Static file resources (original behaviour)
    const resource = SWAO_RESOURCES.find(r => r.uri === uri);
    if (resource) {
      let text: string;
      try {
        text = readFileSync(resource.filePath, 'utf-8');
      } catch {
        text = `Resource file not found: ${resource.filePath}`;
      }
      return { contents: [{ uri, mimeType: resource.mimeType, text }] };
    }

    // Parameterised resource templates (#1176)
    const templateText = resolveResourceTemplate(uri);
    if (templateText !== null) {
      return { contents: [{ uri, mimeType: 'text/plain', text: templateText }] };
    }

    return {
      contents: [{ uri, mimeType: 'text/plain', text: `Unknown resource: ${uri}` }],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'swao_evidence_interview',
        description:
          'Build an issue checklist from negative signals + open GAP/PARTIAL controls ' +
          'and guide the user through evidence capture. Call swao_evidence_capture for each item.',
        arguments: [
          { name: 'app_id', description: 'App ID from the workspace (required)', required: true },
          { name: 'signal_filter', description: 'Limit to a specific signal ID', required: false },
          { name: 'control_filter', description: 'Limit to a specific control ID', required: false },
          { name: 'min_severity', description: 'Minimum signal severity: low|medium|high|critical', required: false },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    if (name === 'swao_evidence_interview') {
      return buildEvidenceInterviewPrompt(args as Record<string, string>);
    }
    return { description: `Unknown prompt: ${name}`, messages: [] };
  });

  // Argument completions for resource templates (#1194 -- Design 080 §9).
  // Completes {id} for swao://app/{id}/*, {id} for swao://framework/{id},
  // and {provider} for swao://catalogue/{provider}.
  server.setRequestHandler(CompleteRequestSchema, async (request) => {
    const { ref, argument } = request.params;
    const argName  = argument.name;
    const argValue = argument.value ?? '';

    if (ref.type === 'ref/resource') {
      const tplUri = ref.uri;
      let completionArg = argName;
      if (tplUri.startsWith('swao://app/') && argName === 'id') {
        completionArg = 'app_id';
      } else if (tplUri.startsWith('swao://framework/') && argName === 'id') {
        completionArg = 'framework_id';
      } else if (tplUri.startsWith('swao://catalogue/') && argName === 'provider') {
        completionArg = 'provider';
      }
      const values = completionValues(completionArg, argValue);
      return { completion: { values, total: values.length, hasMore: false } };
    }

    if (ref.type === 'ref/prompt' && ref.name === 'swao_evidence_interview') {
      const values = completionValues(argName, argValue);
      if (values.length > 0) return { completion: { values, total: values.length, hasMore: false } };
    }

    return { completion: { values: [], total: 0, hasMore: false } };
  });

  return server;
}

function killProcessOnPort(port: number): void {
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf-8' });
      const line = (result.stdout ?? '').split('\n')
        .find(l => l.includes(`:${port}`) && l.toUpperCase().includes('LISTENING'));
      if (line) {
        const pid = line.trim().split(/\s+/).at(-1);
        if (pid && /^\d+$/.test(pid)) {
          spawnSync('taskkill', ['/F', '/PID', pid]);
        }
      }
    } else {
      const result = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf-8' });
      const pid = (result.stdout ?? '').trim();
      if (pid && /^\d+$/.test(pid)) {
        process.kill(Number(pid), 'SIGKILL');
      }
    }
  } catch {
    // best-effort; proceed to listen() regardless
  }
}

export async function startMcpServer(
  opts: { http?: boolean; port?: number; workspace?: string } = {},
  deps?: McpHostDeps,
): Promise<void> {
  // Capture the host-injected CLI invocation before any transport connects, so
  // every runSwao / runSwaoAssessAsync call spawns the correct swao entry (#0574).
  if (deps) hostDeps = deps;
  // Pin workspace from --workspace flag (#1203); resolveWorkspace falls back to
  // this when no workspace_path arg is provided and findWorkspace(cwd) returns null.
  if (opts.workspace) mcpPinnedWorkspace = opts.workspace;
  if (opts.http) {
    const port = opts.port ?? 3737;
    const sessions = new Map<string, StreamableHTTPServerTransport>();
    const httpServer = createServer(async (req, res) => {
      if (req.url !== '/mcp') {
        res.writeHead(404).end('Not found');
        return;
      }
      let parsedBody: unknown;
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        try {
          parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        } catch {
          res.writeHead(400).end('Bad Request');
          return;
        }
      }
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId && sessions.has(sessionId)) {
        await sessions.get(sessionId)!.handleRequest(req, res, parsedBody);
      } else if (!sessionId && isInitializeRequest(parsedBody)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => { sessions.set(id, transport); },
        });
        transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
        const server = buildMcpServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, parsedBody);
      } else {
        res.writeHead(400).end('Bad request: no session');
      }
    });
    killProcessOnPort(port);
    await new Promise<void>((resolve, reject) => {
      httpServer.on('error', reject);
      httpServer.listen(port, '127.0.0.1', () => {
        process.stderr.write(`SWAO MCP HTTP server listening on http://localhost:${port}/mcp\n`);
        const pidFile = pathJoin(tmpdir(), `swao-mcp-${port}.pid`);
        try { writeFileSync(pidFile, String(process.pid), 'utf-8'); } catch { /* non-fatal */ }
        process.once('exit', () => { try { unlinkSync(pidFile); } catch { /* already gone */ } });
        resolve();
      });
    });
    await new Promise<void>((_, reject) => httpServer.on('close', () => reject(new Error('HTTP server closed'))));
  } else {
    const server = buildMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}
