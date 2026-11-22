// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- live evaluation engine tests (#3579)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { describe, it, expect } from 'vitest';
import {
  LzLiveScanSchema,
  LZ_LIVE_CHECK_STATUSES,
  parseLzLiveScan,
  type LzLiveScan,
  type LzLiveScanInput,
  type LzRegion,
  type ServiceControls,
} from '@swao/core';
import {
  evaluateLzLiveScan,
  findingSeverity,
  LZ_LIVE_CHECK_SEVERITY,
  type LzLiveCheckDefinition,
  type LzLiveEvalFramework,
} from '../lz-live-eval.js';

const T = '2026-11-02T10:00:00Z';
const SHA = 'a'.repeat(64);
const IAC_FULL = { level: 'full' as const, tool: ['terraform' as const], provider: 'opentelekomcloud', resources: ['opentelekomcloud_obs_bucket'], source: 'curated' as const };
const API = [{ source: 'api' as const, ref: '/v3/auth/catalog' }];

type SvcInput = NonNullable<LzLiveScanInput['offering']['services']>[number];
const svc = (code: string, tags: string[], extra: Partial<SvcInput> = {}): SvcInput => ({
  code, name: code, capability_tags: tags, iac: IAC_FULL,
  regions: { 'eu-de': { status: 'enabled', evidence: API, observed_at: T } },
  ...extra,
});

const scanOf = (services: SvcInput[], checks: NonNullable<LzLiveScanInput['estate']['checks']> = []): LzLiveScan => parseLzLiveScan({
  provider: 'otc', collection_mode: 'live', confidence: 'observed', scanned_at: T,
  provenance: { source: 'live:otc-test/platform' },
  meta: {
    lz_id: 'otc-test', provider: 'otc', scope_id: 'platform', scope_kind: 'platform',
    observed_at: T, driver_version: '0.1.0', read_only: 'verified', coverage: { readable: [], unreadable: [] },
  },
  offering: { regions: [{ id: 'eu-de', status: 'enabled' }], services },
  estate: { checks },
});

const mapping = (rows: ServiceControls['mappings']): ServiceControls => ({ schema_version: '0.1', framework: 'BSI_C5', mappings: rows });
const curated = (capability: string, controls = ['CRY-02']) => ({ capability, controls, relevance: 'configure' as const, confidence: 'curated' as const });
const derived = (capability: string, controls = ['OPS-05']) => ({ capability, controls, relevance: 'configure' as const, confidence: 'derived' as const });

const fw = (rows: ServiceControls['mappings'] | null, sovereignty?: LzLiveEvalFramework['sovereignty_requirements']): LzLiveEvalFramework => ({
  id: 'BSI_C5', version: '2020', sha256: SHA, mapping: rows === null ? null : mapping(rows),
  ...(sovereignty ? { sovereignty_requirements: sovereignty } : {}),
});

