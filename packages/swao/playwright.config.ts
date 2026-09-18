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

import { defineConfig } from '@playwright/test';

/**
 * SWAO E2E test configuration.
 *
 * Tests are organised by user journey (J0-J4 from docs/design/010-ux-access-design.md).
 * All journey tests drive the swao binary directly (CLI mode); browser-based tests
 * will be added when the web dashboard (`swao serve`) is built.
 *
 * Prerequisites:
 *   bash scripts/build-binary.sh --win   # or --linux / --macos
 *   npm install                           # installs @playwright/test
 *
 * Run:
 *   npm run test:e2e
 *   npm run test:e2e -- tests/e2e/j3-license.spec.ts   # single journey
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',

  // Generous timeout for binary spawn tests
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // No parallelism -- credential store is shared state
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    // Env injected into all spawned child processes
    actionTimeout: 30_000,
  },
});
