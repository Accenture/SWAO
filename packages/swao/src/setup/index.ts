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

// #4190 SET-01 (Design 125): entry point of the setup per assessment type.
// The default registry is built once from the generic module and the five
// branch modules; branch lanes edit only their file under ./branches/.

import { createSetupRegistry, type SetupRegistry } from './registry.js';
import { genericSetup } from './branches/generic.js';
import { applicationBranch } from './branches/application.js';
import { serviceBranch } from './branches/service.js';
import { lzCatalogBranch } from './branches/lz-catalog.js';
import { lzLiveBranch } from './branches/lz-live.js';
import { llmBranch } from './branches/llm.js';

export * from './types.js';
export { createSetupRegistry, validateSteps, SetupRegistryError, type SetupRegistry } from './registry.js';
export {
  buildSetupPlan,
  stepBarFor,
  entryLabel,
  entryScope,
  setupSubtitle,
  HEALTH_CHECK_LABEL,
  TYPE_SELECTION_LABEL,
  READY_LABEL,
  WORKSPACE_LABEL,
  RESERVED_STEP_LABELS,
  type SetupPlanContext,
  type SetupStepBar,
} from './plan.js';
export * from './defaults.js';

let cached: SetupRegistry | undefined;

/** The registry of the shipped generic setup and branches (built once). */
export function defaultSetupRegistry(): SetupRegistry {
  cached ??= createSetupRegistry(genericSetup, [applicationBranch, serviceBranch, lzCatalogBranch, lzLiveBranch, llmBranch]);
  return cached;
}
