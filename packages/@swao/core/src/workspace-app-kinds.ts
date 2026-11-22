// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core, the kinds of the workspace apps
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4239 (moved from module-app-assessment shared/app-kinds.ts so the Publish
// and Portfolio pickers share it, run 4): the app pickers list the
// workspace apps grouped by kind: applications first, then the service apps
// that the Service Portfolio Assessment scaffolds (`assessment.type: service`
// in apps/<id>/.swao.yml, ADR-0064; same test as the health check source
// accessibility probe). The subject app of the setup is preselected.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';

export type AppKind = 'application' | 'service';

export interface WorkspaceApp {
  id: string;
  kind: AppKind;
  /** #4458: `app_name` (else `app.name`) of the app .swao.yml, for the picker rows; absent when unset. */
  name?: string;
}

/** Group headings of the app pickers (M-04). */
export const APP_KIND_GROUP: Readonly<Record<AppKind, string>> = {
  application: 'Applications',
  service: 'Service apps',
};

const SERVICE_TYPE = /^\s+type\s*:\s*['"]?service['"]?\s*$/m;

/** The kind of one app folder: `service` when its .swao.yml declares `assessment.type: service`. */
export function appKind(appDir: string): AppKind {
  try {
    const raw = readFileSync(join(appDir, '.swao.yml'), 'utf-8').slice(0, 100_000);
    return SERVICE_TYPE.test(raw) ? 'service' : 'application';
  } catch {
    return 'application';
  }
}

/**
 * #4458: the display name of an app folder: top-level `app_name` of its
 * .swao.yml, else `app.name`; blanks collapsed. Never throws.
 */
export function appDisplayName(appDir: string): string | undefined {
  try {
    return yamlAppName(readFileSync(join(appDir, '.swao.yml'), 'utf-8').slice(0, 100_000));
  } catch {
    return undefined;
  }
}

/**
 * #4484: workspace-relative location of the app index, a cache (wsp/cache is
 * never configuration, Design 051 "Workspace cache"): per app id the kind, the display
 * name and the size and mtime of its .swao.yml. A listing stats each
 * .swao.yml and re-reads only new or changed apps, so an unchanged workspace
 * of 235 apps opens no .swao.yml. New, renamed and deleted app folders are
 * picked up by the folder listing itself (a new id has no entry, a gone id is
 * dropped), so app creation, rename and delete need no extra write.
 */
export const APP_INDEX_FILE = join('wsp', 'cache', 'app-index.json');
/** Bump when the entry shape or the kind or name rule changes. */
// 2: #4503, a YAML null app_name of a service app is no name (caches of version 1 are rebuilt).
export const APP_INDEX_VERSION = 2;

interface AppIndexEntry {
  kind: AppKind;
  name?: string;
  /** Size of apps/<id>/.swao.yml in bytes; -1 when the app has none. */
  size: number;
  mtimeMs: number;
}

/** Blanks (spaces, tabs, line breaks) collapsed to one space, trimmed; string code, no regex (CodeQL js/polynomial-redos). */
function collapseBlanks(s: string): string {
  return s.split(/\s/).filter((p) => p.length > 0).join(' ');
}

/** The top-level `app_name` of a service app by one line scan (no YAML parse, #4484). */
function serviceAppName(raw: string): string | undefined {
  const line = raw.split('\n').find((l) => l.startsWith('app_name') && l.slice(8).trimStart().startsWith(':'));
  if (!line) return undefined;
  let v = line.slice(line.indexOf(':') + 1).trim();
  const hash = v.indexOf(' #');
  if (hash >= 0) v = v.slice(0, hash).trim();
  const quoted = v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0];
  if (quoted) v = v.slice(1, -1);
  // #4503: an unquoted YAML null (null, Null, NULL, ~) is no name; the picker falls back to the app id.
  else if (v === '~' || /^(?:null|Null|NULL)$/.test(v)) return undefined;
  const name = collapseBlanks(v);
  return name ? name : undefined;
}

/** The YAML display name of an application app (app_name, else app.name). */
function yamlAppName(raw: string): string | undefined {
  try {
    const doc = loadYaml(raw) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object') return undefined;
    const app = doc['app'];
    const v = typeof doc['app_name'] === 'string' ? doc['app_name']
      : app && typeof app === 'object' && typeof (app as Record<string, unknown>)['name'] === 'string' ? (app as Record<string, unknown>)['name'] as string
        : undefined;
    const name = v === undefined ? undefined : collapseBlanks(v);
    return name ? name : undefined;
  } catch {
    return undefined;
  }
}

/** #4484: one read of an app .swao.yml; the YAML is parsed for application apps only. */
function scanApp(file: string, size: number, mtimeMs: number): AppIndexEntry {
  if (size < 0) return { kind: 'application', size, mtimeMs };
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8').slice(0, 100_000);
  } catch {
    return { kind: 'application', size: -1, mtimeMs: 0 };
  }
  const kind: AppKind = SERVICE_TYPE.test(raw) ? 'service' : 'application';
  const name = kind === 'service' ? serviceAppName(raw) : yamlAppName(raw);
  return { kind, ...(name ? { name } : {}), size, mtimeMs };
}

