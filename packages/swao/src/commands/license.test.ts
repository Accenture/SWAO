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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { _paths, LicenseGuard, LicenseInvalidError, buildLicenseKey } from '../license/license-guard.js';
import type { LicensePayload, LicenseTier } from '../license/license-guard.js';
import { licenseStateToJson, buildRequestToken, buildRequestLines } from './license.js';
import { issueLicense } from './license-issue.js';

const TEMP_HOME = join(tmpdir(), `swao-license-cmd-test-${process.pid}`);

beforeEach(() => {
  mkdirSync(TEMP_HOME, { recursive: true });
  _paths.statePath = join(TEMP_HOME, '.swao-state.json');
  _paths.licensePath = join(TEMP_HOME, '.swao-license.json');
  if (existsSync(_paths.statePath)) rmSync(_paths.statePath);
  if (existsSync(_paths.licensePath)) rmSync(_paths.licensePath);
});

afterEach(() => {
  rmSync(TEMP_HOME, { recursive: true, force: true });
});

function writeState(data: object): void {
  writeFileSync(_paths.statePath, JSON.stringify(data), 'utf-8');
}

function writeLicenseKey(payload: LicensePayload): void {
  const key = buildLicenseKey(payload);
  writeFileSync(_paths.licensePath, JSON.stringify({ key, activated_at: '2026-04-28', tier: payload.tier, exp: payload.exp, licensee: payload.licensee }), 'utf-8');
}

describe('licenseStateToJson -- Community (M18 D-05 revised: no cap)', () => {
  it('returns community tier JSON without assessmentLimit field', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 18, fingerprint: 'abc123def456abc1' });
    const state = LicenseGuard.load().state;
    const json = licenseStateToJson(state);
    expect(json.tier).toBe('community');
    expect(json.assessmentCount).toBe(18);
    expect(json.assessmentLimit).toBeUndefined();
    expect(json.valid).toBe(true);
  });

  it('Community remains valid even with very high assessment count', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 100, fingerprint: 'abc123def456abc1' });
    const state = LicenseGuard.load().state;
    const json = licenseStateToJson(state);
    expect(json.valid).toBe(true);
  });

  it('Community remains valid even after many days elapsed', () => {
    writeState({ first_run: '2025-01-01', assessment_count: 0, fingerprint: 'abc123def456abc1' });
    const state = LicenseGuard.load().state;
    const json = licenseStateToJson(state);
    expect(json.valid).toBe(true);
  });
});

