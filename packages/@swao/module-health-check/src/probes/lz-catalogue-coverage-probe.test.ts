// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health Check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3155: the LZ catalogue probe sees per-provider workspace copies and validates
// them through the same resolver the fit uses.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLzCatalogueCoverageProbe, readWorkspaceLzTargets } from './lz-catalogue-coverage-probe.js';
import { checkLzCatalogueProvenance } from '../commands/health-check.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const catalogue = (provider: string, regionIds: string[]) => JSON.stringify({
  meta: {
    schema_version: '0.1', name: `${provider} (workspace-local catalogue)`, provider, last_updated: '2026-10-10',
    source: { mode: 'curated', source_note: 'probe test' }, confidence: 'medium',
  },
  regions: regionIds.map((id) => ({ id, display: id, services: [] })),
});

/** Workspace with a per-provider copy, as written by `swao lz catalogue copy/new`. */
function workspace(provider: string, content: string): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lz-probe-'));
  dirs.push(ws);
  const dir = join(ws, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', provider);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.json'), content);
  return ws;
}

describe('lz_catalogue_coverage probe (#3155)', () => {
  it('counts a valid per-provider workspace copy as a workspace catalogue', () => {
    // bundledDir: null keeps this test about the resolver; the quality rules are covered below.
    const r = buildLzCatalogueCoverageProbe(workspace('my-sovereign-csp', catalogue('my-sovereign-csp', ['de-1'])), { bundledDir: null });
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/structurally valid \(1 workspace, \d+ bundled\); quality rules passed/);
  });

  it('warns on an invalid per-provider copy (previously invisible to the probe)', () => {
    const r = buildLzCatalogueCoverageProbe(workspace('aws', '{ "meta": {}, "regions": "x" }'));
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/^aws: .*failed validation/);
    expect(r.gaps_count).toBe(1);
  });

  it('warns on duplicate region ids in a workspace copy', () => {
    const r = buildLzCatalogueCoverageProbe(workspace('aws', catalogue('aws', ['eu-central-1', 'eu-central-1'])));
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/duplicate region ID/);
  });

  it('provenance report lists the per-provider copy with origin workspace', () => {
    const lines = checkLzCatalogueProvenance(workspace('my-sovereign-csp', catalogue('my-sovereign-csp', ['de-1'])));
    expect(lines.some((l) => /my-sovereign-csp\s+origin=workspace/.test(l))).toBe(true);
  });
});

