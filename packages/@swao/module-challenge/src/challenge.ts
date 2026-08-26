// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Challenge module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { createInterface } from 'readline';
import { dump, load } from 'js-yaml';
import type { Command } from 'commander';
import { LicenseGuard, LicenseTierError, LicenseLimitError, LicenseInvalidError, logApp, logPortfolio, CredentialStore } from '@swao/core';
// #0580: LlmProvider is a TYPE re-exported by @swao/core (plugin-types), so this
// module imports it from core. createLlmProvider is a FUNCTION owned by the
// sibling @swao/module-llm-providers; a `@swao/module-*` must not import a
// sibling module, so it is INJECTED into registerChallenge via ChallengeDeps and
// wired by the host at the registration call site (mirrors the #0573 doctor
// probe-builder and #0574 mcp CLI-path dependency-injection pattern).
import type { LlmProvider } from '@swao/core';
import { buildWspSummary, buildLzWspSummary } from './challenge/loader.js';
import { buildSystemPrompt as buildApplicationArchitectPrompt } from './challenge/prompts/application-architect.js';
import { buildSystemPrompt as buildBusinessOwnerPrompt } from './challenge/prompts/business-owner.js';
import { buildSystemPrompt as buildGrcPrompt } from './challenge/prompts/grc-compliance-officer.js';
import { buildSystemPrompt as buildFinopsPrompt } from './challenge/prompts/finops-lead.js';
import { buildSystemPrompt as buildProgrammeManagerPrompt } from './challenge/prompts/programme-manager.js';
import { buildSystemPrompt as buildLzSovereigntyGrcPrompt } from './challenge/prompts/lzca-sovereignty-grc.js';
import { buildSystemPrompt as buildLzArchitectPrompt } from './challenge/prompts/lzca-lz-architect.js';
import { buildSystemPrompt as buildLzProcurementPrompt } from './challenge/prompts/lzca-procurement.js';
import { buildSystemPrompt as buildLzCisoPrompt } from './challenge/prompts/lzca-ciso-security.js';
import type { WspSummary, LzWspSummary } from './challenge/types.js';

/** Minimal LLM config shape -- mirrors LlmProviderConfig from @swao/module-llm-providers.
 *  Defined here so this module never imports the sibling provider module (#0580). */
export interface ChallengeLlmConfig {
  connector?: string;
  env?: string;
  workspaceRoot?: string;
  type?: string;
  model?: string;
  temperature?: number;
  seed?: number;
}

/**
 * Factory that builds an LlmProvider for a given app / pass. Matches the
 * `createLlmProvider` signature exported by @swao/module-llm-providers; the
 * host injects that concrete factory (#0580). Kept as a thin function type so
 * this module never imports the sibling module.
 */
export type CreateLlmProvider = (appId?: string, passName?: string, config?: ChallengeLlmConfig) => LlmProvider;

/** Host dependencies injected into registerChallenge (#0580). */
export interface ChallengeDeps {
  createLlmProvider: CreateLlmProvider;
}

const UPGRADE_MESSAGE = [
  '[LICENSE] The challenge command requires an Enterprise license.',
  'Run `swao license request` to obtain a license.',
  'Contact: https://github.com/Accenture/SWAO/discussions',
].join('\n');

// Canonical persona taxonomy (#0286) relocated to @swao/core in #0580 -- it is a
// shared contract between the Community `report` command and this Enterprise
// module, so it cannot live here (a Community->Enterprise-module edge breaks
// per-tier builds, #0583). This module uses AGENT_IDS + AgentId internally; the
// module index re-exports the full taxonomy from @swao/core for its consumers.
import { AGENT_IDS } from '@swao/core';
import type { AgentId } from '@swao/core';

/**
 * Extract the findings array from a parsed LLM challenge output.
 * Canonical format: top-level `findings: [...]`.
 * LLMs frequently wrap their output in an arbitrary envelope object
 * (assessment_review, review_session, compliance_review_opening, etc.).
 * When top-level findings is absent or empty, scan all top-level object
 * values for the first non-empty `findings` array.
 */
