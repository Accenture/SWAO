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

// Tests for the `swao log` CLI subcommands (#0327 Phase B follow-up).
// Logger core is covered by util/log.test.ts; this file covers the
// CLI surface -- filter logic for tail, regex matching for search,
// run_id lookup for show, mtime cutoff for clear.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setWorkspaceRoot, logPortfolio, logApp } from '@swao/core';
import { cmdTail, cmdShow, cmdSearch, cmdClear } from './log.js';

let tmpRoot: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'swao-log-cli-test-'));
  mkdirSync(join(tmpRoot, 'apps'), { recursive: true });
  writeFileSync(join(tmpRoot, '.swao.yml'), '# test fixture\n');
  setWorkspaceRoot(tmpRoot);
  // Silence the in-test logger console-mirror; capture console.log for
  // the CLI's tail/show/search output.
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  setWorkspaceRoot(null);
  rmSync(tmpRoot, { recursive: true, force: true });
  logSpy.mockRestore();
  errSpy.mockRestore();
  warnSpy.mockRestore();
  // Reset exitCode set by error paths.
  process.exitCode = 0;
});

function tailOutput(): string[] {
  return logSpy.mock.calls.map((args) => String(args[0]));
}

describe('cmdTail -- level filter (#0327)', () => {
  it('default level is warn -- debug + info entries are hidden', () => {
    logPortfolio('debug', 'a.b', 'debug message');
    logPortfolio('info', 'a.b', 'info message');
    logPortfolio('warn', 'a.b', 'warn message');
    logPortfolio('error', 'a.b', 'error message');
    cmdTail({});
    const out = tailOutput().join('\n');
    expect(out).toContain('warn message');
    expect(out).toContain('error message');
    expect(out).not.toContain('debug message');
    expect(out).not.toContain('info message');
  });

  it('--level debug shows everything', () => {
    logPortfolio('debug', 'a.b', 'debug message');
    logPortfolio('info', 'a.b', 'info message');
    logPortfolio('warn', 'a.b', 'warn message');
    cmdTail({ level: 'debug' });
    const out = tailOutput().join('\n');
    expect(out).toContain('debug message');
    expect(out).toContain('info message');
    expect(out).toContain('warn message');
  });

  it('--level error hides warn + enhancement', () => {
    logPortfolio('warn', 'a.b', 'warn message');
    logPortfolio('enhancement', 'a.b', 'enhancement message');
    logPortfolio('error', 'a.b', 'error message');
    cmdTail({ level: 'error' });
    const out = tailOutput().join('\n');
    expect(out).toContain('error message');
    expect(out).not.toContain('warn message');
    expect(out).not.toContain('enhancement message');
  });

  it('enhancement is visible at default level (alongside warn)', () => {
    logPortfolio('enhancement', 'a.b', 'shortcoming detected');
    cmdTail({});
    expect(tailOutput().join('\n')).toContain('shortcoming detected');
  });
});

describe('cmdTail -- scope + app filter (#0327)', () => {
  beforeEach(() => {
    mkdirSync(join(tmpRoot, 'apps', 'sovereign-health'), { recursive: true });
    mkdirSync(join(tmpRoot, 'apps', 'ghostfolio'), { recursive: true });
    logPortfolio('warn', 'p.code', 'portfolio entry');
    logApp('sovereign-health', 'warn', 'a.code', 'sovereign-health entry');
    logApp('ghostfolio', 'warn', 'a.code', 'ghostfolio entry');
  });

  it('--scope portfolio hides app entries', () => {
    cmdTail({ scope: 'portfolio' });
    const out = tailOutput().join('\n');
    expect(out).toContain('portfolio entry');
    expect(out).not.toContain('sovereign-health entry');
    expect(out).not.toContain('ghostfolio entry');
  });

  it('--scope app shows every app entry', () => {
    cmdTail({ scope: 'app' });
    const out = tailOutput().join('\n');
    expect(out).not.toContain('portfolio entry');
    expect(out).toContain('sovereign-health entry');
    expect(out).toContain('ghostfolio entry');
  });

  it('--app <id> narrows to a single app', () => {
    cmdTail({ scope: 'app', app: 'sovereign-health' });
    const out = tailOutput().join('\n');
    expect(out).toContain('sovereign-health entry');
    expect(out).not.toContain('ghostfolio entry');
    expect(out).not.toContain('portfolio entry');
  });
});

describe('cmdTail -- limit + since filter (#0327)', () => {
  it('--limit caps the output at N entries', () => {
    for (let i = 0; i < 10; i++) logPortfolio('warn', `code.${i}`, `message ${i}`);
    cmdTail({ limit: '3' });
    const messageLines = tailOutput().filter((l) => /message \d/.test(l));
    expect(messageLines.length).toBe(3);
  });

  it('--since filters out older entries', () => {
    const old = new Date(Date.now() - 60_000).toISOString();   // 1 min ago
    logPortfolio('warn', 'a', 'older entry');
    // Advance the synthetic timestamp by writing a known future entry
    const future = new Date(Date.now() + 60_000).toISOString();
    logPortfolio('warn', 'b', 'newer entry');
    cmdTail({ since: future });
    const out = tailOutput().join('\n');
    // since=future excludes both -- they were written before `future`.
    expect(out).not.toContain('older entry');
    expect(out).not.toContain('newer entry');
    // since=old includes both -- they were written after `old`.
    logSpy.mockClear();
    cmdTail({ since: old });
    const out2 = tailOutput().join('\n');
    expect(out2).toContain('older entry');
    expect(out2).toContain('newer entry');
  });
});

