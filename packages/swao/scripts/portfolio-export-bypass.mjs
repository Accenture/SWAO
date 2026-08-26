// One-shot script to generate a portfolio bundle for #0187 PowerBI authoring.
// Bypasses the CLI's Premium-tier license gate by importing the export function
// directly. This is for in-repo authoring only; production users on Community
// tier will see the gate via `swao export --portfolio` as designed.
//
// Run from package root (C:\Projects\accenture\swao\packages\swao):
//   node scripts/portfolio-export-bypass.mjs <absolute-workspace-root>
//
// #0577: the star writers relocated to @swao/module-powerbi; this reads the
// module's built dist copy (was ../dist/exports/star.js when star lived in the
// host). Build the module first: pnpm --filter @swao/module-powerbi run build.

import { writePortfolioStarExport } from '../../@swao/module-powerbi/dist/exports/star.js';

const workspaceRoot = process.argv[2];
if (!workspaceRoot) {
  console.error('Usage: node portfolio-export-bypass.mjs <workspace-root>');
  console.error('Example: node portfolio-export-bypass.mjs C:\\Projects\\accenture\\swao\\examples\\portfolio-workspace\\portfolio');
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+$/, '');

console.log(`[info] Generating portfolio bundle...`);
console.log(`[info]   workspaceRoot: ${workspaceRoot}`);
console.log(`[info]   timestamp:     ${timestamp}`);

const result = writePortfolioStarExport({
  workspaceRoot,
  timestamp,
  crlf: false,
  noBom: false,
});

const totalRows = result.manifest.files.reduce((s, f) => s + f.rows, 0);
console.log(`[ok]   Bundle written -> ${result.bundleDir}/star/`);
console.log(`[ok]   Apps included:  ${result.apps.join(', ')} (${result.apps.length})`);
console.log(`[ok]   Files:          ${result.manifest.files.length}`);
console.log(`[ok]   Total rows:     ${totalRows}`);
console.log('');
console.log('Use this absolute path as the SWAOPortfolioExportPath parameter when');
console.log('opening swao-portfolio.pbit in PowerBI Desktop:');
console.log('');
console.log(`  ${result.bundleDir.replace(/\//g, '\\')}\\star`);
