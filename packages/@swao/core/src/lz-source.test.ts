// #3887: LZ evidence source of an Application Assessment (Design 123 section 8.4, D-08).
// #4244 (owner decision 2026-11-09): live landing-zone data is used only by the
// LZ Live Assessment; an app run always uses the static LZ catalogue.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SwaoYmlLandingZonesSchema } from './swao-yml.js';
import { RunContextSchema } from './run-context.js';
import { describeLzAppLinks, listLzLiveRunIds, LZ_LIVE_APP_SOURCE_REFUSAL, lzSourceCliArgs, resolveLzSource, seedCatalogueTargetsForApp, seedLinkedCatalogueTargets } from './lz-source.js';

const LZS = SwaoYmlLandingZonesSchema.parse([
  { id: 'otc-prod', provider: 'otc', scopes: [
    { id: 'platform', kind: 'platform', auth: 'iam-password-token' },
    { id: 'app-pay', kind: 'application', auth: 'iam-password-token', app: 'payments' },
  ] },
  { id: 'stackit-a', provider: 'stackit', scopes: [{ id: 'platform', kind: 'platform', auth: 'key-flow' }] },
]);

describe('resolveLzSource (#3887, #4244: the catalogue only)', () => {
  it('1. CLI catalogue: --lz-source catalogue or --lz-cat-targets; a linked app keeps its link (#4321)', () => {
    const linked = [{ lz_id: 'otc-prod', provider: 'otc', scope_ids: ['app-pay'] }];
    expect(resolveLzSource({ appId: 'payments', cliSource: 'catalogue', landingZones: LZS })).toEqual({ ok: true, value: { source: 'catalogue', origin: 'cli', linked } });
    // #4321: the TUI passes its confirmed targets as --lz-cat-targets; the link is still returned.
    expect(resolveLzSource({ appId: 'payments', cliCatalogueTargets: true, landingZones: LZS })).toEqual({ ok: true, value: { source: 'catalogue', origin: 'cli', linked } });
    expect(resolveLzSource({ appId: 'billing', cliCatalogueTargets: true, landingZones: LZS })).toEqual({ ok: true, value: { source: 'catalogue', origin: 'cli' } });
  });
  it('2. .swao.yml: an app named in landing_zones[].scopes[].app stays on the catalogue and carries the link for the warning', () => {
    expect(resolveLzSource({ appId: 'payments', landingZones: LZS })).toEqual({
      ok: true, value: { source: 'catalogue', origin: 'swao-yml', linked: [{ lz_id: 'otc-prod', provider: 'otc', scope_ids: ['app-pay'] }] },
    });
  });
  it('2. an app linked to several landing zones is no error any more: the catalogue, with every link', () => {
    const twice = SwaoYmlLandingZonesSchema.parse([
      { id: 'a', provider: 'otc', scopes: [{ id: 's', kind: 'application', auth: 'iam-password-token', app: 'payments' }] },
      { id: 'b', provider: 'otc', scopes: [{ id: 's', kind: 'application', auth: 'iam-password-token', app: 'payments' }, { id: 't', kind: 'application', auth: 'iam-password-token', app: 'payments' }] },
    ]);
    const r = resolveLzSource({ appId: 'payments', landingZones: twice });
    expect(r.ok && r.value.linked?.map((l) => l.lz_id)).toEqual(['a', 'b']);
    expect(r.ok && describeLzAppLinks(r.value.linked ?? [])).toBe('landing zone a, scope s; landing zone b, scopes s, t');
  });
  it('3. default: catalogue for an unlinked app or a workspace without landing zones', () => {
    expect(resolveLzSource({ appId: 'billing', landingZones: LZS })).toEqual({ ok: true, value: { source: 'catalogue', origin: 'default' } });
    expect(resolveLzSource({ appId: 'billing', landingZones: [] })).toEqual({ ok: true, value: { source: 'catalogue', origin: 'default' } });
  });
  it('refuses --lz-source live, --lz and --scope with a pointer to the LZ Live Assessment', () => {
    const err = (i: Parameters<typeof resolveLzSource>[0]): string => {
      const r = resolveLzSource(i);
      return r.ok ? '' : r.error;
    };
    expect(err({ appId: 'payments', cliSource: 'live', landingZones: LZS })).toBe(LZ_LIVE_APP_SOURCE_REFUSAL);
    expect(err({ appId: 'billing', cliSource: 'live', cliLz: 'otc-prod', landingZones: LZS })).toContain('swao assess --type landing-zone-live --lz <lz-id>');
    expect(err({ appId: 'billing', cliLz: 'otc-prod', landingZones: LZS })).toContain('select a live landing zone for swao assess --type landing-zone-live');
    expect(err({ appId: 'billing', cliScopes: ['platform'], landingZones: LZS })).toContain('an app assessment uses the static LZ catalogue');
    expect(err({ appId: 'payments', cliSource: 'stream', landingZones: LZS })).toContain('--lz-source must be catalogue, not "stream"');
  });
});

