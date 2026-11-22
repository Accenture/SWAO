// #3584 (Design 120 section 11.3): the portfolio aggregator writes the
// landing_zones[] block of portfolio-summary.json from the latest live
// portfolio merge, on every rebuild. Synthetic artefact only.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import { LzLivePortfolioSchema, PortfolioSummarySchema } from '@swao/core';
import { makeMixedWorkspace, MIXED_APP } from '../__tests__/fixtures/mixed-workspace.js';
import { buildPortfolioSummary } from './score.js';

const NOW = new Date('2026-11-03T12:00:00Z');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const PORTFOLIO = LzLivePortfolioSchema.parse({
  schema: 'lz-live-portfolio/1',
  generated_at: '2026-11-03T12:00:00.000Z',
  include_simulated: true,
  landing_zones: [{
    lz_id: 'otc-prod', provider: 'otc', run_id: '2026-11-03T08-00-00', merged_at: '2026-11-03T12:00:00.000Z', window_days: 7,
    simulated: false, merge_basis: 'merged',
    scopes: [
      { scope_id: 'platform', scope_kind: 'platform', status: 'merged', observed_at: '2026-11-03T08:00:00Z', read_only: 'verified' },
      { scope_id: 'app-a', scope_kind: 'application', status: 'stale', observed_at: '2026-10-01T08:00:00Z', read_only: 'verified' },
    ],
    regions_enabled: 1, services_enabled: 2, iac: { full: 1, read: 0, none: 0, unknown: 1 },
    framework_lights: { 'bsi-c5': { green: 1, amber: 1, red: 0, grey: 0 } },
    checks: { 'LZ-CHK-01': 'pass', 'LZ-CHK-02': 'fail' },
    drift: { new: 0, removed: 0, status_changes: 0 },
  }, {
    lz_id: 'aws-lab', provider: 'aws', run_id: '2026-11-03T09-30-00', merged_at: '2026-11-03T12:00:00.000Z', window_days: 7,
    simulated: true, merge_basis: 'merged',
    scopes: [{ scope_id: 'platform', scope_kind: 'platform', status: 'merged', observed_at: '2026-11-03T09:00:00Z', read_only: 'verified', simulated: { evidence: ['header'] } }],
    regions_enabled: 1, services_enabled: 1, iac: { full: 1, read: 0, none: 0, unknown: 0 },
    framework_lights: {}, checks: {}, drift: { new: 0, removed: 0, status_changes: 0 },
  }],
});

function writePortfolio(ws: string): void {
  const dir = join(ws, 'wsp', 'lz-live-portfolio');
  mkdirSync(join(dir, 'runs', '2026-11-03T12-00-00'), { recursive: true });
  writeFileSync(join(dir, 'runs', '2026-11-03T12-00-00', 'lz-live-portfolio.yaml'), dump(PORTFOLIO));
  writeFileSync(join(dir, 'latest.txt'), '2026-11-03T12-00-00\n');
}

