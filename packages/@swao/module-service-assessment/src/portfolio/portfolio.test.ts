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

// Phase 7 suite (#3111-#3115, Design 103 §21.2-§21.5).
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import { PortfolioSummarySchema } from '@swao/core';
import { loadInfraCatalogue } from '../catalog/infra-cat.js';
import { buildPortfolioSummary } from '../apm/score.js';
import { blastRadius, buildIntegrationGraph, eolSignal, planWaves, vendorConsolidation, type WaveInput } from './analytics.js';
import { computeDelta, listSnapshots, recordPortfolioDelta } from './delta.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const NOW = new Date('2026-10-10T08:00:00Z');
const cat = loadInfraCatalogue();

describe('EoL signal (§6.2.2)', () => {
  it('BLOCKED past end of life, AMBER within 18 months, GREEN later', () => {
    expect(eolSignal({ is_eol: true })).toBe('BLOCKED');
    expect(eolSignal({ is_eol: false, months_until_eol: 3 })).toBe('AMBER');
    expect(eolSignal({ is_eol: false, months_until_eol: 18 })).toBe('AMBER');
    expect(eolSignal({ is_eol: false, months_until_eol: 40 })).toBe('GREEN');
    expect(eolSignal(null)).toBeNull();
  });
});

describe('integration graph and blast radius (#3111)', () => {
  it('counts fan-in per dependency, maps cluster members, drops self-edges, keeps dangling references', () => {
    const g = buildIntegrationGraph([
      { id: 'a', integrations: ['hub', 'hub', 'a'] },
      { id: 'b', integrations: ['hub', 'cix002'] },
      { id: 'c', integrations: ['hub', 'ghost99'] },
      { id: 'hub', integrations: [] },
      { id: 'cix-cluster', integrations: [], clusterMembers: ['cix001', 'cix002'] },
    ], NOW);
    expect(g.fan_in).toEqual({ a: 0, b: 0, c: 0, hub: 3, 'cix-cluster': 1 });
    expect(g.edges['a']).toEqual(['hub']);
    expect(g.edges['b']).toEqual(['cix-cluster', 'hub']);
    expect(g.dangling).toEqual([{ from: 'c', to: 'ghost99' }]);
  });

  it('scores fan_in * 10 + TIME weight + EoL bonus with HIGH >= 30, MEDIUM >= 10 (Design 103 §21.4)', () => {
    expect(blastRadius(3, 'Tolerate', 'GREEN')).toEqual({ score: 31, tier: 'HIGH' });
    expect(blastRadius(0, 'Migrate', 'AMBER')).toEqual({ score: 15, tier: 'MEDIUM' });
    expect(blastRadius(0, 'Eliminate', null)).toEqual({ score: 0, tier: 'LOW' });
    expect(blastRadius(1, 'Migrate-Critical', 'BLOCKED')).toEqual({ score: 35, tier: 'HIGH' });
  });
});

describe('migration waves (#3112)', () => {
  const base: Omit<WaveInput, 'id' | 'time'> = { eolSignal: 'GREEN', healthData: false, gdprArt9: false, fanIn: 0, blastScore: 1, infraCategory: null, isCluster: false, mdr: false };
  const w = (id: string, time: WaveInput['time'], over: Partial<WaveInput> = {}): WaveInput => ({ ...base, id, time, ...over });

  it('assigns each app to exactly one wave and orders high fan-in apps last', () => {
    const apps = [
      w('e1', 'Eliminate', { blastScore: 12 }), w('e2', 'Eliminate', { blastScore: 0 }),
      w('mc', 'Migrate-Critical'), w('mh', 'Migrate', { healthData: true }), w('mb', 'Migrate', { eolSignal: 'BLOCKED' }),
      w('hub', 'Migrate', { fanIn: 4, blastScore: 45 }), w('ms', 'Migrate'),
      w('i1', 'Invest'), w('t1', 'Tolerate'), w('t2', 'Tolerate'),
    ];
    const graph = buildIntegrationGraph(apps.map((a) => ({ id: a.id, integrations: [] })), NOW);
    const plan = planWaves(apps, graph);
    expect(plan.waves.map((x) => x.apps)).toEqual([['e2', 'e1'], ['mb', 'mc', 'mh'], ['ms', 'hub'], ['i1'], ['t1', 't2']]);
    const all = plan.waves.flatMap((x) => x.apps);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(apps.length);
    expect(plan.waves[4]!.effort_days).toBe(0);
  });

  it('warns when an eliminated app still has dependents', () => {
    const apps = [w('old', 'Eliminate'), w('user', 'Tolerate')];
    const plan = planWaves(apps, buildIntegrationGraph([{ id: 'old', integrations: [] }, { id: 'user', integrations: ['old'] }], NOW));
    expect(plan.warnings[0]).toMatch(/old is eliminated in wave 1 but user depends on it/);
  });
});

