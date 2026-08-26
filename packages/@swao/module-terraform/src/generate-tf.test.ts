// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Terraform module
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
  _paths,
  LicenseGuard,
  LicenseTierError,
  LicenseLimitError,
  buildLicenseKey,
} from '@swao/core';
import type { LicensePayload } from '@swao/core';

const TEMP_HOME = join(tmpdir(), `swao-gen-tf-test-${process.pid}`);

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
  writeFileSync(
    _paths.licensePath,
    JSON.stringify({ key, activated_at: '2026-04-28', tier: payload.tier, exp: payload.exp, licensee: payload.licensee }),
    'utf-8',
  );
}

// The generate-tf gate is enforced via LicenseGuard.requireTier('consultant').
// These tests verify gate behaviour directly -- no process.exit mocking needed.

describe('generate-tf license gate -- Community tier', () => {
  it('throws LicenseTierError at any Community usage level (no cap after M18)', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 5, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('community');
    expect(() => guard.requireTier('consultant', { feature: 'generate-tf' })).toThrow(LicenseTierError);
  });

  it('high-usage Community still throws LicenseTierError (not LicenseLimitError)', () => {
    writeState({ first_run: '2026-04-28', assessment_count: 100, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('consultant', { feature: 'generate-tf' })).toThrow(LicenseTierError);
    expect(() => guard.requireTier('consultant', { feature: 'generate-tf' })).not.toThrow(LicenseLimitError);
  });

  it('aged Community still throws LicenseTierError (not LicenseLimitError)', () => {
    writeState({ first_run: '2025-01-01', assessment_count: 0, fingerprint: 'abc123def456abc1' });
    const guard = LicenseGuard.load();
    expect(() => guard.requireTier('consultant', { feature: 'generate-tf' })).toThrow(LicenseTierError);
    expect(() => guard.requireTier('consultant', { feature: 'generate-tf' })).not.toThrow(LicenseLimitError);
  });
});

describe('generate-tf license gate -- Licensed tier', () => {
  function fp8(): string {
    return LicenseGuard.load().state.fingerprint.substring(0, 8);
  }

  it('does not throw for a valid Consultant key', () => {
    const payload: LicensePayload = {
      v: 1, tier: 'consultant', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fp8(), iat: '2026-04-28',
    };
    writeLicenseKey(payload);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('consultant');
    expect(() => guard.requireTier('consultant', { feature: 'generate-tf' })).not.toThrow();
  });

  it('does not throw for a valid Enterprise key', () => {
    const payload: LicensePayload = {
      v: 1, tier: 'enterprise', licensee: 'Accenture', email: 'a@example.com',
      exp: '2027-12-31', assessment_limit: null, fp: fp8(), iat: '2026-04-28',
    };
    writeLicenseKey(payload);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe('enterprise');
    expect(() => guard.requireTier('consultant', { feature: 'generate-tf' })).not.toThrow();
  });
});
