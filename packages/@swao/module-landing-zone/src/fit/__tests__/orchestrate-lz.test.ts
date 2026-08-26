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