describe('vendor consolidation (#3113)', () => {
  it('groups by catalogue match first, then by normalised vendor name, and scores per §21.5', () => {
    const groups = vendorConsolidation([
      { id: 'p1', vendorName: 'FUJIFILM', infraCategory: 'INFRA_MEDIZIN_PACS', time: 'Migrate', eolSignal: 'BLOCKED' },
      { id: 'p2', vendorName: 'FUJIFILM Europe', infraCategory: 'INFRA_MEDIZIN_DOSE', time: 'Tolerate', eolSignal: 'GREEN' },
      { id: 'p3', vendorName: 'fujifilm', infraCategory: 'INFRA_MEDIZIN_PACS', time: 'Tolerate', eolSignal: 'GREEN' },
      { id: 'v1', vendorName: 'Example Vendor GmbH', infraCategory: 'UNKNOWN', time: 'Tolerate', eolSignal: 'GREEN' },
      { id: 'v2', vendorName: 'Example Vendor', infraCategory: 'UNKNOWN', time: 'Tolerate', eolSignal: 'GREEN' },
      { id: 'x', vendorName: '[contact-name-redacted]', infraCategory: null, time: 'Tolerate', eolSignal: null },
    ], cat);
    expect(groups.map((g) => [g.vendor, g.matched, g.apps, g.opportunity_score, g.opportunity_tier])).toEqual([
      ['FUJIFILM', true, ['p1', 'p2', 'p3'], 50, 'HIGH'],
      ['Example Vendor', false, ['v1', 'v2'], 5, 'LOW'],
    ]);
    expect(groups[0]!.time_summary).toEqual({ M: 1, T: 2 });
  });
});

describe('portfolio delta (#3114)', () => {
  const summary = (apps: Array<Record<string, unknown>>) => ({ apps } as never);

  it('detects the Design 103 §21.2 categories and ignores fields absent from older snapshots', () => {
    const prev = { apps: [
      { id: 'a', name: 'A', time_quadrant: 'Tolerate', risk_score: 20 },
      { id: 'b', name: 'B', time_quadrant: 'Migrate', risk_score: 40, eol_signal: 'AMBER', os: 'Windows Server 2012', cve_critical_count: 0, cve_high_count: 1, migration_candidate: false },
      { id: 'gone', name: 'Gone', time_quadrant: 'Eliminate', risk_score: 10 },
    ] };
    const cur = { apps: [
      { id: 'a', name: 'A', time_quadrant: 'Tolerate', risk_score: 35, eol_signal: 'GREEN' },
      { id: 'b', name: 'B', time_quadrant: 'Eliminate', risk_score: 44, eol_signal: 'GREEN', os: 'Windows Server 2022', cve_critical_count: 1, cve_high_count: 3, migration_candidate: true },
      { id: 'new', name: 'New', time_quadrant: 'Tolerate', risk_score: 5 },
    ] };
    expect(computeDelta(prev, cur).map((d) => `${d.category}:${d.app}`).sort()).toEqual([
      'DELTA.APP_ADDED:new', 'DELTA.APP_REMOVED:gone', 'DELTA.CVE_COUNT_CHANGED:b', 'DELTA.EOL_CHANGED:b',
      'DELTA.MIGRATION_CHANGED:b', 'DELTA.OS_IMPROVED:b', 'DELTA.RISK_SCORE_CHANGED:a', 'DELTA.TIME_CHANGED:b',
    ]);
  });

  it('first run states baseline established; a later run reports changes; keeps 4 snapshots', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-delta-'));
    dirs.push(ws);
    const first = recordPortfolioDelta(ws, summary([{ id: 'a', name: 'A', time_quadrant: 'Tolerate', risk_score: 20 }]), new Date('2026-07-10T14:00:00Z'));
    expect(first.baseline).toBe(true);
    expect(readFileSync(first.reportPath, 'utf-8')).toMatch(/No prior snapshot - baseline established/);
    const second = recordPortfolioDelta(ws, summary([{ id: 'a', name: 'A', time_quadrant: 'Tolerate', risk_score: 45 }]), new Date('2026-10-10T14:00:00Z'));
    expect(second.items.map((i) => i.category)).toEqual(['DELTA.RISK_SCORE_CHANGED']);
    expect(second.reportPath).toMatch(/wsp[\\/]reports[\\/]portfolio-delta-20261010\.md$/);
    expect(readFileSync(second.reportPath, 'utf-8')).toMatch(/Period: 2026-07-10 -> 2026-10-10 \(92 days\)/);
    for (let d = 11; d <= 14; d++) recordPortfolioDelta(ws, summary([]), new Date(`2026-10-${d}T10:00:00Z`));
    expect(listSnapshots(ws)).toEqual([
      'portfolio-summary-20261011-100000.json', 'portfolio-summary-20261012-100000.json',
      'portfolio-summary-20261013-100000.json', 'portfolio-summary-20261014-100000.json',
    ]);
  });
});

