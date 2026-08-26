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
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  LicenseGuard,
  LicenseTierError,
  LicenseLimitError,
  LicenseInvalidError,
  _paths,
  buildLicenseKey,
} from './license-guard.js';
import type { LicensePayload } from './license-guard.js';

const TEMP_HOME = join(tmpdir(), `swao-license-test-${process.pid}`);

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

function writeLicense(payload: LicensePayload): void {
  const key = buildLicenseKey(payload);
  writeFileSync(_paths.licensePath, JSON.stringify({
    key,
    activated_at: new Date().toISOString().slice(0, 10),
    tier: payload.tier,
    exp: payload.exp,
    licensee: payload.licensee,
  }), 'utf-8');
}

function getFp8(): string {
  return LicenseGuard.load().state.fingerprint.substring(0, 8);
}

describe('LicenseGuard -- Community (no license file)', () => {
  it('creates state file on first load', () => {
    expect(existsSync(_paths.statePath)).toBe(false);
    LicenseGuard.load();
    expect(existsSync(_paths.statePath)).toBe(true);
  });

  it('returns Community tier when no license file present', () => {
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('community');
  });

  it('fingerprint is stable across loads on the same state file', () => {
    const fp1 = LicenseGuard.load().state.fingerprint;
    const fp2 = LicenseGuard.load().state.fingerprint;
    expect(fp1).toBe(fp2);
  });

  it('Community passes requireTier community', () => {
    expect(() => LicenseGuard.load().requireTier('community')).not.toThrow();
  });

  it('Community throws LicenseTierError for consultant (never LicenseLimitError)', () => {
    expect(() => LicenseGuard.load().requireTier('consultant', { feature: 'generate-tf' })).toThrow(LicenseTierError);
  });

  it('LicenseTierError carries required and current tiers and feature', () => {
    try {
      LicenseGuard.load().requireTier('enterprise', { feature: 'portfolio' });
    } catch (e) {
      expect(e).toBeInstanceOf(LicenseTierError);
      const err = e as LicenseTierError;
      expect(err.required).toBe('enterprise');
      expect(err.current).toBe('community');
      expect(err.feature).toBe('portfolio');
    }
  });
});

// M18 D-05 (revised): the Community cap was removed. The two describe
// blocks that previously asserted "Community limit exhausted (count)"
// and "Community limit exhausted (time)" have been deleted. Their
// replacement is the no-cap test below.
describe('LicenseGuard -- Community has no cap (M18 D-05 revised)', () => {
  it('200 days + 100 assessments still passes requireTier community', () => {
    writeState({ first_run: '2025-01-01', assessment_count: 100, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('community');
    expect(() => guard.requireTier('community')).not.toThrow();
  });

  it('past-cap Community still throws LicenseTierError (not LicenseLimitError) for higher tiers', () => {
    writeState({ first_run: '2025-01-01', assessment_count: 100, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('consultant')).toThrow(LicenseTierError);
    expect(() => guard.requireTier('enterprise')).toThrow(LicenseTierError);
  });

  it('Community never carries an assessmentLimit', () => {
    const guard = LicenseGuard.load();
    expect(guard.state.assessmentLimit).toBeUndefined();
  });

  it('guardAssessmentBudget is a no-op for Community', () => {
    writeState({ first_run: '2025-01-01', assessment_count: 1000, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    expect(() => guard.guardAssessmentBudget()).not.toThrow();
  });
});

describe('LicenseGuard -- valid Consultant key', () => {
  it('returns consultant tier when key is valid', () => {
    const myFp = getFp8();
    writeLicense({
      v: 1, tier: 'consultant', licensee: 'Accenture Test', email: 'test@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: myFp, iat: '2026-04-28',
    });
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('consultant');
    expect(guard.state.licensee).toBe('Accenture Test');
    expect(guard.state.assessmentLimit).toBeNull();
  });

  it('consultant tier passes requireTier community and consultant', () => {
    writeLicense({ v: 1, tier: 'consultant', licensee: 'Test', exp: '2027-12-31', assessment_limit: null, fp: getFp8(), iat: '2026-04-28' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('community')).not.toThrow();
    expect(() => guard.requireTier('consultant')).not.toThrow();
  });

  it('consultant tier throws LicenseTierError for enterprise', () => {
    writeLicense({ v: 1, tier: 'consultant', licensee: 'Test', exp: '2027-12-31', assessment_limit: null, fp: getFp8(), iat: '2026-04-28' });
    expect(() => LicenseGuard.load().requireTier('enterprise')).toThrow(LicenseTierError);
  });
});

describe('LicenseGuard -- valid Enterprise key', () => {
  it('returns enterprise tier when key is valid', () => {
    writeLicense({ v: 1, tier: 'enterprise', licensee: 'Accenture Enterprise', exp: '2027-12-31', assessment_limit: null, fp: getFp8(), iat: '2026-04-28' });
    expect(LicenseGuard.load().state.tier).toBe('enterprise');
  });

  it('enterprise tier passes all requireTier levels', () => {
    writeLicense({ v: 1, tier: 'enterprise', licensee: 'Test', exp: '2027-12-31', assessment_limit: null, fp: getFp8(), iat: '2026-04-28' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('community')).not.toThrow();
    expect(() => guard.requireTier('consultant')).not.toThrow();
    expect(() => guard.requireTier('enterprise')).not.toThrow();
  });
});

describe('LicenseGuard -- guardAssessmentBudget (M18 #0273)', () => {
  it('null assessment_limit means unlimited (no throw at any count)', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 99999, fingerprint: getFp8() });
    writeLicense({ v: 1, tier: 'enterprise', licensee: 'Big Engagement', exp: '2027-12-31', assessment_limit: null, fp: getFp8(), iat: '2026-04-28' });
    const guard = LicenseGuard.load();
    expect(() => guard.guardAssessmentBudget()).not.toThrow();
  });

  it('positive assessment_limit raises LicenseLimitError on the assess that would exceed it', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 5, fingerprint: getFp8() });
    writeLicense({ v: 1, tier: 'consultant', licensee: 'Test', exp: '2027-12-31', assessment_limit: 5, fp: getFp8(), iat: '2026-04-28' });
    const guard = LicenseGuard.load();
    expect(() => guard.guardAssessmentBudget()).toThrow(LicenseLimitError);
    try {
      guard.guardAssessmentBudget();
    } catch (e) {
      const err = e as LicenseLimitError;
      expect(err.used).toBe(5);
      expect(err.limit).toBe(5);
    }
  });

  it('passes when count is one below the limit', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 4, fingerprint: getFp8() });
    writeLicense({ v: 1, tier: 'consultant', licensee: 'Test', exp: '2027-12-31', assessment_limit: 5, fp: getFp8(), iat: '2026-04-28' });
    const guard = LicenseGuard.load();
    expect(() => guard.guardAssessmentBudget()).not.toThrow();
  });
});

