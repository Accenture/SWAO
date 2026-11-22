// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { providerLabel } from './provider-names.js';

/**
 * Brand label of a landing-zone provider id for human-readable text (badges,
 * headings, matrix headers, CLI and MCP lines). The id stays the technical
 * key in every machine-readable field; only the label is human text. #4005:
 * one function for the publications (re-exported by publication-render), the
 * CLI and MCP lines. #4296: delegates to the central provider name map
 * (provider-names.ts) and renders the abbreviation plus the full name, so
 * `otc` reads "OTC, T Cloud Public" and `stackit` "STACKIT".
 */
export function lzProviderBrand(provider: string): string {
  return providerLabel(provider, 'pair');
}
