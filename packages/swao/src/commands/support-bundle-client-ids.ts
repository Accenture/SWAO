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

// #3517: client identifiers and known secrets in the support bundle (v2.5).
//
// A support bundle leaves the client environment. Bundle v2.4 (#3437) still
// carried client application IDs (system names) in every file, and the names of
// client input documents in workspace-structure.json and the execution trace.
// This module adds the last pass over every bundle entry, after the existing
// host / path / user-identity passes:
//
//   1. App IDs -> `<app-xxxxxx>` (HMAC with the per-bundle salt: stable inside
//      one bundle, not reversible by hashing guessed IDs). Matched case-
//      insensitively wherever the ID stands as its own run of `-` / `_` / `.`
//      separated segments, so `apps/<id>/wsp`, `<id>.json` and
//      `swao-<id>-report.html` are all covered. Also applied to entry names.
//      App display names (`app_name` / `name`) -> `<appname-xxxxxx>`. Intake
//      workbook sheet and column header names -> `<sheet-xxxxxx>` / `<column-xxxxxx>`
//      (workspace-config.json keeps only their counts, support-bundle.ts).
//   2. Client file names (inputs, ingestion, intake workbooks, application
//      source) -> `<file-xxxxxxxx.ext>`: exact name, and the stem of names with
//      a stem of at least 6 characters.
//   3. workspace-structure.json keeps directory shape, sizes and extensions;
//      every name below an `inputs` / `ingestion` / `source` folder, and every
//      name that is not SWAO-shaped (lower-case ASCII, digits, `.`, `_`, `-`),
//      is replaced by `<name-xxxxxxxx.ext>`.
//   4. Secret and PII pass on every value: e-mail, IPv4 / IPv6, URL user info,
//      token shapes and user paths (redactPiiValue), credential values and
//      secret shapes (guardSecretsDeep, #3415), and every known secret value
//      (masked wherever it occurs, raw or JSON-escaped).
//   5. Refusal guard: if a known secret value still occurs in any entry name or
//      content, the bundle is not written.
//
// Known secrets: SWAO masks detected values in its own findings (#3415), so
// the values are re-derived the way Pass 03 derives them
// (extractCredentialValues) from the client's input and source files, the run
// artefacts (runs written before #3415 may hold them unmasked) and chat
// history. The values are held in memory only and are never logged or written.
//
// The pseudonym -> original mapping is returned to the caller, which writes it
// to a local file outside the archive.

import { createHmac } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { extractCredentialValues, guardSecretsDeep, guardSecretText, maskKnownSecret, redactPiiString, redactPiiValue, type RedactionCounts } from '@swao/core';

export type PseudonymTag = (kind: string, value: string) => string;

/** HMAC-SHA256 prefix keyed by the per-bundle salt (same scheme as support-bundle-redact.ts). */
export function pseudonymTag(salt: string): PseudonymTag {
  return (kind, value) => createHmac('sha256', salt).update(`${kind}:${value}`).digest('hex');
}

export interface ClientIdentifiers {
  /** App IDs, lower-case. */
  appIds: Set<string>;
  /** Client file names (basename with extension), lower-case. */
  fileNames: Set<string>;
  /** Title-like stems of client documents (not source files), lower-case. */
  stems: Set<string>;
  /** Distinctive app display names (`app_name` / `name`), as written; optional for callers. */
  appNames?: Set<string>;
  /** Intake workbook sheet names, as written (#3517: never in the bundle). */
  sheetNames?: Set<string>;
  /** Intake spreadsheet column header names, as written (#3517: never in the bundle). */
  columnHeaders?: Set<string>;
  /** Folders whose walk hit its budget: names there may be missing (fallback scrub applies). */
  truncated?: string[];
}