const DE_REGION: LzRegion = {
  id: 'eu-de', services: [],
  sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: ['BSI_C5'] },
};
const US_EXPOSED: LzRegion = {
  id: 'eu-de', services: [],
  sovereignty: { residency_country: 'DE', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act'], certifications: [] },
};
const REGIONS = new Map([['eu-de', DE_REGION]]);
const SOV = { forbid_exposure: ['us_cloud_act'] };

const CHECKS: LzLiveCheckDefinition[] = [
  { id: 'LZC-OBJ', severity: 'blocker', service_dep_codes: ['object_storage'] },
  { id: 'LZC-OBJ-W', severity: 'warning', service_dep_codes: ['object_storage'] },
  { id: 'LZC-OBJ-I', severity: 'info', service_dep_codes: ['object_storage'] },
  { id: 'LZC-GEN-01', severity: 'blocker' },
];

const lightOf = (services: SvcInput[], framework: LzLiveEvalFramework, opts: { checks?: NonNullable<LzLiveScanInput['estate']['checks']>; regions?: Map<string, LzRegion> } = {}) => {
  const res = evaluateLzLiveScan(scanOf(services, opts.checks), { frameworks: [framework], regions: opts.regions ?? REGIONS, checks: CHECKS });
  return res.scan.offering.services[0]!.frameworks['BSI_C5']!;
};

describe('lights (Design 120 section 8.3): the five outcomes', () => {
  it('green: curated controls mapped, no finding, IaC full, sovereignty passes', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([curated('object_storage')], SOV));
    expect(r.light).toBe('green');
    expect(r.controls).toEqual(['CRY-02']);
  });

  it('red: sovereignty failure in an offered region', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([curated('object_storage')], SOV), { regions: new Map([['eu-de', US_EXPOSED]]) });
    expect(r.light).toBe('red');
    expect(r.detail).toContain('exposed to us_cloud_act');
  });

  it('red: open high finding (failed blocker check) on the service', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([curated('object_storage')]), { checks: [{ id: 'LZC-OBJ', title: 'obs', status: 'fail' }] });
    expect(r.light).toBe('red');
    expect(r.detail).toContain('LZC-OBJ (high)');
  });

  it('amber: only a low finding', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([curated('object_storage')]), { checks: [{ id: 'LZC-OBJ-I', title: 'obs', status: 'fail' }] });
    expect(r.light).toBe('amber');
    expect(r.detail).toContain('low finding LZC-OBJ-I');
  });

  it('grey: no mapping for the capability tag', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([curated('key_vault')]));
    expect(r.light).toBe('grey');
    expect(r.controls).toEqual([]);
  });

  it('n/a: every mapped relevance is n/a', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([{ capability: 'object_storage', controls: [], relevance: 'n/a', confidence: 'curated' }]));
    expect(r.light).toBe('n/a');
  });
});

describe('grey for unmapped capabilities (CP-4, ADR-0041)', () => {
  it('a service without capability tags is grey, never green', () => {
    expect(lightOf([svc('x', [])], fw([curated('object_storage')])).light).toBe('grey');
  });

  it('a framework without service-controls.yaml makes every service grey', () => {
    expect(lightOf([svc('obs', ['object_storage'])], fw(null)).light).toBe('grey');
  });

  it('findings on an unmapped service do not make it red (control layer needs a mapping)', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([curated('key_vault')]), { checks: [{ id: 'LZC-OBJ', title: 'obs', status: 'fail' }] });
    expect(r.light).toBe('grey');
  });
});

describe('derived (unreviewed) mapping rows never turn green (Q-23)', () => {
  it('only derived rows: capped at amber', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([derived('object_storage')]));
    expect(r.light).toBe('amber');
    expect(r.detail).toContain('confidence derived');
  });

  it('derived and curated rows on the service tags: can be green', () => {
    const r = lightOf([svc('obs', ['object_storage', 'backup'])], fw([derived('object_storage'), curated('backup', ['OPS-06'])]));
    expect(r.light).toBe('green');
    expect(r.controls).toEqual(['OPS-05', 'OPS-06']);
  });

  it('a curated row for another tag does not lift a derived-only service', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([derived('object_storage'), curated('key_vault')]));
    expect(r.light).toBe('amber');
  });

  it('a curated n/a row does not count as a reviewed applicable row', () => {
    const r = lightOf([svc('obs', ['object_storage', 'backup'])], fw([derived('object_storage'), { capability: 'backup', controls: [], relevance: 'n/a', confidence: 'curated' }]));
    expect(r.light).toBe('amber');
  });
});

describe('precedence', () => {
  it('red before grey: a sovereignty failure on an unmapped service is red', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([curated('key_vault')], SOV), { regions: new Map([['eu-de', US_EXPOSED]]) });
    expect(r.light).toBe('red');
  });

  it('n/a before red: a framework that does not apply ignores sovereignty', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([{ capability: 'object_storage', controls: [], relevance: 'n/a', confidence: 'curated' }], SOV), { regions: new Map([['eu-de', US_EXPOSED]]) });
    expect(r.light).toBe('n/a');
  });

  it('red before the derived cap', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([derived('object_storage')]), { checks: [{ id: 'LZC-OBJ', title: 'obs', status: 'fail' }] });
    expect(r.light).toBe('red');
  });
});

