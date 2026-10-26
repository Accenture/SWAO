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

// #3280 (Design 103 §22): one combined portfolio view over application and
// service assessments in a shared workspace. Synthetic data only: one
// application app plus two service apps (src/__tests__/fixtures/mixed-workspace.ts).
// #3353: the Enterprise workbook and star schema assertions moved with the
// export to the private premium module @swao/module-service-export.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PortfolioSummarySchema, PortfolioAppSchema } from '@swao/core';
import { MIXED_APP, MIXED_APP_RUN, MIXED_LZ_APP, MIXED_SVC_ASSESSED, MIXED_SVC_UNASSESSED, makeMixedWorkspace } from '../__tests__/fixtures/mixed-workspace.js';
import { buildPortfolioSummary } from './score.js';
import { loadApmFramework } from './framework.js';
import {
  classifyApplicationTime, discoverApplicationApps, gatherApplicationEvidence, resolveApplicationRun, sevenRToTime, type ApplicationEvidence,
} from './application.js';
import { rankPortfolioApps, rankServiceApps } from '../portfolio/selection.js';

const NOW = new Date('2026-10-18T08:00:00Z');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const mixed = () => { const ws = makeMixedWorkspace(); dirs.push(ws); return ws; };


describe('combined portfolio summary (#3280)', () => {
  let ws = '';
  let summary: ReturnType<typeof buildPortfolioSummary>;
  beforeAll(() => {
    ws = mixed();
    summary = buildPortfolioSummary(ws, { now: NOW });
  });

  it('one portfolio-summary.json lists the application app and both service apps, each with assessment_type', () => {
    const onDisk = PortfolioSummarySchema.parse(JSON.parse(readFileSync(join(ws, 'wsp', 'portfolio-summary.json'), 'utf-8')));
    expect(onDisk.apps.map((a) => [a.id, a.assessment_type])).toEqual([
      [MIXED_SVC_ASSESSED, 'service'],
      [MIXED_SVC_UNASSESSED, 'service'],
      [MIXED_APP, 'application'],
    ]);
    expect(onDisk.app_count).toBe(3);
    // The landing zone app is not a portfolio app.
    expect(onDisk.apps.some((a) => a.id === MIXED_LZ_APP)).toBe(false);
  });

  it('scores the application app from its WSP evidence only and maps its 7R verdict to TIME', () => {
    const a = summary.apps.find((x) => x.id === MIXED_APP)!;
    expect(a).toMatchObject({
      name: 'Sovereign Health Platform',
      assessment_type: 'application',
      seven_r_label: 'Replatform',
      time_quadrant: 'Migrate',
      time_reason: '7R verdict Replatform',
      assessed: true,
      evidence: 'sufficient',
      evidence_missing: [],
      run: `runs/${MIXED_APP_RUN}`,
      eol_signal: 'AMBER',
      // Pass 05 counts packages, not CVEs: no CVE count is invented.
      cve_critical_count: null,
      kev_match: false,
      controls_scored: 6,
      controls_unknown: 0,
      health_score: 20,
      risk_score: 80,
    });
    expect(a.domain_scores).toMatchObject({ 'APM-TCH': 40, 'APM-SEC': 10, 'APM-REG': 0, 'APM-MIG': 10, 'APM-VND': null, 'APM-BIZ': null });
    // No apm-score.json is written into the application run.
    expect(() => readFileSync(join(ws, 'apps', MIXED_APP, 'wsp', 'runs', MIXED_APP_RUN, 'apm-score.json'))).toThrow();
  });

  it('TIME, waves, integration graph and headline figures cover both types; by_assessment_type splits them', () => {
    const a = summary.apps.find((x) => x.id === MIXED_APP)!;
    expect(a.fan_in).toBe(1); // hosapp200 (service) depends on sovereign-health (application)
    expect(a.wave).toBe(3);
    expect(summary.waves!.flatMap((w) => w.apps).sort()).toEqual([MIXED_SVC_ASSESSED, MIXED_SVC_UNASSESSED, MIXED_APP].sort());
    expect(summary.assessed_count).toBe(2);
    expect(summary.time_distribution['Migrate']).toBeGreaterThanOrEqual(1);
    expect(summary.by_assessment_type?.application).toMatchObject({ app_count: 1, assessed_count: 1, portfolio_risk_score: 80, time_distribution: { Migrate: 1 } });
    expect(summary.by_assessment_type?.service).toMatchObject({ app_count: 2, assessed_count: 1 });
    const service = summary.apps.find((x) => x.id === MIXED_SVC_ASSESSED)!;
    expect(summary.portfolio_risk_score).toBe(Math.round(((80 + service.risk_score!) / 2) * 100) / 100);
  });

  it('migration-waves report: a type column (last) in Markdown and CSV for a combined plan', () => {
    const md = readFileSync(join(ws, 'wsp', 'reports', 'migration-waves-20261018.md'), 'utf-8');
    expect(md).toContain('| Order | App | Name | TIME | EoL | Dependents | Assessment | Type |');
    expect(md).toMatch(/\| sovereign-health \| Sovereign Health Platform \|[^\n]*\| assessed \| application \|/);
    expect(md).toContain('no assessment run of their type');
    const csv = readFileSync(join(ws, 'wsp', 'reports', 'migration-waves-20261018.csv'), 'utf-8').trim().split('\n');
    expect(csv[0]).toBe('app,wave,wave_label,order,effort_days,dependents,evidence,assessment_type');
    expect(csv.find((l) => l.startsWith(`${MIXED_APP},`))).toMatch(/,sufficient,application$/);
    expect(csv.find((l) => l.startsWith(`${MIXED_SVC_UNASSESSED},`))).toMatch(/,not_assessed,service$/);
  });
});

