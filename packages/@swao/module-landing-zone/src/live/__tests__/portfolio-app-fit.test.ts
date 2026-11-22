// #3822 (Design 120 section 11.2, item 4): apps named by an application scope
// (`landing_zones[].scopes[].app`) get an observed fit against that scope's
// merged scan in the portfolio merge. Synthetic WSP run folders only.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump as yamlDump } from 'js-yaml';
import { deriveLzScanBaseFields, lzLivePortfolioAppFitEntries, parseLzLiveScan } from '@swao/core';
import type { LzLiveScan, LzLiveSimulated } from '@swao/core';
import { mergeLzLiveScopes } from '../merge.js';
import { formatLzLivePortfolio, runLzLivePortfolio } from '../portfolio.js';
import { lzLivePortfolioAction } from '../cli.js';
import type { LzRequiredService } from '../../fit/lz-fit.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

type Status = LzLiveScan['offering']['services'][number]['regions'][string]['status'];
const NOW = new Date('2026-11-04T12:00:00Z');
const SIM: LzLiveSimulated = { scenario: 'demo', fidelity: 'spec-derived', evidence: ['header'] };

function scan(scopeId: string, kind: 'platform' | 'application', observedAt: string, services: Array<{ code: string; tag: string; status: Status }>, simulated?: LzLiveSimulated): LzLiveScan {
  const meta = {
    lz_id: 'otc-prod', provider: 'otc', scope_id: scopeId, scope_kind: kind, observed_at: observedAt,
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

const REGION = (id: string, country: string) => ({ id, country, sovereignty: { residency_country: country, operator_jurisdiction: 'EU-entity' } });

/** Platform plus three application scopes: app-pay (merged), app-sim (simulated), app-old (stale). */
function workspace(opts: { appScopeRegions?: string } = {}): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lz-appfit-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), [
    'name: demo', 'landing_zones:',
    '  - id: otc-prod', '    provider: otc', '    scopes:',
    '      - id: platform', '        kind: platform', '        auth: iam-password-token',
    '      - id: app-pay', '        kind: application', '        auth: iam-password-token', '        app: payments',
    ...(opts.appScopeRegions ? [`        regions: [${opts.appScopeRegions}]`] : []),
    '      - id: app-sim', '        kind: application', '        auth: iam-password-token', '        app: simapp',
    '      - id: app-old', '        kind: application', '        auth: iam-password-token', '        app: oldapp',
    '',
  ].join('\n'));
  const platform = scan('platform', 'platform', '2026-11-04T08:00:00Z', [{ code: 'ecs', tag: 'vm_compute', status: 'enabled' }]);
  const pay = scan('app-pay', 'application', '2026-11-04T08:10:00Z', [{ code: 'ecs', tag: 'vm_compute', status: 'enabled' }, { code: 'rds', tag: 'postgresql', status: 'restricted' }]);
  const sim = scan('app-sim', 'application', '2026-11-04T08:20:00Z', [{ code: 'ecs', tag: 'vm_compute', status: 'enabled' }], SIM);
  const old = scan('app-old', 'application', '2026-10-01T08:00:00Z', [{ code: 'ecs', tag: 'vm_compute', status: 'enabled' }]);
  const oldDir = join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-10-01T08-00-00');
  mkdirSync(oldDir, { recursive: true });
  writeFileSync(join(oldDir, 'otc-prod.app-old.lz-live-scan.json'), JSON.stringify(old));
  const merged = mergeLzLiveScopes({
    lzId: 'otc-prod', provider: 'otc', scans: [platform, pay, sim, old],
    registeredScopes: [{ id: 'platform', kind: 'platform' }, { id: 'app-pay', kind: 'application' }, { id: 'app-sim', kind: 'application' }, { id: 'app-old', kind: 'application' }],
    now: NOW,
  });
  const dir = join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-11-04T08-30-00');
  mkdirSync(dir, { recursive: true });
  for (const s of [platform, pay, sim]) writeFileSync(join(dir, `otc-prod.${s.meta.scope_id}.lz-live-scan.json`), JSON.stringify(s));
  writeFileSync(join(dir, 'lz-live-merged.yaml'), yamlDump(merged));
  writeFileSync(join(dir, 'lz-live-catalogue.json'), JSON.stringify({ regions: [REGION('eu-de', 'DE'), REGION('eu-nl', 'NL')] }));
  return ws;
}