describe('licenseStateToJson -- Licensed', () => {
  it('returns consultant tier JSON when valid consultant key present', () => {
    const guard0 = LicenseGuard.load();
    const fp = guard0.state.fingerprint.substring(0, 8);
    writeLicenseKey({ v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com', exp: '2027-12-31', assessment_limit: null, fp, iat: '2026-04-28' });
    const state = LicenseGuard.load().state;
    const json = licenseStateToJson(state);
    expect(json.tier).toBe('consultant');
    expect(json.assessmentLimit).toBeNull();
    expect(json.valid).toBe(true);
    expect(json.licensee).toBe('Accenture');
    expect(json.exp).toBe('2027-12-31');
  });

  it('Consultant with budget reached -- valid:false', () => {
    const guard0 = LicenseGuard.load();
    const fp = guard0.state.fingerprint.substring(0, 8);
    writeState({ first_run: '2026-04-28', assessment_count: 5, fingerprint: guard0.state.fingerprint });
    writeLicenseKey({ v: 1, tier: 'consultant', licensee: 'Test', exp: '2027-12-31', assessment_limit: 5, fp, iat: '2026-04-28' });
    const state = LicenseGuard.load().state;
    const json = licenseStateToJson(state);
    expect(json.assessmentLimit).toBe(5);
    expect(json.assessmentCount).toBe(5);
    expect(json.valid).toBe(false);
  });
});

describe('buildRequestToken', () => {
  it('returns a valid base64url token with correct fields', () => {
    const token = buildRequestToken('abc123def456abc1', 'consultant');
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    expect(decoded.v).toBe(1);
    expect(decoded.type).toBe('license_request');
    expect(decoded.fp).toBe('abc123de');
    expect(decoded.requested_tier).toBe('consultant');
    expect(decoded.iat).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('truncates fingerprint to 8 chars', () => {
    const token = buildRequestToken('ffffffffffffffff', 'enterprise');
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    expect(decoded.fp).toBe('ffffffff');
    expect(decoded.requested_tier).toBe('enterprise');
  });
});

describe('buildRequestLines', () => {
  it('contains To/CC addresses and tier in the email template', () => {
    const token = buildRequestToken('abc123def456abc1', 'consultant');
    const lines = buildRequestLines(token, 'abc123def456abc1', 'consultant');
    const text = lines.join('\n');
    expect(text).toContain('github.com/Accenture/SWAO');
    expect(text).toContain('github.com/Accenture/SWAO');
    expect(text).toContain('consultant');
    expect(text).toContain(token);
    expect(text).toContain('abc123de');
  });

  it('prints Enterprise label for enterprise tier', () => {
    const token = buildRequestToken('abc123def456abc1', 'enterprise');
    const lines = buildRequestLines(token, 'abc123def456abc1', 'enterprise');
    const text = lines.join('\n');
    expect(text).toContain('Enterprise');
  });
});

describe('LicenseGuard.activate', () => {
  function buildPayload(overrides: Partial<LicensePayload> = {}): LicensePayload {
    const fp = LicenseGuard.load().state.fingerprint.substring(0, 8);
    return {
      v: 1,
      tier: 'consultant',
      licensee: 'Test Org',
      email: 'test@example.com',
      exp: '2027-12-31',
      assessment_limit: null,
      fp,
      iat: '2026-04-28',
      ...overrides,
    };
  }

  it('writes license file and returns payload for a valid raw key', () => {
    const payload = buildPayload();
    const rawKey = buildLicenseKey(payload);
    const result = LicenseGuard.activate(rawKey);
    expect(result.tier).toBe('consultant');
    expect(result.licensee).toBe('Test Org');
    const written = JSON.parse(readFileSync(_paths.licensePath, 'utf-8'));
    expect(written.tier).toBe('consultant');
    expect(written.exp).toBe('2027-12-31');
  });

  it('activates a display-format SWAO-XXX... key (cosmetic hyphens stripped)', () => {
    const payload = buildPayload();
    const rawKey = buildLicenseKey(payload);
    const [payloadPart, sigPart] = rawKey.split('.');
    const displayKey = `SWAO-${payloadPart.match(/.{1,8}/g)?.join('-')}.${sigPart.match(/.{1,8}/g)?.join('-')}`;
    const result = LicenseGuard.activate(displayKey);
    expect(result.tier).toBe('consultant');
  });

  it('throws LicenseInvalidError(expired) for an expired key', () => {
    const payload = buildPayload({ exp: '2020-01-01' });
    const rawKey = buildLicenseKey(payload);
    expect(() => LicenseGuard.activate(rawKey)).toThrow(LicenseInvalidError);
    try {
      LicenseGuard.activate(rawKey);
    } catch (e) {
      expect((e as LicenseInvalidError).code).toBe('expired');
    }
  });

  it('throws LicenseInvalidError(signature_invalid) for a tampered key', () => {
    const payload = buildPayload();
    const rawKey = buildLicenseKey(payload);
    // Tamper the FIRST character of the signature segment (after the dot).
    // Replacing the last char risks landing in base64url padding bits (lower
    // 4 bits zero-padded) which decode identically and don't invalidate the sig.
    const dotIdx = rawKey.lastIndexOf('.');
    const sigStart = dotIdx + 1;
    const firstSigChar = rawKey[sigStart];
    const tampered = rawKey.slice(0, sigStart) + (firstSigChar === 'a' ? 'b' : 'a') + rawKey.slice(sigStart + 1);
    expect(() => LicenseGuard.activate(tampered)).toThrow(LicenseInvalidError);
    try {
      LicenseGuard.activate(tampered);
    } catch (e) {
      expect((e as LicenseInvalidError).code).toBe('signature_invalid');
    }
  });

  it('throws LicenseInvalidError(fingerprint_mismatch) for a wrong-machine key', () => {
    const payload = buildPayload({ fp: '00000000' });
    const rawKey = buildLicenseKey(payload);
    expect(() => LicenseGuard.activate(rawKey)).toThrow(LicenseInvalidError);
    try {
      LicenseGuard.activate(rawKey);
    } catch (e) {
      expect((e as LicenseInvalidError).code).toBe('fingerprint_mismatch');
    }
  });
});

// ---------------------------------------------------------------------------
// issueLicense (M18 #0274) -- pure-function tests covering tier defaults,
// validation, and round-trip through LicenseGuard.activate.
// ---------------------------------------------------------------------------

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoTodayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('issueLicense -- Consultant tier defaults', () => {
  it('omitting --exp on Consultant defaults to today + 365 days', () => {
    const result = issueLicense({
      tier: 'consultant',
      licensee: 'Test User',
      email: 'test@example.com',
      fp: 'deadbeef',
    });
    expect(result.payload.tier).toBe('consultant');
    expect(result.payload.exp).toBe(isoTodayPlusDays(365));
  });

  it('omitting --assessment-limit on Consultant defaults to 500', () => {
    const result = issueLicense({
      tier: 'consultant',
      licensee: 'Test User',
      email: 'test@example.com',
      fp: 'deadbeef',
    });
    expect(result.payload.assessment_limit).toBe(500);
  });

  it('payload iat is today', () => {
    const result = issueLicense({
      tier: 'consultant',
      licensee: 'Test User',
      email: 'test@example.com',
      fp: 'deadbeef',
    });
    expect(result.payload.iat).toBe(isoToday());
  });

  // #0612: the operator registry tool (swao-premium/scripts/issue-license.mjs)
  // parses exactly `{ key, payload }` from `swao license issue --json`. Pin that
  // contract so a future refactor cannot silently break the registry pipeline.
  it('returns exactly { key, payload } with the registry-consumed payload fields', () => {
    const result = issueLicense({
      tier: 'consultant',
      licensee: 'Test User',
      email: 'test@example.com',
      fp: 'deadbeef',
    });
    expect(Object.keys(result).sort()).toEqual(['key', 'payload']);
    expect(typeof result.key).toBe('string');
    for (const field of ['tier', 'licensee', 'email', 'exp', 'assessment_limit', 'fp', 'iat'] as const) {
      expect(result.payload).toHaveProperty(field);
    }
  });
});

describe('issueLicense -- Enterprise tier defaults', () => {
  it('omitting --exp on Enterprise throws an explicit error', () => {
    expect(() => issueLicense({
      tier: 'enterprise',
      licensee: 'Engagement Lead',
      email: 'lead@client.example',
      fp: 'deadbeef',
    })).toThrowError(/Enterprise licences require an explicit --exp/);
  });

  it('omitting --assessment-limit on Enterprise defaults to 2000', () => {
    const result = issueLicense({
      tier: 'enterprise',
      licensee: 'Engagement Lead',
      email: 'lead@client.example',
      fp: 'deadbeef',
      exp: isoTodayPlusDays(180),
    });
    expect(result.payload.assessment_limit).toBe(2000);
  });
});

describe('issueLicense -- overrides + edge cases', () => {
  it('explicit --assessment-limit overrides the default', () => {
    const result = issueLicense({
      tier: 'consultant',
      licensee: 'Test', email: 'test@example.com', fp: 'deadbeef',
      assessmentLimit: 50,
    });
    expect(result.payload.assessment_limit).toBe(50);
  });

  it('--assessment-limit null produces an unlimited payload', () => {
    const result = issueLicense({
      tier: 'enterprise',
      licensee: 'Test', email: 'test@example.com', fp: 'deadbeef',
      exp: isoTodayPlusDays(180),
      assessmentLimit: null,
    });
    expect(result.payload.assessment_limit).toBeNull();
  });

  it('--organisation is carried into the payload', () => {
    const result = issueLicense({
      tier: 'consultant',
      licensee: 'Test', email: 'test@example.com', fp: 'deadbeef',
      organisation: 'Acme Corp',
    });
    expect(result.payload.organisation).toBe('Acme Corp');
  });

  it('empty --organisation string is omitted from the payload', () => {
    const result = issueLicense({
      tier: 'consultant',
      licensee: 'Test', email: 'test@example.com', fp: 'deadbeef',
      organisation: '   ',
    });
    expect(result.payload.organisation).toBeUndefined();
  });
});

describe('issueLicense -- validation failures', () => {
  it('rejects invalid tier', () => {
    expect(() => issueLicense({
      tier: 'community' as unknown as LicenseTier,
      licensee: 'X', email: 'x@example.com', fp: 'deadbeef',
    })).toThrowError(/Invalid --tier/);
  });

  it('rejects malformed fingerprint (length)', () => {
    expect(() => issueLicense({
      tier: 'consultant', licensee: 'X', email: 'x@example.com',
      fp: 'deadbe',
    })).toThrowError(/Invalid --fp/);
  });

  it('rejects malformed fingerprint (non-hex)', () => {
    expect(() => issueLicense({
      tier: 'consultant', licensee: 'X', email: 'x@example.com',
      fp: 'XXXXXXXX',
    })).toThrowError(/Invalid --fp/);
  });

  it('rejects past --exp', () => {
    expect(() => issueLicense({
      tier: 'consultant', licensee: 'X', email: 'x@example.com', fp: 'deadbeef',
      exp: '2020-01-01',
    })).toThrowError(/must be in the future/);
  });

  it('rejects malformed --exp', () => {
    expect(() => issueLicense({
      tier: 'consultant', licensee: 'X', email: 'x@example.com', fp: 'deadbeef',
      exp: '2027/05/17',
    })).toThrowError(/Expected YYYY-MM-DD/);
  });

  it('rejects zero --assessment-limit', () => {
    expect(() => issueLicense({
      tier: 'consultant', licensee: 'X', email: 'x@example.com', fp: 'deadbeef',
      assessmentLimit: 0,
    })).toThrowError(/positive integer/);
  });

  it('rejects negative --assessment-limit', () => {
    expect(() => issueLicense({
      tier: 'consultant', licensee: 'X', email: 'x@example.com', fp: 'deadbeef',
      assessmentLimit: -5,
    })).toThrowError(/positive integer/);
  });

  it('rejects empty licensee', () => {
    expect(() => issueLicense({
      tier: 'consultant', licensee: '   ', email: 'x@example.com', fp: 'deadbeef',
    })).toThrowError(/--licensee is required/);
  });

  it('rejects empty email', () => {
    expect(() => issueLicense({
      tier: 'consultant', licensee: 'X', email: '   ', fp: 'deadbeef',
    })).toThrowError(/--email is required/);
  });
});

// ---------------------------------------------------------------------------
// E2E: request token -> issue -> activate round-trip (docs/strategy/015)
// Exercises the full three-step operator workflow in a single test:
//   1. user generates a request token (swao license request)
//   2. admin issues a key (swao license issue --json / issue-license.mjs)
//   3. user activates the key (swao license activate <key>)
// No external process, network, or SWAO_LICENSE_SECRET needed -- LicenseGuard
// uses the in-memory test keypair baked into @swao/core.
// ---------------------------------------------------------------------------
describe('E2E: request token -> issue -> activate round-trip', () => {
  it('simulates the full user-to-admin-to-user flow for a Consultant licence', () => {
    const guard0 = LicenseGuard.load();
    const fp16 = guard0.state.fingerprint;

    // Step 1: user machine -- generate request token (swao license request)
    const token = buildRequestToken(fp16, 'consultant');
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    expect(decoded.type).toBe('license_request');
    expect(decoded.fp).toBe(fp16.slice(0, 8));

    // Step 2: admin -- issue key (swao license issue --json / issue-license.mjs)
    const issued = issueLicense({
      tier: 'consultant',
      licensee: 'E2E Test User',
      email: 'e2e@example.com',
      fp: decoded.fp,
    });
    expect(typeof issued.key).toBe('string');
    expect(issued.payload.tier).toBe('consultant');

    // Step 3: user machine -- activate key (swao license activate <key>)
    const activated = LicenseGuard.activate(issued.key);
    expect(activated.tier).toBe('consultant');
    expect(activated.licensee).toBe('E2E Test User');

    // Loaded state must reflect the newly activated licence
    const reloaded = LicenseGuard.load();
    expect(reloaded.state.tier).toBe('consultant');
  });

  it('enterprise round-trip: fp from token matches signed payload', () => {
    const guard0 = LicenseGuard.load();
    const fp16 = guard0.state.fingerprint;
    const token = buildRequestToken(fp16, 'enterprise');
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));

    const issued = issueLicense({
      tier: 'enterprise',
      licensee: 'Enterprise Org',
      email: 'ent@example.com',
      fp: decoded.fp,
      exp: isoTodayPlusDays(365),
      organisation: 'Acme GmbH',
    });
    expect(issued.payload.tier).toBe('enterprise');
    expect(issued.payload.fp).toBe(decoded.fp);

    const activated = LicenseGuard.activate(issued.key);
    expect(activated.tier).toBe('enterprise');
    expect(activated.licensee).toBe('Enterprise Org');
  });

  it('display-format key from E2E issue round-trips through activate', () => {
    const fp16 = LicenseGuard.load().state.fingerprint;
    const issued = issueLicense({
      tier: 'consultant',
      licensee: 'Display Key Test',
      email: 'dk@example.com',
      fp: fp16.slice(0, 8),
    });
    // Convert to display format (SWAO- prefix + 8-char chunks)
    const [payloadPart, sigPart] = issued.key.split('.');
    const displayKey = `SWAO-${payloadPart.match(/.{1,8}/g)?.join('-')}.${sigPart.match(/.{1,8}/g)?.join('-')}`;
    expect(displayKey.startsWith('SWAO-')).toBe(true);
    const activated = LicenseGuard.activate(displayKey);
    expect(activated.tier).toBe('consultant');
  });
});

describe('issueLicense -- round-trip through LicenseGuard.activate', () => {
  it('issued key activates and surfaces tier + budget in state', () => {
    // The activating machine must have the matching fingerprint; we use
    // the test home's fingerprint and feed it back to issueLicense.
    const fp = LicenseGuard.load().state.fingerprint.substring(0, 8);
    const result = issueLicense({
      tier: 'consultant',
      licensee: 'Round-trip Test',
      email: 'rt@example.com',
      organisation: 'Test Org',
      fp,
      assessmentLimit: 42,
    });
    const payload = LicenseGuard.activate(result.key);
    expect(payload.tier).toBe('consultant');
    expect(payload.licensee).toBe('Round-trip Test');
    expect(payload.organisation).toBe('Test Org');
    expect(payload.assessment_limit).toBe(42);

    const state = LicenseGuard.load().state;
    expect(state.tier).toBe('consultant');
    expect(state.assessmentLimit).toBe(42);
  });

  it('unlimited issued key surfaces assessmentLimit null in state', () => {
    const fp = LicenseGuard.load().state.fingerprint.substring(0, 8);
    const result = issueLicense({
      tier: 'enterprise',
      licensee: 'Enterprise Round-trip',
      email: 'p@example.com',
      fp,
      exp: isoTodayPlusDays(180),
      assessmentLimit: null,
    });
    LicenseGuard.activate(result.key);
    const state = LicenseGuard.load().state;
    expect(state.tier).toBe('enterprise');
    expect(state.assessmentLimit).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Legacy-tier normalisation on load (ADR-0049). A licence signed with the
// legacy `premium` tier before the rename must still verify (its bytes are
// unchanged) and then surface as the canonical `enterprise` after load. The
// payload is constructed with a cast because LicensePayload.tier no longer
// admits the legacy names at the type level; the bytes that get signed /
// verified are untouched.
// ---------------------------------------------------------------------------

describe('legacy-tier normalisation on load (ADR-0049)', () => {
  it('a legacy `premium` payload verifies then surfaces as `enterprise`', () => {
    const fp = LicenseGuard.load().state.fingerprint.substring(0, 8);
    // Sign a payload carrying the legacy tier name. buildKey signs the raw
    // serialised payload (legacy bytes); load() runs the verified tier
    // through normalizeTier afterwards.
    const legacyPayload = {
      v: 1,
      tier: 'premium' as unknown as LicenseTier, // legacy input
      licensee: 'Legacy Co',
      email: 'legacy@example.com',
      exp: '2027-12-31',
      assessment_limit: null,
      fp,
      iat: '2026-04-28',
    } satisfies Omit<LicensePayload, 'tier'> & { tier: LicenseTier };
    writeLicenseKey(legacyPayload);

    const state = LicenseGuard.load().state;
    expect(state.tier).toBe('enterprise');
  });

  it('a legacy `standard` payload verifies then surfaces as `consultant`', () => {
    const fp = LicenseGuard.load().state.fingerprint.substring(0, 8);
    const legacyPayload = {
      v: 1,
      tier: 'standard' as unknown as LicenseTier, // legacy input
      licensee: 'Legacy Co',
      email: 'legacy@example.com',
      exp: '2027-12-31',
      assessment_limit: null,
      fp,
      iat: '2026-04-28',
    } satisfies Omit<LicensePayload, 'tier'> & { tier: LicenseTier };
    writeLicenseKey(legacyPayload);

    const state = LicenseGuard.load().state;
    expect(state.tier).toBe('consultant');
  });
});

// ---------------------------------------------------------------------------
// buildRequestToken / buildRequestLines extras (M18 #0281)
// ---------------------------------------------------------------------------

describe('buildRequestToken -- extras', () => {
  it('includes requested_duration_days when set', () => {
    const token = buildRequestToken('abc123de', 'consultant', { durationDays: 730 });
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    expect(decoded.requested_duration_days).toBe(730);
  });

  it('includes requested_assessment_limit when set to a positive integer', () => {
    const token = buildRequestToken('abc123de', 'consultant', { assessmentLimit: 1000 });
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    expect(decoded.requested_assessment_limit).toBe(1000);
  });

  it('preserves explicit null (unlimited) in the payload', () => {
    const token = buildRequestToken('abc123de', 'enterprise', { assessmentLimit: null });
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    expect(decoded.requested_assessment_limit).toBeNull();
  });

  it('omits both fields when extras object is empty (backward compatible)', () => {
    const token = buildRequestToken('abc123de', 'consultant');
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    expect(decoded.requested_duration_days).toBeUndefined();
    expect(decoded.requested_assessment_limit).toBeUndefined();
  });
});

describe('buildRequestLines -- extras in email template', () => {
  it('renders duration and budget in the email when extras supplied', () => {
    const token = buildRequestToken('abc123de', 'consultant', { durationDays: 730, assessmentLimit: 1000 });
    const lines = buildRequestLines(token, 'abc123de', 'consultant', { durationDays: 730, assessmentLimit: 1000 });
    const text = lines.join('\n');
    expect(text).toContain('Requested duration: 730 days');
    expect(text).toContain('Requested budget: 1000 assessments');
  });

  it('renders "unlimited" for null assessmentLimit', () => {
    const token = buildRequestToken('abc123de', 'enterprise', { assessmentLimit: null });
    const lines = buildRequestLines(token, 'abc123de', 'enterprise', { assessmentLimit: null });
    const text = lines.join('\n');
    expect(text).toContain('Requested budget: unlimited');
  });

  it('omits the duration / budget lines entirely when extras are absent', () => {
    const token = buildRequestToken('abc123de', 'consultant');
    const lines = buildRequestLines(token, 'abc123de', 'consultant');
    const text = lines.join('\n');
    expect(text).not.toContain('Requested duration');
    expect(text).not.toContain('Requested budget');
  });
});
