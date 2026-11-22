// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Application assessment, the passes a lens adds
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4499 (supersedes the replace rule of #1074): a lens ADDS its passes to the
// pass preselection of the app (its stored pass profile, else the TUI
// default); it never removes a pass, so a lens without `dynamic` no longer
// drops Pass 10 without a word. The run summary names the default passes the
// run left out (by the profile or by an untick), as the run manifest does.

import { DEFAULT_PASS_KEYS } from '../../orchestrator.js';

/** The pass preselection after the lenses: the base profile plus the lens passes (lower case, no duplicates). */
export function lensPassPreselection(base: readonly string[], lensPasses: readonly string[]): string[] {
  const norm = (p: string): string => p.trim().toLowerCase();
  if (base.some((p) => norm(p) === 'all')) return [...base];
  return [...new Set([...base.map(norm), ...lensPasses.map(norm)].filter((p) => p.length > 0))];
}

/** The passes of the default profile the selection leaves out (none when it runs all passes). */
export function passesLeftOut(selected: readonly string[], defaults: readonly string[] = DEFAULT_PASS_KEYS): string[] {
  const chosen = new Set(selected.map((p) => p.trim().toLowerCase()));
  if (chosen.has('all')) return [];
  // #3419: the full malware scan runs Gitleaks itself, so secrets is not left out when malware runs.
  if (chosen.has('malware')) chosen.add('secrets');
  return defaults.filter((p) => !chosen.has(p.toLowerCase()));
}
