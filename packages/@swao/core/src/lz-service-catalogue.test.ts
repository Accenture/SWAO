// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { regionFulfills, type LzRegion } from './lz-service-catalogue.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRegion(services: LzRegion['services']): LzRegion {
  return { id: 'test-region', services };
}

const pgService: LzRegion['services'][number] = {
  code: 'postgresql-flex',
  status: 'ga',
  fulfills: ['postgresql'],
  capabilities: ['pgaudit_supported'],
  key_custody: [],
  max_version: 17,
};

const pgNoVersionService: LzRegion['services'][number] = {
  code: 'postgresql-basic',
  status: 'ga',
  fulfills: ['postgresql'],
  capabilities: [],
  key_custody: [],
};

const k8sService: LzRegion['services'][number] = {
  code: 'kubernetes-engine',
  status: 'ga',
  fulfills: ['kubernetes'],
  capabilities: [],
  key_custody: [],
};

const retiredService: LzRegion['services'][number] = {
  code: 'old-pg',
  status: 'retired',
  fulfills: ['postgresql'],
  capabilities: ['pgaudit_supported'],
  key_custody: [],
  max_version: 14,
};

// ---------------------------------------------------------------------------
// Base (unqualified) matching -- identical behaviour to before #1323
// ---------------------------------------------------------------------------

describe('regionFulfills -- base (unqualified)', () => {
  it('returns true when a GA service fulfils the capability', () => {
    expect(regionFulfills(makeRegion([pgService]), 'postgresql')).toBe(true);
  });

  it('returns true when a preview service fulfils the capability', () => {
    const preview = { ...pgService, status: 'preview' as const };
    expect(regionFulfills(makeRegion([preview]), 'postgresql')).toBe(true);
  });

  it('returns false when no service fulfils the capability', () => {
    expect(regionFulfills(makeRegion([k8sService]), 'postgresql')).toBe(false);
  });

  it('returns false when the only matching service is retired', () => {
    expect(regionFulfills(makeRegion([retiredService]), 'postgresql')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// @<major> version qualifier (#1323)
// ---------------------------------------------------------------------------

describe('regionFulfills -- @<major> version qualifier', () => {
  it('returns true when service max_version >= requested major', () => {
    // max_version=17, requested=15
    expect(regionFulfills(makeRegion([pgService]), 'postgresql@15')).toBe(true);
  });

  it('returns true when service max_version equals requested major exactly', () => {
    expect(regionFulfills(makeRegion([pgService]), 'postgresql@17')).toBe(true);
  });

  it('returns false when service max_version < requested major', () => {
    // max_version=17, requested=18
    expect(regionFulfills(makeRegion([pgService]), 'postgresql@18')).toBe(false);
  });

  it('returns false when the matching service has no max_version set', () => {
    // pgNoVersionService has no max_version -- cannot satisfy any version constraint
    expect(regionFulfills(makeRegion([pgNoVersionService]), 'postgresql@15')).toBe(false);
  });

  it('returns false when the region does not offer the base capability at all', () => {
    expect(regionFulfills(makeRegion([k8sService]), 'postgresql@15')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// +<cap> capability qualifier (#1323)
// ---------------------------------------------------------------------------

describe('regionFulfills -- +<cap> capability qualifier', () => {
  it('returns true when service carries the exact cap tag', () => {
    const withLiteralCap = { ...pgService, capabilities: ['pgaudit'] };
    expect(regionFulfills(makeRegion([withLiteralCap]), 'postgresql+pgaudit')).toBe(true);
  });

  it('returns true when service carries the cap_supported convention', () => {
    // pgService has capabilities: ['pgaudit_supported']
    expect(regionFulfills(makeRegion([pgService]), 'postgresql+pgaudit')).toBe(true);
  });

  it('returns false when service does not carry the capability', () => {
    // pgNoVersionService has capabilities: []
    expect(regionFulfills(makeRegion([pgNoVersionService]), 'postgresql+pgaudit')).toBe(false);
  });

  it('returns false when the region does not offer the base capability', () => {
    expect(regionFulfills(makeRegion([k8sService]), 'postgresql+pgaudit')).toBe(false);
  });

  it('returns false when the only matching service is retired', () => {
    expect(regionFulfills(makeRegion([retiredService]), 'postgresql+pgaudit')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LzServiceSchema accepts max_version field
// ---------------------------------------------------------------------------

import { LzServiceSchema } from './lz-service-catalogue.js';

describe('LzServiceSchema', () => {
  it('accepts a service with max_version', () => {
    const result = LzServiceSchema.safeParse({
      code: 'postgresql-flex',
      status: 'ga',
      capabilities: ['pgaudit_supported'],
      fulfills: ['postgresql'],
      key_custody: [],
      max_version: 17,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.max_version).toBe(17);
  });

  it('accepts a service without max_version', () => {
    const result = LzServiceSchema.safeParse({
      code: 'kubernetes-engine',
      status: 'ga',
      capabilities: [],
      fulfills: ['kubernetes'],
      key_custody: [],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.max_version).toBeUndefined();
  });
});