describe('combined rank order (#3280)', () => {
  it('rankPortfolioApps ranks both types by risk, fan-in, ID; rankServiceApps stays service-only', () => {
    const ws = mixed();
    const s = buildPortfolioSummary(ws, { now: NOW });
    const risk = (id: string) => s.apps.find((a) => a.id === id)!.risk_score;
    // The application app carries the highest risk in this fixture.
    expect(risk(MIXED_APP)).toBeGreaterThan(risk(MIXED_SVC_ASSESSED)!);
    const ranked = rankPortfolioApps(ws);
    expect(ranked.map((a) => [a.id, a.assessment_type])).toEqual([
      [MIXED_APP, 'application'],
      ...[MIXED_SVC_ASSESSED, MIXED_SVC_UNASSESSED]
        .map((id) => s.apps.find((a) => a.id === id)!)
        .sort((x, y) => (y.risk_score ?? -1) - (x.risk_score ?? -1) || (y.fan_in ?? 0) - (x.fan_in ?? 0) || x.id.localeCompare(y.id))
        .map((a) => [a.id, 'service']),
    ]);
    expect(ranked.find((a) => a.id === MIXED_SVC_UNASSESSED)?.evidence).toBe('not_assessed');
    expect(rankPortfolioApps(ws, { top: 1 }).map((a) => a.id)).toEqual([MIXED_APP]);
    expect(rankPortfolioApps(ws, { types: ['application'] }).map((a) => a.id)).toEqual([MIXED_APP]);
    // Callers of rankServiceApps feed the top N into `swao assess --type service`.
    expect(rankServiceApps(ws).every((a) => a.assessment_type === 'service')).toBe(true);
    expect(rankServiceApps(ws).map((a) => a.id)).not.toContain(MIXED_APP);
  });
});

