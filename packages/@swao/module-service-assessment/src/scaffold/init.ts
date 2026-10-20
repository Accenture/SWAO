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
 * `swao service init` orchestration (Pass S-00, Design 103 §6.1).
 *
 * Order: load + validate the column map -> load INFRA-CAT -> parse the whole
 * workbook -> halt on duplicate IDs (nothing written) -> plan -> write.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, relative } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import type { ScaffoldSignal } from '@swao/core';
import { loadInfraCatalogue } from '../catalog/infra-cat.js';
import { parseIntakeWorkbook, type IntakeParseResult } from '../intake/parser.js';
import { isPiiHeader, parseColumnMap, type ColumnMap } from '../schema/column-map.schema.js';
import { DEFAULT_CLUSTER_THRESHOLD, planScaffold, type AppPlan } from './plan.js';
import { resolveCostOptions } from '../cost/cost-model.js';
import { resolveGlossary } from '../intake/terms.js';
import { writeScaffold, type ServicePortfolioMeta, type WriteResult } from './write.js';

export interface ServiceInitOptions {
  workspacePath: string;
  intakePath: string;
  mappingPath?: string;
  refresh?: boolean;
  clusterThreshold?: number;
  /** Override for tests; defaults to the bundled controls/infra-catalogue. */
  builtinCatalogueDir?: string | null;
}

export type ServiceInitResult =
  | {
      ok: true;
      apps: AppPlan[];
      write: WriteResult;
      signals: ScaffoldSignal[];
      warnings: string[];
      unknownAppIds: string[];
      rowCount: number;
      /** Per sheet: mapping kind and field -> column letter (#3168). */
      columns: Array<{ sheet: string; mapping: 'default' | 'custom'; fields: Record<string, string> }>;
    }
  | { ok: false; reason: 'duplicate_ids'; duplicateIds: string[]; signals: ScaffoldSignal[]; warnings: string[] };

export function loadColumnMapFile(path: string): ColumnMap {
  return parseColumnMap(yamlLoad(readFileSync(path, 'utf-8')));
}

function workspaceServicePortfolio(workspacePath: string): Record<string, unknown> {
  const p = `${workspacePath}/.swao.yml`;
  if (!existsSync(p)) return {};
  try {
    const doc = yamlLoad(readFileSync(p, 'utf-8')) as { service_portfolio?: Record<string, unknown> } | null;
    return doc?.service_portfolio ?? {};
  } catch {
    return {};
  }
}

function workspaceClusterThreshold(workspacePath: string): number | undefined {
  const p = `${workspacePath}/.swao.yml`;
  if (!existsSync(p)) return undefined;
  try {
    const doc = yamlLoad(readFileSync(p, 'utf-8')) as { service_portfolio?: { cluster_threshold?: unknown } } | null;
    const t = doc?.service_portfolio?.cluster_threshold;
    return typeof t === 'number' && Number.isInteger(t) && t >= 2 ? t : undefined;
  } catch {
    return undefined;
  }
}

function displayPath(workspacePath: string, p: string): string {
  const rel = relative(workspacePath, p);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.replace(/\\/g, '/') : p;
}

export async function runServiceInit(opts: ServiceInitOptions): Promise<ServiceInitResult> {
  const map = opts.mappingPath ? loadColumnMapFile(opts.mappingPath) : undefined;
  const catalogue = loadInfraCatalogue({
    workspacePath: opts.workspacePath,
    ...(opts.builtinCatalogueDir !== undefined ? { builtinDir: opts.builtinCatalogueDir } : {}),
  });
  const knownVendors = catalogue.services.flatMap((s) => s.vendor_patterns ?? []);
  const intake: IntakeParseResult = await parseIntakeWorkbook(opts.intakePath, {
    ...(map ? { map } : {}),
    knownVendors,
    sourceLabel: basename(opts.intakePath),
  });

  if (intake.duplicateIds.length > 0) {
    return { ok: false, reason: 'duplicate_ids', duplicateIds: intake.duplicateIds, signals: intake.signals, warnings: intake.warnings };
  }

  const threshold = opts.clusterThreshold ?? workspaceClusterThreshold(opts.workspacePath) ?? DEFAULT_CLUSTER_THRESHOLD;
  const portfolioCfg = workspaceServicePortfolio(opts.workspacePath);
  // #3288: the workspace VM price table (swao lz catalogue update) wins over the bundled one.
  const costOptions = resolveCostOptions(portfolioCfg['cost'], { workspacePath: opts.workspacePath });
  // #3210: English canonical terms; workspace glossary in service_portfolio.glossary.
  const glossary = resolveGlossary(portfolioCfg['glossary']);
  const plan = planScaffold(intake.rows, catalogue, { clusterThreshold: threshold, costOptions, glossary });
  const signals = [...intake.signals, ...plan.signals];
  const warnings = [...intake.warnings, ...plan.warnings];

  const meta: ServicePortfolioMeta = {
    source: displayPath(opts.workspacePath, opts.intakePath),
    mapping: opts.mappingPath ? displayPath(opts.workspacePath, opts.mappingPath) : null,
    imported_at: new Date().toISOString().slice(0, 10),
    app_count: plan.apps.length,
    row_count: intake.rows.length,
    sheets: intake.sheets.map((s) => s.name),
    headers: Object.fromEntries(intake.sheets.map((s) => [s.name, s.headers])),
    pii_columns: map
      ? [...new Set(map.pii_columns.map((p) => String(p.col)))]
      : [...new Set(intake.sheets.flatMap((s) => Object.entries(s.headers).filter(([, h]) => isPiiHeader(h)).map(([c]) => c)))],
    cluster_threshold: threshold,
  };

  const write = writeScaffold(opts.workspacePath, plan.apps, signals, meta, { refresh: opts.refresh ?? false, warnings });
  return {
    ok: true,
    apps: plan.apps,
    write,
    signals,
    warnings,
    unknownAppIds: plan.unknownAppIds,
    rowCount: intake.rows.length,
    columns: intake.sheets.map((s) => ({ sheet: s.name, mapping: s.mapping, fields: s.fields as Record<string, string> })),
  };
}