function extractFindings(parsed: Record<string, unknown> | null): Array<Record<string, unknown>> {
  if (!parsed) return [];
  const top = parsed['findings'];
  if (Array.isArray(top) && top.length > 0) return top as Array<Record<string, unknown>>;
  for (const val of Object.values(parsed)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const nested = (val as Record<string, unknown>)['findings'];
      if (Array.isArray(nested) && nested.length > 0) {
        return nested as Array<Record<string, unknown>>;
      }
    }
  }
  return [];
}

export function getPromptBuilder(agentId: AgentId): (wsp: WspSummary) => string {
  switch (agentId) {
    case 'application-architect': return buildApplicationArchitectPrompt;
    case 'business-owner': return buildBusinessOwnerPrompt;
    case 'grc-compliance-officer': return buildGrcPrompt;
    case 'finops-lead': return buildFinopsPrompt;
    case 'programme-manager': return buildProgrammeManagerPrompt;
  }
}

// -----------------------------------------------------------------------
// LZ Sovereignty Challenge agent taxonomy (#1109)
// Separate from AGENT_IDS (App assessment). Output prefix: LZCA_
// -----------------------------------------------------------------------
export const LZ_AGENT_IDS = {
  'lzca-sovereignty-grc': 'Sovereignty / GRC Reviewer',
  'lzca-lz-architect':    'Landing Zone Architect',
  'lzca-procurement':     'Procurement / Vendor Management',
  'lzca-ciso-security':   'CISO / Security',
} as const;
export type LzAgentId = keyof typeof LZ_AGENT_IDS;

export function getLzPromptBuilder(agentId: LzAgentId): (lz: LzWspSummary) => string {
  switch (agentId) {
    case 'lzca-sovereignty-grc': return buildLzSovereigntyGrcPrompt;
    case 'lzca-lz-architect':    return buildLzArchitectPrompt;
    case 'lzca-procurement':     return buildLzProcurementPrompt;
    case 'lzca-ciso-security':   return buildLzCisoPrompt;
  }
}

export const CONTEXT_TURN_LIMIT = 40;

export interface AgentReportEntry {
  agent_id: AgentId;
  agent_role: string;
  report: string;
}

export interface CombinedChallengeReport {
  assessed_at: string;
  app_id: string;
  agent_count: number;
  reports: AgentReportEntry[];
}

export interface CombinedReportValidationError {
  field: string;
  message: string;
}

/** Structural validator for CombinedChallengeReport -- called before writing to disk. */
export function validateCombinedReport(data: unknown): CombinedReportValidationError[] {
  const errs: CombinedReportValidationError[] = [];
  if (!data || typeof data !== 'object') return [{ field: 'root', message: 'Not an object' }];
  const d = data as Record<string, unknown>;
  if (!d['assessed_at'] || isNaN(new Date(String(d['assessed_at'])).getTime()))
    errs.push({ field: 'assessed_at', message: 'Missing or invalid ISO date' });
  if (!d['app_id'] || typeof d['app_id'] !== 'string')
    errs.push({ field: 'app_id', message: 'Missing or non-string app_id' });
  if (typeof d['agent_count'] !== 'number')
    errs.push({ field: 'agent_count', message: 'Missing or non-numeric agent_count' });
  if (!Array.isArray(d['reports'])) {
    errs.push({ field: 'reports', message: 'Missing or non-array reports' });
  } else {
    for (const [i, rep] of (d['reports'] as unknown[]).entries()) {
      if (!rep || typeof rep !== 'object') { errs.push({ field: `reports[${i}]`, message: 'Not an object' }); continue; }
      const r = rep as Record<string, unknown>;
      if (!r['agent_id'] || typeof r['agent_id'] !== 'string')
        errs.push({ field: `reports[${i}].agent_id`, message: 'Missing or non-string' });
      if (!r['agent_role'] || typeof r['agent_role'] !== 'string')
        errs.push({ field: `reports[${i}].agent_role`, message: 'Missing or non-string' });
      if (typeof r['report'] !== 'string' || (r['report'] as string).length === 0)
        errs.push({ field: `reports[${i}].report`, message: 'Missing or empty report body' });
    }
  }
  return errs;
}

