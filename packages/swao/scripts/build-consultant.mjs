/**
 * Build the SWAO Consultant-tier binary (#0583, Sprint 064).
 *
 * Entry: dist/tiers/consultant.js -> dist/bundle-consultant.cjs -> pkg
 * swao-consultant-<target>. Bundles Community + the Consultant modules
 * (pdf-report / terraform); the HTML Portal (publish --site) is Enterprise-only
 * (#1562). The Enterprise modules (portfolio / challenge) are excluded.
 *
 * Includes the pdfkit data copy (the pdf renderer IS bundled at Consultant+).
 * Run `pnpm build` (tsc) BEFORE this script. --no-pkg stops after esbuild.
 */
import { spawnSync } from 'child_process';
import { copyRuntimeAssets, buildBundle, BIN_CONSULTANT } from './build-lib.mjs';

const TARGET  = process.env.SWAO_PKG_TARGET || 'node20-win-x64';
const OUT_EXE = process.env.SWAO_PKG_OUT    || BIN_CONSULTANT;
const noPkg = process.argv.includes('--no-pkg');

copyRuntimeAssets({ includePdfkit: true, premiumTier: 'consultant' });
await buildBundle({ entry: 'dist/tiers/consultant.js', outfile: 'dist/bundle-consultant.cjs' });

if (noPkg) {
  console.log('[build-consultant] --no-pkg: stopping after esbuild (pkg is operator/CI-owned).');
  process.exit(0);
}

const r = spawnSync(
  'npx',
  [
    '@yao-pkg/pkg',
    'dist/bundle-consultant.cjs',
    '--config', 'package.json',
    '--target', TARGET,
    '--output', OUT_EXE,
    '--fallback-to-source',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (r.status !== 0) {
  console.error(
    `[build-consultant] pkg step failed (status ${r.status}, error ${r.error?.code ?? 'n/a'}).\n` +
    '  The pkg->exe step is operator/CI-owned; the esbuild bundle succeeded.',
  );
  process.exit(r.status ?? 1);
}
console.log(`[build-consultant] Consultant binary -> ${OUT_EXE}`);
