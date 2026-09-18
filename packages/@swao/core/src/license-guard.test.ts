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

// Unit and integration tests for license-guard.ts.
//
// Covers three areas:
//   1. normalizeTier -- pure string mapping (ADR-0049)
//   2. Crypto / verification round-trips using the ephemeral keypair set by
//      src/__tests__/setup.ts (SWAO_LICENSE_SECRET + SWAO_LICENSE_PUBLIC_KEY_HEX_TEST).
//      Exercises verifyKey(), buildLicenseKey(), LicenseGuard.load(), and
//      LicenseGuard.activate() against temp-dir state and licence files.
//   3. Feature gate enforcement (requireFeature / requireTier / FEATURE_GATES).

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, hostname, platform } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  _paths,
  LicenseGuard,
  buildLicenseKey,
  LicenseInvalidError,
  LicenseTierError,
  FEATURE_GATES,
  normalizeTier,
} from './license-guard.js';

// --- helpers ---

// Mirror computeFingerprint() in license-guard.ts.
const FIRST_RUN = '2020-01-01';
const fp16 = createHash('sha256').update(hostname() + platform() + FIRST_RUN).digest('hex').substring(0, 16);
const fp8  = fp16.substring(0, 8); // goes into key payload.fp

// Build a minimal valid LicensePayload object. Callers can override fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePayload(overrides: Record<string, any> = {}): Parameters<typeof buildLicenseKey>[0] {
  return {
    v: 1,
    tier: 'enterprise',
    licensee: 'Test Licensee',
    exp: '2099-12-31',
    assessment_limit: null,
    fp: fp8,
    iat: FIRST_RUN,
    ...overrides,
  } as Parameters<typeof buildLicenseKey>[0];
}

function writeStateFile(tmpDir: string): void {
  writeFileSync(_paths.statePath, JSON.stringify({
    first_run: FIRST_RUN,
    assessment_count: 0,
    fingerprint: fp16,
  }, null, 2), 'utf-8');
}

function writeLicenceFile(rawKey: string): void {
  // _paths.licensePath is set in beforeEach; create the directory first.
  mkdirSync(join(_paths.licensePath, '..'), { recursive: true });
  const payload = JSON.parse(
    Buffer.from(rawKey.split('.')[0], 'base64url').toString('utf-8'),
  );
  writeFileSync(_paths.licensePath, JSON.stringify({
    key: rawKey,
    activated_at: FIRST_RUN,
    tier: payload.tier,
    exp: payload.exp,
    licensee: payload.licensee,
  }, null, 2), 'utf-8');
}

// --- test lifecycle ---

let tmpDir: string;
const savedPaths = { ...{ statePath: _paths.statePath, licensePath: _paths.licensePath, legacyLicencePath: _paths.legacyLicencePath } };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'swao-lic-test-'));
  _paths.statePath        = join(tmpDir, '.swao-state.json');
  _paths.licensePath      = join(tmpDir, 'licence', 'licence.json');
  _paths.legacyLicencePath = join(tmpDir, 'nonexistent-legacy.json');
  writeStateFile(tmpDir);
  // Ensure SWAO_BINARY_TIER is unset so tests see the licence tier directly.
  delete process.env['SWAO_BINARY_TIER'];
});

