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

import { describe, it, expect } from 'vitest';
import { findInstalledChromium } from '@swao/core';
import { buildPlaywrightProbe } from './playwright-driver.js';

// #0573: relocated from @swao/module-doctor's doctor.test.ts. buildPlaywrightProbe
// is host-only (playwright-driver is binary-excluded and shared with assess), so
// the doctor module receives it via injection and cannot import it for tests.
// The behavioural probe test belongs alongside the driver it exercises.

// When Chromium is installed, buildPlaywrightProbe falls back to the filesystem
// scan and returns 'ok' even for a fake path. Skip in that environment.
const chromiumInstalled = findInstalledChromium() !== null;

describe('Doctor -- Playwright probe (#0102)', () => {
  it.skipIf(chromiumInstalled)('buildPlaywrightProbe returns fail for non-existent binary path', async () => {
    const result = await buildPlaywrightProbe({ executablePath: '/does/not/exist/chrome', launchTimeoutMs: 1000 });
    expect(result.status).toBe('fail');
    expect(result.error).not.toBeNull();
  });
});