const REQUIRED: Record<string, LzRequiredService[]> = {
  payments: [{ code: 'vm_compute', signalId: 'INV-10' }, { code: 'postgresql', signalId: 'INV-11' }],
  simapp: [{ code: 'vm_compute', signalId: 'INV-10' }],
  oldapp: [{ code: 'vm_compute', signalId: 'INV-10' }],
};
const requiredServicesFor = (appId: string): LzRequiredService[] | undefined => REQUIRED[appId];

describe('observed app fits in the portfolio merge (#3822)', () => {
  it('an app with a merged application scope gets one observed fit per enabled region; stale scopes give none', () => {
    const ws = workspace();
    const { portfolio } = runLzLivePortfolio({ workspaceRoot: ws, now: () => NOW, requiredServicesFor });
    const pay = portfolio.app_fits.filter((f) => f.app_id === 'payments');
    expect(pay.map((f) => [f.region, f.scope_id, f.simulated])).toEqual([['eu-de', 'app-pay', false], ['eu-nl', 'app-pay', false]]);
    // postgresql is restricted by policy in eu-de: the live status decides (#3609)
    expect(pay[0]).toMatchObject({ verdict: 'BLOCKED', provider: 'otc', lz_id: 'otc-prod' });
    expect(pay[0]!.blockers).toBeGreaterThan(0);
    expect(portfolio.app_fits.some((f) => f.app_id === 'oldapp')).toBe(false);
    expect(lzLivePortfolioAppFitEntries(portfolio, 'payments')[0]).toMatchObject({ confidence: 'observed', lz_id: 'otc-prod', scope_id: 'app-pay', region: 'eu-de' });
    expect(lzLivePortfolioAppFitEntries(portfolio, 'billing')).toEqual([]);
    expect(formatLzLivePortfolio(portfolio).join('\n')).toContain('app payments (scope app-pay) in eu-de: BLOCKED');
  });

  it('a simulated scope gives no observed fit unless the merge includes simulated scopes, and is then marked', () => {
    const ws = workspace();
    expect(runLzLivePortfolio({ workspaceRoot: ws, now: () => NOW, requiredServicesFor }).portfolio.app_fits.some((f) => f.app_id === 'simapp')).toBe(false);
    const withSim = runLzLivePortfolio({ workspaceRoot: ws, includeSimulated: true, now: () => NOW, requiredServicesFor }).portfolio;
    const sim = withSim.app_fits.filter((f) => f.app_id === 'simapp');
    expect(sim.length).toBeGreaterThan(0);
    expect(sim.every((f) => f.simulated)).toBe(true);
    expect(lzLivePortfolioAppFitEntries(withSim, 'simapp')[0]).toMatchObject({ simulated: true, confidence: 'observed' });
  });

  it('registered scope regions limit the fit; a region without catalogue facts is left out', () => {
    const ws = workspace({ appScopeRegions: 'eu-nl, ap-x' });
    const pay = runLzLivePortfolio({ workspaceRoot: ws, now: () => NOW, requiredServicesFor }).portfolio.app_fits.filter((f) => f.app_id === 'payments');
    expect(pay.map((f) => f.region)).toEqual(['eu-nl']);
  });

  it('no required services (app not assessed) and no host hook give no observed fit', () => {
    const ws = workspace();
    expect(runLzLivePortfolio({ workspaceRoot: ws, now: () => NOW, requiredServicesFor: () => undefined }).portfolio.app_fits).toEqual([]);
    expect(runLzLivePortfolio({ workspaceRoot: ws, now: () => NOW }).portfolio.app_fits).toEqual([]);
  });

  it('the CLI action passes the host hook with the workspace root and prints the fits', () => {
    const ws = workspace();
    const out: string[] = [];
    const seen: string[] = [];
    const code = lzLivePortfolioAction({}, {
      cwd: ws, out: (l) => out.push(l), err: () => undefined, guard: { requireFeature: () => undefined }, now: () => NOW,
      requiredServicesFor: (root, appId) => { seen.push(`${root === ws}:${appId}`); return REQUIRED[appId]; },
    });
    expect(code).toBe(0);
    expect(seen).toContain('true:payments');
    expect(out.join('\n')).toMatch(/app payments \(scope app-pay\) in eu-de: BLOCKED, \d+ blocker\(s\), confidence observed/);
  });
});
