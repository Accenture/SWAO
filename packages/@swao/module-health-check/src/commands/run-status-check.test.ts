// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3283: the health check reports failed, aborted and stale started runs
// among the latest N runs of each app (run-status.json).

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkRunStatusMarkers } from './health-check.js';

const ws = mkdtempSync(join(tmpdir(), 'swao-hc-run-status-'));
afterAll(() => rmSync(ws, { recursive: true, force: true }));

function run(app: string, name: string, marker?: Record<string, unknown>): void {
  const d = join(ws, 'apps', app, 'wsp', 'runs', name);
  mkdirSync(d, { recursive: true });
  if (marker) {
    writeFileSync(join(d, 'run-status.json'), JSON.stringify({
      schema_version: '1.0', assessment_type: 'application', app, run_id: name, started_at: '2026-10-17T08:00:00.000Z', swao_version: '1.4.0', ...marker,
    }));
  }
}

run('demo', '2026-10-17T08-00-00', { status: 'started' });                                   // stale
run('demo', '2026-10-17T09-00-00', { status: 'failed', exit_code: 6, reason: '--fail-on severity=high: 3 signal(s) matched' });
run('demo', '2026-10-17T10-00-00', { status: 'complete', exit_code: 0 });
run('demo', '2026-10-17T11-00-00', { status: 'started', started_at: '2026-10-17T11:00:00.000Z' }); // in progress
run('demo', '2026-10-16T08-00-00');                                                           // no marker
run('svc', '2026-10-17T09-30-00', { status: 'aborted', assessment_type: 'service', exit_code: 130, reason: 'SIGINT' });

describe('checkRunStatusMarkers (#3283)', () => {
  const now = new Date('2026-10-17T15:00:00.000Z');

  it('reports failed, aborted and stale started runs; not complete, in-progress or unmarked runs', () => {
    expect(checkRunStatusMarkers(ws, { now })).toEqual([
      '[WARN] apps/demo/wsp/runs/2026-10-17T09-00-00: application run failed (exit 6): --fail-on severity=high: 3 signal(s) matched',
      '[WARN] apps/demo/wsp/runs/2026-10-17T08-00-00: application run started at 2026-10-17T08:00:00.000Z and never closed (stale; the process was killed or crashed)',
      '[WARN] apps/svc/wsp/runs/2026-10-17T09-30-00: service run aborted (exit 130): SIGINT',
    ]);
  });

  it('looks at the latest N runs only', () => {
    expect(checkRunStatusMarkers(ws, { now, latestN: 2 }).filter(l => l.includes('apps/demo'))).toEqual([]);
  });

  it('returns nothing without a workspace', () => {
    expect(checkRunStatusMarkers(null)).toEqual([]);
  });
});
