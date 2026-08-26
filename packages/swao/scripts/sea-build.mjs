#!/usr/bin/env node
/**
 * SWAO Node.js Single Executable Application (SEA) prototype build script.
 *
 * Why SEA instead of pkg (#0482 T4):
 *   - No third-party packer; the Node.js runtime is embedded by Node itself
 *   - No runtime self-extraction to %TEMP% (the #1 AV heuristic trigger)
 *   - The Node.js binary is recognised and trusted by AV engines worldwide
 *   - With Playwright excluded (T2), no native addon extraction from temp dirs
 *
 * Prerequisites:
 *   node >= 20  (--experimental-sea-config is stable from 20.0.0)
 *   pnpm run build  (produces dist/bundle.cjs)
 *   npx postject  (installed on demand; wraps system inject-file / codesign calls)
 *
 * Usage (from swao/packages/swao/):
 *   node scripts/sea-build.mjs [--platform win|linux|macos] [--out <path>]
 *
 * The script produces a self-contained binary next to the node executable it
 * was copied from.  Pass --out to override the default output path.
 */

import { execSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { BIN_ENTERPRISE } from './build-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const DIST_BIN = resolve(PKG_ROOT, '../../dist-bin');
const SEA_CONFIG = join(PKG_ROOT, 'sea-config.json');
const SEA_BLOB = join(PKG_ROOT, 'sea-prep.blob');
const BUNDLE = join(PKG_ROOT, 'dist/bundle.cjs');

// Parse CLI args
const args = process.argv.slice(2);
const platformFlag = args[args.indexOf('--platform') + 1] ?? platform();
const outFlag = args[args.indexOf('--out') + 1] ?? null;

const IS_WINDOWS = platformFlag === 'win32' || platformFlag === 'win';
const EXE_SUFFIX = IS_WINDOWS ? '.exe' : '';
const OUTPUT_BIN = outFlag ?? join(DIST_BIN, `swao-sea-${IS_WINDOWS ? 'win-x64' : platformFlag}${EXE_SUFFIX}`);

function run(cmd, opts = {}) {
  console.log(`[sea] $ ${cmd}`);
  const result = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: PKG_ROOT, ...opts });
  if (result.status !== 0) {
    console.error(`[sea] Command failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function checkPrerequisites() {
  if (!existsSync(BUNDLE)) {
    console.error(`[sea] dist/bundle.cjs not found. Run: pnpm run build`);
    process.exit(1);
  }
  const nodeVersion = process.versions.node.split('.').map(Number);
  if (nodeVersion[0] < 20) {
    console.error(`[sea] Node.js >= 20 required for SEA (have ${process.version})`);
    process.exit(1);
  }
  console.log(`[sea] Node.js ${process.version} -- SEA supported`);
}

function writeSEAConfig() {
  const cfg = {
    main: 'dist/bundle.cjs',
    output: 'sea-prep.blob',
    disableExperimentalSEAWarning: true,
    useCodeCache: true,    // embeds V8 code cache for faster startup
    useSnapshot: false,    // snapshot mode requires startup isolation; skip for CLI
  };
  writeFileSync(SEA_CONFIG, JSON.stringify(cfg, null, 2));
  console.log(`[sea] Wrote sea-config.json`);
}

function generateBlob() {
  run(`node --experimental-sea-config sea-config.json`);
  if (!existsSync(SEA_BLOB)) {
    console.error('[sea] sea-prep.blob not generated');
    process.exit(1);
  }
  console.log(`[sea] sea-prep.blob generated`);
}

function copyNodeBinary() {
  const nodeBin = process.execPath;
  mkdirSync(dirname(OUTPUT_BIN), { recursive: true });
  copyFileSync(nodeBin, OUTPUT_BIN);
  console.log(`[sea] Copied ${nodeBin} -> ${OUTPUT_BIN}`);
  if (!IS_WINDOWS) {
    execSync(`chmod +x "${OUTPUT_BIN}"`);
  }
}

function injectBlob() {
  // postject injects the blob into the binary's SWAO_SEA_BLOB section.
  // The sentinel fuse disables execution of arbitrary blobs (security).
  const fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
  const macosFlag = (!IS_WINDOWS && platformFlag === 'darwin') ? ' --macho-segment-name NODE_SEA' : '';
  run(`npx postject "${OUTPUT_BIN}" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse ${fuse}${macosFlag}`);
  console.log(`[sea] Blob injected into ${OUTPUT_BIN}`);
}

function verify() {
  console.log(`[sea] Verifying binary...`);
  const result = spawnSync(`"${OUTPUT_BIN}" --version`, { shell: true, encoding: 'utf8', cwd: PKG_ROOT });
  if (result.status === 0) {
    console.log(`[sea] Verification: ${result.stdout.trim()}`);
  } else {
    console.warn(`[sea] Verification failed (exit ${result.status}). Binary may still work; check manually.`);
    if (result.stderr) console.warn(result.stderr);
  }
}

async function printSizeComparison() {
  const { statSync } = await import('node:fs').then(m => m);
  const pkgBin = join(DIST_BIN, IS_WINDOWS ? BIN_ENTERPRISE.split('/').pop() : `swao-${platformFlag}`);
  const seaSize = existsSync(OUTPUT_BIN) ? (statSync(OUTPUT_BIN).size / 1024 / 1024).toFixed(1) : '?';
  const pkgSize = existsSync(pkgBin) ? (statSync(pkgBin).size / 1024 / 1024).toFixed(1) : '?';
  console.log(`\n[sea] Size comparison:`);
  console.log(`  pkg binary : ${pkgSize} MB (${pkgBin})`);
  console.log(`  SEA binary : ${seaSize} MB (${OUTPUT_BIN})`);
  console.log(`\n  AV profile:`);
  console.log(`  pkg: runtime snapshot + self-extract to %TEMP% -> heuristic triggers`);
  console.log(`  SEA: Node binary extended in-place -> no self-extraction -> clean AV profile`);
}

async function main() {
  console.log(`\n[sea] SWAO SEA prototype build`);
  console.log(`[sea] Platform: ${platformFlag}  Output: ${OUTPUT_BIN}\n`);

  checkPrerequisites();
  writeSEAConfig();
  generateBlob();
  copyNodeBinary();
  injectBlob();
  verify();
  await printSizeComparison();

  console.log(`\n[sea] Done. Binary at: ${OUTPUT_BIN}`);
  console.log(`[sea] Next: scan with VirusTotal to confirm AV profile improvement vs pkg build.`);
  console.log(`[sea] Submit URL: https://www.virustotal.com/gui/home/upload`);
}

main().catch(err => { console.error(err); process.exit(1); });
