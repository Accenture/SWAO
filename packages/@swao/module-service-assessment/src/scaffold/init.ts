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
 * workbook -> halt on duplicate IDs (nothing written) -> plan -> halt when the
 * workspace already holds service apps from another intake workbook (#3521,
 * nothing written unless `otherSource` is 'replace' or 'keep') -> write.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import type { ScaffoldSignal } from '@swao/core';
import { loadInfraCatalogue } from '../catalog/infra-cat.js';
import { parseIntakeWorkbook, type IntakeParseResult } from '../intake/parser.js';
import { isPiiHeader, parseColumnMap, type ColumnMap } from '../schema/column-map.schema.js';
import { DEFAULT_CLUSTER_THRESHOLD, planScaffold, type AppPlan, type ScaffoldPlan } from './plan.js';
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
  /**
   * #3521: what to do when the workspace already holds service apps scaffolded
   * from a different intake workbook. 'refuse' (default) writes nothing;
   * 'replace' moves those apps to parked-apps/<stamp>/ first; 'keep' adds the
   * new apps next to them.
   */
  otherSource?: OtherSourcePolicy;
}

export type OtherSourcePolicy = 'refuse' | 'replace' | 'keep';

/** Identity of an intake workbook (#3521): file name (never a path) and content hash. */
export interface IntakeSourceId {
  name: string;
  sha256: string;
}

/** Service apps in the workspace that came from another intake workbook (#3521). */
export interface IntakeSourceConflict {
  appIds: string[];
  /** Recorded workbook names of those apps; '(not recorded)' when neither the app nor the workspace records one. */
  sources: string[];
}

/** Workspace folder that receives the apps of an earlier intake on --replace (#3521). */
export const PARKED_APPS_DIR = 'parked-apps';

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
      /** #3521: workbook identity recorded on every app and in service_portfolio. */
      source: IntakeSourceId;
      /** #3521: apps of an earlier intake moved aside by 'replace' (workspace-relative dir). */
      parked: { dir: string; appIds: string[] } | null;
      /** #3521: apps of another intake left in place by 'keep'. */
      keptOtherSource: string[];
    }
  | { ok: false; reason: 'duplicate_ids'; duplicateIds: string[]; signals: ScaffoldSignal[]; warnings: string[] }
  | { ok: false; reason: 'other_intake_source'; source: IntakeSourceId; conflict: IntakeSourceConflict; plannedAppCount: number; signals: ScaffoldSignal[]; warnings: string[] };

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

/** #3521: identity of an intake workbook: its file name and the SHA-256 of its bytes. */
export function intakeSourceId(intakePath: string): IntakeSourceId {
  return { name: basename(intakePath), sha256: createHash('sha256').update(readFileSync(intakePath)).digest('hex') };
}

const fileName = (p: string): string => basename(p.replace(/\\/g, '/'));
const sameName = (a: string, b: string): boolean => fileName(a).toLowerCase() === fileName(b).toLowerCase();

function serviceAppDoc(workspacePath: string, id: string): ServiceAppYaml | null {
  const p = join(workspacePath, 'apps', id, '.swao.yml');
  if (!existsSync(p)) return null;
  try {
    const doc = yamlLoad(readFileSync(p, 'utf-8')) as ServiceAppYaml | null;
    return doc?.assessment?.type === 'service' ? doc : null;
  } catch {
    return null;
  }
}

interface ServiceAppYaml {
  assessment?: { type?: unknown };
  intake?: { source?: unknown; source_sha256?: unknown };
}

/** Service apps under apps/ (any intake source), sorted by ID. */
export function existingServiceAppIds(workspacePath: string): string[] {
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir).sort().filter((id) => serviceAppDoc(workspacePath, id) !== null);
}

/**
 * #3521: service apps under apps/ that were scaffolded from a different intake
 * workbook. An app records its workbook in `intake.source` / `intake.source_sha256`;
 * the same file name or the same content hash counts as the same source (an
 * edited or renamed workbook, the normal --refresh case). Apps scaffolded before
 * #3521 carry no record: they fall back to `service_portfolio.source` of the
 * workspace, and count as another source when the workspace has no record either.
 */
