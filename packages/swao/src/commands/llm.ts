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

  llmCmd.action(() => {
    llmCmd.help();
  });
}
