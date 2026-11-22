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

// #4387: the command wiring lives in consultant-program.ts (importable by the
// root help drift test); the commands and tier modules load lazily per invocation.

import { fileURLToPath } from 'url';
import type { McpHostDeps } from '../lib/mcp-chat-contract.js';
import { normaliseNoLlmFlag } from '../bootstrap.js';
import { buildConsultantProgram } from './consultant-program.js';

// #1560: cap effective tier to Consultant for the Consultant binary.
if (!process.env['SWAO_BINARY_TIER']) process.env['SWAO_BINARY_TIER'] = 'consultant';

const cliSpawnDescriptor: McpHostDeps = (process as { pkg?: unknown }).pkg
  ? { swaoCliPath: process.execPath, cliIsScript: false }
  : { swaoCliPath: fileURLToPath(import.meta.url), cliIsScript: true };

void buildConsultantProgram(cliSpawnDescriptor).then((program) => {
  // Normalise --no-llm to --skip-llm; Commander reserves --no-<option> for boolean negation (#1715).
  normaliseNoLlmFlag();
  program.parse();
});