/** Folders whose content is client material (names hashed in workspace-structure.json). */
const CLIENT_DIRS = new Set(['inputs', 'ingestion', 'source', 'service-intake']);
/** Never walked: dependency caches and VCS metadata (large, not client documents). */
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', 'target', 'build', 'dist', '.gradle', '.idea', '.vs']);
/** Generic file names that identify no client (kept verbatim). */
export const GENERIC_NAMES: ReadonlySet<string> = new Set([
  'readme.md', 'readme.txt', 'readme', 'license', 'license.md', 'license.txt', 'changelog.md', 'package.json', 'package-lock.json',
  'pnpm-lock.yaml', 'yarn.lock', 'tsconfig.json', 'pom.xml', 'build.gradle', 'settings.gradle', 'dockerfile', 'makefile',
  'index.ts', 'index.js', 'index.html', 'main.py', 'main.go', 'main.java', 'app.py', 'setup.py', 'requirements.txt',
  '.gitignore', '.gitkeep', '.swao.yml', 'manifest.json', 'ingestion-manifest.json', 'confidence.json', 'binary-analysis.json',
  'run-manifest.json', 'run-status.json', 'latest.txt', 'latest-service.txt', 'scope-coverage.json', 'portfolio-summary.json',
  'scaffold-signals.json', 'execution-trace.ndjson', 'error-context.json', 'workspace-structure.json', 'run-manifests.json',
]);
/** SWAO-generated folders under wsp/inputs/ (research stubs, binary analysis, catalogues): not client file names. */
const SWAO_INPUT_DIRS = new Set(['research', 'binary', 'catalogs', 'llm-gateway', 'yara-rules', 'cache', 'pass-catalogs']);
const MIN_ID_LEN = 3;
const MIN_STEM_LEN = 6;

/** Walk budgets (#3517); per folder, so one large source tree cannot starve the others. Mutable for tests. */
export const _collectLimits = {
  /** Directory entries per walked folder. */
  entriesPerFolder: 20_000,
  /** Bytes of text scanned for secret values per app (and for the workspace level). */
  secretBytesPerApp: 16 * 1024 * 1024,
  /** Largest single file scanned for secret values. */
  secretFileBytes: 1024 * 1024,
};

function readYamlSafe(p: string): Record<string, unknown> | null {
  try {
    const v = loadYaml(readFileSync(p, 'utf-8'));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function listDirs(p: string): string[] {
  try { return readdirSync(p).filter((n) => isDir(join(p, n))).sort(); } catch { return []; }
}

interface WalkBudget { left: number; truncated: boolean }

/** Walk a folder, calling `onFile` for each regular file; skips `skipNames` and the absolute `skipPaths`. */
function walkClientDir(
  dir: string,
  onFile: (name: string, full: string, size: number) => void,
  budget: WalkBudget,
  skipNames: ReadonlySet<string>,
  skipPaths: ReadonlySet<string> = new Set(),
  depth = 0,
): void {
  if (depth > 12) { budget.truncated = true; return; }
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (budget.left-- <= 0) { budget.truncated = true; return; }
    const full = join(dir, n);
    let st: ReturnType<typeof statSync>;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (!skipNames.has(n.toLowerCase()) && !skipPaths.has(resolve(full).toLowerCase())) walkClientDir(full, onFile, budget, skipNames, skipPaths, depth + 1);
    } else if (st.isFile()) {
      onFile(n, full, st.size);
    }
  }
}

/** A stem that reads like a document title (digit, upper-case letter, space or separator), not an ordinary word. */
const TITLE_LIKE = /[0-9A-Z\s._-]/;

function addFileName(ids: ClientIdentifiers, name: string, withStem: boolean): void {
  const base = name.split(/[\\/]/).pop() ?? '';
  const lower = base.toLowerCase();
  if (!lower || GENERIC_NAMES.has(lower)) return;
  if (lower.replace(/\.[^.]*$/, '').length < 3) return;
  ids.fileNames.add(lower);
  if (!withStem) return;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  if (stem.length >= MIN_STEM_LEN && TITLE_LIKE.test(stem)) ids.stems.add(stem.toLowerCase());
}

export interface ClientFolder {
  dir: string;
  /** 'docs': documents, intake, ingestion (names and title stems); 'source': application source (exact names only). */
  kind: 'docs' | 'source';
  /** App the folder belongs to; null for the workspace level. */
  app: string | null;
}

/**
 * Client folders of a workspace: wsp/inputs, apps/<id>/wsp/inputs, apps/<id>/ingestion
 * (documents) and an app's source path (source). Document walks skip the source
 * folders, so no tree is walked twice; documents come first.
 */
