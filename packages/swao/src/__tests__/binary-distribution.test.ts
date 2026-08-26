// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Distribution artifact integrity tests.
 *
 * These tests run in normal CI (no binary required) and verify that
 * the distribution scripts, launcher .bat files, and build pipeline
 * config are internally consistent and contain the required content.
 *
 * Counterpart: binary-e2e.test.ts (skipped unless swao-win.exe exists)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawnSync } from 'child_process';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '../../../../');
const DIST_BIN   = join(REPO_ROOT, 'dist-bin');
const SWAO_PKG   = join(REPO_ROOT, 'packages/swao');
const BUILD_SH   = join(REPO_ROOT, 'scripts/build-binary.sh');
const SWAO_BAT   = join(DIST_BIN, 'swao.bat');
const PKG_JSON   = join(SWAO_PKG, 'package.json');
const BUNDLE_MJS = join(SWAO_PKG, 'scripts/bundle.mjs');

// ---------------------------------------------------------------------------
// swao.bat -- Windows double-click launcher
// ---------------------------------------------------------------------------

describe('dist-bin/swao.bat integrity', () => {
  it('swao.bat exists', () => {
    expect(existsSync(SWAO_BAT)).toBe(true);
  });

  it('swao.bat passes arguments straight through when called with args', () => {
    const bat = readFileSync(SWAO_BAT, 'utf-8');
    expect(bat).toContain('%*');
    expect(bat).toContain('%~1');
  });

  it('swao.bat launches TUI directly via swao menu when no args given', () => {
    const bat = readFileSync(SWAO_BAT, 'utf-8');
    expect(bat).toMatch(/"%SWAO%"\s+menu/);
  });

  it('swao.bat sets SWAO variable to swao-enterprise-win.exe', () => {
    const bat = readFileSync(SWAO_BAT, 'utf-8');
    expect(bat).toContain('swao-enterprise-win.exe');
  });

  it('swao.bat exits cleanly after TUI', () => {
    const bat = readFileSync(SWAO_BAT, 'utf-8');
    expect(bat).toContain('exit /b');
  });

  it('swao.bat uses setlocal EnableDelayedExpansion', () => {
    const bat = readFileSync(SWAO_BAT, 'utf-8');
    expect(bat).toContain('setlocal EnableDelayedExpansion');
  });
});

// ---------------------------------------------------------------------------
// swao-license-issuer.bat -- retired in M18 (Sprint 031).
// Licence issuance lives in `swao license issue` and `swao menu` -> Manage
// Licence -> Issue. The standalone tooling was archived to
// archive/license-issuer-pre-m18/. The integrity tests that lived here have
// been removed alongside the retired binary; reinstating them would require
// resurrecting the .bat file.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// package.json -- pkg configuration
// ---------------------------------------------------------------------------

describe('package.json pkg configuration', () => {
  interface Pkg {
    pkg: {
      assets: string[];
      targets: string[];
      outputPath: string;
    };
    scripts: Record<string, string>;
  }

  function loadPkg(): Pkg {
    return JSON.parse(readFileSync(PKG_JSON, 'utf-8')) as Pkg;
  }

  it('pkg.assets includes package.json (needed for version read at runtime)', () => {
    const { pkg } = loadPkg();
    expect(pkg.assets).toContain('package.json');
  });

  it('pkg.assets includes fixture glob (passes need fixture YAML)', () => {
    const { pkg } = loadPkg();
    const hasFixtures = pkg.assets.some((a) => a.includes('fixtures'));
    expect(hasFixtures).toBe(true);
  });

  it('pkg.assets includes controls glob (runtime compliance ruleset)', () => {
    const { pkg } = loadPkg();
    const hasControls = pkg.assets.some((a) => a.includes('controls'));
    expect(hasControls).toBe(true);
  });

  it('pkg.targets includes Windows x64', () => {
    const { pkg } = loadPkg();
    expect(pkg.targets).toContain('node20-win-x64');
  });

  it('pkg.targets includes Linux x64', () => {
    const { pkg } = loadPkg();
    expect(pkg.targets).toContain('node20-linux-x64');
  });

  it('pkg.targets includes macOS x64', () => {
    const { pkg } = loadPkg();
    expect(pkg.targets).toContain('node20-macos-x64');
  });

  it('build script runs tsc before bundling', () => {
    const { scripts } = loadPkg();
    expect(scripts['build']).toContain('tsc');
  });

  it('build:bundle script delegates to scripts/bundle.mjs', () => {
    const { scripts } = loadPkg();
    expect(scripts['build:bundle']).toContain('bundle.mjs');
  });

  it('lint script includes .tsx files (TUI components)', () => {
    const { scripts } = loadPkg();
    expect(scripts['lint']).toContain('.tsx');
  });

  it('build:binary script uses --fallback-to-source flag', () => {
    const { scripts } = loadPkg();
    expect(scripts['build:binary']).toContain('--fallback-to-source');
  });

  it('build:binary script uses --compress GZip', () => {
    const { scripts } = loadPkg();
    expect(scripts['build:binary']).toContain('--compress GZip');
  });
});