describe('service-only workspaces are unchanged apart from the type column (#3280)', () => {
  it('no by_assessment_type, every entry service, wave report without a type column', () => {
    const ws = makeMixedWorkspace({ serviceOnly: true });
    dirs.push(ws);
    const s = buildPortfolioSummary(ws, { now: NOW });
    expect(s.by_assessment_type).toBeUndefined();
    expect(s.apps.map((a) => a.assessment_type)).toEqual(['service', 'service']);
    // Design 113 section 8 (#3402): service apps now carry a 7R label derived
    // from their TIME quadrant, sourced as derived_from_time (never synthesis).
    expect(s.apps.every((a) => typeof a.seven_r_label === 'string')).toBe(true);
    expect(s.apps.every((a) => a.seven_r_source === 'derived_from_time')).toBe(true);
    const csv = readFileSync(join(ws, 'wsp', 'reports', 'migration-waves-20261018.csv'), 'utf-8').split('\n');
    expect(csv[0]).toBe('app,wave,wave_label,order,effort_days,dependents,evidence');
    expect(readFileSync(join(ws, 'wsp', 'reports', 'migration-waves-20261018.md'), 'utf-8')).not.toContain('| Type |');
  });
});

describe('application evidence rules (#3280, Design 103 §22.2-§22.3)', () => {
  const fw = loadApmFramework();
  const base = (over: Partial<ApplicationEvidence>): ApplicationEvidence => ({
    app: {}, sevenR: null, modernizationPosition: null, portability: null,
    coverageScore: null, cloudNativeScore: null, confidence: null, runtimeEol: null, dependencyCveLookup: false,
    vulnerablePackages: null, findings: null, findingsBySeverity: null, topFindings: [],
    compliance: null, lzVerdict: null, ...over,
  });

  it('7R to TIME rule table', () => {
    expect(['Retire', 'Retain', 'Rehost', 'Relocate', 'Replatform', 'Repurchase', 'Refactor', 'Re-architect', 'Unknown'].map(sevenRToTime))
      .toEqual(['Eliminate', 'Tolerate', 'Migrate', 'Migrate', 'Migrate', 'Migrate', 'Invest', 'Invest', null]);
  });

  it('overrides: decommissioned status, runtime past end of life with vulnerable packages, no run, no 7R', () => {
    expect(classifyApplicationTime(base({ sevenR: 'Refactor', app: { disposition: { operational_status: 'decommissioned' } } }), true, fw).quadrant).toBe('Eliminate');
    expect(classifyApplicationTime(base({ sevenR: 'Rehost', runtimeEol: 'eol', dependencyCveLookup: true, vulnerablePackages: 1 }), true, fw).quadrant).toBe('Migrate-Critical');
    expect(classifyApplicationTime(base({ sevenR: 'Retire', runtimeEol: 'eol', dependencyCveLookup: true, vulnerablePackages: 3 }), true, fw).quadrant).toBe('Eliminate');
    expect(classifyApplicationTime(base({ sevenR: 'Rehost' }), false, fw)).toEqual({ quadrant: 'Tolerate', reason: 'no application assessment run' });
    expect(classifyApplicationTime(base({}), true, fw).reason).toBe('no 7R verdict in the application run');
  });

  it('an application app without a usable run is not_assessed; latest.txt naming a non-application run is skipped', () => {
    const ws = mixed();
    // A second application app whose only pointer names a landing zone run, and a failed application run.
    const appDir = join(ws, 'apps', 'demo-app');
    const lzRun = join(appDir, 'wsp', 'runs', '2026-10-12T10-00-00');
    const failedRun = join(appDir, 'wsp', 'runs', '2026-10-13T10-00-00');
    mkdirSync(lzRun, { recursive: true });
    mkdirSync(failedRun, { recursive: true });
    writeFileSync(join(appDir, '.swao.yml'), 'app_id: demo-app\nassessment:\n  type: application\n');
    writeFileSync(join(appDir, 'wsp', 'latest.txt'), 'runs/2026-10-12T10-00-00');
    writeFileSync(join(lzRun, 'run-manifest.json'), '{}');
    writeFileSync(join(failedRun, 'wsp.yaml'), 'overall:\n  seven_r_label: Rehost\n');
    writeFileSync(join(failedRun, 'run-status.json'), JSON.stringify({ schema_version: '1.0', assessment_type: 'application', app: 'demo-app', run_id: '2026-10-13T10-00-00', status: 'failed', started_at: '2026-10-13T10:00:00Z', swao_version: '1.4.0' }));
    expect(discoverApplicationApps(ws).map((a) => a.appId)).toEqual(['demo-app', MIXED_APP]);
    expect(resolveApplicationRun(ws, 'demo-app')).toBeNull();
    expect(gatherApplicationEvidence(ws, MIXED_APP).run).toBe(`runs/${MIXED_APP_RUN}`);
    const entry = buildPortfolioSummary(ws, { now: NOW, write: false }).apps.find((a) => a.id === 'demo-app')!;
    expect(entry).toMatchObject({ assessment_type: 'application', assessed: false, evidence: 'not_assessed', run: null, risk_score: null, time_quadrant: 'Tolerate' });
  });
});

