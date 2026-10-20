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

// #3283: run-status.json schema for application, service and LZ runs, and the
// reader rule (marker wins; no marker -> manifest rule).

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RunStatusSchema, readRunStatus, isRunUsable, isRunStale, RUN_STATUS_FILE } from '../run-status.js';

const root = mkdtempSync(join(tmpdir(), 'swao-run-status-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
function runDir(marker?: unknown, manifest = false): string {
  const d = join(root, `2026-10-17T10-00-${String(n++).padStart(2, '0')}`);
  mkdirSync(d, { recursive: true });
  if (marker !== undefined) writeFileSync(join(d, RUN_STATUS_FILE), typeof marker === 'string' ? marker : JSON.stringify(marker));
  if (manifest) writeFileSync(join(d, 'run-manifest.json'), '{}');
  return d;
}

// Fixtures: one marker per run type and status, as written by the lifecycle.
const APP_COMPLETE = {
  schema_version: '1.0', assessment_type: 'application', app: 'demo', run_id: '2026-10-17T10:00:00.000Z',
  status: 'complete', started_at: '2026-10-17T10:00:00.000Z', finished_at: '2026-10-17T10:05:00.000Z', exit_code: 0, swao_version: '1.4.0',
};
const SERVICE_PARTIAL = { ...APP_COMPLETE, assessment_type: 'service', status: 'partial', failed_passes: ['compliance'], exit_code: 1 };
const APP_FAILED = { ...APP_COMPLETE, status: 'failed', exit_code: 6, reason: '--fail-on severity=high: 2 signal(s) matched', finished_at: undefined };
const LZ_PARTIAL = {
  ...APP_COMPLETE, assessment_type: 'landing-zone-catalog', status: 'partial', targets: ['aws:eu-central-1', 'azure:Atlantis'],
  failed_targets: [{ provider: 'azure', region: 'Atlantis', reason: 'unknown region' }],
};
const STARTED = { ...APP_COMPLETE, status: 'started', finished_at: undefined, exit_code: undefined };

describe('RunStatusSchema (#3283)', () => {
  it('accepts application, service and LZ markers', () => {
    for (const m of [APP_COMPLETE, SERVICE_PARTIAL, APP_FAILED, LZ_PARTIAL, STARTED]) {
      const r = RunStatusSchema.safeParse(JSON.parse(JSON.stringify(m)));
      expect(r.success, JSON.stringify(!r.success && r.error.issues)).toBe(true);
    }
  });

  it('rejects an unknown status or assessment type', () => {
    expect(RunStatusSchema.safeParse({ ...APP_COMPLETE, status: 'done' }).success).toBe(false);
    expect(RunStatusSchema.safeParse({ ...APP_COMPLETE, assessment_type: 'llm' }).success).toBe(false);
  });
});

describe('isRunUsable (#3283)', () => {
  it('a marker decides: complete and partial are usable, failed / aborted / started are not', () => {
    expect(isRunUsable(runDir(APP_COMPLETE, true))).toBe(true);
    expect(isRunUsable(runDir(SERVICE_PARTIAL, true))).toBe(true);
    expect(isRunUsable(runDir(LZ_PARTIAL, true))).toBe(true);
    expect(isRunUsable(runDir(APP_FAILED))).toBe(false);
    expect(isRunUsable(runDir({ ...APP_FAILED, status: 'aborted' }))).toBe(false);
    expect(isRunUsable(runDir(STARTED))).toBe(false);
  });

  it('a run without a marker keeps the manifest rule', () => {
    expect(isRunUsable(runDir(undefined, true))).toBe(true);
    expect(isRunUsable(runDir(undefined, false))).toBe(false);
  });

  it('an unreadable marker falls back to the manifest rule', () => {
    expect(readRunStatus(runDir('{not json', true))).toBeUndefined();
    expect(isRunUsable(runDir('{not json', true))).toBe(true);
  });
});

describe('isRunStale (#3283)', () => {
  const s = RunStatusSchema.parse(JSON.parse(JSON.stringify(STARTED)));
  it('flags a started run older than the threshold only', () => {
    expect(isRunStale(s, new Date('2026-10-17T10:30:00Z'))).toBe(false);
    expect(isRunStale(s, new Date('2026-10-17T17:00:00Z'))).toBe(true);
    expect(isRunStale(RunStatusSchema.parse(APP_COMPLETE), new Date('2030-01-01T00:00:00Z'))).toBe(false);
  });
});
