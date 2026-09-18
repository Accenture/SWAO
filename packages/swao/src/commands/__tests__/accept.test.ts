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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadAcceptedRun, resolveAcceptedRunPath, ACCEPTED_RUN_FILENAME } from '@swao/module-app-assessment';

// #0477 (C-21) -- swao accept tests.

let tmp: string;
let appDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-accept-test-'));
  appDir = join(tmp, 'apps', 'test-app');
  mkdirSync(join(appDir, 'wsp', 'runs', '2026-06-03T10-00-00'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('loadAcceptedRun (#0477)', () => {
  it('returns null when no accepted-run.json exists', () => {
    expect(loadAcceptedRun(appDir)).toBeNull();
  });

  it('returns the accepted run when file exists', () => {
    const acceptedPath = resolveAcceptedRunPath(appDir);
    writeFileSync(acceptedPath, JSON.stringify({
      run_id: '2026-06-03T10-00-00',
      accepted_at: '2026-06-03T10:05:00.000Z',
      accepted_by: 'helmut',
      note: 'Post-remediation acceptance',
    }), 'utf-8');
    const result = loadAcceptedRun(appDir);
    expect(result).not.toBeNull();
    expect(result?.run_id).toBe('2026-06-03T10-00-00');
    expect(result?.note).toBe('Post-remediation acceptance');
  });

  it('resolveAcceptedRunPath returns correct path', () => {
    const p = resolveAcceptedRunPath(appDir);
    expect(p).toContain('wsp');
    expect(p).toContain(ACCEPTED_RUN_FILENAME);
  });

  it('returns null for malformed accepted-run.json', () => {
    const p = resolveAcceptedRunPath(appDir);
    writeFileSync(p, 'not valid json', 'utf-8');
    expect(loadAcceptedRun(appDir)).toBeNull();
  });
});

describe('accepted-run guard (assess integration, #0477)', () => {
  it('accepted-run.json path is within wsp/ directory (not in source control root)', () => {
    const p = resolveAcceptedRunPath(appDir);
    expect(p).toContain('wsp');
    expect(existsSync(p)).toBe(false);
  });

  it('writing accepted-run.json then reading it back roundtrips correctly', () => {
    const p = resolveAcceptedRunPath(appDir);
    const accepted = { run_id: '2026-06-03T10-00-00', accepted_at: new Date().toISOString() };
    writeFileSync(p, JSON.stringify(accepted, null, 2), 'utf-8');
    const loaded = loadAcceptedRun(appDir);
    expect(loaded?.run_id).toBe('2026-06-03T10-00-00');
  });
});
