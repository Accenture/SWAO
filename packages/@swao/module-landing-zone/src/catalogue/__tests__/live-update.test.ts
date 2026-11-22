// #3582: Update LZ Catalogue with --source live and --new (Design 120 section
// 10.2). Synthetic LzLiveScan fixtures turned into a live catalogue with
// buildLzLiveCatalogue; the bundled catalogues are only read, into a
// temporary copy that acts as the bundled folder. Nothing in the repository's
// lz-catalogues/ folder is written by these tests.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { LicenseGuard, deriveLzScanBaseFields, parseLzCatalogue, parseLzLiveScan } from '@swao/core';
import type { LzLiveScan, LzServiceCatalogue, LzServiceIac } from '@swao/core';
import { buildLzLiveCatalogue } from '../../live/live-catalogue.js';
import { LZ_SOVEREIGNTY_PINS } from '../sovereignty-pins.js';
import { checkLzCatalogueQuality, resolveBundledLzCataloguesDir } from '../loader.js';
import { LZ_CATALOGUE_TEMPLATE_FILE } from '../quality.js';
import {
  LzLiveCatalogueUpdateError,
  isManualCatalogueFile,
  mergeLiveIntoCatalogue,
  mergedConfidence,
  runLiveCatalogueUpdate,
} from '../live-update.js';
import { registerLz } from '../../commands/lz.js';
import { registerLzCatalogueUpdate, runLiveCatalogueUpdateCli } from '../../commands/lz-premium.js';

const tmp: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(prefix = 'swao-lz-live-update-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}

const REPO_BUNDLED = resolveBundledLzCataloguesDir();
const TODAY = '2026-11-04';
const IAC: LzServiceIac = { tool: ['terraform'], provider: 'opentelekomcloud', level: 'full', resources: ['opentelekomcloud_cce_cluster_v3'], data_sources: [], source: 'curated' };

/** A temporary copy of the bundled catalogue folder (files only); the repo copy is never a target. */
function bundledCopy(): string {
  const d = tempDir('swao-lz-bundled-copy-');
  for (const name of readdirSync(REPO_BUNDLED!)) {
    if (name.endsWith('.json')) copyFileSync(join(REPO_BUNDLED!, name), join(d, name));
  }
  return d;
}

type Status = LzLiveScan['offering']['services'][number]['regions'][string]['status'];
function scan(o: { regions: { id: string; country?: string }[]; services: { code: string; catalogue_code?: string; tags: string[]; regions: Record<string, Status>; iac?: LzServiceIac }[]; simulated?: boolean }): LzLiveScan {
  const observed = '2026-11-03T08:00:00Z';
  const meta = {
    lz_id: 'otc-test', provider: 'otc', scope_id: 'platform', scope_kind: 'platform' as const, observed_at: observed,
    driver_version: '0.1.0', read_only: 'verified' as const, read_only_overrides: [], coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [],
    ...(o.simulated ? { simulated: { scenario: 'demo', fidelity: 'spec-derived' as const, evidence: ['header' as const] } } : {}),
  };
  const offering = {
    regions: o.regions.map((r) => ({ id: r.id, ...(r.country ? { country: r.country } : {}), azs: [], status: 'enabled' as const })),
    services: o.services.map((s) => ({
      code: s.code, name: `${s.catalogue_code ?? s.code}`, capability_tags: s.tags,
      ...(s.catalogue_code ? { catalogue_code: s.catalogue_code } : {}),
      regions: Object.fromEntries(Object.entries(s.regions).map(([id, status]) => [id, { status, evidence: [{ source: 'api' as const, ref: 'x' }], observed_at: observed }])),
      ...(s.iac ? { iac: s.iac } : {}),
      frameworks: {},
    })),
  };
  const estate = { resources: [], workloads: [], guardrails: [], quotas: [], checks: [] };
  return parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate });
}

