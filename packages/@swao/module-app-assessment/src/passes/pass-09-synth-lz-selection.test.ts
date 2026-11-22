// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App Assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4481 (Design 012 section 5a): Pass 09 matches only the landing zones
// selected for the run; the bundled provider list reaches the assessment and
// the prompt only with the opt-in market scan, and providers without a recent
// review are listed without a fit score.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { dump } from 'js-yaml';
import type { PassContext } from '@swao/core';
import { loadCatalogueDocument } from '@swao/core';
import {
  buildSynthPrompt, runSynthPass, synthLandingZoneContext, landingZoneInSelection, resolveCloudProviderCataloguePath,
} from './pass-09-synth.js';

const TWO = [{ provider: 'otc', region: 'eu-de' }, { provider: 'aws', region: 'eu-central-1' }];

let dir: string;
let passesDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swao-4481-synth-'));
  passesDir = join(dir, 'wsp', 'runs', 'now', 'passes');
  mkdirSync(passesDir, { recursive: true });
  writeFileSync(join(passesDir, '01-inv.yaml'), dump({ signals: [], assessment: {} }));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

function ctx(overrides: Partial<PassContext> = {}): PassContext {
  return { appId: 'lz-app', sourcePath: dir, workspacePath: dir, iter: 1, assessedAt: '2026-11-16T15:00:00Z', passesDir, ...overrides };
}

const ANSWER = (lz: string) => JSON.stringify({
  signals: [],
  assessment: { seven_r_label: 'Rehost', modernization_position: 'migrate_stabilize', landing_zone: lz },
});

