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

// SWAO CLI bootstrap (#0583, Sprint 064, ADR-0049 layer 2).
//
// Factored out of index.ts so the per-tier entries (src/tiers/{community,
// consultant,enterprise}.ts) share one program-setup + Community-command
// registration path. The whole point of the split is real module EXCLUSION: the
// Community entry imports NONE of the higher-tier modules (pdf-report, terraform,
// portfolio, challenge, html-portal), so their CODE is absent from the Community
// esbuild bundle -- not merely runtime-gated. The injectable tier slots
// (renderPdf, runPortfolio, formatPortfolioResult, buildPortal) carry the real
// impls in higher tiers and gated stubs in Community (the requireTier gate in
// each command fires FIRST, so the stub is never reached on the happy path).
//
// Why the spawn descriptor is NOT computed here: it depends on
// `import.meta.url`, which must resolve to the file that calls program.parse()
// (the entry), not this module (which never parses). So each entry computes its
// own McpHostDeps descriptor and passes it in; the enterprise entry also builds
// the real runForApp from it. In the pkg binary process.pkg is true so execPath
// is used and this never bites the exe -- it only matters in dev/test.

//
// #4387: every command module is reached through a string-literal dynamic
// import inside its CommandGroup (lib/command-groups.ts), so a process loads
// only the module graph of the command it runs, and `--version` / `--help`
// load none. The tier slots are therefore async factories, resolved by the
// group that needs them. Registration ORDER on the full path is unchanged.

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { AssessDeps } from './commands/assess.js';
import type { ServiceDeps } from './commands/service.js';
import type { ReportDeps } from './commands/report.js';
// mcp command + MCP server relocated to @swao/module-mcp (#0574). The host
// injects the resolved swao CLI invocation (McpHostDeps) so the MCP tools spawn
// the correct entry after the module's extraction; module-mcp must not import
// host code, so the host mediates. #3348 B-01 / B-02 step 2a: the entry injects
// registerMcp and registerChat (BootstrapDeps.mcpChat); this module uses the
// host contract only and imports neither module-mcp nor the chat command.
import type { McpChatCommands, McpHostDeps } from './lib/mcp-chat-contract.js';
// #0575 / #0582 / #0583: publish lives in @swao/module-html-report; buildPortal
// (Consultant HTML Portal) is injected, a gated stub in Community.
import type { BuildPortal } from '@swao/module-html-report';
import { LicenseGuard } from '@swao/core';
import { SWAO_BUILD_SUFFIX, SWAO_CONTACTS_INLINE, SWAO_LANDING_URL, SWAO_VERSION, SWAO_VERSION_LABEL } from './branding.js';
import {
  registerCommandGroups,
  selectCommandMode,
  type CommandGroup,
  type RootHelpEntry,
  type TierCommands,
} from './lib/command-groups.js';

/**
 * Dependencies the per-tier entries inject into the shared Community bootstrap.
 *
 * `cliSpawnDescriptor` is computed by the ENTRY (it needs that entry's
 * import.meta.url) and threaded into registerMcp + the host runForApp.
 *
 * The tier slots (assessDeps / reportDeps with their renderPdf / runPortfolio /
 * formatPortfolioResult, and buildPortal) carry the real impls only in the
 * Consultant / Enterprise entries; the Community entry passes gated stubs.
 * #4387: each slot is an async factory, called only by the command that uses it,
 * so the tier modules behind it load on first use.
 */
export interface BootstrapDeps {
  /** Spawn descriptor for the MCP server + portfolio runner (entry-owned). */
  cliSpawnDescriptor: McpHostDeps;
  /** Injected into registerAssess (runForApp + Enterprise portfolio slots). */
  assessDeps: () => Promise<AssessDeps>;
  /** Injected into registerReport (runForApp + pdf + Enterprise portfolio). */
  reportDeps: () => Promise<ReportDeps>;
  /** Consultant HTML Portal builder; gated stub in Community. */
  buildPortal: () => Promise<BuildPortal>;
  /**
   * #3353: `swao service export` implementation. Real (@swao/module-service-export)
   * only in the Enterprise entry; communityServiceDeps in Community and Consultant.
   */
  serviceDeps: () => Promise<ServiceDeps>;
  /**
   * #3348 B-01 / B-02: `swao mcp` and `swao chat` (Enterprise). Real
   * (@swao/module-mcp, commands/chat.ts) only in the Enterprise entry; the
   * premium-stubs registrars (same command tree and help, every action
   * refuses) in Community and Consultant.
   */
  mcpChat: () => Promise<McpChatCommands>;
}

