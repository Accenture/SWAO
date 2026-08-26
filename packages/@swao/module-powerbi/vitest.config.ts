// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Power BI module
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
    // #0577 -- set the test signing secret before any test module loads
    // @swao/core's license-guard so the relocated export tests can construct a
    // LicenseGuard without the real Accenture signing secret (mirrors
    // @swao/module-doctor's vitest setup).
    setupFiles: ['src/__tests__/setup.ts'],
  },
});