describe('live run listing and CLI flags (#3887)', () => {
  const tmp: string[] = [];
  afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it('lists run ids newest first', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-lzsrc-'));
    tmp.push(ws);
    for (const r of ['2026-11-01T08-00-00', '2026-11-05T08-00-00', 'not-a-run']) mkdirSync(join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', r), { recursive: true });
    expect(listLzLiveRunIds(ws, 'otc-prod')).toEqual(['2026-11-05T08-00-00', '2026-11-01T08-00-00']);
    expect(listLzLiveRunIds(ws, 'stackit-a')).toEqual([]);
  });

  it('turns a catalogue choice into the CLI flags the resolver reads back (CLI and TUI parity)', () => {
    const args = lzSourceCliArgs({ source: 'catalogue', targets: ['otc:eu-de'] });
    expect(args).toEqual(['--lz-source', 'catalogue', '--lz-cat-targets', 'otc:eu-de']);
    expect(resolveLzSource({ appId: 'billing', cliSource: args[1], cliCatalogueTargets: true, landingZones: LZS })).toEqual({ ok: true, value: { source: 'catalogue', origin: 'cli' } });
    expect(lzSourceCliArgs({ source: 'catalogue', targets: [] })).toEqual(['--no-lz-fit']);
  });
});

// #3980 seeding (owner decision 2026-11-06), narrowed by #4244: catalogue
// targets of a linked app from the scope regions in .swao.yml only.
describe('seedLinkedCatalogueTargets (#3980, #4244)', () => {
  const seedDirs: string[] = [];
  afterEach(() => { for (const d of seedDirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  const lzOf = (regions?: string[]) => SwaoYmlLandingZonesSchema.parse([{ id: 'otc-prod', provider: 'otc', scopes: [
    { id: 'app-pay', kind: 'application', auth: 'iam-password-token', app: 'payments', ...(regions ? { regions } : {}) },
  ] }]);

  it('seeds the linked scope regions in .swao.yml, sorted', () => {
    expect(seedLinkedCatalogueTargets(lzOf(['eu-nl', 'eu-de'])[0]!, ['app-pay'])).toEqual({ provider: 'otc', regions: ['eu-de', 'eu-nl'], source: 'swao-yml-scope-regions' });
  });

  it('#4244: without scope regions nothing is seeded, even when a live run of the landing zone exists (the live run is never read)', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-lz-seed-'));
    seedDirs.push(ws);
    const dir = join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-11-06T08-00-00');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'lz-live-merged.yaml'), JSON.stringify({ lz_id: 'otc-prod', provider: 'otc', scopes: [{ scope_id: 'app-pay', status: 'merged' }], estate: { resources: [{ id: 'vm-1', type: 'ecs', region: 'eu-nl', seen_by: ['app-pay'] }] } }));
    expect(seedLinkedCatalogueTargets(lzOf()[0]!, ['app-pay'])).toBeNull();
    expect(seedCatalogueTargetsForApp(lzOf(), 'payments')).toBeNull();
  });

  it('seedCatalogueTargetsForApp: the linked landing zone of the app; null for an unlinked app', () => {
    expect(seedCatalogueTargetsForApp(lzOf(['eu-nl']), 'payments')).toEqual({ provider: 'otc', regions: ['eu-nl'], source: 'swao-yml-scope-regions', lz_id: 'otc-prod' });
    expect(seedCatalogueTargetsForApp(lzOf(['eu-nl']), 'billing')).toBeNull();
  });
});

describe('run-context.yaml lz_source_reason (#3980, #4244)', () => {
  const base = { assessment_type: 'application', run_timestamp: '2026-11-09T20:00:00.000Z', swao_version: '1.6.0', lz_source: 'catalogue' };
  it('#4244: reason lz-live-assessment-only without tier fields', () => {
    const r = RunContextSchema.parse({ ...base, lz_source_reason: { requested: 'live', origin: 'swao-yml', lz_id: 'otc-prod', linked: 'landing zone otc-prod, scope platform', reason: 'lz-live-assessment-only', notice: 'n' } });
    expect(r.lz_source_reason?.reason).toBe('lz-live-assessment-only');
  });
  it('replay: a #3980 run with reason licence-tier and the tier fields still parses', () => {
    const r = RunContextSchema.parse({ ...base, lz_source_reason: { requested: 'live', origin: 'swao-yml', lz_id: 'otc-prod', reason: 'licence-tier', required_tier: 'consultant', current_tier: 'community', notice: 'n', seed_source: 'live-run-regions-in-use', seed_run_id: '2026-11-06T08-00-00' } });
    expect(r.lz_source_reason?.current_tier).toBe('community');
  });
});