// ---------------------------------------------------------------------------
// scripts/bundle.mjs -- esbuild JS API bundle script
// ---------------------------------------------------------------------------

describe('scripts/bundle.mjs integrity', () => {
  it('bundle.mjs exists', () => {
    expect(existsSync(BUNDLE_MJS)).toBe(true);
  });

  it('bundle.mjs uses CJS output format', () => {
    const src = readFileSync(BUNDLE_MJS, 'utf-8');
    expect(src).toMatch(/format:\s+'cjs'/);
  });

  it('bundle.mjs stubs playwright via plugin (playwright-stub)', () => {
    const src = readFileSync(BUNDLE_MJS, 'utf-8');
    expect(src).toContain('playwright-stub');
    expect(src).toContain('/^playwright$/');
  });

  it('bundle.mjs injects import.meta.url shim (ESM->CJS bridge)', () => {
    const src = readFileSync(BUNDLE_MJS, 'utf-8');
    expect(src).toContain('__importMetaUrl');
    expect(src).toContain('import.meta.url');
  });

  it('bundle.mjs aliases yoga-wasm-web/auto to yoga-layout-prebuilt (no top-level await in CJS)', () => {
    const src = readFileSync(BUNDLE_MJS, 'utf-8');
    expect(src).toContain('yoga-wasm-web/auto');
    expect(src).toContain('yoga-layout-prebuilt');
  });

  it('bundle.mjs has ink-devtools-stub plugin (removes top-level await from reconciler)', () => {
    const src = readFileSync(BUNDLE_MJS, 'utf-8');
    expect(src).toContain('ink-devtools-stub');
    expect(src).toContain('reconciler');
  });

  it('bundle.mjs externalises react-devtools-core', () => {
    const src = readFileSync(BUNDLE_MJS, 'utf-8');
    expect(src).toContain('react-devtools-core');
  });
});

// ---------------------------------------------------------------------------
// scripts/build-binary.sh -- build pipeline script
// ---------------------------------------------------------------------------

describe('scripts/build-binary.sh integrity', () => {
  it('build-binary.sh exists', () => {
    expect(existsSync(BUILD_SH)).toBe(true);
  });

  it('starts with a bash shebang', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh.startsWith('#!/usr/bin/env bash') || sh.startsWith('#!/bin/bash')).toBe(true);
  });

  it('uses set -euo pipefail (fail-fast)', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh).toContain('set -euo pipefail');
  });

  it('has a tsc compile step', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh).toContain('tsc');
  });

  it('has an esbuild bundle step', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh).toContain('esbuild');
  });

  it('has a pkg packaging step via @yao-pkg/pkg', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh).toContain('@yao-pkg/pkg');
  });

  it('supports --win flag to build Windows binary only', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh).toContain('--win');
    expect(sh).toContain('node20-win-x64');
  });

  it('supports --linux flag to build Linux binary only', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh).toContain('--linux');
    expect(sh).toContain('node20-linux-x64');
  });

  it('supports --macos flag to build macOS binary only', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh).toContain('--macos');
    expect(sh).toContain('node20-macos-x64');
  });

  it('documents rcedit for Windows icon injection', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh).toContain('rcedit');
  });

  it('rcedit failure is non-fatal (binary still usable without icon)', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    // rcedit failure is soft: "|| echo ..." pattern
    expect(sh).toContain('rcedit');
    const rceditBlock = sh.slice(sh.indexOf('rcedit'));
    expect(rceditBlock).toContain('non-fatal');
  });

  it('notes that Playwright Chromium must be installed separately', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh.toLowerCase()).toContain('playwright');
    expect(sh.toLowerCase()).toContain('separately');
  });

  it('uses --compress GZip to reduce binary size', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh).toContain('--compress GZip');
  });

  it('uses --fallback-to-source flag', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh).toContain('--fallback-to-source');
  });

  it('outputs binary to dist-bin directory', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh).toContain('dist-bin');
  });

  it('documents that the license issuer is built from swao-premium', () => {
    const sh = readFileSync(BUILD_SH, 'utf-8');
    expect(sh).toContain('swao-premium');
    expect(sh.toLowerCase()).toContain('license');
  });
});