afterEach(() => {
  _paths.statePath         = savedPaths.statePath;
  _paths.licensePath       = savedPaths.licensePath;
  _paths.legacyLicencePath = savedPaths.legacyLicencePath;
  rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// 1. normalizeTier (ADR-0049)
// ============================================================

describe('normalizeTier (ADR-0049)', () => {
  it('maps the legacy `standard` to `consultant`', () => {
    expect(normalizeTier('standard')).toBe('consultant');
  });

  it('maps the legacy `premium` to `enterprise`', () => {
    expect(normalizeTier('premium')).toBe('enterprise');
  });

  it('passes `community` through unchanged', () => {
    expect(normalizeTier('community')).toBe('community');
  });

  it('passes the canonical `consultant` through unchanged', () => {
    expect(normalizeTier('consultant')).toBe('consultant');
  });

  it('passes the canonical `enterprise` through unchanged', () => {
    expect(normalizeTier('enterprise')).toBe('enterprise');
  });

  it('defaults any unknown value to `community` (defensive: never grant more than free)', () => {
    expect(normalizeTier('platinum')).toBe('community');
    expect(normalizeTier('')).toBe('community');
    expect(normalizeTier('STANDARD')).toBe('community'); // case-sensitive by design
  });
});

// ============================================================
// 2. Crypto / verification round-trips
// ============================================================

describe('LicenseGuard.load() -- no licence file', () => {
  it('returns community tier when no licence.json exists', () => {
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('community');
    expect(guard.state.fingerprint).toBe(fp16);
  });
});

describe('LicenseGuard.load() -- valid licence', () => {
  it('returns enterprise tier for a valid enterprise licence', () => {
    const rawKey = buildLicenseKey(makePayload({ tier: 'enterprise' }));
    writeLicenceFile(rawKey);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('enterprise');
    expect(guard.state.licensee).toBe('Test Licensee');
  });

  it('returns consultant tier for a valid consultant licence', () => {
    const rawKey = buildLicenseKey(makePayload({ tier: 'consultant' }));
    writeLicenceFile(rawKey);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('consultant');
  });

  it('normalises legacy `premium` tier to `enterprise` after verification', () => {
    const rawKey = buildLicenseKey(makePayload({ tier: 'premium' }));
    writeLicenceFile(rawKey);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('enterprise');
  });

  it('normalises legacy `standard` tier to `consultant` after verification', () => {
    const rawKey = buildLicenseKey(makePayload({ tier: 'standard' }));
    writeLicenceFile(rawKey);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('consultant');
  });
});

describe('LicenseGuard.load() -- expired licence', () => {
  it('silently downgrades to community when licence is expired (exp in the past)', () => {
    const rawKey = buildLicenseKey(makePayload({ exp: '2020-01-02' }));
    writeLicenceFile(rawKey);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('community');
    // exp is preserved on the guard so status screen can still display it
    expect(guard.state.exp).toBe('2020-01-02');
  });

  it('does NOT throw on expired licence -- downgrade is silent', () => {
    const rawKey = buildLicenseKey(makePayload({ exp: '2020-06-15' }));
    writeLicenceFile(rawKey);
    expect(() => LicenseGuard.load()).not.toThrow();
  });
});

describe('LicenseGuard.load() -- fingerprint mismatch', () => {
  it('throws LicenseInvalidError when the key fp does not match the machine', () => {
    const rawKey = buildLicenseKey(makePayload({ fp: 'deadbeef' }));
    writeLicenceFile(rawKey);
    expect(() => LicenseGuard.load()).toThrow(LicenseInvalidError);
  });

  it('includes fingerprint_mismatch code in the thrown error', () => {
    const rawKey = buildLicenseKey(makePayload({ fp: 'ffffffff' }));
    writeLicenceFile(rawKey);
    try {
      LicenseGuard.load();
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as LicenseInvalidError).code).toBe('fingerprint_mismatch');
    }
  });
});

describe('LicenseGuard.load() -- corrupted / malformed key', () => {
  it('throws LicenseInvalidError when the signature bytes are corrupted', () => {
    const rawKey = buildLicenseKey(makePayload());
    const dotIdx = rawKey.indexOf('.');
    // Flip the first character of the signature part.
    const corrupted = rawKey.slice(0, dotIdx + 1) + (rawKey[dotIdx + 1] === 'A' ? 'B' : 'A') + rawKey.slice(dotIdx + 2);
    writeLicenceFile(corrupted);
    expect(() => LicenseGuard.load()).toThrow(LicenseInvalidError);
  });

  it('throws LicenseInvalidError with signature_invalid code for a corrupted key', () => {
    const rawKey = buildLicenseKey(makePayload());
    const dotIdx = rawKey.indexOf('.');
    const corrupted = rawKey.slice(0, dotIdx + 1) + (rawKey[dotIdx + 1] === 'A' ? 'B' : 'A') + rawKey.slice(dotIdx + 2);
    writeLicenceFile(corrupted);
    try {
      LicenseGuard.load();
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as LicenseInvalidError).code).toBe('signature_invalid');
    }
  });

  it('throws LicenseInvalidError for a key with no dot separator', () => {
    // Write the licence file directly; writeLicenceFile requires a valid payload.sig form.
    mkdirSync(join(_paths.licensePath, '..'), { recursive: true });
    writeFileSync(_paths.licensePath, JSON.stringify({
      key: 'nodotbase64urlpayload',
      activated_at: FIRST_RUN,
      tier: 'enterprise',
      exp: '2099-12-31',
      licensee: 'Test',
    }, null, 2), 'utf-8');
    expect(() => LicenseGuard.load()).toThrow(LicenseInvalidError);
  });
});

