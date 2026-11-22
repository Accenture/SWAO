// #3887 (Design 123 section 8.4, D-08): the inline LZ fit of an app run on the
// live source. Synthetic run folders only (the #3822 fixture shape).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump as yamlDump } from 'js-yaml';
import { deriveLzScanBaseFields, isLzCatalogueFitFile, parseLzLiveScan } from '@swao/core';
import type { LzLiveScan, LzLiveSimulated } from '@swao/core';
import { mergeLzLiveScopes } from '@swao/module-landing-zone';
import { liveInlineFit, liveInlineFitDocument, liveInlineFitFileName } from './lz-live-app-fit.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

type Status = LzLiveScan['offering']['services'][number]['regions'][string]['status'];
const SIM: LzLiveSimulated = { scenario: 'demo', fidelity: 'spec-derived', evidence: ['header'] };

function scan(scopeId: string, observedAt: string, services: Array<{ code: string; tag: string; status: Status }>, simulated?: LzLiveSimulated): LzLiveScan {
  const meta = {
    lz_id: 'otc-prod', provider: 'otc', scope_id: scopeId, scope_kind: 'application' as const, observed_at: observedAt,
    driver_version: '0.1.0', read_only: 'verified' as const, read_only_overrides: [], coverage: { readable: [], unreadable: [] },
    frameworks: [], sources: [], ...(simulated ? { simulated } : {}),
  };
  const offering = {
    regions: [{ id: 'eu-de', country: 'DE', azs: [], status: 'enabled' as const }, { id: 'eu-nl', country: 'NL', azs: [], status: 'enabled' as const }],
    services: services.map((s) => ({
      code: s.code, name: s.code, capability_tags: [s.tag],
      regions: { 'eu-de': { status: s.status, evidence: [{ source: s.status === 'restricted' ? 'policy' as const : 'api' as const, ref: s.code }], observed_at: observedAt } },
      frameworks: {},
    })),
  };
  const estate = { resources: [], workloads: [], guardrails: [], quotas: [], checks: [] };
  return parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate });
}

/** One run 2026-11-04T08-30-00 with app-pay (real) and app-sim (simulated). */
function workspace(observedAt = '2026-11-04T08:10:00Z'): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lzsrc-fit-'));
  tmp.push(ws);
  const pay = scan('app-pay', observedAt, [{ code: 'ecs', tag: 'vm_compute', status: 'enabled' }, { code: 'rds', tag: 'postgresql', status: 'restricted' }]);
  const sim = scan('app-sim', observedAt, [{ code: 'ecs', tag: 'vm_compute', status: 'enabled' }], SIM);
  const merged = mergeLzLiveScopes({
    lzId: 'otc-prod', provider: 'otc', scans: [pay, sim],
    registeredScopes: [{ id: 'app-pay', kind: 'application' }, { id: 'app-sim', kind: 'application' }],
    now: new Date(Date.parse(observedAt) + 3600_000),
  });
  const dir = join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-11-04T08-30-00');
  mkdirSync(dir, { recursive: true });
  for (const s of [pay, sim]) writeFileSync(join(dir, `otc-prod.${s.meta.scope_id}.lz-live-scan.json`), JSON.stringify(s));
  writeFileSync(join(dir, 'lz-live-merged.yaml'), yamlDump(merged));
  writeFileSync(join(dir, 'lz-live-catalogue.json'), JSON.stringify({ regions: [
    { id: 'eu-de', country: 'DE', sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity' } },
    { id: 'eu-nl', country: 'NL', sovereignty: { residency_country: 'NL', operator_jurisdiction: 'EU-entity' } },
  ] }));
  return ws;
}

const REQUIRED = [{ code: 'vm_compute', signalId: 'INV-10' }, { code: 'postgresql', signalId: 'INV-11' }];
const base = (ws: string, over: Partial<Parameters<typeof liveInlineFit>[0]> = {}): Parameters<typeof liveInlineFit>[0] => ({
  workspaceRoot: ws, lzId: 'otc-prod', provider: 'otc', scopeIds: ['app-pay'], scopeRegions: new Map([['app-pay', ['eu-de']]]),
  required: REQUIRED, now: new Date('2026-11-05T08:00:00Z'), generatedAt: '2026-11-05', ...over,
});

