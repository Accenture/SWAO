// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  HTML portal module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { SwaoModuleManifest } from '@swao/core';

/**
 * @swao/module-html-portal -- the Consultant-tier HTML Portal (ADR-0048 modular
 * architecture, Sprint 064 #0582 module-split stage 2; Design 058 D-PORTAL-1).
 *
 * Owns the multi-page portfolio portal: the live data view over the workspace
 * (buildPortalSite / portal-builder), the Mode B per-app static-site builder
 * (buildModeBSite / site-builder), and the coming-soon live portal server
 * (createPortalServer / server.ts). Every page is assembled through the SAME
 * @swao/publication-render leaf pipeline the single-page publication uses, so
 * style + content parity with the publication is structural (D-PORTAL-4).
 *
 * WHY a separate Consultant module: Design 058 D-PORTAL-1 splits the portal out
 * of the Community @swao/module-html-report so the `publish --site` portal is
 * gated to Consultant while the Community single-page publication + Publication
 * Editor stay in html-report. This module depends ONLY on @swao/core +
 * @swao/publication-render (+ leaf npm: fastify family for the server); it never
 * imports the Community sibling. The Community `publish` command reaches
 * buildPortalSite by host injection (the host wires it into registerPublish),
 * mirroring how createLlmProvider is injected into registerChallenge.
 *
 * This module registers NO CLI command of its own: the portal is the host's
 * `swao publish --site` (injected), so the CLI surface set is unchanged.
 */

// HTML Portal builder (the live multi-page portfolio view). buildPortalSite is
// the entry point the host injects into registerPublish for `publish --site`.
export { buildPortalSite } from './portal-builder.js';
export type {
  BuildPortalSiteOptions,
  BuildPortalSiteResult,
} from './portal-builder.js';

// Mode B per-app static-site builder (the portal's per-app page builder).
export { buildModeBSite } from './site-builder.js';
export type {
  BuildModeBSiteOptions,
  BuildModeBSiteResult,
} from './site-builder.js';

// Live portal server (coming soon -- #0438). The host may inject createPortalServer
// into registerPublish when `--serve` is wired; exposed here for that wiring.
export { createPortalServer } from './server.js';
export type { PortalOptions, PortalServer, PiiDepth } from './server.js';

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-html-portal',
  version: '0.1.0',
  tier: 'consultant',
  contributions: {},
};
