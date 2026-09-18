// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  HTML report module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { SwaoModuleManifest, TuiScreenContribution } from '@swao/core';

import { PublishScreen } from './tui/PublishScreen.js';
import { ServeScreen } from './tui/ServeScreen.js';

/**
 * @swao/module-html-report -- the HTML publication subsystem (ADR-0048 modular
 * architecture, Phase 4, #0575).
 *
 * Owns the Mode A single-page HTML renderer (the shipping feature), the
 * `publish` CLI command, the Publish / Serve TUI screens, and the Publication
 * Editor (`publish --edit`, a node:http server).
 *
 * The Consultant HTML Portal (the Mode B static-site builder, the multi-page
 * portfolio portal builder and the live portal server) relocated to
 * @swao/module-html-portal (#0582 module-split stage 2; Design 058 D-PORTAL-1).
 * The `publish` command stays Community here; its `--site` branch is the
 * Consultant portal and is reached by host injection (`buildPortal` in
 * PublishHostDeps) so this Community module never imports that sibling.
 *
 * Host values the module needs are injected: SWAO_VERSION (branding is
 * host-only) + the portal builder via `registerPublish(program, { swaoVersion,
 * buildPortal })`; the TUI screens take a `version` prop (the #0573 doctor +
 * #0574 mcp dependency-injection pattern).
 */

// CLI command + the host-injected dependency contract. The publish command
// stays Community here; its `--site` portal branch is injected (buildPortal)
// from the Consultant @swao/module-html-portal by the host (Design 058
// D-PORTAL-1), so this module exports the injection contract but not the portal
// builder itself.
export { registerPublish } from './commands/publish.js';
export type {
  PublishHostDeps,
  BuildPortal,
  BuildPortalOptions,
  BuildPortalResult,
} from './commands/publish.js';

// Mode A renderer (the shipping feature), re-exported for the host (the host's
// `swao publish` bootstrap and tests reach these). The Mode B site builder + the
// HTML Portal relocated to @swao/module-html-portal (#0582 module-split stage 2).
export {
  renderModeA,
  scaffoldPublicationTemplate,
  PublicationSizeError,
} from './publish/renderer.js';
export type { RenderModeAOptions, RenderModeAResult } from './publish/renderer.js';

// Data-quality banner helpers. The host's BI-export star writer
// (exports/star.ts) renders the data-quality flags string into the star schema,
// so these stay reachable from the host via this barrel.
// The shared engine relocated to the @swao/publication-render leaf (#0582);
// re-exported through this barrel unchanged so host + test importers that reach
// these via '@swao/module-html-report' keep working.
export {
  evaluateDataQuality,
  buildDataQualityFlagsString,
  buildDataQualityBannerHtml,
} from '@swao/publication-render';
export type { DataQualityCondition } from '@swao/publication-render';

// Publication model + extractor surface (PII sanitiser, lens loader) re-exported
// for completeness; the publication-model contract is the module's public shape.
export { extractPublicationModel, sanitisePII, loadLensDefinition } from '@swao/publication-render';
export type { LensDefinition, SanitisePiiResult, PiiRedaction } from '@swao/publication-render';
export { PublicationModelSchema, CONTRACT_VERSION } from '@swao/publication-render';
export type { PublicationModel } from '@swao/publication-render';

// TUI screens contributed by this module (#0575). The host renders them via
// direct import today (App.tsx) and injects the SWAO version.
export { PublishScreen } from './tui/PublishScreen.js';
export { ServeScreen } from './tui/ServeScreen.js';

export const tuiScreens: TuiScreenContribution[] = [
  { name: 'PublishScreen', tier: 'community', component: PublishScreen },
  { name: 'ServeScreen', tier: 'community', component: ServeScreen },
];

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-html-report',
  version: '0.1.0',
  tier: 'community',
  contributions: {
    tuiScreens,
  },
};
