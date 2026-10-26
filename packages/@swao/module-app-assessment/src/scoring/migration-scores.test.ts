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

// #3431: deterministic cloud-native and portability scores.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { dump } from 'js-yaml';
import {
  computeCloudNativeScore,
  computePortabilityScore,
  computeMigrationScores,
  factorKey,
  type PortabilityInputs,
} from './migration-scores.js';
import { loadMigrationScoresCatalogue, type MigrationScoresCatalogue } from '../catalogue/migration-scores-catalogue.js';
import { isSovereignRegion, loadSovereignAvailability, sovereignProvidersFor } from '../catalogue/lz-sovereign-availability.js';

const loaded = loadMigrationScoresCatalogue();
if (!loaded.ok) throw new Error(`catalogue: ${loaded.reason}`);
const cat: MigrationScoresCatalogue = loaded.data;

const RULE = cat.portability.service_availability;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

describe('migration-scores-catalogue.yaml', () => {
  it('loads with the documented weights', () => {
    expect(cat.cloud_native.status_values).toEqual({ pass: 1, partial: 0.5, unknown: 0.5, fail: 0 });
    expect(cat.portability.weights).toEqual({ service_availability: 0.35, vendor_lock: 0.25, container: 0.15, iac: 0.1, egress: 0.15 });
    expect(cat.portability.service_availability.min_sovereign_providers).toBe(2);
  });

  it('reports a missing catalogue instead of throwing', () => {
    const r = computeMigrationScores(tmpdir(), { cataloguePath: join(tmpdir(), 'no-such-catalogue.yaml') });
    expect(r.cloud_native).toBeNull();
    expect(r.portability).toBeNull();
    expect(r.catalogue).toMatch(/^skipped: /);
  });
});

// ---------------------------------------------------------------------------
// Cloud-native
// ---------------------------------------------------------------------------

const F = (factor: string, status: string) => ({ factor, status });

