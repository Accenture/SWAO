// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3282: one test per LZ catalogue quality rule, plus the shipped catalogues.
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { safeParseLzCatalogue, safeParseVmPriceTable } from '@swao/core';
import {
  checkLzCatalogueDir,
  checkLzConfiguredTargets,
  readLzConfiguredTargets,
  formatLzQualityFindings,
  lzRegionHint,
  parseLzDate,
  isLzProviderCatalogueFile,
  LZ_CATALOGUE_QUALITY_RULES,
  LZ_CATALOGUE_MAX_AGE_DAYS,
  LZ_CERTIFICATION_VOCABULARY,
  LZ_OPERATOR_SITE_RESIDENCY,
  LZ_PRICE_TABLE_FILE,
  type LzCatalogueQualityOptions,
  type LzQualityRuleId,
} from '../quality.js';
import { LZ_SOVEREIGNTY_PINS, AWS_SOVEREIGNTY_PINS, LZ_SOVEREIGNTY_PIN_SOURCES } from '../sovereignty-pins.js';
import { resolveLzGeography, lzRegionGeographies, LZ_GEOGRAPHY_COUNTRIES } from '../geographies.js';
import { checkLzCatalogueQuality } from '../loader.js';

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLED = resolve(here, '../../../../../../lz-catalogues');
const NOW = new Date('2026-10-17T00:00:00Z');

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const opts: LzCatalogueQualityOptions = {
  validate: (raw) => { const r = safeParseLzCatalogue(raw); return r.ok ? [] : r.issues; },
  pins: LZ_SOVEREIGNTY_PINS,
  now: NOW,
};

const TEMPLATE = JSON.parse(readFileSync(join(BUNDLED, '_lz-catalogue-template.json'), 'utf-8')) as unknown;

type Obj = Record<string, unknown>;

function region(id: string, over: Obj = {}): Obj {
  return {
    id,
    display: id,
    country: 'DE',
    sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: ['ISO_27001'] },
    services: [{ code: 'vm', status: 'ga', fulfills: ['vm_compute'] }],
    ...over,
  };
}

function catalogue(provider: string, regions: Obj[], meta: Obj = {}): Obj {
  return {
    meta: {
      schema_version: '0.1',
      name: `${provider} catalogue`,
      provider,
      last_updated: '2026-10-01',
      source: { mode: 'curated', operator: 'SWAO team', source_note: 'curated from provider documentation' },
      confidence: 'medium',
      regions_count: regions.length,
      ...meta,
    },
    regions,
  };
}

/** A catalogue directory: files (raw strings allowed), template copied from the bundle; no index.json (#3298). */
function fixture(files: Record<string, Obj | string>, opt: { template?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'swao-lz-quality-'));
  dirs.push(dir);
  if (opt.template !== false) writeFileSync(join(dir, '_lz-catalogue-template.json'), JSON.stringify(TEMPLATE));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

function rules(dir: string, o: Partial<LzCatalogueQualityOptions> = {}): LzQualityRuleId[] {
  return checkLzCatalogueDir(dir, { ...opts, ...o }).findings.map((f) => f.rule);
}

function findings(dir: string) {
  return checkLzCatalogueDir(dir, opts).findings;
}

