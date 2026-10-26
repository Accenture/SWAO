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

import { existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import type { Command } from 'commander';
import { findInstalledChromium, isPlaywrightPackageInstalled, PLAYWRIGHT_VERSION } from '@swao/core';

// On Windows, .cmd files require shell:true inside a pkg binary. Use shell:true
// on Windows for all npm/npx invocations so cmd.exe handles the batch wrapper.
const WIN = process.platform === 'win32';
const NPM = WIN ? 'npm.cmd' : 'npm';
const NPX = WIN ? 'npx.cmd' : 'npx';
const SHELL = WIN;

// Check only the npm global location -- not project-local node_modules.
// isPlaywrightPackageInstalled() scans project ancestors too; that is correct
// for the assessment probe but causes a false-positive here when run from the
// dev monorepo (pnpm virtual store is an ancestor and contains playwright-core).
// #1079: use the npm global prefix exclusively so the install decision reflects
// what will be accessible when the binary runs from a client workspace.
function isPlaywrightGloballyInstalled(): boolean {
  const nmDir = WIN
    ? join(process.env['APPDATA'] ?? '', 'npm', 'node_modules')
    : join(process.env['npm_config_prefix'] ?? '/usr/local', 'lib', 'node_modules');
  return (
    existsSync(join(nmDir, 'playwright-core', 'index.js')) ||
    existsSync(join(nmDir, 'playwright', 'index.js'))
  );
}

// #3376: with shell:true a missing npx.cmd exits 1 rather than raising an
// ENOENT, so the "install Node.js" hint under result.error never printed.
// Probe the command up front so the message is clear when Node.js is absent.
export function isCommandAvailable(cmd: string): boolean {
  try {
    const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: SHELL });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

// #3376: the crawler download needs Node.js/npx on the host. On an air-gapped
// client machine there is none, so document a prepare-and-copy route and the
// opt-out, instead of failing with a bare non-zero exit code.
export function printOfflinePlaywrightGuidance(): void {
  console.error('[error] Node.js / npx was not found on PATH.');
  console.error('        The dynamic UI crawler (Pass 10) downloads Chromium with npx, which needs Node.js.');
  console.error('');
  console.error('  The crawler is optional. Application assessments run without it, and service and');
  console.error('  landing-zone assessments do not use it at all. To assess without it, add --no-crawl:');
  console.error('      swao assess --app <id> --no-crawl');
  console.error('');
  console.error('  To enable it on a machine without internet or Node.js, prepare it elsewhere and copy:');
  console.error(`    1. On a connected machine with Node.js:`);
  console.error(`         npx playwright@${PLAYWRIGHT_VERSION} install chromium`);
  console.error(`         npm install -g playwright-core@${PLAYWRIGHT_VERSION}`);
  console.error(WIN
    ? '    2. Copy %LOCALAPPDATA%\\ms-playwright and %APPDATA%\\npm\\node_modules\\playwright-core to the client,'
    : '    2. Copy ~/.cache/ms-playwright and the global playwright-core to the client,');
  console.error('       keeping the same paths, or point PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH at a Chromium binary.');
  console.error('    3. Run swao health-check to confirm it is detected.');
}

export function registerInstallPlaywright(program: Command): void {
  program
    .command('install-playwright')
    .description('Download the Chromium browser required for dynamic UI crawler (Pass 10).')
    .action(() => {
      console.log('Installing Chromium for SWAO dynamic analysis...\n');

      const chromiumPath      = findInstalledChromium();
      const pkgGlobalInstalled = isPlaywrightGloballyInstalled();

      if (chromiumPath && pkgGlobalInstalled) {
        console.log(`[ok]  Chromium already installed at: ${chromiumPath}`);
        console.log('[ok]  playwright-core already installed globally.');
        console.log('      Run swao health-check to confirm everything is detected correctly.');
        process.exit(0);
      }

      // #3376: fail fast with a clear message when the host has no Node.js/npx,
      // which both the Chromium download and the playwright-core install need.
      if ((!chromiumPath || !pkgGlobalInstalled) && !isCommandAvailable(NPX)) {
        printOfflinePlaywrightGuidance();
        process.exit(1);
      }

      if (!chromiumPath) {
        // Use npx to download the exact playwright version bundled in this binary.
        // Pinning the version ensures the correct Chromium build number is installed.
        console.log(`[info] Running: npx playwright@${PLAYWRIGHT_VERSION} install chromium`);
        console.log('       ~170 MB download. This may take a minute...\n');

        const result = spawnSync(
          NPX,
          [`playwright@${PLAYWRIGHT_VERSION}`, 'install', 'chromium'],
          { stdio: 'inherit', shell: SHELL },
        );

        if (result.error) {
          console.error(`[error] Failed to run npx: ${result.error.message}`);
          console.error(`  Ensure Node.js is installed and npx is in your PATH.`);
          process.exit(1);
        }

        if (result.status !== 0) {
          console.error(`[error] playwright install exited with code ${result.status ?? 'unknown'}`);
          process.exit(1);
        }

        console.log('\n[ok]  Chromium installed.');
      } else {
        console.log(`[ok]  Chromium already at: ${chromiumPath}`);
      }

      if (!pkgGlobalInstalled) {
        // Install playwright-core globally so the SWAO binary can load the JS API.
        // The binary stubs out playwright internally; it needs to load playwright-core
        // from a host npm global directory at assessment time (#0927).
        // shell:true on Windows ensures npm.cmd is executed via cmd.exe (#1079).
        console.log(`\n[info] Installing playwright-core@${PLAYWRIGHT_VERSION} globally (required by SWAO binary for Pass 10)...`);
        const npmResult = spawnSync(
          NPM,
          ['install', '-g', `playwright-core@${PLAYWRIGHT_VERSION}`],
          { stdio: 'inherit', shell: SHELL },
        );
        if (npmResult.error || (npmResult.status !== 0)) {
          console.warn(`\n[warn] playwright-core global install failed (may need elevated permissions).`);
          console.warn(`       Run manually: npm install -g playwright-core@${PLAYWRIGHT_VERSION}`);
        } else {
          const verified = isPlaywrightPackageInstalled();
          if (!verified) {
            const nmDir = WIN
              ? join(process.env['APPDATA'] ?? '', 'npm', 'node_modules')
              : join(process.env['npm_config_prefix'] ?? '/usr/local', 'lib', 'node_modules');
            console.warn(`\n[warn] playwright-core installed but not detected by SWAO.`);
            console.warn(`       Expected at: ${join(nmDir, 'playwright-core', 'index.js')}`);
            console.warn(`       If missing, set NODE_PATH to include the npm global node_modules directory.`);
          } else {
            console.log('[ok]  playwright-core installed and verified.');
          }
        }
      }

      console.log('\n[ok]  Playwright setup complete. Run swao health-check to verify.');
    });
}
