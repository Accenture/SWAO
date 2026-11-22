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

// Sprint 036 Phase C (#0326): doctor `vcs-auth` probe.
//
// Non-clone diagnostic for VCS authentication. Scans `<workspace>/apps/*/
// .swao.yml` for source.vcs.url entries; for each unique host, runs
// `git ls-remote <url>` with the credential-store token using the
// host's canonical PAT scheme (per providers/vcs/auth.ts) and classifies
// the response: 200/ok, 401/403/auth-failed, network-unreachable.
//
// Why ls-remote (not clone): ls-remote is the cheapest auth probe -- one
// HTTPS round-trip, no working-tree write, no source download. The
// network failure modes line up with `diagnoseCloneFailure`'s patterns
// so the operator hint text is identical.
//
// #1415: ls-remote runs via async spawn with an explicit deadline that
// kills the whole process TREE. spawnSync's own `timeout` is not enough on
// Windows: git spawns a `git-remote-https` grandchild that inherits the
// stdout/stderr pipe handles, and spawnSync blocks on pipe EOF past its
// timeout until that grandchild exits (a stalled proxy = minutes per app).
// A probe-wide deadline caps the worst case across many apps.
//
// #1416: the probe resolves tokens via provider-scoped keys ONLY (no legacy
// `vcs-token` fallback -- one unscoped token must not be sent to whatever
// host an app's .swao.yml names), and never contacts hosts under reserved
// documentation TLDs (.example/.invalid/.test/.localhost, RFC 2606/6761)
// used by fixture workspaces.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { spawn, spawnSync } from 'child_process';
import { load } from 'js-yaml';
import { buildAuthenticatedCloneUrl, vcsTokenKey } from '../providers/vcs/auth.js';
import { CredentialStore, listWorkspaceApps } from '@swao/core';
// Result types moved to @swao/core (#0573) so @swao/module-health-check's formatters can
// type them without importing the host; this builder stays host-coupled
// (`git ls-remote`) and is injected into @swao/module-health-check by the host.
import type { VcsAuthProbeStatus, VcsAuthProbeResult } from '@swao/core';
import { resolveVcsToken } from '../credential/vcs-credential.js';

export type { VcsAuthProbeStatus, VcsAuthProbeResult } from '@swao/core';

interface SwaoYml {
  source?: {
    vcs?: {
      url?: string;
      token_scheme?: string;
      git_proxy?: string;
      ssl_verify?: boolean;
    };
  };
}

// #2749: build GIT_CONFIG_* env vars so git respects per-clone proxy and TLS
// settings without touching the user's global gitconfig. The count/key/value
// triple is the only cross-platform injection mechanism that does NOT require
// the operator to have write access to ~/.gitconfig or /etc/gitconfig.
export function buildGitConfigEnv(proxy?: string, sslVerify?: boolean): Record<string, string> {
  const entries: Array<[string, string]> = [];
  if (proxy) entries.push(['http.proxy', proxy]);
  if (sslVerify === false) entries.push(['http.sslVerify', 'false']);
  if (entries.length === 0) return {};
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(entries.length) };
  entries.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return env;
}

// Per-app ls-remote deadline + a probe-wide ceiling so a workspace with many
// token-bearing apps cannot multiply per-app timeouts into a minutes-long
// health-check (#1415).
const LS_REMOTE_TIMEOUT_MS = 15_000;
const PROBE_DEADLINE_MS = 30_000;

// Reserved documentation / testing TLDs (RFC 2606 / RFC 6761). Fixture
// workspaces (examples/portfolio-workspace) use hosts under these; probing
// them wastes the deadline and would send a stored token off-machine (#1416).
const FIXTURE_HOST_RE = /(^|\.)(example|invalid|test|localhost)$|^example\.(com|net|org)$/;

export interface LsRemoteRun {
  status: number | null;
  stderr: string;
}

/** Run `git ls-remote` with a hard deadline that kills the whole process
 *  tree (#1415). Exported for the hang regression test; `cmd` is injectable
 *  so tests can substitute a script that spawns a pipe-holding grandchild.
 *  `extraEnv` is merged last so GIT_CONFIG_* proxy/TLS vars take effect (#2749). */
