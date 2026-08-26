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

// Unit tests for the doctor `vcs-auth` probe (#0326 sprint-036).
//
// The probe walks `<workspace>/apps/*/.swao.yml` and runs `git ls-remote`
// against each configured VCS URL. Tests exercise the workspace-walk + per-app
// classifier logic against synthesised fixture workspaces under a tmpdir.
// No real network calls (the spawnSync to git ls-remote is mocked via the
// workspace shape: every test fixture uses URLs that the probe should classify
// as `no-token` or `skip-non-https` before reaching the network call).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildVcsAuthProbe, runGitLsRemote } from './vcs-auth-probe.js';
import { CredentialStore } from '@swao/core';

// Empty credential store: isolated tmpdir ensures no real tokens are found,
// so HTTPS-URL tests return no-token without making any network call.
let emptyStore: CredentialStore;
let emptyStoreDir: string;

describe('buildVcsAuthProbe (#0326)', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'swao-vcs-auth-probe-'));
    emptyStoreDir = mkdtempSync(join(tmpdir(), 'swao-empty-creds-'));
    emptyStore = new CredentialStore(emptyStoreDir);
  });

  afterAll(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    if (emptyStoreDir) rmSync(emptyStoreDir, { recursive: true, force: true });
  });

  function createFixture(name: string, swaoYml: Record<string, unknown> | null): string {
    const workspace = join(tmpRoot, name);
    mkdirSync(workspace, { recursive: true });
    if (swaoYml !== null) {
      const appsDir = join(workspace, 'apps');
      mkdirSync(appsDir, { recursive: true });
      for (const [appId, cfg] of Object.entries(swaoYml)) {
        const appDir = join(appsDir, appId);
        mkdirSync(appDir, { recursive: true });
        writeFileSync(
          join(appDir, '.swao.yml'),
          typeof cfg === 'string' ? cfg : (cfg ? JSON.stringify(cfg) : ''),
          'utf-8',
        );
      }
    }
    return workspace;
  }

  it('returns info when workspace has no apps/ directory', async () => {
    const ws = createFixture('no-apps', null);
    const probe = await buildVcsAuthProbe(ws);
    expect(probe.status).toBe('info');
    expect(probe.apps).toHaveLength(0);
    expect(probe.message).toMatch(/No apps\//);
  });

  it('returns info when apps/ exists but has no app subdirectories', async () => {
    const ws = createFixture('empty-apps', {});
    const probe = await buildVcsAuthProbe(ws);
    expect(probe.status).toBe('info');
    expect(probe.apps).toHaveLength(0);
  });

  it('classifies app with no source.vcs.url as no-vcs-config', async () => {
    const ws = createFixture('no-vcs', {
      'local-app': 'app:\n  id: local-app\nsource:\n  path: source/\n',
    });
    const probe = await buildVcsAuthProbe(ws);
    expect(probe.apps).toHaveLength(1);
    expect(probe.apps[0].app_id).toBe('local-app');
    expect(probe.apps[0].outcome).toBe('no-vcs-config');
  });

  it('classifies non-HTTPS (ssh://) URLs as skip-non-https', async () => {
    const ws = createFixture('ssh-url', {
      'ssh-app': 'app:\n  id: ssh-app\nsource:\n  vcs:\n    url: git@github.com:foo/bar.git\n',
    });
    const probe = await buildVcsAuthProbe(ws);
    expect(probe.apps).toHaveLength(1);
    expect(probe.apps[0].outcome).toBe('skip-non-https');
    expect(probe.apps[0].hint).toMatch(/SSH/i);
  });

  it('skips reserved documentation TLD hosts as skip-fixture-host (#1416)', async () => {
    // .test is a reserved TLD (RFC 6761): the probe must never contact it,
    // regardless of what the machine's credential store contains. Before
    // #1416 this test tolerated a real ls-remote against the fixture host
    // (~20s DNS stall); now the skip happens before any token lookup.
    const ws = createFixture('https-app', {
      'https-app': 'app:\n  id: https-app\nsource:\n  vcs:\n    url: https://example.invalid.test/foo/bar.git\n',
    });
    const probe = await buildVcsAuthProbe(ws);
    expect(probe.apps).toHaveLength(1);
    expect(probe.apps[0].host).toBe('example.invalid.test');
    expect(probe.apps[0].outcome).toBe('skip-fixture-host');
  });

  it('skips .example fixture hosts before any network call (#1416)', async () => {
    const ws = createFixture('fixture-host', {
      'legacy-billing': 'source:\n  vcs:\n    url: https://bitbucket.acme.example/scm/fin/legacy-billing.git\n',
    });
    const probe = await buildVcsAuthProbe(ws);
    expect(probe.apps).toHaveLength(1);
    expect(probe.apps[0].outcome).toBe('skip-fixture-host');
    expect(probe.status).toBe('info');
  });

  it('ignores the legacy unscoped vcs-token key -- probe is provider-scoped only (#1416)', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'swao-legacy-token-'));
    try {
      const store = new CredentialStore(storeDir);
      await store.set('vcs-token', 'not-a-real-token-value');
      const ws = createFixture('legacy-token', {
        'gh-app': 'source:\n  vcs:\n    url: https://github.com/foo/bar.git\n',
      });
      const probe = await buildVcsAuthProbe(ws, store);
      expect(probe.apps).toHaveLength(1);
      // The legacy key must NOT reach the ls-remote branch: outcome is
      // no-token (with the provider-scoped key named in the hint), and no
      // network call happens.
      expect(probe.apps[0].outcome).toBe('no-token');
      expect(probe.apps[0].hint).toMatch(/provider:github:token|credential set/);
    } finally {
      rmSync(storeDir, { recursive: true, force: true });
    }
  });

  it('returns a per-app entry for each app, in stable order', async () => {
    // Pass emptyStore so HTTPS app-b returns no-token immediately without any
    // git ls-remote network call.
    const ws = createFixture('multi-app', {
      'app-a': 'source:\n  path: source/\n',
      'app-b': 'source:\n  vcs:\n    url: https://github.com/foo/bar.git\n',
      'app-c': 'source:\n  vcs:\n    url: git@github.com:foo/bar.git\n',
    });
    const probe = await buildVcsAuthProbe(ws, emptyStore);
    expect(probe.apps).toHaveLength(3);
    const appIds = probe.apps.map((a) => a.app_id).sort();
    expect(appIds).toEqual(['app-a', 'app-b', 'app-c']);
  });

  it('captures parseable hostnames in the host field for HTTPS URLs', async () => {
    // Pass emptyStore so the probe finds no token and returns no-token
    // immediately, without making any git ls-remote network call.
    const ws = createFixture('host-extract', {
      'github': 'source:\n  vcs:\n    url: https://github.com/foo/bar.git\n',
      'gitlab': 'source:\n  vcs:\n    url: https://gitlab.com/foo/bar.git\n',
    });
    const probe = await buildVcsAuthProbe(ws, emptyStore);
    const byApp = Object.fromEntries(probe.apps.map((a) => [a.app_id, a]));
    expect(byApp['github'].host).toBe('github.com');
    expect(byApp['gitlab'].host).toBe('gitlab.com');
  });

  it('returns aggregated status info when all apps lack VCS config or token', async () => {
    const ws = createFixture('all-info', {
      'no-vcs': 'source:\n  path: source/\n',
      'ssh-only': 'source:\n  vcs:\n    url: git@github.com:foo/bar.git\n',
    });
    const probe = await buildVcsAuthProbe(ws);
    expect(probe.status).toBe('info');
  });

  it('skips apps with unparseable .swao.yml as no-vcs-config', async () => {
    const ws = createFixture('bad-yaml', {
      'corrupt': 'this is: not\n  valid:\n    [yaml',
    });
    const probe = await buildVcsAuthProbe(ws);
    expect(probe.apps).toHaveLength(1);
    expect(probe.apps[0].outcome).toBe('no-vcs-config');
    expect(probe.apps[0].hint).toMatch(/unparseable|No source/);
  });

  it('ignores apps whose name starts with a dot (hidden / system dirs)', async () => {
    const ws = createFixture('hidden-app', {
      '.hidden': 'source:\n  vcs:\n    url: https://github.com/foo/bar.git\n',
      'real-app': 'source:\n  path: source/\n',
    });
    const probe = await buildVcsAuthProbe(ws);
    expect(probe.apps).toHaveLength(1);
    expect(probe.apps[0].app_id).toBe('real-app');
  });
});

