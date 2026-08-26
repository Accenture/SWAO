// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Power BI module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { Command } from 'commander';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dump } from 'js-yaml';
import { LicenseGuard, LicenseTierError, LicenseLimitError, LicenseInvalidError } from '@swao/core';
import { writeStarExport, writeNdjsonExport, writePortfolioStarExport, writeXlsxExport, writePortfolioXlsxExport } from './exports/star.js';
import type { WriteStarResult } from './exports/star.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Bundled PowerBI templates location (#0231; module-asset relocation #0577).
//
// The .pbit templates ship as a MODULE asset under
// packages/@swao/module-powerbi/assets/ (ADR-0048: bundle as a module asset,
// not filesystem-resolved from docs/). Probe candidate roots in order:
//   - dev:    dist/export.js (this module) -> ../assets  (assets/ is a sibling
//             of dist/ at the package root; NOT copied into dist by tsc).
//   - binary: in the pkg snapshot, bundle.mjs sets import.meta.url for EVERY
//             bundled module to the host bundle.cjs path, so __dirname here is
//             the HOST dist dir. bundle.mjs copies the module's assets into
//             host dist/templates/powerbi/ (the same copy-into-dist mechanism
//             the publication assets + controls + pdfkit data already use, see
//             #0575), so `<__dirname>/templates/powerbi` resolves in the binary.
//   - legacy: docs/templates/powerbi/ fallback (host repo dev workflow that
//             still authors .pbit there per the PowerBI authoring guide).
// Mirrors the #0575 publish-assets-into-dist / #0226 resolveCatalogsDir pattern.
function resolveBundledPowerBiDir(): string {
  const candidates = [
    // Dev: module dist/ -> package-root assets/.
    resolve(__dirname, '../assets'),
    // Binary: host dist/ -> dist/templates/powerbi (bundle.mjs copy target).
    resolve(__dirname, 'templates/powerbi'),
    // Legacy docs/templates/powerbi fallback (host repo dev workflow).
    resolve(__dirname, '../../../../../docs/templates/powerbi'),
    resolve(__dirname, '../../../../docs/templates/powerbi'),
    resolve(__dirname, '../../../docs/templates/powerbi'),
    resolve(__dirname, '../../docs/templates/powerbi'),
  ];
  for (const c of candidates) {
    try { if (existsSync(c)) return c; } catch { /* try next */ }
  }
  return candidates[0]!;
}
const BUNDLED_TEMPLATES_DIR = resolveBundledPowerBiDir();

interface TemplateSpec {
  filename: string;
  /** Whether to refresh when in single-app mode. */
  singleApp: boolean;
  /** Whether to refresh when in portfolio mode. */
  portfolio: boolean;
}

const TEMPLATES: TemplateSpec[] = [
  { filename: 'swao-report.pbit',    singleApp: true,  portfolio: false },
  { filename: 'swao-portfolio.pbit', singleApp: false, portfolio: true  },
];

/**
 * Refresh the workspace-level PowerBI templates (#0231, A+B model).
 *
 * Writes/overwrites `<workspaceRoot>/wsp/templates/powerbi/*.pbit` with
 * the bundled copies from the binary. Always copies BOTH templates
 * (single-app + portfolio) so the workspace is complete after any
 * export, regardless of which mode the operator just ran. The matching
 * template for the current mode is printed last so the TUI can capture
 * it as the "primary" path.
 *
 * Ungated by tier: templates are public artefacts. The Enterprise gate
 * stays on the data emission (portfolio export), not the file itself.
 */