export function runGitLsRemote(
  args: string[],
  timeoutMs: number,
  cmd = 'git',
  extraEnv: Record<string, string> = {},
): Promise<LsRemoteRun> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      // Never let git block on a credential/terminal prompt.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', ...extraEnv },
      windowsHide: true,
    });
    let stderr = '';
    let settled = false;
    // `timer` is referenced inside settle before its const initialiser runs;
    // safe because settle only fires from async spawn events.
    const settle = (status: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ status, stderr });
    };
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      // Kill the TREE: on Windows, killing git.exe alone leaves the
      // git-remote-https grandchild holding the inherited pipe handles.
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
      stderr += '\nls-remote connection timed out (probe deadline)';
      settle(null);
    }, timeoutMs);
    child.on('error', () => settle(null));
    // Resolve on process EXIT (not stream close): a surviving grandchild can
    // hold the stderr pipe open indefinitely. A short grace lets buffered
    // stderr flush before classification.
    child.on('exit', (code) => { setTimeout(() => settle(code), 50); });
  });
}

/**
 * #4222: classify an anonymous ls-remote (no token stored). Success means the
 * repository is public; a network error keeps the unreachable outcome; any
 * other failure (401, 403, 404, "could not read Username") means the
 * repository needs a token, so it stays `no-token`, never a failure.
 */
export function classifyAnonymousLsRemote(
  stderr: string,
  exit: number | null,
  tokenKey: string,
): { outcome: 'public' | 'no-token' | 'network-unreachable'; hint: string } {
  const c = classifyLsRemote(stderr, exit);
  if (c.outcome === 'ok') return { outcome: 'public', hint: 'public, no token needed (anonymous ls-remote returned 0)' };
  if (c.outcome === 'network-unreachable') return { outcome: 'network-unreachable', hint: c.hint };
  return {
    outcome: 'no-token',
    hint: `Anonymous access failed, so the repository is private (or the address is wrong). Private repositories need a token: set it via \`swao credential set ${tokenKey} <pat>\`.`,
  };
}

/** #4222: the ls-remote runner (injectable so tests never reach the network). */
export type LsRemoteRunner = (args: string[], timeoutMs: number, extraEnv: Record<string, string>) => Promise<LsRemoteRun>;

export interface VcsAuthProbeDeps {
  lsRemote?: LsRemoteRunner;
}

function classifyLsRemote(
  stderr: string,
  exit: number | null,
): { outcome: 'ok' | 'auth-failed' | 'not-found' | 'network-unreachable'; hint: string } {
  const norm = (stderr || '').toLowerCase();
  if (exit === 0) {
    return { outcome: 'ok', hint: 'ls-remote returned 0 (auth + reachability green)' };
  }
  if (/\b403\b/.test(norm) || norm.includes('write access to repository not granted') || norm.includes('authentication failed')) {
    return {
      outcome: 'auth-failed',
      hint: 'Token rejected. Verify PAT scope (`repo` for GitHub classic; repository selection for fine-grained); verify SAML SSO authorisation if Accenture / enterprise org; verify token-scheme override in .swao.yml if non-standard host.',
    };
  }
  if (/\b401\b/.test(norm)) {
    return {
      outcome: 'auth-failed',
      hint: 'HTTP 401 -- credential not accepted. Set the provider-scoped token via `swao credential set provider:<provider>:token <pat>` (e.g. `provider:github:token`).',
    };
  }
  if (/\b404\b/.test(norm) || norm.includes('not found') || norm.includes('repository not found')) {
    return {
      outcome: 'not-found',
      hint: 'Repository not found at the configured URL. Verify the URL in .swao.yml + PAT scope grants read access to this repo.',
    };
  }
  if (norm.includes('could not resolve host') || norm.includes('connection refused') || norm.includes('connection timed out')) {
    return {
      outcome: 'network-unreachable',
      hint: 'Network error reaching the VCS host. Check connectivity, proxy settings, or air-gap policy.',
    };
  }
  return {
    outcome: 'auth-failed',
    hint: `ls-remote failed (exit ${exit ?? 'unknown'}). Run \`swao assess --app <id>\` for the full clone-stderr diagnosis.`,
  };
}

