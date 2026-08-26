// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Precondition gate tests (#1420, Design 092 s3.0).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAppAssessmentPrecondition } from './gates.js';

let tmpRoot: string;

function makeApp(appId: string): string {
  const appDir = join(tmpRoot, 'apps', appId);
  mkdirSync(appDir, { recursive: true });
  return appDir;
}

function writeRun(
  appDir: string,
  runTs: string,
  manifest: Record<string, unknown> | 'corrupt' | 'absent',
): void {
  const runDir = join(appDir, 'wsp', 'runs', runTs);
  mkdirSync(runDir, { recursive: true });
  if (manifest === 'absent') return;
  writeFileSync(
    join(runDir, 'run-manifest.json'),
    manifest === 'corrupt' ? '{ not json' : JSON.stringify(manifest),
    'utf-8',
  );
}

const completedManifest = {
  finished_at: '2026-08-06T10:00:00Z',
  passes_executed: ['inventory', 'data_classification'],
  pass_stats: [
    { num: '01', pass: 'inventory', tokens_in: 0 },
    { num: '03', pass: 'data_classification', tokens_in: 7000, tokens_out: 3000, llm_calls: 1 },
  ],
};

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'swao-llm-gate-'));
});

afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('checkAppAssessmentPrecondition (#1420)', () => {
  it('fails with no-app for an unknown app id', () => {
    const r = checkAppAssessmentPrecondition(tmpRoot, 'ghost-app');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-app');
  });

  it('fails with no-runs when the app has never been assessed', () => {
    makeApp('never-assessed');
    const r = checkAppAssessmentPrecondition(tmpRoot, 'never-assessed');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-runs');
    expect(r.message).toContain('swao assess --app never-assessed');
  });

  it('fails with no-completed-run when runs exist but none finished', () => {
    const appDir = makeApp('half-run');
    writeRun(appDir, '2026-08-01T10-00-00', { passes_executed: ['inventory'] }); // no finished_at
    writeRun(appDir, '2026-08-02T10-00-00', 'corrupt');
    writeRun(appDir, '2026-08-03T10-00-00', 'absent');
    const r = checkAppAssessmentPrecondition(tmpRoot, 'half-run');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-completed-run');
  });

  it('passes with the LATEST completed run and exposes its pass stats', () => {
    const appDir = makeApp('assessed');
    writeRun(appDir, '2026-08-01T10-00-00', completedManifest);
    writeRun(appDir, '2026-08-05T10-00-00', { ...completedManifest, finished_at: '2026-08-05T11:00:00Z' });
    writeRun(appDir, '2026-08-06T10-00-00', 'corrupt'); // newest is corrupt -> falls back
    const r = checkAppAssessmentPrecondition(tmpRoot, 'assessed');
    expect(r.ok).toBe(true);
    expect(r.latestRun?.runTs).toBe('2026-08-05T10-00-00');
    expect(r.latestRun?.passStats.some((p) => p.llm_calls === 1)).toBe(true);
  });

  it('treats a manifest with an empty pass list as not completed', () => {
    const appDir = makeApp('empty-passes');
    writeRun(appDir, '2026-08-04T10-00-00', { finished_at: '2026-08-04T11:00:00Z', passes_executed: [] });
    const r = checkAppAssessmentPrecondition(tmpRoot, 'empty-passes');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-completed-run');
  });
});