describe('LZ catalogue quality rules (#3282)', () => {
  it('a clean catalogue directory has no findings', () => {
    const r = checkLzCatalogueDir(fixture({ 'acme.json': catalogue('acme', [region('de-1')]) }), opts);
    expect(r.findings).toEqual([]);
    expect(r.catalogues_checked).toBe(1);
    expect(r.rules_checked).toBe(LZ_CATALOGUE_QUALITY_RULES.length - 3); // target rules run in the probe; no geography model injected
  });

  it('#3298: no index rules exist; an index.json left in an older folder is ignored, never read', () => {
    expect(LZ_CATALOGUE_QUALITY_RULES.map((r) => r.id).filter((id) => id.startsWith('index-'))).toEqual([]);
    const dir = fixture({
      'acme.json': catalogue('acme', [region('de-1')]),
      // Stale and broken on purpose: it must not produce a finding.
      'index.json': '{ "catalogues": [{ "provider": "ghost", "file": "ghost.json" }], not json',
    });
    const r = checkLzCatalogueDir(dir, opts);
    expect(r.findings).toEqual([]);
    expect(r.catalogues_checked).toBe(1);
  });

  it('#3298: support files next to the catalogues are not checked as catalogues', () => {
    const dir = fixture({
      'acme.json': catalogue('acme', [region('de-1')]),
      '_coming-soon.json': { coming_soon: ['ionos'] },
      'aws-service-meta.json': { generated_at: '2026-10-01', services: {} },
    });
    const r = checkLzCatalogueDir(dir, opts);
    expect(r.findings).toEqual([]);
    expect(r.catalogues_checked).toBe(1);
  });

  it('template-invalid: missing template', () => {
    expect(rules(fixture({ 'acme.json': catalogue('acme', [region('de-1')]) }, { template: false }))).toContain('template-invalid');
  });

  it('catalogue-schema: invalid JSON and schema failures name file and reason', () => {
    const f = findings(fixture({ 'acme.json': '{ broken', 'beta.json': catalogue('beta', [region('b-1', { bogus: 1 })]) }));
    expect(f).toContainEqual(expect.objectContaining({ rule: 'catalogue-schema', file: 'acme.json', message: expect.stringMatching(/not valid JSON/) }));
    expect(f).toContainEqual(expect.objectContaining({ rule: 'catalogue-schema', file: 'beta.json', message: expect.stringMatching(/fails the catalogue schema: regions\.0/) }));
  });

  it('provider-filename: meta.provider must match the file name', () => {
    const f = findings(fixture({ 'acme.json': catalogue('acme-cloud', [region('de-1')]) }));
    expect(f.map((x) => x.rule)).toContain('provider-filename');
  });

  it('meta-fields: meta field set must equal the template', () => {
    const cat = catalogue('acme', [region('de-1')]);
    delete (cat['meta'] as Obj)['regions_count'];
    const f = findings(fixture({ 'acme.json': cat }));
    expect(f.find((x) => x.rule === 'meta-fields')?.message).toMatch(/missing regions_count/);
  });

  it('regions-count: meta.regions_count must equal the region count', () => {
    expect(rules(fixture({ 'acme.json': catalogue('acme', [region('de-1')], { regions_count: 2 }) }))).toContain('regions-count');
  });

  it('region-id-duplicate: region ids are unique per provider', () => {
    const f = findings(fixture({ 'acme.json': catalogue('acme', [region('de-1'), region('de-1')]) }));
    expect(f).toContainEqual(expect.objectContaining({ rule: 'region-id-duplicate', region: 'de-1', severity: 'error' }));
  });

  it('sovereignty-shape: all four facts are required; operator-site regions state OPERATOR_SITE (#3287 D-20)', () => {
    const noBlock = findings(fixture({ 'acme.json': catalogue('acme', [region('de-1', { sovereignty: undefined })]) }));
    expect(noBlock).toContainEqual(expect.objectContaining({ rule: 'sovereignty-shape', severity: 'error' }));
    const partial = findings(fixture({ 'acme.json': catalogue('acme', [region('de-1', { sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity' } })]) }));
    expect(partial.find((f) => f.rule === 'sovereignty-shape')).toMatchObject({ severity: 'error', message: expect.stringMatching(/extraterritorial_exposure, certifications/) });
    // The former omission exception is gone: an omitted residency is an error, with the sentinel hint.
    const site = findings(fixture({ 'acme.json': catalogue('acme', [region('site', { sovereignty: { operator_jurisdiction: 'operator-site', extraterritorial_exposure: [], certifications: [] } })]) }));
    expect(site.find((f) => f.rule === 'sovereignty-shape')).toMatchObject({ severity: 'error', message: expect.stringMatching(/set residency_country "OPERATOR_SITE"/) });
    const sentinel = findings(fixture({ 'acme.json': catalogue('acme', [region('site', { country: undefined, sovereignty: { residency_country: LZ_OPERATOR_SITE_RESIDENCY, operator_jurisdiction: 'operator-site', extraterritorial_exposure: [], certifications: [] } })]) }));
    expect(sentinel.filter((f) => f.rule === 'sovereignty-shape')).toEqual([]);
    const misused = findings(fixture({ 'acme.json': catalogue('acme', [region('de-1', { sovereignty: { residency_country: LZ_OPERATOR_SITE_RESIDENCY, operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: [] } })]) }));
    expect(misused.find((f) => f.rule === 'sovereignty-shape')).toMatchObject({ severity: 'error', message: expect.stringMatching(/valid only with operator_jurisdiction "operator-site"/) });
  });

  it('certification-vocabulary (#3287 D-21): certifications outside the template vocabulary are a warning', () => {
    expect(LZ_CERTIFICATION_VOCABULARY).toEqual(expect.arrayContaining(['BSI_C5', 'ISO_27001', 'SOC_2', 'TISAX_L3', 'PCI_DSS', 'FedRAMP_High', 'MAS_TRM', 'IRAP']));
    const known = findings(fixture({ 'acme.json': catalogue('acme', [region('de-1', { sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: ['PCI_DSS', 'FedRAMP_High', 'MAS_TRM', 'IRAP'] } })]) }));
    expect(known.filter((f) => f.rule === 'certification-vocabulary')).toEqual([]);
    const odd = findings(fixture({ 'acme.json': catalogue('acme', [region('de-1', { sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: ['C5', 'ISO_27001'] } })]) }));
    expect(odd.find((f) => f.rule === 'certification-vocabulary')).toMatchObject({ severity: 'warn', region: 'de-1', message: expect.stringMatching(/outside the template vocabulary: C5 /) });
  });

  it('the template documents the same certification vocabulary and the OPERATOR_SITE sentinel', () => {
    const raw = readFileSync(join(BUNDLED, '_lz-catalogue-template.json'), 'utf-8');
    expect(raw).toContain(`Valid SWAO vocabulary: ${LZ_CERTIFICATION_VOCABULARY.join(', ')}`);
    expect(raw).toContain(LZ_OPERATOR_SITE_RESIDENCY);
  });

  it('confidence-vocabulary: meta.confidence from high, medium, low', () => {
    const dir = fixture({ 'acme.json': catalogue('acme', [region('de-1')], { confidence: 'certain' }) });
    const f = findings(dir).filter((x) => x.rule === 'confidence-vocabulary');
    expect(f.map((x) => x.file)).toEqual(['acme.json']);
  });

  it('source-missing: meta.source.mode is required', () => {
    const cat = catalogue('acme', [region('de-1')], { source: { mode: '' } });
    const dir = fixture({ 'acme.json': cat });
    const f = findings(dir).filter((x) => x.rule === 'source-missing');
    expect(f.map((x) => x.file)).toEqual(['acme.json']);
  });

  it('date-format: last_updated must be a valid YYYY-MM-DD date', () => {
    expect(parseLzDate('2026-02-30')).toBeNull();
    expect(parseLzDate('2026-10-01')?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    const dir = fixture({ 'acme.json': catalogue('acme', [region('de-1')], { last_updated: '01.10.2026' }) });
    expect(rules(dir).filter((r) => r === 'date-format')).toHaveLength(1);
  });

  it(`stale: last_updated older than the threshold (default ${LZ_CATALOGUE_MAX_AGE_DAYS} days) is a warning, threshold configurable`, () => {
    const dir = fixture({
      'acme.json': catalogue('acme', [region('de-1')], { last_updated: '2026-07-01' }),
      'acme-service-meta.json': { generated_at: '2026-06-01', services: {} },
    });
    const f = findings(dir).filter((x) => x.rule === 'stale');
    expect(f.map((x) => x.file).sort()).toEqual(['acme-service-meta.json', 'acme.json']);
    expect(f.every((x) => x.severity === 'warn')).toBe(true);
    expect(f.find((x) => x.file === 'acme.json')?.message).toMatch(/108 days old \(threshold 90 days\)/);
    expect(rules(dir, { maxAgeDays: 200 })).not.toContain('stale');
  });

  it('services-empty: a region without services is a warning', () => {
    const f = findings(fixture({ 'acme.json': catalogue('acme', [region('de-1', { services: [] })]) }));
    expect(f).toContainEqual(expect.objectContaining({ rule: 'services-empty', region: 'de-1', severity: 'warn' }));
  });

  it('service-code-duplicate: a service code listed twice in one region is a warning', () => {
    const f = findings(fixture({ 'acme.json': catalogue('acme', [region('de-1', { services: [{ code: 'vm' }, { code: 'vm' }] })]) }));
    expect(f).toContainEqual(expect.objectContaining({ rule: 'service-code-duplicate', severity: 'warn' }));
  });

  it('pin-drift: facts that differ from the refresh overlay pin (#1382 aws-iso-e pattern)', () => {
    const pinned = AWS_SOVEREIGNTY_PINS['eu-isoe-west-1']!;
    const drifted = region('eu-isoe-west-1', { sovereignty: { ...pinned, operator_jurisdiction: 'EU-entity', certifications: ['BSI_C5'] } });
    const f = findings(fixture({ 'aws-iso-e.json': catalogue('aws-iso-e', [drifted], { source: { mode: 'botocore-endpoints' } }) }));
    const d = f.find((x) => x.rule === 'pin-drift');
    expect(d?.severity).toBe('warn');
    expect(d?.message).toMatch(/operator_jurisdiction "EU-entity" vs pin "US-entity"/);
    expect(d?.message).toMatch(/certifications/);
    // Same facts in a different order are not drift.
    const same = region('eu-isoe-west-1', { sovereignty: { ...pinned, extraterritorial_exposure: [...pinned.extraterritorial_exposure].reverse() } });
    expect(rules(fixture({ 'aws-iso-e.json': catalogue('aws-iso-e', [same], { source: { mode: 'botocore-endpoints' } }) }))).not.toContain('pin-drift');
  });

  it('facts-unsourced: UNKNOWN placeholder, unpinned region without source_note, curated file without source_note', () => {
    const unknown = region('xx-new-1', { sovereignty: { residency_country: 'UNKNOWN', operator_jurisdiction: 'US-entity', extraterritorial_exposure: [], certifications: [] } });
    const unpinned = region('xx-new-2');
    const f = findings(fixture({ 'aws.json': catalogue('aws', [unknown, unpinned], { source: { mode: 'botocore-endpoints' } }) }));
    expect(f.filter((x) => x.rule === 'facts-unsourced').map((x) => x.region)).toEqual(['xx-new-1', 'xx-new-2']);
    const curated = findings(fixture({ 'acme.json': catalogue('acme', [region('de-1')], { source: { mode: 'curated' } }) }));
    expect(curated.find((x) => x.rule === 'facts-unsourced')?.message).toMatch(/no meta\.source\.source_note/);
  });

  it('formatLzQualityFindings groups region findings per rule and file, errors first', () => {
    const lines = formatLzQualityFindings([
      { rule: 'services-empty', severity: 'warn', file: 'a.json', region: 'r1', message: 'region lists no services' },
      { rule: 'services-empty', severity: 'warn', file: 'a.json', region: 'r2', message: 'region lists no services' },
      { rule: 'catalogue-schema', severity: 'error', file: 'b.json', message: 'not valid JSON' },
    ]);
    expect(lines).toEqual([
      '[ERROR] catalogue-schema b.json: not valid JSON',
      '[WARN] services-empty a.json: 2 regions (r1, r2): region lists no services',
    ]);
  });

  it('overlay mode (workspace folder): no missing-template error, template taken from the bundle', () => {
    const dir = fixture(
      { 'acme.json': catalogue('acme', [region('de-1')]), 'extra.json': catalogue('extra', [region('x-1')]) },
      { template: false },
    );
    expect(rules(dir)).toEqual(['template-invalid']);
    const overlay = rules(dir, { overlay: true, templateFile: join(BUNDLED, '_lz-catalogue-template.json') });
    expect(overlay).toEqual([]);
  });

  it('every rule id is documented once', () => {
    const ids = LZ_CATALOGUE_QUALITY_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('geography-coverage: the shared geography model applies to every catalogue (#3281)', () => {
  const geo = { geographies: LZ_GEOGRAPHY_COUNTRIES };
  const sov = (c?: string) => ({ residency_country: c, operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: [] });

  it('counts the rule only when the model is injected; a tagged catalogue passes', () => {
    const dir = fixture({ 'acme.json': catalogue('acme', [region('de-1'), region('nl-1', { country: 'NL', sovereignty: sov('NL') })]) });
    const r = checkLzCatalogueDir(dir, { ...opts, ...geo });
    expect(r.findings).toEqual([]);
    expect(r.rules_checked).toBe(LZ_CATALOGUE_QUALITY_RULES.length - 2);
  });

  it('a residency country outside the model is an error naming the region', () => {
    const f = checkLzCatalogueDir(fixture({ 'acme.json': catalogue('acme', [region('de-1'), region('xx-1', { country: 'XX', sovereignty: sov('XX') })]) }), { ...opts, ...geo })
      .findings.filter((x) => x.rule === 'geography-coverage');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'error', region: 'xx-1', file: 'acme.json' });
    expect(f[0]!.message).toMatch(/"XX" is not in the shared geography model/);
  });

  it('a catalogue with no tagged region fails; an all operator-site catalogue (OPERATOR_SITE or omitted) does not', () => {
    const unknownOnly = fixture({ 'acme.json': catalogue('acme', [region('u-1', { country: 'UNKNOWN', sovereignty: sov('UNKNOWN') })]) });
    expect(checkLzCatalogueDir(unknownOnly, { ...opts, ...geo }).findings.filter((x) => x.rule === 'geography-coverage').map((x) => x.message))
      .toEqual([expect.stringMatching(/no region of this catalogue belongs to a geography/)]);
    const site = fixture({ 'site.json': catalogue('site', [region('connected', { country: undefined, sovereignty: sov(undefined) })]) });
    expect(checkLzCatalogueDir(site, { ...opts, ...geo }).findings.filter((x) => x.rule === 'geography-coverage')).toEqual([]);
    const sentinel = fixture({ 'site.json': catalogue('site', [region('connected', { country: undefined, sovereignty: { ...sov(LZ_OPERATOR_SITE_RESIDENCY), operator_jurisdiction: 'operator-site' } })]) });
    expect(checkLzCatalogueDir(sentinel, { ...opts, ...geo }).findings.filter((x) => x.rule === 'geography-coverage')).toEqual([]);
    expect(lzRegionGeographies({ id: 'connected', sovereignty: { residency_country: LZ_OPERATOR_SITE_RESIDENCY } })).toEqual([]);
  });

  it('every shipped catalogue complies with the shared model (gate parity)', () => {
    const r = checkLzCatalogueQuality(BUNDLED, { now: NOW });
    expect(r.findings.filter((x) => x.rule === 'geography-coverage')).toEqual([]);
  });
});

describe('configured LZ targets (#3282 criterion 5)', () => {
  const regionIds = { azure: ['westeurope', 'northeurope', 'germanywestcentral'], aws: ['eu-central-1'] };

  it('reads provider/region and the #3281 targets list (strings and objects)', () => {
    const t = readLzConfiguredTargets({
      assessment: { landing_zone: { provider: 'aws', region: 'eu-central-1', targets: ['azure:Europe', { provider: 'aws', region: 'eu-central-1' }, 'nocolon'] } },
    }, '.swao.yml');
    expect(t.map((x) => `${x.provider}:${x.region}`)).toEqual(['aws:eu-central-1', 'azure:Europe', 'aws:eu-central-1', 'nocolon:']);
    expect(t[1]!.origin).toBe('assessment.landing_zone.targets[0]');
    expect(t[1]!.file).toBe('.swao.yml');
  });

  it('a provider without a region (Pass 23 LZR only) is not a catalogue target', () => {
    expect(readLzConfiguredTargets({ assessment: { landing_zone: { provider: 'meshstack' } } }, '.swao.yml')).toEqual([]);
  });

  it('flags an unknown region with the valid-region hint, an unknown provider and a malformed target', () => {
    const t = readLzConfiguredTargets({ assessment: { landing_zone: { targets: ['azure:Europe', 'ionos:de-fra', 'aws:eu-central-1', 'nocolon'] } } }, 'apps/x/.swao.yml');
    const f = checkLzConfiguredTargets(t, regionIds);
    expect(f).toHaveLength(3);
    expect(f[0]!.message).toMatch(/"Europe" is not a azure region id\. Valid regions include: westeurope, northeurope, germanywestcentral\./);
    expect(f[1]!.message).toMatch(/unknown LZ catalogue provider "ionos"\. Known providers: aws, azure/);
    expect(f[2]!.message).toMatch(/not of the form <provider>:<region>/);
    expect(f.every((x) => x.rule === 'target-invalid' && x.severity === 'warn' && x.file === 'apps/x/.swao.yml')).toBe(true);
  });

  it('#3281: with the geography resolver a known geography is info naming the resolved region, not target-invalid', () => {
    const t = readLzConfiguredTargets({ assessment: { landing_zone: { targets: ['azure:Europe', 'azure:Atlantis', 'aws:eu-central-1'] } } }, 'apps/x/.swao.yml');
    const regions = [
      { id: 'westeurope', sovereignty: { residency_country: 'NL' }, services: [1, 2, 3] },
      { id: 'northeurope', sovereignty: { residency_country: 'IE' }, services: [1, 2, 3] },
      { id: 'germanywestcentral', sovereignty: { residency_country: 'DE' }, services: [1] },
    ];
    const f = checkLzConfiguredTargets(t, regionIds, (provider, region) => provider === 'azure' ? resolveLzGeography(region, regions) : undefined);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ rule: 'target-geography', severity: 'info', provider: 'azure', region: 'Europe' });
    expect(f[0]!.message).toMatch(/"Europe" is a geography, not a azure region id; it resolves to the default region germanywestcentral/);
    expect(f[1]).toMatchObject({ rule: 'target-invalid', severity: 'warn', region: 'Atlantis' });
    expect(formatLzQualityFindings(f)).toEqual([
      expect.stringMatching(/^\[WARN\] target-invalid /),
      expect.stringMatching(/^\[INFO\] target-geography /),
    ]);
  });

  it('lzRegionHint ranks close matches first and caps the list', () => {
    expect(lzRegionHint('germany', ['eastus', 'germanynorth', 'germanywestcentral'])).toEqual(['germanynorth', 'germanywestcentral', 'eastus']);
    expect(lzRegionHint('x', Array.from({ length: 20 }, (_, i) => `r${i}`))).toHaveLength(10);
  });
});

describe('shipped swao/lz-catalogues (#3282 gate parity)', () => {
  it('has no error-severity findings (the audit gate would fail otherwise)', () => {
    const r = checkLzCatalogueQuality(BUNDLED, { now: NOW });
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(r.catalogues_checked).toBeGreaterThanOrEqual(10);
  });

  it('pins cover the refresh partitions and keep the #1382 ISOE facts', () => {
    expect(Object.keys(LZ_SOVEREIGNTY_PINS).sort()).toEqual(['aws', 'aws-esc', 'aws-iso-e', 'azure', 'gcp']);
    expect(AWS_SOVEREIGNTY_PINS['eu-isoe-west-1']).toEqual({ residency_country: 'EU', operator_jurisdiction: 'US-entity', extraterritorial_exposure: ['us_cloud_act', 'fisa_702'], certifications: [] });
  });

  it('#3287: every documented pin source names an existing pin, an https URL and a retrieval date', () => {
    const keys = Object.keys(LZ_SOVEREIGNTY_PIN_SOURCES);
    expect(keys).toHaveLength(18);
    for (const k of keys) {
      const [table, id] = k.split('/') as [string, string];
      expect(LZ_SOVEREIGNTY_PINS[table]?.[id], k).toBeDefined();
      expect(LZ_SOVEREIGNTY_PIN_SOURCES[k]!.url).toMatch(/^https:\/\//);
      expect(parseLzDate(LZ_SOVEREIGNTY_PIN_SOURCES[k]!.retrieved), k).not.toBeNull();
    }
  });

  it('#3287/#3298: shipped catalogues carry meta.regions_count = regions (no index.json); azure-local uses OPERATOR_SITE', () => {
    expect(existsSync(join(BUNDLED, 'index.json'))).toBe(false);
    const files = readdirSync(BUNDLED).filter(isLzProviderCatalogueFile);
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) {
      const cat = JSON.parse(readFileSync(join(BUNDLED, f), 'utf-8')) as { meta: { regions_count?: number; source: { mode: string } }; regions: unknown[] };
      expect(cat.meta.regions_count, f).toBe(cat.regions.length);
      expect(cat.meta.source.mode, f).toBeTruthy();
    }
    const local = JSON.parse(readFileSync(join(BUNDLED, 'azure-local.json'), 'utf-8')) as { regions: Array<{ sovereignty: { residency_country?: string } }> };
    expect(local.regions.map((r) => r.sovereignty.residency_country)).toEqual([LZ_OPERATOR_SITE_RESIDENCY, LZ_OPERATOR_SITE_RESIDENCY]);
  });

  it('#3287: the shipped catalogues carry no certification outside the vocabulary and no sovereignty-shape warning', () => {
    const r = checkLzCatalogueQuality(BUNDLED, { now: NOW });
    expect(r.findings.filter((f) => f.rule === 'certification-vocabulary' || f.rule === 'sovereignty-shape')).toEqual([]);
  });
});

describe('price-table rule (#3288)', () => {
  const priceOpts: Partial<LzCatalogueQualityOptions> = {
    validatePriceTable: (raw) => { const r = safeParseVmPriceTable(raw); return r.ok ? [] : r.issues; },
  };
  const withPrices = (content: string): string => {
    const dir = fixture({ 'acme.json': catalogue('acme', [region('de-1')]) });
    mkdirSync(join(dir, 'prices'));
    writeFileSync(join(dir, LZ_PRICE_TABLE_FILE), content);
    return dir;
  };
  const bundledTable = readFileSync(join(BUNDLED, LZ_PRICE_TABLE_FILE), 'utf-8');

  it('the bundled price table passes, and the prices folder is not read as a provider catalogue', () => {
    expect(checkLzCatalogueDir(withPrices(bundledTable), { ...opts, ...priceOpts }).findings).toEqual([]);
    expect(checkLzCatalogueQuality(BUNDLED, { now: NOW }).findings.filter((f) => f.rule === 'price-table' || f.file.startsWith('prices'))).toEqual([]);
  });

  it('flags invalid JSON, a schema violation and a stale table', () => {
    expect(rules(withPrices('{ not json'), priceOpts)).toContain('price-table');
    const t = JSON.parse(bundledTable) as { prices: Array<Record<string, unknown>>; meta: Record<string, unknown> };
    t.prices[0]!['os'] = 'macos';
    const bad = checkLzCatalogueDir(withPrices(JSON.stringify(t)), { ...opts, ...priceOpts }).findings;
    expect(bad).toContainEqual(expect.objectContaining({ rule: 'price-table', severity: 'error', file: LZ_PRICE_TABLE_FILE }));
    t.prices[0]!['os'] = 'linux';
    t.meta['generated_at'] = '2026-01-01';
    expect(checkLzCatalogueDir(withPrices(JSON.stringify(t)), { ...opts, ...priceOpts }).findings).toContainEqual(expect.objectContaining({ rule: 'stale', file: LZ_PRICE_TABLE_FILE, severity: 'warn' }));
  });
});
