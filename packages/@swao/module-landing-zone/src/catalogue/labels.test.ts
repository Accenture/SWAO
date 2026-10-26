// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing-zone module -- shared catalogue label helpers tests (#3380)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { lzProviderDisplayName, lzProviderLabel, lzRegionDisplayLabel } from './labels.js';

describe('lzProviderDisplayName (#3380)', () => {
  it('strips the " service catalogue" boilerplate', () => {
    expect(lzProviderDisplayName('Open Telekom Cloud / T Cloud Public service catalogue'))
      .toBe('Open Telekom Cloud / T Cloud Public');
    expect(lzProviderDisplayName('GCP service catalogue')).toBe('GCP');
    expect(lzProviderDisplayName('STACKIT service catalogue')).toBe('STACKIT');
  });

  it('keeps a trailing qualifier such as (classified)', () => {
    expect(lzProviderDisplayName('AWS ISOE Europe service catalogue (classified)'))
      .toBe('AWS ISOE Europe (classified)');
  });

  it('is a no-op when there is no suffix', () => {
    expect(lzProviderDisplayName('Delos Cloud')).toBe('Delos Cloud');
  });
});

describe('lzProviderLabel (#3399)', () => {
  it('reads as "<id> - <name>"', () => {
    expect(lzProviderLabel('otc', 'Open Telekom Cloud / T Cloud Public service catalogue'))
      .toBe('otc - Open Telekom Cloud / T Cloud Public');
    expect(lzProviderLabel('aws-esc', 'AWS European Sovereign Cloud service catalogue'))
      .toBe('aws-esc - AWS European Sovereign Cloud');
  });

  it('degrades to the bare id when the cleaned name just repeats it (case-insensitive)', () => {
    expect(lzProviderLabel('gcp', 'GCP service catalogue')).toBe('gcp');
  });
});

describe('lzRegionDisplayLabel (#3380 decision 1b)', () => {
  it('joins display, country and area after the id', () => {
    expect(lzRegionDisplayLabel({ id: 'eu-de', display: 'EU Germany', country: 'Germany', area: 'Frankfurt' }))
      .toBe('eu-de - EU Germany, Germany, Frankfurt');
  });

  it('drops absent parts and a display that only repeats the id', () => {
    expect(lzRegionDisplayLabel({ id: 'eu-de', display: 'eu-de' })).toBe('eu-de');
    expect(lzRegionDisplayLabel({ id: 'westeurope', country: 'Netherlands' })).toBe('westeurope - Netherlands');
  });

  it('falls back to the bare id with no metadata', () => {
    expect(lzRegionDisplayLabel({ id: 'eastus2' })).toBe('eastus2');
  });
});
