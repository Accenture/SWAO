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

// SWAO full (Enterprise) entry -- the default dev / npm / test entry.
//
// #0583 (Sprint 064, ADR-0049 layer 2): the per-tier build system introduces
// src/tiers/{community,consultant,enterprise}.ts entries that bundle only their
// tier's modules. This file (src/index.ts) IS the full Enterprise wiring: it
// imports ALL tier modules and injects the REAL impls, so dev (`tsx`/`tsc`),
// `npm`/`pnpm`, the published bin, and the test suite (which spawn dist/index.js)
// keep their existing behaviour unchanged. src/tiers/enterprise.ts re-exports
// this entry. The Community / Consultant entries import strictly fewer modules,
// so esbuild excludes the higher-tier CODE from their bundles (verified by
// src/__tests__/tier-bundle-exclusion.test.ts).
//
// The shared program setup + Community command registration lives in
// bootstrap.ts (buildProgram). Here we compute the spawn descriptor (it needs
// THIS entry's import.meta.url -- the file that calls program.parse()), build
// the real runForApp + portfolio impls, wire the pdf renderer + portal builder,
// then register the Enterprise `challenge` command.

//
// #4387: the Enterprise wiring lives in tiers/enterprise-program.ts (importable
// by the root help drift test); every command module and tier module loads on
// first use, so `--version` / `--help` load no command stack.

import { fileURLToPath } from 'url';
import { installCrashHandlers } from './lib/crash-handlers.js';
import { normaliseNoLlmFlag } from './bootstrap.js';
import type { McpHostDeps } from './lib/mcp-chat-contract.js';
import type { PortfolioHostDeps } from '@swao/module-portfolio';
import { buildEnterpriseProgram } from './tiers/enterprise-program.js';

// #1475: crash telemetry (swao-crash.log in cwd); #4021: an unhandled
// rejection ends with exit 1 after the crash line. See lib/crash-handlers.ts.
installCrashHandlers();

// #0574/#0579: resolve the swao CLI invocation once, shared by the MCP server
// and the portfolio orchestrator (both spawn the CLI). In a pkg binary,
// process.execPath IS the swao binary, so spawn it directly (cliIsScript false).
// In dev, spawn the node execPath with this host entry script. McpHostDeps and
// PortfolioHostDeps are structurally identical descriptors.
// #1560: Enterprise entry -- force cap to 'enterprise' regardless of any
// inherited SWAO_BINARY_TIER from a parent shell or process (#2460). Child
// spawns inherit this value via env propagation, so they are also capped at
// the correct tier for the binary that is actually running.
process.env['SWAO_BINARY_TIER'] = 'enterprise';
process.env['NODE_ENV'] = 'production';

const cliSpawnDescriptor: McpHostDeps & PortfolioHostDeps = (process as { pkg?: unknown }).pkg
  ? { swaoCliPath: process.execPath, cliIsScript: false }
  : { swaoCliPath: fileURLToPath(import.meta.url), cliIsScript: true };

void buildEnterpriseProgram(cliSpawnDescriptor).then((program) => {
  // Normalise --no-llm to --skip-llm; Commander reserves --no-<option> for boolean negation (#1715).
  normaliseNoLlmFlag();
  program.parse();
});
