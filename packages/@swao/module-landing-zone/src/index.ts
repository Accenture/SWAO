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

import type { Command } from 'commander';
import type {
  SwaoModuleManifest,
  AssessmentTypeContribution,
  CommandContribution,
} from '@swao/core';
import { registerLz } from './commands/lz.js';

/**
 * @swao/module-landing-zone -- the landing-zone assessment type (Design 056,
 * ADR-0047 / ADR-0039). Three layers:
 *   A) CSP service catalogue (region- + sovereignty-aware "what is available")
 *   B) customer LZ scan (IaC / config-export ingestion + opt-in live read-only)
 *   C) fit/gap report vs the app's assessed needs (headline) + comparison.
 *
 * Scaffold (#0564): the manifest registers `type: landing-zone` as comingSoon
 * `swao assess --type landing-zone` is wired (#0567): the CLI assess command
 * drives it inline (it needs provider/region config + the app WSP's derived
 * required services, bridging the app-assessment loaders + core
 * deriveConstraints). The contribution is registered for routing/discovery;
 * the orchestration entry point is the CLI dispatch (mirrors how the audit type
 * is driven inline). Sovereignty is framework-driven (D-LZ-07): the catalogue
 * stores facts, the installed community frameworks supply the verdict.
 */
export const landingZoneAssessmentType: AssessmentTypeContribution = {
  type: 'landing-zone-catalog',
  description:
    'Landing-zone catalog assessment: CSP service catalog + customer LZ scan + fit/gap report (Design 056, ADR-0051).',
  run: async () => {
    throw new Error(
      'type:landing-zone is dispatched inline by the `swao assess` command (it needs ' +
        'provider/region config + the app WSP). Run `swao assess --type landing-zone --app <id> ' +
        '--lz-provider <p> --lz-region <r>`.',
    );
  },
};

// Layer A catalogue fetchers (#0565): operator-fed normalisers (no SDK/creds).
export { normalizeAwsSsmCatalogue } from './catalogue/fetch-aws.js';
export type { SsmParameter, AwsRegionOverlay } from './catalogue/fetch-aws.js';
export { normalizeAzureProducts } from './catalogue/fetch-azure.js';
export type { AzureAvailabilityRow, AzureRegionOverlay } from './catalogue/fetch-azure.js';

// Layer B customer LZ scan normalisers (#0566): operator-fed snapshot/IaC/export
// -> normalised LzScanResult (no creds; Mode C live reuses these via a transport).
export { normalizeAwsSnapshot } from './scan/scan-aws.js';
export type { AwsScanOptions } from './scan/scan-aws.js';
export { normalizeAzureSnapshot } from './scan/scan-azure.js';
export type { AzureScanOptions } from './scan/scan-azure.js';

// Layer C fit/gap engine (#0567): the headline LZ deliverable.
export { computeLzFit, sovereigntyFailures } from './fit/lz-fit.js';
export { orchestrateLandingZone, deriveSovereigntyRequirements } from './fit/orchestrate-lz.js';
export type { OrchestrateLzInput, FrameworkSovereigntyDecl } from './fit/orchestrate-lz.js';
export { assembleLandingZoneWsp, assembleLzCatalogWsp, readFrameworkSovereigntyDecls, discoverGateCapableFrameworks } from './fit/run-lz.js';
export type { AssembleLzInput, AssembleLzResult, GateCapableFramework } from './fit/run-lz.js';
export type {
  LzFitReport,
  LzFitItem,
  LzFitVerdict,
  LzOverallVerdict,
  LzRequiredService,
  SovereigntyRequirements,
  LzFitInput,
} from './fit/lz-fit.js';

// Verdict narrative generator (#1358): plain-language reasoning for LZ verdicts.
export { generateLzNarrative } from './fit/lz-narrative.js';
export type {
  LzVerdictNarrative,
  LzSovereigntyNarrative,
  LzServiceCheckNarrative,
  LzSovereigntyFactsInput,
} from './fit/lz-narrative.js';

// CLI surface (#0567): catalogue loader + the `swao lz` command group.
export {
  resolveLzCataloguesDir,
  resolveBundledLzCataloguesDir,
  loadLzCatalogueIndex,
  loadLzCatalogue,
  resolveProviderCatalogue,
  LzCatalogueSchemaError,
  LzCatalogueDuplicateIdError,
} from './catalogue/loader.js';
export type { LzCatalogueIndexEntry, LzCatalogueProvenance } from './catalogue/loader.js';
export { registerLz } from './commands/lz.js';
// Premium CLI: catalogue update (consultant+; Design 065 §5.6).
export { registerLzCatalogueUpdate } from './commands/lz-premium.js';

export const assessmentTypes: AssessmentTypeContribution[] = [landingZoneAssessmentType];

export const commandContributions: CommandContribution[] = [
  {
    name: 'lz',
    description: 'Landing-zone catalogue + fit helpers (Design 056).',
    register: (program) => registerLz(program as Command),
  },
];

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-landing-zone',
  version: '0.1.0',
  tier: 'community',
  contributions: {
    assessmentTypes,
    commands: commandContributions,
  },
};
