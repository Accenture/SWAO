// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3440: the licence state file (assessment counter) is written atomically
// (temp file + rename, short retry on a locked Windows target) and a
// truncated or malformed file is preserved and reported, never reset to 0.

import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _paths, _stateIo, LicenseGuard, LicenseInvalidError } from './license-guard.js';
import { setWorkspaceRoot } from './log.js';

let dir = '';
let ws = '';
const savedPaths = { ..._paths };
const savedIo = { ..._stateIo };

const STATE = { first_run: '2020-01-01', assessment_count: 7, fingerprint: 'abcdef0123456789', fp_version: 2 };

function count(): number {
  return (JSON.parse(readFileSync(_paths.statePath, 'utf-8')) as { assessment_count: number }).assessment_count;
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

function leftovers(): string[] {
  return readdirSync(dir).filter(f => f.endsWith('.tmp'));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swao-3440-state-'));
  ws = mkdtempSync(join(tmpdir(), 'swao-3440-ws-'));
  _paths.statePath = join(dir, 'licence-state.json');
  _paths.licensePath = join(dir, 'licence', 'licence.json');
  _paths.legacyLicencePath = join(dir, 'nonexistent-legacy.json');
  writeFileSync(_paths.statePath, JSON.stringify(STATE, null, 2), 'utf-8');
  _stateIo.sleep = () => undefined; // no real pauses in tests
  // Route the structured log into a scratch workspace, never a real one.
  setWorkspaceRoot(ws);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  Object.assign(_paths, savedPaths);
  Object.assign(_stateIo, savedIo);
  setWorkspaceRoot(null);
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  rmSync(ws, { recursive: true, force: true });
});

describe('atomic licence state write (#3440)', () => {
  it('increments through a temp file + rename and leaves no temp file behind', () => {
    const renames: Array<[string, string]> = [];
    _stateIo.rename = (from, to) => { renames.push([from, to]); savedIo.rename(from, to); };
    LicenseGuard.load().incrementAssessmentCount();
    expect(count()).toBe(8);
    expect(renames).toHaveLength(1);
    expect(renames[0]![1]).toBe(_paths.statePath);
    expect(renames[0]![0]).toMatch(/\.tmp$/);
    expect(join(renames[0]![0], '..')).toBe(dir); // same directory, same volume
    expect(leftovers()).toEqual([]);
  });

  it('creates a missing state file atomically too', () => {
    rmSync(_paths.statePath);
    const renames: string[] = [];
    _stateIo.rename = (from, to) => { renames.push(to); savedIo.rename(from, to); };
    LicenseGuard.load();
    expect(renames).toEqual([_paths.statePath]);
    expect(count()).toBe(0);
  });

  it('on Windows retries a briefly locked target (EPERM, EBUSY) and counts once', () => {
    _stateIo.isWindows = () => true;
    const sleeps: number[] = [];
    _stateIo.sleep = (ms) => { sleeps.push(ms); };
    const failures = [errno('EPERM'), errno('EBUSY')];
    let attempts = 0;
    _stateIo.rename = (from, to) => {
      attempts++;
      const f = failures.shift();
      if (f) throw f;
      savedIo.rename(from, to);
    };
    LicenseGuard.load().incrementAssessmentCount();
    expect(attempts).toBe(3);
    expect(sleeps).toHaveLength(2);
    expect(count()).toBe(8);
    expect(leftovers()).toEqual([]);
  });

  it('gives up after a few attempts, removes the temp file, keeps the old count and throws', () => {
    _stateIo.isWindows = () => true;
    let attempts = 0;
    _stateIo.rename = () => { attempts++; throw errno('EPERM'); };
    expect(() => LicenseGuard.load().incrementAssessmentCount()).toThrow(/EPERM/);
    expect(attempts).toBe(5);
    expect(count()).toBe(7);
    expect(leftovers()).toEqual([]);
  });

  it('does not retry a non-transient error, or any error off Windows', () => {
    _stateIo.isWindows = () => true;
    let attempts = 0;
    _stateIo.rename = () => { attempts++; throw errno('ENOSPC'); };
    expect(() => LicenseGuard.load().incrementAssessmentCount()).toThrow(/ENOSPC/);
    expect(attempts).toBe(1);

    _stateIo.isWindows = () => false;
    attempts = 0;
    _stateIo.rename = () => { attempts++; throw errno('EPERM'); };
    expect(() => LicenseGuard.load().incrementAssessmentCount()).toThrow(/EPERM/);
    expect(attempts).toBe(1);
    expect(count()).toBe(7);
    expect(leftovers()).toEqual([]);
  });
});

describe('corrupt licence state file (#3440)', () => {
  const TRUNCATED = '{\n  "first_run": "2020-01-01",\n  "assessment_count": 7,\n  "finger';

  function backups(): string[] {
    return readdirSync(dir).filter(f => f.startsWith('licence-state.json.corrupt-'));
  }

  function events(): Array<{ level: string; code: string; context: Record<string, unknown> }> {
    const logDir = join(ws, 'wsp', 'logs');
    if (!existsSync(logDir)) return [];
    return readdirSync(logDir)
      .filter(f => f.startsWith('portfolio-events-'))
      .flatMap(f => readFileSync(join(logDir, f), 'utf-8').trim().split('\n'))
      .filter(Boolean)
      .map(l => JSON.parse(l) as { level: string; code: string; context: Record<string, unknown> });
  }

  it('a truncated file is not reset: load throws state_corrupt, the file and a backup keep the bytes, an error event is logged', () => {
    writeFileSync(_paths.statePath, TRUNCATED, 'utf-8');
    let err: unknown;
    try { LicenseGuard.load(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(LicenseInvalidError);
    expect((err as LicenseInvalidError).code).toBe('state_corrupt');
    expect((err as Error).message).toContain(_paths.statePath);
    expect((err as Error).message).toMatch(/did not reset it/);

    // Original untouched (not rewritten with assessment_count 0).
    expect(readFileSync(_paths.statePath, 'utf-8')).toBe(TRUNCATED);
    const b = backups();
    expect(b).toHaveLength(1);
    expect(readFileSync(join(dir, b[0]!), 'utf-8')).toBe(TRUNCATED);
    expect((err as Error).message).toContain(b[0]!);

    const ev = events().filter(e => e.code === 'licence.state.corrupt');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.level).toBe('error');
    expect(ev[0]!.context).toMatchObject({ state_path: _paths.statePath, backup_path: join(dir, b[0]!) });
    expect(String(ev[0]!.context['reason'])).toMatch(/^invalid JSON/);
  });

  it('a well-formed JSON file with the wrong shape is treated the same way', () => {
    writeFileSync(_paths.statePath, JSON.stringify({ ...STATE, assessment_count: '12' }), 'utf-8');
    expect(() => LicenseGuard.load()).toThrow(LicenseInvalidError);
    const ev = events().filter(e => e.code === 'licence.state.corrupt');
    expect(String(ev[0]!.context['reason'])).toMatch(/^unexpected shape: assessment_count/);
    expect(backups()).toHaveLength(1);
  });

  it('the counter is never incremented from a corrupt file, and repeated loads keep one backup', () => {
    writeFileSync(_paths.statePath, TRUNCATED, 'utf-8');
    expect(() => LicenseGuard.load().incrementAssessmentCount()).toThrow(LicenseInvalidError);
    expect(() => LicenseGuard.fingerprint()).toThrow(LicenseInvalidError);
    expect(readFileSync(_paths.statePath, 'utf-8')).toBe(TRUNCATED);
    expect(backups()).toHaveLength(1);
    expect(leftovers()).toEqual([]);
  });
});