// #3282: the probe runs the shared LZ catalogue quality rules once and carries
// the results in health-check --json (lz_catalogue_coverage.quality).
describe('lz_catalogue_coverage probe: catalogue quality rules (#3282)', () => {
  const NOW = new Date('2026-10-17T00:00:00Z');

  /** A bundled-style catalogue directory: catalogue files + template, no index.json (#3298). */
  function catalogueDir(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'swao-lz-bundled-'));
    dirs.push(dir);
    writeFileSync(join(dir, '_lz-catalogue-template.json'), JSON.stringify({
      meta: { schema_version: '0.1', name: 't', provider: 't', last_updated: '2026-10-01', source: { mode: 'curated' }, confidence: 'medium', regions_count: 0 },
      regions: [],
    }));
    for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
    return dir;
  }
  const emptyWorkspace = (): string => { const ws = mkdtempSync(join(tmpdir(), 'swao-lz-ws-')); dirs.push(ws); return ws; };

  it('a bundled catalogue that fails the schema is a WARN naming file and reason (never skipped)', () => {
    const dir = catalogueDir({ 'acme.json': JSON.stringify({ meta: { provider: 'acme' }, regions: 'x' }) });
    const r = buildLzCatalogueCoverageProbe(emptyWorkspace(), { bundledDir: dir, now: NOW });
    expect(r.status).toBe('warn');
    expect(r.quality?.errors).toBeGreaterThan(0);
    const schema = r.quality?.findings.find((f) => f.rule === 'catalogue-schema');
    expect(schema).toMatchObject({ file: 'bundled/acme.json', severity: 'error' });
    expect(schema?.message).toMatch(/fails the catalogue schema/);
    expect(r.detail_lines?.some((l) => l.startsWith('[ERROR] catalogue-schema bundled/acme.json'))).toBe(true);
  });

  it('per-file drift and staleness reach the probe with the quality counts', () => {
    const cat = JSON.stringify({
      meta: { schema_version: '0.1', name: 'Acme', provider: 'acme', last_updated: '2026-06-01', source: { mode: 'curated', source_note: 'docs' }, confidence: 'medium', regions_count: 2 },
      regions: [{ id: 'de-1', sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: [] }, services: [{ code: 'vm' }] }],
    });
    const dir = catalogueDir({ 'acme.json': cat });
    const r = buildLzCatalogueCoverageProbe(emptyWorkspace(), { bundledDir: dir, now: NOW });
    const ruleIds = r.quality?.findings.map((f) => f.rule);
    expect(ruleIds).toContain('regions-count');
    expect(ruleIds?.some((id) => id.startsWith('index-'))).toBe(false);
    expect(ruleIds).toContain('stale');
    expect(r.quality?.dirs_checked).toEqual([dir]);
    expect(r.message).toMatch(/quality rules: 1 error\(s\), 1 warning\(s\)/);
  });

  const acme = (regionsCount: number) => JSON.stringify({
    meta: { schema_version: '0.1', name: 'Acme', provider: 'acme', last_updated: '2026-10-01', source: { mode: 'curated', source_note: 'docs' }, confidence: 'medium', regions_count: regionsCount },
    regions: [{ id: 'de-1', sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: [] }, services: [{ code: 'vm' }] }],
  });

  it('#3298: a workspace folder without index.json is found by its catalogue files and checked per file', () => {
    const ws = emptyWorkspace();
    const wsDir = join(ws, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, 'acme.json'), acme(2));
    const r = buildLzCatalogueCoverageProbe(ws, { now: NOW });
    const wsFindings = r.quality?.findings.filter((f) => !f.file.startsWith('bundled/')) ?? [];
    expect(r.quality?.dirs_checked).toHaveLength(2);
    expect(wsFindings.map((f) => `${f.rule}:${f.severity}:${f.file}`)).toEqual(['regions-count:error:wsp/inputs/catalogs/lz-catalogues/acme.json']);
  });

  it('#3298: an older workspace whose folder still carries an index.json keeps working; the index is ignored', () => {
    const ws = emptyWorkspace();
    const wsDir = join(ws, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
    mkdirSync(wsDir, { recursive: true });
    // An index seeded before #3298: stale name, a provider without a file, no regions_count.
    const e = (p: string, name: string) => ({ provider: p, file: `${p}.json`, name, last_updated: '2026-01-01', source: 'retail-prices-api', confidence: 'medium' });
    writeFileSync(join(wsDir, 'index.json'), JSON.stringify({ catalogues: [e('acme', 'Acme stale name'), e('ghost', 'g')], coming_soon: ['ionos'] }));
    writeFileSync(join(wsDir, 'acme.json'), acme(1));
    const r = buildLzCatalogueCoverageProbe(ws, { now: NOW });
    const wsFindings = r.quality?.findings.filter((f) => !f.file.startsWith('bundled/')) ?? [];
    expect(r.quality?.dirs_checked).toHaveLength(2);
    expect(wsFindings).toEqual([]);
    expect(r.quality?.errors).toBe(0); // bundled warnings (age, unsourced facts) may still make the probe WARN
    expect(r.message).toMatch(/1 workspace/);
    const lines = checkLzCatalogueProvenance(ws);
    expect(lines.some((l) => /acme\s+origin=workspace/.test(l))).toBe(true);
    expect(lines.some((l) => /ghost|index/.test(l))).toBe(false);
  });

  it('configured .swao.yml targets are checked against the catalogue region ids with the valid-region hint', () => {
    const ws = emptyWorkspace();
    writeFileSync(join(ws, '.swao.yml'), 'assessment:\n  landing_zone:\n    provider: aws\n    region: eu-central-1\n');
    mkdirSync(join(ws, 'apps', 'billing'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'billing', '.swao.yml'), 'assessment:\n  landing_zone:\n    targets:\n      - azure:Europe\n      - nosuchcsp:x-1\n');
    expect(readWorkspaceLzTargets(ws)).toHaveLength(3);
    const r = buildLzCatalogueCoverageProbe(ws, { bundledDir: null, now: NOW });
    const t = r.quality?.findings.filter((f) => f.rule === 'target-invalid') ?? [];
    expect(r.quality?.targets_checked).toBe(3);
    // #3281: azure:Europe is a known geography, reported as info naming the resolved region.
    expect(t).toHaveLength(1);
    expect(t[0]!.message).toMatch(/unknown LZ catalogue provider "nosuchcsp"/);
    const g = r.quality?.findings.filter((f) => f.rule === 'target-geography') ?? [];
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ file: 'apps/billing/.swao.yml', provider: 'azure', region: 'Europe', severity: 'info' });
    expect(g[0]!.message).toMatch(/resolves to the default region germanywestcentral/);
    expect(r.quality?.warnings).toBe(1);
    expect(r.status).toBe('warn');
  });

  it('#3281: an unknown region still warns with the hint; a geography alone keeps the probe ok', () => {
    const ws = emptyWorkspace();
    writeFileSync(join(ws, '.swao.yml'), 'assessment:\n  landing_zone:\n    targets:\n      - azure:Atlantis\n');
    const bad = buildLzCatalogueCoverageProbe(ws, { bundledDir: null, now: NOW });
    const t = bad.quality?.findings.filter((f) => f.rule === 'target-invalid') ?? [];
    expect(t).toHaveLength(1);
    expect(t[0]!.message).toMatch(/"Atlantis" is not a azure region id\. Valid regions include: /);
    expect(bad.status).toBe('warn');

    writeFileSync(join(ws, '.swao.yml'), 'assessment:\n  landing_zone:\n    targets:\n      - azure:Europe\n');
    const geo = buildLzCatalogueCoverageProbe(ws, { bundledDir: null, now: NOW });
    expect(geo.status).toBe('ok');
    expect(geo.detail_lines).toEqual([expect.stringMatching(/^\[INFO\] target-geography .*germanywestcentral/)]);
  });

  it('the shipped bundled catalogues raise no error-severity finding', () => {
    const r = buildLzCatalogueCoverageProbe(emptyWorkspace(), { now: NOW });
    expect(r.quality?.dirs_checked).toHaveLength(1);
    expect(r.quality?.errors).toBe(0);
    expect(r.quality?.catalogues_checked).toBeGreaterThanOrEqual(10);
  });
});
