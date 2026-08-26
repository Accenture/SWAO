// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Power BI module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type {
  SwaoModuleManifest,
  TuiScreenContribution,
} from '@swao/core';

import { ExportBiScreen } from './tui/ExportBiScreen.js';

/**
 * @swao/module-powerbi -- the `export` command (CSV star schema + NDJSON + XLSX
 * bundle for PowerBI) plus its ExportBiScreen and the bundled .pbit PowerBI
 * templates (ADR-0048 modular architecture, Phase 5, #0577). Community tier.
 *
 * BI export is ungated -- the .pbit templates are public artefacts -- so this
 * module declares `tier: 'community'` and adds NO new tier gate. The only tier
 * gate lives in export.ts: the runtime `requireTier('enterprise', { feature:
 * 'export --portfolio' })` on the `--portfolio` flag, which gates the portfolio
 * data emission (not the template file). The --portfolio extraction itself is a
 * separate effort (#0579); this module moves export.ts wholesale with the flag +
 * gate intact.
 *
 * The only host value the screen needs -- the SWAO version (branding is
 * host-only) -- is injected as the screen's `version` prop at the App.tsx call
 * site (the #0573 DoctorScreen dependency-injection pattern).
 */

// CLI command register fn. registerExport imports only @swao/core (LicenseGuard
// for the --portfolio gate) + the leaf star writers, so the host wires it
// directly from its index.ts bootstrap, mirroring the doctor / terraform modules.
export { registerExport } from './export.js';

// Star-schema writers. The host's bi-probe.test.ts (which stays host-side because
// it pairs the doctor probe with these writers) imports them from this barrel;
// portfolio-export-bypass.mjs reads the built dist copy directly.
export {
  writeStarExport,
  writeNdjsonExport,
  writePortfolioStarExport,
  writeXlsxExport,
  buildPortfolioIndex,
} from './exports/star.js';
export type {
  ExportContext,
  PortfolioExportContext,
  PortfolioApp,
  ManifestFile,
  ExportManifest,
  WriteStarResult,
  WritePortfolioStarResult,
  PortfolioIndex,
  PortfolioIndexApp,
  PortfolioStarTables,
} from './exports/star.js';

// TUI screen contributed by this module (#0577). The host renders it via direct
// import today (App.tsx) and injects the SWAO version (branding is host-only).
export { ExportBiScreen } from './tui/ExportBiScreen.js';

export const tuiScreens: TuiScreenContribution[] = [
  { name: 'ExportBiScreen', tier: 'community', component: ExportBiScreen },
];

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-powerbi',
  version: '0.1.0',
  tier: 'community',
  contributions: {
    tuiScreens,
  },
};
