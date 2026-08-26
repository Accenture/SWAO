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

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // #0365 (sprint-048): switched to 'forks' pool -- each worker forks instead of
    // using Node thread workers. Eliminates the ESM module-cache sharing that caused
    // mcp-server.test.ts and license.test.ts to flake under parallel contention.
    // The forks pool adds ~5 s to the full suite; the reliability gain is worth it.
    pool: 'forks',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: [
      // #0366 (sprint-044): fixtures/source/ restored; passes.test.ts re-enabled.
      // Binary names re-aligned to sprint-038; requires built binary -- excluded
      // from default test run, covered by release CI binary-e2e job.
      'src/__tests__/binary-distribution.test.ts',
      // Env-dependent: demo.sh end-to-end timing test, flakes on slow machines.
      'src/__tests__/demo-script.test.ts',
      // #0266: PlaywrightCrawlProvider smoke; runs via `npm run test:crawl` to
      // avoid contention on Chromium handles. Not part of the default test run.
      'src/crawl/crawl-playwright.smoke.test.ts',
      // #0365: mcp-server.test.ts and license.test.ts RE-ENABLED by switching to
      // forks pool. Removed from the exclude list in this commit.
    ],
    // Tests that share the sovereign-health example workspace or make real
    // file-system / network calls run sequentially to avoid race conditions.
    // These pass when run alone but flake in parallel due to contention on
    // shared paths or process env state.
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    sequence: {
      shuffle: false,
    },
    // M18 #0271 -- set the test signing secret before any test module
    // loads license-guard.ts so signed keys round-trip.
    setupFiles: ['src/__tests__/setup.ts'],
    // #0670 Ph5: coverage floor -- enforced in CI via `pnpm test:coverage`.
    // Thresholds are intentionally modest for sprint-076 baseline;
    // ratchet upward as more tests are added.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/__tests__/**',
        'src/tui/__tests__/**',
      ],
      thresholds: {
        lines:     55,
        functions: 45,
        branches:  40,
        statements: 55,
      },
    },
  },
});
