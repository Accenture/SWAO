// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { communityFrameworksDir } from '@swao/community-frameworks';
import { loadRegimeRegistry } from '@swao/core';
import type { CatalogueContribution } from '@swao/core';

// CatalogueContribution for the bundled community frameworks (#0572). The
// framework registry owns catalogue loading; the actual YAML lives in the
// @swao/community-frameworks leaf content package, whose path is resolved
// there (configurable via SWAO_COMMUNITY_FRAMEWORKS_DIR). Consultant /
// enterprise framework packages register their own CatalogueContribution the
// same way, so the catalogue source is pluggable, never hardcoded.
export const communityCatalogueContribution: CatalogueContribution = {
  id: 'community',
  tier: 'community',
  /** Load the bundled community framework registry (byId + collisions). */
  load: async () => loadRegimeRegistry(communityFrameworksDir),
};

/** The on-disk directory of the bundled community frameworks, re-exported for
 *  callers (e.g. the host init scaffolder) that need the source path itself. */
export { communityFrameworksDir };
