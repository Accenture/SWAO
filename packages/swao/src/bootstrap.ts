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

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { registerInit } from './commands/init.js';
import { registerAssess, type AssessDeps } from './commands/assess.js';
import { registerReport, type ReportDeps } from './commands/report.js';
import { registerLicense } from './commands/license.js';
import { registerMachineId } from './commands/machine-id.js';
// doctor / doctor-pii / doctor-tags relocated to @swao/module-health-check (#0573).
// The host injects the three host-coupled probe builders (Playwright, VCS auth,
// imports) into registerDoctor via DoctorHostDeps.
import { registerHealthCheck, registerHealthCheckPii, registerHealthCheckTags } from '@swao/module-health-check';
import { buildVcsAuthProbe } from './health-check/vcs-auth-probe.js';
import { buildImportsProbe } from './context/imports-probe.js';
import { registerCredential } from './commands/credential.js';
import { registerMenu } from './commands/menu.js';
import { registerSetup } from './commands/setup.js';
// mcp command + MCP server relocated to @swao/module-mcp (#0574). The host
// injects the resolved swao CLI invocation (McpHostDeps) so the MCP tools spawn
// the correct entry after the module's extraction; module-mcp must not import
// host code, so the host mediates.
import { registerMcp, type McpHostDeps } from '@swao/module-mcp';
import { registerInstallPlaywright } from './commands/install-playwright.js';
import { registerRegimeSelect } from './commands/regime-select.js';
// #0577: export command + ExportBiScreen + the star writers relocated to
// @swao/module-powerbi (Community tier). registerExport imports only @swao/core
// + leaf deps, so the host wires it directly, mirroring the #0573/#0578 wiring.
import { registerExport } from '@swao/module-powerbi';
import { registerLog } from './commands/log.js';
import { registerSupportBundle } from './commands/support-bundle.js';
import { registerFramework } from './commands/framework.js';
// #0575: publish command relocated to @swao/module-html-report (Community); the
// host injects SWAO_VERSION (branding is host-only). #0582: the `publish --site`
// HTML Portal moved to @swao/module-html-portal (Consultant); module-html-report
// must not import that sibling, so the host injects buildPortal into
// registerPublish. #0583: in Community buildPortal is a gated stub (the
// requireTier('consultant') gate in the command fires first).
import { registerPublish, renderModeA, type BuildPortal } from '@swao/module-html-report';
import { registerLenses } from './commands/lenses.js';
import { registerIngest } from './commands/ingest.js';
// accept + migrate-workspace (#0552) + diff + normalize (#0591) commands relocated to @swao/module-app-assessment
import {
  registerAccept,
  registerMigrateWorkspace,
  registerDiff,
  registerNormalize,
} from '@swao/module-app-assessment';
// #1434: the audit assessment surface (its module, command group, and the
// audit-remote-ingestion probe) was removed; `--type audit` now resolves to
// the router's known-but-unregistered coming-soon path.
// #1402 sprint-113: LLM-Gateway connector probe, contributed by module-llm-providers.
import { llmGatewayProbeContribution } from '@swao/module-llm-providers';
// lz command group (catalogue list/show, fit) -- #0567
import { registerLz } from '@swao/module-landing-zone';
import { LicenseGuard } from '@swao/core';
import { SWAO_CONTACTS_INLINE, SWAO_LANDING_URL, SWAO_VERSION } from './branding.js';

/**
 * Dependencies the per-tier entries inject into the shared Community bootstrap.
 *
 * `cliSpawnDescriptor` is computed by the ENTRY (it needs that entry's
 * import.meta.url) and threaded into registerMcp + the host runForApp.
 *
 * The tier slots (assessDeps / reportDeps with their renderPdf / runPortfolio /
 * formatPortfolioResult, and buildPortal) carry the real impls only in the
 * Consultant / Enterprise entries; the Community entry passes gated stubs.
 */
export interface BootstrapDeps {
  /** Spawn descriptor for the MCP server + portfolio runner (entry-owned). */
  cliSpawnDescriptor: McpHostDeps;
  /** Injected into registerAssess (runForApp + Enterprise portfolio slots). */
  assessDeps: AssessDeps;
  /** Injected into registerReport (runForApp + pdf + Enterprise portfolio). */
  reportDeps: ReportDeps;
  /** Consultant HTML Portal builder; gated stub in Community. */
  buildPortal: BuildPortal;
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

const BANNER = 'S W A O  --  Sovereign Workload Assessment and Onboarding';

/**
 * Build the commander program and register the Community command surface with
 * the injected tier slots. The per-tier entries call this, then additionally
 * register the Consultant (`generate-tf`) and Enterprise (`challenge`) commands
 * iff their tier modules are bundled. Registration ORDER mirrors the historical
 * index.ts so help output + the CLI/TUI parity gate stay stable.
 */
export function buildProgram(deps: BootstrapDeps): Command {
  // package.json version is read relative to THIS module's dist location, which
  // is dist/bootstrap.js -- one level under dist/, same as the old index.js, so
  // ../package.json still resolves in dev, dist, and the pkg binary.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as {
    version: string;
  };
  const VERSION_STRING = `SWAO -- Sovereign Workload Assessment & Onboarding v${pkg.version} (${editionLabel()})`;

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

