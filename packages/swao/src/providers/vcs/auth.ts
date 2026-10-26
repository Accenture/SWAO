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

// Provider-aware VCS token injection for HTTPS clone URLs.
// Per #0326: the previous `urlObj.username = 'oauth2'` worked for GitLab
// but caused GitHub to reject the principal mapping and return the
// misleading "Write access to repository not granted" + 403 error. Each
// VCS provider uses a different canonical scheme for PAT-based HTTPS
// authentication; this module switches on the URL host to apply the
// right one.

import { logPortfolio } from '@swao/core';
import { parseVcsUrlScheme, redactVcsUrl } from './clone.js';

export type VcsTokenScheme =
  | 'x-access-token'      // GitHub: actions/checkout convention
  | 'oauth2'              // GitLab: the previous SWAO default
  | 'x-token-auth'        // Bitbucket Cloud
  | 'token-as-username';  // Azure DevOps + generic fallback for self-hosted

export interface VcsAuthResult {
  cloneUrl: string;
  schemeUsed: VcsTokenScheme | 'none';
  host: string | null;
}

const HOST_RULES: Array<{ test: (host: string) => boolean; scheme: VcsTokenScheme; label: string; providerId: string }> = [
  { test: (h) => h === 'github.com' || h.endsWith('.github.com') || h.endsWith('.ghe.io'), scheme: 'x-access-token', label: 'GitHub', providerId: 'github' },
  { test: (h) => h === 'gitlab.com' || h.endsWith('.gitlab.com'), scheme: 'oauth2', label: 'GitLab', providerId: 'gitlab' },
  { test: (h) => h === 'bitbucket.org' || h.endsWith('.bitbucket.org'), scheme: 'x-token-auth', label: 'Bitbucket', providerId: 'bitbucket' },
  { test: (h) => h === 'dev.azure.com' || h.endsWith('.visualstudio.com'), scheme: 'token-as-username', label: 'Azure DevOps', providerId: 'azure-devops' },
];

/**
 * Derive the canonical provider identifier for a VCS URL.
 * Used to build the provider-scoped credential key
 * `provider:<provider>:token` (#0421).
 * Returns 'vcs' for unknown / self-hosted hosts.
 */
export function resolveVcsProvider(vcsUrl: string): string {
  if (!vcsUrl) return 'vcs';
  let host: string;
  try {
    host = new URL(vcsUrl).hostname.toLowerCase();
  } catch {
    return 'vcs';
  }
  for (const rule of HOST_RULES) {
    if (rule.test(host)) return rule.providerId;
  }
  return 'vcs';
}

const DEFAULT_SCHEME: VcsTokenScheme = 'x-access-token';

/**
 * Build an HTTPS clone URL with the given PAT embedded using the canonical
 * scheme for the host. If `schemeOverride` is supplied (from
 * `.swao.yml providers.vcs.token_scheme`), it wins regardless of host.
 *
 * Returns the URL unchanged (scheme = 'none') when no token is supplied or
 * the URL is not HTTPS / not parseable -- those paths fall through to the
 * caller's existing behaviour (SSH-key clone or git-surfaced auth error).
 *
 * Token-in-URL note (sprint-034 PR #341 review / #0334 disposition): the
 * returned cloneUrl carries the PAT in the URL userinfo. When the caller
 * passes this to `git clone` the URL ends up in the process arg list, so
 * a `ps`-style observer on the same host could see the token until clone
 * completes. This is acceptable for our threat model (the operator is on
 * their own workstation; SWAO does not run as a privileged service yet),
 * but operators who need defence-in-depth have three alternatives:
 *   - configure a git credential helper (`git config --global
 *     credential.helper manager`) and store the PAT outside the URL;
 *   - use SSH keys (`ssh-add ~/.ssh/id_<key>`) -- detected and warned by
 *     `diagnoseCloneFailure` below when an SSH clone fails;
 *   - set GIT_ASKPASS to a wrapper that reads the PAT from a credential
 *     store at clone time, never embedding it in the URL.
 * Future hardening (sprint-038+ candidate): teach `swao credential set
 * `provider:<provider>:token` to opt into a credential-helper-backed flow when present.
 */