// Design 113 section 6.2 (#3402): the application-only readiness scores, tags and
// findings projection the engagement hub tiles read, straight from wsp.yaml.
describe('application engagement-hub fields (#3402, Design 113 section 6.2)', () => {
  function appRun(): string {
    const ws = mkdtempSync(join(tmpdir(), 'swao-hub-fields-'));
    dirs.push(ws);
    const appDir = join(ws, 'apps', 'hub-app');
    const runDir = join(appDir, 'wsp', 'runs', '2026-10-20T09-00-00');
    mkdirSync(join(runDir, 'passes'), { recursive: true });
    writeFileSync(join(appDir, '.swao.yml'), 'app_id: hub-app\ntags:\n  - tier-1\n  - regulated\nassessment:\n  type: application\n');
    writeFileSync(join(appDir, 'wsp', 'latest.txt'), 'runs/2026-10-20T09-00-00');
    // Landing-zone catalogue run (same dir for the test) + one per-region fit file.
    writeFileSync(join(appDir, 'wsp', 'latest-landing-zone-catalog.txt'), 'runs/2026-10-20T09-00-00');
    writeFileSync(join(runDir, 'lz-catalogue-fit-otc-eu-de.yaml'), [
      'provider: otc',
      'region: eu-de',
      'overall: READY',
      'items:',
      '  - { verdict: SUPPORTED }',
      '  - { verdict: NEEDS_VERIFICATION }',
    ].join('\n') + '\n');
    // overall spine: the same keys the publication extractor reads.
    writeFileSync(join(runDir, 'wsp.yaml'), [
      'overall:',
      '  seven_r_label: Replatform',
      '  coverage_score: 0.8',
      '  cloud_native_score: 0.45',
      '  portability_score: 0.6',
      '  confidence: high',
    ].join('\n') + '\n');
    writeFileSync(join(runDir, 'run-manifest.json'), JSON.stringify({
      schema_version: '1.4', run_id: '2026-10-20T09-00-00', app: 'hub-app', iter: 1,
      assessed_at: '2026-10-20T09:05:00Z', started_at: '2026-10-20T09:00:00Z', finished_at: '2026-10-20T09:05:00Z',
      duration_ms: 1, passes_executed: [], total_signals_emitted: 4, pass_stats: [],
      provenance: { temperature: 0, swao_version: '1.4.2' }, llm: { model: 'claude-opus-4-8' },
    }));
    // Negative signals across severities; positives and non-negatives ignored.
    writeFileSync(join(runDir, 'wsp-plan.yaml'), [
      'compliance:',
      '  regimes:',
      '    - id: gdpr',
      '      name: GDPR',
      '      controls:',
      '        - { id: Art-6, status: SATISFIED }',
      '        - { id: Art-44, status: GAP }',
      '        - { id: Art-2, status: N_A }',
      'risk_register:',
      '  - { risk_id: RR-01, likelihood: high, impact: critical }',
      '  - { risk_id: RR-02, likelihood: medium, impact: low }',
    ].join('\n') + '\n');
    writeFileSync(join(runDir, 'passes', 'pass-08-crypto.yaml'), [
      'signals:',
      '  - { id: CRYPTO-01, severity: critical, outcome: negative, derivation: No encryption at rest }',
      '  - { id: SEC-02, severity: high, outcome: negative, derivation: Weak TLS configuration }',
      '  - { id: OPS-03, severity: medium, outcome: negative, derivation: No backup policy }',
      '  - { id: GOOD-04, severity: low, outcome: positive, derivation: Good logging }',
    ].join('\n') + '\n');
    return ws;
  }

  it('gatherApplicationEvidence reads the overall scores, confidence and per-severity findings', () => {
    const { evidence } = gatherApplicationEvidence(appRun(), 'hub-app');
    expect(evidence.coverageScore).toBe(0.8);
    expect(evidence.cloudNativeScore).toBe(0.45);
    expect(evidence.portability).toBe(0.6);
    expect(evidence.confidence).toBe('high');
    // Mirrors the publication signal_counts: every signal by severity, including
    // the positive one (low). Parity with the report is why this is not negative-only.
    expect(evidence.findingsBySeverity).toEqual({ critical: 1, high: 1, medium: 1, low: 1 });
    // Highest severity first; the positive low signal is outside the top 3.
    expect(evidence.topFindings.map((f) => f.id)).toEqual(['CRYPTO-01', 'SEC-02', 'OPS-03']);
    expect(evidence.topFindings[0]).toEqual({ id: 'CRYPTO-01', severity: 'critical', title: 'No encryption at rest' });
  });

  it('buildPortfolioSummary carries the section 6.2 fields onto the app entry', () => {
    const entry = buildPortfolioSummary(appRun(), { now: NOW, write: false }).apps.find((a) => a.id === 'hub-app')!;
    expect(entry.coverage_score).toBe(0.8);
    expect(entry.cloud_native_score).toBe(0.45);
    expect(entry.portability_score).toBe(0.6);
    expect(entry.confidence).toBe('high');
    expect(entry.tags).toEqual(['tier-1', 'regulated']);
    expect(entry.findings_by_severity).toEqual({ critical: 1, high: 1, medium: 1, low: 1 });
    expect(entry.blocker_count).toBe(2); // critical + high by severity
    expect(entry.top_findings).toHaveLength(3);
    expect(entry.seven_r_label).toBe('Replatform');
    expect(entry.seven_r_source).toBe('synthesis');
    // Run provenance from the manifest.
    expect(entry.last_assessed_at).toBe('2026-10-20T09:05:00Z');
    expect(entry.swao_version).toBe('1.4.2');
    expect(entry.llm_model).toBe('claude-opus-4-8');
    // Per-framework compliance mirrors the publication (SATISFIED -> pass, GAP -> fail).
    // #3425: N_A is not-applicable, not fail.
    expect(entry.compliance).toEqual([{ id: 'GDPR', name: 'GDPR', pass: 1, partial: 0, fail: 1, not_assessed: 0, not_applicable: 1 }]);
    // risk_counts keyed {likelihood}_{impact}; critical folds into high.
    expect(entry.risk_counts).toEqual({ high_high: 1, medium_low: 1 });
    // lz_fit per target; NEEDS_VERIFICATION is a blocker, SUPPORTED is not.
    expect(entry.lz_fit).toEqual([{ provider: 'otc', region: 'eu-de', verdict: 'READY', blockers: 1 }]);
    // #3405: no Pass 26 in this run -> no code_health key.
    expect(entry.code_health).toBeUndefined();
  });

  it('#3405: carries the Pass 26 code-health KPIs onto the app entry; malformed KPIs are ignored', () => {
    const ws = appRun();
    const passes = join(ws, 'apps', 'hub-app', 'wsp', 'runs', '2026-10-20T09-00-00', 'passes');
    writeFileSync(join(passes, '26-quality.yaml'), [
      'pass: { id: 26, name: code_health, status: complete, iter: 1 }',
      'signals: []',
      'assessment:',
      '  code_health:',
      '    kpis: { complexity: 80, maintainability: 74, duplication: 90, configuration_hygiene: 70, overall: 79 }',
    ].join('\n') + '\n');
    const entry = buildPortfolioSummary(ws, { now: NOW, write: false }).apps.find((a) => a.id === 'hub-app')!;
    expect(entry.code_health).toEqual({ complexity: 80, maintainability: 74, duplication: 90, configuration_hygiene: 70, overall: 79 });
    expect(PortfolioAppSchema.safeParse(entry).success).toBe(true);

    writeFileSync(join(passes, '26-quality.yaml'), 'assessment:\n  code_health:\n    kpis: { overall: 500 }\n');
    expect(gatherApplicationEvidence(ws, 'hub-app').evidence.codeHealth).toBeNull();
  });
});

