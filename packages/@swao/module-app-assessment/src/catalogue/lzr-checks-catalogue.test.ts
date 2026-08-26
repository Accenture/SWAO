// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
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
  loadLzrChecksCatalogue,
  getChecksForProvider,
  getChecksByCategory,
  getBlockerChecks,
} from './lzr-checks-catalogue.js';

describe('loadLzrChecksCatalogue (#0104)', () => {
  it('loads and returns 10+ checks', () => {
    const checks = loadLzrChecksCatalogue();
    expect(checks.length).toBeGreaterThanOrEqual(10);
  });

  it('all checks have required fields: id, name, category, severity, providers', () => {
    const checks = loadLzrChecksCatalogue();
    for (const check of checks) {
      expect(check.id).toBeTruthy();
      expect(check.name).toBeTruthy();
      expect(['service', 'quota', 'policy', 'network', 'compliance']).toContain(check.category);
      expect(['blocker', 'warning', 'info']).toContain(check.severity);
      expect(check.providers === 'all' || Array.isArray(check.providers)).toBe(true);
    }
  });

  it('check IDs are unique', () => {
    const checks = loadLzrChecksCatalogue();
    const ids = checks.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('has at least 5 STACKIT-specific checks', () => {
    const checks = loadLzrChecksCatalogue();
    const stackit = checks.filter(
      (c) => c.providers !== 'all' && (c.providers as string[]).includes('stackit_de_sovereign'),
    );
    expect(stackit.length).toBeGreaterThanOrEqual(5);
  });

  it('has at least 5 generic cross-provider checks', () => {
    const checks = loadLzrChecksCatalogue();
    const generic = checks.filter((c) => c.providers === 'all');
    expect(generic.length).toBeGreaterThanOrEqual(5);
  });
});

describe('getChecksForProvider (#0104)', () => {
  it('returns STACKIT-specific + generic checks for stackit_de_sovereign', () => {
    const checks = getChecksForProvider('stackit_de_sovereign');
    expect(checks.length).toBeGreaterThanOrEqual(10);
    const hasStackitSpecific = checks.some((c) => c.id.startsWith('LZC-STACKIT-'));
    const hasGeneric = checks.some((c) => c.id.startsWith('LZC-GEN-'));
    expect(hasStackitSpecific).toBe(true);
    expect(hasGeneric).toBe(true);
  });

  it('returns only generic checks for an unknown provider', () => {
    const checks = getChecksForProvider('unknown_provider');
    expect(checks.every((c) => c.providers === 'all')).toBe(true);
  });
});

describe('getChecksByCategory (#0104)', () => {
  it('returns service checks', () => {
    const checks = getChecksByCategory('service');
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.category === 'service')).toBe(true);
  });

  it('returns compliance checks', () => {
    const checks = getChecksByCategory('compliance');
    expect(checks.length).toBeGreaterThan(0);
  });
});

describe('getBlockerChecks (#0104)', () => {
  it('returns only blocker-severity checks', () => {
    const checks = getBlockerChecks();
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.severity === 'blocker')).toBe(true);
  });

  it('returns provider-filtered blocker checks for stackit_de_sovereign', () => {
    const all = getBlockerChecks();
    const stackit = getBlockerChecks('stackit_de_sovereign');
    expect(stackit.length).toBeLessThanOrEqual(all.length);
    expect(stackit.every((c) => c.severity === 'blocker')).toBe(true);
  });
});
