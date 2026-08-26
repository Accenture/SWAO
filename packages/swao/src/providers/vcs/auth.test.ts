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

// Tests for the provider-aware VCS token injection helper (#0326 Part A).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAuthenticatedCloneUrl, diagnoseCloneFailure } from './auth.js';
import { setWorkspaceRoot } from '@swao/core';

const TOKEN = 'ghp_examplePersonalAccessTokenXXXXXXXXXXXX';

describe('buildAuthenticatedCloneUrl -- host routing', () => {
  it('uses x-access-token as username for github.com', () => {
    const r = buildAuthenticatedCloneUrl('https://github.com/foo/bar.git', TOKEN);
    expect(r.schemeUsed).toBe('x-access-token');
    expect(r.host).toBe('github.com');
    expect(r.cloneUrl).toBe(`https://x-access-token:${TOKEN}@github.com/foo/bar.git`);
  });

  it('matches GitHub Enterprise subdomains via *.ghe.io', () => {
    const r = buildAuthenticatedCloneUrl('https://github.acme.ghe.io/foo/bar.git', TOKEN);
    expect(r.schemeUsed).toBe('x-access-token');
  });

  it('uses oauth2 as username for gitlab.com (the previous SWAO default)', () => {
    const r = buildAuthenticatedCloneUrl('https://gitlab.com/foo/bar.git', TOKEN);
    expect(r.schemeUsed).toBe('oauth2');
    expect(r.cloneUrl).toBe(`https://oauth2:${TOKEN}@gitlab.com/foo/bar.git`);
  });

  it('matches self-hosted GitLab via *.gitlab.com', () => {
    const r = buildAuthenticatedCloneUrl('https://gitlab.example.com/foo/bar.git', TOKEN);
    // *.gitlab.com is the suffix rule; non-gitlab.com self-hosted falls to default
    expect(r.schemeUsed).toBe('x-access-token');         // default for unknown self-hosted
  });

  it('uses x-token-auth as username for bitbucket.org', () => {
    const r = buildAuthenticatedCloneUrl('https://bitbucket.org/foo/bar.git', TOKEN);
    expect(r.schemeUsed).toBe('x-token-auth');
    expect(r.cloneUrl).toBe(`https://x-token-auth:${TOKEN}@bitbucket.org/foo/bar.git`);
  });

  it('uses token-as-username for dev.azure.com', () => {
    const r = buildAuthenticatedCloneUrl('https://dev.azure.com/org/proj/_git/repo', TOKEN);
    expect(r.schemeUsed).toBe('token-as-username');
    expect(r.cloneUrl).toBe(`https://${TOKEN}@dev.azure.com/org/proj/_git/repo`);
  });

  // Sprint-034 PR #341 follow-up (#0334): Azure DevOps PATs are
  // base64-shaped and may contain `+`, `/`, `=` -- characters that have
  // special meaning in URL userinfo. The URL.username setter must
  // percent-encode them rather than emit raw special characters that
  // would mis-parse on the receiving side. This test pins that contract.
  it('percent-encodes base64-shaped tokens (+, /, =) in the userinfo for token-as-username', () => {
    const base64Token = 'abc+def/ghi=='; // representative of an Azure DevOps PAT
    const r = buildAuthenticatedCloneUrl('https://dev.azure.com/org/proj/_git/repo', base64Token);
    expect(r.schemeUsed).toBe('token-as-username');
    // `+`, `/`, `=` must be percent-encoded by URL.username setter.
    expect(r.cloneUrl).toContain('abc%2Bdef%2Fghi%3D%3D');
    expect(r.cloneUrl).not.toContain('abc+def/ghi==');
  });

  it('defaults to x-access-token for unknown self-hosted hosts', () => {
    const r = buildAuthenticatedCloneUrl('https://git.acme-corp.internal/foo/bar.git', TOKEN);
    expect(r.schemeUsed).toBe('x-access-token');
    expect(r.cloneUrl).toBe(`https://x-access-token:${TOKEN}@git.acme-corp.internal/foo/bar.git`);
  });
});

describe('buildAuthenticatedCloneUrl -- override + edge cases', () => {
  it('schemeOverride wins over host-derived scheme', () => {
    const r = buildAuthenticatedCloneUrl('https://github.com/foo/bar.git', TOKEN, 'oauth2');
    expect(r.schemeUsed).toBe('oauth2');
    expect(r.cloneUrl).toBe(`https://oauth2:${TOKEN}@github.com/foo/bar.git`);
  });

  it('returns the URL unchanged when no token is supplied', () => {
    const r = buildAuthenticatedCloneUrl('https://github.com/foo/bar.git', undefined);
    expect(r.schemeUsed).toBe('none');
    expect(r.cloneUrl).toBe('https://github.com/foo/bar.git');
  });

  it('returns the URL unchanged when it is not parseable (ssh:// form)', () => {
    const r = buildAuthenticatedCloneUrl('git@github.com:foo/bar.git', TOKEN);
    expect(r.schemeUsed).toBe('none');
    expect(r.cloneUrl).toBe('git@github.com:foo/bar.git');
  });

  it('preserves the .git path suffix and any ref-less form', () => {
    const r = buildAuthenticatedCloneUrl('https://github.com/foo/bar', TOKEN);
    expect(r.cloneUrl).toBe(`https://x-access-token:${TOKEN}@github.com/foo/bar`);
  });
});

describe('diagnoseCloneFailure -- structured pattern matching', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'swao-vcs-auth-test-'));
    mkdirSync(join(tmpRoot, 'apps'), { recursive: true });
    writeFileSync(join(tmpRoot, '.swao.yml'), '# test fixture\n');
    setWorkspaceRoot(tmpRoot);
  });

  afterEach(() => {
    setWorkspaceRoot(null);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('matches GitHub 403 "Write access not granted" pattern', () => {
    const stderr = 'remote: Write access to repository not granted.\nfatal: ... returned error: 403';
    const r = diagnoseCloneFailure(stderr, 'https://github.com/foo/bar.git', 'oauth2');
    expect(r.logCode).toBe('provider.vcs.auth-failed');
    expect(r.hint).toContain('GitHub authentication failed');
    expect(r.hint).toContain('SAML SSO');
    expect(r.hint).toContain("'oauth2'");           // names the wrong scheme used
  });

  it('matches SSH permission-denied pattern', () => {
    const stderr = 'Permission denied (publickey).\nfatal: Could not read from remote repository.';
    const r = diagnoseCloneFailure(stderr, 'git@github.com:foo/bar.git', 'none');
    expect(r.logCode).toBe('provider.vcs.ssh-key-missing');
    expect(r.hint).toContain('ssh-add');
  });

  it('matches network errors', () => {
    const stderr = 'fatal: unable to access ...: Could not resolve host: github.com';
    const r = diagnoseCloneFailure(stderr, 'https://github.com/foo/bar.git', 'x-access-token');
    expect(r.logCode).toBe('provider.vcs.network-unreachable');
    expect(r.hint).toContain('Network error');
  });

  it('falls back to a generic clone-failed entry for unrecognised stderr', () => {
    const stderr = 'fatal: something weird happened';
    const r = diagnoseCloneFailure(stderr, 'https://example.org/foo.git', 'x-access-token');
    expect(r.logCode).toBe('provider.vcs.clone-failed');
    expect(r.hint).toContain('unrecognised stderr pattern');
  });
});