describe('LicenseGuard.activate()', () => {
  it('writes licence.json and returns the payload for a valid key', () => {
    const rawKey = buildLicenseKey(makePayload({ tier: 'enterprise' }));
    const result = LicenseGuard.activate(rawKey);
    expect(result.tier).toBe('enterprise');
    expect(result.licensee).toBe('Test Licensee');
    expect(existsSync(_paths.licensePath)).toBe(true);
    const written = JSON.parse(readFileSync(_paths.licensePath, 'utf-8'));
    expect(written.key).toBe(rawKey);
    expect(written.tier).toBe('enterprise');
  });

  it('throws LicenseInvalidError with code "expired" for an expired key', () => {
    const rawKey = buildLicenseKey(makePayload({ exp: '2020-01-01' }));
    try {
      LicenseGuard.activate(rawKey);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LicenseInvalidError);
      expect((err as LicenseInvalidError).code).toBe('expired');
    }
  });

  it('throws LicenseInvalidError with code "fingerprint_mismatch" for a wrong-fp key', () => {
    const rawKey = buildLicenseKey(makePayload({ fp: 'cafecafe' }));
    try {
      LicenseGuard.activate(rawKey);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LicenseInvalidError);
      expect((err as LicenseInvalidError).code).toBe('fingerprint_mismatch');
    }
  });

  it('throws LicenseInvalidError with code "signature_invalid" for a corrupted key', () => {
    const rawKey = buildLicenseKey(makePayload());
    const dotIdx = rawKey.indexOf('.');
    const corrupted = rawKey.slice(0, dotIdx + 1) + (rawKey[dotIdx + 1] === 'A' ? 'B' : 'A') + rawKey.slice(dotIdx + 2);
    try {
      LicenseGuard.activate(corrupted);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LicenseInvalidError);
      expect((err as LicenseInvalidError).code).toBe('signature_invalid');
    }
  });
});

// ============================================================
// 3. Feature gate enforcement
// ============================================================

describe('FEATURE_GATES registry', () => {
  it('contains only valid tier values for every key', () => {
    const validTiers = new Set(['community', 'consultant', 'enterprise']);
    for (const [key, tier] of Object.entries(FEATURE_GATES)) {
      expect(validTiers.has(tier), `FEATURE_GATES['${key}'] = '${tier}' is not a valid LicenseTier`).toBe(true);
    }
  });

  it('bi-export is enterprise-gated', () => {
    expect(FEATURE_GATES['bi-export']).toBe('enterprise');
  });

  it('pdf-report is consultant-gated', () => {
    expect(FEATURE_GATES['pdf-report']).toBe('consultant');
  });

  it('llm-assessment is ungated (community)', () => {
    expect(FEATURE_GATES['llm-assessment']).toBe('community');
  });
});

describe('LicenseGuard.requireFeature()', () => {
  it('does not throw when the guard tier meets the feature requirement', () => {
    const rawKey = buildLicenseKey(makePayload({ tier: 'enterprise' }));
    writeLicenceFile(rawKey);
    const guard = LicenseGuard.load();
    expect(() => guard.requireFeature('bi-export')).not.toThrow();
    expect(() => guard.requireFeature('pdf-report')).not.toThrow();
    expect(() => guard.requireFeature('llm-assessment')).not.toThrow();
  });

  it('throws LicenseTierError for a community guard accessing a consultant feature', () => {
    const guard = LicenseGuard.load(); // no licence file -> community
    expect(() => guard.requireFeature('pdf-report')).toThrow(LicenseTierError);
  });

  it('throws LicenseTierError for a consultant guard accessing an enterprise feature', () => {
    const rawKey = buildLicenseKey(makePayload({ tier: 'consultant' }));
    writeLicenceFile(rawKey);
    const guard = LicenseGuard.load();
    expect(() => guard.requireFeature('bi-export')).toThrow(LicenseTierError);
  });

  it('throws LicenseTierError for an expired guard (downgraded to community) accessing a paid feature', () => {
    const rawKey = buildLicenseKey(makePayload({ tier: 'enterprise', exp: '2020-01-02' }));
    writeLicenceFile(rawKey);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('community');
    expect(() => guard.requireFeature('pdf-report')).toThrow(LicenseTierError);
  });
});

describe('LicenseGuard binary tier cap', () => {
  it('caps an enterprise licence to consultant when SWAO_BINARY_TIER=consultant', () => {
    process.env['SWAO_BINARY_TIER'] = 'consultant';
    const rawKey = buildLicenseKey(makePayload({ tier: 'enterprise' }));
    writeLicenceFile(rawKey);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('consultant');
    delete process.env['SWAO_BINARY_TIER'];
  });

  it('does not cap when the licence tier is already at or below the binary tier', () => {
    process.env['SWAO_BINARY_TIER'] = 'enterprise';
    const rawKey = buildLicenseKey(makePayload({ tier: 'consultant' }));
    writeLicenceFile(rawKey);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('consultant');
    delete process.env['SWAO_BINARY_TIER'];
  });
});