function readAppIndex(file: string): Record<string, AppIndexEntry> {
  try {
    const doc = JSON.parse(readFileSync(file, 'utf-8')) as { version?: unknown; apps?: unknown };
    if (doc.version !== APP_INDEX_VERSION || !doc.apps || typeof doc.apps !== 'object') return {};
    return doc.apps as Record<string, AppIndexEntry>;
  } catch {
    return {};
  }
}

/** The app folders under `<workspace>/apps`, applications first, each group sorted by id (#4484: through the app index). */
export function listWorkspaceApps(workspace: string | null): WorkspaceApp[] {
  if (!workspace) return [];
  const appsDir = join(workspace, 'apps');
  if (!existsSync(appsDir)) return [];
  let names: string[];
  try {
    names = readdirSync(appsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const indexFile = join(workspace, APP_INDEX_FILE);
  const index = readAppIndex(indexFile);
  const next: Record<string, AppIndexEntry> = {};
  let changed = Object.keys(index).length !== names.length;
  const apps: WorkspaceApp[] = names.map((id) => {
    const file = join(appsDir, id, '.swao.yml');
    let size = -1;
    let mtimeMs = 0;
    try {
      const st = statSync(file);
      if (st.isFile()) { size = st.size; mtimeMs = st.mtimeMs; }
    } catch { /* no .swao.yml: an application without settings */ }
    const cached = index[id];
    const hit = cached && cached.size === size && cached.mtimeMs === mtimeMs && (cached.kind === 'application' || cached.kind === 'service');
    const entry = hit ? cached : scanApp(file, size, mtimeMs);
    if (!hit) changed = true;
    next[id] = entry;
    return { id, kind: entry.kind, ...(entry.name ? { name: entry.name } : {}) };
  });
  if (changed) {
    try {
      mkdirSync(join(workspace, 'wsp', 'cache'), { recursive: true });
      writeFileSync(indexFile, JSON.stringify({ version: APP_INDEX_VERSION, apps: next }), 'utf-8');
    } catch { /* a cache: a read-only workspace still lists its apps */ }
  }
  const rank = (k: AppKind): number => (k === 'application' ? 0 : 1);
  return apps.sort((a, b) => rank(a.kind) - rank(b.kind) || a.id.localeCompare(b.id));
}

/**
 * The subject app stored by the setup: `assessment.subject_app`, else
 * `assessment.llm.subject_app` of the workspace .swao.yml. A line scan, so a
 * malformed file never blocks the picker.
 */
export function readSubjectApp(workspace: string | null): string | undefined {
  if (!workspace) return undefined;
  let raw: string;
  try {
    raw = readFileSync(join(workspace, '.swao.yml'), 'utf-8');
  } catch {
    return undefined;
  }
  const lines = raw.split(/\r?\n/);
  let inAssessment = false;
  let assessmentIndent = -1;
  let llmIndent = -1;
  let direct: string | undefined;
  let llm: string | undefined;
  for (const line of lines) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    const text = line.trim();
    if (indent === 0) {
      inAssessment = /^assessment\s*:\s*$/.test(text);
      assessmentIndent = -1;
      llmIndent = -1;
      continue;
    }
    if (!inAssessment) continue;
    if (assessmentIndent < 0) assessmentIndent = indent;
    if (llmIndent >= 0 && indent <= llmIndent) llmIndent = -1;
    const m = /^subject_app\s*:\s*['"]?([^'"#\s]+)['"]?/.exec(text);
    if (indent === assessmentIndent) {
      if (/^llm\s*:\s*$/.test(text)) { llmIndent = indent; continue; }
      if (m) direct = m[1];
    } else if (llmIndent >= 0 && indent > llmIndent && m) {
      llm = m[1];
    }
  }
  return direct ?? llm;
}

/**
 * Where the cursor starts in a list of grouped apps: the subject app when it
 * is listed, else the single application when there is exactly one, else the
 * first application, else 0. `offset` is the number of entries above the apps.
 */
export function preselectedAppIndex(apps: readonly WorkspaceApp[], subjectApp: string | undefined, offset = 0): number {
  const hit = subjectApp ? apps.findIndex((a) => a.id === subjectApp) : -1;
  if (hit >= 0) return offset + hit;
  return offset;
}

/**
 * #4400 / #4490: the note under a list of application apps when the workspace
 * has service apps; null when there are none. Shared by the Application
 * Assessment app picker and the Application Assessment and LLM setup steps.
 */
export function serviceAppsNoteText(serviceApps: number): string | null {
  const n = serviceApps;
  if (n <= 0) return null;
  return `${n} service ${n === 1 ? 'app is' : 'apps are'} not listed: the Service Portfolio Assessment in the main menu assesses ${n === 1 ? 'it' : 'them'}.`;
}
