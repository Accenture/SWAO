// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module -- SWAO LLM-Gateway connector loader
//  (Design 090 Section 6.1, #1395)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseConnectorYaml, type ConnectorFile } from './connector-schema.js';

/** Name of the seed manifest: records the sha256 of each file as it was seeded,
 *  so `swao llm-gateway update` can tell an unchanged seed from a user edit. */
const SEED_MANIFEST = '.seeded.json';

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

type SeedManifest = { files: Record<string, string> };

function readSeedManifest(dir: string): SeedManifest {
  try {
    const raw = JSON.parse(readFileSync(join(dir, SEED_MANIFEST), 'utf-8')) as SeedManifest;
    if (raw && typeof raw === 'object' && raw.files && typeof raw.files === 'object') return raw;
  } catch { /* none or unreadable */ }
  return { files: {} };
}

function writeSeedManifest(dir: string, m: SeedManifest): void {
  try { writeFileSync(join(dir, SEED_MANIFEST), JSON.stringify(m, null, 2) + '\n', 'utf-8'); } catch { /* non-fatal */ }
}

// #3388 (CLAUDE.md 5.7): client-private connectors are never seeded into a
// workspace. A private connector file marks itself with this comment line
// (scripts/build-lib.mjs reads the same marker and leaves such files out of
// the binary), so no client name appears in public code. A comment, not a
// YAML key: the connector schema is strict and the client's own copy of the
// file must keep parsing.
export const PRIVATE_SEED_MARKER = '# swao-distribution: private';

/** True when a connector file's text carries the private-distribution marker line. */
export function isPrivateSeedConnector(text: string): boolean {
  return text.split(/\r?\n/).some((line) => line.trim() === PRIVATE_SEED_MARKER);
}

/** A packaged connector file eligible for seeding into a workspace (not private, not a template). */
function isSeedableConnectorFile(dir: string, f: string): boolean {
  if (!(f.endsWith('.yaml') || f.endsWith('.yml')) || f.startsWith('_')) return false;
  try { return !isPrivateSeedConnector(readFileSync(join(dir, f), 'utf-8')); } catch { return false; }
}

/**
 * #3388 (#1380): copy a packaged connector into the workspace with read+write.
 * `copyFileSync` is not reliable from a pkg binary snapshot; every loader here
 * already reads the bundle with `readFileSync`, so read+write is the safe copy.
 */
function copyConnectorFile(from: string, to: string): void {
  writeFileSync(to, readFileSync(from));
}

/**
 * Connector directory resolution (Design 090 Section 5; Design 112 D-3).
 *
 * #3388 (D-3): the workspace folder is the single source of truth -- the
 * implicit bundled read-through was removed. Callers that want an unseeded
 * workspace to self-heal pass `seedIfEmpty` (see listConnectors), which copies
 * the packaged seeds INTO the workspace so they become editable there, instead
 * of being read through from the binary. CI/tests use `overrideDir`.
 *
 * Precedence -- FIRST directory containing a given connector id wins:
 *   1. explicit override (tests / advanced callers / CI)
 *   2. <workspaceRoot>/wsp/inputs/llm-gateway   (the single source)
 */
function candidateDirs(override?: string, workspaceRoot?: string): string[] {
  return [
    override,
    workspaceRoot ? join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway') : undefined,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
}

/** #3388: the first bundled connector directory that exists, or null. */
export function resolveBundledConnectorsDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const d of [
    resolve(here, '_llm-gateway'),
    resolve(here, '../_llm-gateway'),
    resolve(here, '../../../../../llm-gateway'),
    resolve(here, '../../../../llm-gateway'),
  ]) {
    try { if (existsSync(d) && readdirSync(d).some(f => f.endsWith('.yaml'))) return d; } catch { /* next */ }
  }
  return null;
}

