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

// Default intake template: header detection without --mapping (#3168).
// The reference layout below is the one Design 103 §3.2 was written for; the
// built-in detection must resolve it exactly like the reference column map.
import { describe, it, expect } from 'vitest';
import { DEFAULT_HEADERS } from '../__tests__/fixtures/scaffold-fixture.js';
import { resolveDefaultMap } from './default-template.js';

/** Header row of the reference intake layout (header names only, no cell values). */
export const REFERENCE_HEADERS = [
  'VM', 'CPUs', 'Memory', 'Active Memory', 'Disks', 'Total disk capacity MiB', 'IP',
  'KIS-Anbindung', 'OS according to the configuration file', 'Migration', 'Hersteller Support',
  'Telefonnummer', 'URL', 'Kontakt', 'App-Funktion', 'Fachbereich',
  'Migrationsprojekt mit Hersteller', 'AMS Sovereign Cloud Ja / Nein',
] as const;

const headerMap = (headers: readonly string[]) => new Map(headers.map((h, i) => [i + 1, h] as [number, string]));

function columnsOf(headers: readonly string[]) {
  const map = resolveDefaultMap(headerMap(headers));
  if (!map) throw new Error('no map');
  const fields = Object.fromEntries(Object.entries(map.fields).map(([k, v]) => [k, (v as { col: string }).col]));
  return { map, fields, pii: map.pii_columns.map((p) => p.col) };
}

describe('resolveDefaultMap: reference layout (#3168)', () => {
  const { map, fields, pii } = columnsOf(REFERENCE_HEADERS);

  it('maps every column like the reference column map', () => {
    expect(fields).toEqual({
      id_name_combined: 'A',
      cpu_cores: 'B',
      memory_mb: 'C',
      active_memory_mb: 'D',
      disk_count: 'E',
      total_disk_mib: 'F',
      ip: 'G',
      integrations_raw: 'H',
      os: 'I',
      migration_candidate: 'J',
      vendor_url: 'M',
      business_function: 'O',
      business_domain: 'P',
      migration_project_vendor: 'Q',
      ams_sovereign_cloud: 'R',
    });
  });

  it('keeps the vendor support, phone and contact columns as PII, never as vendor_name', () => {
    expect(pii).toEqual(['K', 'L', 'N']);
    expect(fields).not.toHaveProperty('vendor_name');
  });

  it('parses the identity column as the combined ID (Name) form when no name column exists', () => {
    const combined = map.fields.id_name_combined as { split_on?: string; strip_closing?: string; strip_flags?: boolean };
    expect(combined).toMatchObject({ split_on: '(', strip_closing: ')', strip_flags: true });
  });

  it('splits multi-department values on "/"', () => {
    expect((map.fields.business_domain as { multi_value_separator?: string }).multi_value_separator).toBe('/');
  });
});

describe('resolveDefaultMap: matching rules (#3168)', () => {
  it('still uses separate id and name columns when both exist (recommended template)', () => {
    const { fields } = columnsOf(DEFAULT_HEADERS);
    expect(fields.id).toBe('A');
    expect(fields.name).toBe('B');
    expect(fields).not.toHaveProperty('id_name_combined');
  });

  it('an exact match wins over a prefix match on another column', () => {
    // "Migration" is the exact migration_candidate column; the longer header must not steal it.
    const { fields } = columnsOf(['VM', 'Migrationsprojekt mit Hersteller', 'Migration']);
    expect(fields.migration_candidate).toBe('C');
    expect(fields.migration_project_vendor).toBe('B');
  });

  it('matches a header that starts with an alias followed by a space or punctuation only', () => {
    expect(columnsOf(['VM', 'OS according to the configuration file']).fields.os).toBe('B');
    expect(columnsOf(['VM', 'OS (Version)']).fields.os).toBe('B');
    // "OSI layer" starts with the letters "os" but not with the word "os"
    expect(columnsOf(['VM', 'OSI layer']).fields).not.toHaveProperty('os');
  });

  it('maps "Active Memory" to active_memory_mb, not memory_mb', () => {
    const { fields } = columnsOf(['VM', 'Memory', 'Active Memory']);
    expect(fields.memory_mb).toBe('B');
    expect(fields.active_memory_mb).toBe('C');
  });

  it('treats a MiB disk column as total_disk_mib and a GB column as total_disk_gb', () => {
    expect(columnsOf(['VM', 'Total disk capacity MiB']).fields.total_disk_mib).toBe('B');
    expect(columnsOf(['VM', 'Total Disk (GB)']).fields.total_disk_gb).toBe('B');
  });
});
