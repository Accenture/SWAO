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

// #3439: clone wrapper -- long paths, non-interactive credentials, URL scheme
// telemetry, credential redaction. child_process is mocked, so this file stays
// in the parallel "unit" vitest project (vitest.config.ts SPAWN_TESTS rule).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...a: unknown[]) => spawnMock(...a),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

const {
  buildCloneArgs, buildCloneEnv, parseVcsUrlScheme, redactVcsUrl, runGitClone, NON_INTERACTIVE_GIT_ENV,
  cloneTimeoutMsFromVcs, CLONE_TIMEOUT_MS,
} = await import('./clone.js');

// Deliberately NOT a real PAT shape so secret-detection.gate.sh needs no allowlist entry.
const TOKEN = 'fake-pat-3439-not-a-real-token';

class FakeChild extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  stderr = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  pid = 4242;
  kill = vi.fn();
}

describe('buildCloneArgs (#3439)', () => {
  it('passes core.longpaths=true as a top-level -c before the clone sub-command', () => {
    const args = buildCloneArgs({ cloneUrl: 'https://github.com/o/r.git', targetPath: 'C:\\w\\src' });
    const i = args.indexOf('core.longpaths=true');
    expect(i).toBeGreaterThan(0);
    expect(args[i - 1]).toBe('-c');
    expect(i).toBeLessThan(args.indexOf('clone'));
  });

  it('disables GCM interactivity via config and keeps the shallow quiet clone shape', () => {
    const args = buildCloneArgs({ cloneUrl: 'https://github.com/o/r.git', targetPath: '/t', ref: 'main' });
    expect(args).toContain('credential.interactive=never');
    expect(args.slice(args.indexOf('clone'))).toEqual(
      ['clone', '--depth', '1', '--quiet', '--branch', 'main', 'https://github.com/o/r.git', '/t'],
    );
  });
});

describe('buildCloneEnv (#3439)', () => {
  it('sets GIT_TERMINAL_PROMPT=0 and GCM_INTERACTIVE=never and keeps the base + GIT_CONFIG_* env', () => {
    const env = buildCloneEnv(
      { PATH: '/usr/bin', HOME: '/home/op' },
      { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.proxy', GIT_CONFIG_VALUE_0: 'http://proxy:3128' },
    );
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GCM_INTERACTIVE).toBe('never');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/op');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.proxy');
  });

  it('cannot be overridden back to interactive by the operator shell', () => {
    const env = buildCloneEnv({ GIT_TERMINAL_PROMPT: '1', GCM_INTERACTIVE: 'always' });
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GCM_INTERACTIVE).toBe('never');
  });
});

describe('parseVcsUrlScheme (#3439)', () => {
  it.each([
    ['https://github.com/o/r.git', 'https'],
    ['HTTPS://GitHub.com/o/r.git', 'https'],
    [`https://x-access-token:${TOKEN}@github.com/o/r.git`, 'https'],
    ['http://gitlab.intra/o/r.git', 'http'],
    ['ssh://git@host.example:22/o/r.git', 'ssh'],
    ['git+ssh://git@host/o/r.git', 'ssh'],
    ['git@github.com:o/r.git', 'scp'],
    ['host.example:o/r.git', 'scp'],
    ['git://host/o/r.git', 'git'],
    ['file:///srv/git/r.git', 'file'],
    ['C:\\repos\\r', 'local-path'],
    ['C:/repos/r', 'local-path'],
    ['\\\\server\\share\\r', 'local-path'],
    ['/srv/git/r', 'local-path'],
    ['', 'unknown'],
    ['github.com/o/r', 'unknown'],
  ])('%s -> %s', (url, expected) => {
    expect(parseVcsUrlScheme(url)).toBe(expected);
  });
});

describe('redactVcsUrl (#3439)', () => {
  it('strips user:token userinfo from https URLs', () => {
    const r = redactVcsUrl(`https://x-access-token:${TOKEN}@github.com/o/r.git`);
    expect(r).toBe('https://github.com/o/r.git');
    expect(r).not.toContain(TOKEN);
  });

  it('strips token-as-username userinfo', () => {
    expect(redactVcsUrl(`https://${TOKEN}@dev.azure.com/org/p/_git/r`)).toBe('https://dev.azure.com/org/p/_git/r');
  });

  it('leaves credential-free and scp-style URLs untouched', () => {
    expect(redactVcsUrl('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(redactVcsUrl('git@github.com:o/r.git')).toBe('git@github.com:o/r.git');
  });
});

describe('runGitClone (#3439)', () => {
  beforeEach(() => { spawnMock.mockReset(); });

  it('spawns git asynchronously with the given args + env and resolves on direct-child exit', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const args = buildCloneArgs({ cloneUrl: 'https://github.com/o/r.git', targetPath: '/t' });
    const env = buildCloneEnv({ PATH: '/bin' });
    const p = runGitClone(args, env, 5_000);
    child.stderr.emit('data', Buffer.from('fatal: could not read Username for \'https://github.com\': terminal prompts disabled'));
    child.emit('exit', 128);
    const r = await p;
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, passedArgs, opts] = spawnMock.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv; windowsHide: boolean }];
    expect(cmd).toBe('git');
    expect(passedArgs).toContain('core.longpaths=true');
    expect(opts.env).toMatchObject({ ...NON_INTERACTIVE_GIT_ENV, PATH: '/bin' });
    expect(opts.windowsHide).toBe(true);
    expect(r.status).toBe(128);
    expect(r.timedOut).toBe(false);
    expect(r.stderr).toContain('terminal prompts disabled');
    expect(child.stderr.destroy).toHaveBeenCalled();
  });

  it('kills the child and reports a timeout when the deadline passes', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      spawnMock.mockReturnValue(child);
      const p = runGitClone(['clone'], {}, 1_000);
      await vi.advanceTimersByTimeAsync(1_100);
      const r = await p;
      expect(r.status).toBeNull();
      expect(r.timedOut).toBe(true);
      expect(r.stderr).toMatch(/timed out/);
      if (process.platform !== 'win32') expect(child.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps a missing git binary to a readable stderr line', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const p = runGitClone(['clone'], {}, 5_000);
    child.emit('error', Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
    const r = await p;
    expect(r.status).toBeNull();
    expect(r.stderr).toContain('git is not installed');
  });
});

describe('cloneTimeoutMsFromVcs (#3439)', () => {
  it('defaults to 10 minutes when source.vcs.clone_timeout_minutes is absent', () => {
    expect(CLONE_TIMEOUT_MS).toBe(10 * 60_000);
    expect(cloneTimeoutMsFromVcs(undefined)).toBe(CLONE_TIMEOUT_MS);
  });

  it('converts configured minutes to milliseconds', () => {
    expect(cloneTimeoutMsFromVcs(1)).toBe(60_000);
    expect(cloneTimeoutMsFromVcs(45)).toBe(45 * 60_000);
    expect(cloneTimeoutMsFromVcs(240)).toBe(240 * 60_000);
  });

  it('falls back to the default for values that are not positive finite numbers', () => {
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '30', null]) {
      expect(cloneTimeoutMsFromVcs(v)).toBe(CLONE_TIMEOUT_MS);
    }
  });
});
