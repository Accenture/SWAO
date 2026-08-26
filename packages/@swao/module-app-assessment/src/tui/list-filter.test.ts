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
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterList, FILTER_THRESHOLD, SHOW_ALL } from './list-filter.js';

// ---------------------------------------------------------------------------
// filterList -- core predicate
// ---------------------------------------------------------------------------
describe('filterList', () => {
  const strings = ['us-east-1', 'us-west-2', 'eu-central-1', 'ap-south-1'];

  it('returns all items when query is empty', () => {
    expect(filterList(strings, '', s => s)).toEqual(strings);
  });

  it('returns all items when query is SHOW_ALL sentinel', () => {
    expect(filterList(strings, SHOW_ALL, s => s)).toEqual(strings);
  });

  it('filters case-insensitively', () => {
    expect(filterList(strings, 'US', s => s)).toEqual(['us-east-1', 'us-west-2']);
  });

  it('matches substrings in the middle of a value', () => {
    expect(filterList(strings, 'east', s => s)).toEqual(['us-east-1']);
  });

  it('returns empty array when no item matches', () => {
    expect(filterList(strings, 'zzz', s => s)).toEqual([]);
  });

  it('passes the item through the key extractor -- matches on display label not raw value', () => {
    const options = [
      { value: 'af-south-1', label: 'af-south-1  --  Africa (Cape Town)' },
      { value: 'us-east-1',  label: 'us-east-1  --  US East (N. Virginia)' },
    ];
    const result = filterList(options, 'africa', o => o.label);
    expect(result).toEqual([options[0]]);
  });

  it('matches EU regions when filtering on "eu" against label that contains ID + display name', () => {
    const options = [
      { value: 'eu-central-1', label: 'eu-central-1  --  EU (Frankfurt)' },
      { value: 'eu-west-1',    label: 'eu-west-1  --  EU (Ireland)' },
      { value: 'us-east-1',    label: 'us-east-1  --  US East (N. Virginia)' },
    ];
    const result = filterList(options, 'eu', o => o.label);
    expect(result.map(r => r.value)).toEqual(['eu-central-1', 'eu-west-1']);
  });

  it('matches display name even when region ID does not contain the query', () => {
    const options = [
      { value: 'af-south-1', label: 'af-south-1  --  Africa (Cape Town)' },
      { value: 'ap-east-1',  label: 'ap-east-1  --  Asia Pacific (Hong Kong)' },
    ];
    const result = filterList(options, 'cape', o => o.label);
    expect(result.map(r => r.value)).toEqual(['af-south-1']);
  });

  it('works with an identity key extractor for plain string lists (app names)', () => {
    const apps = ['sovereign-health', 'legacy-payroll', 'cloud-crm'];
    expect(filterList(apps, 'health', a => a)).toEqual(['sovereign-health']);
    expect(filterList(apps, 'cloud', a => a)).toEqual(['cloud-crm']);
    expect(filterList(apps, 'LEGACY', a => a)).toEqual(['legacy-payroll']);
  });

  // #1000: LZ selector country-code filtering -- label includes [DE]/[AT] suffix.
  it('filters STACKIT regions by country code DE -- includes eu01 (Germany) only', () => {
    const options = [
      { value: 'stackit:eu01', label: 'stackit / eu01  --  STACKIT eu01 (Germany) [DE]' },
      { value: 'stackit:eu02', label: 'stackit / eu02  --  STACKIT eu02 (Austria) [AT]' },
    ];
    const result = filterList(options, 'DE', o => o.label);
    expect(result.map(r => r.value)).toEqual(['stackit:eu01']);
  });

  it('filters STACKIT regions by "germany" -- includes eu01 only', () => {
    const options = [
      { value: 'stackit:eu01', label: 'stackit / eu01  --  STACKIT eu01 (Germany) [DE]' },
      { value: 'stackit:eu02', label: 'stackit / eu02  --  STACKIT eu02 (Austria) [AT]' },
    ];
    const result = filterList(options, 'germany', o => o.label);
    expect(result.map(r => r.value)).toEqual(['stackit:eu01']);
  });

  it('filters STACKIT regions by "eu" -- includes both eu01 and eu02', () => {
    const options = [
      { value: 'stackit:eu01', label: 'stackit / eu01  --  STACKIT eu01 (Germany) [DE]' },
      { value: 'stackit:eu02', label: 'stackit / eu02  --  STACKIT eu02 (Austria) [AT]' },
    ];
    const result = filterList(options, 'eu', o => o.label);
    expect(result.map(r => r.value)).toEqual(['stackit:eu01', 'stackit:eu02']);
  });
});

// ---------------------------------------------------------------------------
// FILTER_THRESHOLD -- controls when the filter-first step appears
// ---------------------------------------------------------------------------
describe('FILTER_THRESHOLD', () => {
  it('is 10', () => {
    expect(FILTER_THRESHOLD).toBe(10);
  });

  it('a list of exactly 10 items does NOT trigger the filter step (threshold is strictly >)', () => {
    const tenItems = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    expect(tenItems.length > FILTER_THRESHOLD).toBe(false);
  });

  it('a list of 11 items triggers the filter step', () => {
    const elevenItems = Array.from({ length: 11 }, (_, i) => `item-${i}`);
    expect(elevenItems.length > FILTER_THRESHOLD).toBe(true);
  });

  it('bundled AWS catalogue has more regions than FILTER_THRESHOLD -- filter step fires', () => {
    // Read the live catalogue so the count stays correct as regions are added.
    // Path: src/tui/ -> up 5 levels -> swao/ -> lz-catalogues/aws.json
    const catalogueDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../lz-catalogues');
    const aws = JSON.parse(readFileSync(resolve(catalogueDir, 'aws.json'), 'utf-8')) as { regions?: unknown[] };
    const count = Array.isArray(aws.regions) ? aws.regions.length : 0;
    expect(count).toBeGreaterThan(FILTER_THRESHOLD);
  });
});
