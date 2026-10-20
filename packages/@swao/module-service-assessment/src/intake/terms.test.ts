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

// #3210: German and mixed-language intake terms normalise to English canonical
// values at scaffold time; the client's wording is kept next to them.
// Synthetic data only.
import { describe, it, expect } from 'vitest';
import { loadInfraCatalogue } from '../catalog/infra-cat.js';
import { ServiceAppConfigSchema } from '../schema/service-app.schema.js';
import { planScaffold } from '../scaffold/plan.js';
import { parseIntakeSheets, type SheetLike } from './parser.js';
import { resolveDefaultMap } from './default-template.js';
import { canonicalTerm, resolveGlossary, CRITICALITY_TERMS, TIME_TERMS } from './terms.js';

function sheet(name: string, headers: readonly string[], rows: Array<Array<string | number | null>>): SheetLike {
  const grid = [headers as readonly unknown[], ...rows];
  return { name, rowCount: grid.length, cell: (r, c) => grid[r - 1]?.[c - 1] ?? null };
}

// Mixed German / English header row (reference intake layout plus German labels).
const MIXED_HEADERS = [
  'App-ID', 'Anwendungsname', 'Hersteller', 'Betriebssystem', 'Fachbereich', 'App-Funktion',
  'Kritikalität', 'Migrationskandidat', 'AMS Sovereign Cloud Ja / Nein', 'Gesundheitsdaten',
  'Datenklassifizierung', 'Time-Einstufung', 'KIS-Anbindung', 'Support aktiv', 'Hersteller Support',
];
const MIXED_ROWS: Array<Array<string | number | null>> = [
  ['HOSAPP901', 'Viewer', 'Siemens', 'Windows Server 2019', 'Radiologie', 'Befundung', 'Hoch', 'Ja', 'Nein', 'Ja', 'Vertraulich', 'Investieren', 'Anbindung ans PACS', 'k.A.', 'Service desk'],
  ['HOSAPP902', 'Lab', 'Roche', 'Windows Server 2016', 'Labor / Verwaltung', 'Dokumentation', 'mittel', 'Nein', 'Ja', 'N/A', 'Intern', 'Tolerieren', 'HOSAPP901', 'Ja', ''],
  ['HOSAPP903', 'Tool', 'Contoso', 'Ubuntu 22.04', 'Finance', 'Reporting', 'critical', 'k.A.', 'N/A', 'Nein', 'Confidential', 'Migrate', 'Nein', 'Nein', ''],
  ['HOSAPP904', 'Odd', 'Contoso', 'Ubuntu 22.04', 'Sonderbereich Nord', 'Spezialfunktion', 'B-Klasse', null, null, null, null, null, null, null, ''],
];

describe('header aliases cover German and English labels (#3210)', () => {
  it('maps every column of the mixed header row', () => {
    const headers = new Map(MIXED_HEADERS.map((h, i) => [i + 1, h]));
    const map = resolveDefaultMap(headers)!;
    expect(Object.keys(map.fields).sort()).toEqual([
      'ams_sovereign_cloud', 'business_domain', 'business_function', 'criticality', 'data_classification',
      'gartner_time', 'health_data', 'id', 'integrations_raw', 'migration_candidate', 'name', 'os',
      'vendor_name', 'vendor_support_active',
    ].sort());
    // "Hersteller Support" stays a personal-data column, not vendor_support_active.
    expect(map.pii_columns.map((p) => p.col)).toEqual(['O']);
    expect(map.fields.vendor_support_active?.col).toBe('N');
  });
});

describe('canonical terms (#3210)', () => {
  it('maps enumerations case-insensitively and reports the original wording', () => {
    expect(canonicalTerm('Hoch', CRITICALITY_TERMS)).toEqual({ value: 'high', source: 'Hoch', mapped: true });
    expect(canonicalTerm('high', CRITICALITY_TERMS)).toEqual({ value: 'high', mapped: true });
    expect(canonicalTerm('Eliminieren', TIME_TERMS)).toEqual({ value: 'Eliminate', source: 'Eliminieren', mapped: true });
    expect(canonicalTerm('B-Klasse', CRITICALITY_TERMS)).toEqual({ value: 'B-Klasse', mapped: false });
  });

  it('glossary: product defaults, English canonical identity, workspace override wins', () => {
    const g = resolveGlossary({ Radiologie: 'Diagnostic Imaging', Sonderbereich: 'Special Unit', bad: 3 });
    expect(canonicalTerm('Radiologie', g).value).toBe('Diagnostic Imaging');
    expect(canonicalTerm('Labor', g)).toEqual({ value: 'Laboratory', source: 'Labor', mapped: true });
    expect(canonicalTerm('Laboratory', g)).toEqual({ value: 'Laboratory', mapped: true });
    expect(canonicalTerm('Special Unit', g).mapped).toBe(true);
    expect(g['bad']).toBeUndefined();
  });
});

