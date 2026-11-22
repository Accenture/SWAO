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

// #4192 SET-03 (Design 125 section 5.2): the Source access step of the
// Application branch. It runs the vcs_auth probe builder of the health check
// (health-check/vcs-auth-probe.ts buildVcsAuthProbe, the same function `swao
// health-check` calls) and shows each app's outcome in plain words. The
// probe hints name CLI commands, so the step maps outcomes to its own text
// (Design 125 section 9: no CLI syntax on setup screens). A missing or
// rejected token can be entered here; it goes into the credential vault under
// the provider-scoped key (vcsTokenKey), never into .swao.yml and never into
// a log.

import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { credentialEnvVarName, CredentialStore, type VcsAuthProbeResult } from '@swao/core';
import { vcsTokenKey } from '../providers/vcs/auth.js';
import { readAppSources } from './application-app.js';
import type { SetupCheckItem } from './types.js';

export type VcsOutcome = VcsAuthProbeResult['apps'][number]['outcome'];

export interface VcsOutcomeView {
  /** Short line for the step list. */
  text: string;
  state: SetupCheckItem['state'];
  /** One or two sentences for the guidance. */
  help: string;
  /** True when entering a token can fix the outcome. */
  tokenFixes: boolean;
}

/** Plain-language view of every vcs_auth outcome (exhaustive). */
export function vcsOutcomeView(outcome: VcsOutcome): VcsOutcomeView {
  switch (outcome) {
    case 'ok':
      return { text: 'access confirmed', state: 'ok', help: 'The repository answered with the stored token.', tokenFixes: false };
    case 'public':
      // #4222: anonymous access works, so no token is asked for.
      return { text: 'public, no token needed', state: 'ok', help: 'The repository answered without a token, so it is public. A token is only needed for private repositories.', tokenFixes: false };
    case 'auth-failed':
      return { text: 'token rejected', state: 'missing', help: 'The host refused the stored token. Check that it grants read access to the repository (and single sign-on approval where the organisation requires it), then enter it again.', tokenFixes: true };
    case 'not-found':
      return { text: 'repository not found', state: 'missing', help: 'The host does not know the repository, or the token cannot see it. Check the repository address in the app settings and the token scope.', tokenFixes: true };
    case 'network-unreachable':
      return { text: 'host not reachable', state: 'warn', help: 'The host could not be reached. Check the network connection and the proxy settings.', tokenFixes: false };
    case 'no-token':
      // #4222: only after anonymous access failed.
      return { text: 'private, no token in the vault', state: 'missing', help: 'The repository did not answer without a token, so it is private (or the address is wrong). Private repositories need an access token: enter one so SWAO can clone the repository.', tokenFixes: true };
    case 'no-vcs-config':
      return { text: 'local source, nothing to check', state: 'info', help: 'The app reads source code from a folder, so no repository access is needed.', tokenFixes: false };
    case 'skip-non-https':
      return { text: 'SSH address, checked when cloning', state: 'info', help: 'SSH addresses use your SSH key; access is checked when the assessment clones the repository.', tokenFixes: false };
    case 'skip-fixture-host':
      return { text: 'example host, not contacted', state: 'info', help: 'The address uses a reserved example domain, so SWAO does not contact it.', tokenFixes: false };
    case 'skip-deadline':
      return { text: 'not checked, time limit reached', state: 'warn', help: 'The check stopped at its time limit before this app. Check again.', tokenFixes: false };
    default: {
      const never: never = outcome;
      throw new Error(`unknown vcs outcome: ${String(never)}`);
    }
  }
}

/** True when the credential `key` is in the vault record or in its SWAO_CREDENTIAL_* environment variable. */
export function hasCredentialKey(key: string, vault: Readonly<Record<string, string>>, env: NodeJS.ProcessEnv = process.env): boolean {
  return Object.prototype.hasOwnProperty.call(vault, key) || env[credentialEnvVarName(key)] !== undefined;
}

const PLACEHOLDER_NAMES = new Set(['readme.md', 'readme.txt', 'readme', '.gitkeep']);

/**
 * True when the source folder of an app does not exist or holds no source
 * file yet: README and dot files only, the rule of the health check source
 * accessibility check (module-health-check health-check.ts isSourceNonEmpty).
 */
function sourceFolderEmpty(workspaceRoot: string, appId: string, sourcePath: string | undefined): boolean {
  const rel = sourcePath ?? 'wsp/inputs/source';
  const stack = [isAbsolute(rel) ? rel : join(workspaceRoot, 'apps', appId, rel)];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    if (!existsSync(dir)) continue;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) { stack.push(join(dir, e.name)); continue; }
      if (e.isFile() && !PLACEHOLDER_NAMES.has(e.name.toLowerCase())) return false;
    }
  }
  return true;
}

/**
 * Non-interactive check of the Source access step (Design 125 section 8): no
 * network call. A repository app is `ok` when a token for its host is stored.
 * #4222 / #4282: without a token it is `info`, not `missing`: a public
 * repository needs none, and the scoped health check (vcs_auth probe) tries
 * anonymous access and warns when the repository needs a token. A repository
 * app whose source folder is still empty gets an `info` line: the clone
 * happens at the first assessment.
 */
export function checkApplicationSource(
  workspaceRoot: string,
  vault: Readonly<Record<string, string>> = safeLoadVault(),
  env: NodeJS.ProcessEnv = process.env,
): SetupCheckItem[] {
  const sources = readAppSources(workspaceRoot);
  if (sources.length === 0) return [{ label: 'Source access', state: 'info', detail: 'No app yet' }];
  return sources.flatMap((s): SetupCheckItem[] => {
    if (!s.vcsUrl) return [{ label: `Source ${s.appId}`, state: 'ok', detail: 'local source' }];
    const clone: SetupCheckItem[] = sourceFolderEmpty(workspaceRoot, s.appId, s.sourcePath)
      ? [{ label: `Clone ${s.appId}`, state: 'info', detail: `${s.sourcePath ?? 'wsp/inputs/source/'} is empty; SWAO clones the repository at the first assessment`, short: 'cloned at the first assessment' }]
      : [];
    if (!/^https?:\/\//i.test(s.vcsUrl)) return [{ label: `Source ${s.appId}`, state: 'info', detail: 'SSH address, checked when cloning' }, ...clone];
    const ok = hasCredentialKey(vcsTokenKey(s.vcsUrl), vault, env);
    return [
      ok
        ? { label: `Source ${s.appId}`, state: 'ok', detail: 'token in the vault' }
        : { label: `Source ${s.appId}`, state: 'info', detail: 'no token stored; public repositories need none (the health check tries anonymous access)', short: 'no token stored' },
      ...clone,
    ];
  });
}

function safeLoadVault(): Record<string, string> {
  try { return new CredentialStore().loadSync(); } catch { return {}; }
}

/** Stores a repository access token under the provider-scoped key of `vcsUrl`; returns the key (never the value). */
export async function storeVcsToken(store: CredentialStore, vcsUrl: string, token: string): Promise<string> {
  const value = token.trim();
  if (value.length === 0) throw new Error('empty token');
  const key = vcsTokenKey(vcsUrl);
  await store.set(key, value);
  return key;
}
