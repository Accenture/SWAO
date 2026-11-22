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

// #3590: tiers of the Landing Zone Live Assessment (Design 120 section 15,
// owner decision Q-07; licence tier matrix F-135 to F-139). One map from the
// live capability to its FEATURE_GATES key, so every surface (CLI, TUI, MCP)
// gates through the same call. The publication and the catalogue source reuse
// the existing keys of the features they extend.

import { LicenseTierError } from '@swao/core';
import type { FeatureKey, LicenseGuard } from '@swao/core';

export const LZ_LIVE_FEATURE_GATES = {
  connect: 'lz-live-connect',
  assess: 'lz-live-assess',
  publication: 'html-report',
  'catalogue-source-live': 'lz-catalogue-update',
  portfolio: 'lz-live-portfolio',
} as const satisfies Record<string, FeatureKey>;

export type LzLiveFeature = keyof typeof LZ_LIVE_FEATURE_GATES;

/** Throws LicenseTierError when the licence (capped by the binary tier) is below the feature's tier. */
export function requireLzLiveFeature(guard: Pick<LicenseGuard, 'requireFeature'>, feature: LzLiveFeature): void {
  guard.requireFeature(LZ_LIVE_FEATURE_GATES[feature]);
}

/**
 * #3844: a tier refusal exits 2 with the `[LICENSE]` block, ADR-0055 section 3
 * (owner decision 2026-11-05, option A: every tier refusal exits 2, also
 * printLicenseGateError, publish, lz catalogue update and the tier stubs).
 * Exit 2 is also used for an expired token or a refused endpoint or
 * recording location; 3 is an invalid licence file (`swao license`).
 */
export const LZ_LIVE_TIER_EXIT_CODE = 2;

const FEATURE_LABEL: Readonly<Record<string, string>> = {
  'lz-live-connect': 'swao lz connect, probe, list and remove (Landing Zone Live connections)',
  'lz-live-assess': 'swao assess --type landing-zone-live and swao lz scan (Landing Zone Live Assessment)',
  'lz-live-portfolio': 'swao assess --portfolio --type landing-zone-live (Landing Zone Live portfolio)',
};

const CONTACT_URL = 'https://github.com/Accenture/SWAO/discussions';

/** The `[LICENSE]` block for a refused live capability (same text shape as printLicenseGateError). */
export function formatLzLiveTierRefusal(err: LicenseTierError): string {
  const article = err.required === 'enterprise' ? 'an' : 'a';
  const label = err.required.charAt(0).toUpperCase() + err.required.slice(1);
  const feature = (err.feature !== undefined ? FEATURE_LABEL[err.feature] : undefined) ?? err.feature ?? 'This feature';
  return [
    `[LICENSE] ${feature} requires ${article} ${label} licence.`,
    `Your current tier: ${err.current}`,
    '',
    `To upgrade: swao license request --tier ${err.required}`,
    `Contact: ${CONTACT_URL}`,
  ].join('\n');
}

/** Exit code and message of a live CLI failure: the `[LICENSE]` block for a tier refusal, else the error's own. */
export function lzLiveFailure(err: unknown): { code: number; message: string } {
  if (err instanceof LicenseTierError) return { code: LZ_LIVE_TIER_EXIT_CODE, message: formatLzLiveTierRefusal(err) };
  const code = (err as { exitCode?: unknown }).exitCode;
  return { code: typeof code === 'number' && code > 0 ? code : 1, message: err instanceof Error ? err.message : String(err) };
}
