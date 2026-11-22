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

// #4192 SET-03 (Design 125 section 5.2): the App step of the Application
// branch adds an app the way `swao init --name <id>` does
// (commands/init.ts:1164-1217): apps/<id>/.swao.yml from appSwaoYmlTemplate
// with the four demo regimes, then the imports, ingestion, source and
// landing-zone stub scaffolds. An existing app is never overwritten. The
// source is a repository URL, a local folder, or set later. Section 5.7: the
// Application Assessment preselects the apps (setup/defaults.ts
// readApplicationDefaults reads exactly what this writes).

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import {
  appSwaoYmlTemplate,
  scaffoldImports,
  scaffoldIngestion,
  scaffoldLandingZoneStubs,
  scaffoldSource,
} from '../commands/init.js';
import { readApplicationDefaults, readWorkspaceYml } from './defaults.js';
import type { SetupCheckItem } from './types.js';

/** The regimes `swao init --name` installs on a new app (commands/init.ts:1179, #0626). */
export const INIT_APP_DEFAULT_REGIMES: readonly string[] = ['GDPR_DEMO', 'AI_10_PILLARS_DEMO', 'NIST_SP_800_66R2_DEMO', 'BSI_GRUNDSCHUTZ_2023_DEMO'];

/** App id: lower-case letters, digits, dash and underscore; starts with a letter or digit; folder-safe on every OS. */
export const APP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** Why an app id is refused, or null when it is valid and free. */
export function appIdProblem(workspaceRoot: string, raw: string): string | null {
  const id = raw.trim();
  if (id.length === 0) return 'Enter an app id.';
  if (!APP_ID_PATTERN.test(id)) return 'Use lower-case letters, digits, dash or underscore (at most 63 characters).';
  if (existsSync(join(workspaceRoot, 'apps', id, '.swao.yml'))) return `The app ${id} already exists.`;
  return null;
}

export type AppSourceKind = 'repository' | 'folder' | 'later';

/** Source location input classification (same rules as the Application Assessment new-app flow, #0386). */
export function classifyAppSource(raw: string): 'git-url' | 'local-path' | 'ambiguous' {
  const v = raw.trim();
  if (!v) return 'ambiguous';
  if (/^(https?|ssh|git):\/\//i.test(v)) return 'git-url';
  if (/^git@[^:]+:/.test(v)) return 'git-url';
  if (/^[a-zA-Z]:[\\/]/.test(v) || v.startsWith('\\\\') || v.startsWith('/')) return 'local-path';
  return 'ambiguous';
}

/** #0391: a GitHub tree-view URL split into clone URL, ref and subfolder; null for other URLs. */
export function splitTreeUrl(raw: string): { cloneUrl: string; ref: string; subdir: string } | null {
  // Bounded input keeps the match linear (CodeQL js/polynomial-redos).
  const m = raw.trim().slice(0, 2048).match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/tree\/([^/]+)(?:\/(.+))?$/i);
  if (!m) return null;
  return {
    cloneUrl: (m[1] ?? '').replace(/\.git$/, '') + '.git',
    ref: m[2] ?? 'main',
    subdir: (m[3] ?? '').replace(/\/+$/, ''),
  };
}

/** VCS type by exact host match (CodeQL #3 to #5: no substring match on the host). */
export function vcsTypeFromUrl(url: string): 'github' | 'gitlab' | 'azure-devops' {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return 'github'; }
  if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) return 'gitlab';
  if (host === 'dev.azure.com' || host === 'visualstudio.com' || host.endsWith('.visualstudio.com')) return 'azure-devops';
  return 'github';
}

/** True when an http(s) URL carries a user name or password (a token must go to the vault, never into .swao.yml). */
export function urlHasCredentials(url: string): boolean {
  try {
    const u = new URL(url);
    return u.username.length > 0 || u.password.length > 0;
  } catch {
    return false;
  }
}

/** Why a source value is refused for the chosen kind, or null when it is usable. */
export function appSourceProblem(kind: AppSourceKind, raw: string): string | null {
  const v = raw.trim();
  switch (kind) {
    case 'later':
      return null;
    case 'repository':
      if (classifyAppSource(v) !== 'git-url') return 'Enter a repository address that starts with https://, ssh:// or git@.';
      if (urlHasCredentials(v)) return 'Remove the user name and token from the address; the token goes into the vault in the next step.';
      return null;
    case 'folder':
      if (!isAbsolute(v) && classifyAppSource(v) !== 'local-path') return 'Enter the full path of the source folder.';
      try {
        if (!statSync(v).isDirectory()) return 'The path is not a folder.';
      } catch {
        return 'The folder does not exist.';
      }
      return null;
    default: {
      const never: never = kind;
      throw new Error(`unknown source kind: ${String(never)}`);
    }
  }
}

export interface CreateApplicationAppInput {
  appId: string;
  source: { kind: 'repository'; url: string } | { kind: 'folder'; path: string } | { kind: 'later' };
}