/** Synthetic OTC live run: eu-de with a mapped ECS (new tag), a mapped CCE with IaC, and an unmapped native service. */
function otcLive(o: { simulated?: boolean; bundledDir: string }): LzServiceCatalogue {
  const s = scan({
    simulated: o.simulated,
    regions: [{ id: 'eu-de', country: 'DE' }],
    services: [
      { code: 'ecs', catalogue_code: 'Elastic Cloud Server', tags: ['vm_compute', 'gpu_compute'], regions: { 'eu-de': 'enabled' } },
      { code: 'cce', catalogue_code: 'Cloud Container Engine', tags: ['kubernetes'], regions: { 'eu-de': 'enabled' }, iac: IAC },
      { code: 'mock-new-svc', tags: ['message_queue'], regions: { 'eu-de': 'available_not_enabled' } },
    ],
  });
  const staticCatalogue = parseLzCatalogue(JSON.parse(readFileSync(join(o.bundledDir, 'otc.json'), 'utf-8')));
  return buildLzLiveCatalogue({ scans: [s], staticCatalogue, pins: LZ_SOVEREIGNTY_PINS['otc'] });
}

function workspaceWithRun(live: LzServiceCatalogue, opts: { simulated?: boolean } = {}): string {
  const ws = tempDir('swao-lz-live-update-ws-');
  writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
  const run = join(ws, 'landing-zones', 'otc-test', 'wsp', 'runs', '2026-11-03T08-00-00');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'lz-live-catalogue.json'), JSON.stringify(live, null, 2));
  if (opts.simulated) writeFileSync(join(run, 'manifest.json'), JSON.stringify({ scopes: [{ scope_id: 'platform', simulated: { scenario: 'demo', evidence: ['header'] } }] }));
  writeFileSync(join(ws, 'landing-zones', 'otc-test', 'wsp', 'latest-lz-live.txt'), '2026-11-03T08-00-00\n');
  return ws;
}