function editionLabel(): string {
  try {
    const tier = LicenseGuard.load().state.tier;
    if (tier === 'enterprise') return 'Enterprise';
    if (tier === 'consultant') return 'Consultant';
    return 'Community';
  } catch {
    return 'Community';
  }
}

const BANNER = 'S W A O  -  Sovereign Workload Assessment and Onboarding';

/**
 * The shared Community command groups in the historical registration order
 * (help output + the CLI/TUI parity gate stay stable). Each register() imports
 * its command module on demand.
 */
export function communityCommandGroups(deps: BootstrapDeps): CommandGroup[] {
  // The mcp and chat registrars share one resolution of the tier slot.
  let mcpChat: Promise<McpChatCommands> | undefined;
  const loadMcpChat = (): Promise<McpChatCommands> => (mcpChat ??= deps.mcpChat());
  return [
    { names: ['init'], register: async (p) => (await import('./commands/init.js')).registerInit(p) },
    {
      names: ['assess'],
      register: async (p) => (await import('./commands/assess.js')).registerAssess(p, await deps.assessDeps()),
    },
    {
      names: ['service'],
      register: async (p) => (await import('./commands/service.js')).registerService(p, await deps.serviceDeps()),
    },
    {
      names: ['report'],
      register: async (p) => (await import('./commands/report.js')).registerReport(p, await deps.reportDeps()),
    },
    { names: ['license'], register: async (p) => (await import('./commands/license.js')).registerLicense(p) },
    { names: ['machine-id'], register: async (p) => (await import('./commands/machine-id.js')).registerMachineId(p) },
    {
      // doctor / doctor-pii / doctor-tags relocated to @swao/module-health-check (#0573).
      // The host injects the host-coupled probe builders via DoctorHostDeps.
      names: ['health-check', 'doctor'],
      register: async (p) => {
        const hc = await import('@swao/module-health-check');
        const { buildVcsAuthProbe } = await import('./health-check/vcs-auth-probe.js');
        const { buildImportsProbe } = await import('./context/imports-probe.js');
        const { llmGatewayProbeContribution } = await import('@swao/module-llm-providers');
        hc.registerHealthCheck(p, {
          // #4430: the version line of the text output names the build.
          swaoVersionLabel: SWAO_VERSION_LABEL,
          // Sprint-038 #0350: playwright-driver loads inside the probe thunk only.
          buildPlaywrightProbe: async () => (await import('./crawl/playwright-driver.js')).buildPlaywrightProbe(),
          buildVcsAuthProbe,
          buildImportsProbe,
          // #1402 sprint-113: LLM-Gateway connector probe (host-mediated).
          llmGatewayProbe: llmGatewayProbeContribution,
          // #4392: the HTTP MCP endpoint (localhost:3737/mcp), informational.
          // SWAO_MCP_HTTP_PROBE=0 turns it off (test runs, src/__tests__/setup.ts).
          ...(process.env['SWAO_MCP_HTTP_PROBE'] === '0' ? {} : { mcpHttpProbe: () => hc.probeMcpHttpEndpoint() }),
        });
        hc.registerHealthCheckPii(p);
        hc.registerHealthCheckTags(p);
      },
    },
    { names: ['credential'], register: async (p) => (await import('./commands/credential.js')).registerCredential(p) },
    { names: ['menu'], register: async (p) => (await import('./commands/menu.js')).registerMenu(p) },
    { names: ['setup'], register: async (p) => (await import('./commands/setup.js')).registerSetup(p) },
    {
      // #0574/#0579: the MCP server spawns the same resolved swao CLI as the
      // portfolio orchestrator; the descriptor is computed by the entry.
      // #2877 / #3163 / #3217: the install deps carry the Claude Desktop
      // multi-config patcher and the stable-copy binary resolver (TUI/CLI parity).
      // #3476: the main menu for the MCP start prompt (Design 116 REQ-12.3).
      names: ['mcp'],
      register: async (p) => {
        const slot = await loadMcpChat();
        const { buildMcpInstallDeps } = await import('./lib/mcp-install-deps.js');
        const { mainMenuEntries } = await import('./tui/screens/main-menu-items.js');
        // #4430: buildLabel names the build on the welcome screen; SWAO_VERSION stays the server info version.
        slot.registerMcp(p, { ...deps.cliSpawnDescriptor, mainMenu: mainMenuEntries, buildLabel: SWAO_VERSION_LABEL }, SWAO_VERSION, buildMcpInstallDeps());
      },
    },
    {
      names: ['install-playwright'],
      register: async (p) => (await import('./commands/install-playwright.js')).registerInstallPlaywright(p),
    },
    {
      names: ['regime-select'],
      register: async (p) => (await import('./commands/regime-select.js')).registerRegimeSelect(p),
    },
    // #0577: export lives in @swao/module-powerbi (Community tier).
    { names: ['export'], register: async (p) => (await import('@swao/module-powerbi')).registerExport(p) },
    // accept + migrate-workspace (#0552) + diff + normalize (#0591) live in @swao/module-app-assessment.
    {
      names: ['migrate-workspace'],
      register: async (p) => (await import('@swao/module-app-assessment')).registerMigrateWorkspace(p),
    },
    { names: ['log'], register: async (p) => (await import('./commands/log.js')).registerLog(p) },
    {
      names: ['support-bundle'],
      register: async (p) => (await import('./commands/support-bundle.js')).registerSupportBundle(p),
    },
    { names: ['framework'], register: async (p) => (await import('./commands/framework.js')).registerFramework(p) },
    {
      names: ['publish'],
      register: async (p) =>
        (await import('@swao/module-html-report')).registerPublish(p, {
          swaoVersion: SWAO_VERSION,
          buildPortal: await deps.buildPortal(),
        }),
    },
    { names: ['lenses'], register: async (p) => (await import('./commands/lenses.js')).registerLenses(p) },
    { names: ['ingest'], register: async (p) => (await import('./commands/ingest.js')).registerIngest(p) },
    { names: ['normalize'], register: async (p) => (await import('@swao/module-app-assessment')).registerNormalize(p) },
    { names: ['diff'], register: async (p) => (await import('@swao/module-app-assessment')).registerDiff(p) },
    { names: ['accept'], register: async (p) => (await import('@swao/module-app-assessment')).registerAccept(p) },
    // lz command group (catalogue list/show, fit) -- #0567
    { names: ['lz'], register: async (p) => (await import('@swao/module-landing-zone')).registerLz(p) },
    // llm command group -- memorable entry point for LLM assessments (#1558)
    { names: ['llm'], register: async (p) => (await import('./commands/llm.js')).registerLlm(p) },
    { names: ['chat'], register: async (p) => (await loadMcpChat()).registerChat(p) },
  ];
}