export async function runChallengeReport(
  agentId: AgentId,
  wsp: WspSummary,
  llm: LlmProvider,
): Promise<string> {
  const systemPrompt = getPromptBuilder(agentId)(wsp);
  const instruction =
    'Produce a structured YAML challenge report. List your findings as an array under ' +
    '`findings:` with fields: id (CR-<ROLE>-NN), concern, evidence_gap, recommended_question. ' +
    'Include 3 to 7 findings ordered by severity.';
  const prompt = `${systemPrompt}\n\n${instruction}`;
  return llm.complete(prompt);
}

export async function runAllAgentsReport(
  wsp: WspSummary,
  getLlm: (agentId: AgentId) => LlmProvider,
): Promise<CombinedChallengeReport> {
  const agentIds = Object.keys(AGENT_IDS) as AgentId[];
  const reports = await Promise.all(
    agentIds.map(async (agentId) => ({
      agent_id: agentId,
      agent_role: AGENT_IDS[agentId],
      report: await runChallengeReport(agentId, wsp, getLlm(agentId)),
    })),
  );
  return {
    assessed_at: new Date().toISOString(),
    app_id: wsp.appId,
    agent_count: agentIds.length,
    reports,
  };
}

export interface ChallengeSessionOpts {
  contextLimit?: number;
  onContextWarning?: (turnsUsed: number, limit: number) => void;
}

export async function runChallengeSession(
  agentId: AgentId,
  wsp: WspSummary,
  llm: LlmProvider,
  rl: ReturnType<typeof createInterface>,
  onLine: (line: string) => void,
  opts: ChallengeSessionOpts = {},
): Promise<{ transcript: Array<{ role: string; content: string }>; contextWarningFired: boolean }> {
  const systemPrompt = getPromptBuilder(agentId)(wsp);
  const transcript: Array<{ role: string; content: string }> = [];
  const limit = opts.contextLimit ?? CONTEXT_TURN_LIMIT;
  const warnAt = Math.floor(limit * 0.8);
  let userTurns = 0;
  let contextWarningFired = false;

  // Opening turn: agent identifies 2-3 primary concerns
  const openingPrompt = `${systemPrompt}\n\nASSISTANT:`;
  const agentOpening = await llm.complete(openingPrompt);
  transcript.push({ role: 'assistant', content: agentOpening });
  onLine(agentOpening);

  let history = `\n\nASSISTANT: ${agentOpening}`;

  await new Promise<void>(resolve_ => {
    rl.on('line', async (input: string) => {
      const trimmed = input.trim();
      if (trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
        resolve_();
        return;
      }
      userTurns++;
      if (!contextWarningFired && userTurns >= warnAt) {
        contextWarningFired = true;
        opts.onContextWarning?.(userTurns, limit);
      }
      transcript.push({ role: 'user', content: trimmed });
      history += `\n\nUSER: ${trimmed}\n\nASSISTANT:`;
      const fullPrompt = `${systemPrompt}${history}`;
      const agentResponse = await llm.complete(fullPrompt);
      transcript.push({ role: 'assistant', content: agentResponse });
      history += ` ${agentResponse}`;
      onLine(agentResponse);
    });

    rl.once('close', () => resolve_());
  });

  return { transcript, contextWarningFired };
}

interface ChallengeOptions {
  agent?: string;
  allAgents?: boolean;
  app: string;
  workspace?: string;
  report?: boolean;
  output?: string;
  focus?: string;
  save?: boolean;
  json?: boolean;
  /** #1109: 'app' (default) = App Assessment challenge; 'lz' = LZ Sovereignty Challenge. */
  type?: 'app' | 'lz';
  /** #1587: connector override for per-leg LLM assessment challenge invocation. */
  connector?: string;
  /** #1587: model override for per-leg LLM assessment challenge invocation. */
  model?: string;
}

/**
 * Bootstraps LLM credentials from the CredentialStore into process.env when
 * the env vars are absent (#1156). Mirrors the pattern in assess.ts so that
 * vault-only setups (no plaintext env vars) work identically across commands.
 * Exported for unit-testability.
 */
