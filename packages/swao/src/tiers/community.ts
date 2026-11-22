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

// #4387: the command wiring lives in community-program.ts (importable by the
// root help drift test); the commands register lazily per invocation.

import { fileURLToPath } from 'url';
import type { McpHostDeps } from '../lib/mcp-chat-contract.js';
import { normaliseNoLlmFlag } from '../bootstrap.js';
import { buildCommunityProgram } from './community-program.js';

// #1560: cap effective tier so an Enterprise licence active in dev does not
// bypass Community feature gates when testing the Community binary.
if (!process.env['SWAO_BINARY_TIER']) process.env['SWAO_BINARY_TIER'] = 'community';

const cliSpawnDescriptor: McpHostDeps = (process as { pkg?: unknown }).pkg
  ? { swaoCliPath: process.execPath, cliIsScript: false }
  : { swaoCliPath: fileURLToPath(import.meta.url), cliIsScript: true };

// #1652 / #1787 / #2089 / #3321 / #3323: the gate stubs for unipipe, generate-tf,
// challenge and lz catalogue update, and the #2090 hiding of the Enterprise-only
// publish options, are part of the Community wiring (community-program.ts).
void buildCommunityProgram(cliSpawnDescriptor).then((program) => {
  // Normalise --no-llm to --skip-llm; Commander reserves --no-<option> for boolean negation (#1715).
  normaliseNoLlmFlag();
  program.parse();
});
