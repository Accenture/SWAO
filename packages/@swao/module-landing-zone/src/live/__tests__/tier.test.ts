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

// #3590: live capability -> FEATURE_GATES key, and the tier each one resolves
// to (Design 120 section 15). The per-tier allow / block with a real licence
// is pinned in @swao/core license-guard.test.ts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _paths, FEATURE_GATES, LicenseGuard, LicenseTierError } from '@swao/core';
import type { FeatureKey } from '@swao/core';
import { LZ_LIVE_FEATURE_GATES, LZ_LIVE_TIER_EXIT_CODE, formatLzLiveTierRefusal, lzLiveFailure, requireLzLiveFeature } from '../tier.js';
import { lzConnectAction, lzProbeAction } from '../cli.js';
import { CredentialStore } from '@swao/core';

describe('LZ live tiers', () => {
  it('maps every capability to the tier of Design 120 section 15', () => {
    const tiers = Object.fromEntries(Object.entries(LZ_LIVE_FEATURE_GATES).map(([f, k]) => [f, FEATURE_GATES[k]]));
    expect(tiers).toEqual({
      connect: 'community',
      assess: 'consultant',
      publication: 'consultant',
      'catalogue-source-live': 'consultant',
      portfolio: 'enterprise',
    });
  });

  it('requireLzLiveFeature asks the guard for the mapped key', () => {
    const asked: FeatureKey[] = [];
    const guard = { requireFeature: (k: FeatureKey) => { asked.push(k); } };
    for (const f of Object.keys(LZ_LIVE_FEATURE_GATES) as (keyof typeof LZ_LIVE_FEATURE_GATES)[]) requireLzLiveFeature(guard, f);
    expect(asked).toEqual(['lz-live-connect', 'lz-live-assess', 'html-report', 'lz-catalogue-update', 'lz-live-portfolio']);
  });

  describe('with a Community licence (sandboxed licence paths)', () => {
    let home: string;
    const saved = { statePath: _paths.statePath, licensePath: _paths.licensePath, legacyLicencePath: _paths.legacyLicencePath };
    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'swao-lz-tier-'));
      mkdirSync(home, { recursive: true });
      _paths.statePath = join(home, '.swao-state.json');
      _paths.licensePath = join(home, '.swao-license.json');
      _paths.legacyLicencePath = join(home, '.swao-license-legacy.json');
      delete process.env['SWAO_BINARY_TIER'];
    });
    afterEach(() => {
      Object.assign(_paths, saved);
      rmSync(home, { recursive: true, force: true });
    });

    it('allows connect and blocks assess, publication, catalogue source live and portfolio', () => {
      const guard = LicenseGuard.load();
      expect(guard.state.tier).toBe('community');
      expect(() => requireLzLiveFeature(guard, 'connect')).not.toThrow();
      for (const f of ['assess', 'publication', 'catalogue-source-live', 'portfolio'] as const) {
        expect(() => requireLzLiveFeature(guard, f)).toThrow(LicenseTierError);
      }
    });

    it('swao lz connect and probe consult the guard and stop with exit 2 when it refuses (ADR-0055, #3844)', async () => {
      const ws = mkdtempSync(join(tmpdir(), 'swao-lz-tier-ws-'));
      try {
        writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
        const err: string[] = [];
        const refusing = { requireFeature: (k: FeatureKey) => { throw new LicenseTierError('enterprise', 'community', k); } };
        const deps = { cwd: ws, store: new CredentialStore(join(ws, 'vault')), env: {}, out: () => undefined, err: (l: string) => err.push(l), guard: refusing };
        expect(await lzConnectAction('fake-prod', { provider: 'fakecsp', scope: 'platform', kind: 'platform', auth: 'aksk' }, deps)).toBe(2);
        expect(await lzProbeAction('fake-prod', {}, deps)).toBe(2);
        // #3844: the [LICENSE] block instead of the bare guard message; exit code unchanged (1).
        expect(err.join('\n')).toContain('[LICENSE] swao lz connect, probe, list and remove (Landing Zone Live connections) requires an Enterprise licence.');
      } finally {
        rmSync(ws, { recursive: true, force: true });
      }
    });
  });
});

// #3844: a tier refusal exits 2 with the [LICENSE] block (ADR-0055; owner decision
// 2026-11-05, the same code as printLicenseGateError and every other gate).
describe('LZ live tier refusal exit code and message (#3844)', () => {
  it('maps a LicenseTierError to exit 2 (ADR-0055) and the [LICENSE] block', () => {
    const f = lzLiveFailure(new LicenseTierError('consultant', 'community', 'lz-live-assess'));
    expect(LZ_LIVE_TIER_EXIT_CODE).toBe(2);
    expect(f.code).toBe(2);
    expect(f.message.split('\n')).toEqual([
      '[LICENSE] swao assess --type landing-zone-live and swao lz scan (Landing Zone Live Assessment) requires a Consultant licence.',
      'Your current tier: community',
      '',
      'To upgrade: swao license request --tier consultant',
      'Contact: https://github.com/Accenture/SWAO/discussions',
    ]);
  });

  it('uses the feature key for an unmapped feature and "This feature" without one', () => {
    expect(formatLzLiveTierRefusal(new LicenseTierError('enterprise', 'community', 'other-key'))).toMatch(/^\[LICENSE\] other-key requires an Enterprise licence\./);
    expect(formatLzLiveTierRefusal(new LicenseTierError('enterprise', 'community'))).toMatch(/^\[LICENSE\] This feature requires an Enterprise licence\./);
  });

  it('keeps the exit code of every other error (2 expired token, refused endpoint, recording location) and 1 without one', () => {
    expect(lzLiveFailure(Object.assign(new Error('expired'), { exitCode: 2 }))).toEqual({ code: 2, message: 'expired' });
    expect(lzLiveFailure(new Error('invalid'))).toEqual({ code: 1, message: 'invalid' });
    expect(lzLiveFailure('plain')).toEqual({ code: 1, message: 'plain' });
  });
});
