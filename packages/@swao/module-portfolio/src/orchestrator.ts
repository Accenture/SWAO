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

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @swao/module-portfolio orchestrator (ADR-0048 modular architecture, Phase 5,
 * #0579). Enterprise tier.
 *
 * The PortfolioOrchestrator is the GENERAL per-app portfolio dispatcher: it
 * discovers the apps in a workspace and dispatches one swao CLI run per app
 * (`swao assess --app <id>`, `swao report --app <id>`, ...), then aggregates the
 * per-app ok/fail status into a PortfolioResult. It is deliberately SEPARATE
 * from the existing `--portfolio --lzr` aggregate (runPortfolioLzr, which stays
 * host-side because it is LZR-specific): this module handles the general case
 * that previously printed "Portfolio runner not yet implemented".
 *
 * SPAWN, never import (the module->module rule): the orchestrator runs each app
 * by SPAWNING the swao CLI -- exactly like @swao/module-mcp's runSwao -- rather
 * than importing assess/report/export code (a `@swao/module-*` may import ONLY
 * @swao/core, @swao/tui-kit, and leaf npm deps, NEVER the host or a sibling
 * module). The swao CLI invocation is host-injected: the host computes the
 * PortfolioHostDeps descriptor in index.ts (pkg binary -> process.execPath; dev
 * -> the host entry via node) and builds the production runForApp from it.
 *
 * Testability: the per-app runner is the injectable `PortfolioRunDeps.runForApp`
 * function so unit tests can supply a mock and assert dispatch + aggregation
 * without spawning real subprocesses. `runForApp` defaults to nothing -- the
 * host wires the production runner via buildSpawnRunForApp.
 */

/** Commands the portfolio orchestrator can dispatch per app. */
export type PortfolioCommand = 'assess' | 'report' | 'export';

/** Outcome of one per-app CLI run. */
export interface PortfolioRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Host-injected dependency: run the swao CLI for one app and return its result.
 * The production implementation spawns the CLI (see buildSpawnRunForApp); unit
 * tests inject a mock that records calls and returns canned results, so no real
 * subprocess is spawned in the test suite.
 */
export interface PortfolioRunDeps {
  runForApp: (appId: string, args: string[]) => Promise<PortfolioRunResult>;
}

/** Per-app entry in the aggregated portfolio summary. */
export interface PortfolioAppOutcome {
  appId: string;
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Aggregated result of a portfolio run across all discovered apps. */
export interface PortfolioResult {
  command: PortfolioCommand;
  workspacePath: string;
  /** Apps discovered under <workspace>/apps/ (sorted, deterministic). */
  apps: string[];
  /** One outcome per dispatched app, in discovery order. */
  outcomes: PortfolioAppOutcome[];
  counts: { total: number; ok: number; failed: number };
}

/**
 * Host-side spawn descriptor for the production runForApp, mirroring
 * @swao/module-mcp's McpHostDeps. After extraction `__dirname` no longer
 * resolves the host CLI from inside this module's dist, so the host must tell us
 * which CLI to invoke and whether it is a node script or a native pkg binary.
 *   - swaoCliPath: absolute path to the swao CLI entry to spawn.
 *   - cliIsScript: true when swaoCliPath is a .js/.ts to run via the node
 *     execPath; false when it is a native pkg binary (execPath IS swao).
 */
export interface PortfolioHostDeps {
  swaoCliPath: string;
  cliIsScript: boolean;
}

/**
 * Pure resolver for the spawn command/args from the injected host deps. Mirrors
 * @swao/module-mcp's resolveSpawn so the DI branches are unit-testable without
 * spawning a subprocess. The `deps` argument is explicit (not a module global)
 * so the function stays pure.
 *   - cliIsScript: spawn the node execPath with [swaoCliPath, ...args]  (dev)
 *   - else:        spawn swaoCliPath directly with args                 (pkg binary)
 *   - null deps:   defensive fallback (host forgot to inject)
 */
export function resolveSpawn(
  deps: PortfolioHostDeps | null,
  args: string[],
): { cmd: string; cmdArgs: string[] } {
  if (!deps) {
    return { cmd: process.execPath, cmdArgs: [process.argv[1] ?? '', ...args] };
  }
  if (deps.cliIsScript) {
    return { cmd: process.execPath, cmdArgs: [deps.swaoCliPath, ...args] };
  }
  return { cmd: deps.swaoCliPath, cmdArgs: args };
}

/**
 * Build the production `runForApp` from a host-resolved spawn descriptor. The
 * host (the single place that knows the CLI path) calls this in index.ts and
 * passes the result into the assess/report --portfolio branches.
 *
 * The spawned process inherits the parent cwd; runPortfolio appends
 * `--workspace <path>` to every per-app invocation so the target workspace is
 * explicit and independent of cwd (the operator may have passed --workspace).
 *
 * No SWAO_PORTFOLIO_CONTEXT env flag is set: the spawned invocation is a plain
 * per-app `swao <command> --app <id> --workspace <path>` (NOT `--portfolio`), so
 * it never re-enters the portfolio branch and needs no context marker.
 * (Confirmed: nothing in the tree reads such a flag.)
 */
export function buildSpawnRunForApp(
  deps: PortfolioHostDeps | null,
): PortfolioRunDeps['runForApp'] {
  return async (_appId: string, args: string[]): Promise<PortfolioRunResult> => {
    const { cmd, cmdArgs } = resolveSpawn(deps, args);
    const result = spawnSync(cmd, cmdArgs, {
      encoding: 'utf-8',
      env: { ...process.env },
      timeout: 300_000,
    });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      ok: result.status === 0,
    };
  };
}

/**
 * Discover assessable apps in a workspace by listing the immediate child
 * directories of `<workspace>/apps/`. Reuses the same convention as the host
 * commands and the MCP swao_portfolio_summary tool (readdir of apps/). Returns a
 * sorted list for deterministic dispatch order. Returns [] when apps/ is absent.
 */
export function discoverApps(workspacePath: string): string[] {
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/**
 * The general per-app portfolio dispatcher. Discovers apps, then for each app
 * calls `deps.runForApp(appId, [command, '--app', appId, ...extraArgs])` and
 * aggregates the per-app ok/fail outcomes into a PortfolioResult. Deterministic
 * and pure aside from `deps.runForApp` (the only side-effecting dependency, so
 * tests inject a mock). Runs apps sequentially in discovery order so the
 * aggregated output is reproducible and per-app logs do not interleave.
 */
export async function runPortfolio(
  workspacePath: string,
  command: PortfolioCommand,
  extraArgs: string[],
  deps: PortfolioRunDeps,
): Promise<PortfolioResult> {
  const apps = discoverApps(workspacePath);
  const outcomes: PortfolioAppOutcome[] = [];
  for (const appId of apps) {
    // Per-app args: `<command> --app <id> --workspace <path> ...extra`. The
    // explicit --workspace makes the spawned run target the discovered
    // workspace regardless of cwd; no --portfolio, so no re-entry.
    const args = [command, '--app', appId, '--workspace', workspacePath, ...extraArgs];
    const r = await deps.runForApp(appId, args);
    outcomes.push({ appId, ok: r.ok, stdout: r.stdout, stderr: r.stderr });
  }
  const ok = outcomes.filter((o) => o.ok).length;
  return {
    command,
    workspacePath,
    apps,
    outcomes,
    counts: { total: apps.length, ok, failed: apps.length - ok },
  };
}

/**
 * Render a PortfolioResult as a human-readable summary block for the CLI. Pure;
 * the host prints the returned string. Kept here so the assess/report branches
 * stay thin and the format is reusable.
 */
export function formatPortfolioResult(result: PortfolioResult): string {
  const lines: string[] = [
    `Portfolio ${result.command} -- ${result.counts.total} app(s) in ${result.workspacePath}`,
    `  ${result.counts.ok} ok, ${result.counts.failed} failed`,
    '',
  ];
  if (result.apps.length === 0) {
    lines.push('  No apps discovered under apps/. Was the workspace set up?');
    return lines.join('\n');
  }
  for (const o of result.outcomes) {
    lines.push(`  [${o.ok ? 'ok' : 'fail'}] ${o.appId}`);
  }
  return lines.join('\n');
}

/**
 * Thin class wrapper around the functional API. Some host call sites prefer an
 * object they can inject and hold; the methods delegate to the pure functions
 * above so behaviour is identical whether callers use the class or the
 * standalone exports.
 */
export class PortfolioOrchestrator {
  constructor(private readonly deps: PortfolioRunDeps) {}

  discoverApps(workspacePath: string): string[] {
    return discoverApps(workspacePath);
  }

  runPortfolio(
    workspacePath: string,
    command: PortfolioCommand,
    extraArgs: string[],
  ): Promise<PortfolioResult> {
    return runPortfolio(workspacePath, command, extraArgs, this.deps);
  }
}
