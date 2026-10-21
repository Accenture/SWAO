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
import { buildPrerequisitesProbe } from './prerequisites-probe.js';

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
