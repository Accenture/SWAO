/**
 * Build the SWAO Community-tier binary (#0583, Sprint 064).
 *
 * Entry: dist/tiers/community.js -> dist/bundle-community.cjs -> pkg
 * swao-community-<target>. The Community bundle imports NONE of the higher-tier
 * modules (pdf-report / terraform / html-portal / portfolio / challenge), so
 * their code is excluded (verified by src/__tests__/tier-bundle-exclusion.test).
 *
 * Skips the pdfkit data copy (the pdf renderer is Community-absent). Run `pnpm
 * build` (tsc) BEFORE this script -- esbuild reads dist/*.js, not src.
 *
 * The pkg step needs the @yao-pkg/pkg toolchain + network and FAILS in the
 * sandbox (spawn UNKNOWN). Pass --no-pkg to stop after the esbuild step (used by
 * the in-sandbox exclusion test + CI smoke). Real per-target exe builds are
 * operator/CI-owned.
 */
import { spawnSync } from 'child_process';
import { copyRuntimeAssets, buildBundle, BIN_COMMUNITY } from './build-lib.mjs';

const TARGET  = process.env.SWAO_PKG_TARGET || 'node20-win-x64';
const OUT_EXE = process.env.SWAO_PKG_OUT    || BIN_COMMUNITY;
const noPkg = process.argv.includes('--no-pkg');

copyRuntimeAssets({ includePdfkit: false, premiumTier: 'none' });
await buildBundle({ entry: 'dist/tiers/community.js', outfile: 'dist/bundle-community.cjs' });

if (noPkg) {
  console.log('[build-community] --no-pkg: stopping after esbuild (pkg is operator/CI-owned).');
  process.exit(0);
}

// --fallback-to-source is intentionally omitted (same reason as build-dev-win.mjs):
// that flag stores the bundle path relative to CWD, making the binary only work from
// the source tree. Without it the snapshot is authoritative and the binary is
// self-contained regardless of where it is run from -- required for MCP self-spawn
// (#0807-P3: the MCP server spawns itself with cwd=workspace, not the source tree).
const r = spawnSync(
  'npx',
  [
    '@yao-pkg/pkg',
    'dist/bundle-community.cjs',
    '--config', 'package.json',
    '--target', TARGET,
    '--output', OUT_EXE,
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (r.status !== 0) {
  console.error(
    `[build-community] pkg step failed (status ${r.status}, error ${r.error?.code ?? 'n/a'}).\n` +
    '  The pkg->exe step is operator/CI-owned; it cannot run in the sandbox (spawn UNKNOWN).\n' +
    '  The esbuild bundle (dist/bundle-community.cjs) succeeded.',
  );
  process.exit(r.status ?? 1);
}
console.log(`[build-community] Community binary -> ${OUT_EXE}`);
