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
import { rankServiceApps } from './selection.js';

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