export function intakeSourceConflict(workspacePath: string, source: IntakeSourceId): IntakeSourceConflict {
  const portfolio = workspaceServicePortfolio(workspacePath);
  const wsName = typeof portfolio['source'] === 'string' ? portfolio['source'] : null;
  const wsSha = typeof portfolio['source_sha256'] === 'string' ? portfolio['source_sha256'] : null;
  const appIds: string[] = [];
  const sources = new Set<string>();
  for (const id of existingServiceAppIds(workspacePath)) {
    const doc = serviceAppDoc(workspacePath, id);
    const own = typeof doc?.intake?.source === 'string' ? doc.intake.source : null;
    const recName = own ?? wsName;
    const recSha = own !== null
      ? (typeof doc?.intake?.source_sha256 === 'string' ? doc.intake.source_sha256 : null)
      : wsSha;
    const same = (recName !== null && sameName(recName, source.name)) || (recSha !== null && recSha === source.sha256);
    if (same) continue;
    appIds.push(id);
    sources.add(recName !== null ? fileName(recName) : '(not recorded)');
  }
  return { appIds, sources: [...sources].sort() };
}

/** #3521: move service app folders aside (never deleted: they hold client evidence and runs). */
export function parkServiceApps(workspacePath: string, appIds: readonly string[], now: Date = new Date()): { dir: string; appIds: string[] } {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = join(workspacePath, PARKED_APPS_DIR, stamp);
  mkdirSync(target, { recursive: true });
  const moved: string[] = [];
  for (const id of appIds) {
    renameSync(join(workspacePath, 'apps', id), join(target, id));
    moved.push(id);
  }
  return { dir: `${PARKED_APPS_DIR}/${stamp}`, appIds: moved };
}

export type ServiceInitPlan =
  | { ok: false; reason: 'duplicate_ids'; duplicateIds: string[]; signals: ScaffoldSignal[]; warnings: string[] }
  | {
      ok: true;
      intake: IntakeParseResult;
      plan: ScaffoldPlan;
      meta: ServicePortfolioMeta;
      signals: ScaffoldSignal[];
      warnings: string[];
      source: IntakeSourceId;
      /** Service apps of another intake workbook already in the workspace. */
      conflict: IntakeSourceConflict;
      /** Service apps under apps/ before this init (any source). */
      existingServiceAppIds: string[];
    };

/**
 * Everything `service init` does except writing (#3518, #3521): parse, plan,
 * and detect a second intake workbook. The TUI uses it to show the app count
 * and the conflict before any child process runs.
 */
export async function planServiceInit(opts: ServiceInitOptions): Promise<ServiceInitPlan> {
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

  // #3521: every app records the workbook it came from (name and hash, never a path).
  const source = intakeSourceId(opts.intakePath);
  for (const a of plan.apps) {
    a.config.intake = { ...a.config.intake, source: source.name, source_sha256: source.sha256 };
  }

  const meta: ServicePortfolioMeta = {
    source: displayPath(opts.workspacePath, opts.intakePath),
    source_sha256: source.sha256,
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

  return {
    ok: true, intake, plan, meta, signals, warnings, source,
    conflict: intakeSourceConflict(opts.workspacePath, source),
    existingServiceAppIds: existingServiceAppIds(opts.workspacePath),
  };
}

export async function runServiceInit(opts: ServiceInitOptions): Promise<ServiceInitResult> {
  const planned = await planServiceInit(opts);
  if (!planned.ok) return planned;
  const { intake, plan, meta, signals, warnings, source, conflict } = planned;
  const policy: OtherSourcePolicy = opts.otherSource ?? 'refuse';

  let parked: { dir: string; appIds: string[] } | null = null;
  let keptOtherSource: string[] = [];
  if (conflict.appIds.length > 0) {
    switch (policy) {
      case 'refuse':
        return { ok: false, reason: 'other_intake_source', source, conflict, plannedAppCount: plan.apps.length, signals, warnings };
      case 'replace':
        parked = parkServiceApps(opts.workspacePath, conflict.appIds);
        break;
      case 'keep':
        keptOtherSource = [...conflict.appIds];
        break;
      default: {
        const never: never = policy;
        throw new Error(`unknown otherSource policy: ${String(never)}`);
      }
    }
  }

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
    source,
    parked,
    keptOtherSource,
  };
}