export function clientFolders(workspaceRoot: string): ClientFolder[] {
  const docs: ClientFolder[] = [{ dir: join(workspaceRoot, 'wsp', 'inputs'), kind: 'docs', app: null }];
  const sources: ClientFolder[] = [];
  const appsDir = join(workspaceRoot, 'apps');
  for (const id of listDirs(appsDir)) {
    docs.push({ dir: join(appsDir, id, 'wsp', 'inputs'), kind: 'docs', app: id }, { dir: join(appsDir, id, 'ingestion'), kind: 'docs', app: id });
    const doc = readYamlSafe(join(appsDir, id, '.swao.yml'));
    const src = (doc?.['source'] as { path?: unknown } | undefined)?.path;
    const srcDir = typeof src === 'string' && src && !src.includes('..') && !/^([A-Za-z]:)?[\\/]/.test(src) ? join(appsDir, id, src) : join(appsDir, id, 'wsp', 'inputs', 'source');
    sources.push({ dir: srcDir, kind: 'source', app: id });
  }
  const seen = new Set<string>();
  return [...docs, ...sources].filter((f) => {
    const key = resolve(f.dir).toLowerCase();
    if (seen.has(key) || !existsSync(f.dir)) return false;
    seen.add(key);
    return true;
  });
}

const sourcePaths = (folders: readonly ClientFolder[]): Set<string> =>
  new Set(folders.filter((f) => f.kind === 'source').map((f) => resolve(f.dir).toLowerCase()));

/**
 * Collect the client identifiers of a workspace: app folder names (apps/ and
 * parked-apps/), app IDs named in the logs, cluster members, distinctive app
 * names, and client file names (documents with title stems, source files by
 * exact name). A folder whose walk hits its budget is listed in `truncated`.
 */
export function collectClientIdentifiers(workspaceRoot: string, extraAppIds: Iterable<string> = []): ClientIdentifiers {
  const ids: ClientIdentifiers = { appIds: new Set(), fileNames: new Set(), stems: new Set(), appNames: new Set(), truncated: [] };
  const addId = (id: unknown): void => {
    if (typeof id === 'string' && id.trim().length >= MIN_ID_LEN) ids.appIds.add(id.trim().toLowerCase());
  };
  for (const id of listDirs(join(workspaceRoot, 'apps'))) addId(id);
  for (const stamp of listDirs(join(workspaceRoot, 'parked-apps'))) for (const id of listDirs(join(workspaceRoot, 'parked-apps', stamp))) addId(id);
  for (const id of extraAppIds) addId(id);
  // Service portfolio: intake workbook and column map.
  const ws = readYamlSafe(join(workspaceRoot, '.swao.yml'));
  const sp = ws?.['service_portfolio'] as { source?: unknown; mapping?: unknown; sheets?: unknown; headers?: unknown } | undefined;
  if (typeof sp?.source === 'string') addFileName(ids, sp.source, true);
  if (typeof sp?.mapping === 'string') addFileName(ids, sp.mapping, true);
  // #3517: sheet and column header names of the client's workbook.
  ids.sheetNames = new Set();
  ids.columnHeaders = new Set();
  const addSheet = (v: unknown): void => { if (typeof v === 'string' && v.trim().length >= MIN_ID_LEN) ids.sheetNames!.add(v.trim()); };
  if (Array.isArray(sp?.sheets)) for (const s of sp.sheets) addSheet(s);
  if (sp?.headers && typeof sp.headers === 'object') {
    for (const [sheet, cols] of Object.entries(sp.headers as Record<string, unknown>)) {
      addSheet(sheet);
      if (cols && typeof cols === 'object') {
        for (const h of Object.values(cols as Record<string, unknown>)) {
          if (typeof h === 'string' && h.trim().length >= MIN_ID_LEN) ids.columnHeaders.add(h.trim());
        }
      }
    }
  }
  if (typeof sp?.mapping === 'string' && !sp.mapping.includes('..') && !/^([A-Za-z]:)?[\\/]/.test(sp.mapping)) {
    const map = readYamlSafe(join(workspaceRoot, sp.mapping));
    addSheet((map?.['source'] as { sheet?: unknown } | undefined)?.sheet);
  }
  for (const id of listDirs(join(workspaceRoot, 'apps'))) {
    const doc = readYamlSafe(join(workspaceRoot, 'apps', id, '.swao.yml'));
    for (const k of ['app_name', 'name']) {
      const v = doc?.[k];
      // Distinctive names only (space, digit or inner capital): a one-word name such as
      // "Export" would otherwise rename ordinary words in every file.
      if (typeof v === 'string' && v.trim().length >= 4 && !v.trim().startsWith('[') && /\s|\d|.[A-Z]/.test(v.trim())) ids.appNames!.add(v.trim());
    }
    const members = doc?.['cluster_members'];
    if (Array.isArray(members)) for (const m of members) addId(m);
    const src = (doc?.['intake'] as { source?: unknown } | undefined)?.source;
    if (typeof src === 'string') addFileName(ids, src, true);
  }
  const folders = clientFolders(workspaceRoot);
  const srcPaths = sourcePaths(folders);
  const skipForNames = new Set([...SKIP_DIRS, ...SWAO_INPUT_DIRS]);
  for (const f of folders) {
    const budget: WalkBudget = { left: _collectLimits.entriesPerFolder, truncated: false };
    walkClientDir(f.dir, (name) => addFileName(ids, name, f.kind === 'docs'), budget, skipForNames, f.kind === 'docs' ? srcPaths : new Set());
    if (budget.truncated) ids.truncated!.push(`${f.app ?? '(workspace)'}:${f.kind}`);
  }
  return ids;
}

