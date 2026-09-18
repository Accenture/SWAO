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

// #2184: shared helpers for consistent [LICENSE] gate output across all CLI commands.
// Previously each command file contained ad-hoc console.error blocks with inconsistent
// wording.  These helpers are the single authoritative format.

import type { LicenseTier } from '@swao/core';
import type { LicenseLimitError } from '@swao/core';
import { logPortfolio } from '@swao/core';

const CONTACT_URL = 'https://github.com/Accenture/SWAO/discussions';

/**
 * Print a tier-gate error to stderr and exit 1.
 *
 * Output format:
 *   [LICENSE] <feature> requires a/an <Required> licence.
 *   Your current tier: <current>
 *
 *   To upgrade: swao license request --tier <required>
 *   Contact: https://github.com/Accenture/SWAO/discussions
 */
export function printLicenseGateError(
  feature: string,
  required: LicenseTier,
  current: LicenseTier,
): never {
  const article = required === 'enterprise' ? 'an' : 'a';
  const label = required.charAt(0).toUpperCase() + required.slice(1);
  console.error(
    `[LICENSE] ${feature} requires ${article} ${label} licence.\n` +
    `Your current tier: ${current}\n` +
    `\n` +
    `To upgrade: swao license request --tier ${required}\n` +
    `Contact: ${CONTACT_URL}`,
  );
  try { logPortfolio('error', 'licence.gate.error', `${feature} requires ${article} ${label} licence`, { context: { feature, required, current, code: 1 } }); } catch { /* best-effort */ }
  process.exit(1);
}

/**
 * Print a licence budget-exhaustion error to stderr and exit 2.
 * Use when a LicenseLimitError is caught.
 */
export function printLicenseLimitError(err: LicenseLimitError): never {
  console.error(`[LICENSE] ${err.message}\nContact: ${CONTACT_URL}`);
  try { logPortfolio('error', 'licence.limit.error', err.message, { context: { limit: err.limit, used: err.used, code: 2 } }); } catch { /* best-effort */ }
  process.exit(2);
}

/**
 * Print an invalid-licence error to stderr and exit 3.
 * Use when a LicenseInvalidError is caught.
 */
export function printLicenseInvalidError(message: string): never {
  console.error(`[LICENSE] Invalid licence: ${message}`);
  try { logPortfolio('error', 'licence.invalid.error', `Invalid licence: ${message}`, { context: { reason: message, code: 3 } }); } catch { /* best-effort */ }
  process.exit(3);
}
