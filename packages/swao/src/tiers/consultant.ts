#!/usr/bin/env node
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

// SWAO Consultant-tier entry (#0583, Sprint 064, ADR-0049 layer 2).
//
// Community surface + the two Consultant tier modules wired in for real:
//   - @swao/module-pdf-report  -> renderTextReportToPdf (report --format pdf)
//   - @swao/module-terraform   -> registerGenerateTf   (generate-tf command)
// publish --site (HTML Portal) is Enterprise-only (#1562); the slot uses the
// communityBuildPortal tier stub here just as in the Community entry.
// @swao/module-html-portal is absent from this bundle.
// The Enterprise modules (@swao/module-portfolio, @swao/module-challenge) are
// still absent here; their slots remain gated stubs and the `challenge` command
// is not registered. esbuild therefore omits the Enterprise module code from the
// Consultant bundle.
//
// runForApp is the per-app spawn runner used only by the --portfolio branch,
// which is Enterprise-gated. buildSpawnRunForApp lives in @swao/module-portfolio
// (Enterprise), so even the Consultant entry must NOT import it; runForApp stays
// a gated stub here.

import { fileURLToPath } from 'url';
import type { McpHostDeps } from '@swao/module-mcp';
import { renderTextReportToPdf, renderLlmComparisonToPdf } from '@swao/module-pdf-report';
import { registerGenerateTf } from '@swao/module-terraform';
import { GenerateTfScreen } from '@swao/module-terraform';
import { premiumScreens } from '../tui/premium-screens.js';
import { registerLzCatalogueUpdate } from '@swao/module-landing-zone';
import { registerUnipipe } from '../commands/unipipe.js';
import { registerLicenceStub } from '../lib/tier-stub.js';
import {
  buildProgram,
  communityBuildPortal,
  communityRenderHtml,
  communityRunPortfolio,
  communityFormatPortfolioResult,
  communityRunForApp,
  communityServiceDeps,
} from '../bootstrap.js';

// #1560: cap effective tier to Consultant for the Consultant binary.
if (!process.env['SWAO_BINARY_TIER']) process.env['SWAO_BINARY_TIER'] = 'consultant';

// Register premium TUI screens available at Consultant tier (sprint-128 #2132).
premiumScreens.GenerateTfScreen = GenerateTfScreen;

const cliSpawnDescriptor: McpHostDeps = (process as { pkg?: unknown }).pkg
  ? { swaoCliPath: process.execPath, cliIsScript: false }
  : { swaoCliPath: fileURLToPath(import.meta.url), cliIsScript: true };

const program = buildProgram({
  cliSpawnDescriptor,
  buildPortal: communityBuildPortal,
  serviceDeps: communityServiceDeps,
  assessDeps: {
    runForApp: communityRunForApp,
    runPortfolio: communityRunPortfolio,
    formatPortfolioResult: communityFormatPortfolioResult,
  },
  reportDeps: {
    runForApp: communityRunForApp,
    renderHtml: communityRenderHtml,
    renderPdf: renderTextReportToPdf,
    renderLlmPdf: renderLlmComparisonToPdf,
    runPortfolio: communityRunPortfolio,
    formatPortfolioResult: communityFormatPortfolioResult,
  },
});

// generate-tf (Terraform HCL generator): Enterprise roadmap (F-090,
// FEATURE_GATES['generate-tf']); on this binary the command prints the
// Enterprise [LICENSE] block. registerGenerateTf imports only @swao/core, so it
// is wired directly (mirrors index.ts).
registerGenerateTf(program);

// Consultant command: lz catalogue update (Design 065 §5.6).
registerLzCatalogueUpdate(program);

// unipipe (meshcloud UniPipe integration stub, #1652): Enterprise roadmap
// (licence tier matrix D-04, FEATURE_GATES['unipipe']); prints the [LICENSE] block here.
registerUnipipe(program);

// #2089: Register challenge as an Enterprise tier-gate stub so the Consultant binary
// exits 2 with a clear message rather than Commander's default "unknown command" error.
// Tier and wording come from FEATURE_GATES['challenge'] (lib/tier-stub.ts).
registerLicenceStub(program, {
  name: 'challenge',
  description: 'AI-generated stakeholder challenge questions',
  label: 'swao challenge',
  key: 'challenge',
});

// #2090: Hide Enterprise-only publish options from Consultant --help (#2090).
const publishCmd = program.commands.find((c) => c.name() === 'publish');
if (publishCmd) {
  const _enterprisePublishOpts = new Set(['--site', '--site-app', '--edit']);
  for (const opt of publishCmd.options) {
    if (_enterprisePublishOpts.has(opt.long ?? '')) opt.hidden = true;
  }
}

// Normalise --no-llm to --skip-llm; Commander reserves --no-<option> for boolean negation (#1715).
const _noLlmIdx = process.argv.indexOf('--no-llm');
if (_noLlmIdx !== -1) process.argv.splice(_noLlmIdx, 1, '--skip-llm');

program.parse();