function refreshPowerBiTemplate(workspaceRoot: string, mode: 'single' | 'portfolio', noTemplates: boolean): void {
  if (noTemplates) {
    console.log('[info] --no-templates: skipping PowerBI template refresh.');
    return;
  }
  if (!existsSync(BUNDLED_TEMPLATES_DIR)) {
    console.log('[info] No bundled PowerBI templates found in this build. CSV / NDJSON / XLSX layers shipped without dashboards.');
    return;
  }

  const templatesOut = join(workspaceRoot, 'wsp', 'templates', 'powerbi');
  mkdirSync(templatesOut, { recursive: true });

  // Print order: secondary templates first, primary (matching mode) last,
  // so the TUI's regex grabs the most recent line as the path to display.
  const ordered = [...TEMPLATES].sort((a, b) => {
    const aPrimary = mode === 'single' ? a.singleApp : a.portfolio;
    const bPrimary = mode === 'single' ? b.singleApp : b.portfolio;
    return Number(aPrimary) - Number(bPrimary);
  });

  for (const t of ordered) {
    const src = join(BUNDLED_TEMPLATES_DIR, t.filename);
    if (!existsSync(src)) {
      console.log(`[info] Bundled template ${t.filename} not found; skipped.`);
      continue;
    }
    const dst = join(templatesOut, t.filename);
    // #0411 (sprint-040 round-11): copyFileSync raises EBUSY on Windows
    // when the operator has the .pbit open in PowerBI Desktop -- which
    // is the EXPECTED workflow (operator clicks the template to load
    // the bundle, then re-exports later). Swallowing EBUSY + warning
    // keeps the export green for the new bundle (the only artefact the
    // operator actually needs from this run); the template stays at its
    // current version until the operator closes PowerBI + re-exports.
    // Other errors still throw (real disk issues should surface).
    try {
      copyFileSync(src, dst);
      console.log(`[ok]  PowerBI template ready   ->  ${dst}`);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
        console.warn(
          `[warn] PowerBI template "${t.filename}" is currently open in another program (likely PowerBI Desktop) -- ` +
          `skipped refresh. The existing template at ${dst} stays at its current version. ` +
          `Close PowerBI Desktop and re-run export if you need the latest template.`,
        );
        // Still emit the template-ready line so the TUI shows the path
        // (the on-disk file IS valid -- just not the freshest bundle).
        console.log(`[ok]  PowerBI template ready   ->  ${dst}  (kept; refresh skipped)`);
      } else {
        throw e;
      }
    }
  }
}

function isoTsFolder(): string {
  // 2026-05-09T15-23-45 -- folder-name safe (no colons).
  const now = new Date();
  return now.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}

interface ExportOptions {
  app?: string;
  workspace?: string;
  formats?: string;
  noTemplates?: boolean;
  since?: string;
  output?: string;
  portfolio?: boolean;
  noBom?: boolean;
  crlf?: boolean;
}

