// #3830: `swao lz diff` (Design 120 sections 13.2, 14.3). Synthetic run
// folders of one landing zone; resources are compared by id but reported as
// counts only.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveLzScanBaseFields, parseLzLiveScan } from '@swao/core';
import type { LzLiveScan, LzLiveSimulated } from '@swao/core';
import { formatLzDiff, runLzDiff, LzDiffError } from '../run-diff.js';
import { LicenseTierError } from '@swao/core';
import { lzDiffAction } from '../cli.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

type Status = LzLiveScan['offering']['services'][number]['regions'][string]['status'];
const RESOURCE_ID = ['res', 'c0ffee', '01'].join('-');

function scan(scopeId: string, observedAt: string, regions: string[], services: Record<string, Status>, resources: string[], simulated?: LzLiveSimulated): LzLiveScan {
  const meta = {
    lz_id: 'otc-prod', provider: 'otc', scope_id: scopeId, scope_kind: scopeId === 'platform' ? 'platform' as const : 'application' as const, observed_at: observedAt,
    driver_version: '0.1.0', read_only: 'verified' as const, read_only_overrides: [], coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [],
    ...(simulated ? { simulated } : {}),
  };
  const offering = {
    regions: regions.map((id) => ({ id, azs: [], status: 'enabled' as const })),
    services: Object.entries(services).map(([code, status]) => ({ code, name: code, capability_tags: [], regions: { 'eu-de': { status, evidence: [{ source: 'api' as const, ref: code }], observed_at: observedAt } }, frameworks: {} })),
  };
  const estate = { resources: resources.map((id) => ({ id, type: 'vm' })), workloads: [], guardrails: [], quotas: [], checks: [] };
  return parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate });
}

function workspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lz-diff-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
  const put = (run: string, s: LzLiveScan): void => {
    const dir = join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', run);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `otc-prod.${s.meta.scope_id}.lz-live-scan.json`), JSON.stringify(s));
  };
  put('2026-11-01T08-00-00', scan('platform', '2026-11-01T08:00:00Z', ['eu-de'], { ecs: 'enabled', dms: 'enabled', rds: 'available_not_enabled' }, [RESOURCE_ID, 'r-2']));
  put('2026-11-02T08-00-00', scan('app-a', '2026-11-02T08:00:00Z', ['eu-de'], { ecs: 'enabled' }, []));
  put('2026-11-03T08-00-00', scan('platform', '2026-11-03T08:00:00Z', ['eu-de', 'eu-nl'], { ecs: 'enabled', rds: 'enabled', cce: 'enabled' }, ['r-2', 'r-3', 'r-4']));
  put('2026-11-03T08-00-00', scan('app-b', '2026-11-03T08:10:00Z', ['eu-de'], { ecs: 'enabled' }, []));
  return ws;
}

