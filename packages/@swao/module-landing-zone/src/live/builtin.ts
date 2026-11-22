// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3572: built-in live drivers and the Q-21 gate (Design 120 section 17,
// Design 121 Q-21): a driver whose only evidence is mock runs is not
// registered in a release build. A driver with `liveVerified: false` is
// registered only when the operator names it in SWAO_LZ_UNVERIFIED_DRIVERS
// (comma separated, environment only), which is how the development and
// recording runs on the test tenants enable it.
// #3831 (owner decision 2026-11-04): otc, aws and stackit are live-verified
// and registered without the variable; azure (mock only) stays behind it.

import { awsDriver } from './aws/aws-driver.js';
import { azureDriver } from './azure/azure-driver.js';
import { otcDriver } from './otc/otc-driver.js';
import { stackitDriver } from './stackit/stackit-driver.js';
import { registerLiveLzDriver } from './registry.js';
import type { LiveLzDriver } from './types.js';

export const UNVERIFIED_DRIVERS_ENV = 'SWAO_LZ_UNVERIFIED_DRIVERS';

export const BUILT_IN_LIVE_LZ_DRIVERS: readonly LiveLzDriver[] = [otcDriver, awsDriver, azureDriver, stackitDriver];

/** Register the built-in drivers the gate allows; returns their provider ids. */
export function registerBuiltInLiveLzDrivers(env: NodeJS.ProcessEnv = process.env, drivers: readonly LiveLzDriver[] = BUILT_IN_LIVE_LZ_DRIVERS): string[] {
  const named = new Set((env[UNVERIFIED_DRIVERS_ENV] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== ''));
  const out: string[] = [];
  for (const d of drivers) {
    if (d.liveVerified === true || named.has(d.provider)) {
      registerLiveLzDriver(d);
      out.push(d.provider);
    }
  }
  return out;
}