/**
 * Build the commander program for this process. The per-tier entries pass their
 * slots, their TierCommands (extra groups, hooks) and the root help manifest;
 * the router (lib/command-groups.ts) then registers only what argv needs:
 * placeholders for `--version` / `--help`, the invoked command's group for a
 * command, every group otherwise (historical order).
 */
export async function buildProgram(
  deps: BootstrapDeps,
  tier: TierCommands,
  rootHelp: readonly RootHelpEntry[],
  argv: readonly string[] = process.argv,
): Promise<Command> {
  // package.json version is read relative to THIS module's dist location, which
  // is dist/bootstrap.js -- one level under dist/, same as the old index.js, so
  // ../package.json still resolves in dev, dist, and the pkg binary.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as {
    version: string;
  };
  // #4430: the build (commit, date or tag) follows the semver, e.g. "v1.6.1 (4c8dd01e, 2026-11-14)".
  // #4501 (CLAUDE.md section 5.1): no spaced double hyphen in CLI output; "and", not "&".
  const VERSION_STRING = `SWAO, Sovereign Workload Assessment and Onboarding v${pkg.version}${SWAO_BUILD_SUFFIX} (${editionLabel()})`;

  const program = new Command();

  program
    .name('swao')
    .description('Sovereign Workload Assessment and Onboarding CLI')
    .version(VERSION_STRING)
    .addHelpText('before', `${BANNER}\n`)
    .addHelpText(
      'after',
      [
        '',
        'Command reference (when to use each subcommand, how they chain):',
        '  docs/runbooks/cli-reference.md',
        'Batch samples (assess N apps + portfolio export in one run):',
        '  ops/batch-samples/assess-portfolio.cmd  (Windows)',
        '  ops/batch-samples/assess-portfolio.sh   (POSIX / Git Bash)',
        '',
        `Further information: ${SWAO_LANDING_URL}`,
        `Contacts: ${SWAO_CONTACTS_INLINE}`,
      ].join('\n'),
    );

  const groups = [...communityCommandGroups(deps), ...tier.extraGroups];
  await registerCommandGroups(program, selectCommandMode(argv, groups), groups, tier, rootHelp);
  return program;
}

