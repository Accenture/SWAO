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

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';

// Sprint 029 Phase 2 (#0263) -- Doctor [8/8] Scope probe.
//
// Walks every assessed app under <workspace>/apps/*/wsp/runs/<latest>/
// wsp-plan.yaml; reports aggregate coverage ratio. WARN below 0.50.
// INFO if no apps assessed yet (Pass 13 hasn't run).

export type ScopeProbeStatus = 'ok' | 'warn' | 'absent' | 'info';

export interface ScopeProbeResult {
  status: ScopeProbeStatus;
  apps_with_scope: number;
  apps_total: number;
  total_blind_spots: number;
  closed: number;
  partial: number;
  open: number;
  coverage_ratio: number;
  message: string;
}

const WARN_THRESHOLD = 0.5;

interface PlanFile {
  scope_coverage?: {
    total_blind_spots?: number;
    closed?: number;
    partial?: number;
    open?: number;
  };
}

function readScopeFromPlan(planPath: string): PlanFile['scope_coverage'] | null {
  if (!existsSync(planPath)) return null;
  try {
    const parsed = load(readFileSync(planPath, 'utf-8')) as PlanFile | null;
    return parsed?.scope_coverage ?? null;
  } catch { return null; }
}

function resolveLatestPlan(appWspDir: string): string | null {
  const latestFile = join(appWspDir, 'latest.txt');
  if (!existsSync(latestFile)) return null;
  try {
    const rel = readFileSync(latestFile, 'utf-8').trim();
    const candidate = join(appWspDir, rel, 'wsp-plan.yaml');
    return existsSync(candidate) ? candidate : null;
  } catch { return null; }
}

export function buildScopeProbe(workspacePath: string): ScopeProbeResult {
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) {
    return {
      status: 'absent',
      apps_with_scope: 0, apps_total: 0,
      total_blind_spots: 0, closed: 0, partial: 0, open: 0,
      coverage_ratio: 0,
      message: 'No apps/ directory found in workspace.',
    };
  }

  let appsTotal = 0;
  let appsWithScope = 0;
  const totals = { closed: 0, partial: 0, open: 0, total: 0 };

  let entries: string[];
  try { entries = readdirSync(appsDir); }
  catch { return {
    status: 'absent',
    apps_with_scope: 0, apps_total: 0,
    total_blind_spots: 0, closed: 0, partial: 0, open: 0,
    coverage_ratio: 0,
    message: `apps/ directory unreadable.`,
  }; }

  for (const appId of entries) {
    if (appId.startsWith('.')) continue;
    const appWspDir = join(appsDir, appId, 'wsp');
    if (!existsSync(appWspDir)) continue;
    appsTotal += 1;
    const planPath = resolveLatestPlan(appWspDir);
    if (!planPath) continue;
    const scope = readScopeFromPlan(planPath);
    if (!scope) continue;
    appsWithScope += 1;
    totals.closed  += scope.closed  ?? 0;
    totals.partial += scope.partial ?? 0;
    totals.open    += scope.open    ?? 0;
    totals.total   += scope.total_blind_spots ?? 0;
  }

  if (appsTotal === 0) {
    return {
      status: 'absent',
      apps_with_scope: 0, apps_total: 0,
      total_blind_spots: 0, closed: 0, partial: 0, open: 0,
      coverage_ratio: 0,
      message: 'No apps under apps/ have a wsp/ directory.',
    };
  }
  if (appsWithScope === 0) {
    return {
      status: 'info',
      apps_with_scope: 0, apps_total: appsTotal,
      total_blind_spots: 0, closed: 0, partial: 0, open: 0,
      coverage_ratio: 0,
      message: `0 of ${appsTotal} app(s) have Pass 13 scope_coverage emitted. Run assess (Pass 13 ships by default in v0.0.37+).`,
    };
  }

  const ratio = totals.total === 0 ? 0
    : (totals.closed + 0.5 * totals.partial) / totals.total;
  const status: ScopeProbeStatus = ratio >= WARN_THRESHOLD ? 'ok' : 'warn';
  const ratioPct = Math.round(ratio * 100);

  return {
    status,
    apps_with_scope: appsWithScope,
    apps_total: appsTotal,
    total_blind_spots: totals.total,
    closed: totals.closed,
    partial: totals.partial,
    open: totals.open,
    coverage_ratio: Math.round(ratio * 10000) / 10000,
    message: `${totals.closed} closed / ${totals.partial} partial / ${totals.open} open (${ratioPct} %) across ${appsWithScope} app(s)`,
  };
}