describe('findings from the baseline check catalogue', () => {
  it('maps catalogue severity like Pass 23: blocker high, warning medium, info low', () => {
    expect(LZ_LIVE_CHECK_SEVERITY).toEqual({ blocker: 'high', warning: 'medium', info: 'low' });
  });

  it('a failed warning check (medium) is red; a warn result is low (amber)', () => {
    const f = fw([curated('object_storage')]);
    expect(lightOf([svc('obs', ['object_storage'])], f, { checks: [{ id: 'LZC-OBJ-W', title: 'w', status: 'fail' }] }).light).toBe('red');
    expect(lightOf([svc('obs', ['object_storage'])], f, { checks: [{ id: 'LZC-OBJ', title: 'b', status: 'warn' }] }).light).toBe('amber');
  });

  it('pass and na results are no finding', () => {
    const f = fw([curated('object_storage')]);
    const checks = [{ id: 'LZC-OBJ', title: 'b', status: 'pass' as const }, { id: 'LZC-OBJ-W', title: 'w', status: 'na' as const }];
    expect(lightOf([svc('obs', ['object_storage'])], f, { checks }).light).toBe('green');
  });

  it('a check hits only services whose capability tags meet its service_dep_codes', () => {
    const res = evaluateLzLiveScan(
      scanOf([svc('obs', ['object_storage']), svc('kms', ['key_vault'])], [{ id: 'LZC-OBJ', title: 'b', status: 'fail' }]),
      { frameworks: [fw([curated('object_storage'), curated('key_vault')])], regions: REGIONS, checks: CHECKS },
    );
    const lights = Object.fromEntries(res.scan.offering.services.map((s) => [s.code, s.frameworks['BSI_C5']!.light]));
    expect(lights).toEqual({ obs: 'red', kms: 'green' });
  });

  it('a check without service_dep_codes is a scope finding and colours no service', () => {
    const res = evaluateLzLiveScan(
      scanOf([svc('obs', ['object_storage'])], [{ id: 'LZC-GEN-01', title: 'egress', status: 'fail' }]),
      { frameworks: [fw([curated('object_storage')])], regions: REGIONS, checks: CHECKS },
    );
    expect(res.scope_findings).toEqual([{ check_id: 'LZC-GEN-01', status: 'fail', severity: 'high' }]);
    expect(res.scan.offering.services[0]!.frameworks['BSI_C5']!.light).toBe('green');
  });

  it('a check id outside the catalogue is reported and never used (no second check set)', () => {
    const res = evaluateLzLiveScan(
      scanOf([svc('obs', ['object_storage'])], [{ id: 'MY-OWN-CHECK', title: 'x', status: 'fail' }]),
      { frameworks: [fw([curated('object_storage')])], regions: REGIONS, checks: CHECKS },
    );
    expect(res.unknown_checks).toEqual(['MY-OWN-CHECK']);
    expect(res.scan.offering.services[0]!.frameworks['BSI_C5']!.light).toBe('green');
  });

  it('every entry of the shipped check catalogue fits LzLiveCheckDefinition', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = load(readFileSync(resolve(here, '../../../../../../controls/landing-zone-checks-catalogue.yaml'), 'utf-8')) as { checks: LzLiveCheckDefinition[] };
    expect(raw.checks.length).toBeGreaterThan(0);
    for (const c of raw.checks) {
      expect(['blocker', 'warning', 'info']).toContain(c.severity);
      expect(c.service_dep_codes === undefined || Array.isArray(c.service_dep_codes)).toBe(true);
    }
  });
});