describe('scaffold with a mixed German / English intake (#3210)', () => {
  const intake = parseIntakeSheets([sheet('Sheet1', MIXED_HEADERS, MIXED_ROWS)]);
  const plan = planScaffold(intake.rows, loadInfraCatalogue(), { generatedAt: '2026-10-17' });
  const cfg = (id: string) => plan.apps.find((a) => a.appId === id)!.config as Record<string, any>;

  it('every generated config validates against the service app schema', () => {
    for (const a of plan.apps) expect(ServiceAppConfigSchema.safeParse(a.config).success).toBe(true);
  });

  it('yes / no / not specified map to booleans and null', () => {
    expect(cfg('hosapp901').disposition).toMatchObject({ migration_candidate: true, ams_sovereign_cloud: false });
    expect(cfg('hosapp901').data.health_data).toBe(true);
    expect(cfg('hosapp901').vendor.support_active).toBeNull(); // k.A.
    expect(cfg('hosapp902').data.health_data ?? null).not.toBe(false); // N/A is not "no"
    expect(cfg('hosapp903').disposition.migration_candidate).toBeNull(); // k.A.
    expect(intake.warnings.filter((w) => w.includes('not in true_values'))).toEqual([]);
  });

  it('department, function, criticality, classification and TIME use English canonical values, keeping the source wording', () => {
    expect(cfg('hosapp901').business).toMatchObject({
      domain: 'Radiology', domain_source: 'Radiologie',
      function: 'Diagnostic Reporting', function_source: 'Befundung',
      criticality: 'high', criticality_source: 'Hoch',
    });
    expect(cfg('hosapp901').data).toMatchObject({ classification: 'Confidential', classification_source: 'Vertraulich' });
    expect(cfg('hosapp901').disposition).toMatchObject({ gartner_time: 'Invest', gartner_time_source: 'Investieren' });
    expect(cfg('hosapp902').business).toMatchObject({
      domain: 'Laboratory', domain_source: 'Labor',
      domains: ['Laboratory', 'Administration'], domains_source: ['Labor', 'Verwaltung'],
      criticality: 'medium',
    });
  });

  it('English values pass through without a source key', () => {
    const b = cfg('hosapp903').business;
    expect(b.domain).toBe('Finance');
    expect(b.criticality).toBe('critical');
    expect('domain_source' in b).toBe(false);
    expect('criticality_source' in b).toBe(false);
    expect(cfg('hosapp903').disposition.gartner_time).toBe('Migrate');
  });

  it('unmapped values are kept verbatim and listed in one warning per field', () => {
    expect(cfg('hosapp904').business).toMatchObject({ domain: 'Sonderbereich Nord', function: 'Spezialfunktion', criticality: 'B-Klasse' });
    const w = plan.warnings;
    expect(w.find((x) => x.startsWith('field business.domain:'))).toContain('"Sonderbereich Nord"');
    expect(w.find((x) => x.startsWith('field business.domain:'))).toContain('service_portfolio.glossary');
    // "Reporting" is English but not a glossary term: still listed so the analyst can confirm it.
    expect(w.find((x) => x.startsWith('field business.function:'))).toMatch(/"Spezialfunktion"/);
    expect(w.find((x) => x.startsWith('field business.criticality:'))).toContain('"B-Klasse"');
    expect(w.some((x) => x.includes('Radiologie') || x.includes('Labor"'))).toBe(false);
  });

  it('free-text integration notes stay verbatim and are labelled as source text', () => {
    expect(cfg('hosapp901').integrations_notes).toBe('Anbindung ans PACS');
    expect(cfg('hosapp901').intake.source_text_fields).toEqual(['integrations_notes']);
    expect(cfg('hosapp902').integrations).toEqual(['hosapp901']);
    expect(cfg('hosapp902').intake.source_text_fields).toBeUndefined();
  });

  it('a workspace glossary override is applied', () => {
    const p = planScaffold(intake.rows, loadInfraCatalogue(), { glossary: resolveGlossary({ 'Sonderbereich Nord': 'North Special Unit', Spezialfunktion: 'Special Function', Reporting: 'Reporting' }) });
    const b = p.apps.find((a) => a.appId === 'hosapp904')!.config.business as Record<string, unknown>;
    expect(b).toMatchObject({ domain: 'North Special Unit', domain_source: 'Sonderbereich Nord', function: 'Special Function' });
    expect(p.warnings.some((x) => x.startsWith('field business.domain:'))).toBe(false);
    expect(p.warnings.some((x) => x.startsWith('field business.function:'))).toBe(false);
  });
});

describe('workspace glossary survives a scaffold re-run (#3210)', () => {
  it('upsertServicePortfolioBlock rewrites metadata and keeps analyst keys', async () => {
    const { upsertServicePortfolioBlock } = await import('../scaffold/write.js');
    const { load } = await import('js-yaml');
    const before = [
      'wsp_version: "0.9"',
      'service_portfolio:',
      '  source: old.xlsx',
      '  app_count: 1',
      '  glossary:',
      '    Sonderbereich Nord: North Special Unit',
      '  cost:',
      '    currency: EUR',
      'other: kept',
      '',
    ].join('\n');
    const meta = { source: 'new.xlsx', mapping: null, imported_at: '2026-10-17', app_count: 4, row_count: 4, sheets: ['Sheet1'], headers: {}, pii_columns: [], cluster_threshold: 3 };
    const doc = load(upsertServicePortfolioBlock(before, meta)) as Record<string, any>;
    expect(doc.service_portfolio).toMatchObject({ source: 'new.xlsx', app_count: 4, glossary: { 'Sonderbereich Nord': 'North Special Unit' }, cost: { currency: 'EUR' } });
    expect(doc.other).toBe('kept');
  });
});
