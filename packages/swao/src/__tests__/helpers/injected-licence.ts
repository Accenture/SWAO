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

/**
 * Test-signed licence injection for binary / journey E2E tests (#3335, #3337).
 *
 * Writes into a sandbox HOME (the HOME / USERPROFILE / LOCALAPPDATA / APPDATA
 * the harness passes to the child):
 *   - .swao-state.json   fixed fingerprint, fp_version 2 (no hardware read)
 *   - <app data>/swao/licence.json   a licence signed for that fingerprint
 *
 * Signing seed: the `seed` argument, else SWAO_LICENSE_SECRET (the per-process
 * test seed of src/__tests__/setup.ts under vitest), else a fresh ephemeral
 * Ed25519 key (Playwright journeys, which have no vitest setup).
 *
 * IMPORTANT: a test-signed licence verifies only where licence-guard honours
 * SWAO_LICENSE_PUBLIC_KEY_HEX_TEST, i.e. NODE_ENV === 'test'. The SWAO entry
 * points (src/index.ts and the tier entries) force NODE_ENV = 'production' at
 * start-up, so the pkg binary and `node dist/index.js` verify only against the
 * baked-in production public key and refuse a test-signed licence ("License
 * key signature is invalid"). Callers therefore probe with
 * probeLicensedTier() and skip with a stated reason when the child refuses the
 * licence; they never fake a tier. Production-signed keys are issued only on
 * the admin machine (the private licence tooling) and are never used by
 * tests.
 *
 * Node built-ins only, so Playwright specs (tests/e2e) can import it too.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type InjectedTier = 'consultant' | 'enterprise';

/** Fingerprint written to the sandbox state file and signed into the licence. */
export const INJECTED_FINGERPRINT = 'e2e0123456789abc';

// RFC 8410 PKCS8 prefix for a raw 32-byte Ed25519 seed (public constant).
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface InjectedLicence {
  home: string;
  licencePath: string;
  statePath: string;
  fingerprint: string;
  tier: InjectedTier;
  /** Hex public key that verifies the licence (for SWAO_LICENSE_PUBLIC_KEY_HEX_TEST). */
  publicKeyHex: string;
}

/** Env that points every licence / state lookup of a child process at `home`. */
export function sandboxEnv(home: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    HOME: home, USERPROFILE: home, HOMEDRIVE: '', HOMEPATH: '',
    LOCALAPPDATA: home, APPDATA: home, XDG_CONFIG_HOME: join(home, '.config'),
  };
}

/** Licence file path licence-guard resolves for a sandbox `home` on this platform. */
export function sandboxLicencePath(home: string): string {
  if (process.platform === 'win32') return join(home, 'swao', 'licence.json');
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'swao', 'licence.json');
  return join(home, '.config', 'swao', 'licence.json');
}

function publicHex(key: ReturnType<typeof createPublicKey>): string {
  // SPKI DER ends with the 32-byte Ed25519 point.
  return (key.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32).toString('hex');
}

function signingKey(seed?: string): { privateKey: ReturnType<typeof createPrivateKey>; publicKeyHex: string } {
  const b64 = seed ?? process.env['SWAO_LICENSE_SECRET'];
  if (b64) {
    const raw = Buffer.from(b64, 'base64url');
    if (raw.length !== 32) throw new Error('injected-licence: signing seed must decode to 32 bytes');
    const privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, raw]), format: 'der', type: 'pkcs8' });
    return { privateKey, publicKeyHex: publicHex(createPublicKey(privateKey)) };
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKeyHex: publicHex(publicKey) };
}

/**
 * Write a test-signed licence of `tier` (and the matching state file) into
 * the sandbox `home`. Same key format as LicenseGuard / the private licence tooling:
 * `<base64url payload>.<base64url Ed25519 signature over the payload text>`.
 */
export function injectTestLicence(home: string, tier: InjectedTier = 'enterprise', seed?: string): InjectedLicence {
  const { privateKey, publicKeyHex } = signingKey(seed);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    v: 2, tier, licensee: 'SWAO E2E', email: 'e2e@example.invalid',
    exp: '2099-12-31', assessment_limit: null, fp: INJECTED_FINGERPRINT, iat: today,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(null, Buffer.from(payloadB64, 'utf-8'), privateKey).toString('base64url');
  const licencePath = sandboxLicencePath(home);
  mkdirSync(join(licencePath, '..'), { recursive: true });
  writeFileSync(licencePath, JSON.stringify({
    key: `${payloadB64}.${sig}`, activated_at: today, tier, exp: payload.exp, licensee: payload.licensee,
  }, null, 2), 'utf-8');
  const statePath = join(home, '.swao-state.json');
  writeFileSync(statePath, JSON.stringify({
    first_run: today, assessment_count: 0, fingerprint: INJECTED_FINGERPRINT, fp_version: 2,
  }, null, 2), 'utf-8');
  return { home, licencePath, statePath, fingerprint: INJECTED_FINGERPRINT, tier, publicKeyHex };
}

/** Reason the licensed binary cases skip when the child refuses the injected licence. */
export const TEST_LICENCE_REFUSED_REASON =
  'the SWAO binary verifies licences only against the baked-in production public key ' +
  "(src/index.ts sets NODE_ENV = 'production' at start-up, so licence-guard ignores " +
  'SWAO_LICENSE_PUBLIC_KEY_HEX_TEST); a test-signed licence is refused by design and ' +
  'tests never use production-signed keys';

/**
 * Licensed tier the child reports with the injected licence, or null when it
 * refuses the licence. `licenseStatusOutput` is the combined output of
 * `swao license status` run with sandboxEnv(home).
 */
export function probeLicensedTier(licenseStatusOutput: string): InjectedTier | null {
  if (/signature is invalid|different machine|Invalid licen[cs]e/i.test(licenseStatusOutput)) return null;
  if (/\bEnterprise\b/.test(licenseStatusOutput)) return 'enterprise';
  if (/\bConsultant\b/.test(licenseStatusOutput)) return 'consultant';
  return null;
}