/** Hides the Enterprise-only publish options in the Community and Consultant help (an `after.publish` hook). */
export function hideEnterprisePublishOptions(program: Command): void {
  const publishCmd = program.commands.find((c) => c.name() === 'publish');
  if (!publishCmd) return;
  const enterprisePublishOpts = new Set(['--site', '--site-app', '--edit']);
  for (const opt of publishCmd.options) {
    if (enterprisePublishOpts.has(opt.long ?? '')) opt.hidden = true;
  }
}

/** Normalise --no-llm to --skip-llm; Commander reserves --no-<option> for boolean negation (#1715). */
export function normaliseNoLlmFlag(argv: string[] = process.argv): void {
  const idx = argv.indexOf('--no-llm');
  if (idx !== -1) argv.splice(idx, 1, '--skip-llm');
}

/** Emit a user-facing tier-rejection message and exit 2 (ADR-0055, #3844). Wired only in Community
 * and Consultant bundles where the higher-tier module code is absent. Replaces
 * the former requireTier + [bug] fallthrough that leaked internal bundle details
 * to stderr and caused commander to report exit 7 (#1561). */
function tierStub(required: 'consultant' | 'enterprise', feature: string): never {
  const tierLabel = required === 'enterprise' ? 'Enterprise' : 'Consultant';
  console.error(
    `[error] ${feature} requires ${tierLabel} tier. Run \`swao license\` to upgrade.`,
  );
  process.exit(2);
}

/** Community stub for the Consultant pdf renderer. */
export const communityRenderPdf: NonNullable<ReportDeps['renderPdf']> = async () =>
  tierStub('consultant', 'report --format pdf');

/** Community stub for the Consultant LLM comparison PDF renderer (#1531). */
export const communityRenderLlmPdf: NonNullable<ReportDeps['renderLlmPdf']> = async () =>
  tierStub('consultant', 'report --type llm --format pdf');

/**
 * HTML renderer for report --format html (#0877). Wired into every tier entry,
 * but the report action gates the format with FEATURE_GATES['html-report']
 * (Consultant+, licence tier matrix F-082, #3320) before this runs. Delegates to
 * renderModeA from @swao/module-html-report, which writes
 * wsp/publications/<runTs>-<appId>.html and returns the path.
 */
export const communityRenderHtml: NonNullable<ReportDeps['renderHtml']> = async (wspRunDir) => {
  const { renderModeA } = await import('@swao/module-html-report');
  const result = await renderModeA({ wspRunDir, swaoVersion: SWAO_VERSION });
  return result.outputPath;
};

/** Community stub for the Enterprise per-app spawn runner. buildSpawnRunForApp
 * lives in @swao/module-portfolio (Enterprise), so the Community entry uses this
 * stub rather than importing that module. Reached only via the --portfolio
 * branch, which is Enterprise-gated; tierStub exits 2 with a clean message. */
export const communityRunForApp: AssessDeps['runForApp'] = async () =>
  tierStub('enterprise', 'assess/report --portfolio');

/** Community stub for the Enterprise portfolio dispatcher. */
export const communityRunPortfolio: NonNullable<AssessDeps['runPortfolio']> = async () =>
  tierStub('enterprise', 'assess/report --portfolio');

/** Community stub for the Enterprise portfolio summary formatter. */
export const communityFormatPortfolioResult: NonNullable<AssessDeps['formatPortfolioResult']> = () =>
  tierStub('enterprise', 'assess/report --portfolio');

/** Community/Consultant slot for `swao service export` (#3353, F-133 Enterprise).
 * @swao/module-service-export is absent from these bundles; the command's
 * service-excel / bi-export gate answers first with the [LICENSE] block and
 * exit 2 (ADR-0055, #3844), and serviceExportUnavailable repeats that answer if the gate is bypassed. */
export const communityServiceDeps = async (): Promise<ServiceDeps> => ({
  runExport: (await import('./commands/service.js')).serviceExportUnavailable,
});

/** Community/Consultant stub for the Enterprise HTML Portal builder (#1228, D-06). */
export const communityBuildPortal: BuildPortal = async () =>
  tierStub('enterprise', 'publish --site');