describe('computeCloudNativeScore', () => {
  it('keys factor weights by the Roman numeral prefix', () => {
    expect(factorKey('III (Config)')).toBe('III');
    expect(factorKey('IX (Disposability)')).toBe('IX');
  });

  it('counts unknown as 0.5 instead of excluding it (a Java service with 3 determinate factors)', () => {
    // Old rate: 2 pass / 3 determinate = 0.67. New: (1 + 1 + 0 + 0.5 + 0.5) / 5 = 0.6.
    const r = computeCloudNativeScore([
      F('III (Config)', 'pass'), F('II (Dependencies)', 'unknown'), F('VIII (Concurrency)', 'unknown'),
      F('XI (Logs)', 'pass'), F('IX (Disposability)', 'fail'),
    ], cat)!;
    expect(r.score).toBe(0.6);
    expect(r.factors_checked).toBe(3);
    expect(r.factors_total).toBe(5);
    expect(r.confidence).toBe('medium');
  });

  it('separates applications the pass rate could not (2/3 vs 2/4 now differ by unknown share)', () => {
    const a = computeCloudNativeScore([F('III (Config)', 'pass'), F('XI (Logs)', 'pass'), F('IX (Disposability)', 'partial'),
      F('II (Dependencies)', 'unknown'), F('VIII (Concurrency)', 'unknown')], cat)!;
    const b = computeCloudNativeScore([F('III (Config)', 'pass'), F('XI (Logs)', 'pass'), F('IX (Disposability)', 'fail'),
      F('II (Dependencies)', 'fail'), F('VIII (Concurrency)', 'unknown')], cat)!;
    expect(a.score).toBe(0.7);
    expect(b.score).toBe(0.5);
  });

  it('all factors unknown: 0.5 with factors_checked 0 and low confidence (visible, not hidden)', () => {
    const r = computeCloudNativeScore(['III', 'II', 'VIII', 'XI', 'IX'].map((k) => F(`${k} (x)`, 'unknown')), cat)!;
    expect(r.score).toBe(0.5);
    expect(r.factors_checked).toBe(0);
    expect(r.confidence).toBe('low');
  });

  it('all factors pass: 1.0, high confidence; an unrecognised status counts as unknown', () => {
    expect(computeCloudNativeScore([F('III (Config)', 'pass'), F('XI (Logs)', 'pass')], cat)).toMatchObject({ score: 1, confidence: 'high' });
    expect(computeCloudNativeScore([F('III (Config)', 'weird')], cat)).toMatchObject({ score: 0.5, factors_checked: 0 });
  });

  it('uses the catalogue weights', () => {
    const weighted: MigrationScoresCatalogue = { ...cat, cloud_native: { ...cat.cloud_native, factor_weights: { III: 3, XI: 1 } } };
    expect(computeCloudNativeScore([F('III (Config)', 'pass'), F('XI (Logs)', 'fail')], weighted)!.score).toBe(0.75);
  });

  it('returns null when no factor was reported', () => {
    expect(computeCloudNativeScore([], cat)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Portability (pure)
// ---------------------------------------------------------------------------

function inputs(over: Partial<PortabilityInputs> = {}): PortabilityInputs {
  return {
    serviceAvailability: {
      required: [
        { capability: 'postgresql', providers: ['p1', 'p2'] },
        { capability: 'kafka', providers: ['p1'] },
      ],
      sovereign_providers: ['p1', 'p2'],
      catalogue_source: 'bundled',
    },
    vendor: { check: 'no_match', hits: [] },
    runtime: { kubernetes: true, container: true, evidence: ['k8s_manifests'] },
    iac: { present: true, evidence: ['2 Terraform root(s)'] },
    egress: { verdicts: [], destinations: 0, hardcoded_hosts: [] },
    ...over,
  };
}

describe('computePortabilityScore', () => {
  it('is deterministic: identical input gives identical output', () => {
    expect(computePortabilityScore(inputs(), cat)).toEqual(computePortabilityScore(inputs(), cat));
  });

  it('weights the used components and renormalises over them', () => {
    // service 0.5 (1 of 2), vendor 1, container 1, iac 1; egress dropped.
    // (0.35*0.5 + 0.25 + 0.15 + 0.10) / 0.85 = 0.675 / 0.85 = 0.794
    const r = computePortabilityScore(inputs(), cat);
    expect(r.score).toBe(0.79);
    expect(r.components_used).toEqual(['service_availability', 'vendor_lock', 'container', 'iac']);
    expect(r.weight_coverage).toBe(0.85);
    const egress = r.components.find((c) => c.id === 'egress')!;
    expect(egress).toMatchObject({ used: false, value: null, reason: 'no egress destination detected' });
  });

  it('different footprints give different scores', () => {
    const portable = computePortabilityScore(inputs({ serviceAvailability: { required: [{ capability: 'postgresql', providers: ['p1', 'p2'] }], sovereign_providers: ['p1', 'p2'], catalogue_source: 'bundled' } }), cat);
    const locked = computePortabilityScore(inputs({ serviceAvailability: { required: [{ capability: 'kafka', providers: [] }, { capability: 'search', providers: ['p1'] }], sovereign_providers: ['p1', 'p2'], catalogue_source: 'bundled' } }), cat);
    expect(portable.score).toBe(1);
    expect(locked.score).toBe(0.59);
  });

  it('vendor lock hits lower the score by their sovereign impact', () => {
    const none = computePortabilityScore(inputs(), cat).score!;
    const partial = computePortabilityScore(inputs({ vendor: { check: 'matched', hits: [{ id: 'sdk-a', sovereign_impact: 'partial' }] } }), cat).score!;
    const blocking = computePortabilityScore(inputs({ vendor: { check: 'matched', hits: [{ id: 'sdk-a', sovereign_impact: 'blocks_migration' }, { id: 'sdk-b', sovereign_impact: 'blocks_migration' }] } }), cat);
    expect(partial).toBeLessThan(none);
    expect(blocking.score!).toBeLessThan(partial);
    expect(blocking.components.find((c) => c.id === 'vendor_lock')!.value).toBe(0);
  });

  it('a skipped vendor scan is missing data, not 1.0', () => {
    const r = computePortabilityScore(inputs({ vendor: { check: 'skipped: vendor-sdk-catalogue.yaml not found', hits: [] } }), cat);
    expect(r.components.find((c) => c.id === 'vendor_lock')).toMatchObject({ used: false, value: null });
    expect(r.components_used).not.toContain('vendor_lock');
  });

  it('missing inputs drop their weight: only the container component left', () => {
    const r = computePortabilityScore({
      serviceAvailability: null,
      vendor: { check: null, hits: [] },
      runtime: { kubernetes: false, container: true, evidence: ['dockerfile'] },
      iac: null,
      egress: null,
    }, cat);
    expect(r.score).toBe(0.75);
    expect(r.components_used).toEqual(['container']);
    expect(r.weight_coverage).toBe(0.15);
    expect(r.components.filter((c) => !c.used).map((c) => c.reason)).toEqual([
      'landing-zone catalogues not available',
      'vendor SDK scan not run',
      'inventory and twelve-factor outputs not available',
      'egress (Pass 07) output not available',
    ]);
  });

  it('no input at all: score null, not a silent 0.5', () => {
    const r = computePortabilityScore({ serviceAvailability: null, vendor: { check: null, hits: [] }, runtime: null, iac: null, egress: null }, cat);
    expect(r.score).toBeNull();
    expect(r.components_used).toEqual([]);
  });

  it('egress uses sovereign service verdicts, then hard-coded production hosts', () => {
    const verdicts = computePortabilityScore(inputs({ egress: { verdicts: [{ service: 'a', verdict: 'available' }, { service: 'b', verdict: 'partial' }], destinations: 2, hardcoded_hosts: [] } }), cat);
    expect(verdicts.components.find((c) => c.id === 'egress')).toMatchObject({ used: true, value: 0.75 });
    const hosts = computePortabilityScore(inputs({ egress: { verdicts: [], destinations: 0, hardcoded_hosts: [{ host: 'api.example.com', classification: 'public' }, { host: '10.0.0.5', classification: 'private' }] } }), cat);
    expect(hosts.components.find((c) => c.id === 'egress')).toMatchObject({ used: true, value: 0.25, detail: { source: 'hardcoded_endpoints' } });
  });

  it('no required service is missing data for the availability component', () => {
    const r = computePortabilityScore(inputs({ serviceAvailability: { required: [], sovereign_providers: ['p1'], catalogue_source: 'bundled' } }), cat);
    expect(r.components.find((c) => c.id === 'service_availability')).toMatchObject({ used: false });
  });
});

// ---------------------------------------------------------------------------
// Landing-zone catalogue: sovereign providers
// ---------------------------------------------------------------------------

function lzCatalogue(provider: string, regions: Array<{ id: string; jurisdiction: string; exposure: string[]; fulfills: string[] }>): unknown {
  return {
    meta: { schema_version: '1', name: `${provider} service catalogue`, provider, last_updated: '2026-10-24', source: { mode: 'curated' } },
    regions: regions.map((r) => ({
      id: r.id,
      sovereignty: { operator_jurisdiction: r.jurisdiction, extraterritorial_exposure: r.exposure },
      services: r.fulfills.map((f) => ({ code: `${provider}-${f}`, fulfills: [f] })),
    })),
  };
}

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'swao-3431-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function writeLz(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'eu-one.json'), JSON.stringify(lzCatalogue('eu-one', [{ id: 'de-1', jurisdiction: 'EU-entity', exposure: [], fulfills: ['postgresql', 'kubernetes', 'kafka'] }])));
  writeFileSync(join(dir, 'eu-two.json'), JSON.stringify(lzCatalogue('eu-two', [{ id: 'nl-1', jurisdiction: 'EU-entity', exposure: [], fulfills: ['postgresql', 'kubernetes'] }])));
  writeFileSync(join(dir, 'us-big.json'), JSON.stringify(lzCatalogue('us-big', [{ id: 'eu-1', jurisdiction: 'US-entity', exposure: ['us_cloud_act'], fulfills: ['postgresql', 'kafka', 'kubernetes'] }])));
  writeFileSync(join(dir, 'mixed.json'), JSON.stringify(lzCatalogue('mixed', [
    { id: 'us', jurisdiction: 'US-entity', exposure: ['us_cloud_act'], fulfills: ['kafka'] },
    { id: 'eu', jurisdiction: 'EU-entity', exposure: [], fulfills: ['redis'] },
  ])));
  writeFileSync(join(dir, '_coming-soon.json'), JSON.stringify({ coming_soon: ['x'] }));
}

describe('sovereign provider availability', () => {
  it('classifies regions by facts, not provider names', () => {
    expect(isSovereignRegion({ id: 'r', services: [], sovereignty: { operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: [] } }, RULE)).toBe(true);
    expect(isSovereignRegion({ id: 'r', services: [], sovereignty: { operator_jurisdiction: 'EU-entity', extraterritorial_exposure: ['fisa_702'], certifications: [] } }, RULE)).toBe(false);
    expect(isSovereignRegion({ id: 'r', services: [] }, RULE)).toBe(false);
  });

  it('counts a provider per sovereign region only', () => {
    writeLz(tmp);
    const a = loadSovereignAvailability(RULE, { dirs: [tmp] })!;
    expect(a.providers_checked).toEqual(['eu-one', 'eu-two', 'mixed', 'us-big']);
    expect(a.sovereign_providers).toEqual(['eu-one', 'eu-two', 'mixed']);
    expect(sovereignProvidersFor(a, 'postgresql')).toEqual(['eu-one', 'eu-two']);
    expect(sovereignProvidersFor(a, 'kafka')).toEqual(['eu-one']); // mixed offers kafka only in its US region
    expect(sovereignProvidersFor(a, 'redis')).toEqual(['mixed']);
  });

  it('the bundled catalogues yield EU-operated providers only', () => {
    const a = loadSovereignAvailability(RULE)!;
    expect(a).not.toBeNull();
    expect(a.sovereign_providers).toContain('stackit');
    for (const p of ['aws', 'azure', 'gcp']) expect(a.sovereign_providers).not.toContain(p);
  });
});

// ---------------------------------------------------------------------------
// End to end over pass outputs
// ---------------------------------------------------------------------------

function writeRun(passesDir: string, opts: { services: string[]; vendor?: Array<{ id: string; sovereign_impact: string }> }): void {
  mkdirSync(passesDir, { recursive: true });
  writeFileSync(join(passesDir, '01-inv.yaml'), dump({
    signals: opts.services.map((s, i) => ({ id: `INV-${10 + i}`, severity: 'informational', derivation: s, evidence: [], confidence: 'high', implies: [`service_dep:${s}`] })),
    assessment: {
      runtime_type: 'container', dockerfile: true, docker_compose: false, k8s_manifests: false,
      reference_catalogue_checks: { vendor_sdk: opts.vendor && opts.vendor.length > 0 ? 'matched' : 'no_match' },
      ...(opts.vendor && opts.vendor.length > 0 ? { vendor_sdks: opts.vendor } : {}),
    },
  }));
  writeFileSync(join(passesDir, '06-tf.yaml'), dump({
    signals: [],
    assessment: {
      factor_scores: [{ factor: 'III (Config)', status: 'pass' }, { factor: 'XI (Logs)', status: 'partial' }, { factor: 'IX (Disposability)', status: 'unknown' }],
      twelve_factor_pass_rate: 0.5,
      iac_roots: 0,
    },
  }));
  writeFileSync(join(passesDir, '07-egr.yaml'), dump({ signals: [], assessment: { egress_destinations: [{ note: 'none_detected' }], sovereign_services: [] } }));
}

describe('computeMigrationScores over a run', () => {
  it('fixtures with different footprints and vendor locks produce different portability scores', () => {
    const lz = join(tmp, 'lz');
    writeLz(lz);
    const runA = join(tmp, 'a', 'passes');
    const runB = join(tmp, 'b', 'passes');
    const runC = join(tmp, 'c', 'passes');
    writeRun(runA, { services: ['postgresql', 'kubernetes'] });
    writeRun(runB, { services: ['postgresql', 'kafka'] });
    writeRun(runC, { services: ['postgresql', 'kafka'], vendor: [{ id: 'sdk-x', sovereign_impact: 'blocks_migration' }] });
    const a = computeMigrationScores(runA, { lzDirs: [lz] });
    const b = computeMigrationScores(runB, { lzDirs: [lz] });
    const c = computeMigrationScores(runC, { lzDirs: [lz] });
    // container 0.75, iac 0, vendor 1, egress dropped; service availability 1.0 / 0.5 / 0.5.
    expect(a.portability!.score).toBe(0.84);
    expect(b.portability!.score).toBe(0.63);
    expect(c.portability!.score).toBe(0.49);
    expect(new Set([a, b, c].map((r) => r.portability!.score)).size).toBe(3);
    // Identical input, identical output.
    expect(computeMigrationScores(runB, { lzDirs: [lz] })).toEqual(b);
    // Cloud-native: (1 + 0.5 + 0.5) / 3.
    expect(a.cloud_native).toMatchObject({ score: 0.67, factors_checked: 2, factors_total: 3 });
  });

  it('records why a score is missing when pass outputs are absent', () => {
    const r = computeMigrationScores(join(tmp, 'empty'), { lzDirs: [join(tmp, 'none')] });
    expect(r.cloud_native).toBeNull();
    expect(r.cloud_native_skipped_reason).toBe('twelve-factor (Pass 06) output not available');
    expect(r.portability!.score).toBeNull();
  });

  it('IaC evidence from Terraform roots, state signals or a Helm chart', () => {
    const run = join(tmp, 'iac', 'passes');
    writeRun(run, { services: [] });
    writeFileSync(join(run, '06-tf.yaml'), dump({ signals: [], assessment: { factor_scores: [], iac_roots: 2, config_externalisation: { stacks: ['helm'] } } }));
    const r = computeMigrationScores(run, { lzDirs: [join(tmp, 'none')] });
    const iac = r.portability!.components.find((c) => c.id === 'iac')!;
    expect(iac).toMatchObject({ used: true, value: 1 });
    expect(iac.detail).toEqual({ evidence: ['2 Terraform root(s)', 'Helm chart'] });
    // Helm implies Kubernetes deployment for the container component.
    expect(r.portability!.components.find((c) => c.id === 'container')).toMatchObject({ value: 1 });
  });
});
