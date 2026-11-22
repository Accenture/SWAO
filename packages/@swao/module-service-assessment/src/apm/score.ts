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
import { dump, load } from 'js-yaml';
import { PortfolioSummarySchema, RunContextSchema, readLatestLzLivePortfolio, lzLivePortfolioSummaryEntries, lzLivePortfolioAppFitEntries, type LzLivePortfolio, TIME_QUADRANTS, countSignalsBySeverity, countBlockerSignals, sortSignalsBySeverity, summariseRegimeCompliance, summariseRiskRegister, countLzFitBlockers, listLzCatalogueFitFiles, resolveSevenRVerdict, type PortfolioApp, type PortfolioAssessmentType, type PortfolioSummary, type SevenRSource, type TimeQuadrant } from '@swao/core';
import { readStub } from '../research/stub-file.js';
import { APM_DOMAINS, loadApmFramework, type ApmDomain, type ApmFramework } from './framework.js';
import { APM_RULES, RESEARCHED, type ApmEvidence, type ApmSignal } from './rules.js';
import { loadInfraCatalogue, type InfraCatalogue } from '../catalog/infra-cat.js';
import { applicationEvidenceGaps, classifyApplicationTime, gatherApplicationEvidence, isApplicationAppConfig, runtimeEolSignal, scoreApplicationApp } from './application.js';
import { PORTFOLIO_ROW_CACHE_VERSION, crossAppFields, fingerprintDifference, portfolioCacheKey, readPortfolioRowCacheDetailed, serviceAppFingerprint, type PortfolioCacheMissReason, statSig, writePortfolioRowCache, type CachedAppKind, type CrossAppFields, type PortfolioRowCache, type ServiceAppInputs } from './summary-cache.js';
import { blastRadius, buildIntegrationGraph, canonicalVendor, eolSignal, planWaves, renderWaveReport, vendorConsolidation } from '../portfolio/analytics.js';

export interface ControlScore { id: string; rule: string | null; score: number | null }

/** Design 113 section 6.2: run provenance (last_assessed_at, swao_version,
 *  llm_model) from the run's manifest. `run` is the wsp-relative run path
 *  (`runs/<id>`) used by both assessment types. Best-effort: a missing or
 *  unreadable manifest yields nulls. */
export function readRunProvenance(
  workspacePath: string,
  appId: string,
  run: string | null,
): { last_assessed_at: string | null; swao_version: string | null; llm_model: string | null } {
  const empty = { last_assessed_at: null, swao_version: null, llm_model: null };
  if (!run) return empty;
  try {
    const m = JSON.parse(readFileSync(join(workspacePath, 'apps', appId, 'wsp', run, 'run-manifest.json'), 'utf-8')) as Record<string, unknown>;
    const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
    const prov = m['provenance'] as Record<string, unknown> | undefined;
    const llm = m['llm'] as Record<string, unknown> | undefined;
    return {
      last_assessed_at: s(m['assessed_at']) ?? s(m['finished_at']),
      swao_version: prov ? s(prov['swao_version']) : null,
      llm_model: llm ? s(llm['model']) : null,
    };
  } catch {
    return empty;
  }
}

/** #3873 (Design 123 sections 8.4 and 9.2): the LZ evidence source of the
 *  app's latest run, from its `run-context.yaml` (`lz_source`, #3887).
 *  Best-effort: absent, unreadable or invalid yields undefined. */
export function readRunLzSource(workspacePath: string, appId: string, run: string | null): PortfolioApp['lz_source'] {
  if (!run) return undefined;
  try {
    const ctx = RunContextSchema.safeParse(load(readFileSync(join(workspacePath, 'apps', appId, 'wsp', run, 'run-context.yaml'), 'utf-8')));
    return ctx.success ? ctx.data.lz_source : undefined;
  } catch {
    return undefined;
  }
}

/** Design 113 section 6.2: the fields derived from the run's `wsp-plan.yaml` --
 *  per-framework compliance (compliance.regimes) and risk_counts (risk_register) --
 *  via the shared @swao/core summarisers so the hub matches the publication. Read
 *  once per app. `run` is the wsp-relative run path. */
function readPlanDerivedFields(
  workspacePath: string,
  appId: string,
  run: string | null,
): Pick<PortfolioApp, 'compliance' | 'risk_counts'> {
  if (!run) return {};
  try {
    const plan = load(readFileSync(join(workspacePath, 'apps', appId, 'wsp', run, 'wsp-plan.yaml'), 'utf-8')) as Record<string, any> | null;
    return {
      compliance: summariseRegimeCompliance(plan?.['compliance']?.['regimes']),
      risk_counts: summariseRiskRegister(plan?.['risk_register']),
    };
  } catch {
    return {};
  }
}

