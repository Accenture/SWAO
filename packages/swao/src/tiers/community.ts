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
// (Consultant), @swao/module-terraform (Enterprise), @swao/module-html-portal
// (Consultant), @swao/module-portfolio (Enterprise) and @swao/module-challenge
// (Enterprise) are deliberately absent. esbuild therefore omits their CODE from
// the Community bundle entirely (verified by
// src/__tests__/tier-bundle-exclusion.test.ts). The tier slots are gated stubs
// from bootstrap.ts; `generate-tf`, `challenge`, `unipipe` and `lz catalogue
// update` are registered only as [LICENSE] stubs (community-stubs.ts).
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
  communityServiceDeps,
} from '../bootstrap.js';
import { registerCommunityTierStubs } from './community-stubs.js';

// #1560: cap effective tier so an Enterprise licence active in dev does not
// bypass Community feature gates when testing the Community binary.
if (!process.env['SWAO_BINARY_TIER']) process.env['SWAO_BINARY_TIER'] = 'community';

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
    renderPdf: communityRenderPdf,
    renderLlmPdf: communityRenderLlmPdf,
    runPortfolio: communityRunPortfolio,
    formatPortfolioResult: communityFormatPortfolioResult,
  },
});

// Normalise --no-llm to --skip-llm; Commander reserves --no-<option> for boolean negation (#1715).
const _noLlmIdx = process.argv.indexOf('--no-llm');
if (_noLlmIdx !== -1) process.argv.splice(_noLlmIdx, 1, '--skip-llm');

// #1652 / #1787 / #2089 / #3321 / #3323: gate stubs for unipipe, generate-tf,
// challenge and lz catalogue update. Each prints the [LICENSE] block for its
// FEATURE_GATES tier and exits 2 (see community-stubs.ts).
registerCommunityTierStubs(program);

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