/**
 * #3388 (Design 112, D-3): copy the packaged connector files into the workspace
 * `wsp/inputs/llm-gateway/` so they are the single, editable source (the runtime
 * bundled read-through was removed). Never overwrites an existing file. A
 * `.seeded` marker lists what was seeded so a file the user deletes is not
 * re-created, and a `.seeded.json` manifest records each seeded file's hash so
 * `swao llm-gateway update` can distinguish an unchanged seed from a user edit.
 * Best-effort; returns what it copied.
 */
export function seedBundledConnectors(workspaceRoot: string): { copied: string[]; dir: string | null } {
  const src = resolveBundledConnectorsDir();
  if (!src) return { copied: [], dir: null };
  const dest = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(dest, { recursive: true });
  const marker = join(dest, '.seeded');
  const already = new Set<string>(
    existsSync(marker) ? readFileSync(marker, 'utf-8').split('\n').filter(Boolean) : [],
  );
  const manifest = readSeedManifest(dest);
  const copied: string[] = [];
  for (const f of readdirSync(src).filter((name) => isSeedableConnectorFile(src, name))) {
    const to = join(dest, f);
    if (existsSync(to) || already.has(f)) continue;
    try {
      copyConnectorFile(join(src, f), to);
      copied.push(f); already.add(f);
      manifest.files[f] = sha256(to);
    } catch { /* skip one file */ }
  }
  if (copied.length > 0) {
    try { writeFileSync(marker, [...already].sort().join('\n') + '\n', 'utf-8'); } catch { /* non-fatal */ }
    writeSeedManifest(dest, manifest);
  }
  return { copied, dir: dest };
}

/** Per-file outcome of `swao llm-gateway update` (#3388 step 4, Design 112 D-2). */
export interface ConnectorUpdateResult {
  /** Packaged connectors not in the workspace, now copied in. */
  added: string[];
  /** Seeds the user had not changed; refreshed to the new packaged version. */
  updated: string[];
  /** Files the user edited (differ from the seeded hash); left untouched. */
  keptModified: string[];
  /** Workspace copies already identical to the packaged version. */
  upToDate: string[];
  dir: string | null;
}

/**
 * #3388 step 4 (Design 112 D-2): refresh the workspace connector folder from the
 * packaged seeds on request (never at start-up). An unchanged seed (its hash
 * still matches the `.seeded.json` manifest) is replaced with the newer packaged
 * version; a file the user edited is kept and reported; a packaged connector the
 * workspace lacks is added; identical files are left alone. `dryRun` reports the
 * matrix without writing.
 */
export function updateBundledConnectors(workspaceRoot: string, opts?: { dryRun?: boolean; srcDir?: string }): ConnectorUpdateResult {
  const result: ConnectorUpdateResult = { added: [], updated: [], keptModified: [], upToDate: [], dir: null };
  const src = opts?.srcDir ?? resolveBundledConnectorsDir();
  if (!src) return result;
  const dest = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
  result.dir = dest;
  if (!opts?.dryRun) mkdirSync(dest, { recursive: true });
  const manifest = readSeedManifest(dest);
  const marker = join(dest, '.seeded');
  const seededList = new Set<string>(existsSync(marker) ? readFileSync(marker, 'utf-8').split('\n').filter(Boolean) : []);

  for (const f of readdirSync(src).filter((name) => isSeedableConnectorFile(src, name))) {
    const from = join(src, f);
    const to = join(dest, f);
    const pkgHash = sha256(from);
    if (!existsSync(to)) {
      if (!opts?.dryRun) { try { copyConnectorFile(from, to); } catch { continue; } }
      result.added.push(f); manifest.files[f] = pkgHash; seededList.add(f);
      continue;
    }
    const wsHash = sha256(to);
    if (wsHash === pkgHash) { result.upToDate.push(f); manifest.files[f] = pkgHash; continue; }
    const seededHash = manifest.files[f];
    if (seededHash && wsHash === seededHash) {
      // Unchanged since seeding -> safe to refresh to the new packaged version.
      if (!opts?.dryRun) { try { copyConnectorFile(from, to); } catch { continue; } }
      result.updated.push(f); manifest.files[f] = pkgHash;
    } else {
      // User-edited (or no seed hash to be sure): never clobber.
      result.keptModified.push(f);
    }
  }
  if (!opts?.dryRun && (result.added.length > 0 || result.updated.length > 0)) {
    try { writeFileSync(marker, [...seededList].sort().join('\n') + '\n', 'utf-8'); } catch { /* non-fatal */ }
    writeSeedManifest(dest, manifest);
  }
  return result;
}

