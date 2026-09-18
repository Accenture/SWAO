// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';

export type TraceabilityProbeStatus = 'ok' | 'warn' | 'absent' | 'fail';

export interface TraceabilityCounts {
  signals_total: number;
  signals_with_outcome: number;
  signals_with_rationale: number;            // derivation.length >= 20
  signals_needing_fp: number;                 // severity in medium/high/critical AND outcome=negative
  signals_with_fp: number;                    // of those, with both fp fields populated
  signals_with_chain: number;
  controls_total: number;
  controls_with_outcome: number;
  controls_with_rationale: number;
}

export interface TraceabilityCoverage {
  rationale_coverage: number;                 // 0..1
  fp_consideration_coverage: number;
  chain_coverage: number;
  control_rationale_coverage: number;
}

export interface TraceabilityTargets {
  rationale_coverage_target: number;
  fp_consideration_target: number;
  chain_coverage_target: number;
  control_rationale_target: number;
}

export const DEFAULT_TARGETS: TraceabilityTargets = {
  rationale_coverage_target: 0.95,
  fp_consideration_target: 0.95,
  chain_coverage_target: 0.50,
  control_rationale_target: 0.95,
};

export interface AppTraceabilityResult {
  app_id: string;
  workspace_app_dir: string;
  counts: TraceabilityCounts;
  coverage: TraceabilityCoverage;
  warnings: string[];
}

export interface TraceabilityProbeResult {
  status: TraceabilityProbeStatus;
  targets: TraceabilityTargets;
  apps: AppTraceabilityResult[];
  message: string;
}

interface RawSignal {
  derivation?: string;
  severity?: string;
  outcome?: string;
  false_positive_considered?: boolean;
  false_positive_ruled_out?: string;
  derivation_chain?: unknown[];
}

interface RawControl {
  outcome?: string;
  rationale?: string;
  status?: string;
}

// existsSync guard mirrors star.ts and safeReadYamlMcp: all callers already
// pre-check, but the guard makes the function safe at any future call site
// without requiring the caller to remember to check first (#0826 audit).
function safeReadYaml<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return load(readFileSync(path, 'utf-8')) as T; }
  catch { return null; }
}

function isFpRequired(s: RawSignal): boolean {
  if (s.outcome !== 'negative') return false;
  return s.severity === 'medium' || s.severity === 'high' || s.severity === 'critical';
}

function rationalisedDerivation(d: unknown): boolean {
  return typeof d === 'string' && d.length >= 20;
}

function rationalisedRationale(r: unknown): boolean {
  return typeof r === 'string' && r.length >= 20;
}

/**
 * Compute traceability counts and coverage ratios for a single app
 * workspace. Pure function; pass-yaml + plan paths are taken in.
 */
