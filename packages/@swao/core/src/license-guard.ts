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

import { createHash, sign as edSign, verify as edVerify, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir, hostname, platform } from 'node:os';
import { join } from 'node:path';

// Build-time constants -- must match the values in @swao/swao's branding.ts.
// Rotated via `node scripts/license/generate-keypair.mjs`; both files updated atomically.
const SWAO_CONTACTS_INLINE = 'https://github.com/Accenture/SWAO/discussions';
const SWAO_LICENSE_PUBLIC_KEY_HEX = 'e2a608d9dc7b5b8fad9b68527f720dbe885da8b6b205f73e49e4355f55c2b8fe';

// M18 successor scheme (v2, Ed25519, 2026-05-17). Replaces the previous
// HMAC-SHA256 design (#0271). Verification uses a baked-in Ed25519 public
// key; only key issuance requires the operator's private seed in
// `SWAO_LICENSE_SECRET`. End users (no env var) can load and use an
// Enterprise licence verifiable against the baked-in public key alone.

// Exported so tests can override paths without mocking node:os
export const _paths = {
  statePath: join(homedir(), '.swao-state.json'),
  licensePath: join(homedir(), '.swao-license.json'),
};

export type LicenseTier = 'community' | 'consultant' | 'enterprise';

const TIER_ORDER: Record<LicenseTier, number> = { community: 0, consultant: 1, enterprise: 2 };

/**
 * Authoritative feature-to-tier registry (golden standard: docs/strategy/swao-feature-tier-matrix.docx).
 * Use requireFeature(key) at call sites instead of inline requireTier strings to keep the tier
 * assignment in one place and make audits diff-readable.
 */
export const FEATURE_GATES = {
  'llm-assessment':       'community',  // DOCX: all tiers; ungated
  'portfolio-assess':     'enterprise',
  'pdf-report':           'consultant',
  'html-report':          'consultant',
  'html-editor':          'enterprise', // D-06 (2026-07-26): upgraded from consultant
  'html-portal':          'enterprise',
  'challenge':            'enterprise',
  'lz-catalogue-update':  'consultant',
  'bi-export':            'enterprise',
  'mcp-server':           'enterprise',
  'portfolio-report':     'enterprise',
} as const satisfies Record<string, LicenseTier>;

export type FeatureKey = keyof typeof FEATURE_GATES;

// #1560: binary tier cap -- caps the effective licence tier to the binary's
// own tier. Each tier entry (community.ts, consultant.ts, src/index.ts) sets
// the SWAO_BINARY_TIER env var before any command runs. Without this cap a
// Community or Consultant binary granted an Enterprise licence will accept all
// Enterprise feature gates, which defeats the purpose of separate tier binaries.
function binaryTierCap(licenceTier: LicenseTier): LicenseTier {
  const cap = process.env['SWAO_BINARY_TIER'];
  if (!cap || !(cap in TIER_ORDER)) return licenceTier;
  return TIER_ORDER[cap as LicenseTier] < TIER_ORDER[licenceTier]
    ? (cap as LicenseTier)
    : licenceTier;
}

/**
 * Normalise a raw tier string into the canonical vocabulary (ADR-0049).
 * Maps the legacy names (`standard` -> `consultant`, `premium` ->
 * `enterprise`) so a licence signed before the rename still surfaces under
 * the new tier; passes `community | consultant | enterprise` through
 * unchanged; defaults anything unknown to `community` (defensive -- an
 * unrecognised tier must never grant more than the free tier).
 *
 * NB: this is applied AFTER signature verification. The bytes that get
 * signed / verified are untouched; only the loaded `LicenseState.tier`
 * is normalised.
 */
export function normalizeTier(raw: string): LicenseTier {
  switch (raw) {
    case 'standard':
      return 'consultant';
    case 'premium':
      return 'enterprise';
    case 'community':
    case 'consultant':
    case 'enterprise':
      return raw;
    default:
      return 'community';
  }
}

export interface LicenseState {
  tier: LicenseTier;
  fingerprint: string;
  firstRun: string;
  /** Lifetime counter. Increments on every successful `swao assess`.
   *  Informational on Community; gate input on Consultant/Enterprise when
   *  `assessmentLimit` is a positive integer. */
  assessmentCount: number;
  /** Days since first run. Informational. The Community cap was dropped
   *  in M18 (decision D-05 revised 2026-05-17); this field is no longer
   *  used for any enforcement. */
  daysElapsed: number;
  /** Assessment-count budget from the active licence payload. `null` or
   *  `undefined` means no count limit (Community always; Enterprise when
   *  the payload sets it to `null`). */
  assessmentLimit?: number | null;
  exp?: string;
  licensee?: string;
  email?: string;
  /** Organisation name from the licence payload, when supplied at
   *  issuance time. Drives branded report headers (M18 #0276). */
  organisation?: string;
}