export function buildAuthenticatedCloneUrl(
  vcsUrl: string,
  token: string | undefined,
  schemeOverride?: VcsTokenScheme,
): VcsAuthResult {
  if (!token) {
    return { cloneUrl: vcsUrl, schemeUsed: 'none', host: null };
  }

  let urlObj: URL;
  try {
    urlObj = new URL(vcsUrl);
  } catch {
    // Non-parseable URL (likely an SSH or git:// form). Caller's git
    // invocation will surface the appropriate auth error.
    return { cloneUrl: vcsUrl, schemeUsed: 'none', host: null };
  }

  if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
    return { cloneUrl: vcsUrl, schemeUsed: 'none', host: urlObj.host };
  }

  const host = urlObj.hostname.toLowerCase();
  const scheme: VcsTokenScheme = schemeOverride ?? matchScheme(host);

  // Sprint-034 PR #341 follow-up (#0334): `URL.username` and `URL.password`
  // setters percent-encode some characters (`/`, `=`) but NOT `+`. Azure
  // DevOps PATs are base64-shaped and can contain `+`, `/`, `=`; we
  // explicitly encodeURIComponent the token first so the receiving side
  // sees a single canonical encoding regardless of which sub-delim chars
  // appear in the PAT.
  const encodedToken = encodeURIComponent(token);

  switch (scheme) {
    case 'token-as-username':
      // Azure DevOps + safe generic fallback: token as the username,
      // empty password. Some servers also accept blank-username +
      // token-as-password; the username form is the more portable.
      urlObj.username = encodedToken;
      urlObj.password = '';
      break;
    case 'x-access-token':
    case 'oauth2':
    case 'x-token-auth':
      urlObj.username = scheme;
      urlObj.password = encodedToken;
      break;
  }

  return {
    cloneUrl: urlObj.toString(),
    schemeUsed: scheme,
    host,
  };
}

function matchScheme(host: string): VcsTokenScheme {
  for (const rule of HOST_RULES) {
    if (rule.test(host)) return rule.scheme;
  }
  // Unknown / self-hosted host: default to x-access-token, the broadest
  // compatibility option. Operator can override via providers.vcs.token_scheme.
  return DEFAULT_SCHEME;
}

/**
 * Build the provider-scoped credential key for the VCS token (#0421).
 * Example: `provider:github:token`, `provider:gitlab:token`.
 */
export function vcsTokenKey(vcsUrl: string): string {
  return `provider:${resolveVcsProvider(vcsUrl)}:token`;
}

/**
 * Pattern-match the stderr from a failed `git clone` and emit a structured
 * log entry plus an operator-facing remediation hint. Called from the
 * assess command's failure path. Per #0326 Part C.
 */
