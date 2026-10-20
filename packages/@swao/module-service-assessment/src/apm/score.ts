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

/**
 * SWAO_APM scoring, TIME classification, and the portfolio summary
 * (Design 103 §7, §7.1, §7.2, G-04, G-07, #3100, #3101).
 *
 * Deterministic and evidence-traceable (G-07): every control score comes from a
 * named rule over recorded evidence; unknown controls are excluded, and a
 * domain with no known control is excluded from the weighted sum (weights
 * renormalised over known domains, §18.1 "normalised for skipped passes").
 * The LLM-driven COMP pass is not an input.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { PortfolioSummarySchema, TIME_QUADRANTS, type PortfolioApp, type PortfolioAssessmentType, type PortfolioSummary, type TimeQuadrant } from '@swao/core';
import { readStub } from '../research/stub-file.js';
import { discoverServiceApps } from '../research/research.js';
import { APM_DOMAINS, loadApmFramework, type ApmDomain, type ApmFramework } from './framework.js';
import { APM_RULES, RESEARCHED, type ApmEvidence, type ApmSignal } from './rules.js';
import { loadInfraCatalogue, type InfraCatalogue } from '../catalog/infra-cat.js';
import { applicationEvidenceGaps, classifyApplicationTime, discoverApplicationApps, gatherApplicationEvidence, runtimeEolSignal, scoreApplicationApp } from './application.js';
import { blastRadius, buildIntegrationGraph, canonicalVendor, eolSignal, planWaves, renderWaveReport, vendorConsolidation } from '../portfolio/analytics.js';

export interface ControlScore { id: string; rule: string | null; score: number | null }

export interface AppScore {
  domainScores: Record<ApmDomain, number | null>;
  controls: ControlScore[];
  healthScore: number | null;
  riskScore: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function scoreApp(evidence: ApmEvidence, fw: ApmFramework): AppScore {
  const controls: ControlScore[] = fw.controls.map((c) => {
    const rule = c.rule ? APM_RULES[c.rule] : undefined;
    return { id: c.id, rule: c.rule, score: rule ? rule(evidence) : null };
  });
  const domainScores = {} as Record<ApmDomain, number | null>;
  for (const d of APM_DOMAINS) {
    const known = fw.controls
      .map((c, i) => ({ c, s: controls[i]!.score }))
      .filter((x): x is { c: (typeof fw.controls)[number]; s: number } => x.c.domain === d && x.s !== null);
    const w = known.reduce((a, x) => a + x.c.weight, 0);
    domainScores[d] = w > 0 ? round2(known.reduce((a, x) => a + x.s * x.c.weight, 0) / w) : null;
  }
  const weighted = APM_DOMAINS.filter((d) => domainScores[d] !== null && fw.domainWeights[d] > 0);
  const totalWeight = weighted.reduce((a, d) => a + fw.domainWeights[d], 0);
  const healthScore = totalWeight > 0 ? round2(weighted.reduce((a, d) => a + (domainScores[d] as number) * fw.domainWeights[d], 0) / totalWeight) : null;
  return { domainScores, controls, healthScore, riskScore: healthScore === null ? null : round2(100 - healthScore) };
}

export interface TimeResult { quadrant: TimeQuadrant; reason: string }

/**
 * Evidence the TIME decision rests on (#3196): end-of-life and CVE status.
 * Returns the missing items; both missing means the label is not evidence-based
 * unless the operational status decides it.
 */
export function timeEvidenceGaps(evidence: ApmEvidence): string[] {
  const gaps: string[] = [];
  if (typeof evidence.eol?.['is_eol'] !== 'boolean' && typeof evidence.eol?.['months_until_eol'] !== 'number') gaps.push('end_of_life');
  if (!RESEARCHED(evidence.cve)) gaps.push('cve');
  return gaps;
}

/**
 * Two layers (Design 103 §7.1 / #3100 overrides, then #2811 domain thresholds):
 * 1. Eliminate for decommissioned / unused / inactive (G-03, G-04). `restricted`
 *    ("nicht starten & nicht loeschen", keep but do not start) is deliberately not
 *    an Eliminate trigger.
 * 2. Migrate-Critical for a CISA KEV match, or a critical CVE with end of life
 *    inside the window. End of life already passed without extended support goes
 *    to the configured quadrant.
 * 3. Migrate for end of life in the 12-36 month window, or weak vendor / technical
 *    health with sufficient migration readiness.
 * 4. Invest / Eliminate by domain thresholds; otherwise Tolerate.
 */
