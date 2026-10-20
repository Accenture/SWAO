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

// Intake parser (#3077) + PII scrubbing (#3081, G-06) + multi-sheet (G-09).
import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import {
  DEFAULT_HEADERS,
  DEFAULT_TEMPLATE_ROWS,
  MAPPED_COLUMN_MAP_YAML,
  MAPPED_HEADERS,
  MAPPED_ROWS,
  PLANTED_PII,
} from '../__tests__/fixtures/scaffold-fixture.js';
import { parseColumnMap } from '../schema/column-map.schema.js';
import { IntakeError, parseIntakeSheets, type SheetLike } from './parser.js';
import { looksLikePersonalName, REDACTED_CONTACT_NAME } from './pii.js';

function sheet(name: string, headers: readonly string[], rows: Array<Array<string | number | null>>): SheetLike {
  const grid = [headers as readonly unknown[], ...rows];
  return { name, rowCount: grid.length, cell: (r, c) => grid[r - 1]?.[c - 1] ?? null };
}

const mappedMap = () => parseColumnMap(load(MAPPED_COLUMN_MAP_YAML));

describe('parseIntakeSheets: default template (#3077)', () => {
  const res = parseIntakeSheets([sheet('Sheet1', DEFAULT_HEADERS, DEFAULT_TEMPLATE_ROWS)]);

  it('reads every row through the header-resolved template', () => {
    expect(res.rows).toHaveLength(20);
    const r = res.rows[0]!;
    expect(r.appId).toBe('hosapp133');
    expect(r.appName).toBe('Radimetrics');
    expect(r.values.os).toBe('Windows Server 2016 (64-bit)');
    expect(r.values.cpu_cores).toBe(4);
    expect(r.values.migration_candidate).toBe(true);
    expect(r.integrations).toEqual(['hosapp141']);
  });

  it('records header names (not values) per sheet', () => {
    expect(res.sheets[0]?.mapping).toBe('default');
    expect(res.sheets[0]?.headers['A']).toBe('App ID');
  });

  it('turns contact, phone, and email columns into presence booleans only (#3081)', () => {
    expect(res.rows[0]!.pii).toEqual({ support_contact_present: true, support_phone_present: true, support_email_present: true });
    expect(res.rows[1]!.pii).toEqual({ support_contact_present: false, support_phone_present: false, support_email_present: false });
    expect(res.rows[2]!.pii.support_phone_present).toBe(true);
    const serialised = JSON.stringify(res);
    for (const v of PLANTED_PII) expect(serialised).not.toContain(v);
  });

  it('redacts a vendor name that looks like a person (G-06) and keeps company names', () => {
    const icca = res.rows.find((r) => r.appId === 'hosapp300')!;
    expect(icca.values.vendor_name).toBe(REDACTED_CONTACT_NAME);
    expect(icca.vendorRedacted).toBe(true);
    expect(res.rows.find((r) => r.appId === 'hospacs004')!.values.vendor_name).toBe('FUJIFILM');
    expect(res.signals.some((s) => s.code === 'SCAFFOLD.PII_FIELD_SCRUBBED' && /redacted/.test(s.evidence.join(' ')))).toBe(true);
  });
});

describe('parseIntakeSheets: custom 18-column mapping (#3077)', () => {
  const res = parseIntakeSheets([sheet('Inventory', MAPPED_HEADERS, MAPPED_ROWS)], { map: mappedMap() });
  const byId = (id: string) => res.rows.find((r) => r.appId === id)!;

  it('parses all mapped columns', () => {
    expect(res.rows).toHaveLength(8);
    const r = byId('hosapp133');
    expect(r).toMatchObject({ appName: 'Radimetrics', integrations: ['hosapp141'] });
    expect(r.values).toMatchObject({ cpu_cores: 4, memory_mb: 8192, active_memory_mb: 1310, disk_count: 2, os: 'Windows Server 2016 (64-bit)', migration_candidate: true, vendor_url: null, business_function: 'Dosimeter' });
    expect(r.pii).toEqual({ support_contact_present: true, support_phone_present: true, support_email_present: true });
  });

  it('converts MiB to GB: 1048576 MiB -> 1024 GB', () => {
    expect(byId('hospacs004').values.total_disk_gb).toBe(1024);
    expect(byId('hospacs004').values.total_disk_mib).toBe(1048576);
  });

  it('keeps free-text integration notes and splits multi-department domains', () => {
    const r = byId('hosapp153-macmon');
    expect(r.integrations).toEqual([]);
    expect(r.integrationsNotes).toBe('Anbindung ans PACS');
    expect(r.domains).toEqual(['Alle', 'IT']);
    expect(r.values.business_domain).toBe('Alle');
    expect(r.values.ams_sovereign_cloud).toBe(true);
  });

  it('emits SCAFFOLD.ID_FLAG_DETECTED for each flagged identity cell (#3082)', () => {
    const flagged = res.signals.filter((s) => s.code === 'SCAFFOLD.ID_FLAG_DETECTED').map((s) => s.app_id).sort();
    expect(flagged).toEqual(['hosapp045', 'hosapp050', 'hosapp051']);
    expect(byId('hosapp045').flag).toBe('restricted');
  });

  it('aggregates one PII_FIELD_SCRUBBED signal per PII column, citing column and count only', () => {
    const scrubbed = res.signals.filter((s) => s.code === 'SCAFFOLD.PII_FIELD_SCRUBBED');
    expect(scrubbed.map((s) => s.evidence[0])).toEqual([
      'intake column K: 2 non-empty value(s) scrubbed',
      'intake column L: 2 non-empty value(s) scrubbed',
      'intake column N: 1 non-empty value(s) scrubbed',
    ]);
    const serialised = JSON.stringify(res);
    for (const v of PLANTED_PII) expect(serialised).not.toContain(v);
  });

  it('fails with a clear error when the mapped sheet does not exist', () => {
    const map = parseColumnMap({ ...(load(MAPPED_COLUMN_MAP_YAML) as object), source: { sheet: 'Missing' } });
    expect(() => parseIntakeSheets([sheet('Inventory', MAPPED_HEADERS, MAPPED_ROWS)], { map })).toThrow(IntakeError);
  });
});

