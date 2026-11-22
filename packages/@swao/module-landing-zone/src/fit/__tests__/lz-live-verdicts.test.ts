// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- live verdicts (Design 120 section 5.3, #3569)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import {
  LZ_LIVE_STATUSES,
  type LzLiveStatus,
  parseLzLiveScan,
  projectLzLiveScan,
  type LzLiveScanInput,
  type LzRegion,
} from '@swao/core';

type LzLiveRegionStatusInput = NonNullable<LzLiveScanInput['offering']['services']>[number]['regions'][string];
import {
  computeLzFit,
  computeLzFitFromLiveScan,
  deriveLzOverallVerdict,
  lzFitVerdictForLiveStatus,
  type LzFitItem,
  type LzRequiredService,
  type LzFitVerdict,
} from '../lz-fit.js';
import { SEVERITY_BY_VERDICT } from '../orchestrate-lz.js';

const T = '2026-11-02T10:00:00Z';
const item = (verdict: LzFitVerdict, extra: Partial<LzFitItem> = {}): LzFitItem => ({
  service_code: `svc-${verdict.toLowerCase()}`, verdict, detail: verdict, ...extra,
});
const NO_GAP = { sovereigntyActive: true, sovereigntyFailures: [] as string[], coverageWarning: undefined };

describe('lzFitVerdictForLiveStatus (Design 120 section 5.3 table)', () => {
  it('maps every live status to its item verdict', () => {
    expect(lzFitVerdictForLiveStatus('enabled')).toBe('SUPPORTED');
    expect(lzFitVerdictForLiveStatus('available_not_enabled')).toBe('AVAILABLE_NOT_ENABLED');
    expect(lzFitVerdictForLiveStatus('restricted')).toBe('BLOCKED_BY_POLICY');
    expect(lzFitVerdictForLiveStatus('not_offered')).toBe('NOT_AVAILABLE_IN_REGION');
    expect(lzFitVerdictForLiveStatus('unknown')).toBe('UNVERIFIED');
  });

  it('covers the whole status vocabulary', () => {
    for (const s of LZ_LIVE_STATUSES) expect(typeof lzFitVerdictForLiveStatus(s)).toBe('string');
  });
});

describe('deriveLzOverallVerdict with the live verdicts (#3569)', () => {
  it('BLOCKED_BY_POLICY is a hard blocker', () => {
    expect(deriveLzOverallVerdict({ ...NO_GAP, items: [item('SUPPORTED'), item('BLOCKED_BY_POLICY')] })).toBe('BLOCKED');
  });

  it('BLOCKED_BY_POLICY on a documentation-only requirement asks for verification (#3497 rule)', () => {
    expect(deriveLzOverallVerdict({ ...NO_GAP, items: [item('BLOCKED_BY_POLICY', { confidence: 'low' })] })).toBe('NEEDS_VERIFICATION');
  });

  it('UNVERIFIED is not a blocker but escalates READY to NEEDS_VERIFICATION', () => {
    expect(deriveLzOverallVerdict({ ...NO_GAP, items: [item('SUPPORTED'), item('UNVERIFIED')] })).toBe('NEEDS_VERIFICATION');
  });

  it('UNVERIFIED escalates READY_WITH_CHANGES to NEEDS_VERIFICATION', () => {
    expect(deriveLzOverallVerdict({ ...NO_GAP, items: [item('AVAILABLE_NOT_ENABLED'), item('UNVERIFIED')] })).toBe('NEEDS_VERIFICATION');
  });

  it('UNVERIFIED does not soften a hard blocker or a sovereignty gap', () => {
    expect(deriveLzOverallVerdict({ ...NO_GAP, items: [item('BLOCKED_BY_POLICY'), item('UNVERIFIED')] })).toBe('BLOCKED');
    expect(deriveLzOverallVerdict({ ...NO_GAP, items: [item('SOVEREIGNTY_GAP'), item('UNVERIFIED')] })).toBe('SOVEREIGNTY_BLOCKED');
  });

  it('keeps the pre-existing order unchanged', () => {
    expect(deriveLzOverallVerdict({ ...NO_GAP, items: [item('SUPPORTED')] })).toBe('READY');
    expect(deriveLzOverallVerdict({ ...NO_GAP, items: [item('MISCONFIGURED')] })).toBe('READY_WITH_CHANGES');
    expect(deriveLzOverallVerdict({ ...NO_GAP, items: [] })).toBe('NEEDS_VERIFICATION');
    expect(deriveLzOverallVerdict({ ...NO_GAP, items: [item('SUPPORTED')], coverageWarning: 'gap' })).toBe('NEEDS_VERIFICATION');
    expect(deriveLzOverallVerdict({ ...NO_GAP, items: [item('SUPPORTED')], sovereigntyFailures: ['exposed'] })).toBe('SOVEREIGNTY_BLOCKED');
    expect(deriveLzOverallVerdict({ ...NO_GAP, sovereigntyActive: false, items: [item('SUPPORTED')], sovereigntyFailures: ['exposed'] })).toBe('READY');
  });
});