const CONFIG_TEXT = /\.(ini|xml|conf|cfg|config|json|ndjson|env|properties|ya?ml|toml|txt|md|reg|sql|sh|ps1|bat|cmd|py|js|ts|java|cs|go|rb|php|kt|scala|tf|tfvars|groovy|gradle|jsp|vb|cbl|cob)$/i;

export interface KnownSecrets {
  /** Values, longest first. Memory only; never log them. */
  values: string[];
  /** Apps (or '(workspace)') whose scan hit a budget. */
  truncated: string[];
}

/**
 * Known secret values for masking and the refusal guard: credential literals
 * (as Pass 03 finds them, extractCredentialValues) in chat history and run
 * artefacts first, then the client's documents and source files. Per-app byte
 * budgets; never log the values.
 */
export function collectKnownSecrets(workspaceRoot: string): KnownSecrets {
  const found = new Set<string>();
  const truncated: string[] = [];
  const folders = clientFolders(workspaceRoot);
  const srcPaths = sourcePaths(folders);
  const groups = new Map<string, string[]>([['(workspace)', [join(workspaceRoot, 'wsp', 'chat')]]]);
  for (const id of listDirs(join(workspaceRoot, 'apps'))) groups.set(id, [join(workspaceRoot, 'apps', id, 'wsp', 'runs')]);
  for (const f of folders) groups.get(f.app ?? '(workspace)')?.push(f.dir);
  for (const [app, dirs] of groups) {
    let bytes = 0;
    let hitBudget = false;
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      const budget: WalkBudget = { left: _collectLimits.entriesPerFolder, truncated: false };
      const isSource = srcPaths.has(resolve(dir).toLowerCase());
      walkClientDir(dir, (name, full, size) => {
        if (!CONFIG_TEXT.test(name)) return;
        if (size > _collectLimits.secretFileBytes || bytes + size > _collectLimits.secretBytesPerApp) { hitBudget = true; return; }
        bytes += size;
        let text: string;
        try { text = readFileSync(full, 'utf-8'); } catch { return; }
        for (const v of extractCredentialValues(text)) found.add(v);
      }, budget, SKIP_DIRS, isSource ? new Set() : srcPaths);
      if (budget.truncated) hitBudget = true;
    }
    if (hitBudget) truncated.push(app);
  }
  return { values: [...found].sort((a, b) => b.length - a.length), truncated };
}

/** JSON-escaped form of a value (as it appears inside serialised JSON text). */
const jsonEscaped = (v: string): string => JSON.stringify(v).slice(1, -1);

export interface ClientIdCounts {
  app_ids: number;
  app_names: number;
  /** Sheet and column header names of the intake workbook (#3517). */
  workbook_names: number;
  file_names: number;
  structure_names: number;
  secrets_masked: number;
  pii_values: number;
  /** Client folders (and apps for the secret scan) whose collection hit a budget; the fallback scrub then applies. */
  collection_truncated: number;
  /** Tokens replaced by the file-shape fallback scrub. */
  fallback_file_tokens: number;
}

