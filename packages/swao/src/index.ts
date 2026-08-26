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

import { fileURLToPath } from 'url';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildProgram, communityRenderHtml } from './bootstrap.js';

// #1475: crash telemetry -- capture unhandled rejections and uncaught exceptions
// to a file in cwd so the root cause survives the terminal close. Both handlers
// use synchronous I/O to guarantee the write completes before process exit.
const _crashLog = join(process.cwd(), 'swao-crash.log');
const _writeCrash = (label: string, detail: string): void => {
  const line = `[${new Date().toISOString()}] ${label}\n${detail}\n---\n`;
  try { appendFileSync(_crashLog, line, 'utf-8'); } catch { /* fs failure -- silently skip */ }
  try { process.stderr.write(line); } catch { /* broken pipe -- silently skip */ }
};
process.on('unhandledRejection', (reason) => {
  _writeCrash('unhandledRejection', reason instanceof Error ? (reason.stack ?? String(reason)) : String(reason));
});
process.on('uncaughtException', (err) => {
  _writeCrash('uncaughtException', err.stack ?? String(err));
  process.exit(1);
});
// #0580: challenge command + ChallengeScreen + persona taxonomy live in
// @swao/module-challenge (Enterprise tier). The module must not import the
// sibling @swao/module-llm-providers, so the host injects createLlmProvider into
// registerChallenge (mirrors the #0573 doctor probe-builder DI pattern).
import { registerChallenge } from '@swao/module-challenge';
import { registerUnipipe } from './commands/unipipe.js';
import { createLlmProvider as _baseLlmProvider, UsageTrackingLlmProvider } from '@swao/module-llm-providers';
import type { LlmProvider } from '@swao/module-llm-providers';
// #1819: when spawned as a challenge subprocess inside an LLM Assessment leg,
// wrap createLlmProvider so every challenge LLM call is recorded to the leg sink.
import { createLegRecorderFromEnv } from '@swao/module-llm-assessment';
// #0578: generate-tf command (Consultant). registerGenerateTf imports only
// @swao/core, so the host wires it directly.
import { registerGenerateTf } from '@swao/module-terraform';
// #0872: lz catalogue update command (Consultant+). Must be called after
// registerLz (via buildProgram) since it attaches to the existing lz catalogue group.
import { registerLzCatalogueUpdate } from '@swao/module-landing-zone';
// #0579: portfolio orchestration (Enterprise). The module spawns the swao CLI
// per app and must not import host code, so the host resolves the CLI invocation
// once (PortfolioHostDeps, identical to McpHostDeps) and builds the production
// per-app runForApp + injects the orchestrator entry points.
import {
  buildSpawnRunForApp,
  runPortfolio,
  formatPortfolioResult,
  type PortfolioHostDeps,
} from '@swao/module-portfolio';
import type { McpHostDeps } from '@swao/module-mcp';
// #0576: the PDF renderer (Consultant) is wired in here for the full entry.
import { renderTextReportToPdf, renderLlmComparisonToPdf } from '@swao/module-pdf-report';
// #0582: the HTML Portal builder (Consultant) -- `publish --site`.
import { buildPortalSite } from '@swao/module-html-portal';

// #0574/#0579: resolve the swao CLI invocation once, shared by the MCP server
// and the portfolio orchestrator (both spawn the CLI). In a pkg binary,
// process.execPath IS the swao binary, so spawn it directly (cliIsScript false).
// In dev, spawn the node execPath with this host entry script. McpHostDeps and
// PortfolioHostDeps are structurally identical descriptors.
// #1560: Enterprise entry -- set cap to 'enterprise' (allows all features).
if (!process.env['SWAO_BINARY_TIER']) process.env['SWAO_BINARY_TIER'] = 'enterprise';

const cliSpawnDescriptor: McpHostDeps & PortfolioHostDeps = (process as { pkg?: unknown }).pkg
  ? { swaoCliPath: process.execPath, cliIsScript: false }
  : { swaoCliPath: fileURLToPath(import.meta.url), cliIsScript: true };
// Production per-app runner for the general --portfolio dispatch. The
// orchestrator appends `--workspace <path>` to every per-app invocation, so the
// spawned run targets the discovered workspace regardless of cwd.
const portfolioRunForApp = buildSpawnRunForApp(cliSpawnDescriptor);

const program = buildProgram({
  cliSpawnDescriptor,
  buildPortal: buildPortalSite,
  assessDeps: {
    runForApp: portfolioRunForApp,
    runPortfolio,
    formatPortfolioResult,
  },
  reportDeps: {
    runForApp: portfolioRunForApp,
    renderHtml: communityRenderHtml,
    renderPdf: renderTextReportToPdf,
    renderLlmPdf: renderLlmComparisonToPdf,
    runPortfolio,
    formatPortfolioResult,
  },
});

// Consultant command: generate-tf (Terraform HCL generator).
registerGenerateTf(program);
// Consultant command: lz catalogue update (Design 065 §5.6).
registerLzCatalogueUpdate(program);
// Consultant+ command: unipipe (meshcloud UniPipe integration stub, #1652).
registerUnipipe(program);
// Enterprise command: challenge (LLM-driven assessment challenge personas).
// When SWAO_LLM_ASSESSMENT_RECORD is set this process is a challenge subprocess
// inside an LLM Assessment leg; wrap the factory so every LLM call is recorded
// to the leg's sink file alongside the standard assessment calls (#1819).
const _legRecorder = createLegRecorderFromEnv();
const createLlmProvider: typeof _baseLlmProvider = _legRecorder
  ? (appId, passName, config): LlmProvider => {
      const base = _baseLlmProvider(appId, passName, config);
      const tracking = new UsageTrackingLlmProvider(base);
      _legRecorder.setPass(passName ?? 'challenge', 'challenge');
      return _legRecorder.wrap(tracking, () => tracking.snapshot()) as LlmProvider;
    }
  : _baseLlmProvider;
registerChallenge(program, { createLlmProvider });

// Normalise --no-llm to --skip-llm; Commander reserves --no-<option> for boolean negation (#1715).
const _noLlmIdx = process.argv.indexOf('--no-llm');
if (_noLlmIdx !== -1) process.argv.splice(_noLlmIdx, 1, '--skip-llm');

program.parse();