const tier = (ws: string) => join(ws, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');

describe.skipIf(!REPO_BUNDLED)('--source live round trip on OTC (#3582)', { timeout: 60_000 }, () => {
  it('dry run prints the diff and writes nothing; the write passes the quality gate with no service retired', () => {
    const bundledDir = bundledCopy();
    const ws = workspaceWithRun(otcLive({ bundledDir }));
    const lines: string[] = [];
    const dry = runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', provider: 'otc', dryRun: true, today: TODAY, bundledDir, out: (l) => lines.push(l) });
    expect(dry.written).toBe(false);
    expect(existsSync(tier(ws))).toBe(false);
    expect(lines).toContain('  + tags gpu_compute on Elastic Cloud Server in eu-de');
    expect(lines).toContain('  + IaC full on Cloud Container Engine in eu-de');
    expect(lines).toContain('  + service mock-new-svc in eu-de');
    expect(lines.some((l) => l.startsWith('  ? absent in the live data: Bare Metal Server in eu-de'))).toBe(true);
    expect(lines.some((l) => l.includes('[dry-run] would seed'))).toBe(true);

    const base = parseLzCatalogue(JSON.parse(readFileSync(join(bundledDir, 'otc.json'), 'utf-8')));
    const baseRetired = base.regions.flatMap((r) => r.services.filter((s) => s.status === 'retired').map((s) => `${r.id}/${s.code}`));
    const done = runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', provider: 'otc', today: TODAY, bundledDir, out: () => undefined });
    expect(done.written).toBe(true);
    expect(done.file).toBe(join(tier(ws), 'otc.json'));
    const written = parseLzCatalogue(JSON.parse(readFileSync(done.file, 'utf-8')));
    const retired = written.regions.flatMap((r) => r.services.filter((s) => s.status === 'retired' || s.retired_at !== undefined).map((s) => `${r.id}/${s.code}`));
    expect(retired).toEqual(baseRetired);
    // Every base service is still there; eu-nl (not observed live) is unchanged.
    for (const r of base.regions) expect(written.regions.find((w) => w.id === r.id)?.services.length).toBeGreaterThanOrEqual(r.services.length);
    expect(written.regions.find((r) => r.id === 'eu-nl')).toEqual(base.regions.find((r) => r.id === 'eu-nl'));
    expect(written.meta).toMatchObject({ confidence: 'medium', schema_version: '0.2', last_updated: TODAY });
    expect(written.meta.source.source_note).toContain('from the live run 2026-11-03T08-00-00 of landing zone otc-test');
    const q = checkLzCatalogueQuality(tier(ws), { overlay: true, templateFile: join(bundledDir, LZ_CATALOGUE_TEMPLATE_FILE), now: new Date(`${TODAY}T00:00:00Z`) });
    expect(q.findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('seeds an empty workspace tier with the other bundled catalogues (flat layout) before writing', () => {
    const bundledDir = bundledCopy();
    const ws = workspaceWithRun(otcLive({ bundledDir }));
    const r = runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', provider: 'otc', today: TODAY, bundledDir, out: () => undefined });
    expect(r.seeded).toContain('aws.json');
    expect(r.seeded).not.toContain('otc.json');
    expect(existsSync(join(tier(ws), 'aws.json'))).toBe(true);
    expect(readFileSync(join(tier(ws), 'aws.json'), 'utf-8')).toBe(readFileSync(join(bundledDir, 'aws.json'), 'utf-8'));
    // A second update reads the workspace file and seeds nothing.
    const again = runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', provider: 'otc', today: TODAY, bundledDir, out: () => undefined });
    expect(again.seeded).toEqual([]);
    expect(again.diff.services_added).toEqual([]);
  });

  it('a simulated run is refused with exit 1 and writes no catalogue file (not even the seed)', () => {
    const bundledDir = bundledCopy();
    for (const variant of ['scan', 'manifest'] as const) {
      const ws = variant === 'scan'
        ? workspaceWithRun(otcLive({ bundledDir }))
        : workspaceWithRun(otcLive({ bundledDir }), { simulated: true });
      if (variant === 'scan') {
        const run = join(ws, 'landing-zones', 'otc-test', 'wsp', 'runs', '2026-11-03T08-00-00');
        // the scan of the run marks it simulated (Design 121 section 10)
        writeFileSync(join(run, 'otc-test.platform.lz-live-scan.json'), JSON.stringify(scan({ simulated: true, regions: [{ id: 'eu-de' }], services: [] })));
      }
      let caught: unknown;
      try { runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', provider: 'otc', today: TODAY, bundledDir, out: () => undefined }); } catch (e) { caught = e; }
      expect((caught as { exitCode?: number }).exitCode).toBe(1);
      expect((caught as Error).message).toMatch(/never updates an LZ catalogue/);
      expect(existsSync(tier(ws))).toBe(false);
    }
  });

  it('refuses the bundled catalogue folder as a write target', () => {
    const bundledDir = bundledCopy();
    const ws = workspaceWithRun(otcLive({ bundledDir }));
    const before = readFileSync(join(bundledDir, 'otc.json'), 'utf-8');
    expect(() => runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', provider: 'otc', cataloguesDir: bundledDir, today: TODAY, bundledDir, out: () => undefined })).toThrow(/maintainer PR only/);
    expect(readFileSync(join(bundledDir, 'otc.json'), 'utf-8')).toBe(before);
    // The real bundled folder of the repository is refused the same way.
    expect(() => runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', provider: 'otc', cataloguesDir: REPO_BUNDLED!, today: TODAY, out: () => undefined })).toThrow(/maintainer PR only/);
  });

  it('a manual catalogue is left untouched', () => {
    const bundledDir = bundledCopy();
    const ws = workspaceWithRun(otcLive({ bundledDir }));
    mkdirSync(tier(ws), { recursive: true });
    const manual = JSON.parse(readFileSync(join(bundledDir, 'otc.json'), 'utf-8')) as { meta: { source: { mode: string } } };
    manual.meta.source.mode = 'manual';
    const text = JSON.stringify(manual, null, 2);
    writeFileSync(join(tier(ws), 'otc.json'), text);
    const lines: string[] = [];
    const r = runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', provider: 'otc', today: TODAY, bundledDir, out: (l) => lines.push(l) });
    expect(r.written).toBe(false);
    expect(lines[0]).toMatch(/source.mode "manual".*skipped/);
    expect(readFileSync(join(tier(ws), 'otc.json'), 'utf-8')).toBe(text);
    expect(isManualCatalogueFile(join(tier(ws), 'otc.json'))).toBe(true);
    expect(isManualCatalogueFile(join(bundledDir, 'otc.json'))).toBe(false);
  });

  it('a landing zone of another provider cannot update a catalogue; a missing run names the command', () => {
    const bundledDir = bundledCopy();
    const ws = workspaceWithRun(otcLive({ bundledDir }));
    expect(() => runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', provider: 'aws', today: TODAY, bundledDir, out: () => undefined })).toThrow(/otc landing zone; it cannot update the aws catalogue/);
    expect(() => runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'other-lz', provider: 'otc', today: TODAY, bundledDir, out: () => undefined })).toThrow(/swao assess --type landing-zone-live --lz other-lz/);
    expect(() => runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', provider: 'otc', run: '../x', today: TODAY, bundledDir, out: () => undefined })).toThrow(/not a run folder name/);
  });
});

describe.skipIf(!REPO_BUNDLED)('--new <slug> --source live (#3582)', { timeout: 60_000 }, () => {
  it('builds a new catalogue from the live run that passes the quality gate', () => {
    const bundledDir = bundledCopy();
    const ws = workspaceWithRun(otcLive({ bundledDir }));
    const r = runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', newSlug: 'onprem-lab', today: TODAY, bundledDir, out: () => undefined });
    expect(r.file).toBe(join(tier(ws), 'onprem-lab.json'));
    const c = parseLzCatalogue(JSON.parse(readFileSync(r.file, 'utf-8')));
    expect(c.meta).toMatchObject({ provider: 'onprem-lab', schema_version: '0.2', confidence: 'medium', source: { mode: 'live-api' } });
    expect(c.regions.map((x) => x.id)).toEqual(['eu-de']);
    const q = checkLzCatalogueQuality(tier(ws), { overlay: true, templateFile: join(bundledDir, LZ_CATALOGUE_TEMPLATE_FILE), now: new Date(`${TODAY}T00:00:00Z`) });
    expect(q.findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('refuses an invalid slug and a slug that exists in the workspace or the bundled tier', () => {
    const bundledDir = bundledCopy();
    const ws = workspaceWithRun(otcLive({ bundledDir }));
    expect(() => runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', newSlug: 'Bad_Slug', today: TODAY, bundledDir, out: () => undefined })).toThrow(LzLiveCatalogueUpdateError);
    expect(() => runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', newSlug: 'aws', today: TODAY, bundledDir, out: () => undefined })).toThrow(/exists already/);
    mkdirSync(tier(ws), { recursive: true });
    writeFileSync(join(tier(ws), 'my-cloud.json'), '{}');
    expect(() => runLiveCatalogueUpdate({ workspaceRoot: ws, lzId: 'otc-test', newSlug: 'my-cloud', today: TODAY, bundledDir, out: () => undefined })).toThrow(/exists already/);
  });
});

describe('merge rules (#3582)', () => {
  const cat = (confidence: string, services: Array<Record<string, unknown>>, schema = '0.1') => parseLzCatalogue({
    meta: { schema_version: schema, name: 'x', provider: 'otc', last_updated: '2026-01-01', source: { mode: 'curated' }, confidence },
    regions: [{ id: 'eu-de', country: 'DE', sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: [] }, services }],
  });
  const svc = (code: string, extra: Record<string, unknown> = {}) => ({ code, name: code, status: 'ga', fulfills: ['vm_compute'], capabilities: [], key_custody: [], ...extra });

  it('confidence is lowered or kept, never raised; operator-declared stays', () => {
    expect(mergedConfidence('high', 'medium')).toBe('medium');
    expect(mergedConfidence('low', 'medium')).toBe('low');
    expect(mergedConfidence('medium', 'high')).toBe('medium');
    expect(mergedConfidence('operator-declared', 'medium')).toBe('operator-declared');
  });

  it('matches by canonical_code, adds nothing twice, never retires or changes base services', () => {
    const base = cat('high', [svc('Elastic Cloud Server', { status: 'preview' }), svc('Old Service')]);
    const live = cat('medium', [svc('Elastic Cloud Server', { canonical_code: 'ecs', fulfills: ['vm_compute', 'gpu_compute'] })], '0.2');
    const { catalogue, diff } = mergeLiveIntoCatalogue({ base, live, today: TODAY, provenance: 'p' });
    const r = catalogue.regions[0]!;
    expect(r.services.map((s) => [s.code, s.status])).toEqual([['Elastic Cloud Server', 'preview'], ['Old Service', 'ga']]);
    expect(r.services.find((s) => s.code === 'Old Service')?.retired_at).toBeUndefined();
    expect(diff.services_absent).toEqual([{ region: 'eu-de', code: 'Old Service' }]);
    expect(diff.tags_added).toEqual([{ region: 'eu-de', code: 'Elastic Cloud Server', tags: ['gpu_compute'] }]);
    expect(catalogue.meta.confidence).toBe('medium');
    expect(catalogue.meta.schema_version).toBe('0.1');
    // A live entry keyed by the native code still matches a base entry that carries that canonical_code.
    const base2 = cat('medium', [svc('Elastic Cloud Server', { canonical_code: 'ecs' })], '0.2');
    const live2 = cat('medium', [svc('ecs')], '0.2');
    expect(mergeLiveIntoCatalogue({ base: base2, live: live2, today: TODAY, provenance: 'p' }).diff.services_added).toEqual([]);
  });

  it('bumps schema_version to 0.2 when an added entry carries iac or canonical_code', () => {
    const base = cat('medium', [svc('A')]);
    const live = cat('medium', [svc('A'), svc('B', { canonical_code: 'b-native' })], '0.2');
    expect(mergeLiveIntoCatalogue({ base, live, today: TODAY, provenance: 'p' }).catalogue.meta.schema_version).toBe('0.2');
  });
});

describe.skipIf(!REPO_BUNDLED)('CLI: swao lz catalogue update --source live (#3582)', { timeout: 60_000 }, () => {
  function program(): Command {
    const p = new Command();
    p.exitOverride();
    registerLz(p);
    registerLzCatalogueUpdate(p);
    return p;
  }
  function licensed(): void {
    vi.spyOn(LicenseGuard, 'load').mockReturnValue({ requireFeature: () => undefined, requireTier: () => undefined } as unknown as ReturnType<typeof LicenseGuard.load>);
  }
  async function run(args: string[], cwd: string): Promise<{ code: number | undefined; out: string; err: string }> {
    licensed();
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { out.push(String(m)); });
    vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { err.push(String(m)); });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    let code: number | undefined;
    vi.spyOn(process, 'exit').mockImplementation((c?: number | string | null) => { code = Number(c ?? 0); throw new Error(`exit ${c}`); });
    try { await program().parseAsync(['node', 'swao', 'lz', 'catalogue', 'update', ...args]); } catch (e) { if (!String(e).includes('exit')) throw e; }
    cwdSpy.mockRestore();
    return { code, out: out.join('\n'), err: err.join('\n') };
  }

  it('--provider otc --source live --lz writes the workspace file; written: line for the TUI; --dry-run writes nothing', async () => {
    const bundledDir = bundledCopy();
    const ws = workspaceWithRun(otcLive({ bundledDir }));
    const dry = await run(['--provider', 'otc', '--source', 'live', '--lz', 'otc-test', '--dry-run', '--skip-prices'], ws);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('[dry-run] would write:');
    expect(existsSync(join(tier(ws), 'otc.json'))).toBe(false);
    const r = await run(['--provider', 'otc', '--source', 'live', '--lz', 'otc-test', '--skip-prices'], ws);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`  written: ${join(tier(ws), 'otc.json')}`);
  });

  it('--source live on a simulated run exits non-zero and writes no catalogue file', async () => {
    const bundledDir = bundledCopy();
    const ws = workspaceWithRun(otcLive({ bundledDir }), { simulated: true });
    const r = await run(['--provider', 'otc', '--source', 'live', '--lz', 'otc-test', '--skip-prices'], ws);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/never updates an LZ catalogue/);
    expect(existsSync(tier(ws))).toBe(false);
  });

  it('input errors: no --lz, --new without --source live, an unknown source type', async () => {
    const ws = workspaceWithRun(otcLive({ bundledDir: bundledCopy() }));
    expect((await run(['--provider', 'otc', '--source', 'live'], ws)).err).toMatch(/needs --lz <lz-id>/);
    expect((await run(['--new', 'x-cloud'], ws)).err).toMatch(/--new builds a catalogue from a live run/);
    expect((await run(['--source', 'ftp'], ws)).err).toMatch(/--source must be internet or live/);
    expect((await run(['--source', 'live', '--lz', 'otc-test'], ws)).err).toMatch(/name it with --provider/);
  });

  it('runLiveCatalogueUpdateCli honours --skip-prices for otc (no price request) and returns 0', async () => {
    const bundledDir = bundledCopy();
    const ws = workspaceWithRun(otcLive({ bundledDir }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const code = await runLiveCatalogueUpdateCli({ provider: 'otc', lz: 'otc-test', skipPrices: true }, { cwd: ws, out: () => undefined, err: () => undefined, bundledDir });
    expect(code).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe.skipIf(!REPO_BUNDLED)('manual catalogues and the internet source (#3582)', { timeout: 60_000 }, () => {
  it('lz catalogue update --provider gcp leaves a manual gcp.json byte-identical', async () => {
    const dir = tempDir('swao-lz-manual-gcp-');
    const products = join(dir, 'products.json');
    writeFileSync(products, JSON.stringify({ 'Compute Engine': { 'europe-west3': true } }));
    const catDir = join(dir, 'cats');
    mkdirSync(catDir, { recursive: true });
    const manual = JSON.parse(readFileSync(join(REPO_BUNDLED!, 'gcp.json'), 'utf-8')) as { meta: { source: { mode: string } } };
    manual.meta.source.mode = 'manual';
    const text = JSON.stringify(manual, null, 2);
    writeFileSync(join(catDir, 'gcp.json'), text);
    vi.spyOn(LicenseGuard, 'load').mockReturnValue({ requireFeature: () => undefined, requireTier: () => undefined } as unknown as ReturnType<typeof LicenseGuard.load>);
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { out.push(String(m)); });
    vi.spyOn(process, 'exit').mockImplementation((c?: number | string | null) => { throw new Error(`exit ${c}`); });
    const p = new Command();
    p.exitOverride();
    registerLz(p);
    registerLzCatalogueUpdate(p);
    await p.parseAsync(['node', 'swao', 'lz', 'catalogue', 'update', '--provider', 'gcp', '--products-path', products, '--catalogues-dir', catDir, '--skip-prices']);
    expect(readFileSync(join(catDir, 'gcp.json'), 'utf-8')).toBe(text);
    expect(out.join('\n')).toMatch(/gcp: source.mode "manual" \(hand-maintained\), skipped/);
  });
});
