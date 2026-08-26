#!/usr/bin/env node
/**
 * bump-version.mjs -- single source of truth for the SWAO patch bump.
 *
 * Increments the patch number in ALL files that must stay in lockstep:
 *   - packages/swao/package.json::version
 *   - packages/swao/src/branding.ts::SWAO_VERSION
 *   - ops/building-block/manifest.yaml::spec.version (#0124)
 *
 * Usage:
 *   node scripts/bump-version.mjs        # patch bump (0.0.25 -> 0.0.26)
 *   node scripts/bump-version.mjs minor  # minor bump (0.0.25 -> 0.1.0)
 *   node scripts/bump-version.mjs major  # major bump (0.0.25 -> 1.0.0)
 *
 * Run BEFORE every `pnpm run build:binary` that ships to an operator.
 * The TUI Header reads SWAO_VERSION, so an un-bumped rebuild silently
 * reports the previous version on every screen of the new binary.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath      = join(__dirname, '..', 'package.json');
// Building-Block manifest at repo root; lives in lockstep with the CLI.
const manifestPath = join(__dirname, '..', '..', '..', 'ops', 'building-block', 'manifest.yaml');

function bump(version, mode) {
  const [maj, min, pat] = version.split('.').map((n) => parseInt(n, 10));
  if (mode === 'major') return `${maj + 1}.0.0`;
  if (mode === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

const mode = process.argv[2] ?? 'patch';
if (!['patch', 'minor', 'major'].includes(mode)) {
  console.error(`[bump-version] unknown mode: ${mode}. Use patch|minor|major.`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const oldVersion = pkg.version;
const newVersion = bump(oldVersion, mode);

pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

// Keep branding.ts SWAO_VERSION literal in lockstep (release-version-consistency gate requires a literal).
const brandingPath = join(__dirname, '..', 'src', 'branding.ts');
const brandingText = readFileSync(brandingPath, 'utf-8');
const newBranding = brandingText.replace(
  /^(export const SWAO_VERSION\s*=\s*)['"][^'"]+['"]/m,
  `$1'${newVersion}'`,
);
if (newBranding === brandingText) {
  console.error('[bump-version] failed to find SWAO_VERSION literal in branding.ts');
  process.exit(1);
}
writeFileSync(brandingPath, newBranding, 'utf-8');

// #0124: keep ops/building-block/manifest.yaml in lockstep. The
// vitest gate `Building Block manifest -- spec.version matches
// packages/swao/package.json version` enforces this; skipping the
// bump would silently break it.
import { existsSync as _existsSync } from 'node:fs';
if (_existsSync(manifestPath)) {
  const manifest = readFileSync(manifestPath, 'utf-8');
  const newManifest = manifest.replace(
    /^(\s*version:\s*)"[^"]+"/m,
    `$1"${newVersion}"`,
  );
  if (newManifest === manifest) {
    console.error('[bump-version] failed to find `version:` line in manifest.yaml');
    process.exit(1);
  }
  writeFileSync(manifestPath, newManifest, 'utf-8');
}

console.log(`[bump-version] ${oldVersion} -> ${newVersion} (${mode})`);

// Run security scan automatically after every version bump.
// This ensures docs/security/scan-results/vX.Y.Z-YYYY-MM-DD/ is always
// created at the same time as the version bump -- no more missing scan results.
import { spawnSync as _spawnSync } from 'node:child_process';
const scanScript = join(__dirname, 'security-scan.mjs');
console.log('[bump-version] Running security scan...');
const scanResult = _spawnSync(process.execPath, [scanScript], {
  stdio: 'inherit',
  cwd: join(__dirname, '..'),
});
if (scanResult.status !== 0) {
  console.warn('[bump-version] Security scan completed with warnings -- check docs/security/scan-results/');
}
