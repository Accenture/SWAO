/**
 * Build the SWAO development binary for Windows x64.
 *
 * Identical to scripts/build-enterprise.mjs except --compress GZip is omitted.
 * Omitting compression cuts build time from ~30 min to ~2 min; use this for
 * in-sprint iterative builds (memory: dev-binary-skip-compression).
 *
 * ALWAYS passes --config package.json so pkg includes all declared runtime
 * assets. Omitting --config package.json produces a ~53 MB binary that crashes
 * on startup because controls, community-frameworks, publication assets, and
 * fixtures are not embedded (sprint-069 lesson, binary-build-shape gate).
 *
 * Usage (from packages/swao/):
 *   npm run build              # tsc -- compile all changed TS first
 *   node scripts/build-dev-win.mjs
 *
 * Or via the package.json alias:
 *   npm run build:dev:win
 *
 * IMPORTANT: also rebuild any changed dependency modules before running this
 * script (memory: dev-binary-build-sequence).
 */
import { spawnSync } from 'child_process';
import { readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { copyRuntimeAssets, buildBundle, BIN_ENTERPRISE } from './build-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
console.log(`[build-dev-win] Building SWAO v${pkg.version} dev binary...`);

// Dev binary (no compression) must be at least 150 MB.
// If it comes out smaller, pkg likely ran without --config package.json,
// producing a ~53-70 MB stub that crashes on startup (sprint-069/sprint-088 lesson).
const MIN_SIZE_BYTES = 150 * 1024 * 1024;

const TARGET  = process.env.SWAO_PKG_TARGET || 'node20-win-x64';
const OUT_EXE = process.env.SWAO_PKG_OUT    || BIN_ENTERPRISE;

// Compile TypeScript before bundling so dist/ is never stale.
// Forgetting this step caused vault bootstrap code to be missing from the
// binary (sprint-096 lesson #1100-P1).
const tsc = spawnSync('npx', ['tsc', '-b', 'tsconfig.json'], {
  stdio: 'inherit', shell: process.platform === 'win32',
});
if (tsc.status !== 0) {
  console.error('[build-dev-win] tsc failed -- fix type errors before building binary.');
  process.exit(tsc.status ?? 1);
}

copyRuntimeAssets({ includePdfkit: true, premiumTier: 'enterprise' });
await buildBundle({ entry: 'dist/index.js', outfile: 'dist/bundle.cjs' });

const r = spawnSync(
  'npx',
  [
    '@yao-pkg/pkg',
    'dist/bundle.cjs',
    '--config', 'package.json',   // REQUIRED: embeds all pkg.assets; never omit
    '--target', TARGET,
    '--output', OUT_EXE,
    // --compress GZip intentionally omitted: ~2 min dev vs ~30 min release
    // --fallback-to-source INTENTIONALLY OMITTED: that flag stores the bundle
    // path as relative to CWD, so the binary only works from the source tree.
    // Without it the snapshot is authoritative and the binary is self-contained
    // regardless of where it is installed or run from.
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (r.status !== 0) {
  console.error(
    `[build-dev-win] pkg failed (exit ${r.status ?? 'n/a'}, error ${r.error?.code ?? 'n/a'}).\n` +
    '  The esbuild bundle succeeded; only the pkg->exe step failed.',
  );
  process.exit(r.status ?? 1);
}

const actualBytes = statSync(OUT_EXE).size;
if (actualBytes < MIN_SIZE_BYTES) {
  const actual = (actualBytes / 1024 / 1024).toFixed(1);
  const min    = (MIN_SIZE_BYTES  / 1024 / 1024).toFixed(0);
  console.error(
    `[build-dev-win] SIZE CHECK FAILED: output is ${actual} MB (expected >= ${min} MB).\n` +
    '  This usually means pkg ran without --config package.json and produced a stub binary.\n' +
    '  Verify that --config package.json is present in the pkg invocation above.',
  );
  process.exit(1);
}
console.log(`[build-dev-win] Dev binary -> ${OUT_EXE} (${(actualBytes / 1024 / 1024).toFixed(1)} MB)`);