export function bootstrapCredentialsFromVault(): void {
  const store = new CredentialStore();
  const stored = store.loadSync();
  if (!process.env['SWAO_LLM_PROVIDER']) {
    const anthropicKey = stored['anthropic-api-key'];
    const openaiKey    = stored['openai-api-key'];
    if (anthropicKey && !process.env['SWAO_ANTHROPIC_API_KEY'] && !process.env['ANTHROPIC_API_KEY']) {
      process.env['SWAO_ANTHROPIC_API_KEY'] = anthropicKey;
      process.env['SWAO_LLM_PROVIDER']      = 'anthropic';
    } else if (openaiKey && !process.env['SWAO_OPENAI_API_KEY'] && !process.env['OPENAI_API_KEY']) {
      process.env['SWAO_OPENAI_API_KEY'] = openaiKey;
      process.env['SWAO_LLM_PROVIDER']   = 'openai';
    }
  }
  const ollamaEndpoint = stored['ollama-endpoint'];
  const ollamaModel    = stored['ollama-model'];
  if (ollamaEndpoint && !process.env['SWAO_OLLAMA_URL'])   process.env['SWAO_OLLAMA_URL']   = ollamaEndpoint;
  if (ollamaModel    && !process.env['SWAO_OLLAMA_MODEL']) process.env['SWAO_OLLAMA_MODEL'] = ollamaModel;
}

