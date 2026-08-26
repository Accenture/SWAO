// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Terraform module
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

import { GenerateTfScreen } from './tui/GenerateTfScreen.js';

/**
 * @swao/module-terraform -- the `generate-tf` command plus its GenerateTfScreen
 * (ADR-0048 modular architecture, Phase 5, #0578). Consultant tier.
 *
 * TF generation is not yet implemented; `generate-tf` is a tier-gated stub
 * today. The runtime gate is `guard.requireTier('consultant', { feature:
 * 'generate-tf' })` in generate-tf.ts (ADR-0049: tier-gating is runtime
 * requireTier; the command stays visible). This module adds no gating logic
 * beyond that gate; it declares `tier: 'consultant'` in the manifest below.
 *
 * The only host value the screen needs -- the SWAO version (branding is
 * host-only) -- is injected as the screen's `version` prop at the App.tsx call
 * site (the #0573 DoctorScreen dependency-injection pattern).
 */

// CLI command register fn. registerGenerateTf needs no host dependencies (it
// imports only @swao/core), so the host wires it directly from its index.ts
// bootstrap, mirroring the doctor module (which likewise exports its register
// fns for direct wiring rather than declaring a commands contribution).
export { registerGenerateTf } from './generate-tf.js';

// TUI screen contributed by this module (#0578). The host renders it via direct
// import today (App.tsx) and injects the SWAO version (branding is host-only).
export { GenerateTfScreen } from './tui/GenerateTfScreen.js';
export { LicenseGate, isAllowed } from '@swao/tui-kit';

export const tuiScreens: TuiScreenContribution[] = [
  { name: 'GenerateTfScreen', tier: 'consultant', component: GenerateTfScreen },
];

export const manifest: SwaoModuleManifest = {
  id: '@swao/module-terraform',
  version: '0.1.0',
  tier: 'consultant',
  contributions: {
    tuiScreens,
  },
};
