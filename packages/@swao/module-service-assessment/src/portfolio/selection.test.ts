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

// Top-N selection for the service assessment (#3165).
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rankServiceApps, rankServiceAppsDetailed, rankPortfolioApps, emptyServiceRankMessage, missingFromSummaryNote, readAssessTopN, parseTopN, DEFAULT_ASSESS_TOP_N } from './selection.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const entry = (id: string, risk: number | null, fanIn: number, status = 'active') => ({
  id, name: id.toUpperCase(), time_quadrant: 'Tolerate', time_reason: 'x', analyst_time: null, risk_score: risk, health_score: risk === null ? null : 100 - risk,
  domain_scores: {}, controls_scored: 0, controls_unknown: 0, eol_date: null, cve_critical_count: null, kev_match: false, vendor_canonical_name: null,
  infra_category: null, site: null, operational_status: status, run: null, fan_in: fanIn,
});

function workspace(apps: object[] | null): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-rank-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
  for (const id of ['hosapp003', 'hosapp001', 'hosapp002']) {
    mkdirSync(join(ws, 'apps', id), { recursive: true });
    writeFileSync(join(ws, 'apps', id, '.swao.yml'), `app_id: ${id}\napp_name: ${id}\nassessment:\n  type: service\n`);
  }
  if (apps) {
    mkdirSync(join(ws, 'wsp'), { recursive: true });
    writeFileSync(join(ws, 'wsp', 'portfolio-summary.json'), JSON.stringify({
      generated_at: '2026-10-11T00:00:00Z', framework: { id: 'SWAO_APM', version: 't', status: 't' }, domain_weights: {}, app_count: apps.length,
      portfolio_risk_score: null, time_distribution: { Tolerate: apps.length, Invest: 0, Migrate: 0, 'Migrate-Critical': 0, Eliminate: 0 }, apps,
    }));
  }
  return ws;
}

describe('rankServiceApps (#3165)', () => {
  it('ranks by risk, then fan-in, then ID, and leaves out decommissioned, unused and inactive apps', () => {
    const ws = workspace([
      entry('hosapp001', 40, 0), entry('hosapp002', 70, 1), entry('hosapp003', 70, 5),
      entry('hosapp004', null, 9), entry('hosapp005', 90, 0, 'decommissioned'), entry('hosapp006', 95, 0, 'inactive'),
      entry('hosapp007', 40, 0), entry('hosapp008', 80, 0, 'restricted'),
    ]);
    expect(rankServiceApps(ws).map((a) => a.id)).toEqual(['hosapp008', 'hosapp003', 'hosapp002', 'hosapp001', 'hosapp007', 'hosapp004']);
    expect(rankServiceApps(ws, { top: 2 }).map((a) => a.id)).toEqual(['hosapp008', 'hosapp003']);
  });

  it('falls back to ID order before research has written a portfolio summary', () => {
    expect(rankServiceApps(workspace(null), { top: 2 }).map((a) => a.id)).toEqual(['hosapp001', 'hosapp002']);
  });
});