export function registerChallenge(program: Command, deps: ChallengeDeps): void {
  const { createLlmProvider } = deps;
  program
    .command('challenge')
    .description(
      'Run a stakeholder challenge session against a WSP assessment\n\n' +
      'Agent IDs:\n' +
      Object.entries(AGENT_IDS)
        .map(([id, name]) => `  ${id.padEnd(28)} ${name}`)
        .join('\n'),
    )
    .option('--agent <id>', 'Agent ID to run the session with')
    .option('--all-agents', 'Run all five agents in batch report mode (implies --report)')
    .requiredOption('--app <appId>', 'Application ID to challenge')
    .option('--workspace <path>', 'Portfolio workspace directory (default: cwd)')
    .option('--report', 'Batch report mode -- single LLM call; outputs YAML challenge report')
    .option('--output <file>', 'Write report output to file instead of stdout')
    .option('--focus <prefixes>', 'Comma-separated signal prefixes to focus on (e.g. egr,crypto)')
    .option('--save', 'Save interactive session transcript on exit')
    .option('--json', 'Output report in JSON instead of YAML')
    .option('--type <type>', 'Challenge type: app (default) or lz (LZ Sovereignty Challenge)', 'app')
    .option('--connector <connector>', '(#1587) LLM connector for this challenge run, overrides .swao.yml primary connector')
    .option('--model <model>', '(#1587) LLM model for this challenge run, overrides .swao.yml primary model')
    .action(async (opts: ChallengeOptions) => {
      try {
      // --- Enterprise gate ---
      const guard = LicenseGuard.load();
      try {
        guard.requireTier('enterprise', { feature: 'challenge' });
      } catch (err) {
        if (err instanceof LicenseTierError || err instanceof LicenseLimitError) {
          console.error(UPGRADE_MESSAGE);
          process.exit(2);
        }
        if (err instanceof LicenseInvalidError) {
          console.error(`[LICENSE] Invalid license: ${(err as Error).message}`);
          process.exit(3);
        }
        throw err;
      }

      // --- Vault credential bootstrap (#1156) ---
      bootstrapCredentialsFromVault();

      // --- Resolve app directory ---
      const workspaceRoot = opts.workspace ? resolve(opts.workspace) : process.cwd();
      const appDir = join(workspaceRoot, 'apps', opts.app);
      if (!existsSync(appDir)) {
        console.error(`[error] App directory not found: ${appDir}`);
        process.exit(1);
      }

      // --- LZ Sovereignty Challenge branch (#1109) ---
      const isLzChallenge = opts.type === 'lz';
      if (isLzChallenge) {
        const isAllLzAgents = opts.allAgents ?? !opts.agent;
        const lzAgentIds: LzAgentId[] = isAllLzAgents
          ? (Object.keys(LZ_AGENT_IDS) as LzAgentId[])
          : [opts.agent as LzAgentId];

        for (const agentId of lzAgentIds) {
          if (!(agentId in LZ_AGENT_IDS)) {
            const valid = Object.keys(LZ_AGENT_IDS).join(', ');
            console.error(`[error] Unknown LZ agent "${agentId}". Valid IDs: ${valid}`);
            process.exit(1);
          }
        }

        const lz = buildLzWspSummary(appDir);

        // Shared LLM config resolution (same as App path below).
        let llmCfgLz: ChallengeLlmConfig | undefined;
        const swaoYmlLz = join(workspaceRoot, '.swao.yml');
        if (existsSync(swaoYmlLz)) {
          try {
            const swaoYml = load(readFileSync(swaoYmlLz, 'utf-8')) as Record<string, unknown> | null;
            const llmCfg = (swaoYml?.['providers'] as Record<string, unknown> | undefined)?.['llm'] as
              { primary?: { connector?: string; env?: string; type?: string; model?: string; temperature?: number; seed?: number } } | undefined;
            if (llmCfg?.primary) {
              llmCfgLz = {
                connector: llmCfg.primary.connector, env: llmCfg.primary.env,
                workspaceRoot,
                type: llmCfg.primary.type, model: llmCfg.primary.model,
                temperature: llmCfg.primary.temperature, seed: llmCfg.primary.seed,
              };
            }
          } catch { /* fall back to env vars */ }
        }

        const providerTypeLz = llmCfgLz?.connector ?? llmCfgLz?.type ?? process.env['SWAO_LLM_CONNECTOR'] ?? process.env['SWAO_LLM_PROVIDER'];
        if (!providerTypeLz) {
          console.error('[challenge] No LLM provider configured.');
          console.error('  Set providers.llm.primary.connector (or type) in .swao.yml, or export SWAO_LLM_PROVIDER=anthropic|openai|ollama.');
          process.exit(2);
        }

        const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const lzChallengeBaseDir = opts.output
          ? dirname(opts.output)
          : join(appDir, 'wsp', 'challenge-lz', ts);

        for (const agentId of lzAgentIds) {
          const roleName = LZ_AGENT_IDS[agentId];
          const llmLz = createLlmProvider(opts.app, `challenge-lz-${agentId}`, llmCfgLz);
          const systemPrompt = getLzPromptBuilder(agentId)(lz);
          // #1694: per-stakeholder start/complete events for the support bundle.
          logApp(opts.app, 'info', 'challenge.stakeholder.start', `LZ challenge starting: ${roleName}`, {
            context: { agent_id: agentId, role: roleName, app_id: opts.app },
          });
          // #1115: severity field added; #1116: opening_summary added for all agents.
          const instruction =
            'Produce a structured YAML challenge report with the following top-level fields:\n' +
            '  opening_summary: (2-3 sentence stakeholder-facing summary of your top concerns)\n' +
            '  findings:\n' +
            '    - id: LZCA-<ROLE>-NN\n' +
            '      severity: HIGH|MEDIUM|LOW\n' +
            '      concern: (what the gap or risk is)\n' +
            '      evidence_gap: (what evidence is missing or insufficient)\n' +
            '      recommended_question: (the question the consultant must answer)\n' +
            'Include 3 to 7 findings ordered HIGH severity first. ' +
            'Output ONLY the fields listed above at the top level -- do not add extra fields.';
          const rawOutput = await llmLz.complete(`${systemPrompt}\n\n${instruction}`);

          let outText: string;
          try {
            const stripped = rawOutput
              .replace(/^```(?:yaml|json)?\r?\n/m, '')
              .replace(/\r?\n```\s*$/m, '')
              .trim();
            let parsed: Record<string, unknown> | null = null;
            try {
              parsed = JSON.parse(stripped) as Record<string, unknown>;
            } catch {
              parsed = load(stripped) as Record<string, unknown> | null;
            }
            if (parsed && typeof parsed['challenge_report'] === 'object' && parsed['challenge_report'] !== null) {
              parsed = { ...(parsed['challenge_report'] as Record<string, unknown>) };
            }
            const findings = extractFindings(parsed).map(f => ({
              ...f,
              severity: typeof f['severity'] === 'string' ? f['severity'].toUpperCase() : f['severity'],
            }));
            const envelope: Record<string, unknown> = {
              schema_version: '1.0',
              challenge_type: 'lz-sovereignty',
              agent_id: agentId,
              agent_role: roleName,
              workload_id: opts.app,
              reviewed_at: new Date().toISOString(),
              assessment_status: 'INITIAL_CHALLENGE',
              ...(parsed ?? {}),
              findings,
            };
            delete envelope['review_date'];
            delete envelope['review_timestamp'];
            // #1116: suppress LLM-volunteered top-level fields that conflict with the canonical schema.
            delete envelope['role'];
            delete envelope['assessment_reference'];
            outText = dump(envelope, { lineWidth: 120 });
          } catch {
            console.warn(`[challenge] Warning: could not parse ${agentId} output as YAML -- writing raw output.`);
            outText = rawOutput;
          }

          // #1109: LZCA_ prefix on filename; output to wsp/challenge-lz/<ts>/.
          const outputPath = lzAgentIds.length === 1 && opts.output
            ? opts.output
            : join(lzChallengeBaseDir, `LZCA_${agentId}.yaml`);
          mkdirSync(dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, outText, 'utf-8');
          logApp(opts.app, 'info', 'challenge-lz.complete', `LZ sovereignty challenge report written for ${roleName}`, {
            context: { output: outputPath, agent_id: agentId },
          });
          // #1694: per-stakeholder complete event mirrors the start event.
          logApp(opts.app, 'info', 'challenge.stakeholder.complete', `LZ challenge complete: ${roleName}`, {
            context: { agent_id: agentId, role: roleName, output: outputPath },
          });
          console.log(`[challenge-lz] ${roleName}: report written to ${outputPath}`);
        }
        return;
      }

      // --- Validate agent selection (App challenge) ---
      const isAllAgents = opts.allAgents ?? false;
      if (!opts.agent && !isAllAgents) {
        console.error('[error] Specify --agent <id> or --all-agents');
        process.exit(1);
      }
      // #1149: --all-agents implies --report; no need to pass both explicitly.
      const useReport = opts.report || isAllAgents;
      const agentIds: AgentId[] = isAllAgents
        ? (Object.keys(AGENT_IDS) as AgentId[])
        : [opts.agent as AgentId];

      for (const agentId of agentIds) {
        if (!(agentId in AGENT_IDS)) {
          const valid = Object.keys(AGENT_IDS).join(', ');
          console.error(`[error] Unknown agent "${agentId}". Valid IDs: ${valid}`);
          process.exit(1);
        }
      }

      // --- Build WSP summary ---
      const focusPrefixes = opts.focus ? opts.focus.split(',').map(p => p.trim()) : undefined;
      const wsp = buildWspSummary(appDir, focusPrefixes);

      // --- LLM config from .swao.yml (mirrors assess.ts pattern, #0855) ---
      // providers.llm lives in the WORKSPACE ROOT .swao.yml, not the app-level one.
      // App-level .swao.yml carries app config (regimes, pass_profile, crawl) but no providers block.
      let llmConfig: ChallengeLlmConfig | undefined;
      const swaoYmlPath = join(workspaceRoot, '.swao.yml');
      if (existsSync(swaoYmlPath)) {
        try {
          const swaoYml = load(readFileSync(swaoYmlPath, 'utf-8')) as Record<string, unknown> | null;
          const llmCfg = (swaoYml?.['providers'] as Record<string, unknown> | undefined)?.['llm'] as
            { primary?: { connector?: string; env?: string; type?: string; model?: string; temperature?: number; seed?: number } } | undefined;
          if (llmCfg?.primary) {
            llmConfig = {
              connector: llmCfg.primary.connector,
              env: llmCfg.primary.env,
              workspaceRoot,
              type: llmCfg.primary.type,
              model: llmCfg.primary.model,
              temperature: llmCfg.primary.temperature,
              seed: llmCfg.primary.seed,
            };
          }
        } catch { /* malformed .swao.yml -- fall back to env vars */ }
      }

      // #1587: CLI --connector / --model override .swao.yml primary block.
      // Required for per-leg challenge invocation from assess --type llm, where
      // each leg must use its own connector and model, not the workspace default.
      if (opts.connector) {
        llmConfig = {
          ...(llmConfig ?? { workspaceRoot }),
          connector: opts.connector,
          type: opts.connector,
          ...(opts.model ? { model: opts.model } : {}),
        };
      } else if (opts.model && llmConfig) {
        llmConfig = { ...llmConfig, model: opts.model };
      }

      // --- LLM pre-flight (#0902): check provider is configured before spawning any agent.
      // Without this, each agent fails independently with the same error -- one copy per agent.
      const providerType = llmConfig?.connector ?? llmConfig?.type ?? process.env['SWAO_LLM_CONNECTOR'] ?? process.env['SWAO_LLM_PROVIDER'];
      if (!providerType) {
        console.error('[challenge] No LLM provider configured.');
        console.error('  Set providers.llm.primary.connector (or type) in .swao.yml, or export SWAO_LLM_PROVIDER=anthropic|openai|ollama.');
        console.error('  To configure interactively: open SWAO -> Tools (8) -> Credentials (2).');
        process.exit(2);
      }

      // --- LLM provider ---
      const llm: LlmProvider = createLlmProvider(opts.app, `challenge-${agentIds[0]}`, llmConfig);

      // --- Report mode ---
      if (useReport) {
        if (isAllAgents) {
          // #0921: session start event before the first agent LLM call.
          const sessionStartedAt = new Date().toISOString();
          logApp(opts.app, 'info', 'challenge.session.start', `Challenge session starting (${Object.keys(AGENT_IDS).length} agents)`, {
            context: { workload_id: opts.app, agent_count: Object.keys(AGENT_IDS).length },
          });
          // #1793: portfolio-level challenge.start so the portfolio log records the run.
          try {
            logPortfolio('info', 'challenge.start', `Challenge starting: ${Object.keys(AGENT_IDS).length} agents`, {
              context: { app: opts.app, agent_count: Object.keys(AGENT_IDS).length },
            });
          } catch { /* best-effort */ }
          // Parallel execution: all 5 agents run concurrently
          const combined = await runAllAgentsReport(
            wsp,
            (agentId) => createLlmProvider(opts.app, `challenge-${agentId}`, llmConfig),
          );
          // Structural validation before writing to disk
          const validationErrors = validateCombinedReport(combined);
          if (validationErrors.length > 0) {
            for (const e of validationErrors) {
              console.error(`[challenge] Output validation error: ${e.field} -- ${e.message}`);
            }
            logApp(opts.app, 'error', 'challenge.output.invalid', 'Combined report failed structural validation', {
              context: { errors: validationErrors },
            });
            process.exit(1);
          }
          const outText = opts.json
            ? JSON.stringify(combined, null, 2)
            : dump(combined, { lineWidth: 120 });
          const outputPath = opts.output ?? join(appDir, 'wsp', 'challenge-app', 'combined.yaml');
          mkdirSync(dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, outText, 'utf-8');
          const sessionDurationMs = Date.now() - new Date(sessionStartedAt).getTime();
          logApp(opts.app, 'info', 'challenge.complete', `Combined challenge report written for ${combined.agent_count} agents`, {
            context: { output: outputPath, agent_count: combined.agent_count },
          });
          // #0921: session complete event with totals.
          logApp(opts.app, 'info', 'challenge.session.complete', `Challenge session complete`, {
            context: {
              workload_id: opts.app,
              agent_count: combined.agent_count,
              duration_ms: sessionDurationMs,
              output: outputPath,
            },
          });
          // #1793: portfolio-level challenge.complete.
          try {
            logPortfolio('info', 'challenge.complete', `Challenge complete: ${combined.agent_count} agents`, {
              context: { app: opts.app, agents_run: combined.agent_count, elapsed_ms: sessionDurationMs },
            });
          } catch { /* best-effort */ }
          console.log(`[challenge] Combined report written to ${outputPath}`);
        } else {
          const agentId = agentIds[0];
          // #0921: emit challenge.start before LLM call so log consumers can measure duration.
          const challengeStartedAt = new Date().toISOString();
          logApp(opts.app, 'info', 'challenge.start', `Challenge agent ${agentId} starting`, {
            context: { agent_id: agentId, workload_id: opts.app },
          });
          const llmForAgent = createLlmProvider(opts.app, `challenge-${agentId}`, llmConfig);
          const rawOutput = await runChallengeReport(agentId, wsp, llmForAgent);
          // #0919: wrap raw LLM YAML in the canonical challenge report envelope so
          // all files share the same root schema regardless of agent prompt variation.
          let outText: string;
          if (opts.json) {
            outText = JSON.stringify({ agentId, report: rawOutput }, null, 2);
          } else {
            try {
              const stripped = rawOutput
                .replace(/^```(?:yaml|json)?\r?\n/m, '')
                .replace(/\r?\n```\s*$/m, '')
                .trim();
              // Try JSON.parse first -- LLM sometimes returns JSON instead of YAML.
              let parsed: Record<string, unknown> | null = null;
              try {
                parsed = JSON.parse(stripped) as Record<string, unknown>;
              } catch {
                parsed = load(stripped) as Record<string, unknown> | null;
              }
              // Unwrap challenge_report nesting if the LLM wrapped its output in that key.
              if (parsed && typeof parsed['challenge_report'] === 'object' && parsed['challenge_report'] !== null) {
                parsed = { ...(parsed['challenge_report'] as Record<string, unknown>) };
              }
              const findings = extractFindings(parsed).map(f => ({
                ...f,
                severity: typeof f['severity'] === 'string' ? f['severity'].toUpperCase() : f['severity'],
              }));
              const envelope: Record<string, unknown> = {
                schema_version: '1.0',
                agent_id: agentId,
                workload_id: opts.app,
                reviewed_at: challengeStartedAt,
                assessment_status: 'INITIAL_CHALLENGE',
                ...(parsed ?? {}),
                findings,
              };
              // Remove any hardcoded/fake timestamp fields the LLM may have inserted.
              delete envelope['review_date'];
              delete envelope['review_timestamp'];
              outText = dump(envelope, { lineWidth: 120 });
            } catch {
              // Fallback: write raw LLM output with a warning comment prepended.
              console.warn(`[challenge] Warning: could not parse ${agentId} output as YAML -- writing raw output.`);
              outText = rawOutput;
            }
          }
          const outputPath = opts.output ?? join(appDir, 'wsp', 'challenge-app', `AA_${agentId}.yaml`);
          mkdirSync(dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, outText, 'utf-8');
          logApp(opts.app, 'info', 'challenge.complete', `Challenge report written for agent ${agentId}`, {
            context: { output: outputPath, agent_id: agentId, reviewed_at: challengeStartedAt },
          });
          console.log(`[challenge] Report written to ${outputPath}`);
        }
        return;
      }

      // --- Interactive mode ---
      const agentId = agentIds[0];
      const roleName = AGENT_IDS[agentId];
      console.log(`[challenge] Starting session with ${roleName} for app: ${opts.app}`);
      console.log('[challenge] Type "exit" or "quit" to end the session.\n');

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '> ',
      });

      const { transcript } = await runChallengeSession(
        agentId,
        wsp,
        llm,
        rl,
        line => {
          console.log(`\n${roleName}: ${line}\n`);
          rl.prompt();
        },
        {
          onContextWarning: (turnsUsed, limit) => {
            console.log(
              `\n[challenge] Session context approaching limit (${turnsUsed}/${limit} turns). ` +
              `Earlier turns will be condensed on export.\n`,
            );
          },
        },
      );

      rl.prompt();

      if (opts.save && transcript.length > 0) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const savePath = join(appDir, 'wsp', `challenge-${agentId}-${ts}.yaml`);
        const record = {
          agent_id: agentId,
          agent_role: roleName,
          app_id: opts.app,
          conducted_at: new Date().toISOString(),
          transcript,
        };
        writeFileSync(savePath, dump(record), 'utf-8');
        console.log(`[challenge] Transcript saved to ${savePath}`);
      }
      } catch (err) {
        const errMsg = (err as Error).message ?? String(err);
        // #1694: log fatal errors to app-events before exiting so the support bundle captures them.
        try {
          logApp(opts.app, 'error', 'challenge.error', `Challenge fatal error: ${errMsg}`, {
            context: { error: errMsg.slice(0, 500) },
          });
        } catch { /* logging must not suppress the original error */ }
        console.error(`[challenge] Fatal error: ${errMsg}`);
        process.exit(1);
      }
    });
}