export interface CreateApplicationAppResult {
  appDir: string;
  swaoYmlPath: string;
  sourceMode: 'git-clone' | 'local-path' | 'no-source';
}

/**
 * Adds an app as `swao init --name` does (commands/init.ts:1164-1217), with
 * the source the user chose. Throws when the id is invalid, the app exists,
 * or the source is refused; never overwrites an existing app.
 */
export function createApplicationApp(workspaceRoot: string, input: CreateApplicationAppInput): CreateApplicationAppResult {
  const appId = input.appId.trim();
  const idProblem = appIdProblem(workspaceRoot, appId);
  if (idProblem) throw new Error(idProblem);
  const src = input.source;
  const srcValue = src.kind === 'repository' ? src.url : src.kind === 'folder' ? src.path : '';
  const srcProblem = appSourceProblem(src.kind, srcValue);
  if (srcProblem) throw new Error(srcProblem);

  const appDir = join(workspaceRoot, 'apps', appId);
  mkdirSync(appDir, { recursive: true });
  // #0723: the assessor is pre-filled with engagement.partnership_lead (commands/init.ts buildWorkspaceSwaoYml).
  const engagement = readWorkspaceYml(workspaceRoot)['engagement'];
  const lead = engagement && typeof engagement === 'object' ? (engagement as Record<string, unknown>)['partnership_lead'] : undefined;
  const assessorEmail = typeof lead === 'string' && lead.trim().length > 0 ? lead.trim() : undefined;

  let vcs: { vcsType?: 'github' | 'gitlab' | 'azure-devops'; vcsUrl?: string; vcsRef?: string; vcsSubdir?: string; sourcePathOverride?: string } = {};
  if (src.kind === 'repository') {
    const url = src.url.trim();
    const split = splitTreeUrl(url);
    vcs = split
      ? { vcsType: vcsTypeFromUrl(split.cloneUrl), vcsUrl: split.cloneUrl, vcsRef: split.ref, ...(split.subdir ? { vcsSubdir: split.subdir } : {}) }
      : { vcsType: vcsTypeFromUrl(url), vcsUrl: url };
  } else if (src.kind === 'folder') {
    vcs = { sourcePathOverride: src.path.trim() };
  }

  const swaoYmlPath = join(appDir, '.swao.yml');
  writeFileSync(swaoYmlPath, appSwaoYmlTemplate({ appId, regimes: INIT_APP_DEFAULT_REGIMES, ...(assessorEmail ? { assessorEmail } : {}), ...vcs }), 'utf-8');
  scaffoldImports(appDir);
  scaffoldIngestion(appDir);
  // A local folder lives outside the workspace; the source/ landing area is only for clones (AppAssessmentScreen createApp).
  if (src.kind !== 'folder') scaffoldSource(appDir);
  scaffoldLandingZoneStubs(appDir, appId);
  return {
    appDir,
    swaoYmlPath,
    sourceMode: src.kind === 'repository' ? 'git-clone' : src.kind === 'folder' ? 'local-path' : 'no-source',
  };
}

export interface AppSourceInfo {
  appId: string;
  /** source.vcs.url, when the app clones from a repository. */
  vcsUrl?: string;
  /** source.path, when set. */
  sourcePath?: string;
}

/** The source of every app with an apps/<id>/.swao.yml (sorted by id). Unreadable files give an entry without source. */
export function readAppSources(workspaceRoot: string): AppSourceInfo[] {
  return readApplicationDefaults(workspaceRoot).apps.map((appId) => {
    try {
      const doc = yamlLoad(readFileSync(join(workspaceRoot, 'apps', appId, '.swao.yml'), 'utf-8')) as Record<string, unknown> | null;
      const source = doc && typeof doc['source'] === 'object' && doc['source'] !== null ? (doc['source'] as Record<string, unknown>) : {};
      const vcs = typeof source['vcs'] === 'object' && source['vcs'] !== null ? (source['vcs'] as Record<string, unknown>) : {};
      return {
        appId,
        ...(typeof vcs['url'] === 'string' && vcs['url'].length > 0 ? { vcsUrl: vcs['url'] } : {}),
        ...(typeof source['path'] === 'string' && source['path'].length > 0 ? { sourcePath: source['path'] } : {}),
      };
    } catch {
      return { appId };
    }
  });
}

/** Non-interactive check of the App step (Design 125 section 8). */
export function checkApplicationApps(workspaceRoot: string): SetupCheckItem[] {
  const { apps } = readApplicationDefaults(workspaceRoot);
  if (apps.length === 0) return [{ label: 'Apps', state: 'missing', detail: 'No app yet; add the first app' }];
  return [{ label: 'Apps', state: 'ok', detail: `${apps.length} app${apps.length === 1 ? '' : 's'}: ${apps.join(', ')}` }];
}
