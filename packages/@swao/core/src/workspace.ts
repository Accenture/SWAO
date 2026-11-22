// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { WorkspaceContext } from './plugin-types.js';

export type { WorkspaceContext };

/**
 * #4392: ~/.config/swao/config.json, resolved on every call (it was a module
 * constant), so a test or a sandboxed run that points HOME / USERPROFILE at a
 * temporary profile after this module loaded still never touches the real file.
 */
export function defaultWorkspaceConfigPath(): string {
  return join(homedir(), '.config', 'swao', 'config.json');
}

/** Walk up from startDir until .swao.yml is found. Returns the directory or null.
 *  Does NOT fall back to the global config -- callers that need the global default
 *  must read it explicitly. Silent fallback caused wrong-workspace confusion (#2185). */
export function findWorkspace(startDir: string): string | null {
  let dir = startDir;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(join(dir, '.swao.yml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve the compliance catalogs directory for a workspace, preferring the
 * canonical `wsp/inputs/catalogs/` location and falling back to the legacy
 * top-level `catalogs/`. Returns the canonical location when neither exists so
 * probe error messages point at the right place to create them.
 *
 * Relocated to @swao/core (#0552) so the app-assessment module's derive-plan
 * library can resolve catalogs without importing from @swao/swao. The swao
 * `init.ts` re-exports this for existing call sites.
 */
export function resolveCatalogsDir(workspacePath: string): string {
  const newDir = join(workspacePath, 'wsp', 'inputs', 'catalogs');
  if (existsSync(newDir)) return newDir;
  const oldDir = join(workspacePath, 'catalogs');
  if (existsSync(oldDir)) return oldDir;
  return newDir;
}

/** Persist the workspace path so future sessions launched from any directory
 *  can find it without being cd'd into the workspace. */
export function saveDefaultWorkspace(workspacePath: string): void {
  const configFile = defaultWorkspaceConfigPath();
  try {
    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(configFile, JSON.stringify({ default_workspace: workspacePath }, null, 2), 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[swao] failed to save default workspace to ${configFile}: ${message}`);
  }
}

/** Read the default workspace path saved by the most recent swao setup or init.
 *  Returns null when no config file exists, when the saved path no longer exists on
 *  disk, or when the file cannot be parsed. Callers that need a workspace should
 *  check findWorkspace(cwd) first; this is the last-resort fallback. */
export function readDefaultWorkspace(): string | null {
  const path = readSavedDefaultWorkspacePath();
  return path !== null && existsSync(path) ? path : null;
}

/**
 * #4392: the saved default workspace path as written, also when the folder no
 * longer exists (readDefaultWorkspace returns null then). Null when no config
 * file exists or it cannot be parsed.
 */
export function readSavedDefaultWorkspacePath(): string | null {
  try {
    const file = defaultWorkspaceConfigPath();
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    const path = (raw as Record<string, unknown>).default_workspace;
    return typeof path === 'string' && path ? path : null;
  } catch {
    return null;
  }
}

function sameFolder(a: string, b: string): boolean {
  const x = resolve(a);
  const y = resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * #4392: the line `swao init` and the Setup Wizard show when saving
 * `next` changes the saved default workspace (old path to new path), or null
 * when the saved default already names that folder.
 */
export function defaultWorkspaceChangeLine(previous: string | null, next: string): string | null {
  if (previous !== null && sameFolder(previous, next)) return null;
  return `Saved default workspace changed: ${previous ?? '(none)'} -> ${next}`;
}
