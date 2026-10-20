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

// #3160: the five reference catalogues parse against their Zod schemas, and
// the loaders report a reason instead of throwing.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  resolveControlsFile,
  loadVendorSdkCatalogue,
  loadLegacyIndicatorsCatalogue,
  loadDbCompatibilityCatalogue,
  loadSovereignServiceCatalogue,
  loadLicenceRiskCatalogue,
  VENDOR_SDK_CATALOGUE_FILE,
  LEGACY_INDICATORS_CATALOGUE_FILE,
  DB_COMPATIBILITY_CATALOGUE_FILE,
  SOVEREIGN_SERVICE_CATALOGUE_FILE,
  LICENCE_RISK_CATALOGUE_FILE,
} from './reference-catalogues.js';

describe('resolveControlsFile', () => {
  it('finds every reference catalogue in swao/controls/', () => {
    for (const f of [
      VENDOR_SDK_CATALOGUE_FILE,
      LEGACY_INDICATORS_CATALOGUE_FILE,
      DB_COMPATIBILITY_CATALOGUE_FILE,
      SOVEREIGN_SERVICE_CATALOGUE_FILE,
      LICENCE_RISK_CATALOGUE_FILE,
    ]) {
      const p = resolveControlsFile(f);
      expect(p, f).not.toBeNull();
      // Plain suffix check: no regex built from the file name, so no escaping is needed.
      const norm = p!.replace(/\\/g, '/');
      expect(norm.endsWith(`/controls/${f}`), norm).toBe(true);
    }
  });

  it('returns null for a file that does not exist', () => {
    expect(resolveControlsFile('no-such-catalogue.yaml')).toBeNull();
  });
});

describe('real catalogues parse against their schemas', () => {
  it('vendor-sdk-catalogue.yaml', () => {
    const r = loadVendorSdkCatalogue();
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    if (r.ok) expect(r.data.sdks.length).toBeGreaterThanOrEqual(15);
  });

  it('legacy-indicators-catalogue.yaml', () => {
    const r = loadLegacyIndicatorsCatalogue();
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    if (r.ok) {
      expect(r.data.tiers.tier_1_blockers.length).toBeGreaterThan(0);
      expect(r.data.tiers.tier_2_complicators.length).toBeGreaterThan(0);
      expect(r.data.tiers.tier_3_manageable.length).toBeGreaterThan(0);
    }
  });

  it('db-compatibility-catalogue.yaml', () => {
    const r = loadDbCompatibilityCatalogue();
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    if (r.ok) expect(new Set(r.data.engines.map((e) => e.engine))).toContain('postgres');
  });

  it('sovereign-service-catalogue.yaml', () => {
    const r = loadSovereignServiceCatalogue();
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    if (r.ok) {
      const ids = r.data.services.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('licence-risk-catalogue.yaml', () => {
    const r = loadLicenceRiskCatalogue();
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    if (r.ok) expect(r.data.licences.find((l) => l.spdx_id === 'AGPL-3.0')?.risk_tier).toBe('critical');
  });
});

describe('loader failure modes', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('missing file: ok false with a reason', () => {
    const r = loadLicenceRiskCatalogue(join(tmpdir(), 'swao-3160-missing.yaml'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not found');
  });

  it('invalid YAML: ok false, does not throw', () => {
    dir = mkdtempSync(join(tmpdir(), 'swao-3160-cat-'));
    const p = join(dir, 'bad.yaml');
    writeFileSync(p, 'licences: [unclosed', 'utf-8');
    const r = loadLicenceRiskCatalogue(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('unreadable');
  });

  it('schema mismatch: ok false naming the field', () => {
    dir = mkdtempSync(join(tmpdir(), 'swao-3160-cat-'));
    const p = join(dir, 'bad.yaml');
    writeFileSync(p, 'licences:\n  - spdx_id: MIT\n    risk_tier: unknown_tier\n', 'utf-8');
    const r = loadLicenceRiskCatalogue(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('risk_tier');
  });
});
