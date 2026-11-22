// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Intake column-mapping probe (Design 103 §21.1, #3084).
 *
 * Runs only in a service workspace (workspace `.swao.yml` has a
 * `service_portfolio:` block) that was scaffolded with `--mapping`. It never
 * opens the intake workbook: header names and parser results are read from
 * the workspace `.swao.yml` and `wsp/signals/scaffold-signals.json`, so the
 * probe touches no PII-bearing file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { load } from 'js-yaml';
import { ScaffoldSignalsFileSchema } from '@swao/core';
import { ColumnMapError, checkPiiDeclarations, columnToIndex, loadColumnMapFile, vendorCoverageWarning, serviceAppVendorNames, NO_VENDOR_COLUMN_WARNING_PREFIX, type ColumnMap } from '@swao/module-service-assessment';
import { serviceWorkspaceState, SERVICE_INTAKE_MISSING } from './service-probes.js';

export type IntakeMappingProbeStatus = 'skip' | 'ok' | 'warn' | 'error';

export interface IntakeMappingProbeResult {
  status: IntakeMappingProbeStatus;
  message: string;
  errors: string[];
  warnings: string[];
}

interface ServicePortfolioBlock {
  mapping?: string | null;
  sheets?: string[];
  headers?: Record<string, Record<string, string>>;
  row_count?: number;
}

/** #4262: ok message of a service workspace on the default column map (no mapping file recorded). */
export const DEFAULT_COLUMN_MAP_OK = 'default column map in use (no mapping file recorded)';

/** Share of rows above which a type mismatch is an error and a blank OS is a warning (§21.1). */
const TYPE_MISMATCH_ERROR_RATIO = 0.1;
const BLANK_OS_WARN_RATIO = 0.05;

function readServicePortfolio(workspacePath: string): ServicePortfolioBlock | null {
  const p = join(workspacePath, '.swao.yml');
  if (!existsSync(p)) return null;
  try {
    const doc = load(readFileSync(p, 'utf-8')) as { service_portfolio?: unknown } | null;
    const sp = doc?.service_portfolio;
    return sp && typeof sp === 'object' ? (sp as ServicePortfolioBlock) : null;
  } catch {
    return null;
  }
}

function headersFor(sp: ServicePortfolioBlock, map: ColumnMap): Map<number, string> {
  const sheets = sp.sheets ?? [];
  const wanted = map.source.sheet;
  const name = typeof wanted === 'number' ? sheets[wanted - 1] : wanted ?? sheets[0];
  const byLetter: Record<string, string> = (name && sp.headers?.[name]) || {};
  return new Map(Object.entries(byLetter).map(([col, h]): [number, string] => [columnToIndex(col), String(h)]));
}

export function buildIntakeMappingProbe(workspacePath: string): IntakeMappingProbeResult {
  const sp = readServicePortfolio(workspacePath);
  if (!sp) {
    // #4262: a declared service workspace (workspace.assessment_types) without the intake block warns.
    return serviceWorkspaceState(workspacePath) === 'declared'
      ? { status: 'warn', message: SERVICE_INTAKE_MISSING, errors: [], warnings: [SERVICE_INTAKE_MISSING] }
      : { status: 'skip', message: 'not a service workspace', errors: [], warnings: [] };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  // #4262: without a mapping file the default column map applies; the probe
  // still runs the import checks below (it no longer skips in a service workspace).
  const mappingPath = sp.mapping ? (isAbsolute(sp.mapping) ? sp.mapping : join(workspacePath, sp.mapping)) : null;

  let map: ColumnMap | null = null;
  if (mappingPath && !existsSync(mappingPath)) {
    errors.push(`mapping file not found: ${sp.mapping}`);
  } else if (mappingPath) {
    try {
      map = loadColumnMapFile(mappingPath);
    } catch (e) {
      if (e instanceof ColumnMapError) errors.push(...e.issues);
      else errors.push(`mapping file unreadable: ${(e as Error).message}`);
    }
  }

  if (map) {
    const wanted = map.source.sheet;
    const sheets = sp.sheets ?? [];
    if (typeof wanted === 'string' && sheets.length > 0 && !sheets.includes(wanted)) errors.push(`sheet not found: "${wanted}"`);
    if (typeof wanted === 'number' && sheets.length > 0 && wanted > sheets.length) errors.push(`sheet not found: index ${wanted}`);
    warnings.push(...checkPiiDeclarations(map, headersFor(sp, map)));
  }

  const signalsPath = join(workspacePath, 'wsp', 'signals', 'scaffold-signals.json');
  if (existsSync(signalsPath)) {
    try {
      const file = ScaffoldSignalsFileSchema.parse(JSON.parse(readFileSync(signalsPath, 'utf-8')));
      const rows = sp.row_count ?? 0;
      const dups = file.signals.filter((s) => s.code === 'SCAFFOLD.DUPLICATE_ID');
      if (dups.length > 0) errors.push(`duplicate app IDs after parse: ${dups.map((s) => s.app_id).join(', ')}`);
      const osBlank = file.signals.find((s) => s.code === 'SCAFFOLD.MANDATORY_FIELD_MISSING' && /os blank/.test(s.evidence.join(' ')));
      if (osBlank && rows > 0 && osBlank.evidence.length / rows > BLANK_OS_WARN_RATIO) {
        warnings.push(`OS blank in ${osBlank.evidence.length} of ${rows} rows; end-of-life lookup will be partial`);
      }
      for (const w of file.warnings) {
        const m = /^field (\w+): (\d+) of (\d+) value\(s\) (not numeric|not in true_values)/.exec(w);
        if (m && m[4] === 'not numeric' && Number(m[2]) / Number(m[3]) > TYPE_MISMATCH_ERROR_RATIO) errors.push(`type mismatch: ${w}`);
        else warnings.push(m && m[4] !== 'not numeric' ? `unknown true_values: ${w}` : w);
      }
    } catch {
      warnings.push('scaffold-signals.json unreadable; re-run swao service init');
    }
  }

  // #4489: CVE research and vendor consolidation need vendor names. An import
  // since #4489 records the warning in scaffold-signals.json; an older one is
  // checked on the scaffolded apps (vendor.name of apps/<id>/.swao.yml).
  if (!warnings.some((w) => w.startsWith(NO_VENDOR_COLUMN_WARNING_PREFIX))) {
    const gap = vendorCoverageWarning(serviceAppVendorNames(workspacePath));
    if (gap) warnings.push(gap);
  }

  if (errors.length > 0) return { status: 'error', message: `${errors.length} mapping error(s): ${errors[0]}`, errors, warnings };
  if (warnings.length > 0) return { status: 'warn', message: `${warnings.length} warning(s): ${warnings[0]}`, errors, warnings };
  return { status: 'ok', message: sp.mapping ? `column map ${sp.mapping} valid` : DEFAULT_COLUMN_MAP_OK, errors, warnings };
}
