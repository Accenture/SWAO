// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Unit tests for the doctor `prerequisites` probe (#0326 sprint-036).
//
// Tests run on the dev machine where `git` + `ssh` + `node` are typically all
// on PATH; we exercise the happy-path + the shape of the returned object,
// and assert the classifier logic separately by re-importing the helper.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { buildPrerequisitesProbe, detectPrerequisiteTools, PREREQUISITE_VERSION_PROBES } from './prerequisites-probe.js';
import type { ToolRunRequest, ToolRunResult } from '@swao/core';

// Each test calls spawnSync('git', ...) etc. which is fast alone but can be
// slow under full-suite parallel load. Raise timeout to 60s for the whole suite (D-32 #3294).
describe('buildPrerequisitesProbe (#0326)', { timeout: 60_000 }, () => {
  it('returns a result object with the expected shape', () => {
    const probe = buildPrerequisitesProbe();
    expect(probe).toHaveProperty('status');
    expect(probe).toHaveProperty('tools');
    expect(probe).toHaveProperty('message');
    expect(Array.isArray(probe.tools)).toBe(true);
  });

  it('reports exactly seven tools in declared order: git, ssh, node, gitleaks, osv-scanner, clamav, yara', () => {
    const probe = buildPrerequisitesProbe();
    expect(probe.tools).toHaveLength(7);
    expect(probe.tools[0].name).toBe('git');
    expect(probe.tools[1].name).toBe('ssh');
    expect(probe.tools[2].name).toBe('node');
    expect(probe.tools[3].name).toBe('gitleaks');
    expect(probe.tools[4].name).toBe('osv-scanner');
    expect(probe.tools[5].name).toBe('clamav');
    expect(probe.tools[6].name).toBe('yara');
  });

  it('marks `git` as required and the other six tools as optional', () => {
    const probe = buildPrerequisitesProbe();
    expect(probe.tools[0].required).toBe(true);
    for (const tool of probe.tools.slice(1)) {
      expect(tool.required).toBe(false);
    }
  });

  it('detects git on the dev machine (CI + local should have it)', () => {
    const probe = buildPrerequisitesProbe();
    // git is the required tool; the test machine running vitest has it
    expect(probe.tools[0].available).toBe(true);
    expect(probe.tools[0].version).toMatch(/git/i);
  });

  it('returns status in { ok, info, warn, fail } -- no unexpected values', () => {
    const probe = buildPrerequisitesProbe();
    expect(['ok', 'info', 'warn', 'fail']).toContain(probe.status);
  });

  it('message references the operator-facing install command when git is missing', () => {
    // Can't actually remove git from PATH for a test; assert the
    // fail-path message shape via inspection of the source. Lightweight
    // contract test against the literal install instructions.
    const probe = buildPrerequisitesProbe();
    if (probe.status === 'fail') {
      expect(probe.message).toMatch(/git/i);
      expect(probe.message).toMatch(/(brew|apt-get|git-scm)/i);
    } else {
      // Happy path: no install instructions in the message
      expect(probe.message).not.toMatch(/install git/i);
    }
  });

  it('tool version strings are first-line, trimmed, non-empty (when available)', () => {
    const probe = buildPrerequisitesProbe();
    for (const tool of probe.tools) {
      if (tool.available) {
        expect(tool.version).not.toBeNull();
        expect(tool.version!.length).toBeGreaterThan(0);
        expect(tool.version).not.toMatch(/\n/); // first line only
        expect(tool.version).toBe(tool.version!.trim()); // trimmed
      } else {
        expect(tool.version).toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Binary mode -- node false-positive fix (#2964 Part C)
// ---------------------------------------------------------------------------

describe('buildPrerequisitesProbe -- binary mode', { timeout: 60_000 }, () => { // D-32 (#3294): spawns tool probes
  beforeEach(() => {
    // Simulate running inside a pkg binary: process.pkg property exists.
    (process as Record<string, unknown>)['pkg'] = {};
  });
  afterEach(() => {
    delete (process as Record<string, unknown>)['pkg'];
  });

  it('marks node as available with process.version in binary mode', () => {
    const probe = buildPrerequisitesProbe();
    const nodeTool = probe.tools.find((t) => t.name === 'node');
    expect(nodeTool).toBeDefined();
    expect(nodeTool!.available).toBe(true);
    expect(nodeTool!.version).toBe(process.version);
  });

  it('does not report node as missing in binary mode even when not on PATH', () => {
    const probe = buildPrerequisitesProbe();
    expect(probe.message).not.toMatch(/node.*not on PATH/i);
  });
});

// ---------------------------------------------------------------------------
// #3375 (ADR-0069): missing git is WARN unless an app declares a VCS source
// ---------------------------------------------------------------------------

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findVcsSourcedApps } from './prerequisites-probe.js';

describe('buildPrerequisitesProbe -- git rule (#3375)', () => {
  let ws: string;
  // Every tool present except git.
  const noGit = (cmd: string) => (cmd === 'git' ? null : `${cmd} 1.0.0`);
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'swao-prereq-'));
    mkdirSync(join(ws, 'apps', 'local-app'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'local-app', '.swao.yml'), 'app_id: local-app\nsource:\n  path: wsp/inputs/source/\n', 'utf-8');
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it('warns (not fails) when git is missing and no app has a VCS source', () => {
    const probe = buildPrerequisitesProbe(ws, { detect: noGit });
    expect(probe.status).toBe('warn');
    expect(probe.message).toMatch(/git/);
    expect(probe.message).toMatch(/none configured/);
  });

  it('warns when git is missing and there is no workspace', () => {
    expect(buildPrerequisitesProbe(undefined, { detect: noGit }).status).toBe('warn');
  });

  it('fails when git is missing and an app declares a VCS source, naming the app', () => {
    mkdirSync(join(ws, 'apps', 'vcs-app'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'vcs-app', '.swao.yml'),
      'app_id: vcs-app\nsource:\n  vcs:\n    type: github\n    url: https://github.com/example/repo.git\n', 'utf-8');
    const probe = buildPrerequisitesProbe(ws, { detect: noGit });
    expect(probe.status).toBe('fail');
    expect(probe.message).toContain('vcs-app');
    expect(probe.message).not.toContain('local-app');
  });

  it('findVcsSourcedApps ignores apps without source.vcs and unreadable files', () => {
    mkdirSync(join(ws, 'apps', 'broken'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'broken', '.swao.yml'), ':\n  - [unclosed', 'utf-8');
    expect(findVcsSourcedApps(ws)).toEqual([]);
  });

  it('is ok when every tool is present', () => {
    const probe = buildPrerequisitesProbe(ws, { detect: (cmd) => `${cmd} 1.0.0` });
    expect(['ok', 'info']).toContain(probe.status);
  });
});

describe('buildPrerequisitesProbe -- default secret scan (#3419)', () => {
  it('warns that the default secret scan needs gitleaks when it is missing', () => {
    const probe = buildPrerequisitesProbe(undefined, { detect: (cmd) => (cmd === 'gitleaks' ? null : `${cmd} 1.0.0`) });
    expect(probe.status).toBe('warn');
    expect(probe.message).toContain('`gitleaks`');
    expect(probe.message).toMatch(/default secret scan/);
    expect(probe.message).toMatch(/Passes not executed/);
  });

  it('keeps the opt-in wording when only the full-scan tools are missing', () => {
    const probe = buildPrerequisitesProbe(undefined, { detect: (cmd) => (cmd === 'clamscan' ? null : `${cmd} 1.0.0`) });
    expect(probe.status).toBe('warn');
    expect(probe.message).not.toMatch(/default secret scan/);
  });
});

describe('buildPrerequisitesProbe -- optional code health tools (#3487)', () => {
  const allFound = (cmd: string): string => `${cmd} 1.0.0`;
  const tool = (name: 'lizard' | 'jscpd', status: 'present' | 'absent' | 'unsupported_version', version: string | null) => ({
    name, status, version, supported_range: name === 'lizard' ? '>=1.17.0 <1.18.0' : '>=4.0.0 <5.0.0', invocation: null,
  });

  it('lists lizard and jscpd as present / version / absent without changing the status', () => {
    const base = buildPrerequisitesProbe(undefined, { detect: allFound });
    const probe = buildPrerequisitesProbe(undefined, {
      detect: allFound,
      codeHealthTools: [tool('jscpd', 'absent', null), tool('lizard', 'present', '1.17.13')],
    });
    expect(probe.status).toBe(base.status);
    expect(probe.tools.slice(7)).toEqual([
      { name: 'jscpd', available: false, version: null, required: false },
      { name: 'lizard', available: true, version: '1.17.13', required: false },
    ]);
    expect(probe.message).toContain('Optional code health tools (Pass 26, opt-in via assessment.code_health.tools): jscpd not found, lizard 1.17.13.');
  });

  it('names an unsupported version with the supported range', () => {
    const probe = buildPrerequisitesProbe(undefined, { detect: allFound, codeHealthTools: [tool('jscpd', 'unsupported_version', '3.5.10')] });
    expect(probe.message).toContain('jscpd 3.5.10 (unsupported, needs >=4.0.0 <5.0.0)');
    expect(probe.tools[7]).toMatchObject({ name: 'jscpd', available: true, version: '3.5.10' });
  });

  it('absent code health tools are never read as missing malware tools', () => {
    const probe = buildPrerequisitesProbe(undefined, { detect: allFound, codeHealthTools: [tool('lizard', 'absent', null), tool('jscpd', 'absent', null)] });
    expect(probe.message).not.toMatch(/malware/);
    expect(probe.status).not.toBe('warn');
  });
});


// #4461: the version probes run concurrently through the async runner; the answers follow the detectTool rules.
describe('detectPrerequisiteTools (#4461)', () => {
  const ok = (stdout: string, stderr = '', exitCode: number | null = 0): ToolRunResult => ({ exitCode, stdout, stderr, timedOut: false, spawnError: null });
  const NL = String.fromCharCode(10);
  it('starts every version probe at once and answers like detectTool', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const seen: ToolRunRequest[] = [];
    const replies: Record<string, ToolRunResult> = {
      git: ok('git version 2.43.0' + NL),
      ssh: ok('', 'OpenSSH_9.5p1, LibreSSL 3.3.6' + NL),
      node: ok('/snapshot/x' + NL + 'v22.11.0' + NL),
      gitleaks: ok('', 'boom', 1),
      'osv-scanner': { exitCode: null, stdout: '', stderr: '', timedOut: true, spawnError: null },
      clamscan: { exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: 'spawn clamscan ENOENT' },
      yara: ok('4.5.0' + NL),
    };
    const runner = async (req: ToolRunRequest): Promise<ToolRunResult> => {
      seen.push(req);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return replies[req.command]!;
    };
    const d = await detectPrerequisiteTools(runner, { timeoutMs: 1234 });
    expect(maxInFlight).toBe(PREREQUISITE_VERSION_PROBES.length);
    expect(seen.slice(0, PREREQUISITE_VERSION_PROBES.length).every((r) => r.timeoutMs === 1234 && r.args.length === 1)).toBe(true);
    expect(d.detect('git', '--version')).toBe('git version 2.43.0');
    expect(d.detect('ssh', '-V')).toBe('OpenSSH_9.5p1, LibreSSL 3.3.6');
    expect(d.detect('node', '--version', /^v[0-9]+[.][0-9]+[.][0-9]+/)).toBe('v22.11.0');
    expect(d.detect('gitleaks', 'version')).toBe('boom');
    expect(d.detect('osv-scanner', '--version')).toBeNull();
    expect(d.detect('clamscan', '--version')).toBeNull();
    expect(d.detect('yara', '--version')).toBe('4.5.0');
    expect(Object.keys(d.ms).sort()).toEqual(PREREQUISITE_VERSION_PROBES.map((p) => p.cmd).sort());
    // The probe built from the detections names the same tools as a serial run would.
    const probe = buildPrerequisitesProbe(undefined, { detect: d.detect });
    expect(probe.tools.find((x) => x.name === 'git')!.version).toBe('git version 2.43.0');
    expect(probe.tools.find((x) => x.name === 'clamav')!.available).toBe(false);
  });

  it('a runner that throws answers null, never rejects', async () => {
    const d = await detectPrerequisiteTools(async () => { throw new Error('no spawn'); });
    expect(d.detect('git', '--version')).toBeNull();
    // #4488: a runner failure is not "not found".
    expect(d.outcome['git']).toBe('error');
  });
});

// #4488: a version check that times out is never "not found"; only ENOENT is.
describe('timed-out version checks (#4488)', () => {
  const NL = String.fromCharCode(10);
  const found = (stdout: string): ToolRunResult => ({ exitCode: 0, stdout, stderr: '', timedOut: false, spawnError: null });
  const timeout: ToolRunResult = { exitCode: null, stdout: '', stderr: '', timedOut: true, spawnError: null };
  const enoent = (cmd: string): ToolRunResult => ({ exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: `spawn ${cmd} ENOENT`, spawnErrorCode: 'ENOENT' });
  /** A fake runner: per command a list of replies, one per call; the calls are counted. */
  const fakeRunner = (replies: Record<string, ToolRunResult[]>) => {
    const calls: ToolRunRequest[] = [];
    const runner = async (req: ToolRunRequest): Promise<ToolRunResult> => {
      calls.push(req);
      const list = replies[req.command] ?? [found(`${req.command} 1.0.0` + NL)];
      const n = calls.filter((c) => c.command === req.command).length;
      return list[Math.min(n, list.length) - 1]!;
    };
    return { runner, calls, count: (cmd: string) => calls.filter((c) => c.command === cmd).length };
  };
  let ws: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'swao-prereq-4488-'));
    mkdirSync(join(ws, 'apps', 'repo-app'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'repo-app', '.swao.yml'), 'source:' + NL + '  vcs:' + NL + '    url: https://example.invalid/repo.git' + NL);
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it('a timeout of git followed by an answer on the retry finds git', async () => {
    const f = fakeRunner({ git: [timeout, found('git version 2.47.1.windows.1' + NL)] });
    const d = await detectPrerequisiteTools(f.runner, { timeoutMs: 5_000, retryTimeoutMs: 15_000 });
    expect(f.count('git')).toBe(2);
    // The retry runs alone, with the longer timeout.
    expect(f.calls.filter((c) => c.command === 'git').map((c) => c.timeoutMs)).toEqual([5_000, 15_000]);
    expect(d.outcome['git']).toBe('found');
    expect(d.timedOut).toEqual([]);
    expect(typeof d.retryMs['git']).toBe('number');
    const probe = buildPrerequisitesProbe(ws, { detect: d.detect, unanswered: d.unanswered });
    expect(probe.tools[0]).toMatchObject({ name: 'git', available: true, version: 'git version 2.47.1.windows.1' });
    expect(probe.status).not.toBe('fail');
  });

  it('git that times out twice gives warn with the timeout text and no "not found", even with a VCS-sourced app', async () => {
    const f = fakeRunner({ git: [timeout, timeout] });
    const d = await detectPrerequisiteTools(f.runner, { timeoutMs: 5_000, retryTimeoutMs: 15_000 });
    expect(f.count('git')).toBe(2);
    expect(d.outcome['git']).toBe('timeout');
    expect(d.timedOut).toEqual(['git']);
    const probe = buildPrerequisitesProbe(ws, { detect: d.detect, unanswered: d.unanswered });
    expect(probe.status).toBe('warn');
    expect(probe.message).toContain('`git` did not answer within 15 s');
    expect(probe.message).not.toMatch(/not found/);
    expect(probe.message).not.toMatch(/Install git/);
    expect(probe.tools[0]).toMatchObject({ name: 'git', available: false, unanswered: 'timeout' });
  });

  it('ENOENT still gives not found (fail with a VCS-sourced app), with exactly one call', async () => {
    const f = fakeRunner({ git: [enoent('git')] });
    const d = await detectPrerequisiteTools(f.runner);
    expect(f.count('git')).toBe(1);
    expect(d.outcome['git']).toBe('not_found');
    const probe = buildPrerequisitesProbe(ws, { detect: d.detect, unanswered: d.unanswered });
    expect(probe.status).toBe('fail');
    expect(probe.message).toMatch(/`git` not found on PATH/);
    expect(probe.tools[0]!.unanswered).toBeUndefined();
  });

  it('a start error other than ENOENT is not "not found"', async () => {
    const f = fakeRunner({ git: [{ exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: 'spawn git EACCES', spawnErrorCode: 'EACCES' }] });
    const d = await detectPrerequisiteTools(f.runner);
    expect(f.count('git')).toBe(1);
    expect(d.outcome['git']).toBe('error');
    const probe = buildPrerequisitesProbe(ws, { detect: d.detect, unanswered: d.unanswered });
    expect(probe.status).toBe('warn');
    expect(probe.message).toContain('`git` could not be started (EACCES)');
    expect(probe.message).not.toMatch(/not found on PATH/);
  });

  it('a multi-line start error without a code stays on one short line', async () => {
    const long = 'first line of a long start error that goes on and on and on and on' + NL + 'second line';
    const f = fakeRunner({ git: [{ exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: long }] });
    const d = await detectPrerequisiteTools(f.runner);
    const probe = buildPrerequisitesProbe(ws, { detect: d.detect, unanswered: d.unanswered });
    expect(probe.message).not.toContain(NL);
    expect(probe.message).toMatch(/could not be started [(]first line of a long start error[^)]*[.][.][.][)]/);
    expect(probe.message).not.toContain('second line');
  });

  it('a malware tool that times out is not listed as not found; a missing one still is', async () => {
    const f = fakeRunner({ gitleaks: [timeout, timeout], yara: [enoent('yara')] });
    const d = await detectPrerequisiteTools(f.runner);
    const probe = buildPrerequisitesProbe(undefined, { detect: d.detect, unanswered: d.unanswered });
    expect(probe.status).toBe('warn');
    expect(probe.message).toContain('`yara` not found on PATH');
    expect(probe.message).not.toContain('`gitleaks` not found');
    expect(probe.message).toContain('`gitleaks` did not answer within 15 s');
  });

  it('every tool carries its wall clock and outcome', async () => {
    const f = fakeRunner({ ssh: [timeout, found('OpenSSH_9.5' + NL)], clamscan: [enoent('clamscan')] });
    const d = await detectPrerequisiteTools(f.runner);
    const isBinary = Object.prototype.hasOwnProperty.call(process, 'pkg');
    const cmds = PREREQUISITE_VERSION_PROBES.map((p) => p.cmd).filter((c) => !(isBinary && c === 'node'));
    expect(Object.keys(d.ms).sort()).toEqual([...cmds].sort());
    expect(Object.keys(d.outcome).sort()).toEqual([...cmds].sort());
    expect(d.outcome['ssh']).toBe('found');
    expect(d.outcome['clamscan']).toBe('not_found');
    expect(Object.keys(d.retryMs)).toEqual(['ssh']);
  });
});
