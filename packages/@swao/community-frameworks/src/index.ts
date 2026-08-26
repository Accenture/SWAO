// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Community frameworks
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

// @swao/community-frameworks (#0572) -- the bundled Apache-2.0 community
// frameworks (not only compliance: also architecture, sovereignty, cloud
// onboarding, ...). A LEAF content package: it carries the framework catalogues
// under frameworks/ (each framework folder contains its controls) and resolves
// their on-disk location. It has NO @swao dependencies, so the framework module
// (and the host) may import it without a module -> module cycle.
//
// The catalogue source location is configurable (#0572 acceptance criterion):
//   1. SWAO_COMMUNITY_FRAMEWORKS_DIR env var (operator / per-tier override), else
//   2. the package's own frameworks/ dir, resolved from this module's location
//      with candidate probing that also covers the flattened pkg-binary layout.
//
// A consultant/enterprise content package mirrors this shape (its own
// frameworks/ dir + resolver), and the host aggregates them; nothing here is
// hardcoded to a single repo path.

const here = dirname(fileURLToPath(import.meta.url));

function resolveCommunityFrameworksDir(): string {
  const override = process.env['SWAO_COMMUNITY_FRAMEWORKS_DIR'];
  if (override && existsSync(override)) return override;
  // dist/ -> package root is one up; the pkg binary flattens differently, so
  // probe a few candidates (mirrors init.ts's historical approach).
  const candidates = [
    join(here, '..', 'frameworks'),        // <pkg>/dist -> <pkg>/frameworks (dev)
    join(here, '_community-frameworks'),   // #0625: build-lib stages them next to the bundle/binary (dist/_community-frameworks)
    join(here, 'frameworks'),              // flattened next to the bundle
    join(here, '..', '..', 'frameworks'),  // deeper flatten
    join(here, '..', '..', '..', '@swao', 'controls-community', 'frameworks'),
  ];
  for (const c of candidates) {
    try { if (existsSync(c)) return c; } catch { /* try next */ }
  }
  return candidates[0]!;
}

/** Absolute path to the bundled community framework catalogues directory
 *  (contains _registry.yaml + one folder per framework). */
export const communityFrameworksDir: string = resolveCommunityFrameworksDir();

/** The framework registry index file shipped with the community catalogues. */
export const communityRegistryFile: string = join(communityFrameworksDir, '_registry.yaml');
