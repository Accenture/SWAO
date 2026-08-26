/**
 * esbuild bundle script for the SWAO CLI (full / enterprise entry).
 *
 * #0583 (Sprint 064): the esbuild + asset-copy logic moved to the shared
 * scripts/build-lib.mjs so the three per-tier build scripts can reuse it. This
 * file is preserved for `build:bundle` (and any existing tooling that calls it)
 * and now delegates to build-lib with the full entry (dist/index.js) and the
 * historical outfile (dist/bundle.cjs). Behaviour is unchanged.
 *
 * IMPORTANT: run `pnpm build` (tsc) BEFORE this script -- esbuild reads
 * dist/index.js, not src (memory: dev-binary-build-sequence).
 */
import { copyRuntimeAssets, buildBundle } from './build-lib.mjs';

copyRuntimeAssets({ includePdfkit: true });
await buildBundle({ entry: 'dist/index.js', outfile: 'dist/bundle.cjs' });