export class LicenseTierError extends Error {
  constructor(
    readonly required: LicenseTier,
    readonly current: LicenseTier,
    readonly feature?: string,
    readonly hint?: string,
  ) {
    super(
      `${feature ? `Feature "${feature}" requires` : 'This feature requires'} a ${required} license (current: ${current}).`,
    );
    this.name = 'LicenseTierError';
  }
}

/**
 * Raised when a licensed user has hit the assessment-count budget
 * carried in their licence payload (M18 issue #0273). Community users
 * are never blocked by this error -- they have no budget to exhaust.
 */
export class LicenseLimitError extends Error {
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super(
      `License assessment budget reached: ${used}/${limit}. ` +
      `Renew your license to continue: contact ${SWAO_CONTACTS_INLINE}.`,
    );
    this.name = 'LicenseLimitError';
  }
}

export class LicenseInvalidError extends Error {
  constructor(
    message: string,
    readonly code: 'fingerprint_mismatch' | 'signature_invalid' | 'expired',
  ) {
    super(message);
    this.name = 'LicenseInvalidError';
  }
}

// ---- internal state file helpers ----

interface StateFile {
  first_run: string;
  assessment_count: number;
  fingerprint: string;
}

function computeFingerprint(firstRun: string): string {
  // W-01 (soft binding): the fingerprint is SHA256(hostname + platform + firstRun)[0..16].
  // None of these inputs are hardware-bound -- hostname is freely changeable and
  // firstRun is a plain JSON field. A licensee can copy ~/.swao-state.json to a
  // second machine and set the hostname to match; the fingerprint will be identical.
  // This is accepted for the B2B launch context: abuse is a contractual matter, not
  // a technical one. A hardware-bound binding (TPM / MAC address set) is tracked as
  // a future hardening item in Design 062 section 11. See #1232 W-01.
  return createHash('sha256')
    .update(hostname() + platform() + firstRun)
    .digest('hex')
    .substring(0, 16);
}

function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function readStateFile(): StateFile {
  if (!existsSync(_paths.statePath)) {
    const firstRun = new Date().toISOString().slice(0, 10);
    const fingerprint = computeFingerprint(firstRun);
    const state: StateFile = { first_run: firstRun, assessment_count: 0, fingerprint };
    writeFileSync(_paths.statePath, JSON.stringify(state, null, 2), 'utf-8');
    return state;
  }
  return JSON.parse(readFileSync(_paths.statePath, 'utf-8')) as StateFile;
}

function writeStateFile(state: StateFile): void {
  writeFileSync(_paths.statePath, JSON.stringify(state, null, 2), 'utf-8');
}

// ---- license file helpers ----

interface LicenseFile {
  key: string;
  activated_at: string;
  tier: LicenseTier;
  exp: string;
  licensee: string;
}

interface LicensePayload {
  v: number;
  tier: LicenseTier;
  licensee: string;
  email?: string;
  /** Organisation name from the issuing operator. Optional; when set, used
   *  by `swao report` to brand Consultant / Enterprise report headers (M18
   *  issue #0276). */
  organisation?: string;
  exp: string;
  /** Per-licence assessment-count budget. `null` means unlimited. */
  assessment_limit: number | null;
  fp: string;
  iat: string;
}

function stripDisplayHyphens(key: string): string {
  // Display key format: SWAO-XXXXXXXX-XXXXXXXX.YYYYYYYY-YYYYYYYY
  // Only strip cosmetic hyphens when the SWAO- prefix is present.
  // Raw keys (no prefix) must pass through unchanged -- base64url uses '-' legitimately.
  if (!key.startsWith('SWAO-')) return key;
  const withoutPrefix = key.slice(5);
  const dotIdx = withoutPrefix.indexOf('.');
  if (dotIdx < 0) return key;
  // Position-based deChunk: only remove '-' at chunk-boundary positions (i % 9 === 8).
  // Chunk separator hyphens land at positions 8, 17, 26, ... in the chunked segment.
  // Base64url '-' chars within 8-char chunks land at positions where i % 9 !== 8 -- kept.
  const deChunk = (seg: string): string =>
    Array.from(seg).filter((ch, i) => !(ch === '-' && i % 9 === 8)).join('');
  return `${deChunk(withoutPrefix.slice(0, dotIdx))}.${deChunk(withoutPrefix.slice(dotIdx + 1))}`;
}

