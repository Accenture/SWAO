// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- swao llm-gateway
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3388 step 4 (Design 112 D-2): `swao llm-gateway update` refreshes the
// workspace connector folder from the packaged seeds ON REQUEST (never at
// start-up). Unchanged seeds are replaced with the newer packaged version; a
// connector the user edited is kept and reported; a packaged connector the
// workspace lacks is added. The workspace folder is the single source (D-3).

import type { Command } from 'commander';
import { findWorkspace, logPortfolio } from '@swao/core';
import { updateBundledConnectors } from '@swao/module-llm-providers';

export function registerLlmGateway(program: Command): void {
  const group = program
    .command('llm-gateway')
    .description('Manage the workspace LLM gateway connectors (wsp/inputs/llm-gateway/, the single source).');

  group
    .command('update')
    .description(
      'Refresh the workspace connectors from the packaged seeds. Unchanged seeds are ' +
      'updated to the latest packaged version; connectors you edited are kept; new ' +
      'packaged connectors are added. Run this after upgrading the SWAO binary.',
    )
    .option('--dry-run', 'Show what would change without writing any files')
    .action((opts: { dryRun?: boolean }) => {
      const ws = findWorkspace(process.cwd());
      if (!ws) {
        process.stderr.write('[error] Not in a SWAO workspace (no .swao.yml found). Run `swao init` first.\n');
        process.exitCode = 1;
        return;
      }
      const r = updateBundledConnectors(ws, { dryRun: opts.dryRun });
      if (!r.dir) {
        process.stderr.write('[warn] No packaged connectors available in this build; nothing to update.\n');
        return;
      }
      const prefix = opts.dryRun ? '[dry-run] ' : '';
      const line = (label: string, files: string[]): void => {
        if (files.length > 0) process.stdout.write(`${prefix}${label}: ${files.join(', ')}\n`);
      };
      line('added', r.added);
      line('updated', r.updated);
      line('kept (edited locally)', r.keptModified);
      process.stdout.write(
        `${prefix}llm-gateway update: ${r.added.length} added, ${r.updated.length} updated, ` +
        `${r.keptModified.length} kept, ${r.upToDate.length} up to date -> ${r.dir}\n`,
      );
      logPortfolio('info', 'llm-gateway.update', 'llm-gateway connectors updated', {
        context: { dry_run: !!opts.dryRun, added: r.added.length, updated: r.updated.length, kept: r.keptModified.length, up_to_date: r.upToDate.length },
      });
    });
}