describe('amber caps that keep a service from green', () => {
  const f = fw([curated('object_storage')], SOV);

  it('IaC level read, none or absent caps at amber; n/a does not', () => {
    const read = { level: 'read' as const, tool: ['terraform' as const], provider: 'p', data_sources: ['d'], source: 'curated' as const };
    expect(lightOf([svc('obs', ['object_storage'], { iac: read })], f).light).toBe('amber');
    expect(lightOf([svc('obs', ['object_storage'], { iac: { level: 'none', source: 'curated' } })], f).light).toBe('amber');
    expect(lightOf([svc('obs', ['object_storage'], { iac: undefined })], f).detail).toContain('IaC level not determined');
    expect(lightOf([svc('obs', ['object_storage'], { iac: { level: 'n/a', source: 'curated' } })], f).light).toBe('green');
  });

  it('a region without sovereignty facts is not evaluable, never a pass', () => {
    const noFacts = new Map([['eu-de', { id: 'eu-de', services: [] } as LzRegion]]);
    const r = lightOf([svc('obs', ['object_storage'])], f, { regions: noFacts });
    expect(r.light).toBe('amber');
    expect(r.detail).toContain('sovereignty facts missing for eu-de');
    expect(lightOf([svc('obs', ['object_storage'])], f, { regions: new Map() }).light).toBe('amber');
  });

  it('a framework without sovereignty requirements needs no region facts', () => {
    expect(lightOf([svc('obs', ['object_storage'])], fw([curated('object_storage')]), { regions: new Map() }).light).toBe('green');
  });

  it('a service observed only as unknown is never green', () => {
    const regions = { 'eu-de': { status: 'unknown' as const, evidence: [{ source: 'api' as const, ref: '/x', http_status: 403 }], observed_at: T } };
    const r = lightOf([svc('obs', ['object_storage'], { regions })], fw([curated('object_storage')]));
    expect(r.light).toBe('amber');
    expect(r.detail).toContain('not enabled in any region');
  });
});

describe('evaluateLzLiveScan output', () => {
  it('stamps meta.frameworks, keeps the input unchanged and stays a valid LzLiveScan', () => {
    const scan = scanOf([svc('obs', ['object_storage'])]);
    const before = JSON.stringify(scan);
    const other: LzLiveEvalFramework = { id: 'GDPR', version: '2016', sha256: 'b'.repeat(64), mapping: null };
    const res = evaluateLzLiveScan(scan, { frameworks: [fw([curated('object_storage')]), other], regions: REGIONS, checks: CHECKS });
    expect(JSON.stringify(scan)).toBe(before);
    expect(res.scan.meta.frameworks).toEqual([{ id: 'BSI_C5', version: '2020', sha256: SHA }, { id: 'GDPR', version: '2016', sha256: 'b'.repeat(64) }]);
    expect(Object.keys(res.scan.offering.services[0]!.frameworks)).toEqual(['BSI_C5', 'GDPR']);
    expect(res.scan.offering.services[0]!.frameworks['GDPR']!.light).toBe('grey');
    expect(() => LzLiveScanSchema.parse(res.scan)).not.toThrow();
  });
});

describe('check status unverified (#3864, Design 123 section 5.3: never a pass)', () => {
  it('an unverified check on a service that would be green makes it amber and names it', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([curated('object_storage')], SOV), { checks: [{ id: 'LZC-OBJ', title: 'obs', status: 'unverified', observability: 'not_collected' }] });
    expect(r.light).toBe('amber');
    expect(r.detail).toContain('unverified LZC-OBJ');
    expect(r.detail).not.toContain('low finding');
  });

  it('unverified never softens a failure: fail plus unverified stays red', () => {
    const r = lightOf([svc('obs', ['object_storage'])], fw([curated('object_storage')]), { checks: [
      { id: 'LZC-OBJ', title: 'obs', status: 'fail' },
      { id: 'LZC-OBJ-W', title: 'obs', status: 'unverified', observability: 'catalogue' },
    ] });
    expect(r.light).toBe('red');
  });

  it('a scope-level unverified check is a low scope finding with status unverified', () => {
    const res = evaluateLzLiveScan(scanOf([svc('obs', ['object_storage'])], [{ id: 'LZC-GEN-01', title: 'gen', status: 'unverified', observability: 'not_observable' }]), { frameworks: [fw([curated('object_storage')])], regions: REGIONS, checks: CHECKS });
    expect(res.scope_findings).toEqual([{ check_id: 'LZC-GEN-01', status: 'unverified', severity: 'low' }]);
  });

  it('findingSeverity covers every check status', () => {
    const def: LzLiveCheckDefinition = { id: 'X', severity: 'blocker' };
    expect(LZ_LIVE_CHECK_STATUSES.map((s) => findingSeverity(s, def))).toEqual([null, 'high', 'low', null, 'low']);
  });
});