export interface ClientIdPseudonymiser {
  readonly counts: ClientIdCounts;
  /** Pseudonym -> original value. Local use only: never put it into the bundle. */
  readonly mapping: Record<string, string>;
  /** Replace app IDs and client file names in free or serialised text. */
  scrub(text: string): string;
  /** Pseudonymise one workspace-structure path (keeps shape and extension). */
  structurePath(path: string): string;
  /** A bundle entry name: only the `<id>` of `service/apps/<id>/...` is replaced; SWAO's fixed names stay. */
  entryName(name: string): string;
  /** Fallback when collection was truncated: every document- or source-shaped file token in values. */
  scrubFileShapes(text: string): string;
}

const ID_TOKEN_RE = /[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/g;
// A file-name token: no separator, quote, bracket or whitespace; may hold dots, dashes, underscores, umlauts.
const FILE_TOKEN_RE = /[^\s"'`<>|:*?\\/,;=()[\]{}]+/g;
const SAFE_SWAO_NAME = /^[a-z0-9][a-z0-9._-]*$/;

export function createClientIdPseudonymiser(ids: ClientIdentifiers, tag: PseudonymTag): ClientIdPseudonymiser {
  const counts: ClientIdCounts = {
    app_ids: 0, app_names: 0, workbook_names: 0, file_names: 0, structure_names: 0, secrets_masked: 0, pii_values: 0,
    collection_truncated: ids.truncated?.length ?? 0, fallback_file_tokens: 0,
  };
  const mapping: Record<string, string> = {};
  const seenApp = new Set<string>();
  const seenFile = new Set<string>();

  const appPh = (id: string): string => {
    const key = id.toLowerCase();
    const ph = `<app-${tag('app', key).slice(0, 6)}>`;
    if (!seenApp.has(key)) { seenApp.add(key); counts.app_ids++; mapping[ph] = key; }
    return ph;
  };
  const extOf = (name: string): string => {
    const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
    return m ? `.${m[1]!.toLowerCase()}` : '';
  };
  const filePh = (name: string, kind = 'file'): string => {
    const key = name.toLowerCase();
    const ph = `<${kind}-${tag(kind, key).slice(0, 8)}${extOf(name)}>`;
    if (!seenFile.has(`${kind}:${key}`)) { seenFile.add(`${kind}:${key}`); if (kind === 'file') counts.file_names++; else counts.structure_names++; mapping[ph] = name; }
    return ph;
  };

  // Token callbacks skip existing placeholders (`<kind-...>`) and keep the
  // escaped character of a JSON escape sequence (backslash-n, backslash-t) out
  // of the token, so a name right after an escaped newline in serialised text
  // is still found and the escape stays valid.
  const escapeAware = (fn: (t: string) => string) => (tok: string, offset: number, whole: string): string => {
    const prev = offset > 0 ? whole[offset - 1] : '';
    if (prev === '<') return tok;
    if (prev === '\\' && 'ntrbf'.includes(tok[0]!)) return tok[0]! + (tok.length > 1 ? fn(tok.slice(1)) : '');
    return fn(tok);
  };

  // App IDs: any contiguous run of separator-joined segments of a token that equals an ID.
  const scrubIds = (text: string): string => {
    if (ids.appIds.size === 0) return text;
    return text.replace(ID_TOKEN_RE, escapeAware((tok) => {
      const parts = tok.split(/([._-])/); // segments at even, separators at odd indexes
      const segs = parts.filter((_, i) => i % 2 === 0);
      if (segs.length === 1) return ids.appIds.has(tok.toLowerCase()) ? appPh(tok) : tok;
      const out: string[] = [];
      let i = 0;
      while (i < segs.length) {
        let matchedEnd = -1;
        for (let j = segs.length - 1; j >= i; j--) {
          const cand = parts.slice(i * 2, j * 2 + 1).join('');
          if (ids.appIds.has(cand.toLowerCase())) { matchedEnd = j; break; }
        }
        if (matchedEnd >= 0) {
          out.push(appPh(parts.slice(i * 2, matchedEnd * 2 + 1).join('')));
          if (matchedEnd * 2 + 1 < parts.length) out.push(parts[matchedEnd * 2 + 1]!);
          i = matchedEnd + 1;
        } else {
          out.push(segs[i]!);
          if (i * 2 + 1 < parts.length) out.push(parts[i * 2 + 1]!);
          i++;
        }
      }
      return out.join('');
    }));
  };

  const isJsonKey = (whole: string, end: number): boolean => whole.startsWith('":', end);
  const scrubFiles = (text: string): string => {
    if (ids.fileNames.size === 0 && ids.stems.size === 0) return text;
    return text.replace(FILE_TOKEN_RE, (tok: string, offset: number, whole: string) => (isJsonKey(whole, offset + tok.length) ? tok : escapeAware((t) => {
      // Trailing sentence punctuation stays outside the placeholder.
      let end = t.length;
      while (end > 1 && t[end - 1] === '.') end--;
      const core = t.slice(0, end);
      const lower = core.toLowerCase();
      if (ids.fileNames.has(lower) || ids.stems.has(lower)) return filePh(core) + t.slice(end);
      return t;
    })(tok, offset, whole)));
  };

  // File names with spaces (document titles) cannot be found token-wise.
  const spaced = [...ids.fileNames, ...ids.stems].filter((n) => /\s/.test(n)).sort((a, b) => b.length - a.length).slice(0, 2000);
  const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const spacedRe = spaced.length > 0 ? new RegExp(`(?<![A-Za-z0-9])(?:${spaced.map(escapeRe).join('|')})(?![A-Za-z0-9])`, 'gi') : null;

  // App display names (may contain spaces): whole-phrase match, case-insensitive.
  const names = [...(ids.appNames ?? [])].sort((a, b) => b.length - a.length).slice(0, 5000);
  // `_` and `/` count as word characters, so `service/...` paths and `service_*` keys are never hit.
  const namesRe = names.length > 0 ? new RegExp(`(?<![A-Za-z0-9_/])(?:${names.map(escapeRe).join('|')})(?![A-Za-z0-9_/])`, 'gi') : null;
  const namePh = (n: string): string => {
    const key = n.toLowerCase();
    const ph = `<appname-${tag('appname', key).slice(0, 6)}>`;
    if (!(ph in mapping)) { counts.app_names++; mapping[ph] = n; }
    return ph;
  };

  // #3517: workbook sheet and column header names, exact case, whole phrase, values only.
  const phraseRe = (list: Iterable<string>): RegExp | null => {
    const xs = [...list].sort((a, b) => b.length - a.length).slice(0, 5000);
    return xs.length > 0 ? new RegExp(`(?<![A-Za-z0-9_/])(?:${xs.map(escapeRe).join('|')})(?![A-Za-z0-9_/])`, 'g') : null;
  };
  const sheetRe = phraseRe(ids.sheetNames ?? []);
  const headerRe = phraseRe(ids.columnHeaders ?? []);
  const workbookPh = (kind: 'sheet' | 'column') => (m: string, offset: number, whole: string): string => {
    if ((offset > 0 && whole[offset - 1] === '<') || isJsonKey(whole, offset + m.length)) return m;
    const ph = `<${kind}-${tag(kind, m).slice(0, 6)}>`;
    if (!(ph in mapping)) { counts.workbook_names++; mapping[ph] = m; }
    return ph;
  };

  const scrub = (text: string): string => {
    let out = namesRe ? text.replace(namesRe, (m: string, offset: number, whole: string) =>
      ((offset > 0 && whole[offset - 1] === '<') || isJsonKey(whole, offset + m.length) ? m : namePh(m))) : text;
    out = sheetRe ? out.replace(sheetRe, workbookPh('sheet')) : out;
    out = headerRe ? out.replace(headerRe, workbookPh('column')) : out;
    out = spacedRe ? out.replace(spacedRe, (m) => filePh(m)) : out;
    out = scrubFiles(out);
    return scrubIds(out);
  };

  const isTimestamp = (s: string): boolean => /^\d{4}-?\d{2}-?\d{2}T[\d:.-]+Z?$/.test(s) || /^\d{8}T\d{6}Z?$/.test(s);
  const structurePath = (path: string): string => {
    const segs = path.split(/[\\/]/);
    let inClient = false;
    const out = segs.map((seg, i) => {
      if (i === 1 && segs[0] === 'apps') return appPh(seg);
      const res = inClient || !(SAFE_SWAO_NAME.test(seg) || isTimestamp(seg)) ? filePh(seg, 'name') : scrub(seg);
      if (CLIENT_DIRS.has(seg.toLowerCase())) inClient = true;
      return res;
    });
    return out.join('/');
  };

  const entryName = (name: string): string =>
    name.replace(/^service\/apps\/([^/]+)\//, (_m, id: string) => `service/apps/${appPh(id)}/`);

  const scrubFileShapes = (text: string): string => text.replace(FILE_TOKEN_RE, (tok: string, offset: number, whole: string) =>
    (isJsonKey(whole, offset + tok.length) ? tok : escapeAware((t) => {
      let end = t.length;
      while (end > 1 && t[end - 1] === '.') end--;
      const core = t.slice(0, end);
      if (!CLIENT_FILE_SHAPE.test(core) || GENERIC_NAMES.has(core.toLowerCase())) return t;
      counts.fallback_file_tokens++;
      return filePh(core) + t.slice(end);
    })(tok, offset, whole)));

  return { counts, mapping, scrub, structurePath, entryName, scrubFileShapes };
}

/** Document and source file shapes for the fallback scrub (SWAO's own JSON / YAML / NDJSON names are not matched). */
const CLIENT_FILE_SHAPE = /^[^.]+(?:\.[^.]+)*\.(?:pdf|docx?|xlsx?|xlsm|pptx?|odt|ods|rtf|csv|msg|eml|vsdx?|txt|properties|ini|conf|cfg|config|xml|sql|java|cs|py|js|ts|go|rb|php|kt|scala|cbl|cob|jsp|vb|sh|ps1|bat|exe|dll|msi|jar|war|ear|zip)$/i;

/**
 * Secret and PII pass over one entry (#3517 item 4): JSON and NDJSON are
 * parsed and walked value by value (keys stay, JSON stays valid); other text
 * is scrubbed as a whole. Known secrets are masked in every form.
 */
export function finalSecretPass(name: string, text: string, knownSecrets: readonly string[], piiCounts: RedactionCounts, counts: ClientIdCounts): string {
  const before = { ...piiCounts };
  const deep = (v: unknown): unknown => {
    const pii = redactPiiValue(v, piiCounts);
    const g = guardSecretsDeep(pii);
    counts.secrets_masked += g.count;
    return g.value;
  };
  let out = text;
  if (name.endsWith('.json')) {
    try { out = `${JSON.stringify(deep(JSON.parse(text)), null, 2)}\n`; } catch { out = scrubPlain(text); }
  } else if (name.endsWith('.ndjson')) {
    out = text.split('\n').map((line) => {
      if (!line.trim()) return line;
      try { return JSON.stringify(deep(JSON.parse(line))); } catch { return scrubPlain(line); }
    }).join('\n');
  } else {
    out = scrubPlain(text);
  }
  for (const s of knownSecrets) {
    for (const form of new Set([s, jsonEscaped(s)])) {
      if (out.includes(form)) {
        out = maskKnownSecret(out, form);
        counts.secrets_masked++;
      }
    }
  }
  counts.pii_values += Object.keys(piiCounts).reduce((n, k) => n + (piiCounts[k as keyof RedactionCounts] - before[k as keyof RedactionCounts]), 0);
  return out;

  function scrubPlain(t: string): string {
    const g = guardSecretText(redactPiiString(t, piiCounts));
    counts.secrets_masked += g.count;
    return g.text;
  }
}

/**
 * Refusal guard (#3517 item 4): names of the entries in which a known secret
 * value (raw or JSON-escaped) still occurs, in the entry name or content.
 * Returns entry names only, never the value.
 */
export function entriesWithKnownSecrets(entries: ReadonlyArray<{ name: string; content: Buffer }>, knownSecrets: readonly string[]): string[] {
  const hits: string[] = [];
  for (const e of entries) {
    const text = e.content.toString('utf-8');
    if (knownSecrets.some((s) => [s, jsonEscaped(s)].some((f) => f.length >= 3 && (text.includes(f) || e.name.includes(f))))) hits.push(e.name);
  }
  return hits;
}
