// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Canonical template re-export for backwards compatibility (D2 -- #0931).
 *
 * The single source of truth for the default Level 1 HTML shell now lives in
 * `../template.ts` as `PUBLICATION_TEMPLATE`. This file re-exports it as
 * `BUNDLED_TEMPLATE_CONTENT` so existing consumers (@swao/module-html-portal,
 * @swao/module-html-report editor/server.ts) require no import-site changes.
 *
 * The editor now uses the identical production template as its base, so editor
 * previews show the same page chrome (header, sidebar, breadcrumb) as the
 * publication output by `swao publish` (Design 068 §20.11.1 D2).
 */

export { PUBLICATION_TEMPLATE as BUNDLED_TEMPLATE_CONTENT } from '../template.js';
