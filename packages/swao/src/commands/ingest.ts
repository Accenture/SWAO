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
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { findWorkspace, logPortfolio, setWorkspaceRoot } from '@swao/core';
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
      const workspaceRoot = opts.workspace ?? findWorkspace(process.cwd());
      if (!workspaceRoot) {
        console.error('[error] No SWAO workspace found in the current directory or any parent.\n' +
                      '  Run `swao init` to initialise a workspace here, or navigate to an existing workspace.');
        process.exit(1);
      }

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

      // #2301: set workspace root so portfolio log writes to the correct location.
      setWorkspaceRoot(workspaceRoot);

      const appId = opts.app ?? workspaceAppDir.split(/[\\/]/).pop() ?? 'unknown';

      // Count files in ingestion/ for the start event (best-effort; excludes reserved names).
      let filesDiscovered = 0;
      try {
        const SKIP = new Set(['.gitkeep', 'readme.md', 'ingestion-manifest.json']);
        const entries = readdirSync(ingestionDir, { recursive: true, encoding: 'utf-8' }) as string[];
        filesDiscovered = entries.filter((e) => {
          const base = e.split(/[\\/]/).pop() ?? e;
          return !SKIP.has(base.toLowerCase()) && statSync(join(ingestionDir, e)).isFile();
        }).length;
      } catch { /* best-effort */ }

      const ingestStart = Date.now();
      // #2247: include source_dir so the log monitor can identify which ingestion/ folder was processed.
      try { logPortfolio('info', 'ingest.start', 'Ingestion run started', { context: { app_id: appId, source_dir: ingestionDir, files_discovered: filesDiscovered } }); } catch { /* best-effort */ }

      console.log(`[info] INGEST: processing ${ingestionDir}`);

      let manifest;
      // #2564: track warn-level callbacks separately from rejected files. A file that
      // triggers a warn but still passes ingestion should increment filesWarned, not filesRejected.
      let filesWarned = 0;
      try {
        manifest = await runIngestPrePass({
          workspacePath: workspaceAppDir,
          assessedAt: new Date().toISOString(),
          warn: (m) => { filesWarned++; console.warn(m); },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try { logPortfolio('error', 'ingest.error', 'Ingestion run failed', { context: { app_id: appId, error: msg, duration_ms: Date.now() - ingestStart } }); } catch { /* best-effort */ }
        throw err;
      }

      if (!manifest) {
        try { logPortfolio('info', 'ingest.complete', 'Ingestion run complete -- nothing to process', { context: { app_id: appId, source_dir: ingestionDir, files_accepted: 0, files_rejected: 0, files_warned: 0, artefacts_produced: 0, manifest_path: null, duration_ms: Date.now() - ingestStart } }); } catch { /* best-effort */ }
        console.log('[info] INGEST: ingestion/ is empty or contains only skippable files -- nothing to do');
        process.exit(0);
      }

      const artefactsProduced = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
      const filesRejected = (manifest.rejected ?? []).length;
      const manifestPath = join(workspaceAppDir, 'ingestion-manifest.json');
      try { logPortfolio('info', 'ingest.complete', 'Ingestion run complete', { context: { app_id: appId, source_dir: ingestionDir, files_accepted: manifest.files.length, files_rejected: filesRejected, files_warned: filesWarned, artefacts_produced: artefactsProduced, manifest_path: manifestPath, duration_ms: Date.now() - ingestStart } }); } catch { /* best-effort */ }

      const countStr = Object.entries(manifest.counts).map(([k, v]) => `${k}: ${v}`).join(', ');
      console.log(
        `[ok]  INGEST: ${manifest.files.length} file(s) processed  (${countStr})  ` +
        `->  wsp/inputs/ + ingestion-manifest.json`,
      );
      process.exit(0);
    });
}
