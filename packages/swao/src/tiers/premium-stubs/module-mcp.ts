// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Build-time stand-in for `@swao/module-mcp` in the Community and Consultant
 * bundles (#3348 B-01, Design 122). The MCP server (F-105) is Enterprise-only,
 * so build-lib.mjs aliases `@swao/module-mcp` to this file for those tiers and
 * the server code is not in their bundles. Every value the host imports from
 * the real module is exported here explicitly (no catch-all), so a new value
 * import fails the build ("No matching export") instead of shipping silently.
 *
 * Behaviour: `swao mcp` keeps its command tree, options and help text; every
 * action prints the same [LICENSE] block as before and exits 1 (`mcp install`
 * through the host gate, which adds the binary-edition hint). The real
 * `mcp profiles` measured the live tool definitions; here it refuses like the
 * rest of `swao mcp` (Design 122 B-01). The wizard helpers are only reached after the MCP registration gate, which
 * always refuses in these editions; they throw if reached anyway.
 */

import type { Command } from 'commander';
import { basename } from 'node:path';
import { LicenseGuard, type LicenseTier } from '@swao/core';
import { printLicenseGateError } from '../../lib/license-gate-error.js';

/** Same literal as the real module (client-install.ts); pinned by premium-stubs.test.ts. */
export const DEFAULT_MCP_HTTP_URL = 'http://localhost:3737/mcp';

const MCP_DESCRIPTION =
  'Start the SWAO MCP server (Enterprise). ' +
  'Default (no flags): stdio transport for Claude Desktop. ' +
  'Use --http to run an HTTP server on localhost for Claude Code. ' +
  'Run "swao mcp install" to update the Claude Desktop MCP config.';

/** Same list as the real module (client-install.ts); pinned by premium-stubs.test.ts. */
const MCP_CLIENT_NAMES = ['claude-desktop', 'claude-code', 'kilo', 'cursor', 'vscode'] as const;

const LICENSE_CONTACT_URL = 'https://github.com/Accenture/SWAO/discussions';

function currentTier(): LicenseTier {
  try { return LicenseGuard.load().state.tier; } catch { return 'community'; }
}

/** "Community" / "Consultant" when the running binary or image names its edition. */
export function binaryEditionLabel(execPath = process.execPath, env = process.env): string | undefined {
  const fromEnv = env['SWAO_BINARY_TIER'];
  const m = /swao-(community|consultant)-/.exec(basename(execPath)) ?? (fromEnv ? [fromEnv, fromEnv] : null);
  const tier = m?.[1];
  return tier === 'community' ? 'Community' : tier === 'consultant' ? 'Consultant' : undefined;
}

/** Prints the refusal for `label` and exits 1 (the exit code `swao mcp` and `swao chat` used before). */
export function refuseEnterpriseFeature(label: string, what: string): never {
  printLicenseGateError(label, 'enterprise', currentTier());
  const edition = binaryEditionLabel();
  if (edition) console.error(`This is the ${edition} binary; ${what} ships in the Enterprise binary (swao-enterprise-<os>-<arch>).`);
  process.exit(1);
}

/** Same stderr text and exit code as requireMcpLicence in the real commands/mcp.ts. */
function refuseMcpServer(label: string): never {
  process.stderr.write(
    `[LICENSE] ${label} requires an Enterprise licence.\n` +
    `Your current tier: ${currentTier()}\n` +
    `\n` +
    `To upgrade: swao license request --tier enterprise\n` +
    `Contact: ${LICENSE_CONTACT_URL}\n`,
  );
  process.exit(1);
}

function notInThisEdition(name: string): never {
  throw new Error(`${name}: the MCP server is not part of this edition (Enterprise only)`);
}

/** The part of the real McpInstallDeps the stub uses: the host's MCP registration gate. */
interface StubInstallDeps { requireLicence?: () => void }

/**
 * Same command tree, options and help text as the real registerMcp, so
 * `swao mcp --help` is unchanged (pinned by premium-stubs.test.ts). Every
 * action refuses: `mcp` and `mcp profiles` with the module's own gate text,
 * `mcp install` through the host gate (licence tier and binary edition) like
 * the real command.
 */
export function registerMcp(program: Command, _deps?: unknown, _version = '', installDeps?: StubInstallDeps): void {
  const mcp = program
    .command('mcp')
    .description(MCP_DESCRIPTION)
    .option('--http', 'Use HTTP transport instead of stdio')
    .option('--port <port>', 'HTTP server port', '3737')
    .option(
      '--workspace <path>',
      'Pin the workspace root path (overrides cwd-based detection and env SWAO_WORKSPACE). ' +
      'Pinned servers hide the workspace_path tool parameter. ' +
      'Useful when launching the MCP server from a different directory than the workspace.',
    )
    .option(
      '--replace',
      'With --http: stop the SWAO MCP server already running on the port (verified by its pid file and an ' +
      'initialize probe) and start in its place. Never stops a non-SWAO process.',
    )
    .option(
      '--host <addr>',
      'With --http: bind address. localhost binds 127.0.0.1 and ::1; another loopback address binds only itself; ' +
      'a non-loopback address needs --allow-remote.',
      'localhost',
    )
    .option('--allow-remote', 'With --http: allow a non-loopback --host (the server has no authentication)')
    .option(
      '--log-file <path>',
      'Request log file (default <workspace>/wsp/logs/mcp-server.log, else wsp/logs next to the SWAO binary); ' +
      '"-" writes to stderr only',
    )
    .option('--log-level <level>', 'Request log level: error, warn, info or debug', 'info')
    .option('--profile <name>', 'Tool profile: starter, assess or full (default full; env SWAO_MCP_PROFILE, workspace .swao.yml mcp.profile)')
    .option('--tools <names>', 'Comma-separated exact tool names instead of a profile (env SWAO_MCP_TOOLS, workspace .swao.yml mcp.tools)')
    .action(() => refuseMcpServer('swao mcp'));

  // The real `mcp profiles` measures the live tool definitions, which are not in this edition.
  mcp
    .command('profiles')
    .description('List the MCP tool profiles (starter, assess, full) with their tools, measured size and token budget.')
    .action(() => refuseMcpServer('swao mcp profiles'));

  if (installDeps) {
    mcp
      .command('install')
      .description(
        'Write (or update) the SWAO MCP entry in the Claude Desktop config ' +
        'so Claude Desktop uses the current binary (registered via a stable ' +
        'copy in the same folder named for the running tier, swao-enterprise-win-x64.exe on Windows; ' +
        'a source run registers node plus the script path). Enterprise. Safe to re-run.',
      )
      .option('--client <name>', `MCP client to configure: ${MCP_CLIENT_NAMES.join(', ')} (omit for the Claude Desktop multi-config update)`)
      .option('--scope <scope>', 'With --client: user (default) or project (config in the current folder)')
      .option('--transport <transport>', 'With --client: stdio or http (default http for claude-code, stdio otherwise)')
      .option('--url <url>', 'With --client and --transport http: server URL (default http://localhost:3737/mcp)')
      .option('--agent', 'With --client: also write the lean SWAO agent file (default for kilo and claude-code)')
      .option('--no-agent', 'With --client: do not write the agent file')
      .option('--dry-run', 'With --client: print the changes as a diff and write nothing')
      .option('--uninstall', 'With --client: remove the SWAO entry (and the generated agent file), with a backup')
      .addHelpText(
        'after',
        '\nWith --client, --profile <name> and --workspace <path> (options of swao mcp, accepted here too) select the ' +
        'tool profile (default starter with an agent, full otherwise) and the workspace written into stdio entries.\n',
      )
      .action(() => {
        installDeps.requireLicence?.();
        // The host gate refuses every lower-tier binary; reaching here is still not an install.
        refuseEnterpriseFeature('swao mcp install', 'the MCP server');
      });
  }
}

export function defaultTransport(_client: unknown): never { return notInThisEdition('defaultTransport'); }
export function profileToolNames(_profile: unknown): never { return notInThisEdition('profileToolNames'); }
export function clientDisplayName(_client: unknown): never { return notInThisEdition('clientDisplayName'); }
export function isSwaoGeneratedAgent(_text: string): boolean { return false; }
export function renderAgentTemplate(_client: unknown, _input: unknown): never { return notInThisEdition('renderAgentTemplate'); }
