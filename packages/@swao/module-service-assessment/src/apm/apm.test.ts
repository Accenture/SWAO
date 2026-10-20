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

// Phase 4 suite (#3099-#3101, #3103): SWAO_APM framework, TIME, risk score, portfolio summary.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import { PortfolioSummarySchema } from '@swao/core';
import { APM_DOMAINS, loadApmFramework, validateDomainWeights, type ApmFramework } from './framework.js';
import { APM_RULES, type ApmEvidence } from './rules.js';
import { buildPortfolioSummary, classifyTime, scoreApp } from './score.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const NOW = new Date('2026-10-10T00:00:00Z');
const bundled = loadApmFramework();

function evidence(over: Partial<ApmEvidence> = {}): ApmEvidence {
  return { app: { disposition: { operational_status: 'active' } }, cve: null, eol: null, vt: null, bsi: null, runSignals: null, ranPasses: [], now: NOW, ...over };
}
const time = (e: ApmEvidence, fw: ApmFramework = bundled) => classifyTime(e, scoreApp(e, fw), fw).quadrant;

describe('SWAO_APM framework (#3099)', () => {
  it('ships approved with 11 domains, weights summing to 100, and 72 controls', () => {
    expect(bundled.status).toBe('approved');
    expect(Object.keys(bundled.domainWeights)).toEqual([...APM_DOMAINS]);
    expect(Object.values(bundled.domainWeights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(bundled.controls.length).toBeGreaterThanOrEqual(66);
    expect(bundled.controls).toHaveLength(72);
    for (const d of APM_DOMAINS) expect(bundled.controls.filter((c) => c.domain === d).length, d).toBeGreaterThanOrEqual(4);
  });

  it('binds every scored control to an existing rule', () => {
    const rules = bundled.controls.map((c) => c.rule).filter((r): r is string => r !== null);
    expect(rules.length).toBe(47);
    for (const r of rules) expect(APM_RULES[r], r).toBeTypeOf('function');
  });

  it('declares assessment_type_scope [service] in the framework metadata', () => {
    const meta = readFileSync(join(bundled.dir, 'framework-meta.yaml'), 'utf-8');
    expect(meta).toMatch(/assessment_type_scope: \[service\]/);
  });

  it('validates domain weights with integer arithmetic', () => {
    expect(validateDomainWeights(bundled.domainWeights)).toEqual({ errors: [], warnings: [] });
    const ninetyNine = { ...bundled.domainWeights, 'APM-TCH': 19 };
    expect(validateDomainWeights(ninetyNine).errors).toEqual(['domain_weights sum to 99, expected 100']);
    const { 'APM-HW': _hw, ...missing } = bundled.domainWeights;
    expect(validateDomainWeights(missing).errors[0]).toBe('domain_weights missing domain(s): APM-HW');
    expect(validateDomainWeights(undefined).warnings).toHaveLength(1);
  });
});

describe('TIME classification (#3100, #3103)', () => {
  it('Eliminate: decommissioned, unused, and inactive (G-03, G-04); restricted is not auto-eliminated', () => {
    for (const s of ['decommissioned', 'unused', 'inactive']) {
      expect(time(evidence({ app: { disposition: { operational_status: s } } }))).toBe('Eliminate');
    }
    expect(time(evidence({ app: { disposition: { operational_status: 'restricted' } } }))).not.toBe('Eliminate');
  });

  it('Migrate-Critical: CISA KEV match', () => {
    expect(time(evidence({ cve: { critical_count: 0, high_count: 0, kev_match: true } }))).toBe('Migrate-Critical');
  });

  it('Migrate-Critical: critical CVE with end of life inside 12 months, or end of life passed without extended support', () => {
    expect(time(evidence({ cve: { critical_count: 1, high_count: 0, kev_match: false }, eol: { is_eol: false, months_until_eol: 6 } }))).toBe('Migrate-Critical');
    expect(time(evidence({ eol: { is_eol: true, months_until_eol: -10, extended_support_until: null } }))).toBe('Migrate-Critical');
  });

  it('Migrate (standard): end of life in 18 months, or within 12 months without a critical CVE', () => {
    expect(time(evidence({ eol: { is_eol: false, months_until_eol: 18 } }))).toBe('Migrate');
    expect(time(evidence({ eol: { is_eol: false, months_until_eol: 3 } }))).toBe('Migrate');
  });

  it('Invest: strategic, technically healthy, strong vendor', () => {
    const app = {
      disposition: { operational_status: 'active', gartner_time: 'Invest', migration_candidate: true },
      vendor: { name: 'Example Vendor GmbH', support_active: true, version: '9.1', support_contact_present: true, contract_expiry: '2029-01-01' },
      os_class: 'INFRA_PLATFORM_OS_LINUX_DEBIAN',
    };
    const e = evidence({ app, cve: { critical_count: 0, high_count: 0, kev_match: false, patch_available: true }, eol: { is_eol: false, months_until_eol: 60 } });
    expect(time(e)).toBe('Invest');
  });

  it('Tolerate: in support with no overriding risk', () => {
    expect(time(evidence({ eol: { is_eol: false, months_until_eol: 60 }, cve: { critical_count: 0, high_count: 1, kev_match: false } }))).toBe('Tolerate');
  });

  it('never overwrites the analyst TIME value (it is an input to strategic fit only)', () => {
    const e = evidence({ app: { disposition: { operational_status: 'decommissioned', gartner_time: 'Invest' } } });
    expect(time(e)).toBe('Eliminate');
    expect(e.app['disposition']['gartner_time']).toBe('Invest');
  });
});

describe('rules never score missing evidence as healthy (#3196)', () => {
  it('bsi_advisories: unknown without a completed feed match, 100 only for zero advisories', () => {
    expect(APM_RULES['bsi_advisories']!(evidence({ bsi: { alert_count: null, highest_severity: null, note: 'no_input' } }))).toBeNull();
    expect(APM_RULES['bsi_advisories']!(evidence({ bsi: { alert_count: null, highest_severity: null } }))).toBeNull();
    expect(APM_RULES['bsi_advisories']!(evidence({ bsi: { alert_count: 0, highest_severity: null } }))).toBe(100);
    expect(APM_RULES['bsi_advisories']!(evidence({ bsi: { alert_count: 2, highest_severity: 'hoch' } }))).toBe(30);
  });

  it('integration_count: an empty list is unknown unless the intake had an integration column', () => {
    const app = (fields?: string[]) => ({ disposition: { operational_status: 'active' }, integrations: [], ...(fields ? { intake: { sheet: 'S', row: 2, fields } } : {}) });
    expect(APM_RULES['integration_count']!(evidence({ app: app() }))).toBeNull();
    expect(APM_RULES['integration_count']!(evidence({ app: app(['os']) }))).toBeNull();
    expect(APM_RULES['integration_count']!(evidence({ app: app(['integrations_raw', 'os']) }))).toBe(100);
    expect(APM_RULES['integration_count']!(evidence({ app: { ...app(), integrations: ['hosapp141'] } }))).toBe(70);
  });
});

describe('risk score and portfolio-summary.json (#3101, #3103)', () => {
  function testFramework(): ApmFramework {
    const dir = mkdtempSync(join(tmpdir(), 'swao-apm-fw-'));
    dirs.push(dir);
    const meta = dump({ framework: {
      id: 'SWAO_APM', version: 'test', status: 'test', assessment_type_scope: ['service'],
      domains: Object.fromEntries(APM_DOMAINS.map((d) => [d, d])),
      domain_weights: Object.fromEntries(APM_DOMAINS.map((d) => [d, d === 'APM-TCH' ? 60 : d === 'APM-SEC' ? 40 : 0])),
      time_rules: bundled.timeRules,
    } });
    writeFileSync(join(dir, 'framework-meta.yaml'), meta);
    writeFileSync(join(dir, 'controls.yaml'), dump({ controls: [
      { id: 'APM-TCH-01', title: 'OS in support', evidence_basis: [{ apm_export: 'os_eol_status' }] },
      { id: 'APM-TCH-02', title: 'No critical CVEs', evidence_basis: [{ apm_export: 'cve_critical_open' }] },
      { id: 'APM-SEC-01', title: 'No weak crypto', evidence_basis: [{ apm_export: 'weak_crypto' }] },
    ] }));
    return loadApmFramework({ dir });
  }

  function workspace(): string {
    const ws = mkdtempSync(join(tmpdir(), 'swao-apm-ws-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nservice_portfolio:\n  source: intake.xlsx\n');
    const app = (id: string, cve: object, eol: object) => {
      const r = join(ws, 'apps', id, 'wsp', 'inputs', 'research');
      mkdirSync(r, { recursive: true });
      writeFileSync(join(ws, 'apps', id, '.swao.yml'), dump({ app_id: id, app_name: id.toUpperCase(), assessment: { type: 'service' }, vendor: { name: 'Example Vendor GmbH' }, disposition: { operational_status: 'active' } }));
      writeFileSync(join(r, 'cve-summary.md'), `---\n${dump({ topic: 'cve-summary', cve: { source: 'nvd', ...cve } })}---\n`);
      writeFileSync(join(r, 'eol-status.md'), `---\n${dump({ topic: 'eol-status', eol: { source: 'endoflife.date', ...eol } })}---\n`);
    };
    app('app-a', { critical_count: 0, high_count: 0, kev_match: false }, { is_eol: false, months_until_eol: 60, date: '2031-10-14' });
    app('app-b', { critical_count: 1, high_count: 0, kev_match: false }, { is_eol: true, months_until_eol: -24, date: '2024-10-10', extended_support_until: null });
    app('app-c', { critical_count: 1, high_count: 0, kev_match: false }, { is_eol: false, months_until_eol: 48, date: '2030-10-10' });
    for (const id of ['app-a', 'app-b', 'app-c']) markAssessed(ws, id);
    return ws;
  }

  /** A service run pointer (#3241: only assessed apps count in the headline figures). The run dir is absent, so no pass signals are read. */
  function markAssessed(ws: string, id: string): void {
    mkdirSync(join(ws, 'apps', id, 'wsp'), { recursive: true });
    writeFileSync(join(ws, 'apps', id, 'wsp', 'latest-service.txt'), 'runs/2026-10-14T10-00-00');
  }

  it('computes per-app risk = 100 - weighted health over known domains, and the portfolio mean', () => {
    const ws = workspace();
    const summary = buildPortfolioSummary(ws, { now: NOW, framework: testFramework() });
    expect(() => PortfolioSummarySchema.parse(summary)).not.toThrow();
    const byId = Object.fromEntries(summary.apps.map((a) => [a.id, a]));
    // app-a: TCH (100 + 100) / 2 = 100; SEC unknown -> excluded; risk 0.
    expect(byId['app-a']).toMatchObject({ health_score: 100, risk_score: 0, time_quadrant: 'Tolerate', controls_scored: 2, controls_unknown: 1 });
    // app-b: TCH (0 + 40) / 2 = 20 -> risk 80; end of life passed without extended support.
    expect(byId['app-b']).toMatchObject({ risk_score: 80, time_quadrant: 'Migrate-Critical', eol_date: '2024-10-10', cve_critical_count: 1 });
    // app-c: TCH (100 + 40) / 2 = 70 -> risk 30.
    expect(byId['app-c']).toMatchObject({ risk_score: 30, time_quadrant: 'Tolerate' });
    expect(summary.portfolio_risk_score).toBe(36.67);
    expect(summary.time_distribution).toEqual({ Tolerate: 2, Invest: 0, Migrate: 0, 'Migrate-Critical': 1, Eliminate: 0 });
    expect(summary.headline_basis).toBe('assessed_apps');
    const written = JSON.parse(readFileSync(join(ws, 'wsp', 'portfolio-summary.json'), 'utf-8'));
    expect(written.portfolio_risk_score).toBe(36.67);
    expect(byId['app-a']!.vendor_canonical_name).toBe('Example Vendor');
  });

  it('marks apps without end-of-life and CVE evidence as insufficient and leaves them out of the portfolio risk (#3196, #3197)', () => {
    const ws = workspace();
    // app-d: no research stubs at all (intake only), active, assessed
    mkdirSync(join(ws, 'apps', 'app-d'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'app-d', '.swao.yml'), dump({ app_id: 'app-d', app_name: 'APP-D', assessment: { type: 'service' }, disposition: { operational_status: 'active' } }));
    markAssessed(ws, 'app-d');
    // app-e: decommissioned; the operational status decides Eliminate, so the label is evidence-based
    mkdirSync(join(ws, 'apps', 'app-e'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'app-e', '.swao.yml'), dump({ app_id: 'app-e', app_name: 'APP-E', assessment: { type: 'service' }, disposition: { operational_status: 'decommissioned' } }));
    markAssessed(ws, 'app-e');
    const summary = buildPortfolioSummary(ws, { now: NOW, framework: testFramework() });
    expect(() => PortfolioSummarySchema.parse(summary)).not.toThrow();
    const byId = Object.fromEntries(summary.apps.map((a) => [a.id, a]));
    expect(byId['app-d']).toMatchObject({ evidence: 'insufficient', evidence_missing: ['end_of_life', 'cve'], assessed: true });
    expect(byId['app-d']!.time_reason).toMatch(/^insufficient evidence \(end of life and cve status unknown\)/);
    expect(byId['app-e']).toMatchObject({ time_quadrant: 'Eliminate', evidence: 'sufficient' });
    expect(byId['app-a']).toMatchObject({ evidence: 'sufficient', evidence_missing: [], assessed: true });
    // The mean stays over the three evidence-based apps (app-e has no risk score).
    expect(summary.portfolio_risk_score).toBe(36.67);
    expect(summary.insufficient_evidence_count).toBe(1);
    expect(summary.assessed_count).toBe(5);
  });

  it('leaves unassessed apps out of the portfolio risk and the TIME distribution (#3241)', () => {
    const ws = workspace();
    // app-x: research shows high risk (critical CVE, end of life passed) but no service run.
    const r = join(ws, 'apps', 'app-x', 'wsp', 'inputs', 'research');
    mkdirSync(r, { recursive: true });
    writeFileSync(join(ws, 'apps', 'app-x', '.swao.yml'), dump({ app_id: 'app-x', app_name: 'APP-X', assessment: { type: 'service' }, disposition: { operational_status: 'active' } }));
    writeFileSync(join(r, 'cve-summary.md'), `---\n${dump({ topic: 'cve-summary', cve: { source: 'nvd', critical_count: 3, high_count: 2, kev_match: true } })}---\n`);
    writeFileSync(join(r, 'eol-status.md'), `---\n${dump({ topic: 'eol-status', eol: { source: 'endoflife.date', is_eol: true, months_until_eol: -36, date: '2023-10-10', extended_support_until: null } })}---\n`);
    const summary = buildPortfolioSummary(ws, { now: NOW, framework: testFramework() });
    expect(() => PortfolioSummarySchema.parse(summary)).not.toThrow();
    const x = summary.apps.find((a) => a.id === 'app-x')!;
    expect(x).toMatchObject({ assessed: false, evidence: 'not_assessed', run: null });
    // Per-app scaffold scores stay for ranking and waves.
    expect(x.risk_score).not.toBeNull();
    // Headline: the same as the three assessed apps alone.
    expect(summary.app_count).toBe(4);
    expect(summary.assessed_count).toBe(3);
    expect(summary.portfolio_risk_score).toBe(36.67);
    expect(Object.values(summary.time_distribution).reduce((a, b) => a + b, 0)).toBe(3);
    expect(summary.time_distribution).toEqual({ Tolerate: 2, Invest: 0, Migrate: 0, 'Migrate-Critical': 1, Eliminate: 0 });
    expect(summary.insufficient_evidence_count).toBe(0);
  });

  it('reports a null risk and an empty TIME distribution when no app is assessed yet (#3241)', () => {
    const ws = workspace();
    for (const id of ['app-a', 'app-b', 'app-c']) rmSync(join(ws, 'apps', id, 'wsp', 'latest-service.txt'));
    const summary = buildPortfolioSummary(ws, { now: NOW, framework: testFramework() });
    expect(summary.assessed_count).toBe(0);
    expect(summary.portfolio_risk_score).toBeNull();
    expect(Object.values(summary.time_distribution).every((n) => n === 0)).toBe(true);
    expect(summary.apps.every((a) => a.evidence === 'not_assessed')).toBe(true);
  });

  it('reports a null risk score when no control has evidence', () => {
    const fw = testFramework();
    const s = scoreApp(evidence({ app: {} }), fw);
    expect(s.riskScore).toBeNull();
    expect(s.domainScores['APM-TCH']).toBeNull();
  });
});
