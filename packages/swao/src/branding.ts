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

// Centralised SWAO contact / landing-page / version constants
// (#0221, #0222, #0237). Every operator-facing surface that quotes an
// upgrade contact, "learn more" URL, or product version must import
// from here -- prevents drift between the TUI, CLI error messages,
// and docs.

// Kept as a literal so release-version-consistency.gate.mjs can parse it.
// bump-version.mjs updates this constant in lockstep with package.json.
export const SWAO_VERSION = '0.11.2';

export const SWAO_LANDING_URL = 'https://accenture.github.io/SWAO/en/';

export const SWAO_CONTACTS = [
  'https://github.com/Accenture/SWAO/discussions',
  'https://github.com/Accenture/SWAO/issues',
] as const;

export const SWAO_CONTACTS_INLINE = SWAO_CONTACTS.join(' / ');

// Three-line block suitable for CLI license-gate stderr output.
export function licenseContactLines(prefix: string = ''): string[] {
  return [
    `${prefix}Contact: ${SWAO_CONTACTS_INLINE}`,
    `${prefix}More info: ${SWAO_LANDING_URL}`,
  ];
}

// ---------------------------------------------------------------------------
// SWAO licensing crypto -- M18 successor scheme (v2, Ed25519, 2026-05-17).
//
// Before this constant existed, licences used HMAC-SHA256 with a shared
// `SWAO_LICENSE_SECRET` env var that operators AND end users had to load.
// That symmetric design forced every licence verification to require the
// signing secret in env, which made the operator/end-user separation
// impossible.
//
// We now use Ed25519:
//   - Operators have the 32-byte Ed25519 private seed in
//     SWAO_LICENSE_SECRET (base64url-encoded) when issuing keys.
//   - End users have no env var; the binary verifies with the public key
//     baked in below.
//
// Rotating the public key requires a new binary build + re-issuing every
// active licence. Treat as a build-time constant per release line. The
// next-generation key should be generated via
// `node scripts/license/generate-keypair.mjs` which writes the seed to
// secrets/.env without printing it, and prints only the public key for
// pasting here.
export const SWAO_LICENSE_PUBLIC_KEY_HEX =
  'e2a608d9dc7b5b8fad9b68527f720dbe885da8b6b205f73e49e4355f55c2b8fe';

