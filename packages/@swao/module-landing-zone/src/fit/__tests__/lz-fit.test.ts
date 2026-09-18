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
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LzRegion, LzScanResult } from '@swao/core';
import { computeLzFit, sovereigntyFailures, detectCoverageGap, type SovereigntyRequirements } from '../lz-fit.js';

// Frankfurt region: offers eks + rds-postgres + s3 + vpc + kms; carries us_cloud_act exposure.
// Catalogue region: services declare the abstract capability they fulfil.
const REGION: LzRegion = {
  id: 'eu-central-1',
  country: 'DE',
  sovereignty: { residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act'], certifications: ['C5'] },
  services: [
    { code: 'eks', status: 'ga', capabilities: [], fulfills: ['kubernetes'], key_custody: [] },
    { code: 'rds-postgresql', status: 'ga', capabilities: [], fulfills: ['postgresql'], key_custody: [] },
    { code: 's3', status: 'ga', capabilities: [], fulfills: ['object_storage'], key_custody: [] },
    { code: 'vpc', status: 'ga', capabilities: [], fulfills: ['network'], key_custody: [] },
    { code: 'kms', status: 'ga', capabilities: [], fulfills: ['kms'], key_custody: [] },
  ],
};

// All four baseline categories (compute/network/kms/storage) covered -- yields READY.
const ALL_BASELINE_SERVICES = [
  { code: 'kubernetes' }, // compute
  { code: 'network' },    // network
  { code: 'kms' },        // kms
  { code: 'object_storage' }, // storage
];

// Scan: kubernetes + object_storage + vpc + kms provisioned; postgresql NOT enabled.
const SCAN: LzScanResult = {
  provider: 'aws',
  collection_mode: 'export',
  confidence: 'observed',
  scanned_at: '2026-06-24',
  regions: ['eu-central-1'],
  enabled_services: [
    { code: 'eks', provisioned: true, fulfills: ['kubernetes'] },
    { code: 's3', provisioned: true, fulfills: ['object_storage'] },
    { code: 'vpc', provisioned: true, fulfills: ['network'] },
    { code: 'kms', provisioned: true, fulfills: ['kms'] },
  ],
  guardrails: [],
  quotas: [],
  provenance: { source: 'aws-snapshot' },
};

describe('computeLzFit verdicts (#0567)', () => {
  it('SUPPORTED + AVAILABLE_NOT_ENABLED + NOT_AVAILABLE_IN_REGION (no sovereignty reqs)', () => {
    const report = computeLzFit({
      requiredServices: [
        { code: 'kubernetes' },     // available + enabled -> SUPPORTED
        { code: 'postgresql' },     // available, not enabled -> AVAILABLE_NOT_ENABLED
        { code: 'serverless_fn' },  // no service fulfils it -> NOT_AVAILABLE_IN_REGION
      ],
      region: REGION,
      scan: SCAN,
    });
    const byCode = Object.fromEntries(report.items.map((i) => [i.service_code, i.verdict]));
    expect(byCode['kubernetes']).toBe('SUPPORTED');
    expect(byCode['postgresql']).toBe('AVAILABLE_NOT_ENABLED');
    expect(byCode['serverless_fn']).toBe('NOT_AVAILABLE_IN_REGION');
    // a hard unavailability dominates the change -> BLOCKED
    expect(report.overall).toBe('BLOCKED');
  });

  it('READY_WITH_CHANGES when only enable-gaps remain', () => {
    const report = computeLzFit({
      requiredServices: [{ code: 'kubernetes' }, { code: 'postgresql' }],
      region: REGION,
      scan: SCAN,
    });
    expect(report.overall).toBe('READY_WITH_CHANGES');
  });

  it('READY when everything is supported and all four baseline categories covered', () => {
    const report = computeLzFit({ requiredServices: ALL_BASELINE_SERVICES, region: REGION, scan: SCAN });
    expect(report.overall).toBe('READY');
    expect(report.items.every((i) => i.verdict === 'SUPPORTED')).toBe(true);
  });

  it('NEEDS_VERIFICATION when all required services are SUPPORTED but baseline coverage is incomplete (#1506/#1511)', () => {
    const report = computeLzFit({ requiredServices: [{ code: 'kubernetes' }, { code: 'object_storage' }], region: REGION, scan: SCAN });
    expect(report.overall).toBe('NEEDS_VERIFICATION');
    expect(report.items.every((i) => i.verdict === 'SUPPORTED')).toBe(true);
  });

  it('SOVEREIGNTY_GAP (framework-driven) dominates: us_cloud_act forbidden', () => {
    const sov: SovereigntyRequirements = { forbid_exposure: ['us_cloud_act'], derived_from: ['GDPR'] };
    const report = computeLzFit({ requiredServices: [{ code: 'kubernetes' }], region: REGION, scan: SCAN, sovereigntyRequirements: sov });
    expect(report.items[0]!.verdict).toBe('SOVEREIGNTY_GAP');
    expect(report.overall).toBe('SOVEREIGNTY_BLOCKED');
    expect(report.sovereignty_statement).toContain('GDPR');
    expect(report.sovereignty_statement).toContain('FAILS');
  });

  it('no sovereignty gap when the region satisfies the requirements (incomplete baseline -> NEEDS_VERIFICATION)', () => {
    const sov: SovereigntyRequirements = { forbid_exposure: ['us_cloud_act'], derived_from: ['GDPR'] };
    const sovereignRegion: LzRegion = { ...REGION, sovereignty: { ...REGION.sovereignty!, operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [] } };
    const report = computeLzFit({ requiredServices: [{ code: 'kubernetes' }], region: sovereignRegion, scan: SCAN, sovereigntyRequirements: sov });
    expect(report.items[0]!.verdict).toBe('SUPPORTED');
    // Only compute covered -- baseline incomplete -> NEEDS_VERIFICATION not READY (#1511)
    expect(report.overall).toBe('NEEDS_VERIFICATION');
  });

  it('READY with sovereignty pass when all four baseline categories covered', () => {
    const sov: SovereigntyRequirements = { forbid_exposure: ['us_cloud_act'], derived_from: ['GDPR'] };
    const sovereignRegion: LzRegion = { ...REGION, sovereignty: { ...REGION.sovereignty!, operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [] } };
    const report = computeLzFit({ requiredServices: ALL_BASELINE_SERVICES, region: sovereignRegion, scan: SCAN, sovereigntyRequirements: sov });
    expect(report.overall).toBe('READY');
  });

  it('sovereigntyFailures is a pure check over facts', () => {
    expect(sovereigntyFailures(REGION, { forbid_exposure: ['us_cloud_act'] })).toHaveLength(1);
    expect(sovereigntyFailures(REGION, { require_operator_jurisdiction: ['EU-entity'] })).toHaveLength(1);
    expect(sovereigntyFailures(REGION, undefined)).toHaveLength(0);
  });
});

// Empty scan (provenance.source === 'no-snapshot') used in catalogue-only mode.
const EMPTY_SCAN: LzScanResult = {
  provider: 'stackit',
  collection_mode: 'export',
  confidence: 'observed',
  scanned_at: '2026-07-09',
  regions: [],
  enabled_services: [],
  guardrails: [],
  quotas: [],
  provenance: { source: 'no-snapshot' },
};

describe('computeLzFit catalogueMode (#0897)', () => {
  it('available service rates SUPPORTED in catalogue mode (not AVAILABLE_NOT_ENABLED)', () => {
    const report = computeLzFit({
      requiredServices: [{ code: 'postgresql' }],
      region: REGION,
      scan: EMPTY_SCAN,
      catalogueMode: true,
    });
    expect(report.items[0]!.verdict).toBe('SUPPORTED');
    // Only postgresql covered -- baseline incomplete -> NEEDS_VERIFICATION (#1511)
    expect(report.overall).toBe('NEEDS_VERIFICATION');
  });

  it('unavailable service still rates NOT_AVAILABLE_IN_REGION in catalogue mode', () => {
    const report = computeLzFit({
      requiredServices: [{ code: 'serverless_fn' }],
      region: REGION,
      scan: EMPTY_SCAN,
      catalogueMode: true,
    });
    expect(report.items[0]!.verdict).toBe('NOT_AVAILABLE_IN_REGION');
    expect(report.overall).toBe('BLOCKED');
  });

  it('sovereignty gap still blocks in catalogue mode', () => {
    const sov = { forbid_exposure: ['us_cloud_act'], derived_from: ['GDPR'] };
    const report = computeLzFit({
      requiredServices: [{ code: 'postgresql' }],
      region: REGION,
      scan: EMPTY_SCAN,
      sovereigntyRequirements: sov,
      catalogueMode: true,
    });
    expect(report.items[0]!.verdict).toBe('SOVEREIGNTY_GAP');
    expect(report.overall).toBe('SOVEREIGNTY_BLOCKED');
  });

  it('all available = READY with no gap signals in catalogue mode (all four baseline categories)', () => {
    const report = computeLzFit({
      requiredServices: ALL_BASELINE_SERVICES,
      region: REGION,
      scan: EMPTY_SCAN,
      catalogueMode: true,
    });
    expect(report.overall).toBe('READY');
    expect(report.items.every((i) => i.verdict === 'SUPPORTED')).toBe(true);
  });

  it('default (no catalogueMode) still produces AVAILABLE_NOT_ENABLED for empty scan', () => {
    const report = computeLzFit({
      requiredServices: [{ code: 'postgresql' }],
      region: REGION,
      scan: EMPTY_SCAN,
    });
    expect(report.items[0]!.verdict).toBe('AVAILABLE_NOT_ENABLED');
  });

  it('#1106: SOVEREIGNTY_BLOCKED when requiredServices is empty but region fails sovereignty', () => {
    const sov: SovereigntyRequirements = { forbid_exposure: ['us_cloud_act'], derived_from: ['BSI_C5'] };
    const report = computeLzFit({
      requiredServices: [],
      region: REGION,
      scan: EMPTY_SCAN,
      sovereigntyRequirements: sov,
      catalogueMode: true,
    });
    expect(report.overall).toBe('SOVEREIGNTY_BLOCKED');
    expect(report.items).toHaveLength(0);
    expect(report.sovereignty_statement).toContain('FAILS');
    expect(report.sovereignty_statement).toContain('BSI_C5');
  });

  it('#1106/#1506: NEEDS_VERIFICATION when requiredServices is empty and region satisfies sovereignty (no service evidence)', () => {
    const sov: SovereigntyRequirements = { forbid_exposure: ['us_cloud_act'], derived_from: ['BSI_C5'] };
    const sovereignRegion: LzRegion = { ...REGION, sovereignty: { ...REGION.sovereignty!, extraterritorial_exposure: [], operator_jurisdiction: 'EU-entity', certifications: ['C5', 'ISO_27001'] } };
    const report = computeLzFit({
      requiredServices: [],
      region: sovereignRegion,
      scan: EMPTY_SCAN,
      sovereigntyRequirements: sov,
      catalogueMode: true,
    });
    // No service checks -> cannot issue READY (#1506)
    expect(report.overall).toBe('NEEDS_VERIFICATION');
    expect(report.items).toHaveLength(0);
    expect(report.sovereignty_statement).toContain('satisfies');
  });
});

describe('require_certifications -- BSI_C5 key normalisation (#1242)', () => {
  it('region holding BSI_C5 satisfies require_certifications check (no services -> NEEDS_VERIFICATION)', () => {
    const sov: SovereigntyRequirements = {
      forbid_exposure: [],
      require_certifications: ['BSI_C5'],
      derived_from: ['BSI_C5'],
    };
    const region: LzRegion = {
      ...REGION,
      sovereignty: { ...REGION.sovereignty!, extraterritorial_exposure: [], operator_jurisdiction: 'EU-entity', certifications: ['BSI_C5', 'ISO_27001'] },
    };
    const report = computeLzFit({ requiredServices: [], region, scan: EMPTY_SCAN, sovereigntyRequirements: sov, catalogueMode: true });
    // Sovereignty passes but no service checks -> NEEDS_VERIFICATION (#1506)
    expect(report.overall).toBe('NEEDS_VERIFICATION');
    expect(report.sovereignty_statement).toContain('satisfies');
  });

  it('non-canonical C5 key fails require_certifications BSI_C5 (documents why catalog normalisation is required)', () => {
    const sov: SovereigntyRequirements = {
      forbid_exposure: [],
      require_certifications: ['BSI_C5'],
      derived_from: ['BSI_C5'],
    };
    const region: LzRegion = {
      ...REGION,
      sovereignty: { ...REGION.sovereignty!, extraterritorial_exposure: [], operator_jurisdiction: 'EU-entity', certifications: ['C5', 'ISO_27001'] },
    };
    const report = computeLzFit({ requiredServices: [], region, scan: EMPTY_SCAN, sovereigntyRequirements: sov, catalogueMode: true });
    expect(report.overall).toBe('SOVEREIGNTY_BLOCKED');
    expect(report.sovereignty_statement).toContain('FAILS');
    expect(report.sovereignty_statement).toContain('BSI_C5');
  });
});

describe('sovereignty_active flag (#1241)', () => {
  it('false when no sovereigntyRequirements provided (DEMO run)', () => {
    const report = computeLzFit({ requiredServices: [], region: REGION, scan: EMPTY_SCAN, catalogueMode: true });
    expect(report.sovereignty_active).toBe(false);
  });

  it('true when sovereigntyRequirements provided', () => {
    const sov: SovereigntyRequirements = { forbid_exposure: ['us_cloud_act'], derived_from: ['GDPR'] };
    const report = computeLzFit({ requiredServices: [], region: REGION, scan: EMPTY_SCAN, sovereigntyRequirements: sov, catalogueMode: true });
    expect(report.sovereignty_active).toBe(true);
  });
});

describe('blocker_category taxonomy (#1246)', () => {
  it('structural when only exposure fails', () => {
    const sov: SovereigntyRequirements = { forbid_exposure: ['us_cloud_act'], derived_from: ['GDPR'] };
    const report = computeLzFit({ requiredServices: [], region: REGION, scan: EMPTY_SCAN, sovereigntyRequirements: sov, catalogueMode: true });
    expect(report.overall).toBe('SOVEREIGNTY_BLOCKED');
    expect(report.blocker_category).toBe('structural');
  });

  it('certification when only cert check fails', () => {
    const sov: SovereigntyRequirements = {
      forbid_exposure: [],
      require_certifications: ['ISO_27001'],
      derived_from: ['BSI_C5'],
    };
    const report = computeLzFit({ requiredServices: [], region: REGION, scan: EMPTY_SCAN, sovereigntyRequirements: sov, catalogueMode: true });
    expect(report.overall).toBe('SOVEREIGNTY_BLOCKED');
    expect(report.blocker_category).toBe('certification');
  });

  it('mixed when both structural and certification fail', () => {
    const sov: SovereigntyRequirements = {
      forbid_exposure: ['us_cloud_act'],
      require_certifications: ['ISO_27001'],
      derived_from: ['GDPR', 'BSI_C5'],
    };
    const report = computeLzFit({ requiredServices: [], region: REGION, scan: EMPTY_SCAN, sovereigntyRequirements: sov, catalogueMode: true });
    expect(report.overall).toBe('SOVEREIGNTY_BLOCKED');
    expect(report.blocker_category).toBe('mixed');
  });

  it('blocker_category absent when verdict is not SOVEREIGNTY_BLOCKED (NEEDS_VERIFICATION with empty services)', () => {
    const sov: SovereigntyRequirements = { forbid_exposure: [], derived_from: ['GDPR'] };
    const sovereignRegion: LzRegion = { ...REGION, sovereignty: { ...REGION.sovereignty!, extraterritorial_exposure: [], operator_jurisdiction: 'EU-entity' } };
    const report = computeLzFit({ requiredServices: [], region: sovereignRegion, scan: EMPTY_SCAN, sovereigntyRequirements: sov, catalogueMode: true });
    // No services -> NEEDS_VERIFICATION (#1506); blocker_category only set on SOVEREIGNTY_BLOCKED
    expect(report.overall).toBe('NEEDS_VERIFICATION');
    expect(report.blocker_category).toBeUndefined();
  });

  it('blocker_category absent when READY with full baseline coverage', () => {
    const sov: SovereigntyRequirements = { forbid_exposure: [], derived_from: ['GDPR'] };
    const sovereignRegion: LzRegion = { ...REGION, sovereignty: { ...REGION.sovereignty!, extraterritorial_exposure: [], operator_jurisdiction: 'EU-entity' } };
    const report = computeLzFit({ requiredServices: ALL_BASELINE_SERVICES, region: sovereignRegion, scan: EMPTY_SCAN, sovereigntyRequirements: sov, catalogueMode: true });
    expect(report.overall).toBe('READY');
    expect(report.blocker_category).toBeUndefined();
  });
});

describe('detectCoverageGap -- service footprint warning (#1244)', () => {
  it('returns undefined when all four baseline categories are covered', () => {
    const result = detectCoverageGap([
      { code: 'kubernetes' },     // compute
      { code: 'vpc' },            // network
      { code: 'kms' },            // kms
      { code: 'object_storage' }, // storage
    ]);
    expect(result).toBeUndefined();
  });

  it('returns warning for a single-service inventory (postgresql only)', () => {
    const result = detectCoverageGap([{ code: 'postgresql' }]);
    expect(result).toBeDefined();
    expect(result).toContain('1 service(s) assessed');
    expect(result).toContain('compute/network/kms/storage');
    expect(result).toContain('missing: compute, network, kms, storage');
  });

  it('identifies only the missing categories (compute + storage covered -> network + kms missing)', () => {
    const result = detectCoverageGap([{ code: 'kubernetes' }, { code: 'object_storage' }]);
    expect(result).toContain('missing: network, kms');
    // compute and storage are covered so they must not appear in the "missing:" clause
    expect(result).toMatch(/missing: network, kms(?!.*compute)(?!.*storage)/);
  });

  it('computeLzFit includes coverage_warning when footprint is incomplete', () => {
    const report = computeLzFit({
      requiredServices: [{ code: 'postgresql' }],
      region: REGION,
      scan: EMPTY_SCAN,
      catalogueMode: true,
    });
    expect(report.coverage_warning).toBeDefined();
    expect(report.coverage_warning).toContain('service footprint incomplete');
  });

  it('computeLzFit does NOT include coverage_warning when all categories are covered', () => {
    const fullRegion: LzRegion = {
      ...REGION,
      services: [
        ...REGION.services,
        { code: 'network', status: 'ga', capabilities: [], fulfills: ['vpc'], key_custody: [] },
        { code: 'kms', status: 'ga', capabilities: [], fulfills: ['kms'], key_custody: [] },
      ],
    };
    const report = computeLzFit({
      requiredServices: [
        { code: 'kubernetes' },
        { code: 'vpc' },
        { code: 'kms' },
        { code: 'object_storage' },
      ],
      region: fullRegion,
      scan: EMPTY_SCAN,
      catalogueMode: true,
    });
    expect(report.coverage_warning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Bundled seed vocabulary + aws-iso-e sovereignty facts (#1381 / #1382)
// ---------------------------------------------------------------------------
// The fit gate matches certification IDs verbatim (see #1242 suite above), so
// every bundled lz-catalogues/*.json seed must use the canonical vocabulary.
// aws-iso-e previously claimed "C5", an EU-entity operator, and no
// extraterritorial exposure -- unsubstantiated for an AWS isolated partition.

describe('bundled lz-catalogues seeds (#1381 / #1382)', () => {
  const seedsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../../../lz-catalogues');

  const CANONICAL_CERTIFICATIONS = new Set([
    'BSI_C5', 'ISO_27001', 'SOC_2', 'PCI_DSS', 'HIPAA',
    'FedRAMP_High', 'IRAP', 'MAS_TRM',
  ]);

  const seedFiles = readdirSync(seedsDir).filter(
    f => f.endsWith('.json') && f !== 'index.json' && f !== 'aws-service-meta.json',
  );

  it('finds the bundled provider seeds', () => {
    expect(seedFiles.length).toBeGreaterThanOrEqual(6);
  });

  it('every seed region uses only canonical certification IDs (never the C5 alias)', () => {
    for (const f of seedFiles) {
      const seed = JSON.parse(readFileSync(join(seedsDir, f), 'utf-8')) as {
        regions?: Array<{ id: string; sovereignty?: { certifications?: string[] } }>;
      };
      for (const region of seed.regions ?? []) {
        for (const cert of region.sovereignty?.certifications ?? []) {
          expect(cert, `${f} region ${region.id} certification "${cert}"`).not.toBe('C5');
          expect(
            CANONICAL_CERTIFICATIONS.has(cert),
            `${f} region ${region.id}: certification "${cert}" is not in the canonical vocabulary`,
          ).toBe(true);
        }
      }
    }
  });

  it('aws-iso-e carries defensible sovereignty facts (#1382)', () => {
    const seed = JSON.parse(readFileSync(join(seedsDir, 'aws-iso-e.json'), 'utf-8')) as {
      meta: { confidence: string };
      regions: Array<{ id: string; sovereignty: { operator_jurisdiction: string; extraterritorial_exposure: string[]; certifications: string[] } }>;
    };
    expect(seed.meta.confidence).toBe('low');
    const region = seed.regions.find(r => r.id === 'eu-isoe-west-1');
    expect(region).toBeDefined();
    expect(region!.sovereignty.operator_jurisdiction).toBe('US-entity');
    expect(region!.sovereignty.extraterritorial_exposure).toEqual(
      expect.arrayContaining(['us_cloud_act', 'fisa_702']),
    );
    expect(region!.sovereignty.certifications).toEqual([]);
  });
});
