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

// Dedicated vitest config for the PlaywrightCrawlProvider smoke test
// (#0266). Runs the single extracted file in isolation -- no parallel
// workers, no contention with the rest of the suite for Chromium
// handles.
//
// Invocation: `npm run test:crawl`

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/crawl/crawl-playwright.smoke.test.ts'],
    // M18 #0271 -- license-guard secret setup, reused from the main config.
    setupFiles: ['src/__tests__/setup.ts'],
    // Single-fork pool: serialise everything so Chromium has no
    // competing process to fight for handles with. Vitest 4 removed
    // `poolOptions`; for this single-file include, disabling file
    // parallelism gives the same one-process serialisation.
    pool: 'forks',
    fileParallelism: false,
  },
});
