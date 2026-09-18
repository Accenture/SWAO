// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readFileSync, copyFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Command } from 'commander';
import { findWorkspace } from '@swao/core';
import {
  resolveLzCataloguesDir,
  loadLzCatalogueIndex,
  loadLzCatalogue,
  resolveProviderCatalogue,
} from '../catalogue/loader.js';

/**
 * `swao lz` command group (Design 056, #0567). Community surface:
 *   swao lz catalogue list             list provider catalogues (workspace-refreshed or bundled)
 *   swao lz catalogue show <provider>  show a provider's regions + services
 *   swao lz fit --app <id> --provider <p> --region <r>   fit the app's scan
 *                                       against a catalogue region
 * The live catalogue refresh + live LZ scan are premium (registered elsewhere);
 * this group is the read/fit surface over bundled snapshots + workspace scans.
 */
export function registerLz(program: Command): void {
  const lz = program
    .command('lz')
    .description('Landing-zone assessment helpers (Design 056). See `swao assess --type landing-zone`.');

  const catalogue = lz.command('catalogue').description('CSP service catalogues (region- + sovereignty-aware).');

  catalogue
    .command('list')
    .description('List CSP service catalogues (workspace-refreshed if available, otherwise bundled).')
    .option('--catalogues-dir <path>', 'Override the lz-catalogues directory')
    .option('--origin', 'Add ORIGIN column showing provenance (workspace/bundled) for each provider')
    .action((opts: { cataloguesDir?: string; origin?: boolean }) => {
      const workspaceRoot = findWorkspace(process.cwd()) ?? undefined;
      const dir = resolveLzCataloguesDir(opts.cataloguesDir, workspaceRoot);
      if (!dir) {
        console.error('[error] No lz-catalogues directory found (looked for index.json).');
        process.exit(1);
      }
      const { catalogues, coming_soon } = loadLzCatalogueIndex(dir);
      console.log(`Landing-zone catalogues (${dir}):`);
      for (const c of catalogues) {
        let originPart = '';
        if (opts.origin) {
          let provenance = 'bundled';
          try {
            const resolved = resolveProviderCatalogue(c.provider, workspaceRoot, opts.cataloguesDir);
            provenance = resolved.provenance;
          } catch {
            provenance = 'workspace (invalid)';
          }
          originPart = `  ORIGIN ${provenance}`;
        }
        console.log(`  ${c.provider.padEnd(10)} ${c.name}  [updated ${c.last_updated}, source ${c.source}, confidence ${c.confidence}]${originPart}`);
      }
      if (coming_soon.length > 0) console.log(`  coming soon: ${coming_soon.join(', ')}`);
    });

  catalogue
    .command('copy <provider>')
    .description('Copy bundled catalogue for <provider> into the workspace per-provider directory.')
    .option('--force', 'Overwrite destination if it already exists')
    .option('--workspace <path>', 'Workspace directory (default: auto-detect or cwd)')
    .action((provider: string, opts: { force?: boolean; workspace?: string }) => {
      const workspaceRoot = opts.workspace ?? findWorkspace(process.cwd()) ?? process.cwd();
      const bundledDir = resolveLzCataloguesDir(undefined, undefined);
      if (!bundledDir) {
        console.error('[error] Bundled lz-catalogues directory not found.');
        process.exit(1);
      }
      const { catalogues } = loadLzCatalogueIndex(bundledDir);
      const entry = catalogues.find((c) => c.provider === provider);
      if (!entry) {
        console.error(`[error] Unknown provider "${provider}". Available: ${catalogues.map((c) => c.provider).join(', ')}.`);
        process.exit(1);
      }
      const srcFile = join(bundledDir, entry.file);
      if (!existsSync(srcFile)) {
        console.error(`[error] Bundled catalogue file not found: ${srcFile}`);
        process.exit(1);
      }
      const destDir = join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', provider);
      const destFile = join(destDir, 'index.json');
      if (existsSync(destFile) && !opts.force) {
        console.error(`[error] Destination already exists: ${destFile}`);
        console.error('        Use --force to overwrite.');
        process.exit(1);
      }
      mkdirSync(destDir, { recursive: true });
      copyFileSync(srcFile, destFile);
      console.log(`[ok] Copied bundled "${provider}" catalogue to ${destFile}`);
      console.log(`     Edit the file to customise regions/services, then run \`swao lz catalogue list --origin\` to verify.`);
    });

  catalogue
    .command('new <provider>')
    .description('Create an empty workspace catalogue scaffold for <provider>.')
    .option('--force', 'Overwrite destination if it already exists')
    .option('--workspace <path>', 'Workspace directory (default: auto-detect or cwd)')
    .action((provider: string, opts: { force?: boolean; workspace?: string }) => {
      const workspaceRoot = opts.workspace ?? findWorkspace(process.cwd()) ?? process.cwd();
      const destDir = join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', provider);
      const destFile = join(destDir, 'index.json');
      if (existsSync(destFile) && !opts.force) {
        console.error(`[error] Destination already exists: ${destFile}`);
        console.error('        Use --force to overwrite, or use \`swao lz catalogue copy\` to copy the bundled catalogue.');
        process.exit(1);
      }
      const today = new Date().toISOString().slice(0, 10);
      const scaffold = {
        meta: {
          schema_version: '0.1',
          name: `${provider} (workspace-local catalogue)`,
          provider,
          last_updated: today,
          source: {
            mode: 'curated',
            source_note: 'Workspace-local catalogue. Add entries under regions[] following the SWAO LZ catalogue schema (Design 056).',
          },
          confidence: 'medium',
        },
        regions: [
          {
            id: 'example-region',
            display: 'Example Region (replace or remove this entry)',
            services: [],
          },
        ],
      };
      mkdirSync(destDir, { recursive: true });
      writeFileSync(destFile, JSON.stringify(scaffold, null, 2) + '\n', 'utf-8');
      console.log(`[ok] Created workspace catalogue scaffold at ${destFile}`);
      console.log(`     Edit the file to add real regions and services, then run \`swao lz catalogue list --origin\` to verify.`);
    });

  catalogue
    .command('show <provider>')
    .description('Show a provider catalogue: regions, sovereignty facts, services.')
    .option('--catalogues-dir <path>', 'Override the lz-catalogues directory')
    .action((provider: string, opts: { cataloguesDir?: string }) => {
      const workspaceRoot = findWorkspace(process.cwd()) ?? undefined;
      const dir = resolveLzCataloguesDir(opts.cataloguesDir, workspaceRoot);
      if (!dir) {
        console.error('[error] No lz-catalogues directory found.');
        process.exit(1);
      }
      if (!existsSync(join(dir, `${provider}.json`))) {
        console.error(`[error] No catalogue for provider "${provider}" in ${dir}.`);
        process.exit(1);
      }
      const cat = loadLzCatalogue(dir, provider);
      console.log(`${cat.meta.name}  (provider: ${cat.meta.provider}, updated ${cat.meta.last_updated}, confidence ${cat.meta.confidence})`);
      for (const region of cat.regions) {
        const sov = region.sovereignty;
        const sovStr = sov
          ? `residency=${sov.residency_country ?? '?'}, operator=${sov.operator_jurisdiction ?? '?'}, exposure=[${(sov.extraterritorial_exposure ?? []).join(',')}]`
          : '(no sovereignty facts)';
        console.log(`\n  region ${region.id} (${region.display ?? region.country ?? ''})  ${sovStr}`);
        for (const svc of region.services) {
          console.log(`    - ${svc.code}  [${svc.status}]  fulfills: ${svc.fulfills.join(',') || '-'}`);
        }
      }
    });

  lz
    .command('fit')
    .description('Fit an app assessment against a catalogue region + the workspace LZ scan (placeholder until orchestrate is wired in `swao assess --type landing-zone`).')
    .requiredOption('--app <appId>', 'Application ID')
    .requiredOption('--provider <provider>', 'CSP provider (catalogue id)')
    .requiredOption('--region <regionId>', 'Region id within the provider catalogue')
    .option('--workspace <path>', 'Workspace directory (default: cwd)')
    .action((opts: { app: string; provider: string; region: string; workspace?: string }) => {
      // The full fit run is driven by `swao assess --type landing-zone` (the
      // orchestrator path). This subcommand is the explicit-inputs entry point;
      // it points the operator at the assess route until the standalone fit
      // wiring (catalogue + workspace-scan join) lands with the assess dispatch.
      const workspaceRoot = opts.workspace ?? (findWorkspace(process.cwd()) ?? process.cwd());
      console.log(
        `[lz fit] app=${opts.app} provider=${opts.provider} region=${opts.region} workspace=${workspaceRoot}`,
      );
      console.log('[lz fit] Run `swao assess --type landing-zone --app <id>` for the full fit report (scan + catalogue + framework sovereignty).');
    });
}
