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

import { describe, it, expect } from 'vitest';
import type { LzRegion, LzScanResult } from '@swao/core';
import {
  orchestrateLandingZone,
  deriveSovereigntyRequirements,
  type FrameworkSovereigntyDecl,
} from '../orchestrate-lz.js';

const LZ_ID = /^LZ-\d{2}$/;

const REGION: LzRegion = {
  id: 'eu-central-1',
  country: 'DE',
  sovereignty: { residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act'], certifications: [] },
  services: [
    { code: 'eks', status: 'ga', capabilities: [], fulfills: ['kubernetes'], key_custody: [] },
    { code: 'rds-postgresql', status: 'ga', capabilities: [], fulfills: ['postgresql'], key_custody: [] },
  ],
};
const SCAN: LzScanResult = {
  provider: 'aws', collection_mode: 'export', confidence: 'observed', scanned_at: '2026-06-24',
  regions: ['eu-central-1'], enabled_services: [{ code: 'eks', provisioned: true, fulfills: ['kubernetes'] }], guardrails: [], quotas: [],
  provenance: { source: 'aws-snapshot' },
};

describe('deriveSovereigntyRequirements (#0567, framework-driven D-LZ-07)', () => {
  it('returns undefined when no active framework declares sovereignty requirements', () => {
    const fws: FrameworkSovereigntyDecl[] = [{ id: 'GDPR' }, { id: 'ISO_27001' }];
    expect(deriveSovereigntyRequirements(fws)).toBeUndefined();
  });

  it('aggregates requirements from declaring frameworks (derived_from records them)', () => {
    const fws: FrameworkSovereigntyDecl[] = [
      { id: 'EU_SOVEREIGNTY', sovereignty_requirements: { forbid_exposure: ['us_cloud_act'], require_operator_jurisdiction: ['EU-entity'] } },
      { id: 'GDPR' },
    ];
    const req = deriveSovereigntyRequirements(fws);
    expect(req?.forbid_exposure).toContain('us_cloud_act');
    expect(req?.require_operator_jurisdiction).toContain('EU-entity');
    expect(req?.derived_from).toEqual(['EU_SOVEREIGNTY']);
  });
});

describe('orchestrateLandingZone (#0567)', () => {
  it('assembles a WspResult with LZ-NN gap signals + lz fit block (no LLM)', () => {
    const wsp = orchestrateLandingZone({
      region: REGION, scan: SCAN,
      requiredServices: [{ code: 'kubernetes' }, { code: 'postgresql' }], // kubernetes SUPPORTED, postgresql AVAILABLE_NOT_ENABLED
      assessedAt: '2026-06-24',
    });
    expect(wsp.wsp_version).toBe('0.11');
    expect(wsp['assessment_type']).toBe('landing-zone');
    // one gap (rds-postgres not enabled) -> one LZ-NN signal
    expect(wsp.signals).toHaveLength(1);
    expect(wsp.signals[0]!.id).toMatch(LZ_ID);
    expect(wsp.signals[0]!.outcome).toBe('negative');
    const report = wsp['lz'] as Record<string, unknown>;
    expect(report.overall).toBe('READY_WITH_CHANGES');
  });

  it('a SOVEREIGNTY_GAP (framework-derived) yields a critical LZ signal + SOVEREIGNTY_BLOCKED', () => {
    const req = deriveSovereigntyRequirements([{ id: 'EU_SOVEREIGNTY', sovereignty_requirements: { forbid_exposure: ['us_cloud_act'] } }]);
    const wsp = orchestrateLandingZone({ region: REGION, scan: SCAN, requiredServices: [{ code: 'kubernetes' }], sovereigntyRequirements: req, assessedAt: '2026-06-24' });
    expect(wsp.signals[0]!.severity).toBe('critical');
    expect((wsp['lz'] as Record<string, unknown>).overall).toBe('SOVEREIGNTY_BLOCKED');
  });
});

// #3888 (Design 123 section 8.4, D-12): the app fit carries the baseline deny,
// and the Pass 11 rule engine decides the same policy as GAP: the two agree.
describe('orchestrateLandingZone with baselineDenies (#3888, D-12)', () => {
  it('a needed capability that an enabled service_deny forbids is BLOCKED_BY_POLICY with evidence baseline:<id>, and its control is GAP', async () => {
    const wsp = orchestrateLandingZone({ region: REGION, scan: SCAN, requiredServices: [{ code: 'kubernetes' }, { code: 'postgresql' }], assessedAt: '2026-11-05', baselineDenies: new Map([['postgresql', 'CPB-SVC-01']]) });
    const items = ((wsp['lz'] as Record<string, unknown>)['items'] as { service_code: string; verdict: string; evidence?: string[] }[]);
    const pg = items.find((i) => i.service_code === 'postgresql');
    expect(pg).toMatchObject({ verdict: 'BLOCKED_BY_POLICY' });
    expect(pg?.evidence).toContain('baseline:CPB-SVC-01');
    expect(items.find((i) => i.service_code === 'kubernetes')?.verdict).not.toBe('BLOCKED_BY_POLICY');
    const { evaluateAppBaselineRules } = await import('../../evaluate/app-baseline-rules.js');
    const { PolicyBaselineSchema, POLICY_KIND_CATEGORY } = await import('@swao/core');
    const baseline = PolicyBaselineSchema.parse({ schema_version: '0.1', framework: 'CLIENT_LZ_POLICY_BASELINE', baseline_of: 'CLIENT_LZ_POLICY_BASELINE', catalogue_version: '1.0.0', policies: [{ id: 'CPB-SVC-01', kind: 'service_deny', category: POLICY_KIND_CATEGORY.service_deny, control: 'CPB-SVC-01', state: 'enabled', params: { capabilities: ['postgresql'] }, default_source: 'assumption' }] });
    expect(evaluateAppBaselineRules({ baseline, source: 'catalogue', needs: ['kubernetes', 'postgresql'], targets: [{ provider: 'aws', region: REGION.id, facts: REGION }] }).get('CPB-SVC-01')?.outcome).toBe('GAP');
  });
});
