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

// Tier-gate stubs for commands whose module is absent from a lower-tier bundle
// (#1652, #1787, #2089, #3321, #3323). The stub keeps the command name
// discoverable and prints the standard [LICENSE] block with exit 2 instead of
// Commander's "unknown command" error. The required tier always comes from
// FEATURE_GATES (the SWAO licence tier matrix),
// never from an inline string, so a tier change cannot leave a stale message.

import type { Command } from 'commander';
import { FEATURE_GATES, type FeatureKey, type LicenseTier } from '@swao/core';

const CONTACT_URL = 'https://github.com/Accenture/SWAO/discussions';

/** "Consultant or Enterprise" / "Enterprise" for the tier a feature needs. */
export function tierPhrase(tier: LicenseTier): string {
  switch (tier) {
    case 'community': return 'Community';
    case 'consultant': return 'Consultant or Enterprise';
    case 'enterprise': return 'Enterprise';
  }
}

/** Help-text suffix for a feature key: "(Consultant+)" or "(Enterprise)". */
export function tierLabel(key: FeatureKey): string {
  const tier = FEATURE_GATES[key];
  return tier === 'consultant' ? '(Consultant+)' : tier === 'enterprise' ? '(Enterprise)' : '(Community)';
}

/** The [LICENSE] block a stub prints for `label` gated by FEATURE_GATES[key]. */
export function tierStubMessage(label: string, key: FeatureKey): string {
  const tier = FEATURE_GATES[key];
  const article = tier === 'enterprise' ? 'an' : 'a';
  return (
    `[LICENSE] ${label} requires ${article} ${tierPhrase(tier)} licence.\n` +
    `To upgrade: swao license request --tier ${tier}\n` +
    `Contact: ${CONTACT_URL}`
  );
}

export interface LicenceStubSpec {
  /** Command name registered on `parent`. */
  name: string;
  alias?: string;
  /** Description without the tier suffix; the suffix comes from FEATURE_GATES. */
  description: string;
  /** Human label in the [LICENSE] line, e.g. "swao generate-tf". */
  label: string;
  key: FeatureKey;
}

/**
 * Register a gated stub command on `parent` (the program or a command group).
 * `.helpOption(false)` + `.allowUnknownOption(true)` + `.allowExcessArguments(true)`
 * let `--help`, any flag and any positional reach the action, so the
 * [LICENSE] block always prints (#1851, #1853).
 */
export function registerLicenceStub(parent: Command, spec: LicenceStubSpec): Command {
  const cmd = parent
    .command(spec.name)
    .description(`${spec.description} ${tierLabel(spec.key)}`)
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(() => {
      console.error(tierStubMessage(spec.label, spec.key));
      process.exit(2);
    });
  if (spec.alias) cmd.alias(spec.alias);
  return cmd;
}