export interface LoadedConnector {
  file: ConnectorFile;
  /** Absolute path of the YAML file the connector was loaded from. */
  path: string;
  /** 'workspace' when loaded from the workspace dir, 'bundled' otherwise. */
  origin: 'workspace' | 'bundled';
}

export interface ListConnectorsResult {
  connectors: LoadedConnector[];
  /** Human-readable skip reasons for invalid files -- never fatal. */
  warnings: string[];
}

function isWorkspaceDir(dir: string, workspaceRoot?: string): boolean {
  if (!workspaceRoot) return false;
  return resolve(dir) === resolve(join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway'));
}

/**
 * Enumerate all valid connectors across the candidate directories.
 * First-writer wins per connector id in candidate order, so a workspace
 * connector overrides a bundled seed with the same id. Invalid files are
 * skipped with a warning naming file and reason.
 */
export function listConnectors(opts?: { workspaceRoot?: string; overrideDir?: string; seedIfEmpty?: boolean }): ListConnectorsResult {
  const byId = new Map<string, LoadedConnector>();
  const warnings: string[] = [];

  // #3388 (D-3): with no bundled read-through, an unseeded workspace has no
  // connectors. Opt-in callers (TUI, runtime) ask to seed the packaged
  // connectors into the workspace first, so the workspace stays the single
  // source. Idempotent and respects the .seeded marker (deleted files are not
  // re-created). Core/tests leave seedIfEmpty off and stay side-effect-free.
  if (opts?.seedIfEmpty && opts.workspaceRoot) {
    const wsDir = join(opts.workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
    let empty = true;
    try { empty = !existsSync(wsDir) || !readdirSync(wsDir).some(f => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('_')); } catch { /* treat as empty */ }
    if (empty) { try { seedBundledConnectors(opts.workspaceRoot); } catch { /* best-effort */ } }
  }

  for (const dir of candidateDirs(opts?.overrideDir, opts?.workspaceRoot)) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir).filter(f => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('_'));
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const fullPath = join(dir, entry);
      let text: string;
      try {
        text = readFileSync(fullPath, 'utf-8');
      } catch (err) {
        warnings.push(`${fullPath}: unreadable -- ${String(err instanceof Error ? err.message : err)}`);
        continue;
      }
      const parsed = parseConnectorYaml(text, entry);
      if (!parsed.ok) {
        warnings.push(parsed.error);
        continue;
      }
      const id = parsed.file.connector.id;
      if (byId.has(id)) continue; // earlier candidate (higher precedence) wins
      byId.set(id, {
        file: parsed.file,
        path: fullPath,
        origin: isWorkspaceDir(dir, opts?.workspaceRoot) || dir === opts?.overrideDir ? 'workspace' : 'bundled',
      });
    }
  }

  return {
    connectors: [...byId.values()].sort((a, b) => a.file.connector.id.localeCompare(b.file.connector.id)),
    warnings,
  };
}

/** Resolve one connector by id, or undefined when unknown. */
export function getConnector(
  id: string,
  opts?: { workspaceRoot?: string; overrideDir?: string; seedIfEmpty?: boolean },
): LoadedConnector | undefined {
  return listConnectors(opts).connectors.find(c => c.file.connector.id === id);
}