describe('synthLandingZoneContext (#4481)', () => {
  it('records the selected targets with the fit file name of the inline fit', () => {
    const two = synthLandingZoneContext(TWO, { marketScan: false, priorSignals: [], assessedAt: '2026-11-16' });
    expect(two.context).toEqual({
      landing_zone_targets: [
        { provider: 'otc', region: 'eu-de', fit_file: 'lz-catalogue-fit-otc-eu-de.yaml' },
        { provider: 'aws', region: 'eu-central-1', fit_file: 'lz-catalogue-fit-aws-eu-central-1.yaml' },
      ],
    });
    const one = synthLandingZoneContext([TWO[0]!], { marketScan: false, priorSignals: [], assessedAt: '2026-11-16' });
    expect((one.context['landing_zone_targets'] as Array<{ fit_file: string }>)[0]!.fit_file).toBe('lz-catalogue-fit.yaml');
    expect(two.marketScan).toBeUndefined();
  });

  it('skips the match when no landing zone is selected', () => {
    const r = synthLandingZoneContext([], { marketScan: false, priorSignals: [], assessedAt: '2026-11-16' });
    expect(r.context).toEqual({ landing_zone_match_skipped_reason: 'no landing zone selected' });
  });

  it('market scan: scores reviewed entries, lists old and undated ones as not reviewed and logs them', () => {
    const cat = join(dir, 'cloud-provider-catalogue.yaml');
    const provider = (id: string, reviewed?: string) => ({
      id, name: `Name ${id}`, residency: { data_residency_guarantees: ['EU_only'] }, certifications: { bsi_c5: { status: 'attested', evidence_url: `https://example.org/${id}/c5` } },
      compliance_regime_coverage: {}, services: {}, meshstack_support: { supported: false }, vendor_lock_in: { overall_risk: 'low', portability_score: 0.8 },
      cost_tier: 'medium', sovereign_score: 0.7, review_sources: [`https://example.org/${id}`], ...(reviewed ? { last_reviewed: reviewed } : {}),
    });
    writeFileSync(cat, dump({ catalogue_version: '2026-10', last_updated: '2026-10-01', providers: [provider('fresh', '2026-10-01'), provider('old', '2026-04-28'), provider('undated')] }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = synthLandingZoneContext([], { marketScan: true, priorSignals: [], assessedAt: '2026-11-16T15:00:00Z', cataloguePath: cat });
    const scan = r.marketScan!;
    expect(scan.list_version).toBe('2026-10');
    expect(scan.candidates.map((c) => c.id)).toEqual(['fresh']);
    expect(scan.candidates[0]!.evidence).toEqual(['https://example.org/fresh', 'https://example.org/fresh/c5']);
    expect(scan.not_reviewed.map((n) => n.id)).toEqual(['old', 'undated']);
    expect(scan.not_reviewed[0]!.reason).toContain('202 days');
    expect(r.context['landing_zone_market_scan']).toBe(scan);
    expect(r.context['landing_zone_match_skipped_reason']).toBe('no landing zone selected');
    expect(log.mock.calls.flat().join(' ')).toContain('not reviewed within 180 days, listed without a fit score: old, undated');
  });
});

describe('synthesis prompt (#4481)', () => {
  it('with two selected targets holds no provider of the bundled list', () => {
    const path = resolveCloudProviderCataloguePath();
    expect(path).not.toBeNull();
    const prompt = buildSynthPrompt([], 'lz-app', { targets: TWO });
    expect(prompt).toContain('Selected targets (assessed by the LZ catalogue fit of this run): otc/eu-de, aws/eu-central-1');
    expect(prompt).not.toContain('MARKET SCAN');
    for (const p of loadCatalogueDocument(path!).providers) {
      expect(prompt).not.toContain(p.id);
      expect(prompt).not.toContain(p.name);
    }
  });

  it('without a selection tells the LLM not to name a provider', () => {
    expect(buildSynthPrompt([], 'lz-app')).toContain('No landing zone was selected for this run.');
  });
});

describe('runSynthPass landing-zone selection (#4481)', () => {
  it('keeps a selected landing zone, writes the targets and no bundled-list ranking', async () => {
    let prompt = '';
    const result = await runSynthPass(ctx({ lzTargets: TWO, llm: { complete: async (p: string) => { prompt = p; return ANSWER('otc/eu-de'); } } }));
    expect(result.pass.status).toBe('complete');
    expect(result.assessment['landing_zone']).toBe('otc/eu-de');
    expect(result.assessment['landing_zone_targets']).toHaveLength(2);
    expect(result.assessment['landing_zone_candidates']).toBeUndefined();
    expect(result.assessment['recommended_landing_zone']).toBeUndefined();
    expect(prompt).not.toMatch(/stackit|hetzner|cloudferro/i);
  });

  it('clears a landing zone outside the selection', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runSynthPass(ctx({ lzTargets: TWO, llm: { complete: async () => ANSWER('stackit_de_sovereign') } }));
    expect(result.assessment['landing_zone']).toBe('');
  });

  it('without lzTargets records the skip reason', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runSynthPass(ctx({ llm: { complete: async () => ANSWER('') } }));
    expect(result.assessment['landing_zone_match_skipped_reason']).toBe('no landing zone selected');
    expect(result.assessment['landing_zone_targets']).toBeUndefined();
  });

  it('a service run records the service reason, not the selection hint', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runSynthPass(ctx({ assessmentType: 'service', llm: { complete: async () => ANSWER('') } }));
    expect(result.assessment['landing_zone_match_skipped_reason']).toBe('no landing zone selected for the service assessment');
  });

  it('landingZoneInSelection accepts label, provider:region, provider id and provider prefix', () => {
    expect(landingZoneInSelection('otc/eu-de', TWO)).toBe(true);
    expect(landingZoneInSelection('AWS:eu-central-1', TWO)).toBe(true);
    expect(landingZoneInSelection('otc', TWO)).toBe(true);
    expect(landingZoneInSelection('otc_de_sovereign', TWO)).toBe(true);
    expect(landingZoneInSelection('otcx', TWO)).toBe(false);
    expect(landingZoneInSelection('stackit', TWO)).toBe(false);
  });
});