// #1415 regression: the ls-remote runner must return when the DIRECT child
// exits or the deadline fires, even when a grandchild inherits the stderr
// pipe and keeps it open (git.exe -> git-remote-https on Windows). The old
// spawnSync implementation blocked on pipe EOF until the grandchild died.
describe('runGitLsRemote (#1415)', () => {
  it('resolves on child exit even when a grandchild holds the stderr pipe open', async () => {
    // Fake git: writes to stderr, spawns a grandchild that inherits stdio and
    // sleeps 15s, then exits immediately itself.
    const script =
      "process.stderr.write('parent stderr');" +
      "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{},15000)'], {stdio: 'inherit'});" +
      'process.exit(7);';
    const started = Date.now();
    const result = await runGitLsRemote(['-e', script], 10_000, process.execPath);
    const elapsed = Date.now() - started;
    expect(result.status).toBe(7);
    expect(result.stderr).toContain('parent stderr');
    // Must not wait for the 15s grandchild; generous margin for Windows CI (tree-kill latency).
    expect(elapsed).toBeLessThan(14_000);
  }, 20_000);

  it('kills the tree and reports a timeout when the child outlives the deadline', async () => {
    const started = Date.now();
    const result = await runGitLsRemote(['-e', 'setTimeout(()=>{},15000)'], 1_500, process.execPath);
    const elapsed = Date.now() - started;
    expect(result.status).toBeNull();
    expect(result.stderr).toMatch(/timed out/);
    // Windows process tree teardown can be slow; allow up to 18s (test timeout is 30s).
    expect(elapsed).toBeLessThan(18_000);
  }, 30_000);
});