export function classifyTime(evidence: ApmEvidence, score: AppScore, fw: ApmFramework): TimeResult {
  const r = fw.timeRules;
  const status = evidence.app?.['disposition']?.['operational_status'];
  if (typeof status === 'string' && r.eliminate_operational_status.includes(status)) {
    return { quadrant: 'Eliminate', reason: `operational status ${status}` };
  }
  const kev = evidence.cve?.['kev_match'] === true;
  const critical = typeof evidence.cve?.['critical_count'] === 'number' ? (evidence.cve['critical_count'] as number) : 0;
  const months = typeof evidence.eol?.['months_until_eol'] === 'number' ? (evidence.eol['months_until_eol'] as number) : null;
  if (r.migrate_critical.kev_match && kev) return { quadrant: 'Migrate-Critical', reason: 'CISA KEV known-exploited vulnerability match' };
  if (critical >= r.migrate_critical.cve_critical_min && months !== null && months < r.migrate_critical.eol_months_max) {
    return { quadrant: 'Migrate-Critical', reason: `${critical} critical CVE(s) and end of life in ${Math.max(0, Math.round(months))} months` };
  }
  if (evidence.eol?.['is_eol'] === true && !evidence.eol?.['extended_support_until']) {
    return { quadrant: r.eol_past_without_extended_support, reason: 'end of life passed without extended support' };
  }
  const d = score.domainScores;
  const lt = (v: number | null, max: number) => v !== null && v < max;
  const gt = (v: number | null, min: number) => v !== null && v > min;
  if (months !== null && months >= r.migrate.eol_months_min && months <= r.migrate.eol_months_max) {
    return { quadrant: 'Migrate', reason: `end of life in ${Math.round(months)} months` };
  }
  if (evidence.eol?.['is_eol'] === true) return { quadrant: 'Migrate', reason: 'end of life passed; extended support only' };
  if ((lt(d['APM-VND'], r.migrate.vendor_health_max) || lt(d['APM-TCH'], r.migrate.technical_health_max)) && gt(d['APM-MIG'], r.migrate.migration_readiness_min)) {
    return { quadrant: 'Migrate', reason: 'weak vendor or technical health with migration readiness' };
  }
  if (gt(d['APM-STR'], r.invest.strategic_fit_min) && gt(d['APM-TCH'], r.invest.technical_health_min) && gt(d['APM-VND'], r.invest.vendor_health_min)) {
    return { quadrant: 'Invest', reason: 'strong strategic fit, technical health, and vendor health' };
  }
  if (lt(d['APM-STR'], r.eliminate.strategic_fit_max) && lt(d['APM-BIZ'], r.eliminate.business_criticality_max)) {
    return { quadrant: 'Eliminate', reason: 'low strategic fit and low business criticality' };
  }
  return { quadrant: 'Tolerate', reason: 'in support with no overriding risk' };
}

/** Gather evidence for one service app from its `.swao.yml`, research stubs, and latest service run. */
export function gatherEvidence(workspacePath: string, appId: string, now: Date): { evidence: ApmEvidence; run: string | null } {
  const appDir = join(workspacePath, 'apps', appId);
  let app: Record<string, any> = {};
  try { app = (load(readFileSync(join(appDir, '.swao.yml'), 'utf-8')) ?? {}) as Record<string, any>; } catch { /* empty */ }
  const research = join(appDir, 'wsp', 'inputs', 'research');
  const cveStub = readStub(join(research, 'cve-summary.md'))?.front as Record<string, any> | undefined;
  const eolStub = readStub(join(research, 'eol-status.md'))?.front as Record<string, any> | undefined;
  const vtStub = readStub(join(research, 'virustotal.md'))?.front as Record<string, any> | undefined;

  let run: string | null = null;
  let runSignals: ApmSignal[] | null = null;
  const ranPasses: string[] = [];
  const pointer = join(appDir, 'wsp', 'latest-service.txt');
  if (existsSync(pointer)) {
    run = readFileSync(pointer, 'utf-8').trim();
    const passesDir = join(appDir, 'wsp', run, 'passes');
    if (existsSync(passesDir)) {
      runSignals = [];
      for (const f of readdirSync(passesDir).filter((n) => n.endsWith('.yaml'))) {
        ranPasses.push(f.replace(/^\d+-/, '').replace(/\.yaml$/, ''));
        try {
          const doc = load(readFileSync(join(passesDir, f), 'utf-8')) as { signals?: ApmSignal[] } | null;
          runSignals.push(...(doc?.signals ?? []));
        } catch { /* skip unreadable pass file */ }
      }
    }
  }
  let binarySignals: Array<{ code: string; severity?: string }> | null = null;
  try {
    const doc = JSON.parse(readFileSync(join(appDir, 'wsp', 'signals', 'binary-signals.json'), 'utf-8')) as { signals?: Array<{ code: string; severity?: string }> };
    const analysis = JSON.parse(readFileSync(join(appDir, 'wsp', 'inputs', 'binary', 'binary-analysis.json'), 'utf-8')) as { files?: unknown[] };
    if ((analysis.files ?? []).length > 0) binarySignals = doc.signals ?? [];
  } catch { /* no binary analysis */ }
  return {
    evidence: { app, binarySignals, cve: cveStub?.['cve'] ?? null, eol: eolStub?.['eol'] ?? null, vt: vtStub?.['vt'] ?? null, bsi: cveStub?.['bsi'] ?? null, runSignals, ranPasses, now },
    run,
  };
}