export function registerExport(program: Command): void {
  program
    .command('export')
    .description('Emit the BI export bundle (CSV star schema + NDJSON; XLSX and PowerBI templates land in fast-follow).')
    .option('--app <appId>', 'Application id (required for single-app export)')
    .option('--workspace <path>', 'Workspace root (default: current directory)')
    .option('--formats <list>', 'Comma-separated list: csv,ndjson,xlsx (default: csv,ndjson)', 'csv,ndjson')
    .option('--no-templates', 'Skip Consultant/Enterprise PowerBI/Tableau template emission', false)
    .option('--since <iso>', 'Filter signals/controls assessed_at >= ts (deferred)', undefined)
    .option('--output <dir>', 'Override default wsp/exports/<ts>/ output directory', undefined)
    .option('--portfolio', 'Emit a portfolio bundle (Enterprise; not yet implemented in this sprint)', false)
    .option('--no-bom', 'Suppress UTF-8 BOM on emitted CSV (Excel-unfriendly)', false)
    .option('--crlf', 'Use CRLF line endings (default: LF)', false)
    .action(async (opts: ExportOptions) => {
      const workspaceRoot = opts.workspace ? resolve(opts.workspace) : process.cwd();

      // Portfolio mode is gated to Enterprise (ADR-0016 amendment 2026-05-09).
      if (opts.portfolio) {
        try {
          LicenseGuard.load().requireTier('enterprise', { feature: 'export --portfolio' });
        } catch (err) {
          if (err instanceof LicenseTierError || err instanceof LicenseLimitError) {
            console.error([
              '[LICENSE] swao export --portfolio requires an Enterprise license.',
              'Run `swao license request` to obtain a license.',
            ].join('\n'));
            process.exit(1);
          }
          if (err instanceof LicenseInvalidError) {
            console.error(`[LICENSE] Invalid license: ${(err as Error).message}`);
            process.exit(3);
          }
          throw err;
        }

        const timestamp = isoTsFolder();
        const portfolioCtx = {
          workspaceRoot,
          timestamp,
          crlf: !!opts.crlf,
          noBom: !!opts.noBom,
        };
        const r = writePortfolioStarExport(portfolioCtx);
        await writePortfolioXlsxExport(portfolioCtx);
        const total = r.manifest.files.reduce((sum, f) => sum + f.rows, 0);
        console.log(
          `[ok]  Portfolio export written  ->  ${r.bundleDir}  ` +
          `(${r.apps.length} app(s), CSV + NDJSON + XLSX, ${total} rows total)`,
        );
        if (r.apps.length === 0) {
          console.warn(`[warn] Discovered no apps under ${workspaceRoot}/apps/. Was the workspace assessed?`);
        }
        refreshPowerBiTemplate(workspaceRoot, 'portfolio', !!opts.noTemplates);
        return;
      }

      if (!opts.app) {
        console.error('[error] --app <appId> is required for single-app export. Use --portfolio for cross-app (Enterprise).');
        process.exit(1);
      }

      const workspaceAppDir = join(workspaceRoot, 'apps', opts.app);
      if (!existsSync(workspaceAppDir)) {
        console.error(`[error] App '${opts.app}' not found in workspace.\n  Expected: ${workspaceAppDir}`);
        process.exit(1);
      }
      if (!existsSync(join(workspaceAppDir, 'wsp'))) {
        console.error(`[error] No wsp/ directory under ${workspaceAppDir}. Run \`swao assess\` first.`);
        process.exit(1);
      }

      const timestamp = isoTsFolder();
      const formats = (opts.formats ?? 'csv,ndjson').split(',').map((f) => f.trim().toLowerCase()).filter(Boolean);

      const ctx = {
        workspaceAppDir,
        appId: opts.app,
        timestamp,
        crlf: !!opts.crlf,
        noBom: !!opts.noBom,
      };

      let bundleDir: string | null = null;
      let csvResult: WriteStarResult | null = null;
      let ndjsonResult: WriteStarResult | null = null;
      let xlsxResult: WriteStarResult | null = null;

      if (formats.includes('csv')) {
        csvResult = writeStarExport(ctx);
        bundleDir = csvResult.bundleDir;
        const total = csvResult.manifest.files.reduce((sum, f) => sum + f.rows, 0);
        console.log(`[ok]  Star CSV bundle written  ->  ${join(csvResult.bundleDir, 'star')}  (${csvResult.manifest.files.length} files, ${total} rows total)`);
      }

      if (formats.includes('ndjson')) {
        ndjsonResult = writeNdjsonExport(ctx);
        bundleDir = ndjsonResult.bundleDir;
        console.log(`[ok]  NDJSON mirror written    ->  ${join(ndjsonResult.bundleDir, 'ndjson')}  (${ndjsonResult.manifest.files.length} files)`);
      }

      if (formats.includes('xlsx')) {
        xlsxResult = await writeXlsxExport(ctx);
        bundleDir = xlsxResult.bundleDir;
        console.log(`[ok]  XLSX rollup written       ->  ${join(xlsxResult.bundleDir, 'xlsx', 'swao-export.xlsx')}`);
      }

      // Merge companion outputs into the star CSV manifest (#1258).
      if (csvResult && (ndjsonResult || xlsxResult)) {
        const updatedManifest = {
          ...csvResult.manifest,
          companion_outputs: {
            ...(ndjsonResult ? { ndjson: ndjsonResult.manifest.files } : {}),
            ...(xlsxResult ? { xlsx: xlsxResult.manifest.files } : {}),
          },
        };
        writeFileSync(join(csvResult.bundleDir, 'manifest.yaml'), dump(updatedManifest, { lineWidth: 160 }), 'utf-8');
      }

      if (bundleDir) {
        refreshPowerBiTemplate(workspaceRoot, 'single', !!opts.noTemplates);
      }

      if (opts.since) {
        console.warn('[warn] --since filter not yet implemented; full bundle emitted.');
      }

      if (bundleDir === null) {
        console.error(`[error] No formats selected. Use --formats csv,ndjson,xlsx (any subset).`);
        process.exit(1);
      }

      if (opts.output) {
        console.warn('[warn] --output override not yet wired; bundle is at the canonical wsp/exports/<ts>/ path.');
      }
    });
}
