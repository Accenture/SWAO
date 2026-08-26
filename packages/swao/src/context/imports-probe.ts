// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, isAbsolute } from 'path';
import { load } from 'js-yaml';
// Imports-probe result types moved to @swao/core (#0573) so @swao/module-health-check's
// formatters can type them without importing the host. This builder stays
// host-coupled (walks the workspace `.swao.yml` tree) and is injected into
// @swao/module-health-check by the host. The Cmdb* types below stay here (they feed
// cmdb-probe, unrelated to the import-template probe).
import type { ImportsProbeStatus, ImportFinding, ImportsProbeResult } from '@swao/core';

export type { ImportsProbeStatus, ImportFinding, ImportsProbeResult } from '@swao/core';

const CMDB_REQUIRED_COLUMNS = ['app_id', 'sla_tier'] as const;

const CMDB_RECOMMENDED_COLUMNS = [
  'rto_hours',
  'rpo_hours',
  'pii_classification',
  'compliance_regimes',
  'data_residency_requirement',
] as const;

const CMDB_OPTIONAL_COLUMNS = [
  'dependent_apps',
  'migration_planned_date',
] as const;

interface ContextInputEntry {
  id?: string;
  type?: string;
  path?: string;
}

function readSwaoYmlContextInputs(swaoYmlPath: string): ContextInputEntry[] | null {
  if (!existsSync(swaoYmlPath)) return null;
  const raw = load(readFileSync(swaoYmlPath, 'utf-8')) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return null;
  const ci = raw.context_inputs;
  if (!Array.isArray(ci)) return null;
  return ci as ContextInputEntry[];
}

function parseCsvHeader(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  return firstLine
    .split(',')
    .map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase())
    .filter((c) => c.length > 0);
}

function checkCmdbColumns(filePath: string): {
  missing_required: string[];
  missing_recommended: string[];
  missing_optional: string[];
} {
  let header: string[];
  try {
    header = parseCsvHeader(filePath);
  } catch {
    return {
      missing_required: [...CMDB_REQUIRED_COLUMNS],
      missing_recommended: [...CMDB_RECOMMENDED_COLUMNS],
      missing_optional: [...CMDB_OPTIONAL_COLUMNS],
    };
  }
  const have = new Set(header);
  return {
    missing_required: CMDB_REQUIRED_COLUMNS.filter((c) => !have.has(c)),
    missing_recommended: CMDB_RECOMMENDED_COLUMNS.filter((c) => !have.has(c)),
    missing_optional: CMDB_OPTIONAL_COLUMNS.filter((c) => !have.has(c)),
  };
}

/**
 * Build a single Finding for one `.swao.yml.context_inputs[]` entry.
 * For `cmdb_export`, runs the column-presence check from #0042.
 * For every other type, presence-only.
 */
function buildFinding(
  entry: ContextInputEntry,
  workspacePath: string,
): ImportFinding {
  const id = entry.id ?? '?';
  const type = entry.type ?? '?';
  const relPath = entry.path ?? '';
  const fullPath = relPath
    ? (isAbsolute(relPath) ? relPath : join(workspacePath, relPath))
    : '';

  const finding: ImportFinding = {
    id,
    type,
    path: relPath,
    status: 'ok',
    missing_required: [],
    missing_recommended: [],
    missing_optional: [],
    error: null,
  };

  if (!relPath) {
    finding.status = 'fail';
    finding.error = 'context_inputs entry has no `path`';
    return finding;
  }
  if (!existsSync(fullPath)) {
    finding.status = 'fail';
    finding.error = `file not found: ${fullPath}`;
    return finding;
  }

  if (type === 'cmdb_export') {
    const cols = checkCmdbColumns(fullPath);
    finding.missing_required = cols.missing_required;
    finding.missing_recommended = cols.missing_recommended;
    finding.missing_optional = cols.missing_optional;
    if (cols.missing_required.length > 0) finding.status = 'blocked';
    else if (cols.missing_recommended.length > 0) finding.status = 'degraded';
    else finding.status = 'ok';
  }
  // Other types: presence only -> status stays 'ok'.

  return finding;
}