// Ed25519 DER prefixes for converting raw 32-byte seed / 32-byte point
// to PKCS8 / SPKI formats that node:crypto.createPrivateKey / createPublicKey
// accept. These are RFC 8032 / RFC 8410 constants -- not secrets.
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex'); // private-key DER prefix (16 bytes)
const ED25519_SPKI_PREFIX  = Buffer.from('302a300506032b6570032100', 'hex');         // public-key DER prefix  (12 bytes)

function signingPrivateSeed(): Buffer {
  // The Ed25519 signing seed is base64url-encoded in `SWAO_LICENSE_SECRET`
  // (32 bytes -> 43 chars). Operators set this when issuing keys; end
  // users do not need it. Missing or malformed env -> fatal at issuance
  // time only.
  const fromEnv = process.env['SWAO_LICENSE_SECRET'];
  if (!fromEnv || fromEnv.length === 0) {
    throw new Error(
      'SWAO_LICENSE_SECRET is not set. ' +
      'Issuing licences requires the Ed25519 private seed (base64url, 43 chars) ' +
      'from the Accenture password manager (see swao-premium/secrets/README.md). ' +
      'End users do not need this env var -- verification uses the public key baked into the binary.',
    );
  }
  const seed = Buffer.from(fromEnv, 'base64url');
  if (seed.length !== 32) {
    throw new Error(
      `SWAO_LICENSE_SECRET must decode to 32 bytes (Ed25519 seed). Got ${seed.length} bytes. ` +
      'Verify the value in swao-premium/secrets/.env matches the password manager entry.',
    );
  }
  return seed;
}

function publicKeyHex(): string {
  // Production: use the baked-in constant. Tests: allow an override so
  // setup.ts can generate a fresh keypair per run without re-signing all
  // fixtures. The override is honoured only when NODE_ENV === 'test',
  // closing the door on production tampering.
  if (process.env['NODE_ENV'] === 'test') {
    const override = process.env['SWAO_LICENSE_PUBLIC_KEY_HEX_TEST'];
    if (override && override.length === 64) return override;
  }
  return SWAO_LICENSE_PUBLIC_KEY_HEX;
}