export function diagnoseCloneFailure(
  stderr: string,
  vcsUrl: string,
  schemeUsed: VcsTokenScheme | 'none',
  appId?: string,
): { hint: string; logCode: string } {
  const norm = stderr.toLowerCase();
  // #3439: `scheme` is the URL transport (https / ssh / scp / ...), not the
  // token scheme; the token scheme is logged separately as `token_scheme`.
  // The URL is credential-stripped before it reaches any log context.
  const safeUrl = redactVcsUrl(vcsUrl);
  const telemetry = {
    vcs_url: safeUrl,
    scheme: parseVcsUrlScheme(vcsUrl),
    token_scheme: schemeUsed,
    app_id: appId,
  };

  // Sprint-034 PR #341 follow-up (#0334): tightened from `norm.includes('403')`
  // to `\b403\b` so the matcher doesn't false-positive on e.g. a port number
  // ":4034" or a commit SHA fragment containing "403". The 'write access to
  // repository not granted' literal is GitHub-specific and not regex-prone.
  if (norm.includes('write access to repository not granted') || /\b403\b/.test(norm)) {
    const code = 'provider.vcs.auth-failed';
    const message = `GitHub returned 403 for ${safeUrl} using scheme '${schemeUsed}'`;
    logPortfolio('error', code, message, { context: telemetry });
    return {
      logCode: code,
      hint:
        'GitHub authentication failed. Common causes:\n' +
        "  (a) PAT scope missing 'repo' (classic PAT) or repository selection (fine-grained PAT).\n" +
        '  (b) PAT not authorised for the org under SAML SSO -- open\n' +
        '      https://github.com/settings/tokens and click "Authorize" for the org.\n' +
        `  (c) Token-scheme mismatch -- this clone used '${schemeUsed}'.\n` +
        "      Override via .swao.yml providers.vcs.token_scheme if needed.",
    };
  }

  if (norm.includes('permission denied (publickey)')) {
    const code = 'provider.vcs.ssh-key-missing';
    const message = 'SSH-key clone failed: no key loaded';
    logPortfolio('error', code, message, { context: telemetry });
    return {
      logCode: code,
      hint:
        'SSH-key authentication failed.\n' +
        '  Run `ssh-add ~/.ssh/id_<key>` to load your key,\n' +
        '  or switch to HTTPS+PAT via `swao credential set provider:<provider>:token <pat>`\n' +
        '  (e.g. `swao credential set provider:github:token <pat>` for GitHub).',
    };
  }

  // #3439: credential prompt suppressed (GIT_TERMINAL_PROMPT=0 /
  // GCM_INTERACTIVE=never) or rejected. Git Credential Manager and git's own
  // terminal fallback produce these lines when no usable credential exists.
  if (
    norm.includes('terminal prompts disabled') ||
    norm.includes('could not read username') ||
    norm.includes('could not read password') ||
    norm.includes('user cancelled dialog') ||
    norm.includes('/dev/tty') ||
    norm.includes('missing oauth configuration') ||
    norm.includes('cannot prompt because user interactivity has been disabled') ||
    norm.includes('authentication failed for') ||
    /\b401\b/.test(norm)
  ) {
    const code = 'provider.vcs.auth-required';
    const key = vcsTokenKey(vcsUrl);
    const noToken = schemeUsed === 'none';
    const message = noToken
      ? `git clone needs credentials for ${safeUrl}; none configured and interactive prompts are disabled`
      : `git clone credentials rejected for ${safeUrl} (token scheme '${schemeUsed}')`;
    logPortfolio('error', code, message, { context: telemetry });
    return {
      logCode: code,
      hint:
        (noToken
          ? 'The repository requires authentication and no access token is configured.\n'
          : `The configured access token was rejected (token scheme '${schemeUsed}').\n`) +
        '  SWAO runs git non-interactively (no Git Credential Manager dialog,\n' +
        '  no terminal prompt), so the credential must be stored up front:\n' +
        `    swao credential set ${key} <personal-access-token>\n` +
        '  The token needs read access to the repository (e.g. GitHub: Contents read /\n' +
        "  classic 'repo'; GitLab: read_repository; Azure DevOps: Code (Read)).\n" +
        '  Alternatively switch source.vcs.url to an SSH URL with a loaded key (ssh-add).' +
        (noToken ? '' : '\n  Override the token scheme via .swao.yml providers.vcs.token_scheme if needed.'),
    };
  }

  // #3439: Windows MAX_PATH checkout failure. The clone already runs with
  // `-c core.longpaths=true`; this branch covers a git build that ignores it
  // or a filesystem that still rejects the path.
  // Keyed on "filename too long" only: a bare "Clone succeeded, but checkout
  // failed" also covers reserved names, locks and a full disk, which fall
  // through to the generic branch with the stderr excerpt.
  if (norm.includes('filename too long')) {
    const code = 'provider.vcs.checkout-path-too-long';
    const message = `git checkout failed for ${safeUrl}: path too long`;
    logPortfolio('error', code, message, {
      context: { ...telemetry, stderr_excerpt: stderr.slice(0, 500) },
    });
    return {
      logCode: code,
      hint:
        'The clone succeeded but checkout failed because a file path exceeds the\n' +
        '  Windows path limit. Options:\n' +
        '    (a) enable long paths for git: `git config --global core.longpaths true`\n' +
        '        (and, with admin rights, the Windows LongPathsEnabled policy);\n' +
        '    (b) move the workspace to a shorter root (e.g. C:\\swao\\<engagement>);\n' +
        '    (c) clone manually and point source.path at the working tree.',
    };
  }

  if (norm.includes('could not resolve host') || norm.includes('connection refused')) {
    const code = 'provider.vcs.network-unreachable';
    const message = `Network error reaching ${safeUrl}`;
    logPortfolio('error', code, message, { context: telemetry });
    return {
      logCode: code,
      hint:
        'Network error reaching the VCS host.\n' +
        '  Check connectivity, proxy settings, or air-gap policy.',
    };
  }

  // Unknown failure -- still log it so the operator can attach the entry
  // to a feedback report.
  //
  // Sprint-034 PR #341 follow-up (#0334): the stderr_excerpt below relies
  // on the upstream redaction performed by `redactUrlUserinfo` in
  // util/log.ts before the entry is persisted to ndjson. The PAT-bearing
  // clone URL never reaches the stderr buffer (git masks userinfo in its
  // own diagnostic output), but if a future change adds a path where the
  // PAT could leak into stderr, both this excerpt AND the redactor
  // contract need to be re-evaluated together. Do not bypass the
  // redactor by writing this entry through a different sink.
  const code = 'provider.vcs.clone-failed';
  const message = `git clone failed for ${safeUrl}`;
  logPortfolio('error', code, message, {
    context: { ...telemetry, stderr_excerpt: stderr.slice(0, 500) },
  });
  return {
    logCode: code,
    hint:
      'git clone failed with an unrecognised stderr pattern.\n' +
      '  Inspect the stderr above; the structured log entry is at\n' +
      '  `wsp/logs/portfolio-events-<YYYY-MM>.ndjson`.',
  };
}
