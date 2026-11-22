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

// swao llm -- LLM workload assessment surface (#1558).
//
// This command group is intentionally thin. The full assessment engine lives in
// `swao assess --type llm`; the `llm` route gives operators a memorable entry
// point and a clear help page without duplicating the engine surface.
//
// Available on all tiers (LLM gateways are Community+ per tier matrix).

import type { Command } from 'commander';
import { findWorkspace, logPortfolio } from '@swao/core';
import {
  getConnector, listConnectors, refreshConnectorModels, discoveryFallbackText,
  type LoadedConnector, type ModelRefresh,
} from '@swao/module-llm-providers';
import { pickerModelList, type PickerModel } from '../tui/model-picker-list.js';

/** #4475: dependencies of `swao llm models` (tests inject a fake refresh). */
export interface LlmModelsDeps {
  findWorkspace: (cwd: string) => string | null | undefined;
  getConnector: (id: string, workspaceRoot: string | undefined) => LoadedConnector | undefined;
  listConnectorIds: (workspaceRoot: string | undefined) => string[];
  refresh: (loaded: LoadedConnector, workspaceRoot: string | undefined) => Promise<ModelRefresh>;
  out: (s: string) => void;
  err: (s: string) => void;
}

const NL = String.fromCharCode(10);

const DEFAULT_DEPS: LlmModelsDeps = {
  findWorkspace: (cwd) => findWorkspace(cwd),
  getConnector: (id, ws) => getConnector(id, { workspaceRoot: ws, seedIfEmpty: !!ws }),
  listConnectorIds: (ws) => listConnectors({ workspaceRoot: ws, seedIfEmpty: !!ws }).connectors.map((c) => c.file.connector.id),
  refresh: (loaded, ws) => refreshConnectorModels(loaded, { workspaceRoot: ws }),
  out: (s) => { process.stdout.write(s); },
  err: (s) => { process.stderr.write(s); },
};

function fmtPrice(m: PickerModel): string {
  const c = m.entry.cost;
  return c ? `$${+c.input_per_million.toFixed(4)}/M in, $${+c.output_per_million.toFixed(4)}/M out` : '';
}

/**
 * #4475 (Design 090 section 7.4, TUI/CLI parity with the model pickers): read
 * the served models of one connector live, merge them into the workspace
 * connector file and print them in the picker order. Offline or air-gapped:
 * the catalogue, said so, exit 0. Unknown connector: exit 1.
 */
export async function runLlmModels(opts: { connector: string; json?: boolean; workspace?: string }, deps: LlmModelsDeps = DEFAULT_DEPS): Promise<number> {
  const ws = opts.workspace ?? deps.findWorkspace(process.cwd()) ?? undefined;
  const loaded = deps.getConnector(opts.connector, ws);
  if (!loaded) {
    const ids = deps.listConnectorIds(ws);
    deps.err(`[error] connector '${opts.connector}' not found; available: ${ids.join(', ') || '(none)'}\n`);
    return 1;
  }
  const r = await deps.refresh(loaded, ws);
  const conn = r.loaded.file.connector;
  const picked = pickerModelList(conn, { servedIds: r.status === 'live' ? r.servedIds : undefined });
  // #4475: the CLI lists the not served catalogue models too, last and marked (a picker never offers them).
  const list = { models: [...picked.models, ...picked.notServed] };
  logPortfolio('info', 'llm.models.list', `llm models: ${conn.id} ${r.status}`, {
    context: { connector: conn.id, status: r.status, served: r.servedIds.length, reason: r.reason ?? null, written: !!r.writtenPath },
  });
  if (opts.json) {
    deps.out(JSON.stringify({
      connector: conn.id,
      source: r.status === 'live' ? 'live' : 'catalogue',
      discovered_at: conn.models.discovered_at ?? null,
      reason: r.reason ?? null,
      default: conn.models.default,
      models: list.models.map((m) => ({ id: m.entry.id, served: m.served ?? null, cost: m.entry.cost ?? null, context_window: m.entry.context_window ?? null })),
    }, null, 2) + '\n');
    return 0;
  }
  const head = r.status === 'live'
    ? `${conn.name} [${conn.id}]: ${r.servedIds.length} served models read live (${conn.models.discovered_at ?? ''})`
    : `${conn.name} [${conn.id}]: ${discoveryFallbackText(r)}`;
  deps.out(head + '\n');
  if (r.writtenPath && ws) deps.out(`Merged into wsp/inputs/llm-gateway/${conn.id}.yaml${NL}`);
  const width = Math.min(60, Math.max(8, ...list.models.map((m) => m.entry.id.length)));
  for (const m of list.models) {
    const marks = [m.entry.id === conn.models.default ? 'default' : '', m.served === false ? 'not served' : ''].filter((x) => x !== '');
    deps.out(`  ${m.entry.id.padEnd(width)}  ${[...marks, fmtPrice(m)].filter((x) => x !== '').join(', ')}`.trimEnd() + '\n');
  }
  if (list.models.length === 0) deps.out(`  (no models listed; set a model id in .swao.yml)${NL}`);
  return 0;
}

export function registerLlm(program: Command): void {
  const llmCmd = program
    .command('llm')
    .description('LLM workload assessment -- analyse AI/LLM applications for security, compliance, and architecture risk');

  llmCmd
    .command('run')
    .description('Run an LLM workload assessment (delegates to `swao assess --type llm`)')
    .option('--app <name>', 'Application name defined in .swao.yml')
    .option('--workspace <path>', 'Workspace root (default: current directory)')
    .option('--skip-cache', 'Bypass the LLM response cache', false)
    .addHelpText('after', `
Examples:
  swao llm run --app my-ai-service
  swao assess --type llm --app my-ai-service   # canonical equivalent

LLM assessment is available on Community, Consultant, and Enterprise tiers.
Configure the LLM gateway in .swao.yml under the llm_gateway: block.
See: swao assess --help`)
    .action((opts: { app?: string; workspace?: string; skipCache: boolean }) => {
      const appFlag   = opts.app       ? ` --app ${opts.app}`             : '';
      const wsFlag    = opts.workspace ? ` --workspace ${opts.workspace}` : '';
      const cacheFlag = opts.skipCache ? ' --skip-cache'                  : '';
      console.error('[llm] Delegating to the canonical assessment surface.');
      console.error(`  swao assess --type llm${appFlag}${wsFlag}${cacheFlag}`);
      console.error('');
      console.error('Run `swao assess --help` for the full option list.');
      process.exit(1);
    });

  llmCmd
    .command('models')
    .description('List the models a connector serves, read live from the platform (5 s), merged into the workspace connector file')
    .requiredOption('--connector <id>', 'Connector id (wsp/inputs/llm-gateway/<id>.yaml)')
    .option('--workspace <path>', 'Workspace root (default: the workspace of the current directory)')
    .option('--json', 'Print the list as JSON', false)
    .addHelpText('after', `
Examples:
  swao llm models --connector openrouter
  swao llm models --connector anthropic --json

The request sends only the connector credential, through the same proxy and
TLS settings as the calls. Offline or with discovery: false in the connector
file, the catalogue is printed and marked "not checked live".`)
    .action(async (opts: { connector: string; workspace?: string; json?: boolean }) => {
      process.exitCode = await runLlmModels(opts);
    });

  llmCmd.action(() => {
    llmCmd.help();
  });
}