/** #3280: headline figures over the assessed apps of one set (both types, or one type). */
function headline(apps: readonly PortfolioApp[]): { app_count: number; assessed_count: number; portfolio_risk_score: number | null; time_distribution: Record<TimeQuadrant, number> } {
  const assessed = apps.filter((x) => x.assessed === true);
  const risks = assessed.filter((x) => x.evidence === 'sufficient').map((x) => x.risk_score).filter((v): v is number => v !== null);
  return {
    app_count: apps.length,
    assessed_count: assessed.length,
    portfolio_risk_score: risks.length > 0 ? round2(risks.reduce((x, y) => x + y, 0) / risks.length) : null,
    time_distribution: Object.fromEntries(TIME_QUADRANTS.map((q) => [q, assessed.filter((x) => x.time_quadrant === q).length])) as Record<TimeQuadrant, number>,
  };
}

/**
 * Build `wsp/portfolio-summary.json` and write per-run `apm-score.json` for service apps.
 * #3280 (Design 103 §22): the combined portfolio view; application apps of the same
 * workspace are listed with `assessment_type: application`, scored from their latest
 * application run only, and take part in TIME, the wave plan, the integration graph
 * and vendor consolidation. No apm-score.json is written into application runs.
 */
export function buildPortfolioSummary(workspacePath: string, opts: { now?: Date; framework?: ApmFramework; write?: boolean; catalogue?: InfraCatalogue } = {}): PortfolioSummary {
  const now = opts.now ?? new Date();
  const write = opts.write !== false;
  const fw = opts.framework ?? loadApmFramework({ workspacePath });
  const rows: Array<{ entry: PortfolioApp; evidence: ApmEvidence; controls: ControlScore[]; type: PortfolioAssessmentType }> = [];
  for (const a of discoverServiceApps(workspacePath)) {
    const { evidence, run } = gatherEvidence(workspacePath, a.appId, now);
    const score = scoreApp(evidence, fw);
    const classified = classifyTime(evidence, score, fw);
    const status = evidence.app['disposition']?.['operational_status'];
    const decidedByStatus = typeof status === 'string' && fw.timeRules.eliminate_operational_status.includes(status);
    const gaps = timeEvidenceGaps(evidence);
    const insufficient = !decidedByStatus && gaps.length === 2;
    const time = insufficient
      ? { quadrant: classified.quadrant, reason: `insufficient evidence (${gaps.join(' and ').replace(/_/g, ' ')} status unknown); ${classified.reason}` }
      : classified;
    const scored = score.controls.filter((c) => c.score !== null).length;
    const app = evidence.app;
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    rows.push({
      evidence,
      controls: score.controls,
      type: 'service',
      entry: {
        id: a.appId,
        name: a.appName,
        time_quadrant: time.quadrant,
        time_reason: time.reason,
        analyst_time: typeof app['disposition']?.['gartner_time'] === 'string' ? app['disposition']['gartner_time'] : null,
        risk_score: score.riskScore,
        health_score: score.healthScore,
        domain_scores: score.domainScores,
        controls_scored: scored,
        controls_unknown: score.controls.length - scored,
        eol_date: typeof evidence.eol?.['date'] === 'string' ? evidence.eol['date'] : null,
        cve_critical_count: num(evidence.cve?.['critical_count']),
        kev_match: evidence.cve?.['kev_match'] === true,
        vendor_canonical_name: null,
        infra_category: typeof app['infra_category'] === 'string' ? app['infra_category'] : null,
        site: typeof app['site'] === 'string' ? app['site'] : null,
        operational_status: app['disposition']?.['operational_status'] ?? null,
        run,
        os: typeof app['platform']?.['os'] === 'string' ? app['platform']['os'] : null,
        eol_signal: eolSignal(evidence.eol),
        migration_candidate: typeof app['disposition']?.['migration_candidate'] === 'boolean' ? app['disposition']['migration_candidate'] : null,
        cve_high_count: num(evidence.cve?.['high_count']),
        est_cloud_cost_eur_mo: num(app['hardware']?.['est_cloud_cost_eur_mo']),
        assessed: run !== null,
        // #3241: an app without a run is labelled not_assessed whatever its research shows.
        evidence: run === null ? 'not_assessed' : insufficient ? 'insufficient' : 'sufficient',
        evidence_missing: gaps,
        assessment_type: 'service',
      },
    });
  }

  // #3280 (Design 103 §22): application apps, scored from their latest usable application run.
  for (const a of discoverApplicationApps(workspacePath)) {
    const { evidence: ae, run } = gatherApplicationEvidence(workspacePath, a.appId);
    const assessed = run !== null;
    const score = scoreApplicationApp(ae, fw);
    const time = classifyApplicationTime(ae, assessed, fw);
    const gaps = assessed ? applicationEvidenceGaps(ae) : [];
    const insufficient = gaps.includes('seven_r') || (gaps.includes('end_of_life') && gaps.includes('cve'));
    const app = ae.app;
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    const scored = score.controls.filter((c) => c.score !== null).length;
    rows.push({
      evidence: { app, cve: null, eol: null, vt: null, bsi: null, runSignals: null, ranPasses: [], now },
      controls: score.controls,
      type: 'application',
      entry: {
        id: a.appId,
        name: a.appName,
        time_quadrant: time.quadrant,
        time_reason: insufficient ? `insufficient evidence (${gaps.join(', ').replace(/_/g, ' ')} unknown); ${time.reason}` : time.reason,
        analyst_time: typeof app['disposition']?.['gartner_time'] === 'string' ? app['disposition']['gartner_time'] : null,
        risk_score: score.riskScore,
        health_score: score.healthScore,
        domain_scores: score.domainScores,
        controls_scored: scored,
        controls_unknown: score.controls.length - scored,
        eol_date: null,
        // Pass 05 counts packages with high or critical CVEs, not CVEs: not reported as a CVE count.
        cve_critical_count: null,
        kev_match: false,
        vendor_canonical_name: null,
        infra_category: typeof app['infra_category'] === 'string' ? app['infra_category'] : null,
        site: typeof app['site'] === 'string' ? app['site'] : null,
        operational_status: app['disposition']?.['operational_status'] ?? null,
        run,
        os: typeof app['platform']?.['os'] === 'string' ? app['platform']['os'] : null,
        eol_signal: runtimeEolSignal(ae),
        migration_candidate: typeof app['disposition']?.['migration_candidate'] === 'boolean' ? app['disposition']['migration_candidate'] : null,
        cve_high_count: null,
        est_cloud_cost_eur_mo: num(app['hardware']?.['est_cloud_cost_eur_mo']),
        assessed,
        evidence: !assessed ? 'not_assessed' : insufficient ? 'insufficient' : 'sufficient',
        evidence_missing: gaps,
        assessment_type: 'application',
        seven_r_label: ae.sevenR,
      },
    });
  }
  // One list for both types, in ID order (service-only workspaces keep their order).
  rows.sort((x, y) => x.entry.id.localeCompare(y.entry.id));

  // Design 103 §21.4: integration graph and blast radius.
  const graph = buildIntegrationGraph(rows.map((r) => ({
    id: r.entry.id,
    integrations: Array.isArray(r.evidence.app['integrations']) ? (r.evidence.app['integrations'] as string[]) : [],
    clusterMembers: Array.isArray(r.evidence.app['cluster_members']) ? (r.evidence.app['cluster_members'] as string[]) : null,
  })), now);
  for (const r of rows) {
    r.entry.fan_in = graph.fan_in[r.entry.id] ?? 0;
    const b = blastRadius(r.entry.fan_in, r.entry.time_quadrant, r.entry.eol_signal ?? null);
    r.entry.blast_radius_score = b.score;
    r.entry.blast_radius_tier = b.tier;
  }

  // Design 103 §21.3: migration waves.
  const regs = (r: (typeof rows)[number]) => (Array.isArray(r.evidence.app['data']?.['regulatory']) ? (r.evidence.app['data']['regulatory'] as unknown[]).map(String) : []);
  const plan = planWaves(rows.map((r) => ({
    id: r.entry.id,
    time: r.entry.time_quadrant,
    eolSignal: r.entry.eol_signal ?? null,
    healthData: r.evidence.app['data']?.['health_data'] === true,
    gdprArt9: r.evidence.app['data']?.['gdpr_art9'] === true,
    fanIn: r.entry.fan_in ?? 0,
    blastScore: r.entry.blast_radius_score ?? 0,
    infraCategory: r.entry.infra_category,
    isCluster: r.evidence.app['cluster'] === true,
    mdr: regs(r).some((x) => x.toUpperCase() === 'MDR'),
  })), graph);
  for (const r of rows) {
    r.entry.wave = plan.byApp[r.entry.id]!.wave;
    r.entry.effort_days = plan.byApp[r.entry.id]!.effort_days;
  }

  // Design 103 §21.5: vendor consolidation.
  let catalogue = opts.catalogue;
  try { catalogue ??= loadInfraCatalogue({ workspacePath }); } catch { catalogue = { services: [], sites: [], sources: [] }; }
  const vendorName = (r: (typeof rows)[number]) => (typeof r.evidence.app['vendor']?.['name'] === 'string' ? (r.evidence.app['vendor']['name'] as string) : null);
  for (const r of rows) r.entry.vendor_canonical_name = canonicalVendor(vendorName(r), catalogue)?.vendor ?? null;
  const vendors = vendorConsolidation(rows.map((r) => ({
    id: r.entry.id,
    vendorName: vendorName(r),
    infraCategory: r.entry.infra_category,
    time: r.entry.time_quadrant,
    eolSignal: r.entry.eol_signal ?? null,
  })), catalogue);

  const apps = rows.map((r) => r.entry);
  // #3196 / #3241: the headline figures cover assessed apps only. The portfolio
  // risk is the mean over assessed apps whose TIME decision rests on evidence;
  // the TIME distribution counts assessed apps. Unassessed apps keep their
  // scaffold-derived per-app scores (used for ranking and waves) but are
  // labelled evidence: not_assessed and stay out of both figures.
  // #3280: assessed apps of both types count; by_assessment_type splits the figures per type
  // and is only written when the workspace holds application apps (service-only output unchanged).
  const all = headline(apps);
  const hasApplications = rows.some((r) => r.type === 'application');
  const summary = PortfolioSummarySchema.parse({
    generated_at: now.toISOString(),
    framework: { id: 'SWAO_APM', version: fw.version, status: fw.status },
    domain_weights: fw.domainWeights,
    app_count: all.app_count,
    portfolio_risk_score: all.portfolio_risk_score,
    headline_basis: 'assessed_apps',
    assessed_count: all.assessed_count,
    insufficient_evidence_count: apps.filter((x) => x.evidence === 'insufficient').length,
    time_distribution: all.time_distribution,
    ...(hasApplications ? {
      by_assessment_type: {
        application: headline(apps.filter((x) => x.assessment_type === 'application')),
        service: headline(apps.filter((x) => x.assessment_type !== 'application')),
      },
    } : {}),
    apps,
    vendor_consolidation: vendors,
    waves: plan.waves,
  });

  if (write) {
    for (const r of rows) {
      if (r.type !== 'service') continue;
      // A stale latest-service.txt can point at a deleted run; skip rather than fail the summary.
      if (r.entry.run && existsSync(join(workspacePath, 'apps', r.entry.id, 'wsp', r.entry.run))) writeFileSync(join(workspacePath, 'apps', r.entry.id, 'wsp', r.entry.run, 'apm-score.json'), `${JSON.stringify({ ...r.entry, controls: r.controls }, null, 2)}\n`, 'utf-8');
    }
    mkdirSync(join(workspacePath, 'wsp', 'inputs'), { recursive: true });
    mkdirSync(join(workspacePath, 'wsp', 'reports'), { recursive: true });
    writeFileSync(join(workspacePath, 'wsp', 'portfolio-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
    writeFileSync(join(workspacePath, 'wsp', 'inputs', 'integration-graph.json'), `${JSON.stringify(graph, null, 2)}\n`, 'utf-8');
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const report = renderWaveReport(plan, apps, now.toISOString().slice(0, 10));
    writeFileSync(join(workspacePath, 'wsp', 'reports', `migration-waves-${date}.md`), report.md, 'utf-8');
    writeFileSync(join(workspacePath, 'wsp', 'reports', `migration-waves-${date}.csv`), report.csv, 'utf-8');
  }
  return summary;
}
