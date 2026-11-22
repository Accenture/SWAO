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

// #4193 SET-04 (Design 125 section 5.3): the read and write side of the
// Service Portfolio branch, shared by the step components and the
// non-interactive `check` of each step (section 8).
//
// Sources, read not re-invented:
// - service workspace: a `service_portfolio` block in the workspace .swao.yml
//   (isServiceWorkspace, @swao/module-health-check probes/service-probes.ts:66);
// - intake folder: wsp/inputs/service-intake/ (SERVICE_INTAKE_DIR, #3211,
//   module-service-assessment scaffold/intake-location.ts) with the same
//   workbook and column-map file patterns;
// - intake parser: parseIntakeWorkbook (sheets, rows, recognised columns;
//   header names only, never a cell value: intake contents are client data);
// - scoring inputs: the SWAO_APM framework (apmFrameworkDir,
//   validateDomainWeights), the INFRA-CAT vendor catalogue (Tier 1 built-in,
//   Tier 2 tier2Dir) and the research stubs per service app.
//
// The writer stores service_portfolio.intake and .mapping (section 5.7; read
// back by readServiceDefaults in setup/defaults.ts). It writes the block in
// block style with the header line `service_portfolio:` alone, the form
// `upsertServicePortfolioBlock` (scaffold/write.ts) matches, so a later
// `service init` rewrites its keys in place and keeps `intake`.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { load } from 'js-yaml';
import { patchSwaoYmlFile, patchSwaoYmlText, resolveRegimeCatalogue } from '@swao/core';
import { communityFrameworksDir } from '@swao/community-frameworks';
import {
  apmFrameworkDir,
  discoverBuiltinCatalogueFiles,
  INTAKE_TEMPLATE_FILE,
  loadColumnMapFile,
  parseIntakeWorkbook,
  readStub,
  resolveBuiltinCatalogueDir,
  SERVICE_INTAKE_DIR,
  tier2Dir,
  validateDomainWeights,
  type ColumnMap,
  type IntakeParseResult,
} from '@swao/module-service-assessment';
import { readServiceDefaults, readWorkspaceYml } from '../defaults.js';
import type { SetupCheckItem } from '../types.js';

const DAY_MS = 86_400_000;
/** Same threshold as the research cache probe (service-probes.ts RESEARCH_STALE_DAYS). */
export const SETUP_RESEARCH_STALE_DAYS = 30;
const WORKBOOK = /\.xlsx$/i;
const COLUMN_MAP = /column-?map.*\.ya?ml$|\.column-?map\.ya?ml$/i;
const OFFICE_LOCK = /^~\$/;

/** Workspace-relative path with forward slashes (the form `service init` records, init.ts displayPath). */
export function workspaceRelative(workspaceRoot: string, p: string): string {
  const rel = relative(workspaceRoot, p);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.replace(/\\/g, '/') : p;
}

/** The intake folder, workspace-relative ("wsp/inputs/service-intake"). */
export const SERVICE_INTAKE_FOLDER = SERVICE_INTAKE_DIR.replace(/\\/g, '/');

export function isServiceWorkspaceYml(workspaceRoot: string): boolean {
  return !!readWorkspaceYml(workspaceRoot)['service_portfolio'];
}

