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

// #3876 (Design 123 section 11, licence tier matrix F-140 and F-140a): the tiers
// of the Client LZ Policy Baseline, per tier with a real signed licence in
// sandboxed licence paths (Community: none), as tier-gates-golden-record.test.ts.
//   - using the framework (a copy in wsp/inputs/catalogs/community/): every tier
//     (ungated); the install and baseline commands are removed (#4126);
//   - baseline evaluation in a single-LZ live assessment: Consultant
//     (lz-live-assess, the gate of the live run that evaluates the baseline);
//   - the live LZ source of an Application Assessment: Consultant (lz-live-assess);
//   - the cross-CSP comparison (portfolio merge): Enterprise (lz-live-portfolio).
// Every refusal is the [LICENSE] block with exit 2 (ADR-0055, D-18).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { communityFrameworksDir } from '@swao/community-frameworks';
import { _paths, buildLicenseKey, CredentialStore, LicenseGuard } from '@swao/core';
import type { LicensePayload } from '@swao/core';
import { lzLiveAssessAction, lzLivePortfolioAction } from '@swao/module-landing-zone';
import { communityDir } from './framework.js';

type Tier = 'community' | 'consultant' | 'enterprise';
const FW = 'CLIENT_LZ_POLICY_BASELINE';

let home: string;
let ws: string;
const saved = { statePath: _paths.statePath, licensePath: _paths.licensePath, legacyLicencePath: _paths.legacyLicencePath };
let savedBinaryTier: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'swao-baseline-tier-'));
  _paths.statePath = join(home, '.swao-state.json');
  _paths.licensePath = join(home, 'licence.json');
  _paths.legacyLicencePath = join(home, '.swao-license-legacy.json');
  writeFileSync(_paths.statePath, JSON.stringify({ first_run: '2026-11-05', assessment_count: 0, fingerprint: 'abc123de' }), 'utf-8');
  savedBinaryTier = process.env['SWAO_BINARY_TIER'];
  delete process.env['SWAO_BINARY_TIER'];
  ws = mkdtempSync(join(tmpdir(), 'swao-baseline-tier-ws-'));
  writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
});

afterEach(() => {
  Object.assign(_paths, saved);
  if (savedBinaryTier === undefined) delete process.env['SWAO_BINARY_TIER'];
  else process.env['SWAO_BINARY_TIER'] = savedBinaryTier;
  rmSync(home, { recursive: true, force: true });
  rmSync(ws, { recursive: true, force: true });
});

function useTier(tier: Tier): LicenseGuard {
  if (tier !== 'community') {
    const fp = LicenseGuard.load().state.fingerprint.substring(0, 8);
    const payload: LicensePayload = { v: 1, tier, licensee: 'TestOrg', email: 'test@example.com', exp: '2099-12-31', assessment_limit: null, fp, iat: '2026-11-05' };
    writeFileSync(_paths.licensePath, JSON.stringify({ key: buildLicenseKey(payload), activated_at: '2026-11-05', tier, exp: payload.exp, licensee: payload.licensee }), 'utf-8');
  }
  const guard = LicenseGuard.load();
  expect(guard.state.tier).toBe(tier);
  return guard;
}

/** #4126: the user copies the baseline folder into the workspace by hand (no install command). */
function copyBaselineIntoWorkspace(): void {
  cpSync(join(communityFrameworksDir, 'client-lz-policy-baseline'), join(communityDir(ws), 'client-lz-policy-baseline'), { recursive: true });
}

function liveDeps(guard: Pick<LicenseGuard, 'requireFeature'>): { deps: Parameters<typeof lzLiveAssessAction>[2]; err: string[] } {
  const err: string[] = [];
  return { deps: { cwd: ws, store: new CredentialStore(join(ws, 'vault')), env: {}, out: () => undefined, err: (l: string) => err.push(l), guard, checks: [] }, err };
}

function portfolio(guard: Pick<LicenseGuard, 'requireFeature'>): { code: number; err: string[] } {
  const err: string[] = [];
  const code = lzLivePortfolioAction({}, { cwd: ws, out: () => undefined, err: (l) => err.push(l), guard });
  return { code, err };
}

describe('F-140 Client LZ Policy Baseline tiers (#3876, Design 123 section 11)', () => {
  it.skipIf(!existsSync(join(communityFrameworksDir, 'client-lz-policy-baseline')))('Community: the copied baseline is usable; the live evaluation and the comparison are refused with exit 2 (the live app source is retired, #4244)', async () => {
    const guard = useTier('community');
    copyBaselineIntoWorkspace();
    expect(existsSync(join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'client-lz-policy-baseline', 'policy-baseline.yaml'))).toBe(true);

    const live = liveDeps(guard);
    expect(await lzLiveAssessAction('otc-prod', { frameworks: FW }, live.deps)).toBe(2);
    expect(live.err.join('\n')).toContain('[LICENSE] swao assess --type landing-zone-live and swao lz scan (Landing Zone Live Assessment) requires a Consultant licence.');

    const p = portfolio(guard);
    expect(p.code).toBe(2);
    expect(p.err.join('\n')).toContain('[LICENSE] swao assess --portfolio --type landing-zone-live (Landing Zone Live portfolio) requires an Enterprise licence.');
  });

  it('Consultant: evaluates one landing zone; the comparison is refused with exit 2', async () => {
    const guard = useTier('consultant');
    // Past the gate: the unregistered landing zone is the next refusal (exit 1, not the tier).
    const live = liveDeps(guard);
    expect(await lzLiveAssessAction('otc-prod', { frameworks: FW }, live.deps)).toBe(1);
    expect(live.err.join('\n')).not.toContain('[LICENSE]');
    const p = portfolio(guard);
    expect(p.code).toBe(2);
    expect(p.err.join('\n')).toContain('requires an Enterprise licence');
  });

  it('Enterprise: the comparison passes the gate (no landing zone run to merge is exit 1, not the tier)', () => {
    const guard = useTier('enterprise');
    const p = portfolio(guard);
    expect(p.code).toBe(1);
    expect(p.err.join('\n')).not.toContain('[LICENSE]');
    expect(p.err.join('\n')).toContain('no landing zone could be merged');
  });

});

// The binary tier caps the licence (license-guard binaryTierCap): an Enterprise
// licence on a Community binary refuses the live evaluation like Community
// (#4244: the live app source it pinned before is retired).
describe('F-140 with the binary tier cap', () => {
  it('Community binary with an Enterprise licence: the live evaluation is refused', async () => {
    useTier('enterprise');
    process.env['SWAO_BINARY_TIER'] = 'community';
    const live = liveDeps(LicenseGuard.load());
    expect(await lzLiveAssessAction('otc-prod', { frameworks: FW }, live.deps)).toBe(2);
  });
});
