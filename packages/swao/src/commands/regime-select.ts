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

import type { Command } from 'commander';
import { resolve, join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { load, dump } from 'js-yaml';
import { render } from 'ink';
import { createElement } from 'react';
import {
  loadAvailableRegimes,
  readRegimesActive,
  writeRegimesActive,
} from '../compliance/regime-picker.js';
import { resolveCatalogsDir } from './init.js';
import { RegimeSelectorScreen } from '../tui/screens/RegimeSelectorScreen.js';

export function writeAppRegimesActive(appSwaoYmlPath: string, regimes: string[]): void {
  const existing = existsSync(appSwaoYmlPath)
    ? (load(readFileSync(appSwaoYmlPath, 'utf-8')) as Record<string, unknown> | null) ?? {}
    : {};
  const root: Record<string, unknown> = { ...existing };
  const assessment = (root['assessment'] as Record<string, unknown> | undefined) ?? {};
  assessment['regimes_active'] = [...regimes];
  root['assessment'] = assessment;
  writeFileSync(appSwaoYmlPath, dump(root, { lineWidth: 120, noRefs: true }), 'utf-8');
}

async function runInteractivePicker(workspacePath: string, hints: string[]): Promise<void> {
  const { waitUntilExit, unmount } = render(
    createElement(RegimeSelectorScreen, {
      workspacePath,
      contextHints: hints,
      onDone: () => {
        unmount();
      },
    }),
  );
  await waitUntilExit();
}

export function registerRegimeSelect(program: Command): void {
  program
    .command('regime-select')
    .description('Pick the compliance regimes to evaluate against the workload (interactive picker; --regimes for non-interactive use).')
    .option('--workspace <path>', 'Workspace path (default: current directory)')
    .option('--app <id>', 'Write regime selection to the app-level .swao.yml instead of the workspace root')
    .option('--regimes <ids>', 'Comma-separated list (non-interactive). Example: --regimes "GDPR,PCI_DSS"')
    .option('--reconfigure', 'Edit existing selection (re-presents picker with current regimes pre-checked)')
    .option('--hints <list>', 'Comma-separated applicability hints to highlight matching regimes')
    .option('--show', 'Print the current selection without changing it')
    .action(async (opts: { workspace?: string; app?: string; regimes?: string; reconfigure?: boolean; hints?: string; show?: boolean }) => {
      const workspacePath = opts.workspace ? resolve(opts.workspace) : process.cwd();
      const workspaceSwaoYmlPath = join(workspacePath, '.swao.yml');
      const catalogsDir = resolveCatalogsDir(workspacePath);

      // Resolve target .swao.yml -- app-level when --app is given, workspace root otherwise.
      let targetSwaoYmlPath = workspaceSwaoYmlPath;
      if (opts.app) {
        const appDir = join(workspacePath, 'apps', opts.app);
        if (!existsSync(appDir)) {
          console.error(`Error: app directory not found: ${appDir}. Run \`swao init --name ${opts.app}\` first.`);
          process.exit(1);
        }
        targetSwaoYmlPath = join(appDir, '.swao.yml');
      }

      if (!existsSync(catalogsDir)) {
        console.error(`Error: catalogs not found at ${catalogsDir} or legacy <workspace>/catalogs/. Run \`swao init\` first.`);
        process.exit(1);
      }

      const available = loadAvailableRegimes(workspacePath);
      const availableIds = new Set(available.map((r) => r.entry.id));

      if (opts.show) {
        const current = readRegimesActive(targetSwaoYmlPath);
        if (current.length === 0) {
          console.log('No regimes_active set in .swao.yml');
        } else {
          console.log(current.join(', '));
        }
        return;
      }

      if (opts.regimes !== undefined) {
        const requested = opts.regimes.split(',').map((s) => s.trim()).filter(Boolean);
        const unknown = requested.filter((id) => !availableIds.has(id));
        if (unknown.length > 0) {
          console.error(
            `Error: unknown regime id(s): ${unknown.join(', ')}\n` +
              `Known: ${[...availableIds].sort().join(', ')}`,
          );
          process.exit(1);
        }
        if (opts.app) {
          writeAppRegimesActive(targetSwaoYmlPath, requested);
        } else {
          writeRegimesActive(workspaceSwaoYmlPath, requested);
        }
        console.log(`Set assessment.regimes_active = [${requested.join(', ')}] in ${targetSwaoYmlPath}`);
        return;
      }

      if (!process.stdin.isTTY) {
        console.error(
          'regime-select requires an interactive terminal. Pass --regimes "GDPR,..." for non-interactive use.',
        );
        process.exit(1);
      }

      const hints = opts.hints ? opts.hints.split(',').map((s) => s.trim()).filter(Boolean) : [];
      await runInteractivePicker(workspacePath, hints);
    });
}