// ---------------------------------------------------------------------------
// license.ts source -- fingerprint exposure regression tests
// ---------------------------------------------------------------------------

describe('license.ts source -- fingerprint visible to Community users', () => {
  const LICENSE_SRC = join(SWAO_PKG, 'src/commands/license.ts');

  it('communityStatusText includes Machine fingerprint line', () => {
    const src = readFileSync(LICENSE_SRC, 'utf-8');
    // Find the communityStatusText function body
    const fnStart = src.indexOf('function communityStatusText');
    const fnBody = src.slice(fnStart, fnStart + 1500);
    expect(fnBody).toContain('Machine fingerprint');
    expect(fnBody).toContain('fingerprint.substring(0, 8)');
  });

  it('communityStatusText fingerprint line mentions requesting a license', () => {
    const src = readFileSync(LICENSE_SRC, 'utf-8');
    const fnStart = src.indexOf('function communityStatusText');
    const fnBody = src.slice(fnStart, fnStart + 1500);
    expect(fnBody).toMatch(/Machine fingerprint.*request/i);
  });

  it('licensedStatusText also includes Machine fingerprint line (matched)', () => {
    const src = readFileSync(LICENSE_SRC, 'utf-8');
    const fnStart = src.indexOf('function licensedStatusText');
    const fnBody = src.slice(fnStart, fnStart + 1200);
    expect(fnBody).toContain('Machine fingerprint');
    expect(fnBody).toContain('matched');
  });
});

// ---------------------------------------------------------------------------
// doctor.ts source -- fingerprint in health check output
// ---------------------------------------------------------------------------

describe('doctor.ts source -- fingerprint shown in health check', () => {
  // #0573: doctor command relocated to @swao/module-doctor.
  const DOCTOR_SRC = join(REPO_ROOT, 'packages/@swao/module-health-check/src/commands/health-check.ts');

  it('action body captures fingerprint from guard.state', () => {
    const src = readFileSync(DOCTOR_SRC, 'utf-8');
    expect(src).toContain('fingerprint');
    expect(src).toContain('guard.state.fingerprint');
  });

  it('YAML output includes fingerprint field', () => {
    const src = readFileSync(DOCTOR_SRC, 'utf-8');
    expect(src).toContain('fingerprint:');
  });

  it('text output includes Machine fingerprint line', () => {
    const src = readFileSync(DOCTOR_SRC, 'utf-8');
    expect(src).toContain('Machine fingerprint');
  });
});

// ---------------------------------------------------------------------------
// dist-bin binary file presence -- all three platform binaries
// ---------------------------------------------------------------------------

describe('dist-bin binary file presence', () => {
  // Sprint-038 #0356/#0357 renamed the dist-bin outputs to carry the
  // architecture suffix so the macOS Intel and Apple Silicon builds can
  // coexist. The package.json build:binary:* scripts emit the new names
  // (`swao-linux-x64`, `swao-darwin-x64`, `swao-darwin-arm64`). The old
  // names (`swao-linux`, `swao-macos`) no longer exist.
  it('swao-enterprise-win.exe exists', () => {
    expect(existsSync(join(DIST_BIN, 'swao-enterprise-win.exe'))).toBe(true);
  });

  it('swao-linux-x64 exists', () => {
    expect(existsSync(join(DIST_BIN, 'swao-linux-x64'))).toBe(true);
  });

  it('swao-darwin-x64 exists', () => {
    expect(existsSync(join(DIST_BIN, 'swao-darwin-x64'))).toBe(true);
  });

  it('swao-darwin-arm64 exists', () => {
    expect(existsSync(join(DIST_BIN, 'swao-darwin-arm64'))).toBe(true);
  });

  // On a macOS host, run the binary that matches the host arch. arm64
  // host -> swao-darwin-arm64; x64 host -> swao-darwin-x64. Rosetta would
  // run the x64 binary on arm64 but the native one is faster + closer to
  // what the operator actually distributes.
  const macHostBinary = process.platform === 'darwin'
    ? join(DIST_BIN, process.arch === 'arm64' ? 'swao-darwin-arm64' : 'swao-darwin-x64')
    : '';

  it.skipIf(process.platform !== 'darwin')('host-arch darwin binary --version exits 0 on macOS', () => {
    const r = spawnSync(macHostBinary, ['--version'], { encoding: 'utf-8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('SWAO');
  });

  it.skipIf(process.platform !== 'darwin')('host-arch darwin binary --help exits 0 on macOS', () => {
    const r = spawnSync(macHostBinary, ['--help'], { encoding: 'utf-8' });
    expect(r.status).toBe(0);
  });
});