describe('workspace portfolio run (#3115)', () => {
  function workspace(): string {
    const ws = mkdtempSync(join(tmpdir(), 'swao-phase7-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nservice_portfolio:\n  source: intake.xlsx\n');
    const app = (id: string, cfg: Record<string, unknown>, research: { cve?: object; eol?: object } = {}) => {
      const r = join(ws, 'apps', id, 'wsp', 'inputs', 'research');
      mkdirSync(r, { recursive: true });
      writeFileSync(join(ws, 'apps', id, '.swao.yml'), dump({ app_id: id, app_name: id.toUpperCase(), assessment: { type: 'service' }, disposition: { operational_status: 'active' }, integrations: [], ...cfg }));
      // #3241: the TIME distribution counts assessed apps only, so every app has a service run pointer.
      writeFileSync(join(ws, 'apps', id, 'wsp', 'latest-service.txt'), 'runs/2026-10-10T10-00-00');
      if (research.cve) writeFileSync(join(r, 'cve-summary.md'), `---\n${dump({ topic: 'cve-summary', cve: { source: 'nvd', critical_count: 0, high_count: 0, kev_match: false, ...research.cve } })}---\n`);
      if (research.eol) writeFileSync(join(r, 'eol-status.md'), `---\n${dump({ topic: 'eol-status', eol: { source: 'endoflife.date', ...research.eol } })}---\n`);
    };
    const green = { eol: { is_eol: false, months_until_eol: 60, date: '2031-10-14' }, cve: {} };
    app('hosapp050', { disposition: { operational_status: 'decommissioned' } });
    app('hospacs004', { vendor: { name: 'FUJIFILM' }, infra_category: 'INFRA_MEDIZIN_PACS', data: { health_data: true } }, { cve: { critical_count: 1, kev_match: true }, eol: { is_eol: false, months_until_eol: 3, date: '2027-01-12' } });
    app('hosapp200', { vendor: { name: 'FUJIFILM' }, infra_category: 'INFRA_MEDIZIN_PACS' }, { cve: {}, eol: { is_eol: false, months_until_eol: 18, date: '2028-04-10' } });
    app('hosapp300', {
      vendor: { name: 'Example Vendor GmbH', support_active: true, version: '9.1', support_contact_present: true, contract_expiry: '2029-01-01' },
      os_class: 'INFRA_PLATFORM_OS_LINUX_DEBIAN', disposition: { operational_status: 'active', gartner_time: 'Invest', migration_candidate: true },
    }, green);
    app('hosapp900', { app_name: 'Interface Server' }, green);
    for (const id of ['hosapp401', 'hosapp402', 'hosapp403']) app(id, { integrations: ['hosapp900'] }, green);
    return ws;
  }

  it('covers every TIME quadrant, schedules the hub last, and writes graph, waves, and summary', () => {
    const ws = workspace();
    const s = buildPortfolioSummary(ws, { now: NOW });
    expect(() => PortfolioSummarySchema.parse(s)).not.toThrow();
    const by = Object.fromEntries(s.apps.map((a) => [a.id, a]));
    expect(Object.fromEntries(Object.entries(s.time_distribution).map(([q, n]) => [q, n > 0]))).toEqual({ Tolerate: true, Invest: true, Migrate: true, 'Migrate-Critical': true, Eliminate: true });
    expect(by['hosapp900']).toMatchObject({ fan_in: 3, blast_radius_tier: 'HIGH', time_quadrant: 'Tolerate' });
    expect(by['hosapp900']!.blast_radius_score).toBeGreaterThanOrEqual(30);
    const wave5 = s.waves!.find((w) => w.wave === 5)!.apps;
    expect(wave5.at(-1)).toBe('hosapp900');
    expect(by['hosapp050']!.wave).toBe(1);
    expect(by['hospacs004']!.wave).toBe(2);
    expect(s.vendor_consolidation!.find((v) => v.vendor === 'FUJIFILM')).toMatchObject({ app_count: 2, apps: ['hosapp200', 'hospacs004'] });
    expect(by['hospacs004']!.vendor_canonical_name).toBe('FUJIFILM');
    expect(JSON.parse(readFileSync(join(ws, 'wsp', 'inputs', 'integration-graph.json'), 'utf-8')).fan_in['hosapp900']).toBe(3);
    expect(readdirSync(join(ws, 'wsp', 'reports')).sort()).toEqual(['migration-waves-20261010.csv', 'migration-waves-20261010.md']);
    expect(readFileSync(join(ws, 'wsp', 'reports', 'migration-waves-20261010.md'), 'utf-8')).toMatch(/\| 1: Eliminate \| 1 \| Now \|/);
  });

  it('diffs against a Phase 4-shaped snapshot without false changes', () => {
    const ws = workspace();
    const old = buildPortfolioSummary(ws, { now: NOW, write: false });
    const phase4 = { ...old, apps: old.apps.map(({ id, name, time_quadrant, risk_score }) => ({ id, name, time_quadrant, risk_score })) };
    expect(computeDelta(phase4, buildPortfolioSummary(ws, { now: NOW, write: false }))).toEqual([]);
    expect(existsSync(join(ws, 'wsp', 'portfolio-summary.json'))).toBe(false);
  });
});
