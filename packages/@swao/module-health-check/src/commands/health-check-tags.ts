// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// `swao doctor tags` -- community-framework tag-shape consistency check
// (#0363, sprint-039). Mirrors the `swao doctor pii` subcommand wiring:
// shares the parent `doctor` command's `--workspace` + `--format` options;
// adds its own `--strict` for gate use.

import type { Command } from 'commander';
import { resolve } from 'node:path';

import { buildTagConsistencyProbe } from '../probes/tag-consistency-probe.js';
import type { TagConsistencyProbeResult } from '../probes/tag-consistency-probe.js';

function formatReport(result: TagConsistencyProbeResult): string {
  const lines: string[] = [
    'swao doctor tags',
    '================',
    '',
    `Threshold:  axis prefixes appearing in <${Math.round(result.threshold * 100)}% of a framework's controls are flagged.`,
    `Status:     ${result.status.toUpperCase()}`,
    '',
  ];
  if (result.frameworks.length === 0) {
    lines.push('No community frameworks found (bundled folder absent + workspace `wsp/inputs/catalogs/community/` empty).');
    return lines.join('\n');
  }
  for (const fw of result.frameworks) {
    lines.push(`Framework: ${fw.framework_id} (${fw.controls_total} controls)`);
    const sortedPrefixes = Object.entries(fw.axis_prefix_coverage)
      .sort(([, a], [, b]) => b - a);
    for (const [prefix, count] of sortedPrefixes) {
      const ratio = count / fw.controls_total;
      const marker = fw.flags.some((f) => f.axis_prefix === prefix) ? ' [FLAG]' : '';
      lines.push(`  ${prefix.padEnd(28)} ${count}/${fw.controls_total}  (${Math.round(ratio * 100)}%)${marker}`);
    }
    if (fw.flags.length > 0) {
      lines.push('');
      for (const flag of fw.flags) {
        const suggest = flag.suggested_canonical
          ? ` (suggested canonical: "${flag.suggested_canonical}")`
          : '';
        lines.push(`  [warn] ${fw.framework_id}.${flag.axis_prefix} appears in only ${flag.controls_with_prefix}/${flag.framework_total_controls} controls (${Math.round(flag.coverage_ratio * 100)}%)${suggest}`);
        lines.push(`         Sample control ids: ${flag.sample_control_ids.join(', ')}`);
      }
    }
    lines.push('');
  }
  lines.push(result.message);
  return lines.join('\n');
}

export function registerHealthCheckTags(program: Command): void {
  const healthCheck = program.commands.find((c) => c.name() === 'health-check');
  if (!healthCheck) {
    throw new Error('health-check-tags: parent `health-check` command must be registered first');
  }
  healthCheck
    .command('tags')
    .description('Check community-framework `tags:` arrays for axis-prefix consistency (#0363).')
    // Parent `health-check` declares `--workspace` + `--format`; commander hoists
    // shadowed options to the parent (same pattern as health-check-pii). `--strict`
    // is subcommand-only and parses normally.
    .option('--strict', 'Exit non-zero on any flagged axis prefix (gate use)')
    .option('--threshold <ratio>', 'Override coverage threshold (default 0.5)')
    .action(function (this: Command, opts: { strict?: boolean; threshold?: string }) {
      const parentOpts = (this.parent?.opts() ?? {}) as { workspace?: string; format?: string };
      const workspaceRoot = parentOpts.workspace ? resolve(parentOpts.workspace) : process.cwd();
      const threshold = opts.threshold ? Number(opts.threshold) : 0.5;
      if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
        console.error(`[error] --threshold must be a number in (0, 1]; got ${opts.threshold}`);
        process.exit(2);
      }

      const result = buildTagConsistencyProbe(workspaceRoot, threshold);

      if (parentOpts.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatReport(result));
      }

      if (opts.strict && result.status === 'warn') {
        process.exit(1);
      }
    });
}
