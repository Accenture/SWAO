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

// #3335 / #3337: the sandbox licence injection used by binary-e2e and the J6
// journey writes a licence that LicenseGuard accepts in-process (test public
// key, NODE_ENV=test from setup.ts). The binary refuses it by design (see
// TEST_LICENCE_REFUSED_REASON); this test proves the injected files are right.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { LicenseGuard, LicenseInvalidError, _paths } from '@swao/core';
import {
  injectTestLicence, sandboxEnv, sandboxLicencePath, probeLicensedTier,
  INJECTED_FINGERPRINT, TEST_LICENCE_REFUSED_REASON,
} from './helpers/injected-licence.js';

let home: string;
const saved = { ..._paths };
let savedBinaryTier: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'swao-injected-licence-'));
  _paths.statePath = join(home, '.swao-state.json');
  _paths.licensePath = sandboxLicencePath(home);
  _paths.legacyLicencePath = join(home, '.swao-license.json');
  savedBinaryTier = process.env['SWAO_BINARY_TIER'];
  delete process.env['SWAO_BINARY_TIER'];
});
afterEach(() => {
  Object.assign(_paths, saved);
  if (savedBinaryTier !== undefined) process.env['SWAO_BINARY_TIER'] = savedBinaryTier;
  rmSync(home, { recursive: true, force: true });
});

describe('injectTestLicence (#3335)', () => {
  it.each(['enterprise', 'consultant'] as const)('writes a %s licence + state that LicenseGuard accepts in-process', (tier) => {
    const lic = injectTestLicence(home, tier);
    expect(existsSync(lic.licencePath)).toBe(true);
    expect(existsSync(lic.statePath)).toBe(true);
    expect(lic.publicKeyHex).toBe(process.env['SWAO_LICENSE_PUBLIC_KEY_HEX_TEST']);
    const guard = LicenseGuard.load();
    expect(guard.state.tier).toBe(tier);
    expect(guard.state.fingerprint).toBe(INJECTED_FINGERPRINT);
  });

  it('a licence signed with another key is refused (what the production binary does with a test key)', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const foreignSeed = (privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer).subarray(-32).toString('base64url');
    injectTestLicence(home, 'enterprise', foreignSeed);
    expect(() => LicenseGuard.load()).toThrow(LicenseInvalidError);
  });

  it('sandboxEnv points every licence and state lookup at the sandbox', () => {
    const env = sandboxEnv(home, {});
    expect(env).toMatchObject({ HOME: home, USERPROFILE: home, LOCALAPPDATA: home, APPDATA: home, HOMEDRIVE: '', HOMEPATH: '' });
  });

  it('probeLicensedTier reads `license status` output; refusals are null', () => {
    expect(probeLicensedTier('Tier: Enterprise\nLicensee: SWAO E2E')).toBe('enterprise');
    expect(probeLicensedTier('Tier: Consultant')).toBe('consultant');
    expect(probeLicensedTier('License key signature is invalid. Contact ...')).toBeNull();
    expect(probeLicensedTier('Tier: Community')).toBeNull();
    expect(TEST_LICENCE_REFUSED_REASON).toContain("NODE_ENV = 'production'");
  });
});