/** Design 113 section 6.2: per-target landing-zone fit (application apps). Reads
 *  the app's latest landing-zone catalogue run (pointed to by
 *  `wsp/latest-landing-zone-catalog.txt`) and projects each
 *  `lz-catalogue-fit-<provider>-<region>.yaml` into {provider, region, verdict,
 *  blockers}, counting blockers with the shared @swao/core classifier so the hub
 *  matches the publication. #4356: an application run with LZ targets writes its
 *  own fit at the run root (`lz-catalogue-fit.yaml` or the per-target shape);
 *  those targets are added after the catalogue-run targets (a target the
 *  catalogue run already covers is not repeated). Best-effort; undefined when
 *  neither source has a fit. */
export function readLzFit(workspacePath: string, appId: string, appRun?: string | null): PortfolioApp['lz_fit'] {
  const wspDir = join(workspacePath, 'apps', appId, 'wsp');
  const out: NonNullable<PortfolioApp['lz_fit']> = [];
  const seen = new Set<string>();
  const collect = (runDir: string, files: string[]): void => {
    for (const f of files) {
      try {
        const doc = load(readFileSync(join(runDir, f), 'utf-8')) as Record<string, any> | null;
        if (!doc || typeof doc !== 'object') continue;
        const provider = String(doc['provider'] ?? '');
        const region = String(doc['region'] ?? '');
        const key = `${provider}/${region}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ provider, region, verdict: String(doc['overall'] ?? ''), blockers: countLzFitBlockers(doc['items']) });
      } catch { /* one unreadable fit file never drops the others */ }
    }
  };
  try {
    const pointer = join(wspDir, 'latest-landing-zone-catalog.txt');
    if (existsSync(pointer)) {
      const runDir = join(wspDir, readFileSync(pointer, 'utf-8').trim());
      if (existsSync(runDir)) {
        collect(runDir, readdirSync(runDir).filter((n) => n.startsWith('lz-catalogue-fit-') && n.endsWith('.yaml')).sort());
      }
    }
  } catch { /* fall through to the application run */ }
  if (appRun) {
    const runDir = join(wspDir, appRun);
    if (existsSync(runDir)) collect(runDir, listLzCatalogueFitFiles(runDir));
  }
  return out.length > 0 ? out : undefined;
}

/**
 * #3822 (Design 120 section 11.2, item 4): the catalogue fits of the app's LZ
 * catalogue run, followed by the observed fits of the application scopes
 * linked to it in the latest landing zone portfolio merge (`confidence: observed`).
 */
function withObservedLzFit(catalogue: PortfolioApp['lz_fit'], portfolio: LzLivePortfolio | null, appId: string): PortfolioApp['lz_fit'] {
  const observed = portfolio ? lzLivePortfolioAppFitEntries(portfolio, appId) : [];
  if (observed.length === 0) return catalogue;
  return [...(catalogue ?? []), ...observed];
}

/** Design 113 section 6.2: project run signals (any shape carrying id/severity)
 *  into the findings fields, using the shared @swao/core counters so the hub
 *  matches the publication. Returns undefined fields when there are no signals. */
function signalFindings(
  signals: ReadonlyArray<{ id: string; severity?: string; derivation?: string }> | null,
): Pick<PortfolioApp, 'findings_by_severity' | 'blocker_count' | 'top_findings'> {
  if (!signals) return {};
  const shaped = signals
    .filter((s) => typeof s.id === 'string' && s.id.length > 0)
    .map((s) => {
      const title = (s.derivation ?? s.id);
      return { id: s.id, severity: s.severity ?? 'unknown', title: title.length > 120 ? `${title.slice(0, 117)}...` : title };
    });
  const bySeverity = countSignalsBySeverity(shaped);
  const top = sortSignalsBySeverity(shaped).slice(0, 3).map((s) => ({ id: s.id, severity: s.severity, title: s.title }));
  return {
    findings_by_severity: Object.keys(bySeverity).length > 0 ? bySeverity : undefined,
    blocker_count: countBlockerSignals(shaped),
    top_findings: top.length > 0 ? top : undefined,
  };
}

/** Design 113 section 6.2: free-form tags from the app `.swao.yml` (`tags`),
 *  carried onto the summary entry. Returns undefined when none are set so the
 *  field stays absent rather than an empty array. */
export function readAppTags(app: Record<string, unknown>): string[] | undefined {
  const raw = app['tags'];
  if (!Array.isArray(raw)) return undefined;
  const tags = raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return tags.length > 0 ? tags : undefined;
}

/**
 * Design 113 section 8: resolve an app's 7R label and its provenance. The analyst
 * override (`disposition.seven_r` in the app `.swao.yml`) wins for either type;
 * otherwise application apps use the synthesis verdict (`synthesis`) and service
 * apps map from TIME (`derived_from_time`). The hub renders the source beside the
 * badge so a derived label is never read as an assessed one.
 * #4287 (D-9): a service synthesis verdict that matches the TIME quadrant
 * (`sevenRMatchesTime`) is kept with source `synthesis`.
 */
export function resolveSevenR(
  type: PortfolioAssessmentType,
  time: TimeQuadrant,
  app: Record<string, unknown>,
  synthesisLabel: string | null,
): { label: string | null; source: SevenRSource | undefined; synthesis?: string } {
  const disp = app['disposition'];
  const override = disp && typeof disp === 'object' ? (disp as Record<string, unknown>)['seven_r'] : undefined;
  if (typeof override === 'string' && override.trim().length > 0) {
    return { label: override.trim(), source: 'analyst' };
  }
  if (type === 'application') {
    return synthesisLabel ? { label: synthesisLabel, source: 'synthesis' } : { label: null, source: undefined };
  }
  // #4287 (D-9): service apps go through the 7R to TIME matching; a synthesis
  // verdict that matches TIME is kept, otherwise the TIME default with the
  // replaced synthesis verdict recorded.
  const v = resolveSevenRVerdict({ time, synthesis: synthesisLabel });
  return v.synthesis ? { label: v.label, source: v.source, synthesis: v.synthesis } : { label: v.label, source: v.source };
}

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
export function gatherEvidence(workspacePath: string, appId: string, now: Date): { evidence: ApmEvidence; run: string | null; synthesisSevenR: string | null } {
  const appDir = join(workspacePath, 'apps', appId);
  let app: Record<string, any> = {};
  try { app = (load(readFileSync(join(appDir, '.swao.yml'), 'utf-8')) ?? {}) as Record<string, any>; } catch { /* empty */ }
  const research = join(appDir, 'wsp', 'inputs', 'research');
  const cveStub = readStub(join(research, 'cve-summary.md'))?.front as Record<string, any> | undefined;
  const eolStub = readStub(join(research, 'eol-status.md'))?.front as Record<string, any> | undefined;
  const vtStub = readStub(join(research, 'virustotal.md'))?.front as Record<string, any> | undefined;

  let run: string | null = null;
  let runSignals: ApmSignal[] | null = null;
  // #4287: the synthesis verdict of the run (the model's own label, before the matching).
  let synthesisSevenR: string | null = null;
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
          const doc = load(readFileSync(join(passesDir, f), 'utf-8')) as { signals?: ApmSignal[]; assessment?: Record<string, unknown> } | null;
          runSignals.push(...(doc?.signals ?? []));
          if (/^\d+-synth\.yaml$/.test(f)) synthesisSevenR = synthesisLabelOf(doc?.assessment);
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
    synthesisSevenR,
  };
}

/** #4287: the model's synthesis verdict from a synth pass assessment (kept in `seven_r_synthesis` once the matching replaced it). */
export function synthesisLabelOf(assessment: Record<string, unknown> | undefined | null): string | null {
  if (!assessment) return null;
  const orig = assessment['seven_r_synthesis'];
  if (typeof orig === 'string' && orig.trim()) return orig.trim();
  const label = assessment['seven_r_label'];
  return typeof label === 'string' && label.trim() ? label.trim() : null;
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

/** #4271: progress of a portfolio summary rebuild, reported once per app. */
export interface PortfolioBuildProgress {
  /** Apps processed so far (all kinds). */
  done: number;
  /** App folders under apps/. */
  total: number;
  /** Service apps served from the row cache so far. */
  cached: number;
}

/**
 * #4412: where a portfolio summary rebuild spent its time and why rows were
 * recomputed, for the `portfolio_summary` complete event. `phases_ms` holds the
 * wall clock of each step: setup (framework, landing zone merge, cache read),
 * discover_kinds, service_rows, application_rows, integration_graph, waves,
 * vendors and write.
 */
export interface PortfolioBuildStats {
  /** warm: the cached evidence applied; cold: it did not (see cache_miss_reason). */
  cache: 'warm' | 'cold' | 'off';
  cache_miss_reason?: PortfolioCacheMissReason;
  /** #4412: service apps scored from cached evidence (every row is re-scored on every rebuild). */
  service_rows_cached: number;
  /** #4412: service apps whose evidence was read from their files. */
  service_rows_computed: number;
  /** Service apps read again by cause: no cached evidence, or the first changed input of the fingerprint. */
  rows_recomputed_by: Record<string, number>;
  application_apps: number;
  /** The slowest application app row (application rows are not cached). */
  slowest_application?: { app: string; ms: number };
  phases_ms: Record<string, number>;
  /**
   * #4412: the wall clock of the parts of `setup` (framework, lz_portfolio,
   * cache_key, cache_read) and `write` (summary_parse, apm_scores, row_cache,
   * summary_file, integration_graph, wave_reports), so the next run names the
   * slow file of a long setup or write (owner run 2026-11-15: 9.8 s and 18.4 s).
   */
  steps_ms: Record<string, number>;
  /** #4412: bytes of the row cache read at setup and of the files written (row_cache, summary_file). */
  bytes: Record<string, number>;
}

export interface BuildPortfolioSummaryOptions {
  now?: Date;
  framework?: ApmFramework;
  write?: boolean;
  catalogue?: InfraCatalogue;
  /**
   * #4288: the app whose latest service run receives a fresh `apm-score.json`
   * (the run that just finished). Earlier run folders are never rewritten:
   * for every other app only a missing `apm-score.json` is created.
   */
  apmScoreFor?: string;
  /** #4271: called after each app with the running counts. */
  onProgress?: (p: PortfolioBuildProgress) => void;
  /** #4271: use the per-app row cache (default true; read always, written when `write`). */
  cache?: boolean;
  /** #4412: called when a step of the rebuild ends, with its wall clock. */
  onPhase?: (phase: string, durationMs: number) => void;
  /**
   * #4412: called when a cross-app step (PORTFOLIO_CROSS_APP_PHASES) begins, so
   * a long step after the per-app loop has a start line, not only a complete line.
   */
  onPhaseStart?: (phase: string) => void;
  /** #4412: called once at the end with the timing and cache statistics. */
  onStats?: (s: PortfolioBuildStats) => void;
  /** Injected for tests; defaults to Date.now. */
  clock?: () => number;
}

/**
 * #4412: the file reads of one service app's row (the cold path of the
 * evidence cache): `.swao.yml`, research stubs, binary analysis, the latest
 * run's passes, manifest and plan. Signals keep only the fields the rules and
 * the findings read, so the cache stays compact.
 */
export function gatherServiceAppInputs(workspacePath: string, appId: string): ServiceAppInputs {
  const { evidence, run, synthesisSevenR } = gatherEvidence(workspacePath, appId, new Date(0));
  const { now: _now, ...rest } = evidence;
  const signal = (s: ApmSignal): ApmSignal => ({ id: s.id, derivation: s.derivation, ...(s.severity !== undefined ? { severity: s.severity } : {}), ...(s.outcome !== undefined ? { outcome: s.outcome } : {}) });
  return {
    evidence: {
      ...rest,
      runSignals: rest.runSignals ? rest.runSignals.map(signal) : null,
      ...(rest.binarySignals !== undefined ? { binarySignals: rest.binarySignals ? rest.binarySignals.map((s) => ({ code: s.code, ...(s.severity !== undefined ? { severity: s.severity } : {}) })) : null } : {}),
    },
    run,
    synthesisSevenR,
    provenance: readRunProvenance(workspacePath, appId, run),
    plan: readPlanDerivedFields(workspacePath, appId, run),
  };
}

/** One service app's row, computed from its files (no cache). */
function computeServiceRow(workspacePath: string, appId: string, appName: string | null, fw: ApmFramework, now: Date): { entry: PortfolioApp; controls: ControlScore[]; app: Record<string, any> } {
  return scoreServiceAppInputs(gatherServiceAppInputs(workspacePath, appId), appId, appName, fw, now);
}

/**
 * #4412: one service app's row from its gathered inputs: score, TIME, 7R and
 * findings with the current framework and date. Pure (no file access), so every
 * rebuild re-scores every app from the cached evidence.
 */
export function scoreServiceAppInputs(inputs: ServiceAppInputs, appId: string, appName: string | null, fw: ApmFramework, now: Date): { entry: PortfolioApp; controls: ControlScore[]; app: Record<string, any> } {
  const evidence: ApmEvidence = { ...inputs.evidence, now };
  const { run, synthesisSevenR } = inputs;
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
  return {
    app,
    controls: score.controls,
    entry: {
      id: appId,
      name: appName,
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
      // Design 113 section 8, #4287 (D-9): the 7R to TIME matching decides between the
      // synthesis verdict and the TIME default; a replaced verdict stays visible.
      ...(() => { const sr = resolveSevenR('service', time.quadrant, app, synthesisSevenR); return { seven_r_label: sr.label, seven_r_source: sr.source, ...(sr.synthesis ? { seven_r_synthesis: sr.synthesis } : {}) }; })(),
      // Design 113 section 6.2: tags, findings from the service run signals, run provenance.
      tags: readAppTags(app),
      ...signalFindings(evidence.runSignals),
      ...inputs.provenance,
      ...inputs.plan,
    },
  };
}

/**
 * #4287 (D-9): align the synthesis pass of a finished service run with the 7R to
 * TIME matching, before wsp.yaml and wsp-plan.yaml are derived from it, so the
 * synthesis pass, wsp.yaml, apm-score.json, portfolio-summary.json and the
 * publications carry one verdict. Computes the app's TIME exactly as the
 * portfolio summary does (the latest-service pointer already names this run),
 * resolves the verdict with `resolveSevenR`, and rewrites
 * `passes/<nn>-synth.yaml` when needed: `seven_r_label` becomes the resolved
 * label, `seven_r_source` and `time_quadrant` are recorded, and a replaced model
 * verdict is kept as `seven_r_synthesis` with `seven_r_reason`. Returns null when
 * the run has no synthesis pass file.
 */
export function alignServiceRunSevenR(
  workspacePath: string,
  appId: string,
  runDir: string,
  opts: { now?: Date; framework?: ApmFramework } = {},
): { label: string | null; source: SevenRSource | undefined; synthesis: string | null; time: TimeQuadrant; changed: boolean } | null {
  const passesDir = join(runDir, 'passes');
  let file: string | undefined;
  try { file = readdirSync(passesDir).find((n) => /^\d+-synth\.yaml$/.test(n)); } catch { return null; }
  if (!file) return null;
  const path = join(passesDir, file);
  const doc = load(readFileSync(path, 'utf-8')) as { assessment?: Record<string, unknown> } | null;
  if (!doc || typeof doc !== 'object') return null;
  const assessment = (doc.assessment ?? {}) as Record<string, unknown>;
  const now = opts.now ?? new Date();
  const fw = opts.framework ?? loadApmFramework({ workspacePath });
  const name = (() => { try { const y = load(readFileSync(join(workspacePath, 'apps', appId, '.swao.yml'), 'utf-8')) as Record<string, unknown> | null; return typeof y?.['app_name'] === 'string' ? y['app_name'] : null; } catch { return null; } })();
  const row = computeServiceRow(workspacePath, appId, name, fw, now);
  const time = row.entry.time_quadrant;
  const synthesis = synthesisLabelOf(assessment);
  const label = row.entry.seven_r_label ?? null;
  const source = row.entry.seven_r_source;
  const replaced = row.entry.seven_r_synthesis ?? null;
  const next: Record<string, unknown> = { ...assessment, seven_r_label: label, seven_r_source: source, time_quadrant: time };
  if (replaced) {
    next['seven_r_synthesis'] = replaced;
    next['seven_r_reason'] = resolveSevenRVerdict({ time, synthesis: replaced }).reason;
  } else {
    delete next['seven_r_synthesis'];
    delete next['seven_r_reason'];
  }
  const changed = JSON.stringify(next) !== JSON.stringify(assessment);
  if (changed) writeFileSync(path, dump({ ...doc, assessment: next }, { lineWidth: -1 }), 'utf-8');
  return { label, source, synthesis, time, changed };
}

/** #4271: the kind of every app folder, re-reading a `.swao.yml` only when its stat signature changed. */
function discoverAppKinds(workspacePath: string, cache: PortfolioRowCache): Array<{ appId: string; kind: CachedAppKind; name: string | null }> {
  const appsDir = join(workspacePath, 'apps');
  let ids: string[] = [];
  try { ids = readdirSync(appsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return []; }
  const kinds: PortfolioRowCache['kinds'] = {};
  const out: Array<{ appId: string; kind: CachedAppKind; name: string | null }> = [];
  for (const appId of ids) {
    const yml = join(appsDir, appId, '.swao.yml');
    const sig = statSig(yml);
    let k = cache.kinds[appId];
    if (!k || k.sig !== sig) {
      let doc: Record<string, any> | null = null;
      if (sig !== '-') {
        try { doc = (load(readFileSync(yml, 'utf-8')) ?? {}) as Record<string, any>; } catch { doc = null; }
      }
      const kind: CachedAppKind = doc && doc['assessment']?.['type'] === 'service' ? 'service' : isApplicationAppConfig(doc) ? 'application' : 'other';
      const rawName = doc?.['app_name'];
      k = { sig, kind, name: typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : null };
    }
    kinds[appId] = k;
    out.push({ appId, kind: k.kind, name: k.name });
  }
  cache.kinds = kinds;
  return out;
}

/** #4412: the steps of the rebuild in order (the names of `onPhase` and `phases_ms`). */
export const PORTFOLIO_PHASES = ['setup', 'discover_kinds', 'service_rows', 'application_rows', 'integration_graph', 'waves', 'vendors', 'write'] as const;
/** #4412: the steps after the per-app loop; each one reports its start through `onPhaseStart`. */
export const PORTFOLIO_CROSS_APP_PHASES: readonly string[] = ['integration_graph', 'waves', 'vendors', 'write'];

/**
 * Build `wsp/portfolio-summary.json` and write per-run `apm-score.json` for service apps.
 * #3280 (Design 103 §22): the combined portfolio view; application apps of the same
 * workspace are listed with `assessment_type: application`, scored from their latest
 * application run only, and take part in TIME, the wave plan, the integration graph
 * and vendor consolidation. No apm-score.json is written into application runs.
 * #4271: service rows come from the per-app row cache (summary-cache.ts) while their
 * inputs are unchanged. #4288: only the `apmScoreFor` run gets a fresh apm-score.json.
 */
export function buildPortfolioSummary(workspacePath: string, opts: BuildPortfolioSummaryOptions = {}): PortfolioSummary {
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? Date.now;
  // #4412: the wall clock of each step, so a long silence in the log has a name.
  const phasesMs: Record<string, number> = {};
  let phaseStart = clock();
  const endPhase = (name: string): void => {
    const t = clock();
    phasesMs[name] = t - phaseStart;
    phaseStart = t;
    opts.onPhase?.(name, phasesMs[name]!);
    const next = PORTFOLIO_PHASES[PORTFOLIO_PHASES.indexOf(name as (typeof PORTFOLIO_PHASES)[number]) + 1];
    if (next && PORTFOLIO_CROSS_APP_PHASES.includes(next)) opts.onPhaseStart?.(next);
  };
  const write = opts.write !== false;
  const useCache = opts.cache !== false;
  // #4412: sub-steps of setup and write, on the stats of the complete event.
  const stepsMs: Record<string, number> = {};
  const bytes: Record<string, number> = {};
  const timed = <T>(name: string, fn: () => T): T => {
    const t0 = clock();
    try { return fn(); } finally { stepsMs[name] = (stepsMs[name] ?? 0) + (clock() - t0); }
  };
  const fw = timed('framework', () => opts.framework ?? loadApmFramework({ workspacePath }));
  const rows: Array<{ entry: PortfolioApp; controls: ControlScore[]; type: PortfolioAssessmentType; app: CrossAppFields }> = [];
  // #3584 / #3822: the latest landing zone portfolio merge (landing_zones[] and the observed app fits).
  const lzPortfolio = timed('lz_portfolio', () => readLatestLzLivePortfolio(workspacePath));
  // #4271: per-app row cache; a cold or foreign-key cache recomputes every service row once.
  const key = timed('cache_key', () => portfolioCacheKey());
  const read = useCache ? timed('cache_read', () => readPortfolioRowCacheDetailed(workspacePath, key)) : null;
  if (read?.bytes !== undefined) bytes['row_cache_read'] = read.bytes;
  const cache: PortfolioRowCache = read ? read.cache : { version: PORTFOLIO_ROW_CACHE_VERSION, key, kinds: {}, rows: {} };
  endPhase('setup');
  const discovered = discoverAppKinds(workspacePath, cache);
  endPhase('discover_kinds');
  const total = discovered.length;
  const nextRows: PortfolioRowCache['rows'] = {};
  const applicationApps: Array<{ appId: string; appName: string | null }> = [];
  let done = 0;
  let cachedCount = 0;
  let computedCount = 0;
  const recomputedBy: Record<string, number> = {};
  const tick = () => { done += 1; opts.onProgress?.({ done, total, cached: cachedCount }); };
  for (const a of discovered) {
    if (a.kind === 'application') { applicationApps.push({ appId: a.appId, appName: a.name }); continue; }
    if (a.kind !== 'service') { tick(); continue; }
    // #4412: the evidence is cached per app by its inputs fingerprint; the row is re-scored every time.
    const hit = cache.rows[a.appId];
    const fpNow = hit?.inputs ? serviceAppFingerprint(workspacePath, a.appId, hit.inputs.run ?? null) : null;
    let inputs: ServiceAppInputs;
    if (hit?.inputs && hit.fp === fpNow) {
      cachedCount += 1;
      nextRows[a.appId] = hit;
      inputs = hit.inputs;
    } else {
      // #4412: why this app's evidence is read again (no cached evidence, or the first changed input).
      const cause = !hit?.inputs ? 'no_row' : `changed:${fingerprintDifference(hit.fp, fpNow ?? '') ?? 'unknown'}`;
      recomputedBy[cause] = (recomputedBy[cause] ?? 0) + 1;
      computedCount += 1;
      inputs = gatherServiceAppInputs(workspacePath, a.appId);
      nextRows[a.appId] = { fp: serviceAppFingerprint(workspacePath, a.appId, inputs.run), inputs };
    }
    const r = scoreServiceAppInputs(inputs, a.appId, a.name, fw, now);
    rows.push({ entry: r.entry, controls: r.controls, type: 'service', app: crossAppFields(r.app) });
    tick();
  }
  cache.rows = nextRows;
  endPhase('service_rows');
  let slowestApplication: { app: string; ms: number } | undefined;

  // #3280 (Design 103 §22): application apps, scored from their latest usable application run.
  for (const a of applicationApps) {
    const appStart = clock();
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
      app: crossAppFields(app),
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
        // Design 113 section 8: application apps carry the synthesis 7R verdict;
        // the analyst override (disposition.seven_r) wins for either type.
        ...(() => { const sr = resolveSevenR('application', time.quadrant, app, ae.sevenR); return { seven_r_label: sr.label, seven_r_source: sr.source }; })(),
        // Design 113 section 6.2: application-only readiness scores (0..1) and tags.
        coverage_score: ae.coverageScore,
        cloud_native_score: ae.cloudNativeScore,
        portability_score: ae.portability,
        confidence: ae.confidence,
        tags: readAppTags(app),
        // Design 113 section 6.2: findings mirror the publication summary.
        // blocker_count = critical + high by severity (same as the extractor's
        // countBlockerSignals, derived from the shared signal_counts).
        findings_by_severity: ae.findingsBySeverity ?? undefined,
        blocker_count: ae.findingsBySeverity
          ? (ae.findingsBySeverity['critical'] ?? 0) + (ae.findingsBySeverity['high'] ?? 0)
          : undefined,
        top_findings: ae.topFindings.length > 0 ? ae.topFindings : undefined,
        // Design 113 section 6.2: run provenance + per-framework compliance + risk + LZ fit.
        ...readRunProvenance(workspacePath, a.appId, run),
        ...readPlanDerivedFields(workspacePath, a.appId, run),
        lz_fit: withObservedLzFit(readLzFit(workspacePath, a.appId, run), lzPortfolio, a.appId),
        // #3873: catalogue or live LZ source of the app run (Design 123 section 8.4).
        ...(() => { const src = readRunLzSource(workspacePath, a.appId, run); return src ? { lz_source: src } : {}; })(),
        // #3405: Pass 26 code-health KPIs (Design 117 section 7).
        ...(ae.codeHealth ? { code_health: ae.codeHealth } : {}),
      },
    });
    const appMs = clock() - appStart;
    if (!slowestApplication || appMs > slowestApplication.ms) slowestApplication = { app: a.appId, ms: appMs };
    tick();
  }
  // One list for both types, in ID order (service-only workspaces keep their order).
  endPhase('application_rows');
  rows.sort((x, y) => x.entry.id.localeCompare(y.entry.id));

  // Design 103 §21.4: integration graph and blast radius.
  const graph = buildIntegrationGraph(rows.map((r) => ({
    id: r.entry.id,
    integrations: Array.isArray(r.app['integrations']) ? (r.app['integrations'] as string[]) : [],
    clusterMembers: Array.isArray(r.app['cluster_members']) ? (r.app['cluster_members'] as string[]) : null,
  })), now);
  for (const r of rows) {
    r.entry.fan_in = graph.fan_in[r.entry.id] ?? 0;
    const b = blastRadius(r.entry.fan_in, r.entry.time_quadrant, r.entry.eol_signal ?? null);
    r.entry.blast_radius_score = b.score;
    r.entry.blast_radius_tier = b.tier;
  }

  endPhase('integration_graph');
  // Design 103 §21.3: migration waves.
  const regs = (r: (typeof rows)[number]) => (Array.isArray(r.app['data']?.['regulatory']) ? (r.app['data']['regulatory'] as unknown[]).map(String) : []);
  const plan = planWaves(rows.map((r) => ({
    id: r.entry.id,
    time: r.entry.time_quadrant,
    eolSignal: r.entry.eol_signal ?? null,
    healthData: r.app['data']?.['health_data'] === true,
    gdprArt9: r.app['data']?.['gdpr_art9'] === true,
    fanIn: r.entry.fan_in ?? 0,
    blastScore: r.entry.blast_radius_score ?? 0,
    infraCategory: r.entry.infra_category,
    isCluster: r.app['cluster'] === true,
    mdr: regs(r).some((x) => x.toUpperCase() === 'MDR'),
  })), graph);
  for (const r of rows) {
    r.entry.wave = plan.byApp[r.entry.id]!.wave;
    r.entry.effort_days = plan.byApp[r.entry.id]!.effort_days;
  }

  endPhase('waves');
  // Design 103 §21.5: vendor consolidation.
  let catalogue = opts.catalogue;
  try { catalogue ??= loadInfraCatalogue({ workspacePath }); } catch { catalogue = { services: [], sites: [], sources: [] }; }
  const vendorName = (r: (typeof rows)[number]) => (typeof r.app['vendor']?.['name'] === 'string' ? (r.app['vendor']['name'] as string) : null);
  for (const r of rows) r.entry.vendor_canonical_name = canonicalVendor(vendorName(r), catalogue)?.vendor ?? null;
  const vendors = vendorConsolidation(rows.map((r) => ({
    id: r.entry.id,
    vendorName: vendorName(r),
    infraCategory: r.entry.infra_category,
    time: r.entry.time_quadrant,
    eolSignal: r.entry.eol_signal ?? null,
  })), catalogue);
  endPhase('vendors');

  const apps = rows.map((r) => r.entry);
  // #3196 / #3241: the headline figures cover assessed apps only. The portfolio
  // risk is the mean over assessed apps whose TIME decision rests on evidence;
  // the TIME distribution counts assessed apps. Unassessed apps keep their
  // scaffold-derived per-app scores (used for ranking and waves) but are
  // labelled evidence: not_assessed and stay out of both figures.
  // #3280: assessed apps of both types count; by_assessment_type splits the figures per type
  // and is only written when the workspace holds application apps (service-only output unchanged).
  const parseStart = clock();
  const all = headline(apps);
  const hasApplications = rows.some((r) => r.type === 'application');
  // #3584 (Design 120 section 11.3): landing_zones[] from the latest portfolio
  // merge (`swao assess --portfolio --type landing-zone-live`), read on every
  // rebuild so app and service assessments keep the block.
  const landingZones = lzPortfolio ? lzLivePortfolioSummaryEntries(lzPortfolio) : [];
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
    ...(landingZones.length > 0 ? { landing_zones: landingZones } : {}),
  });
  stepsMs['summary_parse'] = clock() - parseStart;

  if (write) {
    const apmStart = clock();
    for (const r of rows) {
      if (r.type !== 'service' || !r.entry.run) continue;
      // A stale latest-service.txt can point at a deleted run; skip rather than fail the summary.
      const runDir = join(workspacePath, 'apps', r.entry.id, 'wsp', r.entry.run);
      if (!existsSync(runDir)) continue;
      // #4288: a finished run folder is the evidence record of that run. Only the
      // run that just finished (apmScoreFor) gets a fresh apm-score.json; every
      // other run keeps its file untouched, and only a missing file is created.
      const target = join(runDir, 'apm-score.json');
      if (r.entry.id !== opts.apmScoreFor && existsSync(target)) continue;
      writeFileSync(target, `${JSON.stringify({ ...r.entry, controls: r.controls }, null, 2)}\n`, 'utf-8');
    }
    stepsMs['apm_scores'] = clock() - apmStart;
    if (useCache) {
      const written = timed('row_cache', () => writePortfolioRowCache(workspacePath, cache));
      if (written !== null) bytes['row_cache'] = written;
    }
    mkdirSync(join(workspacePath, 'wsp', 'inputs'), { recursive: true });
    mkdirSync(join(workspacePath, 'wsp', 'reports'), { recursive: true });
    timed('summary_file', () => {
      const text = `${JSON.stringify(summary, null, 2)}\n`;
      bytes['summary_file'] = Buffer.byteLength(text, 'utf-8');
      writeFileSync(join(workspacePath, 'wsp', 'portfolio-summary.json'), text, 'utf-8');
    });
    timed('integration_graph', () => writeFileSync(join(workspacePath, 'wsp', 'inputs', 'integration-graph.json'), `${JSON.stringify(graph, null, 2)}\n`, 'utf-8'));
    const wavesStart = clock();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const report = renderWaveReport(plan, apps, now.toISOString().slice(0, 10));
    writeFileSync(join(workspacePath, 'wsp', 'reports', `migration-waves-${date}.md`), report.md, 'utf-8');
    writeFileSync(join(workspacePath, 'wsp', 'reports', `migration-waves-${date}.csv`), report.csv, 'utf-8');
    stepsMs['wave_reports'] = clock() - wavesStart;
  }
  endPhase('write');
  opts.onStats?.({
    cache: !read ? 'off' : read.miss === null ? 'warm' : 'cold',
    ...(read?.miss ? { cache_miss_reason: read.miss } : {}),
    service_rows_cached: cachedCount,
    service_rows_computed: computedCount,
    rows_recomputed_by: recomputedBy,
    application_apps: applicationApps.length,
    ...(slowestApplication ? { slowest_application: slowestApplication } : {}),
    phases_ms: { ...phasesMs },
    steps_ms: stepsMs,
    bytes,
  });
  return summary;
}
