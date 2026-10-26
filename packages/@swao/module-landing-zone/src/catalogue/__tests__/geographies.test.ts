// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- geography model tests
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3281 / Design 110 D-16: one geography model, applied identically to every
// bundled LZ catalogue.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LZ_GEOGRAPHIES,
  lzGeographyKey,
  lzDeprecatedGeographyAlias,
  lzRegionGeographies,
  lzGeographyDefaultRegion,
  resolveLzGeography,
  type LzGeographyRegion,
} from '../geographies.js';

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLED = resolve(here, '..', '..', '..', '..', '..', '..', 'lz-catalogues');
const PROVIDERS = ['aws', 'aws-esc', 'aws-iso-e', 'azure', 'azure-local', 'gcp', 'stackit', 'delos', 'otc', 'oci'];
const regionsOf = (provider: string): LzGeographyRegion[] =>
  (JSON.parse(readFileSync(join(BUNDLED, `${provider}.json`), 'utf-8')) as { regions: LzGeographyRegion[] }).regions;

describe('shared LZ geography model (#3281)', () => {
  it('vocabulary: unique ids and aliases', () => {
    const aliases = LZ_GEOGRAPHIES.flatMap((g) => g.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
    expect(LZ_GEOGRAPHIES.map((g) => g.id)).toEqual(['germany', 'europe', 'switzerland', 'united-kingdom', 'norway', 'iceland', 'liechtenstein', 'north-america', 'south-america', 'asia-pacific', 'middle-east', 'africa']);
  });

  it('matches spellings case- and punctuation-insensitively', () => {
    expect(lzGeographyKey('Europe')).toBe('europe');
    expect(lzGeographyKey('EU')).toBe('europe'); // ADR-0068: eu is a deprecated alias of europe
    expect(lzGeographyKey('Germany')).toBe('germany');
    expect(lzGeographyKey('DE')).toBe('germany');
    expect(lzGeographyKey('North America')).toBe('north-america');
    expect(lzGeographyKey('Atlantis')).toBeUndefined();
    expect(lzGeographyKey('')).toBeUndefined();
  });

  it('tags regions from the residency country, never per provider', () => {
    expect(lzRegionGeographies({ id: 'x', sovereignty: { residency_country: 'DE' } })).toEqual(['germany', 'europe']);
    expect(lzRegionGeographies({ id: 'x', sovereignty: { residency_country: 'CH' } })).toEqual(['switzerland']);
    expect(lzRegionGeographies({ id: 'x', sovereignty: { residency_country: 'EU' } })).toEqual(['europe']);
    expect(lzRegionGeographies({ id: 'x', country: 'US' })).toEqual(['north-america']);
    expect(lzRegionGeographies({ id: 'x', sovereignty: { residency_country: 'UNKNOWN' } })).toEqual([]);
    expect(lzRegionGeographies({ id: 'x' })).toEqual([]);
  });

  it('default rule: residency DE first, then most services, then lowest id', () => {
    const regions: LzGeographyRegion[] = [
      { id: 'nl-big', sovereignty: { residency_country: 'NL' }, services: [1, 2, 3, 4] },
      { id: 'de-b', sovereignty: { residency_country: 'DE' }, services: [1, 2] },
      { id: 'de-a', sovereignty: { residency_country: 'DE' }, services: [1, 2] },
      { id: 'de-small', sovereignty: { residency_country: 'DE' }, services: [1] },
    ];
    expect(lzGeographyDefaultRegion('europe', regions)).toBe('de-a');
    expect(lzGeographyDefaultRegion('europe', regions.slice(0, 1))).toBe('nl-big');
    expect(lzGeographyDefaultRegion('africa', regions)).toBeUndefined();
  });

  it('a region id wins over a geography alias', () => {
    expect(resolveLzGeography('de', regionsOf('delos'))).toEqual({ kind: 'region', region: 'de' });
    expect(resolveLzGeography('westeurope', regionsOf('azure'))).toEqual({ kind: 'region', region: 'westeurope' });
  });

  it('azure:Europe resolves by the shared rule; an unknown value stays unknown', () => {
    expect(resolveLzGeography('Europe', regionsOf('azure'))).toEqual({ kind: 'geography', region: 'germanywestcentral', geography: 'europe', requested: 'Europe' });
    expect(resolveLzGeography('Atlantis', regionsOf('azure'))).toEqual({ kind: 'unknown', region: 'Atlantis' });
    expect(resolveLzGeography('Europe', [])).toEqual({ kind: 'region', region: 'Europe' });
  });

  it('Europe and Germany resolve the same way for every bundled catalogue', () => {
    const europe = Object.fromEntries(PROVIDERS.map((p) => [p, resolveLzGeography('Europe', regionsOf(p)).region]));
    expect(europe).toEqual({
      aws: 'eu-central-1', 'aws-esc': 'eusc-de-east-1', 'aws-iso-e': 'eu-isoe-west-1', azure: 'germanywestcentral',
      'azure-local': 'Europe', // operator-site regions carry no residency country: unknown, skipped with the hint
      gcp: 'europe-west3', stackit: 'eu01', delos: 'de', otc: 'eu-de', oci: 'eu-frankfurt-1',
    });
    const germany = Object.fromEntries(PROVIDERS.map((p) => [p, resolveLzGeography('Germany', regionsOf(p)).kind]));
    expect(germany['aws-iso-e']).toBe('unknown'); // EU-wide residency is not Germany
    expect(germany['azure-local']).toBe('unknown');
    expect(PROVIDERS.filter((p) => germany[p] === 'geography')).toHaveLength(8);
  });
});

describe('ADR-0068 geography changes (#3379)', () => {
  it('europe is the 27 EU member states plus the EU-wide marker, not CH/GB', () => {
    const europe = LZ_GEOGRAPHIES.find((g) => g.id === 'europe')!;
    expect(europe.countries).toContain('DE');
    expect(europe.countries).toContain('EU');
    expect(europe.countries).not.toContain('CH');
    expect(europe.countries).not.toContain('GB');
  });
  it('Switzerland and the UK resolve to their own geographies', () => {
    expect(lzGeographyKey('Switzerland')).toBe('switzerland');
    expect(lzGeographyKey('CH')).toBe('switzerland');
    expect(lzGeographyKey('UK')).toBe('united-kingdom');
    expect(lzGeographyKey('GB')).toBe('united-kingdom');
  });
  it('eu is a deprecated alias of europe', () => {
    expect(lzGeographyKey('eu')).toBe('europe');
    expect(lzDeprecatedGeographyAlias('eu')).toEqual({ alias: 'eu', replacement: 'europe' });
    expect(lzDeprecatedGeographyAlias('europe')).toBeNull();
  });
});