/**
 * Doctor `[5/7] Import templates` probe (#0189).
 *
 * Scans every `.swao.yml.context_inputs[]` entry. Confirms each
 * registered file exists. For `cmdb_export` entries additionally runs
 * the recommended-column check (preserves the #0042 column-validation
 * value). Other types are presence-only because their column shape
 * varies by vendor.
 *
 * Workspace-shape awareness:
 * - Single-app workspace -- `.swao.yml` lives at the root and owns
 *   `context_inputs[]`. Probe reads that file.
 * - Portfolio workspace -- root `.swao.yml` holds engagement-level
 *   config; each `apps/<id>/.swao.yml` owns its own `context_inputs[]`.
 *   Probe walks every `apps/<id>/.swao.yml`, resolves paths relative
 *   to the app's directory (NOT the workspace root), and aggregates.
 *
 * Aggregate status:
 * - `absent`   no apps configured yet or no context_inputs anywhere
 * - `fail`     any registered file missing
 * - `blocked`  any cmdb_export missing required columns
 * - `degraded` any cmdb_export missing recommended columns
 * - `ok`       all entries resolve and (for CMDB) all recommended
 *              columns present
 */
export function buildImportsProbe(workspacePath: string): ImportsProbeResult {
  // Discover scan targets: the workspace root + every apps/<id>/. Each
  // target has its own `.swao.yml`; context_inputs paths are resolved
  // relative to the target's own directory.
  const targets: Array<{ dir: string; label: string }> = [];

  // Root-level .swao.yml (single-app workspace).
  if (existsSync(join(workspacePath, '.swao.yml'))) {
    targets.push({ dir: workspacePath, label: 'workspace' });
  }

  // Portfolio: apps/<id>/.swao.yml.
  const appsRoot = join(workspacePath, 'apps');
  const portfolioMode = existsSync(appsRoot) && statSync(appsRoot).isDirectory();
  if (portfolioMode) {
    for (const name of readdirSync(appsRoot)) {
      const appDir = join(appsRoot, name);
      try {
        if (!statSync(appDir).isDirectory()) continue;
      } catch { continue; }
      if (existsSync(join(appDir, '.swao.yml'))) {
        targets.push({ dir: appDir, label: name });
      }
    }
  }

  // Collect findings across every target. Each entry's `path` is
  // resolved relative to its OWN target directory so portfolio shape
  // works without rewriting paths.
  const findings: ImportFinding[] = [];
  let anyTargetHadEntries = false;

  for (const target of targets) {
    const entries = readSwaoYmlContextInputs(join(target.dir, '.swao.yml'));
    if (entries === null) continue;
    const valid = entries.filter((e) => typeof e.path === 'string' && e.path.length > 0);
    if (valid.length === 0) continue;
    anyTargetHadEntries = true;
    for (const e of valid) findings.push(buildFinding(e, target.dir));
  }

  if (!anyTargetHadEntries) {
    // Tailor the absent message to the workspace shape so the operator
    // knows what's expected next.
    let message: string;
    if (portfolioMode) {
      const appCount = targets.filter(t => t.label !== 'workspace').length;
      message = appCount === 0
        ? 'no apps configured yet (run Assessment to add an app)'
        : `${appCount} app(s) configured; none have context_inputs registered yet`;
    } else {
      message = 'no context_inputs entries registered in .swao.yml';
    }
    return { status: 'absent', findings: [], message };
  }

  let aggregate: ImportsProbeStatus = 'ok';
  if (findings.some((f) => f.status === 'fail')) aggregate = 'fail';
  else if (findings.some((f) => f.status === 'blocked')) aggregate = 'blocked';
  else if (findings.some((f) => f.status === 'degraded')) aggregate = 'degraded';

  const summary = (() => {
    const total = findings.length;
    const okCount = findings.filter((f) => f.status === 'ok').length;
    if (aggregate === 'ok') {
      return `${total} template(s) registered, all OK`;
    }
    if (aggregate === 'degraded') {
      const dCount = findings.filter((f) => f.status === 'degraded').length;
      return `${okCount}/${total} OK; ${dCount} cmdb_export missing recommended columns`;
    }
    if (aggregate === 'blocked') {
      const bCount = findings.filter((f) => f.status === 'blocked').length;
      return `${okCount}/${total} OK; ${bCount} cmdb_export missing required columns`;
    }
    const fCount = findings.filter((f) => f.status === 'fail').length;
    return `${okCount}/${total} OK; ${fCount} registered file(s) failed to resolve`;
  })();

  return { status: aggregate, findings, message: summary };
}