describe('cmdShow -- run_id lookup (#0327)', () => {
  it('returns entries with the requested run_id', () => {
    logPortfolio('info', 'a', 'one', { run_id: 'r-001' });
    logPortfolio('info', 'b', 'two', { run_id: 'r-002' });
    logPortfolio('info', 'c', 'three', { run_id: 'r-001' });
    cmdShow('r-001');
    const out = tailOutput().join('\n');
    expect(out).toContain('one');
    expect(out).toContain('three');
    expect(out).not.toContain('two');
  });

  it('returns the no-entries message when run_id has no matches', () => {
    logPortfolio('info', 'a', 'one', { run_id: 'r-001' });
    cmdShow('does-not-exist');
    expect(tailOutput().join('\n')).toContain('no entries with run_id');
  });
});

describe('cmdSearch -- regex (#0327)', () => {
  it('matches across code + message + context', () => {
    logPortfolio('warn', 'provider.llm.fallthrough', 'openai requested');
    logPortfolio('warn', 'provider.vcs.auth-failed', 'github 403');
    logPortfolio('warn', 'unrelated.code', 'no match here', { context: { vcs_url: 'https://github.com/foo/bar' } });

    cmdSearch('openai');
    expect(tailOutput().join('\n')).toContain('openai requested');

    logSpy.mockClear();
    cmdSearch('github\\.com');
    const ghOut = tailOutput().join('\n');
    expect(ghOut).toContain('vcs_url');
  });

  it('honours regex meta-characters', () => {
    logPortfolio('warn', 'a.b', 'foo-001');
    logPortfolio('warn', 'a.b', 'foo-bar');
    cmdSearch('foo-\\d+');
    const out = tailOutput().join('\n');
    expect(out).toContain('foo-001');
    expect(out).not.toContain('foo-bar');
  });
});

describe('cmdClear -- mtime cutoff (#0327)', () => {
  it('removes all sink files when no --older-than is supplied', () => {
    logPortfolio('warn', 'a', 'b');
    mkdirSync(join(tmpRoot, 'apps', 'sovereign-health'), { recursive: true });
    logApp('sovereign-health', 'warn', 'a', 'b');
    // Pre-condition: at least two sink files exist on disk.
    cmdClear({});
    expect(existsSync(join(tmpRoot, 'wsp', 'logs'))).toBe(true);  // dir survives
    // Files inside should be gone.
    const portfolioMonth = `portfolio-events-${new Date().toISOString().slice(0, 7)}.ndjson`;
    expect(existsSync(join(tmpRoot, 'wsp', 'logs', portfolioMonth))).toBe(false);
  });

  it('reports nothing-to-remove when no files match the filter', () => {
    cmdClear({});
    expect(tailOutput().join('\n')).toContain('nothing to remove');
  });

  it('--scope portfolio preserves app logs', () => {
    mkdirSync(join(tmpRoot, 'apps', 'sovereign-health'), { recursive: true });
    logPortfolio('warn', 'p', 'portfolio');
    logApp('sovereign-health', 'warn', 'a', 'app');
    cmdClear({ scope: 'portfolio' });
    const month = new Date().toISOString().slice(0, 7);
    expect(existsSync(join(tmpRoot, 'wsp', 'logs', `portfolio-events-${month}.ndjson`))).toBe(false);
    expect(existsSync(join(tmpRoot, 'apps', 'sovereign-health', 'wsp', 'logs', `app-events-${month}.ndjson`))).toBe(true);
  });
});

describe('error paths (#0327)', () => {
  it('cmdTail outside a workspace sets exitCode 1 and prints diagnostic', () => {
    // Clear the cached workspace root and point the resolver at a path
    // that walks up to no `.swao.yml` (an isolated tmpdir, not under
    // the SWAO repo). Avoids `process.chdir`, which vitest worker
    // threads reject with ERR_WORKER_UNSUPPORTED_OPERATION.
    const isolated = mkdtempSync(join(tmpdir(), 'swao-cli-no-workspace-'));
    try {
      // setWorkspaceRoot(null) clears the cache; resolveWorkspaceRoot
      // then walks up from its startDir argument when called from
      // util/log.ts. cmdTail() calls resolveWorkspaceRoot() with the
      // default (cwd), but since the swao/packages/swao tree has no
      // `.swao.yml` on its walk-up path, the resolver returns null
      // and cmdTail's error branch fires.
      setWorkspaceRoot(null);
      cmdTail({});
      expect(process.exitCode).toBe(1);
      const errOut = errSpy.mock.calls.map((args) => String(args[0])).join('\n');
      expect(errOut).toContain('not in a workspace');
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});