describe('runLzDiff (#3830)', () => {
  it('default: latest run against the newest earlier scan of each scope; first scans listed', () => {
    const r = runLzDiff({ workspaceRoot: workspace(), lzId: 'otc-prod' });
    expect(r.to_run).toBe('2026-11-03T08-00-00');
    expect(r.first_scans).toEqual(['app-b']);
    expect(r.scopes).toEqual([{
      scope_id: 'platform', from_run: '2026-11-01T08-00-00', to_run: '2026-11-03T08-00-00', simulated: false,
      new_regions: ['eu-nl'], new_services: ['cce'], new_resources: 2,
      removed_regions: [], removed_services: ['dms'], removed_resources: 1,
      status_changes: [{ service: 'rds', region: 'eu-de', from: 'available_not_enabled', to: 'enabled' }],
    }]);
    const text = formatLzDiff(r).join('\n');
    expect(text).toContain('scope platform: 2026-11-01T08-00-00 -> 2026-11-03T08-00-00');
    expect(text).toContain('  new: regions eu-nl; services cce; resources 2');
    expect(text).toContain('  status change: rds in eu-de: available_not_enabled -> enabled');
    expect(text).toContain('first scan, nothing to compare: app-b');
    expect(text).not.toContain(RESOURCE_ID);
  });

  it('honours --to, --from (ISO time accepted), latest-lz-live.txt and --scope', () => {
    const ws = workspace();
    writeFileSync(join(ws, 'landing-zones', 'otc-prod', 'wsp', 'latest-lz-live.txt'), '2026-11-02T08-00-00\n');
    expect(() => runLzDiff({ workspaceRoot: ws, lzId: 'otc-prod' })).toThrow(/nothing to compare.*first scans: app-a/);
    const r = runLzDiff({ workspaceRoot: ws, lzId: 'otc-prod', from: '2026-11-01T08:00:00Z', to: '2026-11-03T08-00-00', scopeId: 'platform' });
    expect(r.scopes.map((s) => [s.scope_id, s.from_run])).toEqual([['platform', '2026-11-01T08-00-00']]);
  });

  it('refuses an unknown run, a --from not older than --to, an unknown scope, no runs and a bad id', () => {
    const ws = workspace();
    expect(() => runLzDiff({ workspaceRoot: ws, lzId: 'otc-prod', to: '2026-12-01T00-00-00' })).toThrow(/--to 2026-12-01T00-00-00: no run/);
    expect(() => runLzDiff({ workspaceRoot: ws, lzId: 'otc-prod', from: '2026-11-03T08-00-00', to: '2026-11-01T08-00-00' })).toThrow(/is not older than/);
    expect(() => runLzDiff({ workspaceRoot: ws, lzId: 'otc-prod', scopeId: 'nope' })).toThrow(/holds no scan of scope nope/);
    expect(() => runLzDiff({ workspaceRoot: ws, lzId: 'aws-lab' })).toThrow(LzDiffError);
    expect(() => runLzDiff({ workspaceRoot: ws, lzId: '../x' })).toThrow(/kebab-case/);
  });

  it('marks a comparison with a simulated scan', () => {
    const ws = workspace();
    const dir = join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-11-04T08-00-00');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'otc-prod.platform.lz-live-scan.json'), JSON.stringify(scan('platform', '2026-11-04T08:00:00Z', ['eu-de'], { ecs: 'enabled' }, [], { scenario: 'demo', fidelity: 'spec-derived', evidence: ['header'] })));
    const r = runLzDiff({ workspaceRoot: ws, lzId: 'otc-prod' });
    expect(r.scopes[0]).toMatchObject({ simulated: true, from_run: '2026-11-03T08-00-00' });
    expect(formatLzDiff(r)[0]).toMatch(/\[SIM\]$/);
  });
});

describe('lzDiffAction (#3830)', () => {
  it('prints the diff (exit 0), reports errors (exit 1) and refuses below the assess tier with the [LICENSE] block, exit 2 (ADR-0055, #3844)', () => {
    const ws = workspace();
    const out: string[] = [];
    const err: string[] = [];
    const deps = { cwd: ws, out: (l: string) => out.push(l), err: (l: string) => err.push(l), guard: { requireFeature: () => undefined } };
    expect(lzDiffAction('otc-prod', {}, deps)).toBe(0);
    expect(out[0]).toContain('scope platform');
    expect(lzDiffAction('otc-prod', { scope: 'nope' }, deps)).toBe(1);
    expect(err.at(-1)).toMatch(/no scan of scope nope/);
    const gated: string[] = [];
    const tierDeps = { ...deps, guard: { requireFeature: (k: string) => { gated.push(k); throw new LicenseTierError('consultant', 'community', k); } } };
    expect(lzDiffAction('otc-prod', {}, tierDeps)).toBe(2);
    expect(gated).toEqual(['lz-live-assess']);
    expect(err.at(-1)?.startsWith('[LICENSE] ')).toBe(true);
  });
});