describe('parseIntakeSheets: multi-sheet, duplicates, mandatory fields', () => {
  it('reads every sheet and uses the sheet name as business.domain when the column is absent (G-09)', () => {
    const headers = ['App ID', 'App Name', 'OS'];
    const res = parseIntakeSheets([
      sheet('Radiologie', headers, [['HOSAPP001', 'Viewer', 'Windows Server 2019']]),
      sheet('Labor', headers, [['HOSAPP002', 'Analyser', 'Debian 12']]),
      sheet('Sheet3', headers, [['HOSAPP003', 'Other', 'Debian 12']]),
    ]);
    expect(res.rows.map((r) => [r.appId, r.values.business_domain])).toEqual([
      ['hosapp001', 'Radiologie'],
      ['hosapp002', 'Labor'],
      ['hosapp003', undefined],
    ]);
  });

  it('reports duplicate app IDs with every source row', () => {
    const res = parseIntakeSheets([sheet('S', ['App ID', 'OS'], [['HOSAPP001', 'x'], ['hosapp001', 'y'], ['HOSAPP002', 'z']])]);
    expect(res.duplicateIds).toEqual(['hosapp001']);
    const dup = res.signals.find((s) => s.code === 'SCAFFOLD.DUPLICATE_ID')!;
    expect(dup.evidence).toEqual(['intake sheet "S" row 2', 'intake sheet "S" row 3']);
  });

  it('keeps every word of a separate ID cell and strips flag words (#3162)', () => {
    const res = parseIntakeSheets([sheet('S', ['App ID', 'OS'], [['FILESRV 2020', 'x'], ['FILESRV', 'y'], ['HOSAPP053 Alt Abgeschaltet', 'z']])]);
    expect(res.duplicateIds).toEqual([]);
    expect(res.rows.map((r) => r.appId)).toEqual(['filesrv-2020', 'filesrv', 'hosapp053']);
    expect(res.rows[2]!.flag).toBe('decommissioned');
  });

  it('flags a blank identity cell and a missing OS as MANDATORY_FIELD_MISSING', () => {
    const res = parseIntakeSheets([sheet('S', ['App ID', 'App Name', 'OS'], [[null, 'Orphan', 'x'], ['HOSAPP001', 'NoOs', null]])]);
    expect(res.rows.map((r) => r.appId)).toEqual(['hosapp001']);
    const missing = res.signals.filter((s) => s.code === 'SCAFFOLD.MANDATORY_FIELD_MISSING');
    expect(missing).toHaveLength(2);
    expect(missing.map((s) => s.evidence[0])).toEqual(['intake sheet "S" row 2: identity column blank', 'app hosapp001: os blank']);
  });

  it('warns on type mismatches without echoing the offending values', () => {
    const res = parseIntakeSheets([sheet('S', ['App ID', 'OS', 'CPU Cores'], [['HOSAPP001', 'x', 'four'], ['HOSAPP002', 'y', 2]])]);
    expect(res.warnings).toEqual(['field cpu_cores: 1 of 2 value(s) not numeric; stored as null']);
    expect(res.rows[0]!.values.cpu_cores).toBeNull();
  });
});

describe('looksLikePersonalName (G-06)', () => {
  it.each([
    ['Erika Musterfrau', true],
    ['Dr. M. Muster', true],
    ['Muster, Erika', true],
    ['support@example.org', true],
    ['+49 30 1234567', true],
    ['FUJIFILM', false],
    ['Example Dose Vendor GmbH', false],
    ['Agfa HealthCare', false],
    ['Siemens Healthineers', false],
  ])('%s -> %s', (value, expected) => {
    expect(looksLikePersonalName(value, ['Siemens Healthineers'])).toBe(expected);
  });
});