// Design 113 section 12: the section 6.2 fields must be filled for a SERVICE run
// too. Service apps carry findings from the run signals and the same provenance.
describe('service engagement-hub fields (#3402, Design 113 section 6.2 + 12)', () => {
  function serviceRun(): string {
    const ws = mkdtempSync(join(tmpdir(), 'swao-hub-svc-'));
    dirs.push(ws);
    const appDir = join(ws, 'apps', 'svc-app');
    const runDir = join(appDir, 'wsp', 'runs', '2026-10-21T09-00-00');
    mkdirSync(join(runDir, 'passes'), { recursive: true });
    writeFileSync(join(appDir, '.swao.yml'), 'app_id: svc-app\ntags:\n  - intake\nassessment:\n  type: service\n');
    writeFileSync(join(appDir, 'wsp', 'latest-service.txt'), 'runs/2026-10-21T09-00-00');
    writeFileSync(join(runDir, 'run-manifest.json'), JSON.stringify({
      schema_version: '1.4', run_id: '2026-10-21T09-00-00', app: 'svc-app', iter: 1,
      assessed_at: '2026-10-21T09:10:00Z', started_at: '2026-10-21T09:00:00Z', finished_at: '2026-10-21T09:10:00Z',
      duration_ms: 1, passes_executed: [], total_signals_emitted: 2, pass_stats: [],
      provenance: { temperature: 0, swao_version: '1.4.2' },
    }));
    writeFileSync(join(runDir, 'passes', '03-data.yaml'), [
      'signals:',
      '  - { id: DATA-01, severity: high, outcome: negative, derivation: Personal data without DPA }',
      '  - { id: DATA-02, severity: medium, outcome: negative, derivation: No data residency control }',
    ].join('\n') + '\n');
    return ws;
  }

  it('fills findings, tags, provenance and derived 7R for a service run', () => {
    const entry = buildPortfolioSummary(serviceRun(), { now: NOW, write: false }).apps.find((a) => a.id === 'svc-app')!;
    expect(entry.assessment_type).toBe('service');
    expect(entry.tags).toEqual(['intake']);
    expect(entry.findings_by_severity).toEqual({ high: 1, medium: 1 });
    expect(entry.blocker_count).toBe(1); // high only
    expect(entry.top_findings?.map((f) => f.id)).toEqual(['DATA-01', 'DATA-02']);
    expect(entry.seven_r_source).toBe('derived_from_time'); // never synthesis
    expect(entry.last_assessed_at).toBe('2026-10-21T09:10:00Z');
    expect(entry.swao_version).toBe('1.4.2');
    expect(entry.llm_model).toBeNull(); // no llm block in the manifest
  });
});
