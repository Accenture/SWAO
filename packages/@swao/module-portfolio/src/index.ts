// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Portfolio module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type {
  SwaoModuleManifest,
  TuiScreenContribution,
} from '@swao/core';

import { PortfolioScreen } from './tui/PortfolioScreen.js';

/**
 * @swao/module-portfolio -- the general spawn-based portfolio orchestrator plus
 * the PortfolioScreen TUI (ADR-0048 modular architecture, Phase 5, #0579).
 * Enterprise tier.
 *
 * The orchestrator DISCOVERS apps under <workspace>/apps/ and DISPATCHES one
 * swao CLI run per app by SPAWNING the CLI (exactly like @swao/module-mcp),
 * aggregating per-app ok/fail status. It never imports assess/report/export code
 * (that would be module->module): a `@swao/module-*` imports ONLY @swao/core,
 * @swao/tui-kit, and leaf npm deps. The swao CLI invocation is host-injected
 * (PortfolioHostDeps { swaoCliPath, cliIsScript } + resolveSpawn, mirroring
 * McpHostDeps); the host computes the descriptor in index.ts and builds the
 * production runForApp via buildSpawnRunForApp.
 *
 * This handles the GENERAL --portfolio case that previously printed "Portfolio
 * runner not yet implemented" in assess.ts / report.ts. The existing
 * `--portfolio --lzr` aggregate (runPortfolioLzr / formatPortfolioLzrReport)
 * stays host-side, untouched: it is LZR-specific, not a per-app dispatch.
 *
 * There is no new top-level CLI command: `--portfolio` is a FLAG on the existing
 * assess / report commands, which call runPortfolio in their --portfolio
 * branches. The runtime gate stays `requireTier('enterprise', ...)` on those
 * flags (preserved, not a new decision).
 *
 * The only host value the screen needs -- the SWAO version (branding is
 * host-only) -- is injected as the screen's `version` prop at the App.tsx call
 * site (the #0573 DoctorScreen dependency-injection pattern). The screen's own
 * BIN/SELF spawn (process.execPath / process.argv[1]) runs in the host process,
 * so it resolves the host CLI directly and needs no descriptor injection -- only
 * the orchestrator's production runForApp (used from a possible pkg binary) does.
 */

// Orchestrator: the general per-app portfolio dispatcher (spawn + aggregate).
export {
  PortfolioOrchestrator,
  runPortfolio,
  discoverApps,
  resolveSpawn,
  buildSpawnRunForApp,
  formatPortfolioResult,
} from './orchestrator.js';
export type {
  PortfolioCommand,
  PortfolioRunResult,
  PortfolioRunDeps,
  PortfolioAppOutcome,
  PortfolioResult,
  PortfolioHostDeps,
} from './orchestrator.js';

// TUI screen contributed by this module (#0579). The host renders it via direct
// import today (App.tsx) and injects the SWAO version (branding is host-only).
export { PortfolioScreen } from './tui/PortfolioScreen.js';
export { LicenseGate, isAllowed } from '@swao/tui-kit';

export const tuiScreens: TuiScreenContribution[] = [
  { name: 'PortfolioScreen', tier: 'enterprise', component: PortfolioScreen },
];

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-portfolio',
  version: '0.1.0',
  tier: 'enterprise',
  contributions: {
    tuiScreens,
  },
};