export function computeAppTraceability(
  appId: string,
  workspaceAppDir: string,
): AppTraceabilityResult | null {
  const wspDir = join(workspaceAppDir, 'wsp');
  if (!existsSync(wspDir)) return null;

  // Resolve passes directory; honour latest.txt -> runs/<ts>/passes when present.
  let passesDir = join(wspDir, 'passes');
  let planPath = join(wspDir, 'wsp-plan.yaml');
  const latestFile = join(wspDir, 'latest.txt');
  if (existsSync(latestFile)) {
    try {
      const latestPath = readFileSync(latestFile, 'utf-8').trim();
      const runDir = join(wspDir, latestPath);
      const runPasses = join(runDir, 'passes');
      if (existsSync(runPasses)) passesDir = runPasses;
      const runPlan = join(runDir, 'wsp-plan.yaml');
      if (existsSync(runPlan)) planPath = runPlan;
    } catch { /* keep defaults */ }
  }

  // #1047: if no passes/ directory exists the app has not been assessed yet;
  // return null so the probe does not count this as a vacuous OK.
  if (!existsSync(passesDir)) return null;

  const counts: TraceabilityCounts = {
    signals_total: 0,
    signals_with_outcome: 0,
    signals_with_rationale: 0,
    signals_needing_fp: 0,
    signals_with_fp: 0,
    signals_with_chain: 0,
    controls_total: 0,
    controls_with_outcome: 0,
    controls_with_rationale: 0,
  };

  if (existsSync(passesDir)) {
    const files = readdirSync(passesDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    for (const file of files) {
      const parsed = safeReadYaml<{ signals?: RawSignal[] }>(join(passesDir, file));
      if (!parsed?.signals) continue;
      for (const s of parsed.signals) {
        counts.signals_total += 1;
        if (s.outcome) counts.signals_with_outcome += 1;
        if (rationalisedDerivation(s.derivation)) counts.signals_with_rationale += 1;
        if (Array.isArray(s.derivation_chain) && s.derivation_chain.length >= 1) {
          counts.signals_with_chain += 1;
        }
        if (isFpRequired(s)) {
          counts.signals_needing_fp += 1;
          if (
            s.false_positive_considered === true &&
            typeof s.false_positive_ruled_out === 'string' &&
            s.false_positive_ruled_out.length >= 20
          ) {
            counts.signals_with_fp += 1;
          }
        }
      }
    }
  }

  if (existsSync(planPath)) {
    const plan = safeReadYaml<{ compliance?: { regimes?: Array<{ controls?: RawControl[] }> } }>(planPath);
    const regimes = plan?.compliance?.regimes ?? [];
    for (const regime of regimes) {
      const controls = regime?.controls ?? [];
      for (const c of controls) {
        counts.controls_total += 1;
        if (c.outcome) counts.controls_with_outcome += 1;
        if (rationalisedRationale(c.rationale)) counts.controls_with_rationale += 1;
      }
    }
  }

  const ratio = (num: number, den: number) => (den === 0 ? 1 : num / den);

  const coverage: TraceabilityCoverage = {
    rationale_coverage: ratio(counts.signals_with_rationale, counts.signals_total),
    fp_consideration_coverage: ratio(counts.signals_with_fp, counts.signals_needing_fp),
    chain_coverage: ratio(counts.signals_with_chain, counts.signals_total),
    control_rationale_coverage: ratio(counts.controls_with_rationale, counts.controls_total),
  };

  return {
    app_id: appId,
    workspace_app_dir: workspaceAppDir,
    counts,
    coverage,
    warnings: [],
  };
}

function readTargets(workspacePath: string): TraceabilityTargets {
  const swaoYml = join(workspacePath, '.swao.yml');
  if (!existsSync(swaoYml)) return { ...DEFAULT_TARGETS };
  const raw = safeReadYaml<Record<string, unknown>>(swaoYml);
  const t = (raw?.traceability as Record<string, unknown> | undefined) ?? {};
  const num = (k: string, fallback: number): number => {
    const v = t[k];
    return typeof v === 'number' ? v : fallback;
  };
  return {
    rationale_coverage_target: num('rationale_coverage_target', DEFAULT_TARGETS.rationale_coverage_target),
    fp_consideration_target: num('fp_consideration_target', DEFAULT_TARGETS.fp_consideration_target),
    chain_coverage_target: num('chain_coverage_target', DEFAULT_TARGETS.chain_coverage_target),
    control_rationale_target: num('control_rationale_target', DEFAULT_TARGETS.control_rationale_target),
  };
}

function discoverAppDirs(workspacePath: string): Array<{ appId: string; dir: string }> {
  const apps: Array<{ appId: string; dir: string }> = [];

  // Portfolio mode takes priority over single-app mode. A workspace may have a
  // root wsp/ for portfolio-level events while also having per-app wsp/ under
  // apps/<id>/; treating the root wsp/ as a single-app dir is incorrect (#1701).
  const appsRoot = join(workspacePath, 'apps');
  if (existsSync(appsRoot) && statSync(appsRoot).isDirectory()) {
    for (const name of readdirSync(appsRoot)) {
      const dir = join(appsRoot, name);
      if (statSync(dir).isDirectory() && existsSync(join(dir, 'wsp'))) {
        apps.push({ appId: name, dir });
      }
    }
  }
  if (apps.length > 0) return apps;

  // Single-app mode: the workspace root itself is the app directory.
  if (existsSync(join(workspacePath, 'wsp'))) {
    apps.push({ appId: 'workspace', dir: workspacePath });
  }

  return apps;
}

function checkAgainstTargets(
  result: AppTraceabilityResult,
  targets: TraceabilityTargets,
): void {
  const { coverage } = result;
  if (coverage.rationale_coverage < targets.rationale_coverage_target) {
    result.warnings.push(
      `rationale-coverage ${(coverage.rationale_coverage * 100).toFixed(0)}% below target ${(targets.rationale_coverage_target * 100).toFixed(0)}%`,
    );
  }
  if (coverage.fp_consideration_coverage < targets.fp_consideration_target && result.counts.signals_needing_fp > 0) {
    result.warnings.push(
      `fp-consideration-coverage ${(coverage.fp_consideration_coverage * 100).toFixed(0)}% below target ${(targets.fp_consideration_target * 100).toFixed(0)}%`,
    );
  }
  if (coverage.chain_coverage < targets.chain_coverage_target) {
    result.warnings.push(
      `chain-coverage ${(coverage.chain_coverage * 100).toFixed(0)}% below target ${(targets.chain_coverage_target * 100).toFixed(0)}%`,
    );
  }
  if (coverage.control_rationale_coverage < targets.control_rationale_target && result.counts.controls_total > 0) {
    result.warnings.push(
      `control-rationale-coverage ${(coverage.control_rationale_coverage * 100).toFixed(0)}% below target ${(targets.control_rationale_target * 100).toFixed(0)}%`,
    );
  }
}

export function buildTraceabilityProbe(workspacePath: string): TraceabilityProbeResult {
  const targets = readTargets(workspacePath);
  const appDirs = discoverAppDirs(workspacePath);
  const apps: AppTraceabilityResult[] = [];

  if (appDirs.length === 0) {
    return {
      status: 'absent',
      targets,
      apps,
      message: 'no app workspaces with wsp/ found',
    };
  }

  for (const { appId, dir } of appDirs) {
    const r = computeAppTraceability(appId, dir);
    if (r) {
      checkAgainstTargets(r, targets);
      apps.push(r);
    }
  }

  if (apps.length === 0) {
    return {
      status: 'absent',
      targets,
      apps,
      message: `${appDirs.length} app(s) found but none have completed assessment runs yet`,
    };
  }

  const totalWarnings = apps.reduce((acc, a) => acc + a.warnings.length, 0);
  // v0.10 window: soft-warn rather than fail.
  const status: TraceabilityProbeStatus = totalWarnings === 0 ? 'ok' : 'warn';
  const message =
    status === 'ok'
      ? `${apps.length} app(s) meet traceability targets`
      : `${apps.length} app(s) checked; ${totalWarnings} target miss(es) (soft-warn during v0.10)`;

  return { status, targets, apps, message };
}
