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

// SWAO Community-tier entry (#0583, Sprint 064, ADR-0049 layer 2).
//
// This entry imports NONE of the higher-tier modules: @swao/module-pdf-report
// (Consultant), @swao/module-terraform (Consultant), @swao/module-html-portal
// (Consultant), @swao/module-portfolio (Enterprise) and @swao/module-challenge
// (Enterprise) are deliberately absent. esbuild therefore omits their CODE from
// the Community bundle entirely (verified by
// src/__tests__/tier-bundle-exclusion.test.ts). The tier slots are gated stubs
// from bootstrap.ts; the `generate-tf` and `challenge` whole commands are not
// registered here at all.
//
// runForApp is the per-app spawn runner used ONLY by the --portfolio branch,
// which is Enterprise-gated. buildSpawnRunForApp lives in @swao/module-portfolio
// (Enterprise), so the Community entry must NOT import it (that would pull the
// module's code into the bundle). Instead runForApp is a gated stub from
// bootstrap.ts -- it is unreachable in Community (the requireTier('enterprise')
// gate fires first).
//
// The MCP spawn descriptor is computed HERE (it needs this entry's
// import.meta.url, which must resolve to the file that calls program.parse()).
// In a pkg binary process.pkg is true so execPath is used; in dev/test it is
// the node execPath + this script.

import { fileURLToPath } from 'url';
import type { McpHostDeps } from '@swao/module-mcp';
import {
  buildProgram,
  communityRenderHtml,
  communityRenderPdf,
  communityRenderLlmPdf,
  communityRunPortfolio,
  communityFormatPortfolioResult,
  communityBuildPortal,
  communityRunForApp,
} from '../bootstrap.js';

// #1560: cap effective tier so an Enterprise licence active in dev does not
// bypass Community feature gates when testing the Community binary.
if (!process.env['SWAO_BINARY_TIER']) process.env['SWAO_BINARY_TIER'] = 'community';

const cliSpawnDescriptor: McpHostDeps = (process as { pkg?: unknown }).pkg
  ? { swaoCliPath: process.execPath, cliIsScript: false }
  : { swaoCliPath: fileURLToPath(import.meta.url), cliIsScript: true };

const program = buildProgram({
  cliSpawnDescriptor,
  buildPortal: communityBuildPortal,
  assessDeps: {
    runForApp: communityRunForApp,
    runPortfolio: communityRunPortfolio,
    formatPortfolioResult: communityFormatPortfolioResult,
  },
  reportDeps: {
    runForApp: communityRunForApp,
    renderHtml: communityRenderHtml,
    renderPdf: communityRenderPdf,
    renderLlmPdf: communityRenderLlmPdf,
    runPortfolio: communityRunPortfolio,
    formatPortfolioResult: communityFormatPortfolioResult,
  },
});

// Normalise --no-llm to --skip-llm; Commander reserves --no-<option> for boolean negation (#1715).
const _noLlmIdx = process.argv.indexOf('--no-llm');
if (_noLlmIdx !== -1) process.argv.splice(_noLlmIdx, 1, '--skip-llm');

// #1652: Register unipipe as a Consultant tier-gate stub for the Community binary.
// #1851/#1853: .allowUnknownOption(true) lets --help and any other flags reach the
// action instead of being rejected by Commander as unknown options (#1851 showed
// .helpOption(false) caused Commander to print its own generic error before the
// action could fire the [LICENSE] message).
program
  .command('unipipe')
  .description('meshcloud UniPipe integration (Consultant+)')
  .helpOption(false)
  .allowUnknownOption(true)
  .action(() => {
    console.error('[LICENSE] swao unipipe requires a Consultant or Enterprise license.\nRun `swao license request` to obtain a license.\nContact: https://github.com/Accenture/SWAO/discussions');
    process.exit(2);
  });

// #1787: Register generate-tf / tf-gen as a Consultant tier-gate stub so
// Commander routes the command name to an explicit rejection message rather
// than falling back to the main help. Does NOT import @swao/module-terraform
// (that module is absent from the Community bundle per the esbuild tier split).
// #1850/#1852: .helpOption(false) removes built-in --help; .allowUnknownOption(true)
// prevents Commander rejecting --help as unknown so the action fires instead.
program
  .command('generate-tf')
  .alias('tf-gen')
  .description('Generate Terraform modules for sovereign landing zone (Consultant+)')
  .helpOption(false)
  .allowUnknownOption(true)
  .action(() => {
    console.error('[LICENSE] swao generate-tf requires a Consultant or Enterprise license.\nRun `swao license request` to obtain a license.\nContact: https://github.com/Accenture/SWAO/discussions');
    process.exit(2);
  });

// #2089: Register challenge as an Enterprise tier-gate stub so the Community binary
// exits 2 with a clear message rather than Commander's default "unknown command" error.
program
  .command('challenge')
  .description('AI-generated stakeholder challenge questions (Enterprise)')
  .helpOption(false)
  .allowUnknownOption(true)
  .action(() => {
    console.error('[LICENSE] swao challenge requires an Enterprise license.\nRun `swao license request` to obtain a license.\nContact: https://github.com/Accenture/SWAO/discussions');
    process.exit(2);
  });

// #2090: Hide Enterprise-only publish options from Community --help.
// --site, --site-app, --edit all requireTier('enterprise') in publish.ts action;
// showing them on a Community binary is misleading.
const publishCmd = program.commands.find((c) => c.name() === 'publish');
if (publishCmd) {
  const _enterprisePublishOpts = new Set(['--site', '--site-app', '--edit']);
  for (const opt of publishCmd.options) {
    if (_enterprisePublishOpts.has(opt.long ?? '')) opt.hidden = true;
  }
}

program.parse();