describe('rankServiceApps with a summary that predates service init (#4389)', () => {
  // An App Assessment wrote the summary (one application row); service init then
  // scaffolded hosapp001..003 without rebuilding it.
  const appRow = { ...entry('sovereign-health', 80, 1), assessment_type: 'application' };

  it('adds every scaffolded service app the summary does not list, as not assessed', () => {
    const ws = workspace([appRow]);
    // The summary parsed (the fallback would not rank the application row).
    expect(rankPortfolioApps(ws, { types: ['application'] }).map((a) => a.id)).toEqual(['sovereign-health']);
    const ranked = rankServiceApps(ws);
    expect(ranked.map((a) => a.id)).toEqual(['hosapp001', 'hosapp002', 'hosapp003']);
    expect(ranked.every((a) => a.evidence === 'not_assessed' && a.assessment_type === 'service' && a.risk_score === null)).toBe(true);
    expect(rankServiceApps(ws, { top: 2 }).map((a) => a.id)).toEqual(['hosapp001', 'hosapp002']);
    const d = rankServiceAppsDetailed(ws);
    expect(d).toMatchObject({ scaffolded: 3, summaryPresent: true, missingFromSummary: ['hosapp001', 'hosapp002', 'hosapp003'], excludedByStatus: 0 });
    expect(missingFromSummaryNote(d)).toMatch(/^3 service app\(s\) are not yet in wsp\/portfolio-summary\.json .*Run swao service research to score them\.$/);
    // The combined rank keeps the application row first and adds the service apps after it.
    expect(rankPortfolioApps(ws).map((a) => a.id)).toEqual(['sovereign-health', 'hosapp001', 'hosapp002', 'hosapp003']);
  });

  it('ranks unlisted apps after the scored rows, leaves out unlisted decommissioned apps and never re-adds a listed row', () => {
    const ws = workspace([appRow, { ...entry('hosapp002', 50, 0), assessment_type: 'service' }]);
    mkdirSync(join(ws, 'apps', 'hosapp009'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'hosapp009', '.swao.yml'), 'app_id: hosapp009\nassessment:\n  type: service\ndisposition:\n  operational_status: decommissioned\n');
    const d = rankServiceAppsDetailed(ws);
    expect(d.apps.map((a) => [a.id, a.evidence])).toEqual([['hosapp002', null], ['hosapp001', 'not_assessed'], ['hosapp003', 'not_assessed']]);
    expect(d.missingFromSummary).toEqual(['hosapp001', 'hosapp003', 'hosapp009']);
    expect(d.excludedByStatus).toBe(1);
    // A listed row dropped for its status stays out.
    const ws2 = workspace([appRow, entry('hosapp001', 90, 0, 'inactive')]);
    expect(rankServiceApps(ws2).map((a) => a.id)).toEqual(['hosapp002', 'hosapp003']);
  });

  it('names the cause of an empty list', () => {
    expect(emptyServiceRankMessage({ scaffolded: 0, excludedByStatus: 0 })).toBe('No service apps to assess: none scaffolded under apps/ (run swao service init first).');
    const ws = workspace([appRow, entry('hosapp001', 90, 0, 'inactive'), entry('hosapp002', 90, 0, 'unused'), entry('hosapp003', 90, 0, 'decommissioned')]);
    const d = rankServiceAppsDetailed(ws);
    expect(d.apps).toEqual([]);
    expect(emptyServiceRankMessage(d)).toBe('No service apps to assess: all 3 scaffolded service app(s) are decommissioned, unused or inactive.');
    expect(missingFromSummaryNote(d)).toBeNull();
  });
});

describe('readAssessTopN / parseTopN (#3520)', () => {
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  const ws = (yml: string | null): string => {
    const d = mkdtempSync(join(tmpdir(), 'swao-topn-'));
    dirs.push(d);
    if (yml !== null) writeFileSync(join(d, '.swao.yml'), yml);
    return d;
  };

  it('defaults to 20 without a .swao.yml or without the key', () => {
    expect(readAssessTopN(ws(null))).toBe(DEFAULT_ASSESS_TOP_N);
    expect(readAssessTopN(ws('service_portfolio:\n  confirm_small_scope: false\n'))).toBe(20);
  });

  it('reads service_portfolio.assess_top_n', () => {
    expect(readAssessTopN(ws('service_portfolio:\n  assess_top_n: 3\n'))).toBe(3);
  });

  it('rejects a value that is not a positive integer, naming the key', () => {
    for (const bad of ['0', '-2', '2.5', '"ten"']) {
      expect(() => readAssessTopN(ws(`service_portfolio:\n  assess_top_n: ${bad}\n`))).toThrow(/service_portfolio\.assess_top_n/);
    }
  });

  it('parseTopN accepts 1..max and refuses everything else', () => {
    expect(parseTopN('3', 10)).toBe(3);
    expect(parseTopN(' 10 ', 10)).toBe(10);
    expect(parseTopN('11', 10)).toBeNull();
    expect(parseTopN('0', 10)).toBeNull();
    expect(parseTopN('2.5', 10)).toBeNull();
    expect(parseTopN('abc', null)).toBeNull();
    expect(parseTopN('500', null)).toBe(500);
  });
});