export const IMPORTS_TYPE_LABELS: Record<string, string> = {
  cmdb_export: 'CMDB',
  finops_costing: 'FinOps',
  servicenow_tickets: 'Incidents',
  on_prem_costing: 'On-prem costing',
  solution_arch: 'Architecture docs',
  meeting_transcript: 'Workshops',
  ops_runbooks: 'Runbooks',
  apm_export: 'APM',
};

// ---- Backwards compatibility for #0042 callers --------------------------

export type CmdbProbeStatus = 'ok' | 'degraded' | 'blocked' | 'absent' | 'fail';

export interface CmdbProbeFinding {
  path: string;
  status: 'ok' | 'degraded' | 'blocked' | 'fail';
  missing_required: string[];
  missing_recommended: string[];
  missing_optional: string[];
  error: string | null;
}

export interface CmdbProbeResult {
  status: CmdbProbeStatus;
  files: CmdbProbeFinding[];
  message: string;
}

/**
 * Pre-#0189 entry point. Returns only the cmdb_export findings so any
 * external caller (or tests) referencing the CMDB-specific result type
 * keeps working.
 */
export function buildCmdbProbe(workspacePath: string): CmdbProbeResult {
  const result = buildImportsProbe(workspacePath);
  const cmdbFindings = result.findings.filter((f) => f.type === 'cmdb_export');

  if (cmdbFindings.length === 0) {
    return {
      status: 'absent',
      files: [],
      message: 'no context_inputs entries with type: cmdb_export',
    };
  }

  let status: CmdbProbeStatus = 'ok';
  if (cmdbFindings.some((f) => f.status === 'fail')) status = 'fail';
  else if (cmdbFindings.some((f) => f.status === 'blocked')) status = 'blocked';
  else if (cmdbFindings.some((f) => f.status === 'degraded')) status = 'degraded';

  const files: CmdbProbeFinding[] = cmdbFindings.map((f) => ({
    path: f.path,
    status: f.status,
    missing_required: f.missing_required,
    missing_recommended: f.missing_recommended,
    missing_optional: f.missing_optional,
    error: f.error,
  }));

  const message =
    status === 'ok'
      ? `${cmdbFindings.length} cmdb_export file(s) all complete`
      : status === 'degraded'
        ? `${cmdbFindings.filter((f) => f.status === 'degraded').length}/${cmdbFindings.length} cmdb_export missing recommended columns`
        : status === 'blocked'
          ? `${cmdbFindings.filter((f) => f.status === 'blocked').length}/${cmdbFindings.length} cmdb_export missing required columns`
          : `${cmdbFindings.filter((f) => f.status === 'fail').length}/${cmdbFindings.length} cmdb_export failed to parse`;

  return { status, files, message };
}

export const CMDB_REQUIRED = CMDB_REQUIRED_COLUMNS;
export const CMDB_RECOMMENDED = CMDB_RECOMMENDED_COLUMNS;
export const CMDB_OPTIONAL = CMDB_OPTIONAL_COLUMNS;