function publicKey(): ReturnType<typeof createPublicKey> {
  const pubBytes = Buffer.from(publicKeyHex(), 'hex');
  if (pubBytes.length !== 32) {
    throw new Error(
      `Licence public key must be exactly 32 bytes (64 hex chars). Got ${pubBytes.length}.`,
    );
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, pubBytes]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function privateKeyFromSeed(seed: Buffer): ReturnType<typeof createPrivateKey> {
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function verifyKey(rawKey: string, localFp: string): LicensePayload {
  const normalized = stripDisplayHyphens(rawKey);
  const dotIdx = normalized.indexOf('.');
  if (dotIdx < 0) throw new LicenseInvalidError(
    'Malformed license key: missing dot separator.\n\n' +
    'A signed license key has the form <payload>.<signature> (two dot-separated parts).\n' +
    'If you pasted a request token (base64url string starting with "eyJ", no dots),\n' +
    'that is what you send to the SWAO operator -- not the activation key.\n' +
    'Wait for the operator to return the signed key by email, then run:\n' +
    '  swao license activate <signed-key>',
    'signature_invalid',
  );

  const payloadB64 = normalized.slice(0, dotIdx);
  const sigB64 = normalized.slice(dotIdx + 1);

  const message   = Buffer.from(payloadB64, 'utf-8');
  const signature = Buffer.from(sigB64, 'base64url');

  let valid: boolean;
  try {
    // Ed25519 verify: null algorithm, raw message, public key, raw signature.
    valid = edVerify(null, message, publicKey(), signature);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new LicenseInvalidError(
      `License key signature is invalid. Contact ${SWAO_CONTACTS_INLINE}.`,
      'signature_invalid',
    );
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as LicensePayload;

  if (localFp.substring(0, 8) !== payload.fp) {
    throw new LicenseInvalidError(
      [
        'This license key was issued for a different machine.',
        `Your machine fingerprint: ${localFp.substring(0, 8)}`,
        `Key fingerprint:          ${payload.fp}`,
        `Contact ${SWAO_CONTACTS_INLINE}`,
        'to request a replacement key for your machine.',
      ].join('\n'),
      'fingerprint_mismatch',
    );
  }

  return payload;
}

// ---- public API ----

export class LicenseGuard {
  private constructor(readonly state: LicenseState) {}

  static load(): LicenseGuard {
    const stateFile = readStateFile();
    const today = new Date().toISOString().slice(0, 10);
    const daysElapsed = daysBetween(stateFile.first_run, today);
    const fp = stateFile.fingerprint;
    const count = stateFile.assessment_count;

    // Try to load license file
    if (existsSync(_paths.licensePath)) {
      const licenseFile = JSON.parse(readFileSync(_paths.licensePath, 'utf-8')) as LicenseFile;

      const payload: LicensePayload = verifyKey(licenseFile.key, fp);

      const isExpired = new Date(payload.exp).getTime() < new Date(today).getTime();
      if (isExpired) {
        // Expired licence drops to plain Community (no grace period
        // since the Community cap was removed in M18 D-05 revised).
        return new LicenseGuard({
          tier: 'community',
          fingerprint: fp,
          firstRun: stateFile.first_run,
          assessmentCount: count,
          daysElapsed,
          exp: payload.exp,
          licensee: payload.licensee,
          email: payload.email,
        });
      }

      return new LicenseGuard({
        // ADR-0049: the signature is verified over the raw payload bytes
        // above (verifyKey); only AFTER that succeeds do we normalise the
        // tier string into the canonical vocabulary. A licence signed with
        // the legacy `standard`/`premium` names still verifies (bytes
        // unchanged) and then surfaces as `consultant`/`enterprise`.
        tier: binaryTierCap(normalizeTier(payload.tier)),
        fingerprint: fp,
        firstRun: stateFile.first_run,
        assessmentCount: count,
        daysElapsed,
        assessmentLimit: payload.assessment_limit,
        exp: payload.exp,
        licensee: payload.licensee,
        email: payload.email,
        ...(payload.organisation ? { organisation: payload.organisation } : {}),
      });
    }

    return new LicenseGuard({
      tier: 'community',
      fingerprint: fp,
      firstRun: stateFile.first_run,
      assessmentCount: count,
      daysElapsed,
    });
  }

  requireTier(required: LicenseTier, opts?: { feature?: string; message?: string; hint?: string }): void {
    const current = this.state.tier;
    if (TIER_ORDER[current] < TIER_ORDER[required]) {
      throw new LicenseTierError(required, current, opts?.feature, opts?.hint);
    }
  }

  /** Named gate using the FEATURE_GATES registry -- prefer over inline requireTier strings. */
  requireFeature(key: FeatureKey): void {
    this.requireTier(FEATURE_GATES[key], { feature: key });
  }

  /**
   * Hard-block when a licensed user has reached their per-licence
   * assessment-count budget (M18 issue #0273). No-op for:
   *   - Community users (no `assessmentLimit` in state)
   *   - Enterprise / Consultant users with `assessment_limit: null` (unlimited)
   */
  guardAssessmentBudget(): void {
    const limit = this.state.assessmentLimit;
    if (limit == null) return;
    if (this.state.assessmentCount >= limit) {
      throw new LicenseLimitError(this.state.assessmentCount, limit);
    }
  }

  incrementAssessmentCount(): void {
    const stateFile = readStateFile();
    stateFile.assessment_count += 1;
    writeStateFile(stateFile);
  }

  /**
   * Returns just the machine fingerprint, without attempting to verify
   * any licence file. Useful for `swao license request` where we only
   * need the fingerprint to bind the request token to this machine.
   */
  static fingerprint(): string {
    return readStateFile().fingerprint;
  }

  static activate(rawKey: string): LicensePayload {
    const stateFile = readStateFile();
    const fp = stateFile.fingerprint;

    const payload = verifyKey(rawKey, fp);

    const today = new Date().toISOString().slice(0, 10);
    if (new Date(payload.exp).getTime() < new Date(today).getTime()) {
      throw new LicenseInvalidError(
        `License key expired on ${payload.exp}. Contact ${SWAO_CONTACTS_INLINE} for renewal.`,
        'expired',
      );
    }

    const licenseFile = {
      key: rawKey,
      activated_at: today,
      tier: payload.tier,
      exp: payload.exp,
      licensee: payload.licensee,
    };
    writeFileSync(_paths.licensePath, JSON.stringify(licenseFile, null, 2), 'utf-8');

    return payload;
  }
}

// buildLicenseKey is a standalone function so esbuild can tree-shake it out of
// production bundles.  Class methods cannot be tree-shaken; a standalone export
// is excluded when no production entry point imports it.
// This function is used by tests only (license-issue.ts and per-module test
// helpers call it to generate ephemeral keys against the test keypair).
// The operator-side equivalent lives in swao-premium/lib/license-admin.mjs.
export function buildLicenseKey(payload: LicensePayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const message    = Buffer.from(payloadB64, 'utf-8');
  const seed       = signingPrivateSeed();
  const sig        = edSign(null, message, privateKeyFromSeed(seed)).toString('base64url');
  return `${payloadB64}.${sig}`;
}

export { LicensePayload };