describe('LicenseGuard -- expired key (no grace period after M18)', () => {
  it('treats expired key as plain Community tier (no grace counters)', () => {
    writeLicense({ v: 1, tier: 'consultant', licensee: 'Test', exp: '2020-01-01', assessment_limit: null, fp: getFp8(), iat: '2019-01-01' });
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('community');
    expect(guard.state.exp).toBe('2020-01-01');
    // No assessmentLimit on expired-drop-to-Community state.
    expect(guard.state.assessmentLimit).toBeUndefined();
    // Community is unlimited even when it follows an expired licence.
    expect(() => guard.guardAssessmentBudget()).not.toThrow();
  });
});

describe('LicenseGuard -- wrong machine fingerprint', () => {
  it('throws LicenseInvalidError with fingerprint_mismatch code', () => {
    LicenseGuard.load(); // create state file with real fp
    writeLicense({ v: 1, tier: 'consultant', licensee: 'Other', exp: '2027-12-31', assessment_limit: null, fp: 'deadbeef', iat: '2026-04-28' });
    try {
      LicenseGuard.load();
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LicenseInvalidError);
      expect((e as LicenseInvalidError).code).toBe('fingerprint_mismatch');
    }
  });
});

describe('LicenseGuard -- signature invalid', () => {
  it('throws LicenseInvalidError with signature_invalid code for tampered key', () => {
    LicenseGuard.load();
    writeFileSync(_paths.licensePath, JSON.stringify({
      key: 'dGVzdA==.invalidsig',
      activated_at: '2026-04-28',
      tier: 'consultant',
      exp: '2027-12-31',
      licensee: 'Tampered',
    }));
    try {
      LicenseGuard.load();
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LicenseInvalidError);
      expect((e as LicenseInvalidError).code).toBe('signature_invalid');
    }
  });
});

describe('LicenseGuard -- incrementAssessmentCount', () => {
  it('increments assessment_count in state file', () => {
    const guard = LicenseGuard.load();
    expect(guard.state.assessmentCount).toBe(0);
    guard.incrementAssessmentCount();
    expect(LicenseGuard.load().state.assessmentCount).toBe(1);
  });
});

describe('LicenseGuard -- requireFeature (lz-catalogue-update = Consultant+)', () => {
  it('Community tier throws for lz-catalogue-update', () => {
    expect(() => LicenseGuard.load().requireFeature('lz-catalogue-update')).toThrow();
  });

  it('Consultant tier passes for lz-catalogue-update', () => {
    writeLicense({ v: 1, tier: 'consultant', licensee: 'Test', exp: '2027-12-31', assessment_limit: null, fp: getFp8(), iat: '2026-04-28' });
    expect(() => LicenseGuard.load().requireFeature('lz-catalogue-update')).not.toThrow();
  });

  it('Enterprise tier passes for lz-catalogue-update', () => {
    writeLicense({ v: 1, tier: 'enterprise', licensee: 'Test', exp: '2027-12-31', assessment_limit: null, fp: getFp8(), iat: '2026-04-28' });
    expect(() => LicenseGuard.load().requireFeature('lz-catalogue-update')).not.toThrow();
  });

  it('expired consultant key drops to community and throws for lz-catalogue-update', () => {
    writeLicense({ v: 1, tier: 'consultant', licensee: 'Test', exp: '2020-01-01', assessment_limit: null, fp: getFp8(), iat: '2019-01-01' });
    expect(() => LicenseGuard.load().requireFeature('lz-catalogue-update')).toThrow();
  });
});
