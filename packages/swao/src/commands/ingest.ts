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

// #0967 -- `swao ingest` standalone pre-processing command.
// Runs Pass 00 (classification, copy, text extraction) without running
// a full assessment. Writes the updated ingestion-manifest.json so that
// a subsequent `swao assess` run can short-circuit Pass 00.

import type { Command } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';
import { findWorkspace } from '@swao/core';
import { runIngestPrePass } from '@swao/module-app-assessment';

export function registerIngest(program: Command): void {
  program
    .command('ingest')
    .description(
      'Pre-process the ingestion/ folder: classify files by content, extract text from ' +
      'PDF/DOCX/XLSX/PPTX, and write the SHA-256 manifest. Run this before `swao assess` ' +
      'when you have a large document collection to avoid extraction delays during assessment.',
    )
    .option('--workspace <path>', 'path to the SWAO workspace (defaults to auto-detect from cwd)')
    .option('--app <id>', 'app id within the workspace (if omitted, ingests the first app found)')
    .action(async (opts: { workspace?: string; app?: string }) => {
      const workspaceRoot = opts.workspace ?? findWorkspace(process.cwd()) ?? process.cwd();

      // Resolve app workspace directory.
      let workspaceAppDir: string;
      if (opts.app) {
        workspaceAppDir = join(workspaceRoot, 'apps', opts.app);
        if (!existsSync(workspaceAppDir)) {
          console.error(`[error] App '${opts.app}' not found at ${workspaceAppDir}`);
          process.exit(1);
        }
      } else {
        // Single-app workspace: check if ingestion/ is directly under workspaceRoot.
        if (existsSync(join(workspaceRoot, 'ingestion'))) {
          workspaceAppDir = workspaceRoot;
        } else {
          console.error(
            '[error] No --app specified and no ingestion/ folder found in the workspace root. ' +
            'Use --app <id> to target a specific application.',
          );
          process.exit(1);
        }
      }

      const ingestionDir = join(workspaceAppDir, 'ingestion');
      if (!existsSync(ingestionDir)) {
        console.log('[info] INGEST: no ingestion/ folder found -- nothing to do');
        process.exit(0);
      }

      console.log(`[info] INGEST: processing ${ingestionDir}`);

      const manifest = await runIngestPrePass({
        workspacePath: workspaceAppDir,
        assessedAt: new Date().toISOString(),
        warn: (m) => console.warn(m),
      });

      if (!manifest) {
        console.log('[info] INGEST: ingestion/ is empty or contains only skippable files -- nothing to do');
        process.exit(0);
      }

      const countStr = Object.entries(manifest.counts).map(([k, v]) => `${k}: ${v}`).join(', ');
      console.log(
        `[ok]  INGEST: ${manifest.files.length} file(s) processed  (${countStr})  ` +
        `->  wsp/inputs/ + ingestion-manifest.json`,
      );
      process.exit(0);
    });
}
