// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Filesystem-based Chromium detection for SWAO's Playwright integration (#0799).
// Used by the SetupWizard (Step 5 detection), health-check Playwright probe
// (#0776-D), and swao install-playwright (pre-check). Does NOT require the
// playwright module to be importable -- safe to call inside a PKG binary.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Playwright version bundled in this release -- update when playwright is upgraded.
// Used to pin `npx playwright@VERSION install chromium` so the exact Chromium
// build matching the bundled playwright is downloaded.
export const PLAYWRIGHT_VERSION = '1.59.1';

/**
 * Scan the ms-playwright cache directory for an installed Chromium binary.
 * Checks Windows (%LOCALAPPDATA%\ms-playwright), Linux (~/.cache/ms-playwright),
 * and macOS (~/Library/Caches/ms-playwright). Returns the absolute executable
 * path when found; null otherwise. Picks the highest version directory.
 */
export function findInstalledChromium(): string | null {
  const home = homedir();
  const localAppData = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local');
  const candidateRoots = [
    join(localAppData, 'ms-playwright'),
    join(home, '.cache', 'ms-playwright'),
    join(home, 'Library', 'Caches', 'ms-playwright'),
  ];
  const subfolderCandidates: [string, string][] = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win',   'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-linux', 'chromium'],
    ['chrome-mac',   join('Chromium.app', 'Contents', 'MacOS', 'Chromium')],
  ];
  for (const msPlaywrightDir of candidateRoots) {
    if (!existsSync(msPlaywrightDir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(msPlaywrightDir).filter((d) => d.startsWith('chromium-'));
    } catch {
      continue;
    }
    entries.sort().reverse();
    for (const dir of entries) {
      for (const [subfolder, binary] of subfolderCandidates) {
        const candidate = join(msPlaywrightDir, dir, subfolder, binary);
        if (existsSync(candidate)) return candidate;
      }
      // macOS: Playwright appends a build-number suffix to chrome-mac
      // (e.g. chrome-mac-1415). Scan for any chrome-mac* subdirectory.
      let subEntries: string[] = [];
      try {
        subEntries = readdirSync(join(msPlaywrightDir, dir)).filter((d) => d.startsWith('chrome-mac'));
      } catch { /* skip */ }
      for (const sub of subEntries) {
        const candidate = join(msPlaywrightDir, dir, sub, 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/**
 * Returns true when the playwright or playwright-core npm package is
 * discoverable on the host filesystem. Checks project-local node_modules,
 * ancestor directories (up to 3 levels), and all common global install
 * locations across npm, pnpm, Volta, nvm, nvm-windows, fnm, and system
 * installers on Windows, Linux, and macOS. Used in pkg-binary mode where
 * playwright is stubbed out and must be loaded from the host.
 * Called fresh on every check (no module-level cache). (#0927)
 */
export function isPlaywrightPackageInstalled(): boolean {
  const home = homedir();
  const isWin = process.platform === 'win32';
  const appData = process.env['APPDATA'] ?? '';
  const localAppData = process.env['LOCALAPPDATA'] ?? '';

  // Scan a version-directory tree and return package-root paths.
  function scanVersionDirs(base: string, addLib: boolean, max = 3): string[] {
    if (!existsSync(base)) return [];
    try {
      return readdirSync(base)
        .filter(d => d.startsWith('v') || /^\d/.test(d))
        .sort().reverse().slice(0, max)
        .map(v => join(base, v, ...(addLib ? ['lib', 'node_modules'] : ['node_modules'])));
    } catch { return []; }
  }

  const candidateDirs: string[] = [
    // Project-local (fastest path first)
    join(process.cwd(), 'node_modules'),
  ];

  // Ancestor walk: useful when installed once at a portfolio root
  let curDir = process.cwd();
  for (let i = 0; i < 3; i++) {
    const parent = join(curDir, '..');
    if (parent === curDir) break;
    candidateDirs.push(join(parent, 'node_modules'));
    curDir = parent;
  }

  // npm global
  if (appData)      candidateDirs.push(join(appData, 'npm', 'node_modules'));
  if (localAppData) candidateDirs.push(join(localAppData, 'npm', 'node_modules'));
  const npmPrefix = process.env['npm_config_prefix'];
  if (npmPrefix)    candidateDirs.push(join(npmPrefix, 'lib', 'node_modules'));

  // pnpm global
  const pnpmHome = process.env['PNPM_HOME'];
  if (pnpmHome)    candidateDirs.push(join(pnpmHome, 'node_modules'));
  if (localAppData) candidateDirs.push(join(localAppData, 'pnpm', 'node_modules'));  // Windows default
  candidateDirs.push(join(home, '.local', 'share', 'pnpm', 'node_modules'));  // Linux XDG
  candidateDirs.push(join(home, 'Library', 'pnpm', 'node_modules'));  // macOS legacy

  // Volta (Windows: no lib/ under version dir; Linux/macOS: lib/node_modules)
  const voltaHome = process.env['VOLTA_HOME'] ?? join(home, '.volta');
  candidateDirs.push(...scanVersionDirs(join(voltaHome, 'tools', 'image', 'node'), !isWin));

  // nvm (Linux/macOS -- ~/.nvm/versions/node/<ver>/lib/node_modules)
  candidateDirs.push(...scanVersionDirs(join(home, '.nvm', 'versions', 'node'), true));

  // nvm-windows (%NVM_HOME%\v*\node_modules -- no lib/ subdirectory)
  const nvmHome = process.env['NVM_HOME'] ?? '';
  if (nvmHome) candidateDirs.push(...scanVersionDirs(nvmHome, false));

  // fnm (all platforms -- ~/.fnm/node-versions/<ver>/installation/lib/node_modules)
  try {
    const fnmBase = join(home, '.fnm', 'node-versions');
    if (existsSync(fnmBase)) {
      candidateDirs.push(
        ...readdirSync(fnmBase).sort().reverse().slice(0, 3)
          .map(v => join(fnmBase, v, 'installation', 'lib', 'node_modules')),
      );
    }
  } catch { /* skip */ }

  // NODE_PATH environment variable entries
  const nodeSep = isWin ? ';' : ':';
  for (const d of (process.env['NODE_PATH'] ?? '').split(nodeSep)) {
    if (d) candidateDirs.push(d);
  }

  // Classic npm-global and system-installer paths
  candidateDirs.push(
    join(home, '.npm-global', 'lib', 'node_modules'),
    join(home, '.yarn', 'global', 'node_modules'),
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    '/opt/homebrew/lib/node_modules',
    '/usr/local/homebrew/lib/node_modules',
    '/snap/node/current/lib/node_modules',
    'C:\\Program Files\\nodejs\\node_modules',
    'C:\\Program Files (x86)\\nodejs\\node_modules',
  );

  for (const nmDir of candidateDirs) {
    if (!nmDir) continue;
    for (const pkgName of ['playwright', 'playwright-core']) {
      try {
        if (existsSync(join(nmDir, pkgName, 'index.js'))) return true;
      } catch { /* skip invalid paths */ }
    }
  }
  return false;
}
