// #4296: the one provider name map (abbreviation plus full name).
import { readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { PROVIDER_NAMES, brandProviderNames, providerColumns, providerDescription, providerLabel, providerName } from './provider-names.js';
import { lzProviderBrand } from './lz-provider-brand.js';

const here = dirname(fileURLToPath(import.meta.url));
const bundledDir = resolve(here, '../../../../lz-catalogues');

describe('providerLabel (#4296)', () => {
  it('renders the pair, the abbreviation and the full name', () => {
    expect(providerLabel('otc', 'pair')).toBe('OTC, T Cloud Public');
    expect(providerLabel('otc', 'abbr')).toBe('OTC');
    expect(providerLabel('otc', 'full')).toBe('T Cloud Public');
    expect(providerLabel('gcp')).toBe('GCP, Google Cloud Platform');
    expect(providerLabel('aws-esc')).toBe('AWS ESC, AWS European Sovereign Cloud');
    expect(providerLabel('azure', 'abbr')).toBe('Azure');
  });

  it('is case-insensitive', () => {
    expect(providerLabel('OTC')).toBe('OTC, T Cloud Public');
  });

  it('collapses the pair when abbreviation and full name are the same (STACKIT)', () => {
    expect(providerLabel('stackit')).toBe('STACKIT');
    expect(providerLabel('ovhcloud')).toBe('OVHcloud');
  });

  it('upper-cases an unknown id and uses the fallback full name when given', () => {
    expect(providerLabel('myprivate')).toBe('MYPRIVATE');
    expect(providerLabel('myprivate', 'full', 'My Private Cloud')).toBe('My Private Cloud');
    expect(providerLabel('myprivate', 'pair', 'My Private Cloud')).toBe('MYPRIVATE, My Private Cloud');
    expect(providerLabel('myprivate', 'pair', '  ')).toBe('MYPRIVATE');
  });

  it('ignores the fallback for a known id', () => {
    expect(providerLabel('otc', 'full', 'Something else')).toBe('T Cloud Public');
  });

  it('returns an empty label for an empty id', () => {
    expect(providerLabel('')).toBe('');
    expect(providerName('')).toBeUndefined();
  });

  it('does not resolve prototype keys', () => {
    expect(providerName('constructor')).toBeUndefined();
    expect(providerName('__proto__')).toBeUndefined();
    expect(providerLabel('constructor', 'abbr')).toBe('CONSTRUCTOR');
  });

  it('lzProviderBrand delegates to the pair form', () => {
    for (const id of Object.keys(PROVIDER_NAMES)) expect(lzProviderBrand(id)).toBe(providerLabel(id, 'pair'));
  });

  it('#4454: every provider has a description that differs from its abbreviation', () => {
    for (const id of Object.keys(PROVIDER_NAMES)) {
      const d = providerDescription(id);
      expect(d.trim().length, id).toBeGreaterThan(0);
      expect(d.toLowerCase(), id).not.toBe(PROVIDER_NAMES[id]!.abbr.toLowerCase());
      expect(providerColumns(id).length, id).toBeGreaterThan(PROVIDER_NAMES[id]!.abbr.length);
    }
    // The pair form of publications does not change.
    expect(providerLabel('stackit', 'pair')).toBe('STACKIT');
    expect(providerLabel('ovhcloud', 'pair')).toBe('OVHcloud');
    expect(providerColumns('stackit').endsWith('STACKIT Cloud, Schwarz Digits')).toBe(true);
  });

  it('providerColumns aligns the description column and drops a repeated name for an unknown id', () => {
    const otc = providerColumns('otc');
    const gcp = providerColumns('gcp');
    expect(otc.startsWith('OTC ')).toBe(true);
    expect(otc.endsWith('T Cloud Public')).toBe(true);
    expect(otc.indexOf('T Cloud Public')).toBe(gcp.indexOf('Google Cloud Platform'));
    expect(providerColumns('stackit').indexOf('STACKIT Cloud')).toBe(gcp.indexOf('Google Cloud Platform'));
    expect(providerColumns('mycloud')).toBe('MYCLOUD');
  });

  it('has an entry for every bundled catalogue provider', () => {
    const ids = readdirSync(bundledDir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('_') && f !== 'aws-service-meta.json')
      .map((f) => f.replace(/\.json$/, ''));
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) expect(providerName(id), id).toBeDefined();
  });
});

// #4391 (Design 127 section 9): provider names in running text through the brand label.
describe('brandProviderNames (#4391)', () => {
  it('puts the abbreviation in front of a bare full name and is idempotent', () => {
    const once = brandProviderNames('Candidates: Amazon Web Services, Microsoft Azure and T Cloud Public.');
    expect(once).toBe('Candidates: AWS, Amazon Web Services, Azure, Microsoft Azure and OTC, T Cloud Public.');
    expect(brandProviderNames(once)).toBe(once);
    expect(brandProviderNames('OTC, T Cloud Public')).toBe('OTC, T Cloud Public');
  });
  it('the longest full name wins; STACKIT stays one word', () => {
    expect(brandProviderNames('Microsoft Azure Local')).toBe('Azure Local, Microsoft Azure Local');
    expect(brandProviderNames('STACKIT in Germany')).toBe('STACKIT in Germany');
  });
  it('an upper-cased id that stands as a word becomes the abbreviation; lower-case ids and compounds stay', () => {
    expect(brandProviderNames('AZURE in the CMDB')).toBe('Azure in the CMDB');
    expect(brandProviderNames('AZURE_SKU and data-provider="azure"')).toBe('AZURE_SKU and data-provider="azure"');
    expect(brandProviderNames('')).toBe('');
  });
});
