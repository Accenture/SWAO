// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Challenge module
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
    pool: 'forks',
    include: ['src/**/*.test.ts'],
    // M18 #0277 / #0580 -- set the test signing secret before any test module
    // loads @swao/core's license-guard so the relocated challenge.test.ts can
    // round-trip signed keys (mirrors @swao/swao's vitest setup).
    setupFiles: ['src/__tests__/setup.ts'],
  },
});