describe('liveInlineFit (#3887)', () => {
  it('fits the app on the latest run through computeLzFitFromLiveScan (observed statuses decide)', () => {
    const r = liveInlineFit(base(workspace()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ run_id: '2026-11-04T08-30-00', scopes: ['app-pay'], stale: false, age_days: 0, warnings: [] });
    expect(r.value.fits.map((f) => [f.scope_id, f.region])).toEqual([['app-pay', 'eu-de']]);
    const items = r.value.fits[0]!.report.items;
    expect(items.find((i) => i.service_code === 'postgresql')?.verdict).toBe('BLOCKED_BY_POLICY');
    expect(items.find((i) => i.service_code === 'vm_compute')?.verdict).toBe('SUPPORTED');
  });

  it('every region the scan observed enabled when the scope registers none', () => {
    const r = liveInlineFit(base(workspace(), { scopeRegions: new Map() }));
    expect(r.ok && r.value.fits.map((f) => f.region)).toEqual(['eu-de', 'eu-nl']);
  });

  it('errors when the landing zone has no live run (never a catalogue fallback)', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-lzsrc-none-'));
    tmp.push(ws);
    const r = liveInlineFit(base(ws));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/landing zone otc-prod has no usable live run \(no live run\); run swao assess --type landing-zone-live --lz otc-prod first/);
  });

  it('warns about a stale run beyond the 7-day window and still uses it', () => {
    const r = liveInlineFit(base(workspace('2026-10-20T08:00:00Z')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stale).toBe(true);
    expect(r.value.age_days).toBe(16);
    expect(r.value.warnings.join()).toContain('older than the 7-day window');
    expect(r.value.fits).toHaveLength(1);
  });

  it('leaves simulated scopes out unless --include-simulated, and errors when nothing else is left', () => {
    const ws = workspace();
    const only = liveInlineFit(base(ws, { scopeIds: ['app-sim'] }));
    expect(only.ok).toBe(false);
    if (!only.ok) expect(only.error).toContain('is simulated and is left out');
    const both = liveInlineFit(base(ws, { scopeIds: ['app-pay', 'app-sim'] }));
    expect(both.ok && both.value.scopes).toEqual(['app-pay']);
    expect(both.ok && both.value.warnings.join()).toContain('app-sim');
    const incl = liveInlineFit(base(ws, { scopeIds: ['app-sim'], includeSimulated: true }));
    expect(incl.ok && incl.value.scopes).toEqual(['app-sim']);
  });

  it('writes under the existing catalogue fit names with lz_source live and confidence observed', () => {
    const r = liveInlineFit(base(workspace(), { scopeIds: ['app-pay', 'app-sim'], includeSimulated: true, scopeRegions: new Map() }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.value.fits.map((f) => liveInlineFitFileName(f, 'otc', r.value.fits.length, r.value.scopes.length));
    expect(names).toEqual(['lz-catalogue-fit-otc-eu-de-app-pay.yaml', 'lz-catalogue-fit-otc-eu-nl-app-pay.yaml', 'lz-catalogue-fit-otc-eu-de-app-sim.yaml', 'lz-catalogue-fit-otc-eu-nl-app-sim.yaml']);
    for (const n of names) expect(isLzCatalogueFitFile(n)).toBe(true);
    expect(liveInlineFitFileName(r.value.fits[0]!, 'otc', 1, 1)).toBe('lz-catalogue-fit.yaml');
    expect(liveInlineFitDocument(r.value.fits[0]!, r.value, 'otc-prod')).toMatchObject({
      lz_source: 'live', confidence: 'observed', lz_id: 'otc-prod', scope_id: 'app-pay', lz_live_run: '2026-11-04T08-30-00', provider: 'otc', region: 'eu-de',
    });
  });
});

// #3920 (Design 123 section 9.3): the live inline fit carries the requirement provenance when passed.
describe('liveInlineFit requirement provenance (#3920)', () => {
  const prov = [{ requirement: 'residency_country' as const, value: 'DE', frameworks: ['CLIENT_LZ_POLICY_BASELINE'] }];
  it('writes requirement_provenance on every region fit document when passed, and nothing otherwise', () => {
    const ws = workspace();
    const r = liveInlineFit(base(ws, { requirementProvenance: prov }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = liveInlineFitDocument(r.value.fits[0]!, r.value, 'otc-prod');
    expect(doc['requirement_provenance']).toEqual(prov);
    const plain = liveInlineFit(base(ws));
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(liveInlineFitDocument(plain.value.fits[0]!, plain.value, 'otc-prod')).not.toHaveProperty('requirement_provenance');
  });
});