describe('landing_zones[] in portfolio-summary.json (#3584)', () => {
  it('an LZ-only workspace (no apps/) builds the summary with one entry per merged landing zone', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-lz-summary-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
    writePortfolio(ws);
    const s = buildPortfolioSummary(ws, { now: NOW });
    expect(s.app_count).toBe(0);
    const onDisk = PortfolioSummarySchema.parse(JSON.parse(readFileSync(join(ws, 'wsp', 'portfolio-summary.json'), 'utf-8')));
    expect(onDisk.landing_zones?.map((l) => [l.lz_id, l.provider, l.run_id])).toEqual([['otc-prod', 'otc', '2026-11-03T08-00-00'], ['aws-lab', 'aws', '2026-11-03T09-30-00']]);
    expect(onDisk.landing_zones?.[0]).toMatchObject({ iac_full_pct: 50, checks: { pass: 1, fail: 1, warn: 0 }, stale_scopes: ['app-a'], services_enabled: 2 });
    expect(onDisk.landing_zones?.[1]?.simulated).toBe(true);
  });

  it('survives the rebuild an app or service assessment triggers', () => {
    const ws = makeMixedWorkspace();
    dirs.push(ws);
    expect(buildPortfolioSummary(ws, { now: NOW }).landing_zones).toBeUndefined();
    writePortfolio(ws);
    const first = buildPortfolioSummary(ws, { now: NOW });
    const again = buildPortfolioSummary(ws, { now: NOW });
    expect(first.apps.length).toBeGreaterThan(0);
    expect(again.landing_zones).toEqual(first.landing_zones);
    expect(again.landing_zones).toHaveLength(2);
  });

  it('a broken pointer or artefact leaves the block out instead of failing the summary', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-lz-summary-bad-'));
    dirs.push(ws);
    mkdirSync(join(ws, 'wsp', 'lz-live-portfolio'), { recursive: true });
    writeFileSync(join(ws, 'wsp', 'lz-live-portfolio', 'latest.txt'), '../escape\n');
    expect(buildPortfolioSummary(ws, { now: NOW }).landing_zones).toBeUndefined();
    writeFileSync(join(ws, 'wsp', 'lz-live-portfolio', 'latest.txt'), 'r1\n');
    mkdirSync(join(ws, 'wsp', 'lz-live-portfolio', 'runs', 'r1'), { recursive: true });
    writeFileSync(join(ws, 'wsp', 'lz-live-portfolio', 'runs', 'r1', 'lz-live-portfolio.yaml'), 'schema: other\n');
    expect(buildPortfolioSummary(ws, { now: NOW }).landing_zones).toBeUndefined();
  });
});

describe('observed lz_fit[] from the portfolio merge (#3822, Design 120 section 11.2 item 4)', () => {
  it('the linked application app gets observed entries after its catalogue fits; other apps are unchanged', () => {
    const ws = makeMixedWorkspace();
    dirs.push(ws);
    const before = buildPortfolioSummary(ws, { now: NOW, write: false });
    const withFits = LzLivePortfolioSchema.parse({
      ...PORTFOLIO,
      app_fits: [
        { app_id: MIXED_APP, lz_id: 'otc-prod', scope_id: 'app-pay', provider: 'otc', region: 'eu-de', verdict: 'READY', blockers: 0 },
        { app_id: MIXED_APP, lz_id: 'aws-lab', scope_id: 'sim-app', provider: 'aws', region: 'eu-central-1', verdict: 'BLOCKED', blockers: 2, simulated: true },
      ],
    });
    const dir = join(ws, 'wsp', 'lz-live-portfolio');
    mkdirSync(join(dir, 'runs', 'r2'), { recursive: true });
    writeFileSync(join(dir, 'runs', 'r2', 'lz-live-portfolio.yaml'), dump(withFits));
    writeFileSync(join(dir, 'latest.txt'), 'r2' + String.fromCharCode(10));
    const s = buildPortfolioSummary(ws, { now: NOW });
    const app = s.apps.find((a) => a.id === MIXED_APP)!;
    const catalogue = before.apps.find((a) => a.id === MIXED_APP)!.lz_fit ?? [];
    expect(app.lz_fit?.slice(0, catalogue.length)).toEqual(catalogue);
    expect(app.lz_fit?.slice(catalogue.length)).toEqual([
      { provider: 'otc', region: 'eu-de', verdict: 'READY', blockers: 0, confidence: 'observed', lz_id: 'otc-prod', scope_id: 'app-pay' },
      { provider: 'aws', region: 'eu-central-1', verdict: 'BLOCKED', blockers: 2, confidence: 'observed', lz_id: 'aws-lab', scope_id: 'sim-app', simulated: true },
    ]);
    for (const other of s.apps.filter((a) => a.id !== MIXED_APP)) expect(other.lz_fit).toEqual(before.apps.find((a) => a.id === other.id)?.lz_fit);
    expect(PortfolioSummarySchema.safeParse(JSON.parse(readFileSync(join(ws, 'wsp', 'portfolio-summary.json'), 'utf-8'))).success).toBe(true);
  });
});
