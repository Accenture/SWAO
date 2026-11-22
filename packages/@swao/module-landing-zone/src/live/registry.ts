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

// #3571: LiveLzDriver registry (Design 120 section 7.1), modelled on the IaC
// provider registry (`module-iac/src/registry.ts:26`). Drivers register at
// module load; the descriptor is validated with Zod on registration.

import { LiveLzDriverDescriptorSchema } from './types.js';
import type { LiveLzDriver } from './types.js';

const _drivers = new Map<string, LiveLzDriver>();

export function registerLiveLzDriver(driver: LiveLzDriver): void {
  const r = LiveLzDriverDescriptorSchema.safeParse(driver);
  if (!r.success) {
    throw new Error(`[lz live] invalid driver ${String((driver as { provider?: unknown }).provider)}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  _drivers.set(driver.provider, driver);
}

export function getLiveLzDriver(provider: string): LiveLzDriver | undefined {
  return _drivers.get(provider);
}

export function registeredLiveLzProviders(): string[] {
  return [..._drivers.keys()].sort();
}

/** Test helper: remove one driver (or all). */
export function unregisterLiveLzDriver(provider?: string): void {
  if (provider === undefined) _drivers.clear();
  else _drivers.delete(provider);
}

/**
 * #3865, #3881: the optional collectors a recording can predate. A replay or a
 * conformance run of a recording made before a collector existed runs the
 * driver without it, so the recorded and the replayed route sets compare like
 * for like.
 */
export type OmittableLzCollector = 'listPosture' | 'listHierarchy' | 'listServiceResources';

/** A copy of `driver` without the named optional collectors (the driver itself is not changed). */
export function omitLzCollectors(driver: LiveLzDriver, collectors: readonly OmittableLzCollector[]): LiveLzDriver {
  const stripped: LiveLzDriver = { ...driver };
  for (const k of collectors) {
    switch (k) {
      case 'listPosture': delete stripped.listPosture; break;
      case 'listHierarchy': delete stripped.listHierarchy; break;
      case 'listServiceResources': delete stripped.listServiceResources; break;
      default: { const never: never = k; throw new Error(`[lz live] unknown collector ${String(never)}`); }
    }
  }
  // #3970: the posture reads that belong to the service resources go with them.
  if (collectors.includes('listServiceResources') && stripped.listPosture !== undefined && driver.listPostureWithoutServiceResources !== undefined) {
    stripped.listPosture = driver.listPostureWithoutServiceResources;
  }
  delete stripped.listPostureWithoutServiceResources;
  return stripped;
}