describe('SEVERITY_BY_VERDICT is exhaustive (#3569)', () => {
  it('rates the live verdicts', () => {
    expect(SEVERITY_BY_VERDICT.BLOCKED_BY_POLICY).toBe('high');
    expect(SEVERITY_BY_VERDICT.UNVERIFIED).toBe('low');
  });
  it('keeps the previous fallback for verdicts that had no entry', () => {
    expect(SEVERITY_BY_VERDICT.VERSION_MISMATCH).toBe('medium');
    expect(SEVERITY_BY_VERDICT.CAPABILITY_MISSING).toBe('medium');
  });
});

describe('a projected LzLiveScan runs through computeLzFit unchanged (#3565, Design 120 section 7.3)', () => {
  const REGION: LzRegion = {
    id: 'eu-de',
    country: 'DE',
    sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: ['BSI_C5'] },
    services: [
      { code: 'ecs', status: 'ga', capabilities: [], fulfills: ['vm_compute'], key_custody: [] },
      { code: 'obs', status: 'ga', capabilities: [], fulfills: ['object_storage'], key_custody: [] },
    ],
  };
  const LIVE: LzLiveScanInput = {
    provider: 'otc',
    collection_mode: 'live',
    confidence: 'observed',
    scanned_at: T,
    provenance: { source: 'live:otc-test/platform' },
    meta: {
      lz_id: 'otc-test', provider: 'otc', scope_id: 'platform', scope_kind: 'platform',
      observed_at: T, driver_version: '0.1.0', read_only: 'verified',
      coverage: { readable: ['ecs', 'obs'], unreadable: [] },
    },
    offering: {
      regions: [{ id: 'eu-de', status: 'enabled' }],
      services: [
        { code: 'ecs', name: 'Elastic Cloud Server', capability_tags: ['vm_compute'],
          regions: { 'eu-de': { status: 'enabled', evidence: [{ source: 'api', ref: '/v3/auth/catalog' }], observed_at: T } } },
        { code: 'obs', name: 'Object Storage', capability_tags: ['object_storage'],
          regions: { 'eu-de': { status: 'available_not_enabled', evidence: [{ source: 'api', ref: '/v3/auth/catalog' }], observed_at: T } } },
      ],
    },
    estate: { resources: [{ id: 'res-1', type: 'ecs.instance', service_code: 'ecs', region: 'eu-de' }] },
  };

  it('produces the same fit as the equivalent hand-written scan', () => {
    const scan = projectLzLiveScan(parseLzLiveScan(LIVE));
    const report = computeLzFit({
      requiredServices: [{ code: 'vm_compute' }, { code: 'object_storage' }],
      region: REGION,
      scan,
      generatedAt: T,
    });
    const byCode = Object.fromEntries(report.items.map((i) => [i.service_code, i.verdict]));
    // ecs is enabled and has a resource: SUPPORTED; obs is offered but not enabled in the scope.
    expect(byCode['vm_compute']).toBe('SUPPORTED');
    expect(byCode['object_storage']).toBe('AVAILABLE_NOT_ENABLED');
    expect(report.overall).toBe('READY_WITH_CHANGES');
  });

  const withStatuses = (ecs: LzLiveRegionStatusInput, obs: LzLiveRegionStatusInput, region = 'eu-de'): LzLiveScanInput => ({
    ...LIVE,
    offering: {
      regions: [{ id: region, status: 'enabled' }],
      services: [
        { code: 'ecs', name: 'Elastic Cloud Server', capability_tags: ['vm_compute'], regions: { [region]: ecs } },
        { code: 'obs', name: 'Object Storage', capability_tags: ['object_storage'], regions: { [region]: obs } },
      ],
    },
  });
  const ENABLED: LzLiveRegionStatusInput = { status: 'enabled', evidence: [{ source: 'api', ref: '/v3/auth/catalog' }], observed_at: T };
  const RESTRICTED: LzLiveRegionStatusInput = { status: 'restricted', evidence: [{ source: 'policy', ref: 'org-policy/deny-ecs' }], observed_at: T };
  const UNKNOWN: LzLiveRegionStatusInput = { status: 'unknown', evidence: [{ source: 'api', ref: '/v1/obs', http_status: 403 }], observed_at: T };
  const NOT_OFFERED: LzLiveRegionStatusInput = { status: 'not_offered', evidence: [{ source: 'api', ref: '/v3/auth/catalog' }], observed_at: T };
  const fitLive = (live: LzLiveScanInput, required: LzRequiredService[] = [{ code: 'vm_compute' }, { code: 'object_storage' }], region: LzRegion = REGION) => {
    const report = computeLzFitFromLiveScan({ requiredServices: required, region, liveScan: parseLzLiveScan(live), generatedAt: T });
    return { report, byCode: Object.fromEntries(report.items.map((i) => [i.service_code, i.verdict])) };
  };

  // #3609 replaces the pin from #1771: the projection alone keeps only `enabled`
  // services, so `restricted` and `unknown` fell back to the static catalogue
  // and read as AVAILABLE_NOT_ENABLED. The live status now decides.
  it('a restricted service yields BLOCKED_BY_POLICY and overall BLOCKED (#3609)', () => {
    const { report, byCode } = fitLive(withStatuses(RESTRICTED, ENABLED));
    expect(byCode['vm_compute']).toBe('BLOCKED_BY_POLICY');
    expect(report.overall).toBe('BLOCKED');
    expect(report.items.find((i) => i.verdict === 'BLOCKED_BY_POLICY')!.detail).toMatch(/policy denies/);
  });

  it('an unknown service yields UNVERIFIED and overall NEEDS_VERIFICATION, never AVAILABLE_NOT_ENABLED (#3609)', () => {
    const { report, byCode } = fitLive(withStatuses(ENABLED, UNKNOWN));
    expect(byCode['object_storage']).toBe('UNVERIFIED');
    expect(byCode['vm_compute']).toBe('SUPPORTED');
    expect(report.overall).toBe('NEEDS_VERIFICATION');
  });

  it('restricted and unknown together: the blocker dominates (#3609)', () => {
    const { report, byCode } = fitLive(withStatuses(RESTRICTED, UNKNOWN));
    expect(byCode).toEqual({ vm_compute: 'BLOCKED_BY_POLICY', object_storage: 'UNVERIFIED' });
    expect(report.overall).toBe('BLOCKED');
  });

  it('a documentation-only requirement on a restricted service asks for verification (#3497 rule)', () => {
    const { report, byCode } = fitLive(withStatuses(RESTRICTED, ENABLED), [{ code: 'vm_compute', confidence: 'low' }, { code: 'object_storage' }]);
    expect(byCode['vm_compute']).toBe('BLOCKED_BY_POLICY');
    expect(report.overall).toBe('NEEDS_VERIFICATION');
  });

  it('not_offered observed live wins over a catalogue that lists the service', () => {
    const { byCode } = fitLive(withStatuses(NOT_OFFERED, ENABLED));
    expect(byCode['vm_compute']).toBe('NOT_AVAILABLE_IN_REGION');
  });

  it('an enabled service is SUPPORTED per the section 5.3 table, also without a provisioned resource', () => {
    const live: LzLiveScanInput = { ...withStatuses(ENABLED, ENABLED), estate: { resources: [] } };
    const { byCode } = fitLive(live);
    expect(byCode).toEqual({ vm_compute: 'SUPPORTED', object_storage: 'SUPPORTED' });
  });

  it('falls back to the static catalogue for a requirement the scan did not observe', () => {
    // Only ecs is observed; obs has no entry, and kubernetes is in neither scan nor catalogue.
    const live = withStatuses(RESTRICTED, ENABLED);
    live.offering = { ...live.offering, services: [live.offering!.services![0]!] };
    const { byCode } = fitLive(live, [{ code: 'vm_compute' }, { code: 'object_storage' }, { code: 'kubernetes' }]);
    expect(byCode).toEqual({ vm_compute: 'BLOCKED_BY_POLICY', object_storage: 'AVAILABLE_NOT_ENABLED', kubernetes: 'NOT_AVAILABLE_IN_REGION' });
  });

  it('uses only observations of the assessed region', () => {
    const { byCode } = fitLive(withStatuses(RESTRICTED, UNKNOWN, 'eu-nl'));
    // Nothing observed in eu-de, so the eu-nl restriction does not leak into the
    // eu-de fit: catalogue fallback, and nothing is enabled in the projection.
    expect(byCode).toEqual({ vm_compute: 'AVAILABLE_NOT_ENABLED', object_storage: 'AVAILABLE_NOT_ENABLED' });
  });

  it('keeps catalogue qualifier checks for a live-enabled service', () => {
    const region: LzRegion = { ...REGION, services: [{ ...REGION.services[0]!, max_version: 14 }, REGION.services[1]!] };
    const { byCode } = fitLive(withStatuses(ENABLED, ENABLED), [{ code: 'vm_compute@16' }, { code: 'object_storage' }], region);
    expect(byCode['vm_compute@16']).toBe('VERSION_MISMATCH');
  });

  it('a sovereignty failure still yields SOVEREIGNTY_GAP for observed services', () => {
    const report = computeLzFitFromLiveScan({
      requiredServices: [{ code: 'vm_compute' }], region: REGION, liveScan: parseLzLiveScan(withStatuses(RESTRICTED, ENABLED)), generatedAt: T,
      sovereigntyRequirements: { require_certifications: ['HIPAA'] },
    });
    expect(report.items[0]!.verdict).toBe('SOVEREIGNTY_GAP');
    expect(report.overall).toBe('SOVEREIGNTY_BLOCKED');
  });

  it('computeLzFit without liveStatus keeps the projection-only result (static path unchanged)', () => {
    const report = computeLzFit({
      requiredServices: [{ code: 'vm_compute' }, { code: 'object_storage' }],
      region: REGION,
      scan: projectLzLiveScan(parseLzLiveScan(withStatuses(RESTRICTED, UNKNOWN))),
      generatedAt: T,
    });
    expect(report.items.map((i) => i.verdict)).toEqual(['AVAILABLE_NOT_ENABLED', 'AVAILABLE_NOT_ENABLED']);
  });

  it('an explicit liveStatus map on computeLzFit is honoured', () => {
    const report = computeLzFit({
      requiredServices: [{ code: 'vm_compute' }],
      region: REGION,
      scan: projectLzLiveScan(parseLzLiveScan(LIVE)),
      liveStatus: new Map<string, LzLiveStatus>([['vm_compute', 'unknown']]),
      generatedAt: T,
    });
    expect(report.items[0]!.verdict).toBe('UNVERIFIED');
  });
});
