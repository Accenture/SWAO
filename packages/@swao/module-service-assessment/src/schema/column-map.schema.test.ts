// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Column-map schema (#3076, Design 103 §21.1).
import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import { MAPPED_COLUMN_MAP_YAML, MAPPED_HEADERS } from '../__tests__/fixtures/scaffold-fixture.js';
import { ColumnMapError, checkPiiDeclarations, columnToIndex, indexToColumn, parseColumnMap } from './column-map.schema.js';

const sample = (): Record<string, unknown> => load(MAPPED_COLUMN_MAP_YAML) as Record<string, unknown>;
const issuesOf = (raw: unknown): string[] => {
  try {
    parseColumnMap(raw);
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(ColumnMapError);
    return (e as ColumnMapError).issues;
  }
};

describe('column-map schema (#3076)', () => {
  it('accepts the 18-column reference mapping', () => {
    const map = parseColumnMap(sample());
    expect(Object.keys(map.fields)).toContain('id_name_combined');
    expect(map.pii_columns.map((p) => p.col)).toEqual(['K', 'L', 'N']);
    expect(map.source.header_row).toBe(1);
  });

  it('rejects a mapping without the mandatory os field', () => {
    const raw = sample();
    delete (raw['fields'] as Record<string, unknown>)['os'];
    expect(issuesOf(raw).join('\n')).toMatch(/mandatory field "os" is not mapped/);
  });

  it('rejects an invalid column letter with a clear message', () => {
    const raw = sample();
    (raw['fields'] as Record<string, Record<string, unknown>>)['cpu_cores']!['col'] = 'ZZ';
    expect(issuesOf(raw).join('\n')).toMatch(/fields\.cpu_cores\.col: invalid column letter/);
  });

  it('rejects a mapping with no identity field', () => {
    const raw = sample();
    delete (raw['fields'] as Record<string, unknown>)['id_name_combined'];
    expect(issuesOf(raw).join('\n')).toMatch(/mandatory identity field missing/);
  });

  it('rejects unknown field keys and PII columns that are also mapped', () => {
    const raw = sample();
    (raw['fields'] as Record<string, unknown>)['phone_number'] = { col: 'L' };
    const issues = issuesOf(raw).join('\n');
    expect(issues).toMatch(/unknown field "phone_number"/);
    expect(issues).toMatch(/column L is declared in pii_columns/);
  });

  it('warns (does not fail) when a personal-data column is not declared in pii_columns', () => {
    const raw = sample();
    raw['pii_columns'] = [{ col: 'K', reason: 'vendor_support_name' }];
    const map = parseColumnMap(raw);
    const headers = new Map(MAPPED_HEADERS.map((h, i) => [i + 1, h]));
    const warnings = checkPiiDeclarations(map, headers);
    expect(warnings).toHaveLength(2);
    expect(warnings.join('\n')).toMatch(/column L \("Telefonnummer"\)/);
    expect(warnings.join('\n')).toMatch(/column N \("Kontakt"\)/);
  });

  it('converts column letters and numbers both ways', () => {
    expect(columnToIndex('A')).toBe(1);
    expect(columnToIndex('R')).toBe(18);
    expect(columnToIndex('AA')).toBe(27);
    expect(columnToIndex(5)).toBe(5);
    expect(indexToColumn(27)).toBe('AA');
    expect(indexToColumn(18)).toBe('R');
  });
});