function readYaml(p: string): Record<string, unknown> | null {
  try {
    const v = load(readFileSync(p, 'utf-8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

/** Service app ids (apps/<id>/.swao.yml with assessment.type service), sorted. */
export function serviceAppIds(workspaceRoot: string): string[] {
  const apps = join(workspaceRoot, 'apps');
  if (!existsSync(apps)) return [];
  try {
    return readdirSync(apps, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .filter((d) => {
        const doc = readYaml(join(apps, d.name, '.swao.yml'));
        const a = doc?.['assessment'];
        return !!a && typeof a === 'object' && (a as Record<string, unknown>)['type'] === 'service';
      })
      .map((d) => d.name)
      .sort();
  } catch { return []; }
}

function filesIn(dir: string, re: RegExp): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((n) => re.test(n) && !OFFICE_LOCK.test(n) && statSync(join(dir, n)).isFile()).sort();
  } catch { return []; }
}

/** Workbook and column-map file names in the intake folder. */
export function listIntakeFolder(workspaceRoot: string): { folder: string; workbooks: string[]; mappings: string[] } {
  const folder = join(workspaceRoot, SERVICE_INTAKE_DIR);
  return { folder, workbooks: filesIn(folder, WORKBOOK), mappings: filesIn(folder, COLUMN_MAP) };
}

// ---------------------------------------------------------------- writer

const ROOT_KEY = /^[^\s#]/;

function quote(v: string): string {
  return JSON.stringify(v);
}

/**
 * Text edit of the workspace .swao.yml that keeps every comment: sets
 * service_portfolio.intake (and .mapping when given) in a block-style
 * `service_portfolio:` block, appending the block when absent. Returns null
 * for a layout it does not understand (flow style, inline value).
 */
function editServiceText(text: string, fields: { intake: string; mapping?: string }): string | null {
  const lines = text.split('\n');
  const own = [`  intake: ${quote(fields.intake)}`, ...(fields.mapping ? [`  mapping: ${quote(fields.mapping)}`] : [])];
  const start = lines.findIndex((l) => /^service_portfolio:\s*$/.test(l));
  if (start < 0) {
    if (lines.some((l) => /^service_portfolio\s*:/.test(l))) return null;
    return `${text.trimEnd()}\n\nservice_portfolio:\n${own.join('\n')}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (ROOT_KEY.test(lines[i]!)) { end = i; break; }
  }
  const replaced = new Set(['intake', ...(fields.mapping ? ['mapping'] : [])]);
  const body = lines.slice(start + 1, end).filter((l) => {
    const m = /^ {2}([A-Za-z_]+):/.exec(l);
    return !(m && replaced.has(m[1]!));
  });
  return [...lines.slice(0, start + 1), ...own, ...body, ...lines.slice(end)].join('\n');
}

/**
 * Store the intake workbook (and the optional column map) of the service
 * branch in the workspace .swao.yml (Design 125 section 5.7). Paths are
 * stored workspace-relative. Without `mapping` an existing mapping key is left
 * as it is. Returns false when the file is missing or cannot be written.
 */
export function writeServiceIntake(workspaceRoot: string, fields: { intake: string; mapping?: string }): boolean {
  const p = join(workspaceRoot, '.swao.yml');
  if (!existsSync(p)) return false;
  try {
    const raw = readFileSync(p, 'utf-8');
    const crlf = raw.includes('\r\n');
    const text = crlf ? raw.replace(/\r\n/g, '\n') : raw;
    const parsed = (load(text) ?? {}) as Record<string, unknown>;
    const old = parsed['service_portfolio'];
    const block = old && typeof old === 'object' && !Array.isArray(old) ? { ...(old as Record<string, unknown>) } : {};
    block['intake'] = fields.intake;
    if (fields.mapping) block['mapping'] = fields.mapping;
    const expected = { ...parsed, service_portfolio: block };
    let next = editServiceText(text, fields);
    if (next !== null) {
      try { if (!isDeepStrictEqual(load(next), expected)) next = null; } catch { next = null; }
    }
    if (next === null) {
      // #4283: fallback through the central minimal-patch writer, never a whole-file dump.
      const r = patchSwaoYmlText(text, [
        { path: ['service_portfolio', 'intake'], value: fields.intake },
        ...(fields.mapping ? [{ path: ['service_portfolio', 'mapping'], value: fields.mapping }] : []),
      ]);
      if (!r.ok) return false;
      next = r.text;
    }
    writeFileSync(p, crlf ? next.replace(/\n/g, '\r\n') : next, 'utf-8');
    return true;
  } catch { return false; }
}

/** Key of the default intake location in the `service_portfolio` block (#4225). */
export const SERVICE_INTAKE_FOLDER_KEY = 'intake_folder';

/**
 * #4225 (Design 125 section 4, row "Service workspace"; owner decision D-3):
 * makes the workspace a service workspace right away by writing the
 * `service_portfolio` block with the intake folder as the default intake
 * location (`service_portfolio.intake_folder`). The block is written in block
 * style through the central minimal-patch writer (#4283), so `swao service
 * init` later rewrites its scaffold keys in place and keeps this key. A
 * workspace that already has the block is left as it is. Returns false when
 * the file is missing or cannot be patched.
 */
export function writeServicePortfolioBlock(workspaceRoot: string): boolean {
  const p = join(workspaceRoot, '.swao.yml');
  if (!existsSync(p)) return false;
  if (isServiceWorkspaceYml(workspaceRoot)) return true;
  const r = patchSwaoYmlFile(p, [{ path: ['service_portfolio', SERVICE_INTAKE_FOLDER_KEY], value: SERVICE_INTAKE_FOLDER }]);
  return r.ok;
}

/** Create the intake folder (the place the workbook goes, #3211). */
export function ensureIntakeFolder(workspaceRoot: string): string {
  const folder = join(workspaceRoot, SERVICE_INTAKE_DIR);
  mkdirSync(folder, { recursive: true });
  return folder;
}

/** #4262: outcome of the Service workspace step's set-up action. */
export interface ServiceWorkspaceSetUp {
  /** Workspace-relative intake folder. */
  folder: string;
  /** The `service_portfolio` block is in the workspace .swao.yml. */
  block: boolean;
  /** Workspace-relative intake recorded right away (one workbook in the folder), or null. */
  recorded: string | null;
  /** What the step created, workspace-relative ("<file>#<key>" for a .swao.yml key); never a value. */
  created: string[];
}

/**
 * #4225 (D-3), #4262: sets the workspace up for the Service Portfolio
 * Assessment: the intake folder and the `service_portfolio` block with the
 * folder as the default intake location. With exactly one workbook there (not
 * the blank template) it is recorded as the intake as well. `created` names
 * what this call created, for the `wizard.step.complete` log.
 */
export function setUpServiceWorkspace(workspaceRoot: string): ServiceWorkspaceSetUp {
  const created: string[] = [];
  let folder = SERVICE_INTAKE_FOLDER;
  let recorded: string | null = null;
  let block = false;
  try {
    const hadFolder = existsSync(join(workspaceRoot, SERVICE_INTAKE_DIR));
    const hadBlock = isServiceWorkspaceYml(workspaceRoot);
    folder = workspaceRelative(workspaceRoot, ensureIntakeFolder(workspaceRoot));
    if (!hadFolder) created.push(`${folder}/`);
    block = writeServicePortfolioBlock(workspaceRoot);
    if (block && !hadBlock) created.push(`.swao.yml#service_portfolio.${SERVICE_INTAKE_FOLDER_KEY}`);
    const { workbooks, mappings, folder: abs } = listIntakeFolder(workspaceRoot);
    if (block && workbooks.length === 1 && workbooks[0] !== INTAKE_TEMPLATE_FILE) {
      const intake = workspaceRelative(workspaceRoot, join(abs, workbooks[0]!));
      const mapping = mappings.length === 1 ? workspaceRelative(workspaceRoot, join(abs, mappings[0]!)) : undefined;
      if (writeServiceIntake(workspaceRoot, { intake, ...(mapping ? { mapping } : {}) })) {
        recorded = intake;
        created.push('.swao.yml#service_portfolio.intake', ...(mapping ? ['.swao.yml#service_portfolio.mapping'] : []));
      }
    }
  } catch { /* reported by the step: nothing recorded */ }
  return { folder, block, recorded, created };
}

// ---------------------------------------------------------------- intake inspection

export interface IntakeSheetSummary {
  name: string;
  rows: number;
  /** Header names the intake parser mapped to a field (names only). */
  recognised: string[];
  /** Header cells in the header row. */
  columns: number;
}

export interface IntakeWorkbookSummary {
  file: string;
  /** Workspace-relative path. */
  path: string;
  sheets: IntakeSheetSummary[];
  /** Data rows the parser read (one per service or server). */
  rows: number;
  mapping: 'default' | 'custom';
  /** Why the workbook could not be read; the content is not shown. */
  error?: string;
}

export interface IntakeMappingSummary {
  file: string;
  path: string;
  error?: string;
}

export interface IntakeFolderSummary {
  /** Workspace-relative folder. */
  folder: string;
  workbooks: IntakeWorkbookSummary[];
  mappings: IntakeMappingSummary[];
}

export type IntakeParser = (file: string, opts: { map?: ColumnMap; sourceLabel?: string }) => Promise<IntakeParseResult>;

/** Counts and header names of a parse result; no row value leaves this function. */
export function summariseIntake(result: Pick<IntakeParseResult, 'sheets' | 'rows'>): { sheets: IntakeSheetSummary[]; rows: number; mapping: 'default' | 'custom' } {
  const sheets = result.sheets.map((s): IntakeSheetSummary => {
    const letters = [...new Set(Object.values(s.fields).filter((l): l is string => typeof l === 'string'))];
    return {
      name: s.name,
      rows: s.rows,
      recognised: letters.map((l) => s.headers[l]).filter((h): h is string => typeof h === 'string' && h.length > 0),
      columns: Object.keys(s.headers).length,
    };
  });
  return { sheets, rows: result.rows.length, mapping: result.sheets.some((s) => s.mapping === 'custom') ? 'custom' : 'default' };
}

function shortError(e: unknown): string {
  const msg = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim();
  return msg.length > 160 ? `${msg.slice(0, 157)}...` : msg;
}

/**
 * Read every workbook and column map in the intake folder. A single valid
 * column map is applied to the workbooks (as `service init` does when it
 * resolves the folder); otherwise the default template is used.
 */
export async function inspectIntakeFolder(workspaceRoot: string, parse: IntakeParser = parseIntakeWorkbook): Promise<IntakeFolderSummary> {
  const { folder, workbooks, mappings } = listIntakeFolder(workspaceRoot);
  const maps: IntakeMappingSummary[] = [];
  const valid: ColumnMap[] = [];
  for (const f of mappings) {
    const p = join(folder, f);
    try { valid.push(loadColumnMapFile(p)); maps.push({ file: f, path: workspaceRelative(workspaceRoot, p) }); } catch (e) {
      const issues = (e as { issues?: unknown }).issues;
      maps.push({ file: f, path: workspaceRelative(workspaceRoot, p), error: Array.isArray(issues) && issues.length > 0 ? shortError(issues[0]) : shortError(e) });
    }
  }
  const map = valid.length === 1 ? valid[0] : undefined;
  const books: IntakeWorkbookSummary[] = [];
  for (const f of workbooks) {
    const p = join(folder, f);
    try {
      const r = await parse(p, { ...(map ? { map } : {}), sourceLabel: f });
      books.push({ file: f, path: workspaceRelative(workspaceRoot, p), ...summariseIntake(r) });
    } catch (e) {
      books.push({ file: f, path: workspaceRelative(workspaceRoot, p), sheets: [], rows: 0, mapping: map ? 'custom' : 'default', error: shortError(e) });
    }
  }
  rememberIntakeInspection(workspaceRoot, books);
  return { folder: SERVICE_INTAKE_FOLDER, workbooks: books, mappings: maps };
}

/**
 * #4295: row counts of the workbooks the Intake Input step read, for the Ready
 * step (its summary is synchronous; the workbook parse is not). Keyed on the
 * absolute path; an entry is used only while the file's size and mtime are
 * unchanged, so a replaced workbook never shows an old count. In memory only:
 * nothing is written to the workspace before the import (`row_count` in the
 * service_portfolio block means rows of the last import).
 */
const intakeRows = new Map<string, { rows: number; size: number; mtimeMs: number }>();

function rememberIntakeInspection(workspaceRoot: string, books: readonly IntakeWorkbookSummary[]): void {
  for (const b of books) {
    const abs = join(workspaceRoot, b.path);
    try {
      const st = statSync(abs);
      if (b.error) intakeRows.delete(abs);
      else intakeRows.set(abs, { rows: b.rows, size: st.size, mtimeMs: st.mtimeMs });
    } catch { intakeRows.delete(abs); }
  }
}

/** #4295: data rows of a recorded intake workbook as last read in this session; null when not read or changed since. */
export function inspectedIntakeRows(workspaceRoot: string, intake: string): number | null {
  const abs = isAbsolute(intake) ? intake : join(workspaceRoot, intake);
  const hit = intakeRows.get(abs);
  if (!hit) return null;
  try {
    const st = statSync(abs);
    return st.size === hit.size && st.mtimeMs === hit.mtimeMs ? hit.rows : null;
  } catch { return null; }
}

/** The expected template, named when a workbook is missing or unreadable (no CLI syntax). */
export const INTAKE_TEMPLATE_HINT =
  'Expected: an .xlsx workbook with a header row in the default intake template (columns such as App ID, App Name, Vendor, Version, OS), or a column map file (name ending in column-map.yaml) next to it.';

// ---------------------------------------------------------------- checks

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Check of the Service workspace step. */
export function checkServiceWorkspace(workspaceRoot: string): SetupCheckItem[] {
  if (!isServiceWorkspaceYml(workspaceRoot)) {
    return [{ label: 'Service workspace', state: 'missing', detail: 'not set up: no service_portfolio block in the workspace .swao.yml; Service Setup adds it', short: 'not set up' }];
  }
  const apps = serviceAppIds(workspaceRoot).length;
  return [{
    label: 'Service workspace',
    state: apps > 0 ? 'ok' : 'info',
    detail: apps > 0 ? `${plural(apps, 'service app')} imported` : 'set up; no services imported yet, the assessment imports the intake',
    ...(apps > 0 ? {} : { short: 'no services imported yet' }),
  }];
}

/** The next action while the intake workbook is still expected (#4225, Design 126 status `waiting`). */
export const INTAKE_WAITING_DETAIL = `copy your intake workbook to ${SERVICE_INTAKE_FOLDER}/ or fill the template`;

/**
 * Check of the Intake input step (file level; the workbook itself is read by
 * the step). #4225: `missing` only for a recorded file that is gone; a
 * workbook that is still expected (none there, only the blank template, or
 * none chosen yet) is `waiting`, with the next action in the detail.
 */
export function checkServiceIntake(workspaceRoot: string): SetupCheckItem[] {
  const { workbooks, mappings } = listIntakeFolder(workspaceRoot);
  const defaults = readServiceDefaults(workspaceRoot);
  const items: SetupCheckItem[] = [];
  if (defaults.intake) {
    const p = isAbsolute(defaults.intake) ? defaults.intake : join(workspaceRoot, defaults.intake);
    items.push(existsSync(p)
      ? { label: 'Intake workbook', state: 'ok', detail: defaults.intake }
      : { label: 'Intake workbook', state: 'missing', detail: `${defaults.intake} not found; copy it back or record another workbook`, short: `${defaults.intake} not found` });
  } else if (workbooks.length === 1 && workbooks[0] === INTAKE_TEMPLATE_FILE) {
    items.push({ label: 'Intake workbook', state: 'waiting', detail: `fill the template ${SERVICE_INTAKE_FOLDER}/${INTAKE_TEMPLATE_FILE} (or copy your intake workbook there), then record it in Intake Input`, short: 'fill the intake template' });
  } else if (workbooks.length > 0) {
    items.push({ label: 'Intake workbook', state: 'waiting', detail: `${plural(workbooks.length, 'workbook')} in ${SERVICE_INTAKE_FOLDER}, none recorded; choose one in Intake Input`, short: `${plural(workbooks.length, 'workbook')}, none recorded` });
  } else {
    items.push({ label: 'Intake workbook', state: 'waiting', detail: INTAKE_WAITING_DETAIL, short: 'waiting for the intake workbook' });
  }
  if (defaults.mapping) {
    const p = isAbsolute(defaults.mapping) ? defaults.mapping : join(workspaceRoot, defaults.mapping);
    items.push(existsSync(p)
      ? { label: 'Column map', state: 'ok', detail: defaults.mapping }
      : { label: 'Column map', state: 'missing', detail: `${defaults.mapping} not found` });
  } else {
    items.push({ label: 'Column map', state: 'info', detail: mappings.length > 0 ? `${plural(mappings.length, 'file')} in the intake folder, none recorded` : 'default intake template' });
  }
  return items;
}

export interface ScoringInputs {
  apm: { present: boolean; source?: 'workspace' | 'bundled'; version?: string; reviewed?: string; ageDays?: number; valid: boolean; problem?: string };
  vendor: { builtinFiles: number; workspaceFiles: number; newestWorkspaceAgeDays?: number };
  research: { apps: number; researched: number; oldestAgeDays?: number; stale: number };
}

function daysSince(ms: number, now: Date): number {
  return Math.floor((now.getTime() - ms) / DAY_MS);
}

/** APM weights, vendor catalogue and research cache: present, version, age. */
export function readScoringInputs(workspaceRoot: string, now: Date = new Date()): ScoringInputs {
  // SWAO_APM framework-meta.yaml (workspace copy first, then bundled).
  let apm: ScoringInputs['apm'] = { present: false, valid: false };
  const located = apmFrameworkDir(workspaceRoot);
  if (located) {
    const doc = readYaml(join(located.dir, 'framework-meta.yaml'));
    const fw = doc?.['framework'] && typeof doc['framework'] === 'object' ? (doc['framework'] as Record<string, unknown>) : undefined;
    const weights = fw?.['domain_weights'] && typeof fw['domain_weights'] === 'object' ? (fw['domain_weights'] as Record<string, unknown>) : undefined;
    const { errors, warnings } = validateDomainWeights(weights);
    const reviewed = typeof fw?.['last_reviewed'] === 'string' ? fw['last_reviewed'] : undefined;
    const t = reviewed ? Date.parse(`${reviewed}T00:00:00Z`) : Number.NaN;
    apm = {
      present: true,
      source: located.source,
      ...(typeof fw?.['version'] === 'string' ? { version: fw['version'] } : {}),
      ...(reviewed ? { reviewed } : {}),
      ...(Number.isFinite(t) ? { ageDays: daysSince(t, now) } : {}),
      valid: errors.length === 0,
      ...(errors.length > 0 ? { problem: errors[0] } : warnings.length > 0 ? { problem: warnings[0] } : {}),
    };
  }

  // INFRA-CAT: Tier 1 built-in files, Tier 2 workspace files.
  let builtinFiles = 0;
  try {
    const dir = resolveBuiltinCatalogueDir();
    builtinFiles = dir ? discoverBuiltinCatalogueFiles(dir, { warn: () => {} }).length : 0;
  } catch { builtinFiles = 0; }
  const t2 = tier2Dir(workspaceRoot);
  const t2Files = filesIn(t2, /\.ya?ml$/i);
  let newest: number | undefined;
  for (const f of t2Files) {
    try { const m = statSync(join(t2, f)).mtimeMs; newest = newest === undefined ? m : Math.max(newest, m); } catch { /* skip */ }
  }

  // Research stubs per service app (cve-summary and eol-status, as the probe reads them).
  const apps = serviceAppIds(workspaceRoot);
  let researched = 0;
  let stale = 0;
  let oldest: number | undefined;
  for (const id of apps) {
    const dir = join(workspaceRoot, 'apps', id, 'wsp', 'inputs', 'research');
    const stubs = ['cve-summary', 'eol-status'].map((topic) => readStub(join(dir, `${topic}.md`)));
    if (stubs.some((s) => !s)) continue;
    researched++;
    const times = stubs.map((s) => Date.parse(String(s!.front['retrieved_at'] ?? ''))).map((x) => (Number.isFinite(x) ? x : 0));
    const appOldest = Math.min(...times);
    oldest = oldest === undefined ? appOldest : Math.min(oldest, appOldest);
    if (daysSince(appOldest, now) > SETUP_RESEARCH_STALE_DAYS) stale++;
  }

  return {
    apm,
    vendor: { builtinFiles, workspaceFiles: t2Files.length, ...(newest !== undefined ? { newestWorkspaceAgeDays: daysSince(newest, now) } : {}) },
    research: { apps: apps.length, researched, stale, ...(oldest !== undefined ? { oldestAgeDays: daysSince(oldest, now) } : {}) },
  };
}

/** Check of the Scoring inputs step. */
export function checkScoringInputs(workspaceRoot: string, now: Date = new Date()): SetupCheckItem[] {
  const s = readScoringInputs(workspaceRoot, now);
  const apm: SetupCheckItem = !s.apm.present
    ? { label: 'APM weights', state: 'missing', detail: 'SWAO_APM framework not found' }
    : {
      label: 'APM weights',
      state: s.apm.valid ? (s.apm.problem ? 'warn' : 'ok') : 'missing',
      detail: [
        `${s.apm.source} framework`,
        s.apm.version ? `version ${s.apm.version}` : 'no version',
        s.apm.reviewed ? `reviewed ${s.apm.reviewed}${s.apm.ageDays !== undefined ? ` (${s.apm.ageDays} days)` : ''}` : undefined,
        s.apm.problem,
      ].filter(Boolean).join(', '),
    };
  const vendor: SetupCheckItem = {
    label: 'Vendor catalogue',
    state: s.vendor.builtinFiles > 0 ? 'ok' : 'warn',
    detail: `${plural(s.vendor.builtinFiles, 'built-in file')}, ${s.vendor.workspaceFiles > 0
      ? `${plural(s.vendor.workspaceFiles, 'workspace file')} (newest ${s.vendor.newestWorkspaceAgeDays ?? 0} days old)`
      : 'no workspace additions (optional)'}`,
  };
  const r = s.research;
  const research: SetupCheckItem = r.apps === 0
    ? { label: 'Research cache', state: 'info', detail: 'no service apps yet; research runs after the import', short: 'no service apps yet' }
    : {
      label: 'Research cache',
      state: r.researched < r.apps || r.stale > 0 ? 'warn' : 'ok',
      detail: `${r.researched} of ${plural(r.apps, 'service app')} researched${r.oldestAgeDays !== undefined ? `, oldest ${r.oldestAgeDays} days` : ''}${r.stale > 0 ? `, ${r.stale} older than ${SETUP_RESEARCH_STALE_DAYS} days` : ''}`,
    };
  const frameworks = checkServiceFrameworks(workspaceRoot);
  return frameworks ? [apm, vendor, research, frameworks] : [apm, vendor, research];
}

/**
 * #4286: the frameworks the service apps list in `assessment.regimes_active`,
 * resolved with the shared community framework resolver Pass 11 uses
 * (workspace copy first, then bundled). A framework that resolves nowhere is a
 * missing item before the run. Null when no service app lists a framework.
 */
export function checkServiceFrameworks(workspaceRoot: string): SetupCheckItem | null {
  const ids = new Set<string>();
  for (const id of serviceAppIds(workspaceRoot)) {
    const a = readYaml(join(workspaceRoot, 'apps', id, '.swao.yml'))?.['assessment'];
    const list = a && typeof a === 'object' ? (a as Record<string, unknown>)['regimes_active'] : undefined;
    if (Array.isArray(list)) for (const r of list) if (typeof r === 'string' && r.trim()) ids.add(r.trim());
  }
  if (ids.size === 0) return null;
  const sorted = [...ids].sort();
  const resolved = sorted.map((id) => ({ id, r: resolveRegimeCatalogue(workspaceRoot, id, communityFrameworksDir) }));
  const missing = resolved.filter((x) => !x.r).map((x) => x.id);
  const found = resolved.filter((x) => x.r).map((x) => `${x.id} (${x.r!.source})`);
  return missing.length > 0
    ? { label: 'Frameworks', state: 'missing', detail: `not found: ${missing.join(', ')}; copy the framework folder into wsp/inputs/catalogs/community/${found.length > 0 ? `; found: ${found.join(', ')}` : ''}`, short: `not found: ${missing.join(', ')}` }
    : { label: 'Frameworks', state: 'ok', detail: found.join(', ') };
}