  registerInit(program);
  registerAssess(program, deps.assessDeps);
  registerReport(program, deps.reportDeps);
  registerLicense(program);
  registerMachineId(program);
  // Sprint-038 #0350: lazy-load playwright-driver inside the injected probe thunk
  // so `swao --version` / `--help` do not pay the ~50MB playwright-core init cost.
  // The dynamic import keeps playwright-driver off the top-level module graph.
  registerHealthCheck(program, {
    buildPlaywrightProbe: async () => (await import('./crawl/playwright-driver.js')).buildPlaywrightProbe(),
    buildVcsAuthProbe,
    buildImportsProbe,
    // #1402 sprint-113: LLM-Gateway connector probe (host-mediated).
    llmGatewayProbe: llmGatewayProbeContribution,
  });
  registerHealthCheckPii(program);
  registerHealthCheckTags(program);
  registerCredential(program);
  registerMenu(program);
  registerSetup(program);
  // #0574/#0579: the MCP server spawns the same resolved swao CLI as the
  // portfolio orchestrator; the descriptor is computed by the entry.
  registerMcp(program, deps.cliSpawnDescriptor);
  registerInstallPlaywright(program);
  registerRegimeSelect(program);
  registerExport(program);
  registerMigrateWorkspace(program);
  registerLog(program);
  registerSupportBundle(program);
  registerFramework(program);
  registerPublish(program, { swaoVersion: SWAO_VERSION, buildPortal: deps.buildPortal });
  registerLenses(program);
  registerIngest(program);
  registerNormalize(program);
  registerDiff(program);
  registerAccept(program);
  registerLz(program);

  return program;
}

// ---------------------------------------------------------------------------
// Community / Consultant gated stubs (#0583). These are the tier slots wired in
// the lower-tier entries where the higher-tier MODULE is deliberately absent from
// the bundle. Each slot calls tierStub, which emits a user-facing rejection and
// exits 1. On the happy path the command's requireTier gate fires first; the stub
// is the defensive backstop that fires if the first gate is bypassed -- for
// example when SWAO_BINARY_TIER is already set in the caller's environment before
// the binary's conditional set runs (#1561).
// ---------------------------------------------------------------------------

/** Emit a user-facing tier-rejection message and exit 1. Wired only in Community
 * and Consultant bundles where the higher-tier module code is absent. Replaces
 * the former requireTier + [bug] fallthrough that leaked internal bundle details
 * to stderr and caused commander to report exit 7 (#1561). */
function tierStub(required: 'consultant' | 'enterprise', feature: string): never {
  const tierLabel = required === 'enterprise' ? 'Enterprise' : 'Consultant';
  console.error(
    `[error] ${feature} requires ${tierLabel} tier. Run \`swao license\` to upgrade.`,
  );
  process.exit(1);
}

/** Community stub for the Consultant pdf renderer. */
export const communityRenderPdf: NonNullable<ReportDeps['renderPdf']> = async () =>
  tierStub('consultant', 'report --format pdf');

/** Community stub for the Consultant LLM comparison PDF renderer (#1531). */
export const communityRenderLlmPdf: NonNullable<ReportDeps['renderLlmPdf']> = async () =>
  tierStub('consultant', 'report --type llm --format pdf');

/**
 * Community (all tiers) HTML renderer for report --format html (#0877).
 * Delegates to renderModeA from @swao/module-html-report (Community tier),
 * which writes wsp/publications/<runTs>-<appId>.html and returns the path.
 */
export const communityRenderHtml: NonNullable<ReportDeps['renderHtml']> = async (wspRunDir) => {
  const result = await renderModeA({ wspRunDir, swaoVersion: SWAO_VERSION });
  return result.outputPath;
};

/** Community stub for the Enterprise per-app spawn runner. buildSpawnRunForApp
 * lives in @swao/module-portfolio (Enterprise), so the Community entry uses this
 * stub rather than importing that module. Reached only via the --portfolio
 * branch, which is Enterprise-gated; tierStub exits 1 with a clean message. */
export const communityRunForApp: AssessDeps['runForApp'] = async () =>
  tierStub('enterprise', 'assess/report --portfolio');

/** Community stub for the Enterprise portfolio dispatcher. */
export const communityRunPortfolio: NonNullable<AssessDeps['runPortfolio']> = async () =>
  tierStub('enterprise', 'assess/report --portfolio');

/** Community stub for the Enterprise portfolio summary formatter. */
export const communityFormatPortfolioResult: NonNullable<AssessDeps['formatPortfolioResult']> = () =>
  tierStub('enterprise', 'assess/report --portfolio');

/** Community/Consultant stub for the Enterprise HTML Portal builder (#1228, D-06). */
export const communityBuildPortal: BuildPortal = async () =>
  tierStub('enterprise', 'publish --site');
