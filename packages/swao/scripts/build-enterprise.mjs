/**
 * Build the SWAO Enterprise-tier (full) binary (#0583, Sprint 064).
 *
 * Entry: dist/index.js (the canonical full entry; src/tiers/enterprise.ts simply
 * re-exports it) -> dist/bundle.cjs -> pkg swao-enterprise-win.exe. This preserves the
 * historical build:binary / build:bundle behaviour exactly: the enterprise build
 * bundles every module and the outfile stays dist/bundle.cjs so existing tooling
 * and the pkg.assets globs are unchanged.
 *
 * Includes the pdfkit data copy. Run `pnpm build` (tsc) BEFORE this script.
 * --no-pkg stops after esbuild.
 */
import { spawnSync } from 'child_process';
import { copyRuntimeAssets, buildBundle, BIN_ENTERPRISE } from './build-lib.mjs';

const TARGET  = process.env.SWAO_PKG_TARGET || 'node20-win-x64';
const OUT_EXE = process.env.SWAO_PKG_OUT    || BIN_ENTERPRISE;
const noPkg = process.argv.includes('--no-pkg');

copyRuntimeAssets({ includePdfkit: true, premiumTier: 'enterprise' });
// Enterprise = full entry. Bundle dist/index.js into dist/bundle.cjs (unchanged
// outfile so build:bundle tooling and the binary build keep working).
await buildBundle({ entry: 'dist/index.js', outfile: 'dist/bundle.cjs' });

if (noPkg) {
  console.log('[build-enterprise] --no-pkg: stopping after esbuild (pkg is operator/CI-owned).');
  process.exit(0);
}

const r = spawnSync(
  'npx',
  [
    '@yao-pkg/pkg',
    'dist/bundle.cjs',
    '--config', 'package.json',
    '--target', TARGET,
    '--output', OUT_EXE,
    '--compress', 'GZip',
    // --fallback-to-source INTENTIONALLY OMITTED: that flag stores the bundle
    // path relative to CWD, so the binary only works from the source tree. Without
    // it the snapshot is authoritative and the binary runs from any install path.
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (r.status !== 0) {
  console.error(
    `[build-enterprise] pkg step failed (status ${r.status}, error ${r.error?.code ?? 'n/a'}).\n` +
    '  The pkg->exe step is operator/CI-owned; the esbuild bundle succeeded.',
  );
  process.exit(r.status ?? 1);
}
console.log(`[build-enterprise] Enterprise binary -> ${OUT_EXE}`);