export async function buildVcsAuthProbe(
  workspacePath: string,
  // Injected store enables test isolation (tests pass an empty-dir store).
  store = new CredentialStore(),
  // #4222: injected ls-remote runner; tests pass a fake so no network call is made.
  deps: VcsAuthProbeDeps = {},
): Promise<VcsAuthProbeResult> {
  const lsRemote: LsRemoteRunner = deps.lsRemote ?? ((args, timeoutMs, extraEnv) => runGitLsRemote(args, timeoutMs, 'git', extraEnv));
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) {
    return {
      status: 'info',
      apps: [],
      message: 'No apps/ directory found in workspace.',
    };
  }

  let entries: string[];
  try { entries = readdirSync(appsDir); }
  catch {
    return {
      status: 'info',
      apps: [],
      message: 'apps/ directory unreadable.',
    };
  }

  const appResults: VcsAuthProbeResult['apps'] = [];
  const probeStarted = Date.now();
  // #4490: service apps (assessment.type: service, the app index of #4484) have no source to clone.
  const serviceIds = new Set(listWorkspaceApps(workspacePath).filter((a) => a.kind === 'service').map((a) => a.id));

  for (const appId of entries) {
    if (appId.startsWith('.')) continue;
    if (serviceIds.has(appId)) continue;
    const appDir = join(appsDir, appId);
    const swaoYmlPath = join(appDir, '.swao.yml');
    if (!existsSync(swaoYmlPath)) continue;

    let cfg: SwaoYml;
    try {
      cfg = (load(readFileSync(swaoYmlPath, 'utf-8')) as SwaoYml) ?? {};
    } catch {
      appResults.push({
        app_id: appId,
        vcs_url: null,
        host: null,
        outcome: 'no-vcs-config',
        hint: '.swao.yml unparseable',
      });
      continue;
    }

    const vcsUrl = cfg.source?.vcs?.url ?? null;
    if (!vcsUrl) {
      appResults.push({
        app_id: appId,
        vcs_url: null,
        host: null,
        outcome: 'no-vcs-config',
        hint: 'No source.vcs.url configured (local-only app or `source.path` already on disk).',
      });
      continue;
    }

    let host: string | null = null;
    try { host = new URL(vcsUrl).hostname.toLowerCase(); }
    catch { host = null; }

    if (host === null || !vcsUrl.match(/^https?:\/\//i)) {
      appResults.push({
        app_id: appId,
        vcs_url: vcsUrl,
        host,
        outcome: 'skip-non-https',
        hint: 'Non-HTTPS URL (likely SSH). ls-remote probe skipped; SSH-key auth is checked at clone time.',
      });
      continue;
    }

    // #1416: never contact fixture/documentation hosts (reserved TLDs).
    if (FIXTURE_HOST_RE.test(host)) {
      appResults.push({
        app_id: appId,
        vcs_url: vcsUrl,
        host,
        outcome: 'skip-fixture-host',
        hint: 'Host is under a reserved documentation TLD (.example/.invalid/.test/.localhost) -- fixture URL, ls-remote probe skipped.',
      });
      continue;
    }

    // #0421: resolve token via the provider-scoped key. #1416: the legacy
    // unscoped `vcs-token` fallback is intentionally NOT used here -- the
    // probe must not send one catch-all token to every host a workspace
    // names. Clone-time resolution (assess) keeps the legacy fallback.
    let storedToken: string | undefined;
    try {
      storedToken = (await resolveVcsToken(store, vcsUrl, { legacyFallback: false })) ?? undefined;
    } catch {
      storedToken = undefined;
    }

    // #2749: read proxy + TLS settings from source.vcs block.
    const gitProxy = cfg.source?.vcs?.git_proxy;
    const sslVerify = cfg.source?.vcs?.ssl_verify;
    if (sslVerify === false) {
      process.stderr.write(`[warn] ${appId}: source.vcs.ssl_verify: false -- TLS certificate verification disabled for ls-remote probe.\n`);
    }
    const gitConfigEnv = buildGitConfigEnv(gitProxy, sslVerify);

    // #1415: probe-wide ceiling across all apps.
    const remaining = PROBE_DEADLINE_MS - (Date.now() - probeStarted);
    if (remaining <= 0) {
      appResults.push({
        app_id: appId,
        vcs_url: vcsUrl,
        host,
        outcome: 'skip-deadline',
        hint: `Probe deadline (${PROBE_DEADLINE_MS / 1000}s) exhausted by earlier apps -- ls-remote skipped. Run \`swao assess --app ${appId}\` for a full check.`,
      });
      continue;
    }

    if (!storedToken) {
      // #4222: no token stored: try anonymous access (a public repository needs
      // none). `credential.helper=` keeps git from using a cached credential, so
      // a success really means public. Same deadline and proxy settings.
      const anon = await lsRemote(
        ['-c', 'credential.helper=', 'ls-remote', '--exit-code', vcsUrl, 'HEAD'],
        Math.min(LS_REMOTE_TIMEOUT_MS, remaining),
        gitConfigEnv,
      );
      const { outcome, hint } = classifyAnonymousLsRemote(anon.stderr, anon.status, vcsTokenKey(vcsUrl));
      appResults.push({ app_id: appId, vcs_url: vcsUrl, host, outcome, hint });
      continue;
    }

    const schemeOverride = cfg.source?.vcs?.token_scheme as
      | 'x-access-token'
      | 'oauth2'
      | 'x-token-auth'
      | 'token-as-username'
      | undefined;
    const { cloneUrl } = buildAuthenticatedCloneUrl(vcsUrl, storedToken, schemeOverride);

    const result = await lsRemote(
      ['ls-remote', '--exit-code', cloneUrl, 'HEAD'],
      Math.min(LS_REMOTE_TIMEOUT_MS, remaining),
      gitConfigEnv,
    );
    const { outcome, hint } = classifyLsRemote(result.stderr, result.status);

    appResults.push({
      app_id: appId,
      vcs_url: vcsUrl,
      host,
      outcome,
      hint,
    });
  }

  // Aggregate
  if (appResults.length === 0) {
    return {
      status: 'info',
      apps: [],
      message: 'No apps with .swao.yml under apps/.',
    };
  }
  const checked = appResults.filter((r) => r.outcome === 'ok' || r.outcome === 'public' || r.outcome === 'auth-failed' || r.outcome === 'not-found' || r.outcome === 'network-unreachable');
  const failed = appResults.filter((r) => r.outcome === 'auth-failed' || r.outcome === 'not-found' || r.outcome === 'network-unreachable');
  const okCount = appResults.filter((r) => r.outcome === 'ok').length;
  const publicCount = appResults.filter((r) => r.outcome === 'public').length;
  // #4222: no token stored and anonymous access failed: the repository needs a token.
  const needToken = appResults.filter((r) => r.outcome === 'no-token');

  let status: VcsAuthProbeStatus;
  let message: string;
  if (failed.length > 0) {
    status = 'fail';
    const failNames = failed.map((r) => `${r.app_id}=${r.outcome}`).join(', ');
    message = `${failed.length} of ${appResults.length} app(s) failed VCS auth: ${failNames}`;
  } else if (needToken.length > 0) {
    status = 'warn';
    message = `${needToken.length} of ${appResults.length} app(s) need a token (anonymous access failed, private repository): ${needToken.map((r) => r.app_id).join(', ')}`;
  } else if (checked.length === 0) {
    status = 'info';
    message = `${appResults.length} app(s) skipped (no VCS config, non-HTTPS, fixture host or time limit).`;
  } else {
    status = 'ok';
    const parts = [
      ...(okCount > 0 ? [`${okCount} authenticated with the stored token`] : []),
      ...(publicCount > 0 ? [`${publicCount} public, no token needed`] : []),
    ];
    message = `${okCount + publicCount} of ${appResults.length} app(s) reachable: ${parts.join(', ')}.`;
  }

  return { status, apps: appResults, message };
}
