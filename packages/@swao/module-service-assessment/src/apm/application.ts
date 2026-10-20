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
 * Application apps in the combined portfolio view (#3280, Design 103 §22).
 *
 * An application app (assessment.type absent, `application` or the deprecated
 * `source-code`) is scored only with the evidence its latest usable application
 * run records; the service rules are never applied to it, because they read
 * intake fields and research stubs an application app does not have and some of
 * them score an absent field (G-07: no invented evidence). The application rules
 * below each name the WSP artefact they read and return null when it is absent.
 *
 * The TIME quadrant comes from the 7R verdict through SEVEN_R_TIME (Design 103
 * §22.3), with two overrides that mirror the service rules: a decommissioned
 * operational status (Eliminate) and a runtime past end of life with packages
 * carrying high or critical CVEs (Migrate-Critical).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { isRunUsable, readRunStatus, type TimeQuadrant } from '@swao/core';
import { APM_DOMAINS, type ApmDomain, type ApmFramework } from './framework.js';

type Rec = Record<string, any>;

/** `assessment.type` values that make an app an application app (absent counts too). */
export const APPLICATION_TYPE_VALUES: readonly string[] = ['application', 'source-code'];

export interface ApplicationAppInput { appId: string; appName: string | null }

const readYaml = (p: string): Rec | null => {
  try {
    const v = load(readFileSync(p, 'utf-8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
  } catch { return null; }
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** True when an app `.swao.yml` declares (or defaults to) the application assessment type. */
export function isApplicationAppConfig(doc: Rec | null): boolean {
  if (!doc) return false;
  const t = doc['assessment']?.['type'];
  return t === undefined || t === null || t === '' || (typeof t === 'string' && APPLICATION_TYPE_VALUES.includes(t));
}

/** Application apps under `apps/`, sorted by ID. Service, landing zone, LLM, audit and hybrid apps are left out. */
export function discoverApplicationApps(workspacePath: string): ApplicationAppInput[] {
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) return [];
  const out: ApplicationAppInput[] = [];
  for (const id of readdirSync(appsDir).sort()) {
    try { if (!statSync(join(appsDir, id)).isDirectory()) continue; } catch { continue; }
    const doc = readYaml(join(appsDir, id, '.swao.yml'));
    if (!isApplicationAppConfig(doc)) continue;
    out.push({ appId: id, appName: str(doc!['app_name']) });
  }
  return out.sort((a, b) => a.appId.localeCompare(b.appId));
}

/** An application run: usable (#3283), has a `wsp.yaml` spine, and is not marked as another assessment type. */
function isApplicationRun(dir: string): boolean {
  if (!existsSync(dir) || !existsSync(join(dir, 'wsp.yaml')) || !isRunUsable(dir)) return false;
  const s = readRunStatus(dir);
  return !s || s.assessment_type === 'application';
}

/**
 * Latest usable application run: `latest-application.txt`, then `latest.txt`
 * (which can name a landing zone run, so it must pass the same check), then the
 * newest run under `runs/` that qualifies. Returns `runs/<id>` relative to `wsp/`.
 */
export function resolveApplicationRun(workspacePath: string, appId: string): { runDir: string; run: string } | null {
  const wspDir = join(workspacePath, 'apps', appId, 'wsp');
  for (const pointer of ['latest-application.txt', 'latest.txt']) {
    let rel = '';
    try { rel = readFileSync(join(wspDir, pointer), 'utf-8').trim().replace(/\\/g, '/'); } catch { continue; }
    if (!rel) continue;
    const dir = join(wspDir, rel);
    if (isApplicationRun(dir)) return { runDir: dir, run: rel.startsWith('runs/') ? rel : `runs/${rel}` };
  }
  const runsDir = join(wspDir, 'runs');
  if (!existsSync(runsDir)) return null;
  for (const id of readdirSync(runsDir).sort().reverse()) {
    if (isApplicationRun(join(runsDir, id))) return { runDir: join(runsDir, id), run: `runs/${id}` };
  }
  return null;
}

export type RuntimeEol = 'active_lts' | 'maintenance_lts' | 'eol';

/** Everything the application rules read, from one application run plus the app `.swao.yml`. */
export interface ApplicationEvidence {
  app: Rec;
  sevenR: string | null;
  modernizationPosition: string | null;
  /** `wsp.yaml` overall.portability_score (0-1). */
  portability: number | null;
  /** Pass 01 / Pass 05 `assessment.node_eol_status`; null when unknown or not recorded. */
  runtimeEol: RuntimeEol | null;
  /** True when the Pass 05 dependency CVE lookup completed. */
  dependencyCveLookup: boolean;
  /** Pass 05 `assessment.critical_cves_found`: packages with high or critical CVEs in the spot check (not a CVE count). */
  vulnerablePackages: number | null;
  /** Negative critical and high findings over all pass files; null when the run has no pass files. */
  findings: { critical: number; high: number } | null;
  /** Control outcomes from `wsp-plan.yaml` compliance.regimes; null when the plan has none. */
  compliance: { pass: number; partial: number; gap: number } | null;
  /** `wsp/latest-lz-primary.yaml` landing_zone.verdict. */
  lzVerdict: string | null;
}

export function gatherApplicationEvidence(workspacePath: string, appId: string): { evidence: ApplicationEvidence; run: string | null } {
  const appDir = join(workspacePath, 'apps', appId);
  const app = readYaml(join(appDir, '.swao.yml')) ?? {};
  const evidence: ApplicationEvidence = {
    app, sevenR: null, modernizationPosition: null, portability: null, runtimeEol: null,
    dependencyCveLookup: false, vulnerablePackages: null, findings: null, compliance: null,
    lzVerdict: str(readYaml(join(appDir, 'wsp', 'latest-lz-primary.yaml'))?.['landing_zone']?.['verdict']),
  };
  const resolved = resolveApplicationRun(workspacePath, appId);
  if (!resolved) return { evidence, run: null };
  const { runDir } = resolved;

  const overall = readYaml(join(runDir, 'wsp.yaml'))?.['overall'] ?? {};
  evidence.sevenR = str(overall['seven_r_label']);
  evidence.modernizationPosition = str(overall['modernization_position']);
  const port = overall['portability_score'];
  evidence.portability = typeof port === 'number' && port >= 0 && port <= 1 ? port : null;

  const passesDir = join(runDir, 'passes');
  if (existsSync(passesDir)) {
    const findings = { critical: 0, high: 0 };
    let passFiles = 0;
    for (const f of readdirSync(passesDir).filter((n) => n.endsWith('.yaml')).sort()) {
      const doc = readYaml(join(passesDir, f));
      if (!doc) continue;
      passFiles += 1;
      const a = doc['assessment'] ?? {};
      const eolStatus = a['node_eol_status'];
      if (eolStatus === 'active_lts' || eolStatus === 'maintenance_lts' || eolStatus === 'eol') evidence.runtimeEol = eolStatus;
      if (a['cve_lookup'] === 'completed') {
        evidence.dependencyCveLookup = true;
        if (typeof a['critical_cves_found'] === 'number') evidence.vulnerablePackages = a['critical_cves_found'];
      }
      for (const s of Array.isArray(doc['signals']) ? (doc['signals'] as Rec[]) : []) {
        if (s?.['outcome'] !== 'negative') continue;
        if (s['severity'] === 'critical') findings.critical += 1;
        else if (s['severity'] === 'high') findings.high += 1;
      }
    }
    if (passFiles > 0) evidence.findings = findings;
  }

  const regimes = readYaml(join(runDir, 'wsp-plan.yaml'))?.['compliance']?.['regimes'];
  if (Array.isArray(regimes)) {
    const c = { pass: 0, partial: 0, gap: 0 };
    for (const r of regimes as Rec[]) {
      for (const ctl of Array.isArray(r?.['controls']) ? (r['controls'] as Rec[]) : []) {
        const o = String(ctl?.['outcome'] ?? '').toUpperCase();
        if (o === 'PASS') c.pass += 1;
        else if (o === 'PARTIAL') c.partial += 1;
        else if (o === 'GAP' || o === 'FAIL') c.gap += 1;
      }
    }
    if (c.pass + c.partial + c.gap > 0) evidence.compliance = c;
  }
  return { evidence, run: resolved.run };
}

// ---------------------------------------------------------------- rules (HEALTH scale: 100 = healthy)

export interface ApplicationRule { id: string; domain: ApmDomain; rule: string; score: (e: ApplicationEvidence) => number | null }

const LZ_FIT: Readonly<Record<string, number>> = { READY: 100, READY_WITH_CHANGES: 70, NEEDS_VERIFICATION: 50, BLOCKED: 0, SOVEREIGNTY_BLOCKED: 0 };

/** Design 103 §22.2: the SWAO_APM domains an application run can answer, one named rule per control. */
export const APPLICATION_RULES: readonly ApplicationRule[] = [
  { id: 'APP-TCH-01', domain: 'APM-TCH', rule: 'app_runtime_eol', score: (e) => (e.runtimeEol === 'active_lts' ? 100 : e.runtimeEol === 'maintenance_lts' ? 70 : e.runtimeEol === 'eol' ? 0 : null) },
  {
    id: 'APP-TCH-02', domain: 'APM-TCH', rule: 'app_dependency_cves',
    score: (e) => (!e.dependencyCveLookup || e.vulnerablePackages === null ? null : e.vulnerablePackages === 0 ? 100 : e.vulnerablePackages === 1 ? 40 : 10),
  },
  {
    id: 'APP-SEC-01', domain: 'APM-SEC', rule: 'app_high_findings',
    score: (e) => (!e.findings ? null : e.findings.critical > 0 ? 10 : e.findings.high === 0 ? 100 : e.findings.high <= 2 ? 60 : 30),
  },
  {
    id: 'APP-REG-01', domain: 'APM-REG', rule: 'app_compliance_outcomes',
    score: (e) => {
      const c = e.compliance;
      if (!c) return null;
      return Math.round(((c.pass * 100 + c.partial * 50) / (c.pass + c.partial + c.gap)) * 100) / 100;
    },
  },
  { id: 'APP-MIG-01', domain: 'APM-MIG', rule: 'app_portability', score: (e) => (e.portability === null ? null : Math.round(e.portability * 10000) / 100) },
  { id: 'APP-MIG-02', domain: 'APM-MIG', rule: 'app_lz_fit', score: (e) => (e.lzVerdict && e.lzVerdict in LZ_FIT ? LZ_FIT[e.lzVerdict]! : null) },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Same aggregation as scoreApp: mean of known controls per domain, domain weights from the framework over known domains. */
export function scoreApplicationApp(e: ApplicationEvidence, fw: ApmFramework): {
  domainScores: Record<ApmDomain, number | null>;
  controls: Array<{ id: string; rule: string; score: number | null }>;
  healthScore: number | null;
  riskScore: number | null;
} {
  const controls = APPLICATION_RULES.map((r) => ({ id: r.id, rule: r.rule, score: r.score(e) }));
  const domainScores = {} as Record<ApmDomain, number | null>;
  for (const d of APM_DOMAINS) {
    const known = APPLICATION_RULES.map((r, i) => ({ r, s: controls[i]!.score })).filter((x): x is { r: ApplicationRule; s: number } => x.r.domain === d && x.s !== null);
    domainScores[d] = known.length > 0 ? round2(known.reduce((a, x) => a + x.s, 0) / known.length) : null;
  }
  const weighted = APM_DOMAINS.filter((d) => domainScores[d] !== null && fw.domainWeights[d] > 0);
  const totalWeight = weighted.reduce((a, d) => a + fw.domainWeights[d], 0);
  const healthScore = totalWeight > 0 ? round2(weighted.reduce((a, d) => a + (domainScores[d] as number) * fw.domainWeights[d], 0) / totalWeight) : null;
  return { domainScores, controls, healthScore, riskScore: healthScore === null ? null : round2(100 - healthScore) };
}

// ---------------------------------------------------------------- TIME (Design 103 §22.3)

/** 7R verdict to TIME quadrant. Keys are normalised (lower case, letters only). */
export const SEVEN_R_TIME: Readonly<Record<string, TimeQuadrant>> = {
  retire: 'Eliminate',
  retain: 'Tolerate',
  rehost: 'Migrate',
  relocate: 'Migrate',
  replatform: 'Migrate',
  repurchase: 'Migrate',
  refactor: 'Invest',
  rearchitect: 'Invest',
  rebuild: 'Invest',
};

export function sevenRToTime(label: string | null | undefined): TimeQuadrant | null {
  if (!label) return null;
  return SEVEN_R_TIME[label.toLowerCase().replace(/[^a-z]/g, '')] ?? null;
}

/** Evidence the application TIME decision rests on; `seven_r` missing makes it insufficient on its own. */
export function applicationEvidenceGaps(e: ApplicationEvidence): string[] {
  const gaps: string[] = [];
  if (!sevenRToTime(e.sevenR)) gaps.push('seven_r');
  if (e.runtimeEol === null) gaps.push('end_of_life');
  if (!e.dependencyCveLookup) gaps.push('cve');
  return gaps;
}

export function classifyApplicationTime(e: ApplicationEvidence, assessed: boolean, fw: ApmFramework): { quadrant: TimeQuadrant; reason: string } {
  const r = fw.timeRules;
  const status = e.app['disposition']?.['operational_status'];
  if (typeof status === 'string' && r.eliminate_operational_status.includes(status)) return { quadrant: 'Eliminate', reason: `operational status ${status}` };
  if (!assessed) return { quadrant: 'Tolerate', reason: 'no application assessment run' };
  const mapped = sevenRToTime(e.sevenR);
  if (mapped !== 'Eliminate' && e.runtimeEol === 'eol' && (e.vulnerablePackages ?? 0) >= r.migrate_critical.cve_critical_min) {
    return { quadrant: 'Migrate-Critical', reason: `runtime past end of life and ${e.vulnerablePackages} package(s) with high or critical CVEs` };
  }
  if (mapped) return { quadrant: mapped, reason: `7R verdict ${e.sevenR}` };
  return { quadrant: 'Tolerate', reason: e.sevenR ? `7R verdict ${e.sevenR} has no TIME mapping` : 'no 7R verdict in the application run' };
}

/** BLOCKED / AMBER / GREEN from the runtime end-of-life status (Design 103 §6.2.2 scale). */
export function runtimeEolSignal(e: ApplicationEvidence): 'BLOCKED' | 'AMBER' | 'GREEN' | null {
  return e.runtimeEol === 'eol' ? 'BLOCKED' : e.runtimeEol === 'maintenance_lts' ? 'AMBER' : e.runtimeEol === 'active_lts' ? 'GREEN' : null;
}
